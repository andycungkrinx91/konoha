# Yamanaka Generative 3D Subsystem — Master Rebuild & Preservation PRD
## Deterministic Foundation + Blender DCC-MCP Refinement + LangGraph.js + Zero-Duplicate Database

**Document Type:** Discovery-First Master Rebuild & Preservation Specification  
**Repository:** `https://github.com/andycungkrinx91/konoha/`  
**Project:** Konoha  
**Subsystem:** Yamanaka Generative 3D  
**Baseline:** Konoha v2.2.17 (Verify exact repository commit hash before planning)  
**Orchestration Framework:** `@langchain/langgraph` (LangGraph.js `StateGraph` + `Annotation.Root`)  
**Intended Planner:** Gemini Argon (`Genin` Discovery -> `Sannin` Orchestration -> `Yamanaka` 3D -> `Anbu` QA Gate)  
**Primary Objective:** Complete architectural rebuild of the Yamanaka 3D subsystem after exhaustive manual source-code, database, and legacy audit—eliminating duplicate functions, aliases, and shadow schemas while **strictly preserving** the 6 deterministic 3D foundation components and layering `dcc-mcp-blender` as a high-fidelity refinement and production backend.

---

# 0. CRITICAL INSTRUCTIONS & ARCHITECTURAL RECONCILIATION

This specification reconciles and unifies the complete subsystem rebuild requirements with the mandatory preservation of Konoha's deterministic 3D foundation.

## 0.1 Mandatory Preservation of the Deterministic 3D Foundation
**DO NOT REMOVE THE EXISTING DETERMINISTIC 3D FOUNDATION.**  
"Rebuild from zero" applies to eliminating legacy wrappers, duplicate functions, dead aliases, fragmented output paths, and unverified schema objects. It is **NOT** permission to discard the deterministic procedural foundation.

Yamanaka **must preserve, audit, and clean in-place** these 6 mandatory components without duplicating them, replacing them, renaming them into aliases, or creating parallel implementations:
1. **`scoreSpec` Validation Engine:** Retaining all **11 measurable validation rows** (executed both Pre-Blender and Post-Blender).
2. **All 16 Domain Archetypes:** Canonical procedural domain synthesis templates.
3. **Unique Nonce Identity & Cache Isolation:** Cryptographic/deterministic per-job nonce isolating staging, cache, and final artifacts.
4. **Manifold-3D WASM Kernel:** Exact CSG Boolean geometry kernel guaranteeing watertight 2-manifold base geometry.
5. **Three.js r187 Engine:** Procedural base-model generation **and** interactive browser 3D viewport rendering.
6. **Canonical Mini-DSL Generation:** The single internal generation contract.

## 0.2 Canonical End-to-End Execution Pipeline
All 3D generation requests must follow this single, deterministic-first, Blender-refined architecture:

```text
User Request (Generator UI: Text-to-3D | Image-to-3D)
  │
  ▼
Sannin Orchestration
  │
  ▼
Yamanaka LangGraph.js Workflow (@langchain/langgraph)
  │
  ▼
Model Synthesis (via 9router — strictly in synthesis layer)
  │
  ▼
Canonical Mini-DSL + Unique Nonce Identity
  │
  ▼
16 Domain Archetypes + Three.js r187 + Manifold-3D WASM CSG
  │
  ▼
Deterministic Raw Base Model (raw_base.glb)
  │
  ▼
Temporary Staging (~/.konoha/3d-output/.staging/<job-id>_<nonce>/)
  │
  ▼
Pre-Blender Validation (scoreSpec 11-Row Gate on raw_base.glb)
  │
  ▼
Blender / DCC-MCP Refinement (Modifiers, Bevel, UV, PBR Shaders, Studio Lighting/Camera)
  │  *(Refines raw_base.glb; NEVER regenerates from scratch without explicit reason)*
  ▼
Post-Blender Validation (scoreSpec 11-Row Gate + Topology/Export Verification)
  │
  ▼
Final Export (model.glb + Studio preview.png + thumbnail.webp)
  │
  ▼
File Integrity Verification (SHA256 + Byte Size > 0)
  │
  ▼
Permanent Output Registry Commit (SQLite IMMEDIATE Transaction + Atomic File Promotion)
  │
  ▼
Temporary Staging Artifact Cleanup
```

## 0.3 Non-Negotiable Planner Rules
1. Inspect existing source code manually and deeply before proposing architecture.
2. **Always check the database schema first before applying any DDL or migration** (Enforce the 3-Gate Check-Before-Apply Protocol in Section 10).
3. Identify all duplicate functions, overlapping geometry engines, and redundant MCP adapters.
4. Identify all callers and dependencies (static imports, dynamic imports, LangGraph node registrations, runtime registries) before proposing deletion.
5. Do **not** create aliases (`oldName -> newName` wrappers) to preserve obsolete interfaces.
6. Do **not** create a second implementation of an existing capability or a parallel asset registry.
7. Do **not** modify unrelated Konoha workflows.
8. Do **not** change the existing `Sannin` orchestration architecture without evidence and approval.
9. Do **not** move `9router` to the request-ingestion layer (`9router` belongs strictly in model synthesis).
10. Do **not** start coding or installing software during the planning phase.
11. Every proposed implementation TODO must be traceable to actual repository findings.

---

# 1. PRODUCT VISION

Rebuild Yamanaka as a standalone, fully integrated generative 3D workspace inside Konoha that combines deterministic CSG geometric reliability with studio-grade Blender refinement:

- **Text-to-3D** and **Image-to-3D** generation modes.
- Deterministic procedural base geometry via **16 Domain Archetypes + Three.js r187 + Manifold-3D WASM CSG**.
- High-fidelity refinement, UV unwrapping, PBR texturing, and studio rendering via **`dcc-mcp-blender`**.
- Interactive **Three.js r187 3D viewport** with orbit, pan, zoom, reset camera, and material inspection.
- Downloadable studio preview images (`preview.png`) and portable 3D assets (`model.glb` + verified formats).
- Selectable profiles: **Realistic / High Fidelity**, **Stylized**, **Roblox / Chunky** (isolated legacy-inspired profile), and **Draft / Preview**.
- Stage-aware **Auto / CPU / GPU** compute selection with transparent hardware detection and zero silent fallback from explicit GPU mode.
- Cross-platform **`dcc-mcp-blender` auto-installer** (`Linux`, `Windows`, `macOS`).
- Consolidated output storage under `~/.konoha/3d-output/`.
- Zero-duplicate, pre-verified SQLite schema with full provenance (`nonce`, `dsl_version`, `domain_archetype`, `scoreSpec` 11 rows).

---

# 2. TARGET USER EXPERIENCE & GENERATOR UI

## 2.1 Dedicated Generator Page
Inspect existing Konoha routing, navigation, UI framework, and design tokens before proposing the exact route. The generator page must expose:

### A. Explicit Generator Mode Selector
Two explicit modes (never combined into one ambiguous prompt field):
1. **Text to 3D:** Prompt input, optional negative prompt (where backend supports), Generation Profile, Quality Preset, Compute Mode, collapsible Advanced Settings.
2. **Image to 3D:** Image upload (`PNG`, `JPG/JPEG`, `WEBP`; optional `SVG` via explicit vector-to-geometry branch if validated), image preview, MIME/magic-byte validation, optional text guidance, Generation Profile, Quality Preset, Compute Mode, collapsible Advanced Settings.

### B. Generation Profiles (Decoupling Global Roblox Constraints)
1. **Realistic / High Fidelity:** Unconstrained natural proportions, full bevel/subdivision refinement, PBR shader graphs.
2. **Stylized:** Clean bevels, stylized PBR roughness/color ramps, studio rim lighting.
3. **Roblox / Chunky:** Optional legacy-inspired profile. **CRITICAL:** Roblox-specific blocky proportions, palette restrictions, and part-count caps must be isolated strictly to this profile and purged from global defaults.
4. **Draft / Preview:** Fast deterministic base generation (`Three.js r187 + Manifold CSG`) with minimal refinement overhead for rapid iteration.

### C. Stage-Aware Compute Mode Selector (`Auto` | `CPU` | `GPU`)
The UI must display:
- Requested compute mode (`Auto`, `CPU`, `GPU`);
- Detected hardware (`NVIDIA CUDA`, `NVIDIA OptiX`, `AMD HIP`, `Apple Metal`, `Intel oneAPI`, `CPU`);
- Effective compute mode per pipeline stage (Deterministic WASM/CPU Base vs. Blender Refinement/Rendering vs. Image Processing);
- Fallback reason if applicable.
- **Strict GPU Rule:** Explicit `GPU` selection must **never** silently fall back to `CPU`. If compatible GPU hardware is unavailable or runs out of VRAM, halt and require explicit user confirmation before falling back to CPU.

### D. Quality Selection & Collapsible Advanced Settings
- **Quality Presets:** `Draft`, `Standard`, `High`, `Ultra` (governing polygon budget, render resolution, render samples, denoising, texture resolution, and time budget).
- **Advanced Settings (Collapsed by default):** Expose only genuinely implemented parameters (polygon budget, render resolution, render engine `Cycles`/`EEVEE`, sample count, denoising, output formats).

---

# 3. LANGGRAPH.JS (`@langchain/langgraph`) WORKFLOW & JOB LIFECYCLE

Reuse and refine Konoha's existing `@langchain/langgraph` orchestration rather than introducing a parallel workflow runner.

## 3.1 Canonical Job Lifecycle States
- `queued`
- `preparing`
- `generating_dsl`
- `building_base_geometry`
- `validating_pre_blender`
- `refining_blender`
- `validating_post_blender`
- `rendering_preview`
- `exporting`
- `completed`
- `failed`
- `cancelled`

*Progress UI must reflect actual stage transitions and verified backend events—never fabricated percentage bars.*

## 3.2 Typed `StateGraph` Architecture (`@langchain/langgraph`)

```typescript
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';

export interface ScoreSpecRow {
  rowId: number; // 1..11 mandatory measurable validation rows
  metricName: string;
  measuredValue: number;
  threshold: number;
  passed: boolean;
}

export const Yamanaka3DStateAnnotation = Annotation.Root({
  jobId: Annotation<string>(),
  nonce: Annotation<string>(), // PRD2 #3: Unique nonce identity & cache isolation
  sourceMode: Annotation<'text_to_3d' | 'image_to_3d'>(),
  prompt: Annotation<string | null>(),
  inputImageRelPath: Annotation<string | null>(),
  profile: Annotation<'realistic' | 'stylized' | 'roblox_chunky' | 'draft'>(),
  qualityPreset: Annotation<'draft' | 'standard' | 'high' | 'ultra'>(),
  requestedCompute: Annotation<'auto' | 'cpu' | 'gpu'>(),
  effectiveCompute: Annotation<'cpu' | 'cuda' | 'optix' | 'hip' | 'metal' | 'oneapi' | null>(),

  // PRD2 #2 & #6: Canonical DSL + 16 Domain Archetypes
  dslVersion: Annotation<string>(),
  domainArchetype: Annotation<string>(), // Strictly 1 of 16 preserved Domain Archetypes
  canonicalDslJson: Annotation<string | null>(),

  // PRD2 #4 & #5: Three.js r187 + Manifold-3D WASM Base Artifacts in .staging/
  stagingRelDir: Annotation<string>(),
  rawBaseGlbRelPath: Annotation<string | null>(),
  rawBaseSha256: Annotation<string | null>(),

  // PRD2 #1: 11-Row scoreSpec Pre- and Post-Blender Validation Summaries
  preBlenderScoreSpec: Annotation<{ passed: boolean; totalScore: number; rows: ScoreSpecRow[] } | null>(),
  postBlenderScoreSpec: Annotation<{ passed: boolean; totalScore: number; rows: ScoreSpecRow[] } | null>(),

  // Final Promoted Deliverables (~/.konoha/3d-output/assets/<asset-id>/)
  assetId: Annotation<string | null>(),
  finalGlbRelPath: Annotation<string | null>(),
  previewPngRelPath: Annotation<string | null>(),
  filesVerifiedAndCommitted: Annotation<boolean>(),
  stagingCleanedUp: Annotation<boolean>(),

  // Bounded Retry & Error Tracking
  repairAttempts: Annotation<number>({ reducer: (_curr, upd) => upd, default: () => 0 }),
  maxRepairBudget: Annotation<number>({ reducer: (_curr, upd) => upd, default: () => 2 }),
  errorStage: Annotation<string | null>(),
  errorMessage: Annotation<string | null>(),
});
```

## 3.3 Token & Context Efficiency Rules
- Keep `Yamanaka3DStateAnnotation` bounded: store relative file paths, SHA256 hashes, and compact 11-row `scoreSpec` summaries—never raw binary GLB buffers or full Blender scene dumps.
- Load `dcc-mcp-blender` tools progressively using task-specific allowlists.
- Use deterministic code for deterministic geometry and validation operations; the LLM synthesizes intent into the Canonical Mini-DSL rather than micromanaging mesh vertices via hundreds of tool calls.

---

# 4. REAL 3D VIEWPORT & ARTIFACT CONSISTENCY

## 4.1 Three.js r187 Interactive Viewport
Reuse the existing **Three.js r187** engine to provide an interactive 3D viewport supporting:
- Orbit, Pan, Zoom, Reset Camera, and Fit-to-Viewport;
- Complete generated geometry and PBR material inspection;
- Wireframe/shaded inspection toggle;
- Explicit Loading, Empty, and Error states.

## 4.2 Downloadable Studio Preview & Artifact Identity Invariant
- Render a downloadable `preview.png` with consistent camera framing, neutral studio lighting, and transparent background (where supported).
- **Mandatory Identity Invariant:** The interactive 3D preview, downloadable `preview.png`, downloadable `model.glb`, any secondary exports (`glTF`, `OBJ`, `STL`), and the SQLite `assets` record must all derive from the exact same generation and share the same `asset_id`, `job_id`, and `nonce`.

---

# 5. CONSOLIDATED STORAGE & TEMPORARY STAGING LIFECYCLE

All generated files must live under `~/.konoha/3d-output/`. All competing legacy output directories must be audited, migrated, and removed.

```text
~/.konoha/
└── 3d-output/
    ├── assets/
    │   └── <asset-id>/
    │       ├── model.glb            # Canonical primary 3D asset
    │       ├── model.gltf           # Optional verified export
    │       ├── model.obj            # Optional verified export
    │       ├── model.stl            # Optional verified export
    │       ├── preview.png          # Studio rendered preview image
    │       ├── thumbnail.webp       # UI gallery thumbnail
    │       ├── metadata.json        # Full provenance (job_id, nonce, dsl_version, archetype, blender_version)
    │       └── validation.json      # Pre- and Post-Blender 11-row scoreSpec evidence
    │
    ├── jobs/
    │   └── <job-id>/
    │       ├── input/               # Validated input reference image (for Image-to-3D)
    │       ├── logs/                # Execution & MCP telemetry logs
    │       └── job.json             # Recoverable job state snapshot
    │
    └── .staging/
        └── <job-id>_<nonce>/
            ├── source.dsl.json      # Canonical Mini-DSL source
            ├── raw_base.glb         # Deterministic Three.js r187 + Manifold-3D WASM base model
            ├── pre_validation.json  # Initial Pre-Blender 11-row scoreSpec validation evidence
            └── intermediate/        # Working Blender refinement files
```

## 5.1 Mandatory Temporary Staging Retention & Cleanup Invariant (PRD2)
The raw deterministic base model (`raw_base.glb`) must exist on disk before Blender processing begins. Temporary staging artifacts in `~/.konoha/3d-output/.staging/<job-id>_<nonce>/` **may only be deleted** after all 5 conditions succeed:
1. Blender (`dcc-mcp-blender`) refinement succeeds.
2. Post-Blender 11-row `scoreSpec` validation succeeds.
3. Final `model.glb` and `preview.png` are written to disk.
4. File integrity (`byte_size > 0` and `SHA256` checksum) is verified on disk.
5. Permanent SQLite asset registry `IMMEDIATE` transaction commits successfully.

*On failure or crash, preserve recoverable staging data in `.staging/<job-id>_<nonce>/` according to the job recovery policy.*

---

# 6. BLENDER (`dcc-mcp-blender`) INTEGRATION & AUTO-INSTALLER

## 6.1 Refinement Backend Responsibilities
Use `https://github.com/dcc-mcp/dcc-mcp-blender` (pinned upstream release) as the post-base refinement and production backend.
- **Input:** Receives the validated deterministic `raw_base.glb` and Canonical Mini-DSL refinement parameters.
- **Operations:** Mesh refinement, modifiers, bevels, smooth shading, normal recalculation, UV unwrapping/packing, PBR shader assignment, studio lighting/camera rigging, preview rendering, and final GLB/format export.
- **Security:** Prefer typed MCP operations. Disable arbitrary unrestricted LLM-generated Python execution in production. Normalize timeouts, cancellations, and server restarts cleanly through Konoha's MCP client manager.

## 6.2 Cross-Platform Auto-Installer (`Linux`, `Windows`, `macOS`)
- **Non-Invasive Contract:** Installs `dcc-mcp-blender` into an existing compatible Blender installation. Never silently installs the Blender application itself, GPU drivers, or external neural weights.
- **12-Step Installation Workflow:**
  1. Detect Blender executable(s), version, and embedded Python version (allow custom executable path).
  2. Inspect compatibility against the pinned `dcc-mcp-blender` release.
  3. Resolve pinned upstream release metadata.
  4. Display installation plan to user.
  5. Request explicit user approval.
  6. Download upstream artifact into staging.
  7. Verify artifact `SHA256` checksum/signature.
  8. Install using documented upstream method with archive path-traversal protection.
  9. Enable/register extension in isolated Konoha-managed scope.
  10. Verify headless Blender startup.
  11. Verify MCP connectivity and tool discovery handshake.
  12. Report verified status.
- **Management Commands:** Idempotent `install`, `verify`, `status`, `repair`, `update`, and `uninstall` (removing only Konoha-managed integration files, never user `.blend` projects or unrelated extensions).

---

# 7. ZERO-DUPLICATE DATABASE DESIGN & "CHECK-BEFORE-APPLY" PROTOCOL

To guarantee that the database **never** duplicates schemas, tables, columns, or aliases, all database operations are governed by a mandatory **3-Gate Check-Before-Apply Protocol**.

## 7.1 Gate 1: Mandatory Read-Only Pre-Check Audit SQL (Run Before Planning/Migration)
Before creating or altering any database structure, execute this read-only audit against Konoha's existing SQLite database(s) and search all code references to every existing table and column:

```sql
-- ============================================================================
-- GATE 1: READ-ONLY PRE-CHECK AUDIT SCRIPT
-- Always execute this query BEFORE writing or applying any migration.
-- ============================================================================

-- 1. Inspect all existing tables, views, indexes, and triggers
SELECT 
    type, 
    name AS object_name, 
    tbl_name AS attached_table, 
    sql AS ddl_definition
FROM sqlite_master
WHERE type IN ('table', 'view', 'index', 'trigger')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;

-- 2. Inspect all columns across candidate 3D / job / asset tables for semantic duplicates
SELECT 
    m.name AS table_name,
    p.cid AS col_index,
    p.name AS column_name,
    p.type AS data_type,
    p."notnull" AS is_not_null,
    p.dflt_value AS default_value,
    p.pk AS is_primary_key
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
  AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid;

-- 3. Verify existing Foreign Key integrity and database health
PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

## 7.2 Canonical Zero-Duplicate SQLite DDL (`STRICT` Mode)
One canonical migration ledger, one canonical job table, one canonical asset table, one canonical file table, and one canonical validation table. Zero alias tables, zero compatibility views, and full provenance for the 6 deterministic foundation components.

```sql
-- ============================================================================
-- KONOHA v2.2.17 — YAMANAKA 3D CANONICAL ZERO-DUPLICATE SQLITE SCHEMA
-- File: migrations/20261103_001_yamanaka_3d_canonical.sql
-- ============================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- 0. SCHEMA MIGRATIONS LEDGER (Check-Before-Apply Gatekeeper)
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id            TEXT PRIMARY KEY,
    checksum_sha256         TEXT NOT NULL,
    applied_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    execution_ms            INTEGER NOT NULL CHECK (execution_ms >= 0)
) STRICT;

-- 1. GENERATION JOBS (Canonical Lifecycle + Deterministic Base Provenance)
CREATE TABLE IF NOT EXISTS generation_jobs (
    job_id                  TEXT PRIMARY KEY,         -- UUIDv7 (Also LangGraph thread_id)
    nonce                   TEXT NOT NULL UNIQUE,     -- PRD2 Mandatory: Unique nonce & cache isolation
    source_mode             TEXT NOT NULL CHECK (source_mode IN ('text_to_3d', 'image_to_3d')),
    status                  TEXT NOT NULL CHECK (status IN (
                                'queued',
                                'preparing',
                                'generating_dsl',
                                'building_base_geometry',
                                'validating_pre_blender',
                                'refining_blender',
                                'validating_post_blender',
                                'rendering_preview',
                                'exporting',
                                'completed',
                                'failed',
                                'cancelled'
                            )),
    -- User Inputs
    prompt                  TEXT,
    negative_prompt         TEXT,
    input_image_rel_path    TEXT,
    input_image_sha256      TEXT,
    
    -- Profile, Quality & Stage-Aware Compute Selection
    profile                 TEXT NOT NULL CHECK (profile IN ('realistic', 'stylized', 'roblox_chunky', 'draft')),
    quality_preset          TEXT NOT NULL CHECK (quality_preset IN ('draft', 'standard', 'high', 'ultra')),
    requested_compute_mode  TEXT NOT NULL CHECK (requested_compute_mode IN ('auto', 'cpu', 'gpu')),
    effective_compute_mode  TEXT CHECK (effective_compute_mode IN ('cpu', 'cuda', 'optix', 'hip', 'metal', 'oneapi')),
    compute_fallback_reason TEXT,
    
    -- PRD2 Mandatory: Preserved Deterministic 3D Foundation Provenance
    dsl_version             TEXT NOT NULL,
    dsl_payload_json        TEXT NOT NULL CHECK (json_valid(dsl_payload_json)),
    domain_archetype        TEXT NOT NULL,            -- Must be 1 of the 16 preserved Domain Archetypes
    manifold_kernel_version TEXT NOT NULL,            -- Manifold-3D WASM exact CSG kernel version
    threejs_version         TEXT NOT NULL DEFAULT 'r187',
    raw_base_glb_sha256     TEXT,                     -- SHA256 of deterministic raw_base.glb in .staging/
    
    -- Blender / DCC-MCP Refinement Provenance
    refinement_backend      TEXT NOT NULL CHECK (refinement_backend IN ('dcc_mcp_blender', 'deterministic_only')),
    blender_version         TEXT,
    dcc_mcp_version         TEXT,
    
    -- Temporary Staging Lifecycle (~/.konoha/3d-output/.staging/<job_id>_<nonce>/)
    staging_rel_dir         TEXT NOT NULL UNIQUE,
    staging_cleaned         INTEGER NOT NULL DEFAULT 0 CHECK (staging_cleaned IN (0, 1)),
    
    -- Error & Recovery Diagnostics
    repair_attempts         INTEGER NOT NULL DEFAULT 0 CHECK (repair_attempts >= 0),
    error_stage             TEXT,
    error_code              TEXT,
    error_message           TEXT,
    
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at              TEXT,
    completed_at            TEXT,

    CHECK (
        (source_mode = 'text_to_3d' AND prompt IS NOT NULL AND length(trim(prompt)) > 0) OR
        (source_mode = 'image_to_3d' AND input_image_rel_path IS NOT NULL AND input_image_sha256 IS NOT NULL)
    )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_created ON generation_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_archetype ON generation_jobs(domain_archetype);

-- 2. ASSETS (Canonical Promoted 3D Asset Registry — 1-to-1 with Completed Job)
CREATE TABLE IF NOT EXISTS assets (
    asset_id                TEXT PRIMARY KEY,
    job_id                  TEXT NOT NULL UNIQUE,
    nonce                   TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    source_mode             TEXT NOT NULL CHECK (source_mode IN ('text_to_3d', 'image_to_3d')),
    profile                 TEXT NOT NULL CHECK (profile IN ('realistic', 'stylized', 'roblox_chunky', 'draft')),
    quality_preset          TEXT NOT NULL CHECK (quality_preset IN ('draft', 'standard', 'high', 'ultra')),
    domain_archetype        TEXT NOT NULL,
    dsl_version             TEXT NOT NULL,
    refinement_backend      TEXT NOT NULL,
    blender_version         TEXT,
    effective_compute_mode  TEXT NOT NULL,
    
    -- Verified Geometry & Topology Metrics
    vertex_count            INTEGER NOT NULL CHECK (vertex_count > 0),
    triangle_count          INTEGER NOT NULL CHECK (triangle_count > 0),
    is_watertight_manifold  INTEGER NOT NULL CHECK (is_watertight_manifold IN (0, 1)),
    pre_blender_score       REAL NOT NULL,
    post_blender_score      REAL NOT NULL,
    
    asset_status            TEXT NOT NULL DEFAULT 'ready' CHECK (asset_status IN ('ready', 'missing_files', 'archived')),
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_profile_archetype ON assets(profile, domain_archetype);

-- 3. ASSET FILES (Deduplicated File Manifest under ~/.konoha/3d-output/assets/<asset_id>/)
CREATE TABLE IF NOT EXISTS asset_files (
    file_id                 TEXT PRIMARY KEY,
    asset_id                TEXT NOT NULL,
    file_role               TEXT NOT NULL CHECK (file_role IN (
                                'primary_glb',
                                'preview_png',
                                'thumbnail_webp',
                                'export_gltf',
                                'export_obj',
                                'export_stl',
                                'metadata_json',
                                'validation_json'
                            )),
    rel_path                TEXT NOT NULL UNIQUE,
    mime_type               TEXT NOT NULL,
    byte_size               INTEGER NOT NULL CHECK (byte_size > 0),
    sha256                  TEXT NOT NULL,
    width_px                INTEGER,
    height_px               INTEGER,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    UNIQUE (asset_id, file_role),
    FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_asset_files_asset_id ON asset_files(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_sha256 ON asset_files(sha256);

-- 4. VALIDATION RESULTS (PRD2 Mandatory: Pre-Blender & Post-Blender 11-Row scoreSpec)
CREATE TABLE IF NOT EXISTS validation_results (
    validation_id           TEXT PRIMARY KEY,
    job_id                  TEXT NOT NULL,
    asset_id                TEXT,
    validation_stage        TEXT NOT NULL CHECK (validation_stage IN ('pre_blender_base', 'post_blender_final')),
    validator_name          TEXT NOT NULL DEFAULT 'scoreSpec',
    validator_version       TEXT NOT NULL,
    attempt_number          INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    passed                  INTEGER NOT NULL CHECK (passed IN (0, 1)),
    overall_score           REAL NOT NULL,
    
    -- Structured JSON containing all 11 measurable validation rows
    score_spec_11_rows_json TEXT NOT NULL CHECK (json_valid(score_spec_11_rows_json)),
    manifold_status         TEXT NOT NULL,
    non_manifold_edges      INTEGER NOT NULL DEFAULT 0,
    report_rel_path         TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    UNIQUE (job_id, validation_stage, attempt_number),
    FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_validation_results_job_stage ON validation_results(job_id, validation_stage);
```

## 7.3 Gate 2 & Gate 3: Runtime "Check-Before-Apply" Migration & Promotion Guard
Every schema migration and asset promotion must execute this pre-flight verification first:

```typescript
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const CANONICAL_TABLES = new Set([
  'schema_migrations',
  'generation_jobs',
  'assets',
  'asset_files',
  'validation_results',
]);

// Any legacy or alias table discovered in Phase C must be listed here so it can never coexist
const FORBIDDEN_LEGACY_PATTERNS = [
  /^yamanaka_models_old$/i,
  /^three_assets_v1$/i,
  /^mesh_cache_alias$/i,
  /^roblox_models$/i,
  /^assets_backup_v/i,
];

export function verifyAndApplyCanonicalSchema(
  db: Database.Database,
  migrationId: string,
  canonicalDdlSql: string
) {
  const checksum = crypto.createHash('sha256').update(canonicalDdlSql).digest('hex');

  const tx = db.transaction(() => {
    // 1. Ensure migration ledger exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0)
      ) STRICT;
    `);

    // 2. Inspect sqlite_master BEFORE applying anything
    const masterRows = db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string; type: string }>;

    const existingTables = masterRows.map((r) => r.name);

    // 3. Block immediately if unmigrated legacy/alias tables exist
    const legacyCollisions = existingTables.filter((name) =>
      FORBIDDEN_LEGACY_PATTERNS.some((regex) => regex.test(name))
    );

    if (legacyCollisions.length > 0) {
      throw new Error(
        `[CHECK-BEFORE-APPLY BLOCKED] Legacy or alias tables detected: [${legacyCollisions.join(', ')}]. ` +
          `Execute Phase C data migration & legacy cleanup before applying ${migrationId}.`
      );
    }

    // 4. Check if migrationId was already applied
    const appliedRow = db
      .prepare('SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = ?')
      .get(migrationId) as { checksum_sha256: string } | undefined;

    if (appliedRow) {
      if (appliedRow.checksum_sha256 !== checksum) {
        throw new Error(
          `[SCHEMA DRIFT ERROR] Migration ${migrationId} checksum mismatch! ` +
            `DB has ${appliedRow.checksum_sha256}, script has ${checksum}.`
        );
      }
      return { alreadyApplied: true, existingTables };
    }

    // 5. Apply Canonical DDL
    const startMs = Date.now();
    db.exec(canonicalDdlSql);
    const executionMs = Date.now() - startMs;

    // 6. Verify Foreign Keys & Database Integrity before committing
    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations.length > 0) {
      throw new Error(`[FK CHECK FAILED] ${JSON.stringify(fkViolations)}`);
    }

    const integrityRow = db.pragma('integrity_check', { simple: true }) as string;
    if (integrityRow !== 'ok') {
      throw new Error(`[INTEGRITY CHECK FAILED] ${integrityRow}`);
    }

    // 7. Record verified migration in ledger
    db.prepare(
      'INSERT INTO schema_migrations (migration_id, checksum_sha256, execution_ms) VALUES (?, ?, ?)'
    ).run(migrationId, checksum, executionMs);

    return { alreadyApplied: false, existingTables: [...new Set([...existingTables, ...CANONICAL_TABLES])] };
  });

  return tx.immediate();
}
```

---

# 8. COMPLETE LEGACY CLEANUP & DISPOSITION MATRIX

Every audited file, function, route, MCP tool, and database structure must be recorded with:
- Symbol/object name and exact file path;
- Static and dynamic callers (verified via `semble` MCP `search`/`find_related` + manual AST/ripgrep inspection);
- Classification:
  - **`KEEP`**: Canonical and actively used (including the 6 mandatory deterministic foundation components).
  - **`REFACTOR`**: Valid responsibility but requires cleanup (e.g., decoupling global Roblox constraints into profile-scoped rules).
  - **`MERGE`**: Duplicate responsibility to be consolidated into one canonical implementation.
  - **`REPLACE`**: Required capability whose implementation is obsolete.
  - **`REMOVE`**: Stale, unused, duplicated, or dead compatibility wrapper.
  - **`UNKNOWN`**: Insufficient evidence; requires investigation before action.

---

# 9. SECURITY, TESTING & BENCHMARK ACCEPTANCE

## 9.1 Security Controls
- Validate prompt lengths, upload byte limits, image MIME types, and magic bytes.
- Prevent path traversal; restrict all file reads/writes/downloads strictly to `~/.konoha/3d-output/` by asset ID and file role.
- Prohibit arbitrary LLM-generated Blender Python script execution in production.
- Verify pinned `dcc-mcp-blender` release artifacts via `SHA256` checksums before installation.
- Enforce `pnpm audit` with **0 vulnerabilities** (`Anbu` gate).

## 9.2 Verification & Test Matrix
- **Cleanup Regression Tests:** Verify no deleted function/route/table has remaining callers and unrelated Konoha workflows pass.
- **Foundation Preservation Tests:** Verify `scoreSpec` (all 11 rows), all 16 Domain Archetypes, unique nonce isolation, Manifold-3D WASM watertight CSG booleans, Three.js r187 procedural base generation, and Canonical Mini-DSL synthesis.
- **Generator & Pipeline Tests:** Text-to-3D, Image-to-3D, profile switching, explicit GPU unavailable confirmation prompt, MCP disconnect/retry, cancellation, and crash recovery using preserved `.staging/<job-id>_<nonce>/` artifacts.
- **Viewport & Storage Tests:** Three.js r187 GLB load, camera orbit/pan/zoom/reset, `preview.png` and `model.glb` download parity, SHA256 verification, and SQLite/filesystem reconciliation.
- **Installer Tests:** Real platform verification across supported `Linux`, `Windows`, and `macOS` environments (`install`, `verify`, `status`, `repair`, `update`, `uninstall`).

---

# 10. README & THIRD-PARTY ATTRIBUTION

Add the following attribution section to Konoha's `README.md`:

```markdown
### DCC-MCP Blender

Yamanaka's Blender integration uses [`dcc-mcp-blender`](https://github.com/dcc-mcp/dcc-mcp-blender), an open-source Blender MCP integration maintained by the DCC-MCP project.

We thank the DCC-MCP contributors for their work. `dcc-mcp-blender` is an independent upstream project and is not developed or maintained by the Konoha project.

Please refer to the upstream repository for source code, releases, documentation, and licensing information.
```

---

# 11. REQUIRED PLANNER EXECUTION ORDER (PHASE A – PHASE G)

1. **Phase A — Repository Discovery:** Verify Konoha v2.2.17 commit hash; map UI, API, Sannin, Yamanaka LangGraph.js nodes, 9router synthesis, deterministic 3D engines, and database access paths.
2. **Phase B — Manual Legacy & Foundation Audit:** Locate and audit the 6 mandatory deterministic components (`scoreSpec` 11 rows, 16 Domain Archetypes, Nonce isolation, Manifold-3D WASM, Three.js r187, Canonical DSL) and inventory all duplicate functions, aliases, routes, and stale modules.
3. **Phase C — Database Audit (Check-First):** Execute the Gate 1 read-only SQLite audit script, map every existing table/column/migration, and define the data preservation & legacy cleanup strategy.
4. **Phase D — Existing Feature Disposition:** Produce the complete `KEEP / REFACTOR / MERGE / REPLACE / REMOVE / UNKNOWN` table with caller evidence.
5. **Phase E — Target Architecture Lock:** Finalize the single canonical LangGraph.js pipeline, storage layout, and zero-duplicate SQLite schema.
6. **Phase F — Detailed Implementation Plan:** Produce dependency-ordered TODOs with exact verified file paths, symbols, tests, and rollback steps.
7. **Phase G — Owner Approval Gate:** Present the full audit report, schema migration plan, and TODO list. **Stop and wait for explicit owner approval before implementation.**