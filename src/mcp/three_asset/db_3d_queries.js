'use strict';

/**
 * Asset read queries for the canonical Yamanaka 3D schema
 * (migrations/20261103_001_yamanaka_3d_canonical.sql).
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
  listReadyAssets,
  getAssetById,
  getAssetFileByRole,
  getJobById
};
