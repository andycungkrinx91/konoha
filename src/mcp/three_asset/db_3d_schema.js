'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATION_ID = '20261103_001_yamanaka_3d_canonical';

const CANONICAL_3D_TABLES = Object.freeze([
  'schema_migrations',
  'generation_jobs',
  'assets',
  'asset_files',
  'validation_results',
  'llm_requests_3d'
]);

const FORBIDDEN_LEGACY_PATTERNS = Object.freeze([
  /^(yamanaka_models_old|three_assets_v1|mesh_cache_alias|roblox_models|assets_backup_v.*|model_assets|model_asset_chunks)$/i
]);

/**
 * Gate 1: Read-Only Pre-Check Audit
 */
function runGate1PreCheckAudit(conn) {
  if (!conn || typeof conn.prepare !== 'function') {
    throw new Error('Valid SQLite connection required for Gate 1 Pre-Check Audit');
  }
  const existingTables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const foreignKeyCheck = conn.prepare('PRAGMA foreign_key_check').all();
  const integrityRow = conn.prepare('PRAGMA integrity_check').get();
  const integrityCheck = integrityRow ? (integrityRow.integrity_check || Object.values(integrityRow)[0]) : 'unknown';

  return {
    ok: integrityCheck === 'ok' && foreignKeyCheck.length === 0,
    existingTables,
    foreignKeyCheck,
    integrityCheck
  };
}

/**
 * Cleanly purge any deprecated or legacy 3D schema tables
 */
function purgeLegacy3DTables(conn) {
  if (!conn || typeof conn.prepare !== 'function') return;
  const existingTables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const tbl of existingTables) {
    switch (tbl) {
      case 'yamanaka_models_old':
        conn.exec('DROP TABLE IF EXISTS yamanaka_models_old');
        break;
      case 'three_assets_v1':
        conn.exec('DROP TABLE IF EXISTS three_assets_v1');
        break;
      case 'mesh_cache_alias':
        conn.exec('DROP TABLE IF EXISTS mesh_cache_alias');
        break;
      case 'roblox_models':
        conn.exec('DROP TABLE IF EXISTS roblox_models');
        break;
      case 'model_assets':
        conn.exec('DROP TABLE IF EXISTS model_assets');
        break;
      case 'model_asset_chunks':
        conn.exec('DROP TABLE IF EXISTS model_asset_chunks');
        break;
      default:
        break;
    }
  }
}

const ADDITIVE_COLUMNS = Object.freeze([
  ['assets', 'dcc_mcp_version', 'TEXT']
]);

/**
 * Adds columns introduced after a migration was first applied without mutating
 * the recorded migration checksum. Additive-only and fully idempotent.
 */
function ensureAdditiveColumns(conn) {
  if (!conn || typeof conn.prepare !== 'function') return [];
  const added = [];
  for (const [table, column, ddlType] of ADDITIVE_COLUMNS) {
    const tableRow = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!tableRow) continue;
    const columns = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) {
      const statement = ['ALTER TABLE', table, 'ADD COLUMN', column, ddlType].join(' ');
      conn.exec(statement);
      added.push(`${table}.${column}`);
    }
  }
  return added;
}

/**
 * Gate 2 & Gate 3: Check-Before-Apply Canonical Schema Migration
 */
function verifyAndApplyCanonicalSchema(conn, migrationId = MIGRATION_ID, canonicalDdlSql = null) {
  if (!conn || typeof conn.prepare !== 'function') {
    throw new Error('Valid SQLite connection required for verifyAndApplyCanonicalSchema');
  }

  let ddlSql = canonicalDdlSql;
  if (!ddlSql) {
    const migrationPath = path.join(__dirname, '..', '..', '..', 'migrations', `${migrationId}.sql`);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Canonical migration SQL file not found at ${migrationPath}`);
    }
    ddlSql = fs.readFileSync(migrationPath, 'utf8');
  }

  const checksumSha256 = crypto.createHash('sha256').update(ddlSql).digest('hex');

  // Gate 2: Guard against forbidden tables existing prior to application
  const existingTables = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  for (const tbl of existingTables) {
    for (const pattern of FORBIDDEN_LEGACY_PATTERNS) {
      if (pattern.test(tbl)) {
        throw new Error(`[FORBIDDEN LEGACY TABLE DETECTED]: Table '${tbl}' must be removed before applying canonical 3D schema`);
      }
    }
  }

  // Execute inside an immediate transaction
  const startMs = Date.now();
  const applyTx = typeof conn.transaction === 'function'
    ? conn.transaction(() => {
        _applyCanonicalDdl(conn, migrationId, ddlSql, checksumSha256, startMs);
      })
    : () => {
        conn.exec('BEGIN IMMEDIATE;');
        try {
          _applyCanonicalDdl(conn, migrationId, ddlSql, checksumSha256, startMs);
          conn.exec('COMMIT;');
        } catch (err) {
          try { conn.exec('ROLLBACK;'); } catch (_) {}
          throw err;
        }
      };

  applyTx();
  ensureAdditiveColumns(conn);

  // Post-migration integrity verification
  const fkCheck = conn.prepare('PRAGMA foreign_key_check').all();
  if (fkCheck.length > 0) {
    throw new Error(`[FOREIGN KEY VIOLATION]: Post-migration foreign key check failed with ${fkCheck.length} violations`);
  }
  const integRow = conn.prepare('PRAGMA integrity_check').get();
  const integVal = integRow ? (integRow.integrity_check || Object.values(integRow)[0]) : 'unknown';
  if (integVal !== 'ok') {
    throw new Error(`[INTEGRITY ERROR]: Post-migration database integrity check returned '${integVal}'`);
  }

  return { success: true, migrationId, checksumSha256 };
}

function _applyCanonicalDdl(conn, migrationId, ddlSql, checksumSha256, startMs) {
  // Check schema_migrations table if present
  const hasMigrationsTable = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (hasMigrationsTable) {
    const existing = conn.prepare('SELECT migration_id, checksum_sha256 FROM schema_migrations WHERE migration_id = ?').get(migrationId);
    if (existing) {
      if (existing.checksum_sha256 !== checksumSha256) {
        throw new Error(`[SCHEMA DRIFT ERROR]: Checksum mismatch for migration '${migrationId}'. Expected ${checksumSha256}, found ${existing.checksum_sha256}`);
      }
      return;
    }
  }

  // Execute DDL statements
  conn.exec(ddlSql);

  const execMs = Math.max(0, Date.now() - startMs);
  const nowIso = new Date().toISOString();
  conn.prepare(`
    INSERT OR REPLACE INTO schema_migrations (migration_id, checksum_sha256, applied_at, execution_ms)
    VALUES (?, ?, ?, ?)
  `).run(migrationId, checksumSha256, nowIso, execMs);
}

/**
 * Record per-request LLM token and cost telemetry
 */
function record3DLlmRequest(conn, reqRecord) {
  if (!conn || !reqRecord) return;
  const requestId = reqRecord.request_id || `req_3d_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = reqRecord.created_at || new Date().toISOString();
  const inputTokens = Math.max(0, parseInt(reqRecord.input_tokens || 0, 10));
  const outputTokens = Math.max(0, parseInt(reqRecord.output_tokens || 0, 10));
  const totalTokens = Math.max(0, parseInt(reqRecord.total_tokens || (inputTokens + outputTokens), 10));
  const estCostUsd = Math.max(0, Number(reqRecord.est_cost_usd || 0.0));

  const stmt = conn.prepare(`
    INSERT INTO llm_requests_3d (
      request_id, job_id, request_kind, provider, model, client_source,
      input_tokens, output_tokens, total_tokens, token_source, est_cost_usd, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    requestId,
    reqRecord.job_id,
    reqRecord.request_kind || 'dsl_synthesis',
    reqRecord.provider || 'default',
    reqRecord.model || 'inherited',
    reqRecord.client_source || 'yamanaka',
    inputTokens,
    outputTokens,
    totalTokens,
    reqRecord.token_source || 'provider_usage',
    estCostUsd,
    nowIso
  );
}

/**
 * Aggregated 3D token and cost metrics across 6 standard filter windows:
 * 'today' | '24h' | '7d' | '30d' | '60d' | 'all'
 */
function get3DTokenTelemetry(conn, range = 'today') {
  if (!conn || typeof conn.prepare !== 'function') {
    return { range, total_requests: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 };
  }

  let whereClause = '';
  const now = new Date();

  switch (range) {
    case 'today': {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      whereClause = `WHERE created_at >= '${startOfDay}'`;
      break;
    }
    case '24h': {
      const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      whereClause = `WHERE created_at >= '${since24h}'`;
      break;
    }
    case '7d': {
      const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      whereClause = `WHERE created_at >= '${since7d}'`;
      break;
    }
    case '30d': {
      const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      whereClause = `WHERE created_at >= '${since30d}'`;
      break;
    }
    case '60d': {
      const since60d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      whereClause = `WHERE created_at >= '${since60d}'`;
      break;
    }
    case 'all':
    default:
      whereClause = '';
      break;
  }

  try {
    const row = conn.prepare(`
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(est_cost_usd), 0.0) as est_cost_usd
      FROM llm_requests_3d
      ${whereClause}
    `).get();

    return {
      range,
      total_requests: row ? Number(row.total_requests || 0) : 0,
      total_input_tokens: row ? Number(row.total_input_tokens || 0) : 0,
      total_output_tokens: row ? Number(row.total_output_tokens || 0) : 0,
      total_tokens: row ? Number(row.total_tokens || 0) : 0,
      est_cost_usd: row ? Number(Number(row.est_cost_usd || 0.0).toFixed(4)) : 0.0
    };
  } catch (_) {
    return { range, total_requests: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 };
  }
}

/**
 * Transactional Repository Helper: Create initial generation job record
 */
function readDependencyVersion(pkgName) {
  try {
    return require(`${pkgName}/package.json`).version || null;
  } catch (_) {
    return null;
  }
}

function createJobRecord(conn, job) {
  const stmt = conn.prepare(`
    INSERT INTO generation_jobs (
      job_id, nonce, source_mode, status, prompt, negative_prompt,
      input_image_rel_path, input_image_sha256, profile, quality_preset,
      requested_compute_mode, effective_compute_mode, compute_fallback_reason,
      dsl_version, dsl_payload_json, domain_archetype, manifold_kernel_version,
      threejs_version, raw_base_glb_sha256, refinement_backend, blender_version,
      dcc_mcp_version, model_used, client_source, input_tokens, output_tokens,
      total_tokens, est_cost_usd, staging_rel_dir, staging_cleaned, repair_attempts,
      error_stage, error_code, error_message, created_at, started_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    job.job_id, job.nonce, job.source_mode, job.status || 'pending', job.prompt || null, job.negative_prompt || null,
    job.input_image_rel_path || null, job.input_image_sha256 || null, job.profile || 'enterprise_pbr', job.quality_preset || 'standard',
    job.requested_compute_mode || 'auto', job.effective_compute_mode || 'cpu', job.compute_fallback_reason || null,
    job.dsl_version || '1.0.0', job.dsl_payload_json || '{}', job.domain_archetype || 'game-prop', job.manifold_kernel_version || readDependencyVersion('manifold-3d'),
    job.threejs_version || readDependencyVersion('three'), job.raw_base_glb_sha256 || null, job.refinement_backend || 'deterministic_only', job.blender_version || null,
    job.dcc_mcp_version || null, job.model_used || null, job.client_source || null, job.input_tokens || 0, job.output_tokens || 0,
    job.total_tokens || 0, job.est_cost_usd || 0.0, job.staging_rel_dir, job.staging_cleaned ? 1 : 0, job.repair_attempts || 0,
    job.error_stage || null, job.error_code || null, job.error_message || null, job.created_at || new Date().toISOString(),
    job.started_at || null, job.completed_at || null
  );
}

/**
 * Transactional Repository Helper: Update job lifecycle stage
 */
function updateJobStage(conn, jobId, stageData = {}) {
  const fields = [];
  const params = [];

  for (const [key, val] of Object.entries(stageData)) {
    fields.push(`${key} = ?`);
    params.push(val);
  }

  if (fields.length === 0) return;
  params.push(jobId);

  conn.prepare(`UPDATE generation_jobs SET ${fields.join(', ')} WHERE job_id = ?`).run(...params);
}

/**
 * Transactional Repository Helper: Record validation scoreSpec results
 */
function recordValidationResult(conn, val) {
  const stmt = conn.prepare(`
    INSERT INTO validation_results (
      validation_id, job_id, asset_id, validation_stage, validator_name,
      validator_version, attempt_number, passed, overall_score,
      score_spec_11_rows_json, manifold_status, non_manifold_edges,
      report_rel_path, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    val.validation_id || `val_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    val.job_id,
    val.asset_id || null,
    val.validation_stage,
    val.validator_name || 'yamanaka_spec_scorer',
    val.validator_version || '2.2.18',
    val.attempt_number || 1,
    val.passed ? 1 : 0,
    val.overall_score || 0.0,
    typeof val.score_spec_11_rows_json === 'string' ? val.score_spec_11_rows_json : JSON.stringify(val.score_spec_11_rows_json || []),
    val.manifold_status || 'watertight',
    val.non_manifold_edges || 0,
    val.report_rel_path || null,
    val.created_at || new Date().toISOString()
  );
}

/**
 * Atomic Promotion Transaction: Commits asset, asset_files, validation_results, and generation_jobs
 */
function promoteAssetTransaction(conn, { job, asset, files = [], validations = [] }) {
  const tx = typeof conn.transaction === 'function'
    ? conn.transaction(() => _executePromotion(conn, { job, asset, files, validations }))
    : () => {
        conn.exec('BEGIN IMMEDIATE;');
        try {
          _executePromotion(conn, { job, asset, files, validations });
          conn.exec('COMMIT;');
        } catch (err) {
          try { conn.exec('ROLLBACK;'); } catch (_) {}
          throw err;
        }
      };

  return tx();
}

function _executePromotion(conn, { job, asset, files, validations }) {
  // Insert into assets
  const assetStmt = conn.prepare(`
    INSERT INTO assets (
      asset_id, job_id, nonce, display_name, source_mode, profile,
      quality_preset, domain_archetype, dsl_version, refinement_backend,
      blender_version, dcc_mcp_version, effective_compute_mode, model_used, vertex_count,
      triangle_count, is_watertight_manifold, pre_blender_score,
      post_blender_score, input_tokens, output_tokens, total_tokens,
      est_cost_usd, asset_status, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  assetStmt.run(
    asset.asset_id, asset.job_id, asset.nonce, asset.display_name, asset.source_mode, asset.profile,
    asset.quality_preset, asset.domain_archetype, asset.dsl_version, asset.refinement_backend,
    asset.blender_version || null, asset.dcc_mcp_version || null, asset.effective_compute_mode || 'cpu', asset.model_used || null, asset.vertex_count,
    asset.triangle_count, asset.is_watertight_manifold ? 1 : 0, asset.pre_blender_score || 0.0,
    asset.post_blender_score || 0.0, asset.input_tokens || 0, asset.output_tokens || 0, asset.total_tokens || 0,
    asset.est_cost_usd || 0.0, asset.asset_status || 'ready', asset.created_at || new Date().toISOString()
  );

  // Insert into asset_files
  const fileStmt = conn.prepare(`
    INSERT INTO asset_files (
      file_id, asset_id, file_role, rel_path, mime_type, byte_size,
      sha256, width_px, height_px, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const f of files) {
    fileStmt.run(
      f.file_id || `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      asset.asset_id,
      f.file_role,
      f.rel_path,
      f.mime_type,
      f.byte_size,
      f.sha256,
      f.width_px || null,
      f.height_px || null,
      f.created_at || new Date().toISOString()
    );
  }

  // Link any validation results to asset_id
  if (Array.isArray(validations)) {
    for (const v of validations) {
      recordValidationResult(conn, { ...v, asset_id: asset.asset_id });
    }
  }

  // Update generation_jobs
  if (job && job.job_id) {
    conn.prepare(`
      UPDATE generation_jobs
      SET status = 'completed', completed_at = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, est_cost_usd = ?
      WHERE job_id = ?
    `).run(
      new Date().toISOString(),
      asset.input_tokens || 0,
      asset.output_tokens || 0,
      asset.total_tokens || 0,
      asset.est_cost_usd || 0.0,
      job.job_id
    );
  }
}

/**
 * List assets in 'ready' status
 */
function listReadyAssets(conn, options = {}) {
  const limit = Math.max(1, Math.min(100, options.limit || 20));
  const offset = Math.max(0, options.offset || 0);

  const rows = conn.prepare(`
    SELECT a.*,
      (SELECT rel_path FROM asset_files WHERE asset_id = a.asset_id AND file_role = 'primary_glb') as primary_glb_path,
      (SELECT rel_path FROM asset_files WHERE asset_id = a.asset_id AND file_role = 'preview_png') as preview_png_path,
      (SELECT rel_path FROM asset_files WHERE asset_id = a.asset_id AND file_role = 'thumbnail_webp') as thumbnail_webp_path
    FROM assets a
    WHERE a.asset_status = 'ready'
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  return rows;
}

function getAssetById(conn, assetId) {
  const asset = conn.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId);
  if (!asset) return null;
  const files = conn.prepare('SELECT * FROM asset_files WHERE asset_id = ?').all(assetId);
  const validations = conn.prepare('SELECT * FROM validation_results WHERE asset_id = ?').all(assetId);
  return { ...asset, files, validations };
}

function getAssetFileByRole(conn, assetId, fileRole) {
  return conn.prepare('SELECT * FROM asset_files WHERE asset_id = ? AND file_role = ?').get(assetId, fileRole);
}

function getJobById(conn, jobId) {
  return conn.prepare('SELECT * FROM generation_jobs WHERE job_id = ?').get(jobId);
}

module.exports = {
  MIGRATION_ID,
  CANONICAL_3D_TABLES,
  FORBIDDEN_LEGACY_PATTERNS,
  runGate1PreCheckAudit,
  purgeLegacy3DTables,
  ensureAdditiveColumns,
  verifyAndApplyCanonicalSchema,
  record3DLlmRequest,
  get3DTokenTelemetry,
  createJobRecord,
  updateJobStage,
  recordValidationResult,
  promoteAssetTransaction,
  listReadyAssets,
  getAssetById,
  getAssetFileByRole,
  getJobById
};
