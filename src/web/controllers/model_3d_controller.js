'use strict';

/**
 * 3D Model Controller for Konoha Web UI (Yamanaka Generative 3D Subsystem).
 * Provides endpoints for 3D Toolchain Setup, Hardware Detection, Unified Model Discovery,
 * LangGraph 3D Generation with Live SSE Streaming, Asset Management & Secure Downloads.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendJson, parseBody } = require('./common');
const { getConnection } = require('../../db');
const {
  getJobById,
  getAssetById,
  get3DTokenTelemetry
} = require('../../mcp/three_asset/db_3d_schema');
const {
  resolveSafeAssetDownloadPath
} = require('../../mcp/three_asset/storage_manager');
const {
  COMPUTE_MODES,
  detectComputeHardware,
  resolveStageCompute
} = require('../../mcp/three_asset/compute_selector');
const { ARCHETYPES } = require('../../mcp/three_asset/spec_schema');
const { GENERATION_PROFILES, QUALITY_PRESETS } = require('../../mcp/three_asset/style_profile');
const {
  LEVEL_ORDER,
  listQualityLevels,
  resolveQualityLevel,
  expandLevelOptions
} = require('../../mcp/three_asset/quality_levels');
const {
  getToolchainStatus,
  installAllTools
} = require('../../mcp/three_asset/blender_installer');
const {
  getLiveBlenderStatus,
  closeLiveBlenderSession,
  ensureLiveBlenderSession
} = require('../../mcp/three_asset/blender_refiner');
const {
  discoverAll3DModels
} = require('../../mcp/three_asset/model_router');
const {
  runYamanaka3DGraph
} = require('../../workflow/yamanaka/graph');

// In-memory active job SSE emitter registry
const activeJobEmitters = new Map();

function _registerJobClient(jobId, res) {
  if (!activeJobEmitters.has(jobId)) {
    activeJobEmitters.set(jobId, new Set());
  }
  activeJobEmitters.get(jobId).add(res);

  res.on('close', () => {
    const clients = activeJobEmitters.get(jobId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        activeJobEmitters.delete(jobId);
      }
    }
  });
}

function _broadcastJobEvent(jobId, eventData) {
  const clients = activeJobEmitters.get(jobId);
  if (!clients || clients.size === 0) return;

  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch { /* intentional best-effort fallback: response already committed */ }
  }
}

async function _handleGetSetupStatus(res) {
  try {
    const conn = getConnection();
    const hardware = detectComputeHardware();
    const toolchain = getToolchainStatus();
    const liveSession = getLiveBlenderStatus();
    const telemetry = get3DTokenTelemetry(conn, 'all');

    return sendJson(res, 200, {
      success: true,
      hardware,
      toolchain,
      live_session: liveSession,
      telemetry
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

async function _handleInstallTools(req, res) {
  try {
    const logs = [];
    const onProgress = (p) => {
      logs.push(p);
    };

    const installRes = await installAllTools({ onProgress });
    const updatedStatus = getToolchainStatus();

    return sendJson(res, 200, {
      success: true,
      components: installRes.components,
      updated_status: updatedStatus,
      logs
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

async function _handleGetModels(res) {
  try {
    const modelsCatalog = await discoverAll3DModels();
    return sendJson(res, 200, {
      success: true,
      client_default_model: modelsCatalog.client_default_model || modelsCatalog.models[0]?.id || null,
      preferred_models: modelsCatalog.preferred_models || [],
      catalogs: {
        archetypes: [...ARCHETYPES],
        profiles: Object.keys(GENERATION_PROFILES || {}),
        quality_presets: Object.keys(QUALITY_PRESETS || {}),
        quality_levels: listQualityLevels(),
        compute_modes: [...COMPUTE_MODES]
      },
      ...modelsCatalog
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

const { getOutputRoot } = require('../../mcp/three_asset/storage_manager');
const { parseBody: parseJsonBody, sendJson: sendJsonResponse } = require('./common');

const IMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_MAGIC = [
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], tail: [0x57, 0x45, 0x42, 0x50], tailOffset: 8 }
];

function _sniffImage(buf) {
  for (const spec of IMAGE_MAGIC) {
    if (!spec.bytes.every((b, i) => buf[i] === b)) continue;
    if (spec.tail) {
      const okTail = spec.tail.every((b, i) => buf[spec.tailOffset + i] === b);
      if (!okTail) continue;
    }
    return spec.ext;
  }
  return null;
}

function _inputsDir() {
  const dir = path.join(getOutputRoot(), 'inputs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Accept a reference image for image-to-3D generation. The payload is validated
 * by magic bytes rather than the declared MIME type, stored under the 3D output
 * inputs directory, and the returned path is what /generate expects.
 */
async function _handleUploadImage(req, res) {
  try {
    const body = await parseJsonBody(req, res);
    if (!body) return false;
    const { data_base64: dataBase64, filename } = body;
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return sendJsonResponse(res, 400, { success: false, error: 'data_base64 is required' });
    }
    const cleaned = dataBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    let buf;
    try {
      buf = Buffer.from(cleaned, 'base64');
    } catch (_) {
      return sendJsonResponse(res, 400, { success: false, error: 'data_base64 is not valid base64' });
    }
    if (!buf || buf.length === 0) {
      return sendJsonResponse(res, 400, { success: false, error: 'decoded image is empty' });
    }
    if (buf.length > IMAGE_UPLOAD_MAX_BYTES) {
      return sendJsonResponse(res, 413, {
        success: false,
        error: `image exceeds ${Math.round(IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit`,
        size_bytes: buf.length
      });
    }
    const ext = _sniffImage(buf);
    if (!ext) {
      return sendJsonResponse(res, 415, {
        success: false,
        error: 'unsupported image format: expected PNG, JPEG, or WebP'
      });
    }
    const safeStem = String(filename || 'reference')
      .replace(/\.[^.]*$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48) || 'reference';
    const storedName = `${safeStem}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.${ext}`;
    const destPath = path.join(_inputsDir(), storedName);
    fs.writeFileSync(destPath, buf);
    return sendJsonResponse(res, 200, {
      success: true,
      image_path: destPath,
      format: ext,
      size_bytes: buf.length,
      filename: storedName
    });
  } catch (err) {
    return sendJsonResponse(res, 500, { success: false, error: err.message });
  }
}

async function _handleGenerate(req, res) {
  try {
    const body = await parseBody(req, res);
    if (!body) return false;

    const prompt = body.prompt?.trim();
    if (!prompt && !body.dsl && !body.image_path) {
      return sendJson(res, 400, {
        success: false,
        error: 'Either prompt, dsl, or image_path is required for 3D generation'
      });
    }

    if (body.image_path) {
      const inputsRoot = path.resolve(_inputsDir());
      const resolved = path.resolve(String(body.image_path));
      const withinInputs = resolved === inputsRoot || resolved.startsWith(inputsRoot + path.sep);
      if (!withinInputs) {
        return sendJson(res, 400, {
          success: false,
          error: 'image_path must reference a file previously uploaded via /api/v1/3d/upload-image'
        });
      }
      if (!fs.existsSync(resolved)) {
        return sendJson(res, 400, {
          success: false,
          error: 'image_path does not exist on disk'
        });
      }
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nonce = crypto.randomBytes(8).toString('hex');
    const compute = resolveStageCompute(body.requested_compute_mode || 'auto');

    const quality = resolveQualityLevel(body.quality_preset);
    if (body.quality_preset !== undefined && body.quality_preset !== null && body.quality_preset !== '' && !quality.known) {
      return sendJson(res, 400, {
        success: false,
        error: `Unknown quality_preset "${body.quality_preset}"`,
        allowed_quality_levels: [...LEVEL_ORDER]
      });
    }
    const levelOptions = expandLevelOptions(quality.id, {
      target_polycount: body.target_polycount
    });

    // Respond immediately with 202 Accepted and job ID
    sendJson(res, 202, {
      success: true,
      job_id: jobId,
      nonce,
      status: 'synthesizing_spec',
      effective_compute_mode: compute.effectiveMode,
      stream_url: `/api/v1/3d/generate/${jobId}/stream`,
      live_glb_url: `/api/v1/3d/staging/${jobId}/live.glb`,
      live_png_url: `/api/v1/3d/staging/${jobId}/live.png`
    });

    // Run LangGraph execution asynchronously
    setImmediate(async () => {
      try {
        _broadcastJobEvent(jobId, {
          event: 'stage_started',
          job_id: jobId,
          stage: 'synthesizing_spec',
          timestamp: new Date().toISOString()
        });

        const graphResult = await runYamanaka3DGraph(
          {
            job_id: jobId,
            nonce,
            prompt,
            negative_prompt: body.negative_prompt,
            image_path: body.image_path,
            archetype: body.archetype || 'game-prop',
            profile: body.profile || 'enterprise_pbr',
            quality_preset: levelOptions.quality_preset,
            requested_compute_mode: body.requested_compute_mode || 'auto',
            target_polycount: levelOptions.target_polycount,
            texture_resolution: body.texture_resolution,
            enable_pbr: body.enable_pbr !== false,
            model: body.model || null,
            dsl: body.dsl || null
          },
          {
            configurable: {
              onAction: (action) => {
                _broadcastJobEvent(jobId, action);
              }
            }
          }
        );

        _broadcastJobEvent(jobId, {
          event: 'job_completed',
          job_id: jobId,
          asset_id: graphResult.asset_id,
          status: graphResult.status,
          output_path: graphResult.output_path,
          tokens: graphResult.tokens,
          timestamp: new Date().toISOString()
        });
      } catch (genErr) {
        _broadcastJobEvent(jobId, {
          event: 'job_failed',
          job_id: jobId,
          error: genErr.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    return true;
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

function _handleJobStream(req, res, jobId) {
  const conn = getConnection();
  const job = getJobById(conn, jobId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ event: 'connected', job_id: jobId, job })}\n\n`);
  _registerJobClient(jobId, res);
  return true;
}

function _handleListJobs(res, parsedUrl) {
  try {
    const conn = getConnection();
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

    const rows = conn.prepare(`
      SELECT job_id, source_mode, status, prompt, profile, quality_preset,
             requested_compute_mode, effective_compute_mode, model_used,
             domain_archetype, input_tokens, output_tokens, total_tokens,
             est_cost_usd, created_at, completed_at
      FROM generation_jobs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = conn.prepare('SELECT COUNT(*) as count FROM generation_jobs').get().count;

    return sendJson(res, 200, { success: true, jobs: rows, total, limit, offset });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

function _handleGetJob(res, jobId) {
  try {
    const conn = getConnection();
    const job = getJobById(conn, jobId);
    if (!job) {
      return sendJson(res, 404, { success: false, error: `Job '${jobId}' not found` });
    }
    return sendJson(res, 200, { success: true, job });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

function _handleListAssets(res, parsedUrl) {
  try {
    const conn = getConnection();
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

    const rows = conn.prepare(`
      SELECT asset_id, job_id, display_name, source_mode, profile, quality_preset,
             domain_archetype, refinement_backend, effective_compute_mode,
             model_used, vertex_count, triangle_count, is_watertight_manifold,
             pre_blender_score, input_tokens, output_tokens, total_tokens,
             est_cost_usd, asset_status, created_at
      FROM assets
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = conn.prepare('SELECT COUNT(*) as count FROM assets').get().count;

    return sendJson(res, 200, { success: true, assets: rows, total, limit, offset });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

function _handleGetAsset(res, assetId) {
  try {
    const conn = getConnection();
    const asset = getAssetById(conn, assetId);
    if (!asset) {
      return sendJson(res, 404, { success: false, error: `Asset '${assetId}' not found` });
    }
    return sendJson(res, 200, { success: true, asset });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

function _handleDownloadAssetFile(res, assetId, format) {
  try {
    const conn = getConnection();
    const roleMap = {
      glb: 'primary_glb',
      primary_glb: 'primary_glb',
      preview: 'preview_png',
      png: 'preview_png',
      usdz: 'usdz',
      obj: 'obj',
      stl: 'stl',
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
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    const stream = fs.createReadStream(resolved.absPath);
    stream.pipe(res);
    return true;
  } catch (err) {
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

function _handleGetTelemetry(res, parsedUrl) {
  try {
    const conn = getConnection();
    const period = parsedUrl.searchParams.get('period') || 'today';
    const telemetry = get3DTokenTelemetry(conn, period);

    return sendJson(res, 200, {
      success: true,
      period,
      ...telemetry
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

async function handleModel3DRoutes(req, res, ctx, parsedUrl, pathname, method) {
  if (!pathname.startsWith('/api/v1/3d')) {
    return false;
  }

  // Setup Status & Toolchain Installation
  if (pathname === '/api/v1/3d/setup/status' && method === 'GET') {
    return _handleGetSetupStatus(res);
  }
  if (pathname === '/api/v1/3d/setup/install' && method === 'POST') {
    return _handleInstallTools(req, res);
  }
  if (pathname === '/api/v1/3d/setup/models' && method === 'GET') {
    return _handleGetModels(res);
  }
  if (pathname === '/api/v1/3d/setup/blender/launch' && method === 'POST') {
    const session = await ensureLiveBlenderSession({ gui: true });
    return sendJson(res, 200, { success: true, session });
  }
  if (pathname === '/api/v1/3d/setup/blender/close' && method === 'POST') {
    const closeRes = closeLiveBlenderSession();
    return sendJson(res, 200, { success: true, ...closeRes });
  }

  // Generation & Streaming
  if (pathname === '/api/v1/3d/upload-image' && method === 'POST') {
    return await _handleUploadImage(req, res);
  }
  if (pathname === '/api/v1/3d/generate' && method === 'POST') {
    return _handleGenerate(req, res);
  }
  if (pathname.startsWith('/api/v1/3d/generate/') && pathname.endsWith('/stream') && method === 'GET') {
    const jobId = pathname.slice('/api/v1/3d/generate/'.length, -'/stream'.length);
    return _handleJobStream(req, res, jobId);
  }

  // Live Viewport Staging GLB Hot-Reload
  if (pathname.startsWith('/api/v1/3d/staging/') && pathname.endsWith('/live.glb') && method === 'GET') {
    const jobId = pathname.slice('/api/v1/3d/staging/'.length, -'/live.glb'.length);
    return _handleLiveStagingGlb(res, jobId);
  }

  // Live Blender Render Stream (real EEVEE preview written by Blender each step)
  if (pathname.startsWith('/api/v1/3d/staging/') && pathname.endsWith('/live.png') && method === 'GET') {
    const jobId = pathname.slice('/api/v1/3d/staging/'.length, -'/live.png'.length);
    return _handleLiveStagingPng(res, jobId);
  }

  // Jobs Query
  if (pathname === '/api/v1/3d/jobs' && method === 'GET') {
    return _handleListJobs(res, parsedUrl);
  }
  if (pathname.startsWith('/api/v1/3d/jobs/') && method === 'GET') {
    const jobId = decodeURIComponent(pathname.slice('/api/v1/3d/jobs/'.length));
    return _handleGetJob(res, jobId);
  }

  // Assets Query & Downloads
  if (pathname === '/api/v1/3d/assets' && method === 'GET') {
    return _handleListAssets(res, parsedUrl);
  }
  if (pathname.startsWith('/api/v1/3d/assets/') && pathname.includes('/download/') && method === 'GET') {
    const parts = pathname.slice('/api/v1/3d/assets/'.length).split('/download/');
    const assetId = decodeURIComponent(parts[0]);
    const format = decodeURIComponent(parts[1] || 'glb');
    return _handleDownloadAssetFile(res, assetId, format);
  }
  if (pathname.startsWith('/api/v1/3d/assets/') && method === 'GET') {
    const assetId = decodeURIComponent(pathname.slice('/api/v1/3d/assets/'.length));
    return _handleGetAsset(res, assetId);
  }

  // Token & Cost Telemetry
  if (pathname === '/api/v1/3d/telemetry' && method === 'GET') {
    return _handleGetTelemetry(res, parsedUrl);
  }

  return false;
}

module.exports = {
  handleModel3DRoutes
};
