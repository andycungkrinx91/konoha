"""Blender compute configuration, scene utilities, Principled BSDF materials,
and studio lighting for the Konoha live agentic Blender worker.
"""

import json
import math
import os
import sys
import time


GPU_DEVICE_CANDIDATES = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")
_CYCLES_SAMPLES = {"value": 64}
_LAST_COMPUTE_INFO = {
    "compute_backend": "BLENDER_EEVEE",
    "device": "EEVEE_GPU",
    "gpu_unavailable": False,
}
_OUTPUT_DIR = None


def set_output_dir(path):
    global _OUTPUT_DIR
    _OUTPUT_DIR = path


def get_last_compute_info():
    return dict(_LAST_COMPUTE_INFO)


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
        return entry.preferences
    try:
        bpy.ops.preferences.addon_enable(module="cycles")
        entry = addons.get("cycles") if hasattr(addons, "get") else None
        return entry.preferences if entry else None
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


def configure_compute(bpy, backend, compute_mode=None):
    """Select a real GPU compute backend on Cycles when requested."""
    scene = bpy.context.scene
    backend_norm = (
        str(backend or "").upper().strip() if backend and backend != "CPU" else ""
    )
    wants_gpu = compute_mode == "gpu" or bool(backend_norm)
    if not wants_gpu:
        info = {"compute_backend": scene.render.engine, "device": "EEVEE_GPU"}
        _LAST_COMPUTE_INFO.update(info)
        return info

    engines = [
        e.identifier
        for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    if "CYCLES" not in engines:
        info = {
            "compute_backend": scene.render.engine,
            "device": "CPU",
            "gpu_unavailable": True,
        }
        _LAST_COMPUTE_INFO.update(info)
        return info
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(
        getattr(bpy.context.scene, "konoha_cycles_samples", 0)
        or _CYCLES_SAMPLES.get("value", 64)
    )
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = True

    cprefs = _resolve_cycles_preferences(bpy)
    if not cprefs:
        info = {"compute_backend": "CYCLES", "device": "CPU", "gpu_unavailable": True}
        _LAST_COMPUTE_INFO.update(info)
        return info

    preferred = [backend_norm] if backend_norm in GPU_DEVICE_CANDIDATES else []
    candidates = preferred + [c for c in GPU_DEVICE_CANDIDATES if c not in preferred]
    for candidate in candidates:
        if _probe_candidate_device(cprefs, candidate):
            _activate_gpu_candidate(scene, cprefs, candidate)
            info = {
                "compute_backend": "CYCLES",
                "device": candidate,
                "gpu_unavailable": False,
            }
            _LAST_COMPUTE_INFO.update(info)
            return info

    for device in getattr(cprefs, "devices", []) or []:
        device.use = False
    scene.cycles.device = "CPU"
    info = {"compute_backend": "CYCLES", "device": "CPU", "gpu_unavailable": True}
    _LAST_COMPUTE_INFO.update(info)
    return info


def select_fast_raster_engine(bpy):
    engines = [
        e.identifier
        for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in engines:
            return candidate
    return "BLENDER_WORKBENCH" if "BLENDER_WORKBENCH" in engines else engines[0]


def configure_render(
    bpy,
    width,
    height,
    background,
    flat_lighting,
    compute_mode=None,
    gpu_backend=None,
):
    scene = bpy.context.scene
    if compute_mode == "gpu" or (gpu_backend and gpu_backend != "CPU"):
        configure_compute(bpy, gpu_backend, compute_mode)
    scene.render.engine = select_fast_raster_engine(bpy)
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
        if name == base or name.startswith(base + "_") or name.startswith(name + "_"):
            return spec
    existing = obj.data.materials[0] if obj.data.materials else None
    color = _read_base_color(existing)
    if color:
        matched = library_spec_by_color(cfg, color)
        if matched:
            return matched
    return None


def bake_normal_map(bpy, cfg):
    """Bake a tangent-space normal map for organic PBR surfaces (best effort)."""
    if not cfg.get("enable_pbr"):
        return False
    prev_engine = bpy.context.scene.render.engine
    try:
        targets = mesh_objects(bpy)
        if not targets:
            return False
        target = targets[0]
        if not target.data.materials or not target.data.uv_layers:
            return False
        configure_compute(bpy, cfg.get("gpu_backend"), cfg.get("compute_mode"))
        bpy.context.scene.cycles.samples = 1
        if hasattr(bpy.context.scene.cycles, "use_denoising"):
            bpy.context.scene.cycles.use_denoising = False
        image = bpy.data.images.new(
            "KonohaNormalMap", width=512, height=512, alpha=False
        )
        mat = target.data.materials[0]
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        nodes.active = tex
        select_only(bpy, [target])
        bpy.context.scene.render.engine = "CYCLES"
        bpy.ops.object.bake(type="NORMAL")
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None:
            nmap = nodes.new("ShaderNodeNormalMap")
            mat.node_tree.links.new(tex.outputs["Color"], nmap.inputs["Color"])
            mat.node_tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        return True
    except (AttributeError, RuntimeError, TypeError, ValueError) as exc:
        emit(
            {
                "event": "organic_technique_skipped",
                "technique": "normal_map",
                "error": str(exc),
            }
        )
        return False
    finally:
        bpy.context.scene.render.engine = prev_engine
