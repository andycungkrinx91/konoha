'use strict';

/**
 * Promotion transaction body for the canonical Yamanaka 3D schema: inserts the
 * asset row (plus any additive output/iteration metadata columns) and its files,
 * links validation rows and closes the generation job.
 */

const crypto = require('crypto');
const { recordValidationResult, ensureAdditiveColumns } = require('./db_3d_schema');

const EXTRA_ASSET_COLUMNS = [
  'output_width',
  'output_height',
  'output_aspect_ratio',
  'output_orientation',
  'object_brief_json',
  'reference_analysis_json',
  'iteration_history_json',
  'final_score'
];

const EXTRA_JOB_COLUMNS = [
  'output_width',
  'output_height',
  'output_aspect_ratio',
  'output_orientation',
  'object_brief_json',
  'reference_analysis_json',
  'iteration_history_json'
];

function _applyOptionalColumnUpdates(conn, tableName, idCol, idVal, ...rest) {
  const [columns, sourceObj] = rest;
  const fields = [];
  const params = [];
  for (const k of columns) {
    if (sourceObj[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(sourceObj[k]);
    }
  }
  if (fields.length > 0) {
    params.push(idVal);
    conn.prepare(`UPDATE ${tableName} SET ${fields.join(', ')} WHERE ${idCol} = ?`).run(...params);
  }
}

function _executePromotion(conn, { job, asset, files, validations }) {
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
  ensureAdditiveColumns(conn);
  _applyOptionalColumnUpdates(conn, 'assets', 'asset_id', asset.asset_id, EXTRA_ASSET_COLUMNS, asset);

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

  if (Array.isArray(validations)) {
    for (const v of validations) {
      recordValidationResult(conn, { ...v, asset_id: asset.asset_id });
    }
  }

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
    _applyOptionalColumnUpdates(conn, 'generation_jobs', 'job_id', job.job_id, EXTRA_JOB_COLUMNS, asset);
  }
}

/**
 * List assets in 'ready' status
 */

module.exports = {
  executePromotion: _executePromotion
};
