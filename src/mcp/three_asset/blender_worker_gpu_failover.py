"""Render-time GPU failover for the Konoha Blender worker.

Blender aborts a Cycles GPU render with a RuntimeError carrying an OPTIX/PTX/CUDA
signature when the kernel JIT, the device driver or the denoiser dies mid-render.
Instead of aborting the refinement, the worker degrades: OPTIX -> CUDA -> CPU
Cycles (max 2 retries), but ONLY while nothing has been committed for that render
call. Every partial artifact of a failed attempt is deleted before the retry, and
a committed artifact stops the ladder with an error naming every backend.
"""

import os
import re
import sys

GPU_FAILURE_SIGNATURE = re.compile(
    r"OPTIX_ERROR|PTX|CUDA_ERROR|CUDA error|CUDA kernel|OptiX",
    re.IGNORECASE,
)
GPU_BACKEND_ORDER = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")
# A failed render attempt is retried at most twice: second GPU backend, then CPU.
MAX_GPU_RETRIES = 2


def is_gpu_failure_signature(exc):
    """True when a render raised one of the GPU failure signatures."""
    text = str(exc or "")
    return bool(GPU_FAILURE_SIGNATURE.search(text))


def next_gpu_backend(failed_backend, attempted=()):
    """The next GPU backend to try after ``failed_backend``.

    OPTIX degrades to CUDA (the same silicon, different kernel/denoiser path);
    every other backend falls straight to CPU, which is reported as ``None``.
    """
    failed = str(failed_backend or "").strip().upper()
    seen = {str(b or "").strip().upper() for b in attempted}
    if failed == "OPTIX":
        for candidate in ("CUDA", "HIP", "METAL", "ONEAPI"):
            if candidate not in seen:
                return candidate
        return None
    return None


def backend_failure_detail(exc, limit=300):
    """One-line, credential-free rendering of a backend failure."""
    text = " ".join(str(exc or "").split())
    return text[:limit] or type(exc).__name__


def format_backend_failures(failures):
    """``OPTIX: <error>; CUDA: <error>; CPU: <error>`` — every backend named."""
    return "; ".join("%s: %s" % (backend, detail) for backend, detail in failures)


class GpuRenderFailed(RuntimeError):
    """Raised when every backend (GPU and CPU) failed for one render call."""

    def __init__(self, failures, committed=False):
        self.failures = list(failures)
        self.committed = bool(committed)
        header = (
            "GPU render failed and no retry is allowed: output was already "
            "committed for this render call"
            if committed
            else "GPU render failed on every backend"
        )
        super().__init__("%s [%s]" % (header, format_backend_failures(failures)))
        self.code = "GPU_RENDER_FAILED"


class RenderAttempt:
    """Outcome of one render attempt, exactly mirroring how Blender reports it.

    Blender raises as soon as a tile fails, after earlier output of the same call
    may already be on disk. The attempt therefore owns the list of paths it wrote
    and must discard them before any retry; once an artifact is committed the call
    is sealed and may never be retried.
    """

    def __init__(self):
        self.written = []
        self.committed = False

    def record(self, path):
        if path and path not in self.written:
            self.written.append(path)

    def mark_committed(self, path=None):
        self.record(path)
        self.committed = True

    def discard(self):
        """Delete every artifact this attempt wrote (a committed call refuses)."""
        if self.committed:
            raise GpuRenderFailed(
                [("OUTPUT", "already committed; partial output cannot be discarded")],
                committed=True,
            )
        discarded = []
        for path in self.written:
            try:
                if os.path.exists(path):
                    os.remove(path)
                    discarded.append(path)
            except OSError as exc:
                sys.stderr.write(
                    "[konoha] partial_discard_failed (%s): %s\n" % (path, exc)
                )
        self.written = []
        return discarded


def _set_cycles_cpu_device(scene, cprefs):
    for device in getattr(cprefs, "devices", []) or []:
        device.use = False
    scene.cycles.device = "CPU"


def _attempt_plan(requested_backend, allow_cpu_fallback=True):
    """Backends to try in order for one render call: [GPU (maybe 2), CPU]."""
    first = str(requested_backend or "").strip().upper()
    plan = [first or "OPTIX"]
    second = next_gpu_backend(first, attempted=plan)
    if second and len(plan) <= MAX_GPU_RETRIES:
        plan.append(second)
    if allow_cpu_fallback:
        plan.append("CPU")
    return plan[: MAX_GPU_RETRIES + 1]


def render_with_gpu_fallback(
    bpy,
    requested_backend,
    render_once,
    purpose="final",
    allow_cpu_fallback=True,
    compute=None,
):
    """Run ``render_once`` on the requested GPU backend, degrading instead of aborting.

    The failure ladder is OPTIX -> CUDA -> CPU Cycles (max 2 retries). Failure is
    only ever retried *before any output of that call is committed*: the partial
    artifacts written by a failed attempt are deleted first, and a committed
    artifact stops the ladder with an error that names every backend.

    ``render_once(attempt)`` must record every path it writes on ``attempt`` and
    call ``attempt.mark_committed(path)`` once its final artifact is flushed.
    ``compute`` is the blender_worker_compute module supplying the engine/device
    helpers (injected to keep this module free of a circular import).
    """
    if compute is None:  # deferred: blender_worker_compute re-exports this module
        import blender_worker_compute as compute  # noqa: PLC0415

    if compute.normalize_render_purpose(purpose) != "final":
        attempt = RenderAttempt()
        render_once(attempt)
        return {"attempts": [], "fallbacks": 0, "attempt": attempt}

    plan = _attempt_plan(requested_backend, allow_cpu_fallback)
    failures = []
    attempts = []
    for index, backend in enumerate(plan):
        if backend == "CPU":
            # Select the CPU device on Cycles without deciding the verdict: whether
            # the run is reported gpu_unavailable depends on THIS attempt succeeding,
            # and a CPU attempt that itself fails must not look like a CPU render.
            cprefs = compute._resolve_cycles_preferences(bpy)
            if compute._activate_cycles(bpy.context.scene, bpy) is not None:
                failures.append(("CPU", "cycles engine unavailable"))
                attempts.append({"backend": "CPU", "status": "unavailable"})
                continue
            _set_cycles_cpu_device(bpy.context.scene, cprefs)
            compute._LAST_COMPUTE_INFO.update(
                {"compute_backend": "CYCLES", "device": "CPU"}
            )
        else:
            info = compute.configure_compute(bpy, backend, "gpu")
            if info.get("device") != backend:
                failures.append(
                    (
                        backend,
                        info.get("gpu_fallback_reason") or "compute device unavailable",
                    )
                )
                attempts.append({"backend": backend, "status": "unavailable"})
                continue
            compute.set_render_engine(bpy, info.get("compute_backend") or "CYCLES")
        attempt = RenderAttempt()
        try:
            render_once(attempt)
        except Exception as exc:  # noqa: BLE001 - every failure is classified here
            if attempt.committed:
                failures.append((backend, backend_failure_detail(exc)))
                raise GpuRenderFailed(failures, committed=True) from exc
            if not is_gpu_failure_signature(exc):
                failures.append((backend, backend_failure_detail(exc)))
                raise GpuRenderFailed(failures) from exc
            attempt.discard()
            failures.append((backend, backend_failure_detail(exc)))
            attempts.append({"backend": backend, "status": "failed"})
            sys.stderr.write(
                "[konoha] gpu_backend_failed (%s): %s\n"
                % (backend, backend_failure_detail(exc))
            )
            continue
        attempts.append({"backend": backend, "status": "ok"})
        fallbacks = attempts[:-1]
        # A CPU success is a downgrade and is ALWAYS gpu_unavailable; a GPU success
        # after another GPU failed keeps gpu_unavailable false but names the failure.
        cpu_success = backend == "CPU"
        reason = None
        if index > 0 or cpu_success:
            reason = " | ".join(
                "%s: %s" % (name, detail)
                for name, detail in failures
                if any(a["backend"] == name for a in fallbacks)
            )
        if cpu_success and not reason:
            reason = "CPU render; no GPU backend produced the output"
        device = "CPU" if cpu_success else compute._LAST_COMPUTE_INFO.get("device")
        compute._LAST_COMPUTE_INFO.update(
            {
                "compute_backend": "CYCLES",
                "requested_gpu_backend": str(requested_backend or "").upper() or None,
                "device": device,
                # Only a CPU result is "GPU unavailable": a GPU that succeeded after
                # another GPU backend failed is degraded, not unavailable.
                "gpu_unavailable": cpu_success,
                "gpu_fallback_reason": reason,
                "backends_attempted": [a["backend"] for a in attempts],
                "gpu_retries": len(fallbacks),
                "render_attempts": attempts,
            }
        )
        return {"attempts": attempts, "fallbacks": len(fallbacks), "attempt": attempt}
    raise GpuRenderFailed(failures)
