---
name: yamanaka-skill
description: Standard Operating Procedures for autonomous generative 3D model synthesis, Three.js/Manifold geometry construction, live agentic Blender editing, and spatial asset pipelines.
tags:
  - yamanaka
  - 3d
  - mesh
  - gltf
  - glb
  - usdz
  - obj
  - stl
  - ply
  - blender
  - threejs
  - manifold
  - pbr
---

# Yamanaka: Generative 3D & Spatial Subsystem Specialist

This skill provides the **Standard Operating Procedures (SOP)** for the **@yamanaka** specialist agent — specialized in autonomous 3D asset generation, watertight geometry kernel operations (`manifold-3d` + `three`, versions resolved from the installed packages at runtime), live agentic Blender editing (the Blender build detected on the host plus the `dcc-mcp-blender` release verified inside it), and spatial asset promotion.

> Toolchain versions, dcc-mcp-blender releases, LLM providers and model identifiers are **always discovered at
> runtime** (see `references/blender-toolchain.md`). Never pin or hardcode them in prompts, code or configuration.

## Core Tenets & Guardrails

1. **Production Production Grade — Zero Hardcoding**:
   - Never hardcode model names (no `ag/gemini-3.8-flash-high`, `gpt-4o`, `claude-3-5-sonnet` literals), ports, paths, or pricing constants.
   - Dynamically discover models via `src/mcp/three_asset/model_router.js` (`discoverAll3DModels()` and `resolveInherited3DModel()`).

2. **Zero Roblox — Pure Physical Realism**:
   - Eradicate blocky R6 rigs, flat-color PBR clamps (`metalness <= 0.25`, `roughness 0.55..0.75`), and primitive cubes.
   - Use realistic/production `MeshPhysicalMaterial` ranges with micro-chamfer bevels and high-segment curved primitives (`CapsuleGeometry`, `LatheGeometry`, `TubeGeometry`, `ExtrudeGeometry`, `RoundedBoxGeometry`).

3. **Mandatory Watertight Manifold Validation**:
   - Zero self-intersections and zero non-manifold edges.
   - All assets must pass the 11-row `scoreSpec` evaluation with overall score >= 80% before staging promotion.

4. **Hardware-Aware Compute Acceleration**:
   - Auto-detect GPU capabilities (`CUDA`, `OPTIX`, `Metal`, `DirectX`, `Vulkan`, `OpenCL`).
   - Support `Auto | Force GPU | Force CPU` with seamless automatic CPU fallback if physical GPU is missing, avoiding crashes.

5. **Live Agentic 6-Step Blender Refinement**:
   - Auto-start live Blender session on entering `refining_blender` phase.
   - Execute human-like 6-step agentic workflow emitting `blender_agent_action` SSE events.
   - Stream intermediate `.glb` snapshots (`live_step.glb`) to Web UI viewport for real-time hot-reloading.
   - Enforce single-instance singleton process management via lockfile (`~/.konoha/blender.lock`).

6. **LangGraph.js Orchestration & Multi-Layer Circuit Breakers**:
   - Bounded repair loop with `MAX_YAMANAKA_REPAIR_ATTEMPTS = 3`.
   - Independent circuit breakers for LLM synthesis (`yamanaka-llm-synthesis`) and DCC toolchain (`yamanaka-dcc-mcp-blender`).
   - Deterministic token and cost accounting stored in SQLite `llm_requests_3d`.

7. **5-Condition Staging Promotion Lifecycle**:
   - Mandatory verification before promotion: primary GLB exists, preview PNG exists, watertight manifold verified, scoreSpec passing, staging cleaned.

---

## 6-Step Agentic Editing Workflow

```
1. Workspace Import & Hierarchy Analysis     (dcc.blender.import_glb)
2. Weighted Normals & Micro-Chamfer Beveling (dcc.blender.modify_mesh)
3. Smart UV Projection & Island Packing      (dcc.blender.uv_unwrap)
4. Principled BSDF Physical Shader Synthesis (dcc.blender.set_materials)
5. Studio 3-Point Lighting & Camera Framing  (dcc.blender.setup_studio)
6. Final GLB Production Export & Integrity  (dcc.blender.export_glb)
```

## Supported Export Formats
- Primary Binary glTF (`.glb`)
- Apple QuickLook Spatial AR (`.usdz`)
- Wavefront Polygon (`.obj`)
- Stereolithography 3D Print (`.stl`)
- Polygon File Format (`.ply`)
- High-Resolution Studio Preview (`.png`)
