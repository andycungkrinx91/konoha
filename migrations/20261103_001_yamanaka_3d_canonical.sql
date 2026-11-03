-- Yamanaka Generative 3D Subsystem Canonical Schema Migration
-- Migration ID: 20261103_001_yamanaka_3d_canonical
-- Dialect: SQLite 3.37+ STRICT tables

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS generation_jobs (
  job_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('text_to_3d', 'image_to_3d', 'dsl_direct')),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'synthesizing_spec', 'parsing_dsl', 'building_base_mesh',
    'validating_base_mesh', 'refining_blender', 'validating_final_asset',
    'generating_previews', 'promoting_asset', 'completed', 'failed', 'recovering'
  )),
  prompt TEXT,
  negative_prompt TEXT,
  input_image_rel_path TEXT,
  input_image_sha256 TEXT,
  profile TEXT NOT NULL CHECK (profile IN ('enterprise_pbr', 'realistic', 'premium_stylized', 'stylized', 'draft')),
  quality_preset TEXT NOT NULL CHECK (quality_preset IN ('draft', 'standard', 'high', 'ultra')),
  requested_compute_mode TEXT NOT NULL CHECK (requested_compute_mode IN ('auto', 'cpu', 'gpu')),
  effective_compute_mode TEXT NOT NULL CHECK (effective_compute_mode IN ('cpu', 'gpu')),
  compute_fallback_reason TEXT,
  dsl_version TEXT NOT NULL,
  dsl_payload_json TEXT NOT NULL,
  domain_archetype TEXT NOT NULL,
  manifold_kernel_version TEXT,
  threejs_version TEXT,
  raw_base_glb_sha256 TEXT,
  refinement_backend TEXT NOT NULL CHECK (refinement_backend IN ('dcc_mcp_blender', 'deterministic_only')),
  blender_version TEXT,
  dcc_mcp_version TEXT,
  model_used TEXT,
  client_source TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  est_cost_usd REAL NOT NULL DEFAULT 0.0 CHECK (est_cost_usd >= 0.0),
  staging_rel_dir TEXT NOT NULL UNIQUE,
  staging_cleaned INTEGER NOT NULL DEFAULT 0 CHECK (staging_cleaned IN (0, 1)),
  repair_attempts INTEGER NOT NULL DEFAULT 0 CHECK (repair_attempts >= 0),
  error_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_gen_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_created ON generation_jobs(created_at);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('text_to_3d', 'image_to_3d', 'dsl_direct')),
  profile TEXT NOT NULL CHECK (profile IN ('enterprise_pbr', 'realistic', 'premium_stylized', 'stylized', 'draft')),
  quality_preset TEXT NOT NULL CHECK (quality_preset IN ('draft', 'standard', 'high', 'ultra')),
  domain_archetype TEXT NOT NULL,
  dsl_version TEXT NOT NULL,
  refinement_backend TEXT NOT NULL CHECK (refinement_backend IN ('dcc_mcp_blender', 'deterministic_only')),
  blender_version TEXT,
  effective_compute_mode TEXT NOT NULL CHECK (effective_compute_mode IN ('cpu', 'gpu')),
  model_used TEXT,
  vertex_count INTEGER NOT NULL CHECK (vertex_count > 0),
  triangle_count INTEGER NOT NULL CHECK (triangle_count > 0),
  is_watertight_manifold INTEGER NOT NULL CHECK (is_watertight_manifold IN (0, 1)),
  pre_blender_score REAL NOT NULL CHECK (pre_blender_score >= 0.0),
  post_blender_score REAL NOT NULL CHECK (post_blender_score >= 0.0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  est_cost_usd REAL NOT NULL DEFAULT 0.0 CHECK (est_cost_usd >= 0.0),
  asset_status TEXT NOT NULL CHECK (asset_status IN ('ready', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(asset_status);

CREATE TABLE IF NOT EXISTS asset_files (
  file_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  file_role TEXT NOT NULL CHECK (file_role IN (
    'primary_glb', 'preview_png', 'thumbnail_webp',
    'export_gltf', 'export_obj', 'export_stl',
    'metadata_json', 'validation_json'
  )),
  rel_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, file_role),
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_asset_files_asset ON asset_files(asset_id);

CREATE TABLE IF NOT EXISTS validation_results (
  validation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  asset_id TEXT,
  validation_stage TEXT NOT NULL CHECK (validation_stage IN ('pre_blender_base', 'post_blender_final')),
  validator_name TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  overall_score REAL NOT NULL CHECK (overall_score >= 0.0),
  score_spec_11_rows_json TEXT NOT NULL CHECK (json_valid(score_spec_11_rows_json)),
  manifold_status TEXT NOT NULL,
  non_manifold_edges INTEGER NOT NULL DEFAULT 0 CHECK (non_manifold_edges >= 0),
  report_rel_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, validation_stage, attempt_number),
  FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_validation_job ON validation_results(job_id);

CREATE TABLE IF NOT EXISTS llm_requests_3d (
  request_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('dsl_synthesis', 'image_vision', 'blender_agent_step', 'procedural_synthesis')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  client_source TEXT,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
  token_source TEXT NOT NULL CHECK (token_source IN ('provider_usage', 'tokenizer_estimate')),
  est_cost_usd REAL NOT NULL CHECK (est_cost_usd >= 0.0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(job_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_llm_requests_3d_job ON llm_requests_3d(job_id);
CREATE INDEX IF NOT EXISTS idx_llm_requests_3d_created ON llm_requests_3d(created_at);
