"""Konoha live agentic Blender worker.

Executes the real 6-step refinement pipeline inside Blender (4.5 - 5.x) using bpy,
optionally registering the dcc-mcp-blender capability manifest. Every step exports
intermediate/live_step.glb, renders intermediate/live_preview.png, and streams a
``KONOHA_BLENDER_STEP <json>`` telemetry line to stdout so the Node orchestrator can
relay genuine progress to the web UI in real time.

Usage (batch):
    blender -b --factory-startup -noaudio --python-exit-code 1 \
            --python blender_live_worker.py -- --batch <job_config.json>

Usage (live GUI session):
    blender --python blender_live_worker.py -- --server <job_queue_dir>

The server mode keeps an interactive, visible Blender window alive and consumes
job request files dropped into <job_queue_dir> by the orchestrator, rendering a
real preview after every step on the UI thread via ``bpy.app.timers``.
"""

import glob
import json
import math
import os
import sys
import time
import traceback


def _argv_after_double_dash():
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


_OUTPUT_DIR = None


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
    except Exception:
        return None


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


def configure_render(bpy, width, height, background, flat_lighting):
    scene = bpy.context.scene
    engines = [
        e.identifier
        for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in engines:
            scene.render.engine = candidate
            break
    else:
        scene.render.engine = (
            "BLENDER_WORKBENCH" if "BLENDER_WORKBENCH" in engines else engines[0]
        )
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


def hex_to_rgb(value):
    text = str(value or "#808080").lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    try:
        return tuple(int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.5, 0.5, 0.5)


def render_preview(bpy, path, width=None, height=None):
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
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
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


def step_import(bpy, cfg):
    clear_scene(bpy)
    bpy.ops.import_scene.gltf(filepath=cfg["base_glb_path"])
    lowest = ground_scene(bpy)
    ensure_camera_and_light(bpy)
    return {"base_min_z": round(lowest, 5), **scene_mesh_stats(bpy)}


def step_subdivide_or_bevel(bpy, cfg):
    organic = bool(cfg.get("organic"))
    touched = 0
    for obj in mesh_objects(bpy):
        select_only(bpy, [obj])
        if organic:
            turtle = (
                sum(len(p.vertices) for p in obj.data.polygons)
                or len(obj.data.polygons) * 4
            )
            if turtle <= 6000:
                mod = obj.modifiers.new(name="KonohaSubsurf", type="SUBSURF")
                mod.levels = 1
                mod.render_levels = 1
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
        touched += 1
    return {
        "modifier": "SUBSURF" if organic else "BEVEL",
        "objects": touched,
        **scene_mesh_stats(bpy),
    }


def step_uv_unwrap(bpy, cfg):
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
        except Exception:
            if bpy.context.object and bpy.context.object.mode != "OBJECT":
                bpy.ops.object.mode_set(mode="OBJECT")
    return {
        "unwrapped": unwrapped,
        "uv_layers_total": len(targets),
        **scene_mesh_stats(bpy),
    }


def _set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def build_principled_material(bpy, mat, spec, fur):
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        out = next(
            (n for n in nodes if n.type == "OUTPUT_MATERIAL"),
            nodes.new("ShaderNodeOutputMaterial"),
        )
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    color = hex_to_rgb(spec.get("color", "#b4b4b4"))
    _set_input(bsdf, ["Base Color"], (color[0], color[1], color[2], 1.0))
    _set_input(bsdf, ["Metallic"], float(spec.get("metalness", 0.0)))
    _set_input(bsdf, ["Roughness"], float(spec.get("roughness", 0.5)))
    _set_input(
        bsdf, ["Sheen Weight", "Sheen"], float(spec.get("sheen", 0.85 if fur else 0.0))
    )
    _set_input(bsdf, ["Sheen Roughness"], float(spec.get("sheenRoughness", 0.45)))
    sheen_rgb = hex_to_rgb(spec.get("sheenColor", spec.get("color", "#ffffff")))
    _set_input(bsdf, ["Sheen Tint"], (sheen_rgb[0], sheen_rgb[1], sheen_rgb[2], 1.0))
    _set_input(bsdf, ["Coat Weight", "Clearcoat"], float(spec.get("clearcoat", 0.0)))
    _set_input(
        bsdf, ["Subsurface Weight", "Subsurface"], float(spec.get("subsurface", 0.0))
    )
    if spec.get("emissive"):
        em = hex_to_rgb(spec["emissive"])
        _set_input(bsdf, ["Emission Color", "Emission"], (em[0], em[1], em[2], 1.0))
        _set_input(
            bsdf, ["Emission Strength"], float(spec.get("emissiveIntensity", 1.0))
        )
    if fur:
        coord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 0.22)
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 140.0
        noise.inputs["Detail"].default_value = 12.0
        noise.inputs["Roughness"].default_value = 0.75
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.18
        links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _read_base_color(material):
    if not material or not material.use_nodes:
        return None
    node = next(
        (n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
    )
    if node is None:
        return None
    return tuple(
        round(float(v), 3) for v in node.inputs["Base Color"].default_value[:3]
    )


def library_spec_by_color(cfg, color):
    for spec in (cfg.get("materials") or {}).values():
        hex_value = str(spec.get("color", ""))
        rgb = hex_to_rgb(hex_value)
        if all(abs(rgb[i] - color[i]) <= 0.03 for i in range(3)):
            return spec
    return None


def node_material_spec(cfg, obj):
    specs = cfg.get("materials") or {}
    name = obj.name.split(".")[0]
    if name in specs:
        return specs[name]
    for key, spec in specs.items():
        base = key.split(".")[0]
        if name == base or name.startswith(base + "_") or base.startswith(name + "_"):
            return spec
    existing = obj.data.materials[0] if obj.data.materials else None
    color = _read_base_color(existing)
    if color:
        matched = library_spec_by_color(cfg, color)
        if matched:
            return matched
    return None


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
    cache = {}
    shaded = 0
    for obj in mesh_objects(bpy):
        spec = node_material_spec(cfg, obj) or fallback
        key = (
            spec.get("color"),
            round(float(spec.get("roughness", 0.5)), 3),
            round(float(spec.get("metalness", 0.0)), 3),
            bool(spec.get("emissive")),
        )
        if key not in cache:
            mat = bpy.data.materials.new(f"KonohaMAT_{len(cache)}")
            build_principled_material(bpy, mat, spec, fur)
            cache[key] = mat
        obj.data.materials.clear()
        obj.data.materials.append(cache[key])
        for poly in obj.data.polygons:
            poly.material_index = 0
        shaded += 1
    return {
        "materials_shaded": shaded,
        "unique_materials": len(cache),
        "fur_shader": fur,
        **scene_mesh_stats(bpy),
    }


def configure_compute(bpy, backend):
    scene = bpy.context.scene
    if scene.render.engine != "CYCLES" or not backend:
        return {"compute_backend": scene.render.engine, "device": "EEVEE_GPU"}
    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        cprefs = prefs.preferences
        try:
            cprefs.compute_device_type = backend
            cprefs.get_devices()
            for device in cprefs.devices:
                device.use = device.type == backend
            scene.cycles.device = "GPU"
        except Exception:
            scene.cycles.device = "CPU"
    return {"compute_backend": "CYCLES", "device": backend}


def step_studio(bpy, cfg):
    scene = bpy.context.scene
    for light in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(light, do_unlink=True)
    flat = bool(cfg.get("flat_studio_lighting"))
    rig = [(0.0, -4.5, 6.5, 3.4), (-4.0, -2.0, 3.0, 1.4), (4.0, 2.5, 3.5, 1.6)]
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
        data.use_shadow = False if flat else True
        obj = bpy.data.objects.new(f"KonohaLight{index}", data)
        scene.collection.objects.link(obj)
        obj.location = (x, y, z)
        obj.rotation_euler = (0.0, 0.0, 0.0)
    cam = scene.camera
    if cam:
        meshes = mesh_objects(bpy)
        if meshes:
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
    compute_info = configure_compute(
        bpy, cfg.get("gpu_backend") if cfg.get("gpu_backend") != "CPU" else None
    )
    return {"lights": len(rig), "flat_studio_lighting": flat, **compute_info}


def _fit_ortho(horizontal, vertical, slot_aspect, margin):
    """Ortho scale covers the widest axis after honouring the slot aspect ratio."""
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


def render_turnaround_sheet(bpy, path, aspect):
    scene = bpy.context.scene
    meshes = mesh_objects(bpy)
    if not meshes:
        return False
    zs = [
        (o.matrix_world @ __import__("mathutils").Vector(c)).z
        for o in meshes
        for c in o.bound_box
    ]
    xs = [
        (o.matrix_world @ __import__("mathutils").Vector(c)).x
        for o in meshes
        for c in o.bound_box
    ]
    ys = [
        (o.matrix_world @ __import__("mathutils").Vector(c)).y
        for o in meshes
        for c in o.bound_box
    ]
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
    parts = []
    original_res = (scene.render.resolution_x, scene.render.resolution_y)
    for name, loc, rot, ortho in views:
        cam = _ortho_camera(bpy, name, loc, rot, ortho)
        scene.camera = cam
        scene.render.resolution_x = tile_w
        scene.render.resolution_y = tile_h
        tile_path = os.path.join(os.path.dirname(path), name + ".png")
        scene.render.filepath = tile_path
        bpy.ops.render.render(write_still=True)
        parts.append(tile_path)
    scene.render.resolution_x, scene.render.resolution_y = original_res
    composite_turnaround(bpy, parts, path, tile_w, tile_h, aspect)
    return os.path.exists(path)


def _compositor_tree(bpy):
    scene = bpy.context.scene
    if hasattr(scene, "compositing_node_group"):
        existing = scene.compositing_node_group
        if existing is None:
            existing = bpy.data.node_groups.new(
                "KonohaCompositor", "CompositorNodeTree"
            )
            scene.compositing_node_group = existing
        if not any(
            sock.in_out == "OUTPUT"
            for sock in existing.interface.items_tree
            if hasattr(sock, "in_out")
        ):
            existing.interface.new_socket(
                name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
            )
        scene.render.use_compositing = True
        return existing, existing.nodes.new("NodeGroupOutput")
    scene.use_nodes = True
    tree = scene.node_tree
    return tree, tree.nodes.new("CompositorNodeComposite")


def composite_turnaround(bpy, parts, output_path, tile_w, tile_h, aspect):
    ratio = 16.0 / 9.0
    if isinstance(aspect, str) and ":" in aspect:
        num, den = aspect.split(":")[:2]
        ratio = float(num) / float(den or 1)
    canvas_w = 1600
    canvas_h = max(1, int(round(canvas_w / ratio)))
    slot_w = canvas_w // max(1, len(parts))
    tree, output_node = _compositor_tree(bpy)
    for node in list(tree.nodes):
        if node.name != output_node.name:
            tree.nodes.remove(node)
    layers = tree.nodes.new("CompositorNodeRLayers")
    layers.location = (-1300, -500)
    previous = layers.outputs["Image"]
    for index, part in enumerate(parts):
        image = bpy.data.images.load(part, check_existing=False)
        src = tree.nodes.new("CompositorNodeImage")
        src.image = image
        src.location = (-1300, 500 - index * 320)
        scale = tree.nodes.new("CompositorNodeScale")
        if hasattr(scale, "space"):
            scale.space = "ABSOLUTE"
        elif scale.inputs.get("Type") is not None:
            scale.inputs["Type"].default_value = "Absolute"
        scale.location = (-1060, 500 - index * 320)
        for socket_name, value in (("X", float(slot_w)), ("Y", float(canvas_h))):
            socket = scale.inputs.get(socket_name)
            if socket is not None:
                socket.default_value = value
        tree.links.new(src.outputs["Image"], scale.inputs["Image"])
        translate = tree.nodes.new("CompositorNodeTranslate")
        translate.location = (-820, 500 - index * 320)
        offset_x = (index * slot_w) - (canvas_w / 2.0) + (slot_w / 2.0)
        for socket_name, value in (("X", float(offset_x)), ("Y", 0.0)):
            socket = translate.inputs.get(socket_name)
            if socket is not None:
                socket.default_value = value
        tree.links.new(scale.outputs["Image"], translate.inputs["Image"])
        blend = tree.nodes.new("CompositorNodeAlphaOver")
        blend.location = (-560, 500 - index * 200)
        for socket_name, value in (("Factor", 1.0),):
            socket = blend.inputs.get(socket_name)
            if socket is not None:
                socket.default_value = value
        tree.links.new(previous, blend.inputs["Background"])
        tree.links.new(translate.outputs["Image"], blend.inputs["Foreground"])
        previous = blend.outputs["Image"]
    output_socket = output_node.inputs[0]
    tree.links.new(previous, output_socket)
    scene = bpy.context.scene
    scene.render.resolution_x = canvas_w
    scene.render.resolution_y = canvas_h
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
    for part in parts:
        try:
            os.remove(part)
        except OSError as exc:
            emit({"event": "partial_file_cleanup_failed", "error": str(exc)})


def step_export(bpy, cfg):
    export_ok = export_glb(bpy, cfg["final_glb_path"])
    preview_path = cfg["preview_png_path"]
    live_preview = cfg["live_preview_path"]
    turnaround = cfg.get("turnaround") or {}
    if turnaround.get("enabled"):
        configure_render(bpy, 400, 675, turnaround.get("background", "#d4d4d8"), False)
        render_turnaround_sheet(
            bpy, preview_path, turnaround.get("aspectRatio", "16:9")
        )
    else:
        configure_render(bpy, 1280, 720, "#1e293b", False)
        render_preview(bpy, preview_path)
    if os.path.exists(preview_path):
        try:
            import shutil

            shutil.copyfile(preview_path, live_preview)
        except OSError as exc:
            emit({"event": "preview_copy_failed", "error": str(exc)})
    return {
        "export_glb": export_ok,
        "preview_png": os.path.exists(preview_path),
        "turnaround": bool(turnaround.get("enabled")),
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
    if not cfg.get("turnaround", {}).get("enabled"):
        configure_render(bpy, 1280, 720, "#1e293b", False)
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


def _focus_viewport(bpy):
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "MATERIAL"
            area.tag_redraw()


def run_server():
    global _OUTPUT_DIR
    bpy = import_bpy()
    args = _argv_after_double_dash()
    queue_dir = args[args.index("--server") + 1] if "--server" in args else None
    if not queue_dir or not os.path.isdir(queue_dir):
        raise SystemExit(
            "blender_live_worker --server requires an existing job queue directory"
        )
    _OUTPUT_DIR = queue_dir
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


def run_steps(cfg, bpy):
    blender_version = ".".join(str(v) for v in bpy.app.version)
    dcc_version = register_dcc_mcp()
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


if __name__ == "__main__":
    _mode_args = _argv_after_double_dash()
    if "--server" in _mode_args:
        run_server()
    else:
        run_batch()
