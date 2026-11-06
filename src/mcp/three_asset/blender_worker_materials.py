"""Principled BSDF / procedural fur material construction for the Konoha
Blender worker: texture generation, node graphs, library colour matching, and
normal-map baking.
"""

import math
import os
import sys

from blender_worker_compute import (
    configure_compute,
    emit,
    hex_to_rgb,
    mesh_objects,
    select_only,
)


def _set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def ensure_mesh_uvs(obj):
    mesh = getattr(obj, "data", None)
    if not mesh or not getattr(mesh, "loops", None):
        return
    uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    verts = mesh.vertices
    if not verts:
        return
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    min_x, span_x = min(xs), max(max(xs) - min(xs), 1e-4)
    min_y, span_y = min(ys), max(max(ys) - min(ys), 1e-4)
    min_z, span_z = min(zs), max(max(zs) - min(zs), 1e-4)
    uv_data = uv_layer.data
    for poly in mesh.polygons:
        nx, ny, nz = abs(poly.normal.x), abs(poly.normal.y), abs(poly.normal.z)
        for loop_idx in poly.loop_indices:
            co = verts[mesh.loops[loop_idx].vertex_index].co
            if nz >= nx and nz >= ny:
                u, v = (co.x - min_x) / span_x, (co.y - min_y) / span_y
            elif nx >= ny:
                u, v = (co.y - min_y) / span_y, (co.z - min_z) / span_z
            else:
                u, v = (co.x - min_x) / span_x, (co.z - min_z) / span_z
            uv_data[loop_idx].uv = (u, v)


def build_material_base_color_texture(bpy, mat_index, spec, tex_dir, size=128):
    if not tex_dir:
        return None
    os.makedirs(tex_dir, exist_ok=True)
    tex_name = f"material_{mat_index}_baseColor"
    img_path = os.path.join(tex_dir, f"{tex_name}.png")
    base = hex_to_rgb(spec.get("color", "#b4b4b4"))
    em = hex_to_rgb(spec["emissive"]) if spec.get("emissive") else None
    rough = float(spec.get("roughness", 0.5))
    metal = float(spec.get("metalness", 0.0))
    img = bpy.data.images.new(tex_name, width=size, height=size, alpha=True)
    pixels = [1.0] * (size * size * 4)
    inv = 1.0 / float(max(size - 1, 1))
    for y in range(size):
        vy = y * inv
        v_grad = 0.88 + 0.20 * vy
        edge_y = 0.92 if (y < 3 or y >= size - 3) else 1.0
        row_offset = y * size * 4
        for x in range(size):
            vx = x * inv
            edge = 0.90 if (x < 3 or x >= size - 3) else edge_y
            grain = 1.0 + (0.04 * (1.0 - rough) + 0.03 * metal) * math.sin(
                vx * 18.8495
            ) * math.cos(vy * 18.8495)
            shade = v_grad * edge * grain
            r = min(1.0, max(0.0, base[0] * shade))
            g = min(1.0, max(0.0, base[1] * shade))
            b = min(1.0, max(0.0, base[2] * shade))
            if em:
                glow = 0.25 * (
                    0.5 + 0.5 * math.sin(vx * 12.566) * math.sin(vy * 12.566)
                )
                r = min(1.0, r * (1.0 - glow) + em[0] * glow)
                g = min(1.0, g * (1.0 - glow) + em[1] * glow)
                b = min(1.0, b * (1.0 - glow) + em[2] * glow)
            idx = row_offset + x * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
    img.pixels[:] = pixels
    img.filepath_raw = img_path
    img.file_format = "PNG"
    try:
        img.save()
    except RuntimeError as exc:
        sys.stderr.write(
            f"[blender_worker_compute] Failed to save texture image {img_path}: {exc}\n"
        )
        raise
    return img


def build_principled_material(bpy, mat, spec, fur, mat_index=None, tex_dir=None):
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
    if mat_index is not None and tex_dir:
        img = build_material_base_color_texture(bpy, mat_index, spec, tex_dir)
        if img is not None:
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
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
