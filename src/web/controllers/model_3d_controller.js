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
  COMPUTE_MODES,
  detectComputeHardware,
  normalizeGpuBackend,
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
    const gpuTelemetry = getGpuTelemetry();
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
      output_size_presets: {
        orientations: [...ORIENTATIONS],
        aspects: Object.keys(ASPECT_PRESETS),
        long_edges: [...LONG_EDGE_PRESETS]
      },
      gpu_vram_total_bytes: gpuTelemetry?.vram_total_bytes || null,
      ...modelsCatalog
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

const { getOutputRoot } = require('../../mcp/three_asset/storage_manager');
const { getGpuTelemetry } = require('../../gpu_telemetry');
const {
  ORIENTATIONS,
  ASPECT_PRESETS,
  LONG_EDGE_PRESETS,
  resolveOutputSize,
  clampOutputSizeForVram,
  withWarningSuffix
} = require('../../mcp/three_asset/output_size');
const { parsePngPixels } = require('../../mcp/three_asset/image_relief');
const { decodeRasterToPixels } = require('../../mcp/three_asset/raster_decoder');
const { parseBody: parseJsonBody, sendJson: sendJsonResponse } = require('./common');
const {
  IMAGE_UPLOAD_MAX_BYTES,
  normalizeOutputSizeInput,
  downsampleRgba,
  encodeRgbaPng,
  sniffImage
} = require('./model3d_image_intake');
const { handleDownloadAssetFile, handleLiveStagingGlb, handleLiveStagingPng } = require('./model3d_assets');

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
async function _resizeNonPngBuffer(buf, ext, maxTargetEdge) {
  const tempPath = path.join(_inputsDir(), `temp_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`);
  try {
    fs.writeFileSync(tempPath, buf);
    const decoded = await decodeRasterToPixels(tempPath);
    if (decoded && (decoded.width > maxTargetEdge || decoded.height > maxTargetEdge)) {
      const down = downsampleRgba(decoded.rgba, decoded.width, decoded.height, maxTargetEdge);
      return { finalBuf: encodeRgbaPng(down.width, down.height, down.rgba), finalExt: 'png' };
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) { /* best-effort temp cleanup */ }
    }
  }
  return { finalBuf: buf, finalExt: ext };
}

async function _resizeUploadedImageBuffer(buf, ext, maxTargetEdge) {
  if (!maxTargetEdge || maxTargetEdge <= 0) return { finalBuf: buf, finalExt: ext };
  try {
    if (ext === 'png') {
      const png = parsePngPixels(buf);
      if (png && (png.width > maxTargetEdge || png.height > maxTargetEdge)) {
        const down = downsampleRgba(png.data, png.width, png.height, maxTargetEdge);
        return { finalBuf: encodeRgbaPng(down.width, down.height, down.rgba), finalExt: ext };
      }
      return { finalBuf: buf, finalExt: ext };
    }
    return await _resizeNonPngBuffer(buf, ext, maxTargetEdge);
  } catch (_) {
    return { finalBuf: buf, finalExt: ext };
  }
}

async function _handleUploadImage(req, res) {
  try {
    const body = await parseJsonBody(req, res, IMAGE_UPLOAD_MAX_BYTES * 2);
    if (!body) return false;
    const { data_base64: dataBase64, filename, output_size: rawOutputSize } = body;
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
    const ext = sniffImage(buf);
    if (!ext) {
      return sendJsonResponse(res, 415, {
        success: false,
        error: 'unsupported image format: expected PNG, JPEG, or WebP'
      });
    }

    const resolvedSize = resolveOutputSize(normalizeOutputSizeInput(rawOutputSize));
    const maxTargetEdge = Math.max(resolvedSize.width, resolvedSize.height);
    const { finalBuf, finalExt } = await _resizeUploadedImageBuffer(buf, ext, maxTargetEdge);

    const safeStem = String(filename || 'reference')
      .replace(/\.[^.]*$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48) || 'reference';
    const storedName = `${safeStem}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.${finalExt}`;
    const destPath = path.join(_inputsDir(), storedName);
    fs.writeFileSync(destPath, finalBuf);
    return sendJsonResponse(res, 200, {
      success: true,
      image_path: destPath,
      format: finalExt,
      size_bytes: finalBuf.length,
      filename: storedName
    });
  } catch (err) {
    return sendJsonResponse(res, 500, { success: false, error: err.message });
  }
}

function _validateUploadedImagePath(imagePath) {
  if (!imagePath) return null;
  const inputsRoot = path.resolve(_inputsDir());
  const resolved = path.resolve(String(imagePath));
  const withinInputs = resolved === inputsRoot || resolved.startsWith(inputsRoot + path.sep);
  if (!withinInputs) {
    return 'image_path must reference a file previously uploaded via /api/v1/3d/upload-image';
  }
  if (!fs.existsSync(resolved)) {
    return 'image_path does not exist on disk';
  }
  return null;
}

function _dispatchAsyncGenerationJob(jobId, ctx) {
  const { nonce, prompt, body, levelOptions, clampedOutputSize, gpuVramTotalBytes } = ctx;
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
          source_mode: body.image_path ? 'image_to_3d' : (body.source_mode || 'text_to_3d'),
          archetype: body.archetype || 'game-prop',
          profile: body.profile || 'production_pbr',
          quality_preset: levelOptions.quality_preset,
          requested_compute_mode: body.requested_compute_mode || 'auto',
          requested_gpu_backend: normalizeGpuBackend(body.preferred_backend ?? body.preferredBackend),
          target_polycount: levelOptions.target_polycount,
          texture_resolution: body.texture_resolution,
          output_size: clampedOutputSize,
          gpu_vram_total_bytes: gpuVramTotalBytes,
          enable_pbr: body.enable_pbr !== false,
          model: body.model || null,
          dsl: body.dsl || null
        },
        {
          configurable: {
            onAction: (action) => _broadcastJobEvent(jobId, action)
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

    const imagePathErr = _validateUploadedImagePath(body.image_path);
    if (imagePathErr) {
      return sendJson(res, 400, { success: false, error: imagePathErr });
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nonce = crypto.randomBytes(8).toString('hex');
    const preferredBackend = normalizeGpuBackend(body.preferred_backend ?? body.preferredBackend);
    const compute = resolveStageCompute(
      body.requested_compute_mode || 'auto',
      preferredBackend ? { preferredBackend } : {}
    );

    const gpuTelemetry = getGpuTelemetry();
    const gpuVramTotalBytes = gpuTelemetry?.vram_total_bytes || 0;
    const rawOutputSize = resolveOutputSize(normalizeOutputSizeInput(body.output_size));
    const clampedOutputSize = clampOutputSizeForVram(rawOutputSize, {
      effectiveComputeMode: compute.effectiveMode,
      vramTotalBytes: gpuVramTotalBytes
    });
    const outputSizeWarning = withWarningSuffix(clampedOutputSize);

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

    sendJson(res, 202, {
      success: true,
      job_id: jobId,
      nonce,
      status: 'synthesizing_spec',
      effective_compute_mode: compute.effectiveMode,
      output_size: clampedOutputSize,
      output_size_warning: outputSizeWarning,
      stream_url: `/api/v1/3d/generate/${jobId}/stream`,
      live_glb_url: `/api/v1/3d/staging/${jobId}/live.glb`,
      live_png_url: `/api/v1/3d/staging/${jobId}/live.png`
    });

    _dispatchAsyncGenerationJob(jobId, {
      nonce,
      prompt,
      body,
      levelOptions,
      clampedOutputSize,
      gpuVramTotalBytes
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
             pre_blender_score, final_score, output_width, output_height,
             output_aspect_ratio, output_orientation,
             input_tokens, output_tokens, total_tokens,
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

async function handleModel3DRoutes(req, res, _ctx, ...routeArgs) {
  const [parsedUrl, pathname, method] = routeArgs;
  if (!pathname.startsWith('/api/v1/3d')) {
    return false;
  }

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

  if (pathname.startsWith('/api/v1/3d/staging/') && pathname.endsWith('/live.glb') && method === 'GET') {
    const jobId = pathname.slice('/api/v1/3d/staging/'.length, -'/live.glb'.length);
    return handleLiveStagingGlb(res, jobId);
  }

  if (pathname.startsWith('/api/v1/3d/staging/') && pathname.endsWith('/live.png') && method === 'GET') {
    const jobId = pathname.slice('/api/v1/3d/staging/'.length, -'/live.png'.length);
    return handleLiveStagingPng(res, jobId);
  }

  if (pathname === '/api/v1/3d/jobs' && method === 'GET') {
    return _handleListJobs(res, parsedUrl);
  }
  if (pathname.startsWith('/api/v1/3d/jobs/') && method === 'GET') {
    const jobId = decodeURIComponent(pathname.slice('/api/v1/3d/jobs/'.length));
    return _handleGetJob(res, jobId);
  }

  if (pathname === '/api/v1/3d/assets' && method === 'GET') {
    return _handleListAssets(res, parsedUrl);
  }
  if (pathname.startsWith('/api/v1/3d/assets/') && pathname.includes('/download/') && method === 'GET') {
    const parts = pathname.slice('/api/v1/3d/assets/'.length).split('/download/');
    const assetId = decodeURIComponent(parts[0]);
    const format = decodeURIComponent(parts[1] || 'glb');
    return handleDownloadAssetFile(res, assetId, format);
  }
  if (pathname.startsWith('/api/v1/3d/assets/') && method === 'GET') {
    // `/refine` and `/refine/stream` belong to the refine-fork controller; matching them here
    // would answer the fork route with an asset row instead of letting its own router reply.
    if (/\/refine(\/|$)/.test(pathname)) return false;
    const assetId = decodeURIComponent(pathname.slice('/api/v1/3d/assets/'.length));
    return _handleGetAsset(res, assetId);
  }

  if (pathname === '/api/v1/3d/telemetry' && method === 'GET') {
    return _handleGetTelemetry(res, parsedUrl);
  }

  return false;
}

module.exports = {
  handleModel3DRoutes
};
