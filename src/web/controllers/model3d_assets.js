'use strict';

/**
 * Asset file serving + live staging streams for the 3D maker. Extracted from
 * model_3d_controller.js to keep the controller under the 700-line lint ceiling.
 */

const fs = require('fs');
const path = require('path');
const { getConnection } = require('../../db');
const { getJobById } = require('../../mcp/three_asset/db_3d_schema');
const { resolveSafeAssetDownloadPath } = require('../../mcp/three_asset/storage_manager');
const { sendJson } = require('./common');

function _handleDownloadAssetFile(res, assetId, format) {
  try {
    const conn = getConnection();
    const roleMap = {
      glb: 'primary_glb',
      primary_glb: 'primary_glb',
      preview: 'preview_png',
      png: 'preview_png',
      gltf: 'export_gltf',
      export_gltf: 'export_gltf',
      usdz: 'usdz',
      obj: 'export_obj',
      export_obj: 'export_obj',
      stl: 'export_stl',
      export_stl: 'export_stl',
      ply: 'ply'
    };

    const targetRole = roleMap[format.toLowerCase()] || format;
    const resolved = resolveSafeAssetDownloadPath(assetId, targetRole, conn);

    if (!resolved || !fs.existsSync(resolved.absPath)) {
      return sendJson(res, 404, { success: false, error: `File for format '${format}' not found on asset '${assetId}'` });
    }

    const filename = path.basename(resolved.absPath);
    res.writeHead(200, {
      'Content-Type': resolved.mimeType || 'application/octet-stream',
      'Content-Length': resolved.byteSize || fs.statSync(resolved.absPath).size,
      'Content-Disposition': `${(format === 'preview' || format === 'glb') ? 'inline' : 'attachment'}; filename="${filename}"`
    });

    const stream = fs.createReadStream(resolved.absPath);
    stream.pipe(res);
    return true;
  } catch (err) {
    // The file row exists but the artifact is gone from disk: this is a missing
    // resource, not a server fault. Security-alert throws deliberately stay 500.
    if (String(err.message || '').startsWith('Asset file missing from disk at ')) {
      return sendJson(res, 404, { success: false, error: `File for format '${format}' not found on asset '${assetId}'` });
    }
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

const ACTIVE_JOB_STAGES = new Set([
  'pending', 'synthesizing_spec', 'parsing_dsl', 'building_base_mesh',
  'validating_base_mesh', 'refining_blender', 'validating_final_asset',
  'generating_previews', 'promoting_asset', 'recovering'
]);

const LIVE_GLB_POLL_INTERVAL_MS = 150;
const LIVE_GLB_POLL_TIMEOUT_MS = 15000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function awaitLiveStagingGlb(jobId, conn) {
  const deadline = Date.now() + LIVE_GLB_POLL_TIMEOUT_MS;
  for (;;) {
    const resolved = resolveSafeAssetDownloadPath(jobId, 'live_staging_glb', conn);
    if (resolved && fs.existsSync(resolved.absPath)) return resolved;
    if (Date.now() >= deadline) return null;
    let job = null;
    try {
      job = getJobById(conn, jobId);
    } catch {
      job = null;
    }
    if (!job) return null;
    if (job.status === 'failed' || job.status === 'completed') {
      const settled = resolveSafeAssetDownloadPath(jobId, 'live_staging_glb', conn);
      return settled && fs.existsSync(settled.absPath) ? settled : null;
    }
    if (!ACTIVE_JOB_STAGES.has(job.status)) return null;
    await delay(LIVE_GLB_POLL_INTERVAL_MS);
  }
}

async function _handleLiveStagingGlb(res, jobId) {
  try {
    const conn = getConnection();
    const resolved = await awaitLiveStagingGlb(jobId, conn);

    if (!resolved) {
      return sendJson(res, 404, { success: false, error: `Live staging GLB not ready for job '${jobId}'` });
    }

    res.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': fs.statSync(resolved.absPath).size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });

    const stream = fs.createReadStream(resolved.absPath);
    stream.pipe(res);
    return true;
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

async function _handleLiveStagingPng(res, jobId) {
  try {
    const conn = getConnection();
    const resolved = resolveSafeAssetDownloadPath(jobId, 'live_staging_png', conn);
    if (!resolved || !fs.existsSync(resolved.absPath)) {
      return sendJson(res, 404, { success: false, error: `Live Blender render not ready for job '${jobId}'` });
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': fs.statSync(resolved.absPath).size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    });
    fs.createReadStream(resolved.absPath).pipe(res);
    return true;
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

module.exports = {
  handleDownloadAssetFile: _handleDownloadAssetFile,
  handleLiveStagingGlb: _handleLiveStagingGlb,
  handleLiveStagingPng: _handleLiveStagingPng,
  awaitLiveStagingGlb
};
