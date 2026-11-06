"""Blender material assignment, studio lighting, turnaround compositing,
inspection grid rendering, and GLB/PNG export for the Konoha Blender worker.
"""

import math
import os
import shutil
import sys

import blender_worker_compute as _compute
from blender_worker_compute import (
    _CYCLES_SAMPLES,
    _cycles_assignable,
    RenderAttempt,
    bake_normal_map,
    build_principled_material,
    configure_compute,
    configure_render,
    emit,
    engine_selection_payload,
    ensure_camera_and_light,
    ensure_mesh_uvs,
    get_last_compute_info,
    mesh_objects,
    normalize_render_purpose,
    node_material_spec,
    render_with_gpu_fallback,
    scene_mesh_stats,
    scene_report,
    select_fast_raster_engine,
    set_render_engine,
    wants_gpu_compute,
)


INSPECTION_VIEWS = ("front", "side", "top", "three_quarter")


def render_preview(bpy, path, width=None, height=None, cfg=None):
    """Render the preview still.

    When ``cfg`` requests GPU compute the render is wrapped in the failover ladder
    (OPTIX -> CUDA -> CPU Cycles, max 2 retries): a GPU signature is retried on the
    next backend *after discarding that call's partial file*, never after an
    artifact was committed. The single output file is committed only once Blender
    has finished writing it, so it is always discarded before a retry.
    """
    ensure_camera_and_light(bpy)
    scene = bpy.context.scene
    if (
        width
        and height
        and not (
            scene.render.resolution_x == width and scene.render.resolution_y == height
        )
    ):
        scene.render.resolution_x = width
        scene.render.resolution_y = height

    def render_once(attempt):
        scene.render.filepath = path
        attempt.record(path)
        bpy.ops.render.render(write_still=True)
        attempt.mark_committed(path)

    cfg = cfg or {}
    requested_gpu = wants_gpu_compute(cfg.get("compute_mode"), cfg.get("gpu_backend"))
    if not requested_gpu:
        render_once(RenderAttempt())
        return os.path.exists(path)
    render_with_gpu_fallback(
        bpy, cfg.get("gpu_backend"), render_once, purpose="final", compute=_compute
    )
    return os.path.exists(path)


def export_glb(bpy, path):
    kwargs = {
        "filepath": path,
        "export_format": "GLB",
        "export_apply": True,
        "export_normals": True,
        "export_materials": "EXPORT",
    }
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_materials", None)
        bpy.ops.export_scene.gltf(**kwargs)
    return os.path.exists(path)


def export_gltf_package(bpy, staging_dir):
    if not staging_dir or not os.path.isdir(staging_dir):
        return False
    gltf_path = os.path.join(staging_dir, "scene.gltf")
    kwargs = {
        "filepath": gltf_path,
        "export_format": "GLTF_SEPARATE",
        "export_texture_dir": "textures",
        "export_apply": True,
        "export_normals": True,
        "export_materials": "EXPORT",
    }
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except (TypeError, RuntimeError):
        kwargs.pop("export_texture_dir", None)
        kwargs.pop("export_materials", None)
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except RuntimeError as exc:
            sys.stderr.write(
                f"[blender_worker_views] GLTF_SEPARATE export failed for {gltf_path}: {exc}\n"
            )
    for op_name, ext in (
        ("obj_export", "obj"),
        ("stl_export", "stl"),
        ("ply_export", "ply"),
    ):
        op = getattr(bpy.ops.wm, op_name, None)
        if callable(op):
            aux_path = os.path.join(staging_dir, f"model.{ext}")
            try:
                op(filepath=aux_path)
            except RuntimeError as exc:
                sys.stderr.write(
                    f"[blender_worker_views] {ext.upper()} export failed for {aux_path}: {exc}\n"
                )
    return os.path.exists(gltf_path)


def step_materials(bpy, cfg):
    organic = bool(cfg.get("organic"))
    prompt = str(cfg.get("prompt", "")).lower()
    fur = (
        bool(cfg.get("fur"))
        or organic
        or any(k in prompt for k in ("fur", "fox", "kurama", "fur texture"))
    )
    palette = cfg.get("palette") or {}
    fallback = {
        "color": palette.get("coat", "#c2703f"),
        "roughness": 0.6,
        "sheen": 0.85 if fur else 0.0,
    }
    staging_dir = os.path.dirname(str(cfg.get("final_glb_path") or ""))
    tex_dir = os.path.join(staging_dir, "textures") if staging_dir else None
    cache = {}
    shaded = 0
    for obj in mesh_objects(bpy):
        ensure_mesh_uvs(obj)
        spec = node_material_spec(cfg, obj) or fallback
        key = (
            spec.get("color"),
            round(float(spec.get("roughness", 0.5)), 3),
            round(float(spec.get("metalness", 0.0)), 3),
            bool(spec.get("emissive")),
        )
        if key not in cache:
            mat_idx = len(cache)
            mat = bpy.data.materials.new(f"material_{mat_idx}")
            build_principled_material(
                bpy, mat, spec, fur, mat_index=mat_idx, tex_dir=tex_dir
            )
            cache[key] = mat
        obj.data.materials.clear()
        obj.data.materials.append(cache[key])
        for poly in obj.data.polygons:
            poly.material_index = 0
        shaded += 1
    normal_baked = bake_normal_map(bpy, cfg) if organic else False
    return {
        "materials_shaded": shaded,
        "unique_materials": len(cache),
        "fur_shader": fur,
        "normal_map_baked": normal_baked,
        **scene_mesh_stats(bpy),
    }


def _frame_studio_camera(bpy, cam):
    meshes = mesh_objects(bpy)
    if not meshes:
        return
    from mathutils import Vector

    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    centre = Vector(
        (
            (max(xs) + min(xs)) / 2.0,
            (max(ys) + min(ys)) / 2.0,
            (max(zs) + min(zs)) / 2.0,
        )
    )
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    distance = max(span * 2.4, 2.0)
    cam.location = centre + Vector((0.0, -distance, span * 0.12))
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50.0
    cam.data.sensor_width = 36.0


def step_studio(bpy, cfg, purpose="final"):
    """Light rig + compute device.

    ``purpose="final"`` keeps a GPU-requested scene on Cycles: a raster engine
    must never clobber the compute backend chosen for the final/inspection
    render. ``purpose="intermediate"`` (per-step live preview) may degrade to the
    fast raster engine.
    """
    scene = bpy.context.scene
    purpose = normalize_render_purpose(purpose)
    for light in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(light, do_unlink=True)
    flat = bool(cfg.get("flat_studio_lighting"))
    rig = [
        (0.0, -4.5, 6.5, 3.4),
        (-4.0, -2.5, 3.2, 1.5),
        (4.0, -2.5, 3.2, 1.5),
    ]
    if flat:
        rig = [
            (0.0, -3.0, 5.0, 1.1),
            (0.0, 3.5, 4.0, 0.8),
            (-3.5, 0.0, 3.0, 0.6),
            (3.5, 0.0, 3.0, 0.6),
        ]
    for index, (x, y, z, energy) in enumerate(rig):
        data = bpy.data.lights.new(f"KonohaLight{index}", type="AREA")
        data.energy = energy * 240.0
        data.size = 6.0
        data.use_shadow = not flat
        obj = bpy.data.objects.new(f"KonohaLight{index}", data)
        scene.collection.objects.link(obj)
        obj.location = (x, y, z)
        obj.rotation_euler = (0.0, 0.0, 0.0)
    if scene.camera:
        _frame_studio_camera(bpy, scene.camera)
    backend = cfg.get("gpu_backend")
    if not backend or backend == "CPU":
        backend = None
    _CYCLES_SAMPLES["value"] = int(cfg.get("cycles_samples") or 64)
    compute_info = configure_compute(bpy, backend, cfg.get("compute_mode"))
    requested_gpu = wants_gpu_compute(cfg.get("compute_mode"), backend)
    if purpose == "final":
        if requested_gpu:
            # Keep the GPU compute backend configure_compute actually achieved;
            # never swap in an EEVEE raster engine for a final render.
            set_render_engine(bpy, compute_info.get("compute_backend") or "CYCLES")
        elif cfg.get("cycles_final_render") and _cycles_assignable(bpy):
            set_render_engine(bpy, "CYCLES")
    elif not cfg.get("cycles_final_render"):
        set_render_engine(bpy, select_fast_raster_engine(bpy))
    return {
        "lights": len(rig),
        "flat_studio_lighting": flat,
        "scene_report": scene_report(bpy),
        **compute_info,
        **engine_selection_payload(bpy, requested_gpu),
    }


def _fit_ortho(horizontal, vertical, slot_aspect, margin):
    needed = max(max(horizontal, 1e-3), max(vertical, 1e-3) * slot_aspect)
    return needed * margin


def _ortho_camera(bpy, name, location, rotation, ortho_scale):
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_obj = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = location
    cam_obj.rotation_euler = rotation
    return cam_obj


def _stitch_tile_rows(src_rows, tile_w, tile_h, total_w):
    dst = [0.0] * (total_w * tile_h * 4)
    row_stride = tile_w * 4
    total_stride = total_w * 4
    for y in range(tile_h):
        dst_row = y * total_stride
        src_row = y * row_stride
        for idx, pix in enumerate(src_rows):
            start = dst_row + idx * row_stride
            dst[start : start + row_stride] = pix[src_row : src_row + row_stride]
    return dst


def composite_turnaround(bpy, parts, output_path, _aspect=None, _cfg_canvas_width=None):
    valid_parts = [p for p in parts if p and os.path.exists(p)]
    if not valid_parts:
        return False
    imgs = [bpy.data.images.load(p, check_existing=False) for p in valid_parts]
    try:
        tile_w = int(imgs[0].size[0])
        tile_h = int(imgs[0].size[1])
        total_w = tile_w * len(imgs)
        out = bpy.data.images.new(
            "KonohaTurnaroundSheet", width=total_w, height=tile_h, alpha=True
        )
        try:
            src_rows = [list(im.pixels[:]) for im in imgs]
            out.pixels[:] = _stitch_tile_rows(src_rows, tile_w, tile_h, total_w)
            out.filepath_raw = output_path
            out.file_format = "PNG"
            out.save()
        finally:
            bpy.data.images.remove(out)
    finally:
        for im in imgs:
            bpy.data.images.remove(im)
        for part in valid_parts:
            try:
                os.remove(part)
            except OSError as exc:
                emit({"event": "partial_file_cleanup_failed", "error": str(exc)})
    return os.path.exists(output_path)


def render_turnaround_sheet(bpy, path, aspect, cfg=None):
    scene = bpy.context.scene
    meshes = mesh_objects(bpy)
    if not meshes:
        return False
    from mathutils import Vector

    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    height = max(max(zs) - min(zs), 0.5)
    width = max(max(xs) - min(xs), 0.5)
    depth = max(max(ys) - min(ys), 0.5)
    center = (
        (max(xs) + min(xs)) / 2.0,
        (max(ys) + min(ys)) / 2.0,
        (max(zs) + min(zs)) / 2.0,
    )
    tile_w, tile_h = 400, 675
    margin = 1.12
    frame = max(height, width, depth, 0.5)
    eye = max(frame * 8.0, 8.0)
    slot_aspect = tile_h / float(tile_w)
    views = [
        (
            "KonohaCamFront",
            (center[0], center[1] - eye, center[2]),
            (math.radians(90.0), 0.0, 0.0),
            _fit_ortho(width, height, slot_aspect, margin),
        ),
        (
            "KonohaCamSide",
            (center[0] + eye, center[1], center[2]),
            (math.radians(90.0), 0.0, math.radians(90.0)),
            _fit_ortho(depth, height, slot_aspect, margin),
        ),
        (
            "KonohaCamBack",
            (center[0], center[1] + eye, center[2]),
            (math.radians(90.0), 0.0, math.radians(180.0)),
            _fit_ortho(width, height, slot_aspect, margin),
        ),
        (
            "KonohaCamTop",
            (center[0], center[1], center[2] + eye),
            (0.0, 0.0, 0.0),
            _fit_ortho(width, depth, slot_aspect, margin),
        ),
    ]
    cfg = cfg or {}
    requested_gpu = wants_gpu_compute(cfg.get("compute_mode"), cfg.get("gpu_backend"))
    parts = []
    original_res = (scene.render.resolution_x, scene.render.resolution_y)
    for name, loc, rot, ortho in views:
        cam = _ortho_camera(bpy, name, loc, rot, ortho)
        scene.camera = cam
        scene.render.resolution_x = tile_w
        scene.render.resolution_y = tile_h
        tile_path = os.path.join(os.path.dirname(path), name + ".png")

        def render_once(attempt, _tile=tile_path):
            scene.render.filepath = _tile
            attempt.record(_tile)
            bpy.ops.render.render(write_still=True)
            attempt.mark_committed(_tile)

        if requested_gpu:
            render_with_gpu_fallback(
                bpy,
                cfg.get("gpu_backend"),
                render_once,
                purpose="final",
                compute=_compute,
            )
        else:
            render_once(RenderAttempt())
        parts.append(tile_path)
    scene.render.resolution_x, scene.render.resolution_y = original_res
    composite_turnaround(bpy, parts, path, aspect)
    return os.path.exists(path)


def _view_cameras(bpy, slot_aspect, margin=1.12):
    from mathutils import Vector

    meshes = mesh_objects(bpy)
    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    width = max(max(xs) - min(xs), 0.5)
    height = max(max(zs) - min(zs), 0.5)
    depth = max(max(ys) - min(ys), 0.5)
    center = (
        (max(xs) + min(xs)) / 2.0,
        (max(ys) + min(ys)) / 2.0,
        (max(zs) + min(zs)) / 2.0,
    )
    frame = max(height, width, depth, 0.5)
    eye = max(frame * 8.0, 8.0)
    diagonal = max(frame * 5.6, 6.0)
    return {
        "front": (
            "KonohaCamFront",
            (center[0], center[1] - eye, center[2]),
            (math.radians(90.0), 0.0, 0.0),
            _fit_ortho(width, height, slot_aspect, margin),
        ),
        "side": (
            "KonohaCamSide",
            (center[0] + eye, center[1], center[2]),
            (math.radians(90.0), 0.0, math.radians(90.0)),
            _fit_ortho(depth, height, slot_aspect, margin),
        ),
        "top": (
            "KonohaCamTop",
            (center[0], center[1], center[2] + eye),
            (0.0, 0.0, 0.0),
            _fit_ortho(width, depth, slot_aspect, margin),
        ),
        "three_quarter": (
            "KonohaCamThreeQuarter",
            (
                center[0] + diagonal * 0.7,
                center[1] - diagonal * 0.7,
                center[2] + frame * 1.4,
            ),
            (math.radians(68.0), 0.0, math.radians(45.0)),
            _fit_ortho(max(width, depth) * 1.2, height, slot_aspect, margin),
        ),
    }


def _read_size(cfg):
    from_size = cfg.get("output_size") or {}
    width = int(from_size.get("width") or 1024)
    height = int(from_size.get("height") or 576)
    return max(64, width), max(64, height)


def render_inspection_grid(bpy, cfg, path):
    scene = bpy.context.scene
    meshes = mesh_objects(bpy)
    inspection = cfg.get("inspection") or {}
    requested = [
        v
        for v in (inspection.get("views") or INSPECTION_VIEWS)
        if v in INSPECTION_VIEWS
    ]
    only = [v for v in (inspection.get("only_views") or []) if v in INSPECTION_VIEWS]
    if only:
        requested = [v for v in requested if v in only] or only
    if not meshes or not requested:
        return False

    out_w, out_h = _read_size(cfg)
    count = len(requested)
    slot_w = max(1, out_w // count)
    slot_h = out_h
    slot_aspect = slot_h / float(slot_w)
    cameras = _view_cameras(bpy, slot_aspect)

    parts = []
    original_res = (scene.render.resolution_x, scene.render.resolution_y)
    original_cam = scene.camera
    requested_gpu = wants_gpu_compute(cfg.get("compute_mode"), cfg.get("gpu_backend"))
    try:
        for view in requested:
            name, loc, rot, ortho = cameras[view]
            cam = _ortho_camera(bpy, name, loc, rot, ortho)
            scene.camera = cam
            scene.render.resolution_x = slot_w
            scene.render.resolution_y = slot_h
            tile_path = os.path.join(os.path.dirname(path), "inspect_" + view + ".png")

            def render_once(attempt, _tile=tile_path):
                scene.render.filepath = _tile
                attempt.record(_tile)
                bpy.ops.render.render(write_still=True)
                attempt.mark_committed(_tile)

            # One view failing on OPTIX must not abort the grid: the ladder
            # discards that view's partial tile and re-renders it on CUDA/CPU.
            if requested_gpu:
                render_with_gpu_fallback(
                    bpy,
                    cfg.get("gpu_backend"),
                    render_once,
                    purpose="final",
                    compute=_compute,
                )
            else:
                render_once(RenderAttempt())
            parts.append(tile_path)
        scene.render.resolution_x, scene.render.resolution_y = original_res
        composite_turnaround(bpy, parts, path, "%d:%d" % (out_w, out_h))
    finally:
        scene.camera = original_cam
        scene.render.resolution_x, scene.render.resolution_y = original_res
    emit(
        {
            "event": "inspection_grid",
            "path": path,
            "views": requested,
            "width": out_w,
            "height": out_h,
        }
    )
    return os.path.exists(path)


def step_export(bpy, cfg, purpose="final"):
    export_ok = export_glb(bpy, cfg["final_glb_path"])
    export_gltf_package(bpy, os.path.dirname(str(cfg.get("final_glb_path") or "")))
    preview_path = cfg["preview_png_path"]
    live_preview = cfg["live_preview_path"]
    turnaround = cfg.get("turnaround") or {}
    out_w, out_h = _read_size(cfg)
    compute_mode = cfg.get("compute_mode")
    gpu_backend = cfg.get("gpu_backend")
    purpose = normalize_render_purpose(purpose)
    background = turnaround.get("background", "#1e293b")

    # One render call for this step: the exported GLB is already committed, so a
    # GPU failure may only be retried while no preview artifact has been flushed.
    # The ledger below records exactly what this call wrote; the failover deletes
    # it before retrying and refuses to retry once it is committed.
    step_attempt = RenderAttempt()

    def render_once(attempt):
        if turnaround.get("enabled"):
            configure_render(
                bpy,
                400,
                675,
                background,
                False,
                compute_mode,
                gpu_backend,
                purpose=purpose,
            )
        else:
            configure_render(
                bpy,
                out_w,
                out_h,
                background,
                False,
                compute_mode,
                gpu_backend,
                purpose=purpose,
            )
        attempt.record(preview_path)
        step_attempt.record(preview_path)
        if turnaround.get("enabled"):
            render_turnaround_sheet(
                bpy, preview_path, turnaround.get("aspectRatio", "16:9"), cfg
            )
        else:
            render_preview(bpy, preview_path, out_w, out_h, cfg=cfg)
        if os.path.exists(preview_path):
            attempt.mark_committed(preview_path)
            step_attempt.mark_committed(preview_path)

    requested_gpu = wants_gpu_compute(compute_mode, gpu_backend)
    if requested_gpu:
        render_with_gpu_fallback(
            bpy, gpu_backend, render_once, purpose=purpose, compute=_compute
        )
    else:
        render_once(RenderAttempt())
    if os.path.exists(preview_path):
        try:
            shutil.copyfile(preview_path, live_preview)
        except OSError as exc:
            emit({"event": "preview_copy_failed", "error": str(exc)})
    inspection = cfg.get("inspection") or {}
    grid_path = cfg.get("inspection_grid_path")
    grid_ok = False
    if inspection.get("enabled") and grid_path:
        grid_ok = render_inspection_grid(bpy, cfg, grid_path)
    compute_info = get_last_compute_info()
    return {
        "export_glb": export_ok,
        "preview_png": os.path.exists(preview_path),
        "turnaround": bool(turnaround.get("enabled")),
        "inspection_grid": grid_ok,
        "inspection_views": list(inspection.get("views") or []),
        "scene_report": scene_report(bpy),
        **compute_info,
        **engine_selection_payload(bpy, wants_gpu_compute(compute_mode, gpu_backend)),
        **scene_mesh_stats(bpy),
    }
