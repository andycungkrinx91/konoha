'use strict';

/**
 * Inspect/fix stage of the Yamanaka 3D workflow: objective silhouette, symmetry and
 * bounding-box checks run in plain code; vision critique is only consulted when a
 * code gate fails. The fix node converts the critique into a small part patch.
 */

const { getConnection } = require('../../db');
const { updateJobStage, record3DLlmRequest } = require('../../mcp/three_asset/db_3d_schema');
const { critiqueRender } = require('../../mcp/three_asset/vision_spec');
const { maskIoU, boxRatioOk, symmetryScore } = require('../../mcp/three_asset/silhouette');
const { buildTargets, shouldStopIterating } = require('../../mcp/three_asset/archetype_policy');

const SIZE_MULTIPLIERS = { increase: (v, a) => v * (1 + a), decrease: (v, a) => Math.max(0.001, v * (1 - a)) };
const POSITION_DELTAS = { move_positive: (v, a) => v + a * 0.05, move_negative: (v, a) => v - a * 0.05 };

function deriveCodeScore(silhouetteIoU, sym, symmetryMin = 0.75, boxOk = null) {
  const m1 = silhouetteIoU === null || silhouetteIoU === undefined ? 1.0 : Number(silhouetteIoU);
  const m2 = sym === null || sym === undefined ? 1.0 : (Number(sym) >= symmetryMin ? 1.0 : 0.0);
  const m3 = boxOk === null || boxOk === undefined ? 1.0 : (boxOk !== false ? 1.0 : 0.0);
  const avg = (m1 + m2 + m3) / 3.0;
  return Math.min(100, Math.max(0, Math.round(100 * avg)));
}

async function nodeInspect(state) {
  const conn = getConnection();
  const targets = state.archetypeTargets || buildTargets(state.domainArchetype, state.qualityPreset, state.objectBrief);
  const refMaskPath = state.referenceAnalysis?.reference_mask_path || null;
  const silhouette_iou = maskIoU(state.inspectionGridPath, refMaskPath);
  const expectedRatioSource = state.referenceAnalysis
    || state.objectBrief?.proportions
    || state.objectBrief
    || targets.expectedHeightToWidthRatio
    || null;
  const box_ok = boxRatioOk(state.sceneReport || state.spec, expectedRatioSource, targets.boxRatioTolerance);
  const sym = symmetryScore(state.inspectionGridPath);

  const silhouetteThreshold = targets.silhouetteIoU ?? 0.8;
  const needsVision = (state.imagePath || refMaskPath)
    ? (silhouette_iou === null || silhouette_iou < silhouetteThreshold || box_ok === false)
    : (box_ok === false || (sym !== null && sym < (targets.symmetryMin ?? 0.75)));

  let visionUsed = false;
  let critique = null;
  let critiqueSummary = null;
  let score = 0;
  let tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 };
  let modelUsed = state.stageModels?.critique_model || null;

  if (needsVision) {
    const res = await critiqueRender({
      gridPath: state.inspectionGridPath,
      referencePath: state.imagePath,
      prompt: state.prompt,
      model: state.stageModels?.critique_model
    });
    if (res && res.critique && Number.isFinite(res.critique.score)) {
      visionUsed = true;
      critique = res.critique;
      critiqueSummary = res.critique.summary || '';
      score = Math.min(100, Math.max(0, Math.round(res.critique.score)));
      tokens = res.tokens || tokens;
      modelUsed = res.model_used || modelUsed;
    } else {
      visionUsed = false;
      score = deriveCodeScore(silhouette_iou, sym, targets.symmetryMin, box_ok);
      critique = null;
      critiqueSummary = res?.fallback_reason || 'code_metrics_fallback';
      tokens = res?.tokens || tokens;
      modelUsed = res?.model_used || modelUsed;
    }
  } else {
    visionUsed = false;
    score = deriveCodeScore(silhouette_iou, sym, targets.symmetryMin, box_ok);
    critique = null;
    critiqueSummary = null;
  }

  const iteration = state.iteration || 1;
  const totalTok = tokens.total_tokens || tokens.total || 0;
  if (totalTok > 0) {
    record3DLlmRequest(conn, {
      job_id: state.jobId,
      request_kind: 'image_vision',
      provider: 'yamanaka_router',
      model: modelUsed || 'inherited',
      input_tokens: tokens.input_tokens || 0,
      output_tokens: tokens.output_tokens || 0,
      total_tokens: totalTok,
      token_source: tokens.token_source || 'provider_usage',
      est_cost_usd: tokens.est_cost_usd || 0.0
    });
  }

  const latest = {
    iteration,
    score,
    silhouette_iou,
    box_ratio_ok: box_ok,
    symmetry: sym,
    vision_used: visionUsed,
    tokens: {
      input_tokens: tokens.input_tokens || 0,
      output_tokens: tokens.output_tokens || 0,
      total_tokens: totalTok,
      est_cost_usd: tokens.est_cost_usd || 0.0
    },
    critique_summary: critiqueSummary
  };

  const history = [...(state.iterationHistory || []), latest];
  updateJobStage(conn, state.jobId, {
    iteration_history_json: JSON.stringify(history),
    status: 'inspecting'
  });

  const hasActionableCritique = Boolean(
    critique && Array.isArray(critique.issues) && critique.issues.length > 0
  );
  const shouldStop = shouldStopIterating(history, targets) || !hasActionableCritique;

  return {
    status: 'inspecting',
    iterationHistory: history,
    lastIteration: latest,
    critique,
    inspectShouldStop: Boolean(shouldStop)
  };
}

function applySizeFix(node, fix, idx, amount) {
  const currentSize = [...(node.part?.size || node.geometry?.params?.size || node.transform?.scale || [1, 1, 1])];
  while (currentSize.length < 3) currentSize.push(1);
  const factor = fix.direction === 'decrease' ? Math.max(0.6, 1 - amount) : (1 + amount);
  currentSize[idx] = Math.max(0.001, Number((currentSize[idx] * factor).toFixed(4)));
  if (!node.geometry) node.geometry = { type: 'box', params: {} };
  if (!node.geometry.params) node.geometry.params = {};
  node.geometry.params.size = currentSize.slice();
  if (node.part) node.part.size = currentSize.slice();
  if (node.transform) node.transform.scale = currentSize.slice();
  return currentSize;
}

function applyPositionFix(node, fix, idx, amount) {
  const currentPos = [...(node.part?.position || node.transform?.position || [0, 0, 0])];
  while (currentPos.length < 3) currentPos.push(0);
  const delta = (fix.direction === 'move_negative' ? -1 : 1) * amount * 0.05;
  currentPos[idx] = Number((currentPos[idx] + delta).toFixed(4));
  if (!node.transform) node.transform = { position: [0, 0, 0] };
  node.transform.position = currentPos.slice();
  if (node.part) node.part.position = currentPos.slice();
  return currentPos;
}

function applyMaterialFix(node, fix) {
  const mat = fix.material || {};
  node.material = { ...node.material, ...mat };
  if (node.part) node.part.material = { ...node.part.material, ...mat };
  return mat;
}

function syncMatchingPart(parts, targetName, set) {
  const matchingPart = parts.find(
    (p) => p.name === targetName || (p.name && p.name.toLowerCase() === targetName.toLowerCase())
  );
  if (!matchingPart) return;
  if (set.size) matchingPart.size = set.size.slice();
  if (set.position) matchingPart.position = set.position.slice();
  if (set.material) matchingPart.material = { ...matchingPart.material, ...set.material };
}

async function nodeFix(state) {
  const issues = state.critique?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return { pendingPatch: null };
  }

  const nextSpec = JSON.parse(JSON.stringify(state.spec || {}));
  const nodes = Array.isArray(nextSpec.nodes) ? nextSpec.nodes : [];
  const parts = Array.isArray(nextSpec.parts) ? nextSpec.parts : [];
  const patchList = [];

  for (const issue of issues) {
    if (!issue || !issue.part || !issue.fix) continue;
    const targetName = String(issue.part).trim();
    const node = nodes.find((n) => n.name === targetName)
      || nodes.find((n) => n.name && n.name.toLowerCase() === targetName.toLowerCase());
    if (!node) continue;

    const fix = issue.fix;
    const idx = Number.isInteger(fix.index) && fix.index >= 0 && fix.index <= 2 ? fix.index : 0;
    const amount = Number.isFinite(Number(fix.amount)) ? Math.abs(Number(fix.amount)) : 0.1;
    const set = {};

    if (fix.axis === 'size') set.size = applySizeFix(node, fix, idx, amount);
    else if (fix.axis === 'position') set.position = applyPositionFix(node, fix, idx, amount);
    else if (fix.axis === 'material') set.material = applyMaterialFix(node, fix);

    if (Object.keys(set).length > 0) {
      patchList.push({ node: node.name, set });
      syncMatchingPart(parts, targetName, set);
    }
  }

  if (patchList.length === 0) {
    return { pendingPatch: null };
  }
  const iteration = state.iteration || 1;
  return {
    spec: nextSpec,
    pendingPatch: patchList,
    patchesApplied: [
      ...(state.patchesApplied || []),
      { iteration, patches: patchList }
    ]
  };
}

function routeInspection(state) {
  if (state.inspectShouldStop) return 'stop';
  return 'fix';
}

module.exports = {
  deriveCodeScore,
  nodeInspect,
  nodeFix,
  routeInspection,
  SIZE_MULTIPLIERS,
  POSITION_DELTAS
};
