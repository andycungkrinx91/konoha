'use strict';

/**
 * 3D Asset Refine (fork) Controller for the Yamanaka Generative 3D Subsystem.
 *
 * POST /api/v1/3d/assets/:assetId/refine forks a brand-new job + asset from an existing
 * asset using a user edit prompt. The parent's spec, photos and promoted files are read
 * only: the child job carries the parent lineage and runs the graph from validate_pre,
 * skipping object_brief and synthesize_dsl.
 *
 * Failure contract: an empty instruction is a 4xx, and an instruction that cannot be
 * expressed on the parent spec fails the child job with an explicit error code before any
 * synthesis happens. Nothing is ever "recorded and ignored".
 */

const crypto = require('crypto');
const { sendJson, parseBody } = require('./common');
const { getConnection } = require('../../db');
const { getJobById, getAssetById } = require('../../mcp/three_asset/db_3d_schema');
const { resolveQualityLevel, expandLevelOptions, LEVEL_ORDER } = require('../../mcp/three_asset/quality_levels');
const { runYamanaka3DGraph } = require('../../workflow/yamanaka/graph');
const { validateRefineParent, resolveParentSpec, applyRefineIntent } = require('../../workflow/yamanaka/refine_stage');

const REFINE_ROUTE_PATTERN = /^\/api\/v1\/3d\/assets\/([^/]+)\/refine\/?$/;
const MAX_INSTRUCTION_LENGTH = 500;

const activeRefineStreams = new Map();

function _registerRefineClient(jobId, res) {
  if (!activeRefineStreams.has(jobId)) activeRefineStreams.set(jobId, new Set());
  activeRefineStreams.get(jobId).add(res);
  res.on('close', () => {
    const clients = activeRefineStreams.get(jobId);
    if (!clients) return;
    clients.delete(res);
    if (clients.size === 0) activeRefineStreams.delete(jobId);
  });
}

function _broadcastRefineEvent(jobId, eventData) {
  const clients = activeRefineStreams.get(jobId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch { /* intentional best-effort fallback: response already committed */ }
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function matchRefinePath(pathname) {
  const match = String(pathname || '').match(REFINE_ROUTE_PATTERN);
  return match ? safeDecode(match[1]) : null;
}

/**
 * Resolves the parent asset + job and validates that a fork is possible. Returns either
 * `{ statusCode, body }` for an HTTP rejection or `{ asset, job }` for a valid parent.
 */
function loadRefineParent(conn, assetId) {
  const asset = getAssetById(conn, assetId);
  const job = asset ? getJobById(conn, asset.job_id) : null;
  const parentError = validateRefineParent(job, asset, assetId);
  if (parentError) {
    const statusCode = parentError.error_code === 'PARENT_ASSET_NOT_FOUND' ? 404 : 409;
    return { statusCode, body: { success: false, error: parentError.error, error_code: parentError.error_code } };
  }
  return { asset, job };
}

/** Validates the instruction against the parent spec without synthesizing anything. */
function preflightRefineInstruction(parentJob, parentAsset, instruction) {
  const { spec } = resolveParentSpec(parentJob, parentAsset);
  if (!spec) {
    return {
      statusCode: 409,
      body: {
        success: false,
        error_code: 'PARENT_SPEC_MISSING',
        error: `Parent job '${parentJob.job_id}' has no persisted scene spec to refine`
      }
    };
  }
  const applied = applyRefineIntent(instruction, spec);
  if (applied.error_code) {
    return {
      statusCode: 422,
      body: { success: false, error_code: applied.error_code, error: applied.error }
    };
  }
  return { parentSpec: spec, intent: applied.intent };
}

function _resolveLevelOptions(body) {
  const quality = resolveQualityLevel(body.quality_preset);
  if (body.quality_preset !== undefined && body.quality_preset !== null && body.quality_preset !== ''
    && !quality.known) {
    return { error: `Unknown quality_preset "${body.quality_preset}"`, allowed: [...LEVEL_ORDER] };
  }
  return { levelOptions: expandLevelOptions(quality.id, { target_polycount: body.target_polycount }) };
}

function _dispatchRefineFork(jobId, ctx) {
  const { nonce, parentJob, parentAsset, instruction, body, levelOptions } = ctx;
  setImmediate(async () => {
    try {
      _broadcastRefineEvent(jobId, {
        event: 'refine_started',
        job_id: jobId,
        parent_job_id: parentJob.job_id,
        parent_asset_id: parentAsset.asset_id,
        timestamp: new Date().toISOString()
      });
      const graphResult = await runYamanaka3DGraph(
        {
          job_id: jobId,
          nonce,
          refine_mode: true,
          parent_job_id: parentJob.job_id,
          parent_asset_id: parentAsset.asset_id,
          refine_instruction: instruction,
          parent_job: parentJob,
          parent_asset: parentAsset,
          prompt: parentJob.prompt || '',
          archetype: parentJob.domain_archetype || 'auto',
          profile: parentJob.profile || 'enterprise_pbr',
          quality_preset: levelOptions.quality_preset,
          requested_compute_mode: body.requested_compute_mode || parentJob.requested_compute_mode || 'auto',
          requested_gpu_backend: body.requested_gpu_backend || parentJob.requested_gpu_backend || null,
          target_polycount: levelOptions.target_polycount,
          model: body.model || null
        },
        { configurable: { onAction: (action) => _broadcastRefineEvent(jobId, action) } }
      );
      _broadcastRefineEvent(jobId, {
        event: 'refine_completed',
        job_id: jobId,
        asset_id: graphResult.asset_id,
        parent_asset_id: parentAsset.asset_id,
        status: graphResult.status,
        refine_diff: graphResult.refine_diff,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      _broadcastRefineEvent(jobId, {
        event: 'refine_failed',
        job_id: jobId,
        error_code: err.code || 'REFINE_FAILED',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });
}

async function handleRefineAsset(req, res, ctx) {
  const [assetId] = ctx.routeArgs;
  try {
    const body = await parseBody(req, res);
    if (!body) return true;

    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) {
      return sendJson(res, 400, { success: false, error_code: 'REFINE_INSTRUCTION_REQUIRED', error: 'instruction is required' });
    }
    if (instruction.length > MAX_INSTRUCTION_LENGTH) {
      return sendJson(res, 400, {
        success: false,
        error_code: 'REFINE_INSTRUCTION_TOO_LONG',
        error: `instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer`
      });
    }

    const level = _resolveLevelOptions(body);
    if (level.error) {
      return sendJson(res, 400, { success: false, error: level.error, allowed_quality_levels: level.allowed });
    }

    const conn = getConnection();
    if (!assetId) {
      return sendJson(res, 400, { success: false, error_code: 'REFINE_ASSET_ID_REQUIRED', error: 'assetId is required' });
    }
    const parent = loadRefineParent(conn, assetId);
    if (parent.statusCode) return sendJson(res, parent.statusCode, parent.body);

    const preflight = preflightRefineInstruction(parent.job, parent.asset, instruction);
    if (preflight.statusCode) return sendJson(res, preflight.statusCode, preflight.body);

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nonce = crypto.randomBytes(8).toString('hex');
    sendJson(res, 202, {
      success: true,
      job_id: jobId,
      nonce,
      status: 'pending',
      parent_job_id: parent.job.job_id,
      parent_asset_id: parent.asset.asset_id,
      refine_instruction: instruction,
      refine_plan: {
        targets: preflight.intent.targets,
        tokens: preflight.intent.tokens,
        scale_factor: preflight.intent.scaleFactor,
        skipped_stages: ['object_brief', 'synthesize_dsl']
      },
      stream_url: `/api/v1/3d/generate/${jobId}/stream`,
      live_glb_url: `/api/v1/3d/staging/${jobId}/live.glb`,
      live_png_url: `/api/v1/3d/staging/${jobId}/live.png`
    });

    _dispatchRefineFork(jobId, {
      nonce,
      parentJob: parent.job,
      parentAsset: parent.asset,
      instruction,
      body,
      levelOptions: level.levelOptions
    });
    return true;
  } catch (err) {
    return sendJson(res, 500, { success: false, error: err.message });
  }
}

/** GET /api/v1/3d/assets/:assetId/refine/stream — fork progress for a refine job. */
function handleRefineStream(_req, res, ctx) {
  const [, jobId] = ctx.routeArgs;
  const job = getJobById(getConnection(), jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`data: ${JSON.stringify({ event: 'connected', job_id: jobId, job })}\n\n`);
  _registerRefineClient(jobId, res);
  return true;
}

async function routeRefineForkRequests(req, res, _ctx, ...routeArgs) {
  const [pathname, method] = routeArgs;
  if (!pathname || !pathname.startsWith('/api/v1/3d/assets/')) return false;

  const streamMatch = String(pathname).match(/^\/api\/v1\/3d\/assets\/([^/]+)\/refine\/stream\/?$/);
  if (streamMatch) {
    if (method !== 'GET') {
      return sendJson(res, 405, { success: false, error_code: 'METHOD_NOT_ALLOWED', error: 'Use GET to stream a refine job' });
    }
    return handleRefineStream(req, res, { routeArgs: [safeDecode(streamMatch[1])] });
  }

  const assetId = matchRefinePath(pathname);
  if (!assetId) return false;
  if (method !== 'POST') {
    return sendJson(res, 405, { success: false, error_code: 'METHOD_NOT_ALLOWED', error: 'Use POST to refine an asset' });
  }
  return handleRefineAsset(req, res, { routeArgs: [assetId] });
}

module.exports = {
  routeRefineForkRequests,
  loadRefineParent,
  preflightRefineInstruction
};
