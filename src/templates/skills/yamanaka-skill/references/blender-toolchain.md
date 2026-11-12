# Blender & DCC-MCP Toolchain Specification

## Runtime Discovery (Zero Hardcoded Versions)
- No Blender or `dcc-mcp-blender` version is pinned in source.
- `findInstalledBlenderBinaries()` scans, in order: `KONOHA_BLENDER_BIN`, `~/.konoha/toolchains/blender/*/blender`,
  macOS `/Applications/Blender.app/Contents/MacOS/Blender`, every `Blender*` folder under the Windows
  `Blender Foundation` program directories, and `which blender` / `where blender`.
- `getBlenderStatus()` parses the real `--version` banner (for example `Blender 5.2.2 LTS` -> semver `5.2.2`)
  and reports `installed: false` honestly when no binary exists.
- When Blender is missing, `installBlender()` reads `https://download.blender.org/release/` at runtime to pick the
  newest release series and archive for the host platform, then verifies the published `.sha256` before extracting
  into `~/.konoha/toolchains/blender/`.

- macOS publishes Blender only as a `.dmg`, which the installer cannot mount. `installBlender()` reports the
  `Manual Install Required` stage and returns `{ success: false, reason: 'manual-install-required' }` instead of
  downloading an archive it cannot unpack; `installAllTools()` turns any returned `success: false` into an
  `errors[]` entry (`{ component, error }`) exactly as it does a thrown error, so `/3d/setup` answers
  `success: false` rather than reporting a toolchain that was never installed.

## dcc-mcp-blender Installation & Verification
- `installDccMcpBlender()` requires a working Blender: with none detected it returns
  `{ success: false, error: 'Blender must be installed first' }` and installs nothing.
- Otherwise it resolves the current release from PyPI (`https://pypi.org/pypi/dcc-mcp-blender/json`)
  unless `KONOHA_DCC_MCP_VERSION` overrides it.
- Installation runs inside the detected Blender binary and targets
  `bpy.utils.user_resource('SCRIPTS', path='addons')/modules`, so it also works when Blender is installed on a
  read-only mount such as the Snap package.
- `getDccMcpStatus()` executes a real `importlib.util.find_spec('dcc_mcp_blender')` +
  `importlib.metadata.version('dcc_mcp_blender')` probe inside Blender and reports the actual version (or
  `Not Ready`), cached for 30 seconds and invalidated after every install.

## Modular Six-Step Live Refinement Worker (< 500 Lines/Module)
The Blender refinement worker is split across three focused Python modules under `src/mcp/three_asset/`:
- `blender_worker_compute.py` — `configure_compute`, `configure_render`, `scene_report`, `build_principled_material`, and `bake_normal_map`. Calls `configure_render` before Step 1 so `compute_mode: "gpu"` activates Cycles GPU (`OPTIX`, `CUDA`, `HIP`, `METAL`, `ONEAPI`) across all steps, falling back to CPU only when no physical GPU device is available.
- `blender_worker_views.py` — `render_preview`, `export_glb`, `step_materials`, `step_studio`, `composite_turnaround`, `render_turnaround_sheet`, `render_inspection_grid`, and `step_export`.
- `blender_live_worker.py` — CLI harness, `apply_spec_patches` (targeted repair-loop mesh/material mutations), and steps 1–3:
  1. `dcc.blender.import_glb` — imports the produced base GLB, applies repair patches if present, grounds the assembly and reports real mesh counts.
  2. `dcc.blender.modify_mesh` — Catmull-Clark subdivision for organic subjects, bevel + weighted normals otherwise.
  3. `dcc.blender.uv_unwrap` — Smart UV Project with island packing and per-object verification.
  4. `dcc.blender.set_materials` — Principled BSDF v2 graphs (base color, sheen, coat, subsurface, emission) plus procedural fur micro-strands when requested.
  5. `dcc.blender.setup_studio` — studio or flat shadowless light rigs, compute device verification and camera framing.
  6. `dcc.blender.export_glb` — production GLB export plus Cycles/EEVEE render; turnaround requests composite four orthographic views (front, side, back, top) into a 16:9 reference sheet.

After every step the worker rewrites `intermediate/live_step.glb` and `intermediate/live_preview.png` and emits a
`KONOHA_BLENDER_STEP {...}` telemetry line containing durations, mesh statistics, compute device, and the real Blender version.

## Execution Modes
- **Headless (default)** — `blender -b --factory-startup -noaudio --python blender_live_worker.py -- --batch <config>`
  runs without stealing window focus while streaming genuine renders to the web UI.
- **Live GUI** — `POST /api/v1/3d/setup/blender/launch` starts
  `blender --python blender_live_worker.py -- --server <queue>`; the visible window polls the queue on the UI thread
  via `bpy.app.timers`, applies each step and switches the viewport to material shading, so refinement can also be
  watched directly inside Blender.

## Single-Instance Singleton
- Tracked via `~/.konoha/blender.lock` (JSON: pid, mode, worker, started_at).
- Prevents duplicate Blender processes; stale locks are cleared automatically when the PID is gone.
