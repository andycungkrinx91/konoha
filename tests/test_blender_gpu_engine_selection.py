"""GPU engine selection + render failover contract for the Konoha Blender worker.

Fake bpy harness lives in _fake_bpy_harness so both suites share one model of the
measured Blender 5.2.2 build instead of duplicating it.
"""

import os
import shutil
import sys
import tempfile
import unittest

from _fake_bpy_harness import (  # noqa: F401
    compute,
    views,
    AcceptingButNotCyclesBpy,
    FakeBpy,
    LyingRender,
    RejectingBpy,
    RejectingRender,
    fresh_bpy,
    reset_module_state,
    with_dry_ops,
    with_failing_ops,
)

class GpuEngineSelectionTests(unittest.TestCase):
    def setUp(self):
        reset_module_state()
        self._orig_addon_utils = compute.addon_utils
        # Fake addon_utils.enable succeeds; a real Blender is not needed.
        compute.addon_utils = type("AU", (), {
            "enable": staticmethod(lambda name, default_set=False: True),
        })

    def tearDown(self):
        compute.addon_utils = self._orig_addon_utils
        reset_module_state()

    # -- 1. regression: stale enum must not gate GPU ----------------------- #
    def test_configure_compute_ignores_stale_enum(self):
        bpy = fresh_bpy()
        enum_items = [
            e.identifier for e in
            bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
        ]
        self.assertEqual(enum_items, ["BLENDER_EEVEE"],
                         "fake must mirror the stale real enum")
        info = compute.configure_compute(bpy, "OPTIX", "gpu")
        self.assertEqual(info["compute_backend"], "CYCLES")
        self.assertEqual(info["device"], "OPTIX")
        self.assertFalse(info["gpu_unavailable"])
        self.assertIsNone(info["gpu_fallback_reason"])
        self.assertEqual(bpy.scene.render.engine, "CYCLES")
        self.assertEqual(bpy.scene.cycles.device, "GPU")
        # GPU devices activated, CPU left off.
        activated = {d.type for d in bpy.context.preferences.addons["cycles"].preferences.devices if d.use}
        self.assertIn("OPTIX", activated)
        self.assertNotIn("CPU", activated)

    def test_configure_compute_falls_back_to_cuda_when_optix_missing(self):
        bpy = fresh_bpy(devices=[("AMD Ryzen 9 5900HX", "CPU"),
                               ("NVIDIA GeForce RTX 3050 Laptop GPU", "CUDA")])
        info = compute.configure_compute(bpy, None, "gpu")
        self.assertEqual(info["compute_backend"], "CYCLES")
        self.assertEqual(info["device"], "CUDA")

    # -- 2. graceful fallback with a reason -------------------------------- #
    def test_configure_compute_reports_reason_when_cycles_rejects(self):
        bpy = fresh_bpy(cls=RejectingBpy)
        info = compute.configure_compute(bpy, "OPTIX", "gpu")
        self.assertNotEqual(info["compute_backend"], "CYCLES")
        self.assertTrue(info["gpu_unavailable"])
        self.assertTrue(info["gpu_fallback_reason"])
        self.assertIn("cycles_engine_unavailable", info["gpu_fallback_reason"])
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE")

    def test_configure_compute_rejects_engine_that_does_not_behave_as_cycles(self):
        bpy = fresh_bpy(cls=AcceptingButNotCyclesBpy)
        info = compute.configure_compute(bpy, "OPTIX", "gpu")
        self.assertTrue(info["gpu_unavailable"])
        self.assertTrue(info["gpu_fallback_reason"])
        self.assertNotEqual(info["compute_backend"], "CYCLES")

    def test_configure_compute_no_gpu_device_reports_reason(self):
        bpy = fresh_bpy(devices=[("AMD Ryzen 9 5900HX", "CPU")])
        info = compute.configure_compute(bpy, "OPTIX", "gpu")
        self.assertEqual(info["compute_backend"], "CYCLES")
        self.assertTrue(info["gpu_unavailable"])
        self.assertEqual(info["gpu_fallback_reason"], "no_gpu_compute_device")

    # -- 3. final render keeps GPU after step_studio ----------------------- #
    def test_final_render_keeps_cycles_after_step_studio(self):
        bpy = fresh_bpy()
        cfg = {
            "compute_mode": "gpu",
            "gpu_backend": "OPTIX",
            "flat_studio_lighting": False,
            "cycles_samples": 8,
        }
        result = views.step_studio(bpy, cfg, purpose="final")
        self.assertEqual(bpy.scene.render.engine, "CYCLES")
        self.assertEqual(result["actual_engine"], "CYCLES")
        self.assertEqual(result["compute_device"], "OPTIX")
        self.assertTrue(result["requested_gpu"])
        self.assertFalse(result["gpu_unavailable"])
        self.assertEqual(result["gpu_fallback_reason"], None)

    def test_final_render_keeps_cycles_after_configure_render(self):
        bpy = fresh_bpy()
        out = compute.configure_render(
            bpy, 320, 240, "#1e293b", False,
            "gpu", "OPTIX", purpose="final",
        )
        self.assertEqual(bpy.scene.render.engine, "CYCLES")
        self.assertEqual(out["purpose"], "final")
        self.assertEqual(out["actual_engine"], "CYCLES")
        self.assertTrue(out["requested_gpu"])
        self.assertFalse(out["gpu_unavailable"])

    def test_live_preview_step_then_final_render_engine_sequence(self):
        """Mirror run_steps: intermediate thumbnails, then the final export."""
        bpy = fresh_bpy()
        renders = with_dry_ops(bpy)
        cfg = {
            "compute_mode": "gpu",
            "gpu_backend": "OPTIX",
            "flat_studio_lighting": False,
            "cycles_samples": 8,
        }
        views.step_studio(bpy, cfg, purpose="final")
        # Per-step live preview is rendered on the fast raster engine...
        compute.configure_render(
            bpy, 320, 240, "#1e293b", False, "gpu", "OPTIX", purpose="intermediate",
        )
        views.render_preview(bpy, "/tmp/live_preview.png", 320, 240)
        # ...and the final render must be back on the probed GPU engine.
        out = compute.configure_render(
            bpy, 320, 240, "#1e293b", False, "gpu", "OPTIX", purpose="final",
        )
        views.render_preview(bpy, "/tmp/preview.png", 320, 240)
        self.assertEqual(out["actual_engine"], "CYCLES")
        self.assertEqual(
            [r["engine"] for r in renders], ["BLENDER_EEVEE", "CYCLES"]
        )
        self.assertEqual(renders[-1]["cycles_device"], "GPU")
        self.assertEqual(renders[-1]["samples"], 8)

    def test_step_export_final_configures_cycles(self):
        bpy = fresh_bpy()
        seen = {}
        original = views.configure_render
        original_preview = views.render_preview
        original_glb = views.export_glb
        original_pkg = views.export_gltf_package

        def spy(bpy_arg, w, h, bg, flat, cm=None, gb=None, purpose="intermediate"):
            seen["purpose"] = purpose
            out = original(bpy_arg, w, h, bg, flat, cm, gb, purpose=purpose)
            seen["engine_after"] = bpy_arg.scene.render.engine
            return out

        views.configure_render = spy
        try:
            cfg = {
                "compute_mode": "gpu",
                "gpu_backend": "OPTIX",
                "preview_png_path": "/nonexistent/preview.png",
                "live_preview_path": "/nonexistent/live.png",
                "final_glb_path": "/nonexistent/model.glb",
                "inspection": {"enabled": False},
            }
            views.export_glb = lambda *a, **k: True
            views.export_gltf_package = lambda *a, **k: None
            views.render_preview = lambda *a, **k: False
            views.step_export(bpy, cfg, purpose="final")
        finally:
            # Every stub must be restored: a leaked `render_preview` stub makes
            # later render tests pass (or fail) without ever touching bpy.
            views.configure_render = original
            views.render_preview = original_preview
            views.export_glb = original_glb
            views.export_gltf_package = original_pkg
        self.assertEqual(seen.get("purpose"), "final")
        self.assertEqual(seen.get("engine_after"), "CYCLES")

    # -- 4. intermediate preview stays fast -------------------------------- #
    def test_intermediate_preview_uses_raster_engine(self):
        bpy = fresh_bpy()
        out = compute.configure_render(
            bpy, 320, 240, "#1e293b", False,
            "gpu", "OPTIX", purpose="intermediate",
        )
        self.assertEqual(out["purpose"], "intermediate")
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE")
        self.assertEqual(out["actual_engine"], "BLENDER_EEVEE")
        # The compute backend remains Cycles/OPTIX for later final renders.
        self.assertEqual(out["compute_device"], "OPTIX")

    def test_step_studio_intermediate_uses_raster_engine(self):
        bpy = fresh_bpy()
        cfg = {"compute_mode": "gpu", "gpu_backend": "OPTIX",
               "flat_studio_lighting": False, "cycles_samples": 8}
        result = views.step_studio(bpy, cfg, purpose="intermediate")
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE")
        self.assertEqual(result["actual_engine"], "BLENDER_EEVEE")
        self.assertTrue(result["requested_gpu"])

    def test_purpose_default_is_intermediate(self):
        self.assertEqual(compute.normalize_render_purpose(None), "intermediate")
        self.assertEqual(compute.normalize_render_purpose("FINAL"), "final")
        self.assertEqual(compute.normalize_render_purpose("bogus"), "intermediate")

    # -- 5. cpu mode never activates compute ------------------------------- #
    def test_cpu_mode_does_not_activate_compute(self):
        bpy = fresh_bpy()
        prefs = bpy.context.preferences.addons["cycles"].preferences
        out = compute.configure_render(
            bpy, 320, 240, "#1e293b", False, "cpu", "CPU", purpose="final",
        )
        self.assertEqual(prefs.refresh_count, 0)
        self.assertFalse(any(d.use for d in prefs.devices))
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE")
        self.assertFalse(out["requested_gpu"])
        self.assertEqual(out["actual_engine"], "BLENDER_EEVEE")
        self.assertFalse(out["gpu_unavailable"])

    def test_step_studio_cpu_mode_does_not_activate_compute(self):
        bpy = fresh_bpy()
        cfg = {"compute_mode": "cpu", "gpu_backend": "CPU",
               "flat_studio_lighting": False, "cycles_samples": 8}
        result = views.step_studio(bpy, cfg, purpose="final")
        prefs = bpy.context.preferences.addons["cycles"].preferences
        self.assertEqual(prefs.refresh_count, 0)
        self.assertFalse(result["requested_gpu"])
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE")


class GpuRenderFailoverTests(unittest.TestCase):
    """Render-time degradation contract: OPTIX -> CUDA -> CPU, max 2 retries.

    (a) an OPTIX render-time failure retries once on CUDA and succeeds, naming
        the failed backend in ``gpu_fallback_reason`` while staying a GPU render;
    (b) a CUDA pin renders on CUDA from the first attempt, and the same pin
        travels as ``requested_gpu_backend`` in the worker config;
    (c) OPTIX and CUDA both fail -> one CPU Cycles render, loudly reported as
        ``gpu_unavailable`` (a CPU render is never dressed up as a GPU one);
    (d) partial output from the failed attempt is deleted before the retry, and a
        render call whose artifact was already committed is never retried;
    (e) every backend failing raises an error naming each backend and its error.
    """

    OPTIX_ERROR = "Error: OPTIX_ERROR_INTERNAL_COMPILER_ERROR (kernel_optix.ptx.zst)"
    CUDA_ERROR = "Error: CUDA_ERROR_ILLEGAL_ADDRESS in cuda_kernel.cu"

    def setUp(self):
        reset_module_state()
        self._orig_addon_utils = compute.addon_utils
        compute.addon_utils = type("AU", (), {
            "enable": staticmethod(lambda name, default_set=False: True),
        })
        self.out_dir = tempfile.mkdtemp(prefix="konoha-gpu-failover-")

    def tearDown(self):
        compute.addon_utils = self._orig_addon_utils
        reset_module_state()
        shutil.rmtree(self.out_dir, ignore_errors=True)

    def path(self, name="preview.png"):
        return os.path.join(self.out_dir, name)

    def cfg(self, gpu_backend="OPTIX"):
        # Mirrors buildWorkerConfig(): the pin travels as requested_gpu_backend
        # alongside the probed gpu_backend, exactly what the Node side emits.
        return {
            "compute_mode": "gpu",
            "gpu_backend": gpu_backend,
            "requested_gpu_backend": gpu_backend,
        }

    def render_with(self, bpy, failures, gpu_backend="OPTIX"):
        calls = with_failing_ops(bpy, failures)
        ok = views.render_preview(bpy, self.path(), 64, 64, cfg=self.cfg(gpu_backend))
        return calls, ok

    # -- (a) OPTIX fails at render time -> CUDA retry succeeds -------------- #
    def test_optix_render_failure_retries_once_on_cuda(self):
        bpy = fresh_bpy()
        calls, ok = self.render_with(
            bpy, {"OPTIX": (RuntimeError, self.OPTIX_ERROR, False)}
        )
        self.assertTrue(ok, "the CUDA retry must produce the preview")
        self.assertEqual([c["backend"] for c in calls], ["OPTIX", "CUDA"],
                         "exactly one retry, on the next GPU backend")
        self.assertEqual([c["engine"] for c in calls], ["CYCLES", "CYCLES"])
        self.assertEqual(bpy.scene.render.engine, "CYCLES")
        self.assertEqual(bpy.scene.cycles.device, "GPU")
        info = compute.get_last_compute_info()
        self.assertEqual(info["device"], "CUDA")
        self.assertFalse(info["gpu_unavailable"], "a CUDA success is still a GPU render")
        self.assertIn("OPTIX", info["gpu_fallback_reason"])
        self.assertIn("OPTIX_ERROR_INTERNAL_COMPILER_ERROR", info["gpu_fallback_reason"])
        self.assertNotIn("CUDA:", info["gpu_fallback_reason"],
                         "the successful backend is not a failure")
        self.assertEqual(info["requested_gpu_backend"], "OPTIX")
        self.assertEqual(info["gpu_retries"], 1)
        payload = compute.engine_selection_payload(bpy, True)
        self.assertEqual(payload["compute_device"], "CUDA")
        self.assertEqual(payload["requested_gpu_backend"], "OPTIX")
        self.assertFalse(payload["gpu_unavailable"])
        self.assertIn("OPTIX", payload["gpu_fallback_reason"])

    # -- (b) a CUDA pin goes straight to CUDA ------------------------------- #
    def test_cuda_pin_renders_on_cuda_without_touching_optix(self):
        bpy = fresh_bpy()
        calls, ok = self.render_with(
            bpy, {"OPTIX": (RuntimeError, self.OPTIX_ERROR, False)}, gpu_backend="CUDA"
        )
        self.assertTrue(ok)
        self.assertEqual([c["backend"] for c in calls], ["CUDA"],
                         "a CUDA pin must never touch OPTIX first")
        info = compute.get_last_compute_info()
        self.assertEqual(info["device"], "CUDA")
        self.assertEqual(info["requested_gpu_backend"], "CUDA")
        self.assertIsNone(info["gpu_fallback_reason"])
        self.assertEqual(info["gpu_retries"], 0)

    def test_cuda_pin_travels_as_requested_gpu_backend(self):
        bpy = fresh_bpy()
        cfg = self.cfg("CUDA")
        calls = with_failing_ops(bpy, {})
        views.render_preview(bpy, self.path(), 64, 64, cfg=cfg)
        self.assertEqual([c["backend"] for c in calls], ["CUDA"])
        self.assertEqual(compute.get_last_compute_info()["requested_gpu_backend"], "CUDA")
        self.assertIsNone(compute.get_last_compute_info()["gpu_fallback_reason"])

    # -- (c) OPTIX + CUDA both fail -> CPU Cycles, loudly ------------------- #
    def test_optix_and_cuda_failure_degrades_to_cpu_cycles_loudly(self):
        bpy = fresh_bpy()
        calls, ok = self.render_with(bpy, {
            "OPTIX": (RuntimeError, self.OPTIX_ERROR, False),
            "CUDA": (RuntimeError, self.CUDA_ERROR, False),
        })
        self.assertTrue(ok, "CPU Cycles still produces the artifact")
        self.assertEqual([c["backend"] for c in calls], ["OPTIX", "CUDA", "CPU"],
                         "exactly two retries: CUDA then CPU")
        self.assertEqual(len(calls) - 1, compute.MAX_GPU_RETRIES)
        self.assertEqual(bpy.scene.render.engine, "CYCLES")
        self.assertEqual(bpy.scene.cycles.device, "CPU")
        info = compute.get_last_compute_info()
        self.assertEqual(info["device"], "CPU")
        self.assertTrue(info["gpu_unavailable"],
                        "a CPU render must never report as a GPU render")
        self.assertIn("OPTIX", info["gpu_fallback_reason"])
        self.assertIn("OPTIX_ERROR_INTERNAL_COMPILER_ERROR", info["gpu_fallback_reason"])
        self.assertIn("CUDA", info["gpu_fallback_reason"])
        self.assertIn("CUDA_ERROR_ILLEGAL_ADDRESS", info["gpu_fallback_reason"])
        self.assertEqual(info["gpu_retries"], 2)
        self.assertEqual(info["backends_attempted"], ["OPTIX", "CUDA", "CPU"])
        payload = compute.engine_selection_payload(bpy, True)
        self.assertTrue(payload["gpu_unavailable"])
        self.assertEqual(payload["compute_device"], "CPU")
        self.assertIn("CUDA", payload["gpu_fallback_reason"])

    # -- (d) output commitment guard --------------------------------------- #
    def test_partial_output_is_discarded_before_retry(self):
        bpy = fresh_bpy()
        target = self.path()

        def write_partial_then_fail(_path, _calls):
            with open(target, "w", encoding="utf-8") as handle:
                handle.write("partial-optix")
            raise RuntimeError(self.OPTIX_ERROR)

        calls, ok = self.render_with(bpy, {"OPTIX": write_partial_then_fail})
        self.assertTrue(ok)
        self.assertEqual([c["backend"] for c in calls], ["OPTIX", "CUDA"])
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "png",
                             "the CUDA retry must replace the discarded OPTIX partial")

    def test_partial_file_is_deleted_not_just_overwritten(self):
        attempt = compute.RenderAttempt()
        path = self.path("inspect_side.png")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("view-3-partial")
        attempt.record(path)
        discarded = attempt.discard()
        self.assertEqual(discarded, [path])
        self.assertFalse(os.path.exists(path),
                         "a failed attempt's partial output must be deleted, not orphaned")

    def test_no_retry_after_committed_output(self):
        bpy = fresh_bpy()
        calls = with_failing_ops(bpy, {"OPTIX": (RuntimeError, self.OPTIX_ERROR, False)})
        target = self.path()

        def commit_then_raise(attempt):
            attempt.mark_committed(target)
            raise RuntimeError(self.OPTIX_ERROR)

        with self.assertRaises(compute.GpuRenderFailed) as caught:
            compute.render_with_gpu_fallback(bpy, "OPTIX", commit_then_raise, purpose="final")
        self.assertTrue(caught.exception.committed, "a committed call must never be retried")
        self.assertIn("committed", str(caught.exception))
        self.assertIn("OPTIX", str(caught.exception))
        self.assertEqual(calls, [], "no render attempt may start after commitment")

    def test_committed_ledger_refuses_to_discard(self):
        target = self.path()
        attempt = compute.RenderAttempt()
        attempt.record(target)
        attempt.mark_committed(target)
        with self.assertRaises(compute.GpuRenderFailed):
            attempt.discard()
        self.assertTrue(attempt.committed)

    # -- (e) all backends fail -> error names each one ---------------------- #
    def test_all_backends_failing_names_each_backend_and_error(self):
        bpy = fresh_bpy()
        calls = with_failing_ops(bpy, {
            "OPTIX": (RuntimeError, self.OPTIX_ERROR, False),
            "CUDA": (RuntimeError, self.CUDA_ERROR, False),
            "CPU": (RuntimeError, "Error: CPU kernel thread crashed at pixel 512", False),
        })
        with self.assertRaises(compute.GpuRenderFailed) as caught:
            views.render_preview(bpy, self.path(), 64, 64, cfg=self.cfg())
        message = str(caught.exception)
        self.assertIn("OPTIX: " + self.OPTIX_ERROR, message)
        self.assertIn("CUDA: " + self.CUDA_ERROR, message)
        self.assertIn("CPU: Error: CPU kernel thread crashed", message)
        self.assertTrue(
            message.index("OPTIX:") < message.index("CUDA:") < message.index("CPU:"),
            "the error must name each backend in attempt order: " + message,
        )
        self.assertEqual(caught.exception.code, "GPU_RENDER_FAILED")
        self.assertEqual([c["backend"] for c in calls], ["OPTIX", "CUDA", "CPU"])
        self.assertFalse(os.path.exists(self.path()))

    # -- signature / ladder invariants ------------------------------------- #
    def test_non_gpu_error_is_not_retried(self):
        bpy = fresh_bpy()
        calls = with_failing_ops(bpy, {
            "OPTIX": (TypeError, "TypeError: unsupported operand for export", False),
        })
        with self.assertRaises(compute.GpuRenderFailed) as caught:
            views.render_preview(bpy, self.path(), 64, 64, cfg=self.cfg())
        self.assertEqual([c["backend"] for c in calls], ["OPTIX"],
                         "only GPU failure signatures are retried")
        self.assertIn("OPTIX", str(caught.exception))

    def test_signature_matcher(self):
        for text in ("OPTIX_ERROR_INTERNAL_COMPILER_ERROR", "kernel_optix.ptx.zst",
                     "CUDA_ERROR_ILLEGAL_ADDRESS", "CUDA error at kernel launch",
                     "Failed to load PTX"):
            self.assertTrue(compute.is_gpu_failure_signature(text), text)
        for text in ("TypeError: bad operand", "file not found", ""):
            self.assertFalse(compute.is_gpu_failure_signature(text), text)

    def test_retry_ladder_never_exceeds_two(self):
        self.assertEqual(compute.next_gpu_backend("OPTIX"), "CUDA")
        self.assertIsNone(compute.next_gpu_backend("CUDA"), "CUDA degrades straight to CPU")
        self.assertEqual(compute.MAX_GPU_RETRIES, 2)

    def test_cpu_mode_never_enters_failover(self):
        bpy = fresh_bpy()
        cfg = {"compute_mode": "cpu", "gpu_backend": "CPU", "requested_gpu_backend": None}
        calls = with_failing_ops(bpy, {})
        views.render_preview(bpy, self.path(), 64, 64, cfg=cfg)
        self.assertEqual(len(calls), 1)
        self.assertEqual(bpy.scene.render.engine, "BLENDER_EEVEE",
                         "a CPU request never probes or switches to Cycles")


if __name__ == "__main__":
    unittest.main(verbosity=2)
