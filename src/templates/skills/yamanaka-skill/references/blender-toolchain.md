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

## dcc-mcp-blender Installation & Verification
- `installDccMcpBlender()` resolves the current release from PyPI (`https://pypi.org/pypi/dcc-mcp-blender/json`)
  unless `KONOHA_DCC_MCP_VERSION` overrides it.
- Installation runs inside the detected Blender binary and targets
  `bpy.utils.user_resource('SCRIPTS', path='addons')/modules`, so it also works when Blender is installed on a
  read-only mount such as the Snap package.
- `getDccMcpStatus()` executes a real `importlib.util.find_spec('dcc_mcp_blender')` +
  `importlib.metadata.version('dcc_mcp_blender')` probe inside Blender and reports the actual version (or
  `Not Ready`), cached for 30 seconds and invalidated after every install.

## Six-Step Live Refinement Worker
`src/mcp/three_asset/blender_live_worker.py` runs inside Blender and executes real `bpy` work:

1. `dcc.blender.import_glb` — imports the produced base GLB, grounds the assembly and reports real mesh counts.
2. `dcc.blender.modify_mesh` — Catmull-Clark subdivision for organic subjects, bevel + weighted normals otherwise.
3. `dcc.blender.uv_unwrap` — Smart UV Project with island packing and per-object verification.
4. `dcc.blender.set_materials` — Principled BSDF v2 graphs (base color, sheen, coat, subsurface, emission) plus a
   procedural noise/bump fur micro-strand network when the prompt or spec describes fur.
5. `dcc.blender.setup_studio` — studio or flat shadowless light rigs, compute device selection and camera framing.
6. `dcc.blender.export_glb` — production GLB export plus an EEVEE/Workbench render; turnaround requests composite
   four orthographic views (front, side, back, top) into a 16:9 reference sheet.

After every step the worker rewrites `intermediate/live_step.glb` and `intermediate/live_preview.png` and emits a
`KONOHA_BLENDER_STEP {...}` telemetry line containing durations, mesh statistics and the real Blender version.

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
