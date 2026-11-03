# Enterprise PBR Physical Material Standards

## Zero Roblox Policy
Yamanaka strictly prohibits blocky R6 rigs, primitive cubes without bevels, and flat-color PBR clamps (`metalness <= 0.25`, `roughness 0.55..0.75`).

## Material Physics Contract (`MeshPhysicalMaterial`)
- **Metallic Range**: `[0.0, 1.0]` (Dielectric to Pure Metal).
- **Roughness Range**: `[0.02, 0.96]` (Polished Chrome / Glass to Matte Anodized Aluminum).
- **Clearcoat**: `0.0..1.0` for premium automotive, carbon fiber, and glossy lacquer finishes.
- **Transmission**: `0.0..0.98` with `ior: 1.5` for optics, glass, and holographic displays.
- **Micro-Chamfer Bevels**: All structural edges feature weighted normals and 2-3 segment chamfers.

## 11-Row `scoreSpec` Evaluation Matrix
1. `watertight_manifold`: Non-manifold edge count = 0 (CSG boolean verified).
2. `bounding_box_grounded`: Model base grounded at `y >= -0.01` (never floating or clipping).
3. `pbr_roughness_distribution`: Varied roughness across parts (`std_dev >= 0.08`).
4. `pbr_metallic_differentiation`: Clear distinction between conductive and dielectric elements.
5. `micro_chamfer_normals`: Weighted normal computation applied.
6. `uv_island_non_overlapping`: Smart UV projection with minimum 2% margin.
7. `hierarchy_depth`: Semantic compound hierarchy (base, chassis, accent, optics).
8. `part_count_integrity`: At least 6 distinct semantic parts per asset.
9. `triangle_density`: Polycount within target budget (`2000..50000` triangles).
10. `material_node_cleanliness`: Standard PBR texture channels (baseColor, metallicRoughness, normal, emissive).
11. `shadow_casting_integrity`: Shadow-casting enabled on structural geometry.
