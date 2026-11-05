"""Konoha live agentic Blender worker.

Executes the real 6-step refinement pipeline inside Blender (4.5 - 5.x) using bpy,
optionally registering the dcc-mcp-blender capability manifest. Every step exports
intermediate/live_step.glb, renders intermediate/live_preview.png, and streams a
``KONOHA_BLENDER_STEP <json>`` telemetry line to stdout so the Node orchestrator can
relay genuine progress to the web UI in real time.
"""

import glob
import json
import math
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blender_worker_compute import (  # noqa: E402
    _CYCLES_SAMPLES,
    build_principled_material,
    clear_scene,
    configure_render,
    emit,
    ensure_camera_and_light,
    ground_scene,
    mesh_objects,
    scene_mesh_stats,
    scene_report,
    select_only,
    set_output_dir,
)
from blender_worker_views import (  # noqa: E402
    _read_size,
    export_glb,
    render_preview,
    step_export,
    step_materials,
    step_studio,
)


def _argv_after_double_dash():
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def load_config():
    args = _argv_after_double_dash()
    if "--batch" not in args:
        raise SystemExit("blender_live_worker requires --batch <job_config.json>")
    cfg_path = args[args.index("--batch") + 1]
    with open(cfg_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def import_bpy():
    import bpy  # noqa: PLC0415 - only available inside Blender

    return bpy


def register_dcc_mcp():
    try:
        import dcc_mcp_blender  # noqa: F401,PLC0415

        return getattr(dcc_mcp_blender, "__version__", "installed")
    except ImportError:
        return None


def _apply_patch_to_object(bpy, obj, changes):
    size = changes.get("size")
    if isinstance(size, (list, tuple)) and len(size) >= 3:
        dims = getattr(obj, "dimensions", None)
        for idx in range(3):
            target_dim = max(0.001, float(size[idx]))
            cur_dim = float(dims[idx]) if dims and float(dims[idx]) > 1e-4 else 0.0
            obj.scale[idx] = (
                obj.scale[idx] * (target_dim / cur_dim)
                if cur_dim > 1e-4
                else target_dim
            )
    pos = changes.get("position")
    if isinstance(pos, (list, tuple)) and len(pos) >= 3:
        obj.location.x, obj.location.y, obj.location.z = (
            float(pos[0]),
            float(pos[1]),
            float(pos[2]),
        )
    mat_spec = changes.get("material")
    if isinstance(mat_spec, dict) and obj.data and obj.data.materials:
        for slot in obj.material_slots:
            if slot.material is not None:
                build_principled_material(bpy, slot.material, mat_spec, False)


def apply_spec_patches(bpy, patches):
    if not isinstance(patches, list) or not patches:
        return 0
    meshes = mesh_objects(bpy)
    applied = 0
    for patch in patches:
        if not isinstance(patch, dict):
            continue
        target_name = str(patch.get("node") or patch.get("part") or "").strip()
        changes = patch.get("set") if isinstance(patch.get("set"), dict) else patch
        if not target_name or not isinstance(changes, dict):
            continue
        needle = target_name.lower()
        matched = [
            obj
            for obj in meshes
            if obj.name.lower() == needle
            or obj.name.split(".")[0].lower() == needle
            or needle in obj.name.lower()
        ]
        for obj in matched:
            _apply_patch_to_object(bpy, obj, changes)
            applied += 1
    if applied:
        bpy.context.view_layer.update()
        ground_scene(bpy)
    return applied


def step_import(bpy, cfg):
    clear_scene(bpy)
    bpy.ops.import_scene.gltf(filepath=cfg["base_glb_path"])
    lowest = ground_scene(bpy)
    patched = apply_spec_patches(bpy, cfg.get("patches") or [])
    ensure_camera_and_light(bpy)
    out = {
        "base_min_z": round(lowest, 5),
        "scene_report": scene_report(bpy),
        **scene_mesh_stats(bpy),
    }
    if patched:
        out["patches_applied"] = patched
    return out


ORGANIC_METABALL_KEYWORDS = ("head", "body", "torso", "haunch", "skull")


def _safe_mode_object(bpy):
    active_obj = getattr(bpy.context, "object", None)
    if not active_obj or getattr(active_obj, "mode", "OBJECT") == "OBJECT":
        return
    try:
        bpy.ops.object.mode_set(mode="OBJECT")
    except (AttributeError, RuntimeError) as exc:
        sys.stderr.write("[konoha] mode_set_skipped: %s\n" % exc)


def _apply_organic_techniques(bpy, obj, cfg):
    """Skin-modifier-free organic smoothing: weld, mirror, limit-surface subsurf."""
    applied = []
    try:
        select_only(bpy, [obj])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.0005)
        bpy.ops.object.mode_set(mode="OBJECT")
        applied.append("remove_doubles")
    except (AttributeError, RuntimeError) as exc:
        _safe_mode_object(bpy)
        emit(
            {
                "event": "organic_technique_skipped",
                "technique": "remove_doubles",
                "error": str(exc),
            }
        )

    if cfg.get("mirror_x"):
        try:
            mod = obj.modifiers.new(name="KonohaMirror", type="MIRROR")
            mod.use_axis[0] = True
            mod.use_clip = True
            mod.merge_threshold = 0.001
            bpy.ops.object.modifier_apply(modifier=mod.name)
            applied.append("mirror")
        except (AttributeError, RuntimeError) as exc:
            emit(
                {
                    "event": "organic_technique_skipped",
                    "technique": "mirror",
                    "error": str(exc),
                }
            )
    return applied


def _replace_with_metaballs(bpy, objects, _cfg):
    """Swap sphere-ish organ primitives for metaball elements so surfaces fuse."""
    from mathutils import Vector

    replaced = 0
    for obj in objects:
        name = obj.name.lower()
        if not any(key in name for key in ORGANIC_METABALL_KEYWORDS):
            continue
        try:
            meta_data = bpy.data.metaballs.new("KonohaMeta_" + obj.name)
            meta_data.resolution = 0.05
            meta_data.render_resolution = 0.05
            meta_obj = bpy.data.objects.new("KonohaMeta_" + obj.name, meta_data)
            bpy.context.scene.collection.objects.link(meta_obj)
            element = meta_data.elements.new()
            element.type = "BALL"
            radius = max(
                max(obj.dimensions) / 2.0 if hasattr(obj, "dimensions") else 0.25, 0.05
            )
            element.radius = radius
            element.stiffness = 2.0
            world = obj.matrix_world @ Vector((0.0, 0.0, 0.0))
            meta_obj.location = world
            bpy.data.objects.remove(obj, do_unlink=True)
            replaced += 1
        except (AttributeError, RuntimeError) as exc:
            emit(
                {
                    "event": "organic_technique_skipped",
                    "technique": "metaballs",
                    "error": str(exc),
                }
            )
    return replaced


def _modify_single_mesh(bpy, obj, cfg, organic, techniques):
    select_only(bpy, [obj])
    if organic:
        techniques.extend(_apply_organic_techniques(bpy, obj, cfg))
        turtle = (
            sum(len(p.vertices) for p in obj.data.polygons)
            or len(obj.data.polygons) * 4
        )
        if turtle <= 6000:
            mod = obj.modifiers.new(name="KonohaSubsurf", type="SUBSURF")
            mod.levels = 2
            mod.render_levels = 2
            if hasattr(mod, "use_limit_surface"):
                mod.use_limit_surface = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
    else:
        mod = obj.modifiers.new(name="KonohaBevel", type="BEVEL")
        mod.width = 0.015
        mod.segments = 3
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    wn = obj.modifiers.new(name="KonohaWeightedNormal", type="WEIGHTED_NORMAL")
    wn.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=wn.name)
    bpy.ops.object.shade_smooth()


def step_subdivide_or_bevel(bpy, cfg):
    organic = bool(cfg.get("organic"))
    techniques = []
    if organic and cfg.get("metaballs"):
        replaced = _replace_with_metaballs(bpy, mesh_objects(bpy), cfg)
        if replaced:
            techniques.append("metaballs:%d" % replaced)
    touched = 0
    for obj in mesh_objects(bpy):
        _modify_single_mesh(bpy, obj, cfg, organic, techniques)
        touched += 1
    return {
        "modifier": "SUBSURF" if organic else "BEVEL",
        "objects": touched,
        "organic_techniques": sorted(set(techniques)),
        **scene_mesh_stats(bpy),
    }


def step_uv_unwrap(bpy, _cfg):
    targets = mesh_objects(bpy)
    select_only(bpy, targets)
    unwrapped = 0
    for obj in targets:
        select_only(bpy, [obj])
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        try:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
            unwrapped += 1
        except (AttributeError, RuntimeError) as exc:
            sys.stderr.write("[konoha] uv_unwrap_skipped: %s\n" % exc)
            _safe_mode_object(bpy)
    return {
        "unwrapped": unwrapped,
        "uv_layers_total": len(targets),
        **scene_mesh_stats(bpy),
    }


STEPS = [
    (
        "step_1_workspace_import",
        "Workspace Import & Hierarchy Analysis",
        "dcc.blender.import_glb",
        step_import,
    ),
    (
        "step_2_modify_mesh",
        "Organic Subdivision / Micro-Chamfer Bevel",
        "dcc.blender.modify_mesh",
        step_subdivide_or_bevel,
    ),
    (
        "step_3_uv_unwrap",
        "Smart UV Projection & Island Packing",
        "dcc.blender.uv_unwrap",
        step_uv_unwrap,
    ),
    (
        "step_4_set_materials",
        "Principled BSDF & Procedural Fur Shader",
        "dcc.blender.set_materials",
        step_materials,
    ),
    (
        "step_5_setup_studio",
        "Studio Lighting, Compute Device & Camera Rig",
        "dcc.blender.setup_studio",
        step_studio,
    ),
    (
        "step_6_export_glb",
        "Production GLB Export & Preview Render",
        "dcc.blender.export_glb",
        step_export,
    ),
]


def run_steps(cfg, bpy):
    blender_version = ".".join(str(v) for v in bpy.app.version)
    dcc_version = register_dcc_mcp()
    _CYCLES_SAMPLES["value"] = int(cfg.get("cycles_samples") or 64)
    out_w, out_h = _read_size(cfg)
    turnaround = cfg.get("turnaround") or {}
    bg = turnaround.get("background", "#1e293b")
    flat = bool(cfg.get("flat_studio_lighting"))
    configure_render(
        bpy,
        out_w,
        out_h,
        bg,
        flat,
        cfg.get("compute_mode"),
        cfg.get("gpu_backend"),
    )
    for index, (step_id, step_name, tool, fn) in enumerate(STEPS, start=1):
        started = time.time()
        payload = {
            "event": "step",
            "step_id": step_id,
            "step_number": index,
            "total_steps": len(STEPS),
            "step_name": step_name,
            "tool_used": tool,
            "blender_version": blender_version,
            "dcc_mcp_version": dcc_version,
        }
        payload["metrics"] = fn(bpy, cfg)
        if index < len(STEPS):
            export_glb(bpy, cfg["live_glb_path"])
            render_preview(bpy, cfg["live_preview_path"])
        payload["status"] = "ok"
        payload["elapsed_ms"] = int((time.time() - started) * 1000)
        emit(payload)
        _focus_viewport(bpy)


def run_batch():
    bpy = import_bpy()
    cfg = load_config()
    dcc_version = register_dcc_mcp()
    emit(
        {
            "event": "worker_ready",
            "blender_version": ".".join(str(v) for v in bpy.app.version),
            "dcc_mcp_version": dcc_version,
            "engine_available": [
                e.identifier
                for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
            ],
        }
    )
    turnaround_cfg = cfg.get("turnaround")
    turnaround_enabled = bool(
        isinstance(turnaround_cfg, dict) and turnaround_cfg.get("enabled")
    )
    if not turnaround_enabled:
        _out_w, _out_h = _read_size(cfg)
        configure_render(
            bpy,
            _out_w,
            _out_h,
            "#1e293b",
            False,
            cfg.get("compute_mode"),
            cfg.get("gpu_backend"),
        )
    try:
        run_steps(cfg, bpy)
    except Exception as exc:  # pragma: no cover - defensive telemetry
        emit(
            {
                "event": "worker_failed",
                "error": str(exc),
                "traceback": traceback.format_exc()[-1200:],
            }
        )
        sys.stdout.flush()
        os._exit(2)
    emit(
        {
            "event": "worker_complete",
            "steps_executed": len(STEPS),
            "blender_version": ".".join(str(v) for v in bpy.app.version),
            "dcc_mcp_version": dcc_version,
        }
    )
    sys.stdout.flush()


def _consume_requests(queue_dir, bpy):
    pending = sorted(glob.glob(os.path.join(queue_dir, "*.request.json")))
    for request_path in pending:
        try:
            os.rename(request_path, request_path + ".running")
        except OSError:
            continue
        running_path = request_path + ".running"
        result_path = request_path.replace(".request.json", ".result.json")
        try:
            with open(running_path, "r", encoding="utf-8") as handle:
                cfg = json.load(handle)
            os.environ["KONOHA_BLENDER_REQUEST_ID"] = os.path.basename(
                running_path
            ).split(".")[0]
            run_steps(cfg, bpy)
            with open(result_path, "w", encoding="utf-8") as handle:
                json.dump({"success": True, "finished_at": time.time()}, handle)
        except Exception as exc:  # pragma: no cover - telemetry only
            emit(
                {
                    "event": "worker_failed",
                    "error": str(exc),
                    "traceback": traceback.format_exc()[-1200:],
                }
            )
            with open(result_path, "w", encoding="utf-8") as handle:
                json.dump({"success": False, "error": str(exc)}, handle)
        finally:
            try:
                os.remove(running_path)
            except OSError as exc:
                emit({"event": "heartbeat_remove_failed", "error": str(exc)})


def _set_area_material_shading(area):
    if area.type != "VIEW_3D":
        return
    for space in area.spaces:
        if space.type == "VIEW_3D":
            space.shading.type = "MATERIAL"
    area.tag_redraw()


def _focus_viewport(bpy):
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            _set_area_material_shading(area)


def run_server():
    bpy = import_bpy()
    args = _argv_after_double_dash()
    queue_dir = args[args.index("--server") + 1] if "--server" in args else None
    if not queue_dir or not os.path.isdir(queue_dir):
        raise SystemExit(
            "blender_live_worker --server requires an existing job queue directory"
        )
    set_output_dir(queue_dir)
    register_dcc_mcp()
    emit(
        {
            "event": "server_ready",
            "blender_version": ".".join(str(v) for v in bpy.app.version),
            "queue_dir": queue_dir,
        }
    )
    configure_render(bpy, 1280, 720, "#1e293b", False)

    def _tick():
        _consume_requests(queue_dir, bpy)
        _focus_viewport(bpy)
        return 1.0

    bpy.app.timers.register(_tick, first_interval=1.0, persistent=True)


if __name__ == "__main__":
    _mode_args = _argv_after_double_dash()
    if "--server" in _mode_args:
        run_server()
    else:
        run_batch()
