"""Blender compute configuration, scene utilities, Principled BSDF materials,
and studio lighting for the Konoha live agentic Blender worker.
"""

import json
import math
import os
import sys
import time

try:
    import addon_utils
except ImportError:  # outside Blender (fake bpy in tests)
    addon_utils = None


GPU_DEVICE_CANDIDATES = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")
_CYCLES_SAMPLES = {"value": 64}
_LAST_COMPUTE_INFO = {
    "compute_backend": "BLENDER_EEVEE",
    "device": "EEVEE_GPU",
    "gpu_unavailable": False,
}
_LAST_RENDER_ENGINE = {"value": None}
_OUTPUT_DIR = None


# Purposes a render configuration can be requested for. ``final`` covers
# final/inspection renders where GPU mode must survive; ``intermediate`` covers
# the per-step live preview where a fast raster engine is acceptable.
RENDER_PURPOSES = ("final", "intermediate")


def set_output_dir(path):
    global _OUTPUT_DIR
    _OUTPUT_DIR = path


def get_last_compute_info():
    return dict(_LAST_COMPUTE_INFO)


def normalize_render_purpose(purpose):
    """Canonical render purpose; unknown/None collapses to ``intermediate``.

    ``intermediate`` degrades to a raster engine, so it is the only safe default:
    defaulting to ``final`` would silently stop the fast live preview.
    """
    text = str(purpose or "").strip().lower()
    return "final" if text == "final" else "intermediate"


def active_render_engine(bpy):
    """The engine the scene is configured with right now."""
    try:
        return str(bpy.context.scene.render.engine)
    except AttributeError:
        return _LAST_RENDER_ENGINE["value"]


def set_render_engine(bpy, engine):
    bpy.context.scene.render.engine = engine
    _LAST_RENDER_ENGINE["value"] = engine
    return engine


def engine_selection_payload(bpy, requested_gpu):
    """Payload fields describing which engine actually rendered."""
    try:
        actual = active_render_engine(bpy)
    except (AttributeError, ReferenceError):
        actual = None
    info = _LAST_COMPUTE_INFO
    if actual is None:
        actual = info.get("compute_backend")
    gpu_unavailable = bool(info.get("gpu_unavailable"))
    return {
        "requested_gpu": bool(requested_gpu),
        "requested_gpu_backend": info.get("requested_gpu_backend"),
        "actual_engine": actual,
        "compute_device": info.get("device"),
        "gpu_unavailable": gpu_unavailable,
        # Never gated on gpu_unavailable: an OPTIX failure that was recovered on
        # CUDA keeps gpu_unavailable false and MUST still name the failed backend.
        "gpu_fallback_reason": info.get("gpu_fallback_reason") or None,
    }


def wants_gpu_compute(compute_mode=None, gpu_backend=None):
    """True when the caller asked for a GPU-backed (Cycles) compute backend."""
    if str(compute_mode or "").strip().lower() == "gpu":
        return True
    backend = str(gpu_backend or "").strip().upper()
    return bool(backend) and backend != "CPU"


def emit(payload):
    sys.stdout.write("KONOHA_BLENDER_STEP " + json.dumps(payload) + "\n")
    sys.stdout.flush()
    if _OUTPUT_DIR:
        request_id = os.environ.get("KONOHA_BLENDER_REQUEST_ID", "session")
        record = {"request_id": request_id, "seq": time.time_ns(), "payload": payload}
        path = os.path.join(_OUTPUT_DIR, f"{request_id}.{time.time_ns()}.output.json")
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(record, handle)
        except OSError as exc:
            sys.stderr.write("[konoha] state_file_write_failed: %s\n" % exc)


def scene_mesh_stats(bpy):
    total_v = 0
    total_t = 0
    meshes = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        meshes += 1
        mesh = obj.data
        total_v += len(mesh.vertices)
        mesh.calc_loop_triangles()
        total_t += len(mesh.loop_triangles)
    return {"meshes": meshes, "vertices": total_v, "triangles": total_t}


def clear_scene(bpy):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def mesh_objects(bpy):
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def select_only(bpy, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def ground_scene(bpy):
    lowest = None
    for obj in mesh_objects(bpy):
        for corner in obj.bound_box:
            world_z = (obj.matrix_world @ __import__("mathutils").Vector(corner)).z
            lowest = world_z if lowest is None else min(lowest, world_z)
    if lowest is None:
        return 0.0
    if abs(lowest) > 1e-4:
        for obj in mesh_objects(bpy):
            obj.location.z -= lowest
    return float(lowest)


def ensure_camera_and_light(bpy):
    scene = bpy.context.scene
    if scene.camera is None:
        cam_data = bpy.data.cameras.new("KonohaCamera")
        cam_obj = bpy.data.objects.new("KonohaCamera", cam_data)
        scene.collection.objects.link(cam_obj)
        cam_obj.location = (0.0, -6.2, 2.4)
        cam_obj.rotation_euler = (math.radians(74.0), 0.0, 0.0)
        scene.camera = cam_obj
    if not any(o.type == "LIGHT" for o in scene.objects):
        light_data = bpy.data.lights.new("KonohaKey", type="SUN")
        light_data.energy = 3.2
        light_obj = bpy.data.objects.new("KonohaKey", light_data)
        scene.collection.objects.link(light_obj)
        light_obj.location = (3.0, -3.0, 6.0)
        light_obj.rotation_euler = (math.radians(32.0), 0.0, math.radians(38.0))


def scene_report(bpy):
    """Objective scene geometry report used before any vision call."""
    from mathutils import Vector

    meshes = mesh_objects(bpy)
    if not meshes:
        return {
            "dimensions": [0.0, 0.0, 0.0],
            "bbox_min": [0.0, 0.0, 0.0],
            "bbox_max": [0.0, 0.0, 0.0],
            "height_to_width_ratio": 0.0,
            "part_count": 0,
            "part_positions": [],
            "symmetry_x_residual": None,
        }
    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    bbox_min = [min(xs), min(ys), min(zs)]
    bbox_max = [max(xs), max(ys), max(zs)]
    dims = [max(bbox_max[i] - bbox_min[i], 1e-6) for i in range(3)]
    parts = []
    for obj in meshes:
        local = [Vector(c) for c in obj.bound_box]
        world = [obj.matrix_world @ c for c in local]
        pxs = [c.x for c in world]
        pys = [c.y for c in world]
        pzs = [c.z for c in world]
        parts.append(
            {
                "name": obj.name,
                "center": [
                    round((max(pxs) + min(pxs)) / 2.0, 5),
                    round((max(pys) + min(pys)) / 2.0, 5),
                    round((max(pzs) + min(pzs)) / 2.0, 5),
                ],
                "dimensions": [
                    round(max(max(pxs) - min(pxs), 1e-6), 5),
                    round(max(max(pys) - min(pys), 1e-6), 5),
                    round(max(max(pzs) - min(pzs), 1e-6), 5),
                ],
            }
        )
    centres = [p["center"] for p in parts]
    residual = None
    if len(centres) > 1:
        half = max(dims[0] / 2.0, 1e-6)
        total = 0.0
        for centre in centres:
            nearest = min(abs(centre[0] + other[0]) for other in centres)
            total += nearest
        residual = round(total / len(centres) / half, 5)
    return {
        "dimensions": [round(d, 5) for d in dims],
        "bbox_min": [round(v, 5) for v in bbox_min],
        "bbox_max": [round(v, 5) for v in bbox_max],
        "height_to_width_ratio": round(dims[2] / dims[0], 5),
        "part_count": len(parts),
        "part_positions": parts,
        "symmetry_x_residual": residual,
    }


def hex_to_rgb(value):
    text = str(value or "#808080").lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    try:
        return tuple(int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.5, 0.5, 0.5)


def _gpu_device_types(cprefs):
    types = set()
    for device in getattr(cprefs, "devices", []) or []:
        device_type = str(getattr(device, "type", "") or "").upper()
        for candidate in GPU_DEVICE_CANDIDATES:
            if candidate in device_type:
                types.add(candidate)
    return types


def _resolve_cycles_preferences(bpy):
    addons = bpy.context.preferences.addons
    entry = addons.get("cycles") if hasattr(addons, "get") else None
    if entry:
        return getattr(entry, "preferences", None)
    try:
        if addon_utils is not None:
            addon_utils.enable("cycles", default_set=True)
    except (AttributeError, RuntimeError, ImportError) as exc:
        sys.stderr.write("[konoha] addon_utils_cycles_enable_skipped: %s\n" % exc)
    try:
        entry = addons.get("cycles") if hasattr(addons, "get") else None
        if entry is None:
            bpy.ops.preferences.addon_enable(module="cycles")
            entry = addons.get("cycles") if hasattr(addons, "get") else None
        return getattr(entry, "preferences", None) if entry else None
    except (AttributeError, RuntimeError) as exc:
        sys.stderr.write("[konoha] cycles_addon_enable_skipped: %s\n" % exc)
        return None


def _probe_candidate_device(cprefs, candidate):
    try:
        cprefs.compute_device_type = candidate
        if hasattr(cprefs, "refresh_devices"):
            cprefs.refresh_devices()
        get_devs = getattr(cprefs, "get_devices", None)
        if callable(get_devs):
            get_devs()
    except (AttributeError, RuntimeError, TypeError, ValueError) as exc:
        sys.stderr.write(
            "[konoha] compute_candidate_skipped (%s): %s\n" % (candidate, exc)
        )
        return False

    typed = []
    get_for_type = getattr(cprefs, "get_devices_for_type", None)
    if callable(get_for_type):
        try:
            typed = list(get_for_type(candidate) or [])
        except (AttributeError, RuntimeError, TypeError) as exc:
            sys.stderr.write("[konoha] get_devices_for_type_skipped: %s\n" % exc)
            typed = []
    return bool(typed) or candidate in _gpu_device_types(cprefs)


def _activate_gpu_candidate(scene, cprefs, candidate):
    for device in getattr(cprefs, "devices", []) or []:
        dtype = str(getattr(device, "type", "") or "").upper()
        device.use = dtype != "CPU" and any(c in dtype for c in GPU_DEVICE_CANDIDATES)
    scene.cycles.device = "GPU"
    if candidate != "OPTIX":
        return
    has_optix_dn = getattr(cprefs, "has_optixdenoiser_gpu_devices", None)
    if callable(has_optix_dn) and has_optix_dn() and hasattr(scene.cycles, "denoiser"):
        try:
            scene.cycles.denoiser = "OPTIX"
        except (AttributeError, TypeError, ValueError) as exc:
            sys.stderr.write("[konoha] optix_denoiser_skipped: %s\n" % exc)


def _activate_cycles(scene, bpy):
    """Assign CYCLES as the capability probe.

    ``bl_rna...enum_items`` is stale on some builds (Blender 5.2.2 lists only
    BLENDER_EEVEE while assigning CYCLES works), so an enum lookup is never a
    valid gate. Assign the engine, mutate a real Cycles property and read it
    back: an engine that only *accepts* the assignment without behaving as
    Cycles must not be reported as usable. Restores the previous engine and
    returns the failure reason on any error.
    """
    previous = scene.render.engine
    try:
        scene.render.engine = "CYCLES"
        samples = scene.cycles.samples
        scene.cycles.samples = samples
        if str(scene.render.engine) != "CYCLES":
            raise RuntimeError("engine assignment reported %r" % (scene.render.engine,))
    except (AttributeError, RuntimeError, TypeError, ValueError) as exc:
        try:
            scene.render.engine = previous
        except (AttributeError, RuntimeError, TypeError, ValueError):
            pass
        sys.stderr.write("[konoha] cycles_engine_unavailable: %s\n" % exc)
        return str(exc) or "cycles engine assignment failed"
    return None


def _fallback_engine_reason(scene, bpy):
    """Pick the engine to use when Cycles is genuinely unavailable."""
    try:
        return select_fast_raster_engine(bpy)
    except (AttributeError, IndexError):
        return scene.render.engine


def _cycles_assignable(bpy):
    """True when CYCLES can actually be assigned and behaves like Cycles."""
    return _activate_cycles(bpy.context.scene, bpy) is None


def configure_compute(bpy, backend, compute_mode=None):
    """Select a real GPU compute backend on Cycles when requested."""
    scene = bpy.context.scene
    backend_norm = (
        str(backend or "").upper().strip() if backend and backend != "CPU" else ""
    )
    wants_gpu = compute_mode == "gpu" or bool(backend_norm)
    _LAST_COMPUTE_INFO["requested_gpu_backend"] = backend_norm or None
    if not wants_gpu:
        info = {"compute_backend": scene.render.engine, "device": "EEVEE_GPU"}
        info.setdefault("gpu_unavailable", False)
        info.setdefault("gpu_fallback_reason", None)
        _LAST_COMPUTE_INFO.update(info)
        return dict(_LAST_COMPUTE_INFO)

    # Enable the cycles addon defensively; this is also where the cycles
    # preferences come from for device enumeration.
    cprefs = _resolve_cycles_preferences(bpy)
    reason = _activate_cycles(scene, bpy)
    if reason is not None:
        engine = _fallback_engine_reason(scene, bpy)
        _LAST_RENDER_ENGINE["value"] = engine
        _LAST_COMPUTE_INFO.update(
            {
                "compute_backend": engine,
                "device": "CPU",
                "gpu_unavailable": True,
                "gpu_fallback_reason": "cycles_engine_unavailable: %s" % reason,
            }
        )
        return dict(_LAST_COMPUTE_INFO)
    scene.cycles.samples = int(
        getattr(bpy.context.scene, "konoha_cycles_samples", 0)
        or _CYCLES_SAMPLES.get("value", 64)
    )
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = True

    if not cprefs:
        _LAST_COMPUTE_INFO.update(
            {
                "compute_backend": "CYCLES",
                "device": "CPU",
                "gpu_unavailable": True,
                "gpu_fallback_reason": "cycles_preferences_unavailable",
            }
        )
        return dict(_LAST_COMPUTE_INFO)

    preferred = [backend_norm] if backend_norm in GPU_DEVICE_CANDIDATES else []
    candidates = preferred + [c for c in GPU_DEVICE_CANDIDATES if c not in preferred]
    for candidate in candidates:
        if _probe_candidate_device(cprefs, candidate):
            _activate_gpu_candidate(scene, cprefs, candidate)
            _LAST_COMPUTE_INFO.update(
                {
                    "compute_backend": "CYCLES",
                    "device": candidate,
                    "gpu_unavailable": False,
                    "gpu_fallback_reason": None,
                }
            )
            return dict(_LAST_COMPUTE_INFO)

    for device in getattr(cprefs, "devices", []) or []:
        device.use = False
    scene.cycles.device = "CPU"
    _LAST_COMPUTE_INFO.update(
        {
            "compute_backend": "CYCLES",
            "device": "CPU",
            "gpu_unavailable": True,
            "gpu_fallback_reason": "no_gpu_compute_device",
        }
    )
    return dict(_LAST_COMPUTE_INFO)


def select_fast_raster_engine(bpy):
    engines = [
        e.identifier
        for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in engines:
            return candidate
    return "BLENDER_WORKBENCH" if "BLENDER_WORKBENCH" in engines else engines[0]


# Render-time GPU failover lives in blender_worker_gpu_failover (700-line
# module cap); re-exported here so existing importers keep one stable surface.
from blender_worker_gpu_failover import (  # noqa: E402,F401
    GPU_BACKEND_ORDER,
    GPU_FAILURE_SIGNATURE,
    MAX_GPU_RETRIES,
    GpuRenderFailed,
    RenderAttempt,
    backend_failure_detail,
    format_backend_failures,
    is_gpu_failure_signature,
    next_gpu_backend,
    render_with_gpu_fallback,
)


def configure_render(
    bpy,
    width,
    height,
    background,
    flat_lighting,
    compute_mode=None,
    gpu_backend=None,
    purpose="intermediate",
):
    """Configure resolution/background; pick the engine for the render purpose.

    ``purpose="final"`` (final preview, turnaround, inspection) never degrades a
    GPU-requested scene to a raster engine: when GPU was requested the engine
    stays ``CYCLES`` (or the probed backend if Cycles is unusable), and
    ``gpu_unavailable`` / ``gpu_fallback_reason`` report an honest CPU fallback.
    ``purpose="intermediate"`` is the per-step live preview and uses the fast
    raster engine so thumbnails stay cheap.
    """
    scene = bpy.context.scene
    purpose = normalize_render_purpose(purpose)
    requested_gpu = wants_gpu_compute(compute_mode, gpu_backend)
    if requested_gpu:
        # configure_compute's assignment probe already decided whether Cycles
        # (and which device) is really usable; trust it, not the stale enum.
        # A "final" purpose must never degrade the probed GPU engine to raster.
        compute_info = configure_compute(bpy, gpu_backend, compute_mode)
        if purpose == "final":
            target = compute_info.get("compute_backend") or "CYCLES"
        else:
            target = select_fast_raster_engine(bpy)
        set_render_engine(bpy, target)
    else:
        # No GPU requested: raster previews stay fast, and a CPU final render
        # keeps its configured engine (an explicit Cycles opt-in for CPU lives
        # in step_studio, which sees cycles_final_render).
        set_render_engine(bpy, select_fast_raster_engine(bpy))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = scene.world or bpy.data.worlds.new("KonohaWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        rgb = hex_to_rgb(background)
        bg_node.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bg_node.inputs["Strength"].default_value = 1.0 if flat_lighting else 0.75
    for light in [o for o in scene.objects if o.type == "LIGHT"]:
        light.data.use_shadow = not flat_lighting
    return {"purpose": purpose, **engine_selection_payload(bpy, requested_gpu)}


# Material construction lives in blender_worker_materials (700-line module cap);
# re-exported here so existing `from blender_worker_compute import ...` callers
# keep one stable import surface.
from blender_worker_materials import (  # noqa: E402,F401
    _read_base_color,
    _set_input,
    bake_normal_map,
    build_material_base_color_texture,
    build_principled_material,
    ensure_mesh_uvs,
    library_spec_by_color,
    node_material_spec,
)
