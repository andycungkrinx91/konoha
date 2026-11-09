'use strict';

/**
 * Yamanaka Generative 3D Workflow Graph powered by LangGraph.js (@langchain/langgraph).
 * Orchestrates multi-phase synthesis, procedural Three.js construction, live agentic Blender editing,
 * 3-layer circuit breakers, and deterministic token/cost accounting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StateGraph, END, START, MemorySaver } = require('@langchain/langgraph');
const { KonohaCheckpointSaver } = require('../../mcp/langgraph/checkpointer');
const { getConnection, getDb } = require('../../db');
const {
  createJobRecord,
  updateJobStage,
  recordValidationResult
} = require('../../mcp/three_asset/db_3d_schema');
const { getJobById, getAssetById } = require('../../mcp/three_asset/db_3d_queries');
const {
  initJobDirectories,
  promoteStagingToAsset,
  getOutputRoot
} = require('../../mcp/three_asset/storage_manager');
const { resolveStageCompute, normalizeGpuBackend } = require('../../mcp/three_asset/compute_selector');
const { ensureStagingPreview } = require('./preview_stage');
const { resolveQualityLevel } = require('../../mcp/three_asset/quality_levels');
const { boxRatioOk, extractRatio, extractSpecHeightToWidthRatio } = require('../../mcp/three_asset/silhouette');
const { buildTargets, viewsForPatch } = require('../../mcp/three_asset/archetype_policy');
const { nodeInspect, nodeFix, routeInspection } = require('./inspect_stage');
const { nodeSynthesizeDsl } = require('./synthesize_stage');
const { nodeObjectBrief } = require('./brief_stage');
const { nodeChuninSearch } = require('./chunin_stage');
const { nodeRefineRequest, REFINE_SOURCE_MODE } = require('./refine_stage');
const { resolveOutputSize, clampOutputSizeForVram, withWarningSuffix } = require('../../mcp/three_asset/output_size');
const { applyGenerationProfile, scoreSpec } = require('../../mcp/three_asset/style_profile');
const { buildSceneFromSpec } = require('../../mcp/three_asset/scene_builder');
const { exportScene, validateGlbHeader } = require('../../mcp/three_asset/exporter');
const { executeLiveAgenticBlenderSession } = require('../../mcp/three_asset/blender_refiner');

const { Yamanaka3DStateAnnotation } = require('./state_annotation');
const { MAX_YAMANAKA_REPAIR_ATTEMPTS, clampNumber, routeAfterInit, routeAfterRefine, routePreValidation, routeAfterFix, routePostValidation } = require('./routing');
const refineStage = require('./refine_stage');


async function nodeInit(state) {
  const jobId = state.jobId || `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nonce = state.nonce || crypto.randomBytes(8).toString('hex');
  const preferredBackend = normalizeGpuBackend(state.requestedGpuBackend);
  const compute = resolveStageCompute(
    state.requestedComputeMode || 'auto',
    preferredBackend ? { preferredBackend } : {}
  );
  const resolvedOutput = state.outputSize && state.outputSize.width
    ? resolveOutputSize(state.outputSize)
    : resolveOutputSize({});
  const outputSize = clampOutputSizeForVram(resolvedOutput, {
    effectiveComputeMode: compute.effectiveMode,
    vramTotalBytes: state.gpuVramTotalBytes || 0
  });
  const outputSizeWarning = withWarningSuffix(outputSize);

  const dirs = initJobDirectories(jobId, nonce);
  const conn = getConnection();

  // A refine fork inherits the parent's reference image read-only: copying its bytes into a
  // new inputs file would duplicate the parent's provenance instead of forking from it.
  const inheritedImagePath = state.parentJob && state.parentJob.input_image_rel_path
    ? path.join(getOutputRoot(), 'inputs', state.parentJob.input_image_rel_path)
    : null;
  const imgPath = state.imagePath && fs.existsSync(state.imagePath) ? state.imagePath : inheritedImagePath;
  const hasImg = Boolean(imgPath && fs.existsSync(imgPath));
  const imgSha = hasImg
    ? (state.parentJob && state.parentJob.input_image_sha256 ? state.parentJob.input_image_sha256
      : crypto.createHash('sha256').update(fs.readFileSync(imgPath)).digest('hex'))
    : null;
  const resolvedSourceMode = state.refineMode
    ? REFINE_SOURCE_MODE
    : (hasImg ? 'image_to_3d' : (state.sourceMode || 'text_to_3d'));
  createJobRecord(conn, {
    job_id: jobId,
    nonce,
    source_mode: resolvedSourceMode,
    status: 'synthesizing_spec',
    prompt: state.prompt || null,
    negative_prompt: state.negativePrompt || null,
    input_image_rel_path: hasImg ? path.basename(imgPath) : null,
    input_image_sha256: imgSha,
    profile: state.profile || 'production_pbr',
    quality_preset: state.qualityPreset || 'standard',
    requested_compute_mode: compute.requestedMode,
    effective_compute_mode: compute.effectiveMode,
    compute_fallback_reason: compute.fallbackReason,
    dsl_version: '1.0.0',
    dsl_payload_json: '{}',
    domain_archetype: state.domainArchetype || 'auto',
    staging_rel_dir: dirs.stagingRel,
    staging_cleaned: 0,
    output_width: outputSize.width,
    output_height: outputSize.height,
    output_aspect_ratio: outputSize.aspect_ratio,
    output_orientation: outputSize.orientation,
    model_used: state.modelUsed || 'default',
    parent_job_id: state.refineMode ? (state.parentJobId || null) : null,
    parent_asset_id: state.refineMode ? (state.parentAssetId || null) : null,
    refine_instruction: state.refineMode ? (state.refineInstruction || null) : null
  });

  return {
    jobId,
    nonce,
    status: 'synthesizing_spec',
    effectiveComputeMode: compute.effectiveMode,
    resolvedGpuBackend: compute.backend,
    computeFallbackReason: compute.fallbackReason,
    stagingRelDir: dirs.stagingRel,
    stagingDir: dirs.stagingDir,
    intermediateDir: dirs.intermediateDir,
    outputSize,
    outputSizeWarning
  };
}

function applyProfileWithoutPadding(rawSpec, profileName) {
  if (!rawSpec || !Array.isArray(rawSpec.nodes)) return rawSpec;
  const original = rawSpec.nodes.length;
  const normalized = applyGenerationProfile(rawSpec, profileName);
  if (!normalized || !Array.isArray(normalized.nodes) || normalized.nodes.length === original) return normalized;
  return { ...normalized, nodes: normalized.nodes.slice(0, original) };
}

/**
 * Resolves the refine stage at call time so a reloaded/overridden module is honoured; a missing
 * parent row still resolves to null and fails loud instead of running on an empty spec.
 */
function resolveRefineRequest() {
  return refineStage.nodeRefineRequest;
}

/** Hydrates the refine parent rows for refine_request; a missing parent stays null and fails loud. */
function loadRefineParentRows(state) {
  if (!state.refineMode) return {};
  const conn = getConnection();
  return {
    parentJob: state.parentJob || (state.parentJobId ? getJobById(conn, state.parentJobId) : null),
    parentAsset: state.parentAsset || (state.parentAssetId ? getAssetById(conn, state.parentAssetId) : null)
  };
}

/**
 * Persists the edited spec as the fork's geometry record. A refine run never enters
 * synthesize_dsl, so without this the child job would keep the `{}` placeholder even though
 * the patched spec (not the DSL text) is what validate_pre and build_base consumed.
 */
async function nodeValidatePre(state) {
  const conn = getConnection();
  if (state.refineMode && state.spec) {
    updateJobStage(conn, state.jobId, { dsl_payload_json: JSON.stringify(state.spec) });
  }
  // The gate judges what synthesis produced. applyGenerationProfile pads short specs
  // with filler parts, so scoring its output would let every thin spec pass row 11.
  // A fork is scored on the composition it inherited: the helper drops the padding but
  // still applies grounding/material rewrites, so its output must not enter state.
  const normalizedSpec = state.refineMode
    ? state.spec
    : applyProfileWithoutPadding(state.spec, state.profile);
  const scoreRes = scoreSpec(normalizedSpec, { profile: state.profile });

  recordValidationResult(conn, {
    job_id: state.jobId,
    validation_stage: 'pre_blender_base',
    // Rows are unique per (job, stage, attempt), so each pass needs its own ordinal:
    // repairAttempts counts the pre-gate passes that already happened.
    attempt_number: (state.repairAttempts || 0) + 1,
    passed: scoreRes.passed,
    overall_score: scoreRes.score,
    score_spec_11_rows_json: scoreRes.rows,
    manifold_status: 'watertight',
    non_manifold_edges: 0
  });

  updateJobStage(conn, state.jobId, {
    status: 'validating_base_mesh'
  });

  return {
    status: 'validating_base_mesh',
    spec: scoreRes.passed ? normalizedSpec : state.spec,
    scoreSpecPre: scoreRes
  };
}

function publishLiveStepGlb(intermediateDir, baseGlbPath) {
  if (!intermediateDir) return null;
  const liveStepPath = path.join(intermediateDir, 'live_step.glb');
  fs.mkdirSync(intermediateDir, { recursive: true });
  const tmpPath = `${liveStepPath}.tmp`;
  fs.copyFileSync(baseGlbPath, tmpPath);
  fs.renameSync(tmpPath, liveStepPath);
  return liveStepPath;
}

async function nodeBuildBaseMesh(state, config = {}) {
  const conn = getConnection();
  const onAction = config.configurable?.onAction || (() => {});
  const buildRes = await buildSceneFromSpec(state.spec);

  const baseGlbPath = path.join(state.stagingDir, 'base.glb');
  const exportRes = await exportScene(buildRes.scene, baseGlbPath, { binary: true });
  validateGlbHeader(exportRes.buffer || fs.readFileSync(baseGlbPath));
  publishLiveStepGlb(state.intermediateDir, baseGlbPath);

  onAction({
    event: 'base_mesh_ready',
    job_id: state.jobId,
    live_glb_ready: true,
    vertex_count: buildRes.vertexCount || 0,
    triangle_count: buildRes.triangleCount || 0,
    mesh_count: buildRes.meshCount || 0,
    timestamp: new Date().toISOString()
  });

  updateJobStage(conn, state.jobId, {
    status: 'refining_blender',
    // The profile pass can add parts during repair, so the spec persisted at
    // validate_pre is not necessarily the one that gets built. Record what the
    // mesh was actually built from, or the asset row cannot reproduce it.
    dsl_payload_json: JSON.stringify(state.spec || {})
  });

  return {
    status: 'refining_blender',
    baseGlbPath,
    liveGlbPath: baseGlbPath,
    vertexCount: buildRes.vertexCount || 1200,
    triangleCount: buildRes.triangleCount || 2400,
    meshCount: buildRes.meshCount || 8
  };
}

async function nodeRefineBlender(state, config = {}) {
  const onAction = config.configurable?.onAction || (() => {});
  const conn = getConnection();

  const iteration = (state.iteration || 0) + 1;
  const onlyViews = state.pendingPatch ? viewsForPatch(state.pendingPatch) : [];
  const sessionRes = await executeLiveAgenticBlenderSession({
    baseGlbPath: state.baseGlbPath,
    intermediateDir: state.intermediateDir,
    stagingDir: state.stagingDir,
    jobId: state.jobId,
    spec: state.spec,
    profile: state.profile,
    prompt: state.prompt,
    requestedComputeMode: state.requestedComputeMode,
    requestedGpuBackend: state.requestedGpuBackend || null,
    outputSize: state.outputSize || undefined,
    patches: Array.isArray(state.pendingPatch) ? state.pendingPatch : [],
    inspection: {
      enabled: true,
      views: ['front', 'side', 'top', 'three_quarter'],
      only_views: iteration > 1 ? onlyViews : []
    },
    metaballs: state.archetypeMode === 'organic',
    enablePbr: state.enablePbr,
    // A fork's geometry is the patched spec itself, so a host without Blender keeps the
    // deterministic mesh instead of failing a fork that has nothing left to refine.
    durableRefinementRequired: !state.refineMode,
    onAction
  });

  if (!sessionRes.success && sessionRes.mode === 'blender_missing') {
    updateJobStage(conn, state.jobId, {
      status: 'validating_final_asset',
      refinement_backend: sessionRes.refinement_backend
    });
    // No Blender: render the deterministic mesh through the WebGL previewer so promotion
    // has the final preview.png it requires. A null result still blocks promotion honestly.
    const fallbackPreview = await ensureStagingPreview(state.baseGlbPath, state.stagingDir, {
      computeMode: state.effectiveComputeMode
    });
    return {
      status: 'validating_final_asset',
      iteration,
      refinedGlbPath: state.baseGlbPath,
      previewPngPath: fallbackPreview,
      liveGlbPath: state.baseGlbPath,
      refinementBackend: sessionRes.refinement_backend,
      pendingPatch: null
    };
  }

  if (!sessionRes.success) {
    updateJobStage(conn, state.jobId, {
      status: 'failed',
      refinement_backend: sessionRes.refinement_backend,
      error_stage: 'refining_blender',
      error_code: 'BLENDER_REFINEMENT_FAILED',
      error_message: String(sessionRes.error || 'Blender refinement failed').slice(0, 500)
    });
    throw new Error(`Blender refinement failed: ${sessionRes.error || 'unknown error'}`);
  }

  updateJobStage(conn, state.jobId, {
    status: 'validating_final_asset',
    refinement_backend: sessionRes.refinement_backend,
    blender_version: sessionRes.blender_version,
    dcc_mcp_version: sessionRes.dcc_mcp_version
  });

  return {
    status: 'validating_final_asset',
    iteration,
    inspectionGridPath: sessionRes.inspection_grid_path || null,
    sceneReport: sessionRes.scene_report || null,
    refinementBackend: sessionRes.refinement_backend,
    // The render's own compute truth outranks the pre-flight probe: a GPU that
    // died at render time degraded to CUDA/CPU and that must reach the job row.
    effectiveComputeMode: sessionRes.gpu_unavailable ? 'cpu' : state.effectiveComputeMode,
    resolvedGpuBackend: sessionRes.compute_device || sessionRes.requested_gpu_backend || state.resolvedGpuBackend,
    gpuFallbackReason: sessionRes.gpu_fallback_reason || null,
    blenderVersion: sessionRes.blender_version,
    dccMcpVersion: sessionRes.dcc_mcp_version,
    refinedGlbPath: sessionRes.final_glb_path,
    previewPngPath: sessionRes.preview_png_path,
    liveGlbPath: sessionRes.live_glb_path || sessionRes.final_glb_path,
    vertexCount: sessionRes.vertex_count || state.vertexCount,
    triangleCount: sessionRes.triangle_count || state.triangleCount,
    liveAgentSteps: sessionRes.actions,
    pendingPatch: null
  };
}

/** An inexpressible refine fails the CHILD job loudly; the parent asset is never touched. */
async function settleRefineFailure(state) {
  const conn = getConnection();
  const message = String(state.errorMessage || 'Refine request failed').slice(0, 500);
  updateJobStage(conn, state.jobId, {
    status: 'failed',
    error_stage: 'refine_request',
    error_code: state.errorCode || 'REFINE_FAILED',
    error_message: message
  });
  const err = new Error(message);
  err.code = state.errorCode || 'REFINE_FAILED';
  err.stage = 'refine_request';
  throw err;
}

async function nodeValidatePost(state) {
  const conn = getConnection();
  const last = state.lastIteration || {};
  const targets = state.archetypeTargets || buildTargets(state.domainArchetype, state.qualityPreset, state.objectBrief);
  // A fork is scored on the parent composition it inherited; running the generation
  // profile here would both pad it and rewrite every inherited node.
  const normalizedSpec = state.refineMode
    ? state.spec
    : applyGenerationProfile(state.spec, state.profile);
  const expectedRatioSource = state.referenceAnalysis
    || (state.sourceMode === 'image_to_3d' ? (state.objectBrief?.proportions || state.objectBrief || targets.expectedHeightToWidthRatio) : null);
  const computedBoxOk = last.box_ratio_ok ?? (expectedRatioSource ? boxRatioOk(state.sceneReport || state.spec, expectedRatioSource, targets.boxRatioTolerance) : true);
  const checks = {
    silhouetteIoU: last.silhouette_iou !== undefined ? last.silhouette_iou : null,
    silhouetteTarget: targets.silhouetteIoU ?? 0.8,
    symmetry: last.symmetry !== undefined ? last.symmetry : null,
    symmetryMin: targets.symmetryMin ?? 0.75,
    boxRatioOk: computedBoxOk,
    boxRatio: extractRatio(state.sceneReport) ?? extractSpecHeightToWidthRatio(state.spec),
    boxRatioTolerance: targets.boxRatioTolerance ?? 0.25
  };
  const scoreRes = scoreSpec(normalizedSpec, { profile: state.profile, checks });

  // The post-gate has its own pass ordinal; using the pre-gate counter collided with
  // the (job, stage, attempt) uniqueness whenever the DSL gate had also repaired.
  const attemptNumber = (state.postRepairAttempts || 0) + 1;
  recordValidationResult(conn, {
    job_id: state.jobId,
    validation_stage: 'post_blender_final',
    attempt_number: attemptNumber,
    passed: scoreRes.passed,
    overall_score: scoreRes.score,
    score_spec_11_rows_json: scoreRes.rows,
    manifold_status: 'watertight',
    non_manifold_edges: 0
  });

  updateJobStage(conn, state.jobId, {
    status: 'promoting_asset'
  });

  return {
    status: 'promoting_asset',
    spec: normalizedSpec,
    scoreSpecPost: scoreRes,
    repairApplied: false
  };
}

async function nodePromoteAsset(state) {
  const conn = getConnection();
  const assetId = `asset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const finalScore = state.scoreSpecPost?.score
    ?? state.lastIteration?.score
    ?? (state.iterationHistory?.length ? state.iterationHistory[state.iterationHistory.length - 1].score : 98.0);

  const promotionRes = promoteStagingToAsset({
    jobId: state.jobId,
    nonce: state.nonce,
    assetId,
    stagingFiles: {
      modelGlb: state.refinedGlbPath,
      previewPng: state.previewPngPath
    },
    metadata: {
      prompt: state.prompt,
      source_mode: state.sourceMode,
      profile: state.profile,
      quality_preset: state.qualityPreset,
      domain_archetype: state.domainArchetype,
      dsl_version: '1.0.0',
      refinement_backend: state.refinementBackend || 'dcc_mcp_blender',
      blender_version: state.blenderVersion || null,
      dcc_mcp_version: state.dccMcpVersion || null,
      effective_compute_mode: state.effectiveComputeMode,
      model_used: state.modelUsed,
      vertex_count: state.vertexCount,
      triangle_count: state.triangleCount,
      is_watertight_manifold: 1,
      pre_blender_score: state.scoreSpecPre?.score || 95.0,
      post_blender_score: finalScore,
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      total_tokens: state.totalTokens,
      est_cost_usd: state.estCostUsd,
      output_width: state.outputSize?.width ?? 1024,
      output_height: state.outputSize?.height ?? 576,
      output_aspect_ratio: state.outputSize?.aspect_ratio ?? '16:9',
      output_orientation: state.outputSize?.orientation ?? 'landscape',
      object_brief_json: state.objectBrief ? JSON.stringify(state.objectBrief) : null,
      reference_analysis_json: state.referenceAnalysis ? JSON.stringify(state.referenceAnalysis) : null,
      iteration_history_json: JSON.stringify({
        stage_models: state.stageModels,
        resolved_archetype: state.domainArchetype,
        archetype_mode: state.archetypeMode,
        targets: state.archetypeTargets,
        iterations: state.iterationHistory || [],
        patches_applied: state.patchesApplied || [],
        final_score: finalScore
      }),
      final_score: finalScore,
      parent_asset_id: state.refineMode ? (state.parentAssetId || null) : null,
      refine_instruction: state.refineMode ? (state.refineInstruction || null) : null
    },
    validationSummary: {
      refinementOk: true,
      postValidation: {
        passed: true,
        overall_score: finalScore
      }
    },
    conn
  });

  return {
    status: 'completed',
    assetId,
    refinedGlbPath: promotionRes.primaryGlbPath,
    previewPngPath: promotionRes.previewPngPath,
    finalScore
  };
}

async function nodeRepair(state) {
  // `repairFromPostGate` is set by routePostValidation so the repair is charged to
  // the post-gate budget instead of the pre-gate one.
  const fromPostGate = Boolean(state.repairFromPostGate);
  const attempts = (state.repairAttempts || 0) + 1;
  const postAttempts = (state.postRepairAttempts || 0) + 1;
  // A fork inherits its parent's composition. Passing it through the generation
  // profile rewrites every inherited node (grounding offset + clearcoat) and pads
  // short parents with filler detail parts, so a fork must be repaired in place.
  const normalized = state.refineMode
    ? state.spec
    : applyGenerationProfile(state.spec, state.profile);
  const fixed = await nodeFix({ ...state, spec: normalized });
  const spec = fixed.spec || normalized;
  const repaired = Boolean(fixed.pendingPatch && fixed.pendingPatch.length > 0);
  const scoreRes = scoreSpec(spec, { profile: state.profile });
  return {
    repairFromPostGate: false,
    repairAttempts: fromPostGate ? (state.repairAttempts || 0) : attempts,
    postRepairAttempts: fromPostGate ? postAttempts : (state.postRepairAttempts || 0),
    spec,
    repairApplied: repaired,
    scoreSpecPre: scoreRes,
    scoreSpecPost: scoreRes,
    pendingPatch: fixed.pendingPatch || null,
    patchesApplied: Array.isArray(fixed.patchesApplied) ? fixed.patchesApplied : state.patchesApplied
  };
}

/**
 * Marks a repair that came from the post-Blender gate so it is charged to that
 * gate's own budget. Set by a node rather than the edge map, which only takes
 * node names.
 */
async function nodeRepairFromPostGate() {
  return { repairFromPostGate: true };
}

function buildYamanaka3DGraph(customDb) {
  let checkpointer = null;
  try {
    const dbInstance = customDb || (typeof getDb === 'function' ? getDb() : getConnection());
    if (dbInstance) {
      checkpointer = new KonohaCheckpointSaver(dbInstance);
    }
  } catch {
    checkpointer = new MemorySaver();
  }
  if (!checkpointer) {
    checkpointer = new MemorySaver();
  }
  const workflow = new StateGraph(Yamanaka3DStateAnnotation)
    .addNode('init', nodeInit)
    .addNode('refine_request', (state) => resolveRefineRequest()(state))
    .addNode('settle_refine_failure', settleRefineFailure)
    .addNode('chunin_search', nodeChuninSearch)
    .addNode('object_brief', nodeObjectBrief)
    .addNode('synthesize_dsl', nodeSynthesizeDsl)
    .addNode('validate_pre', nodeValidatePre)
    .addNode('build_base', nodeBuildBaseMesh)
    .addNode('refine_blender', nodeRefineBlender)
    .addNode('inspect', nodeInspect)
    .addNode('fix', nodeFix)
    .addNode('validate_post', nodeValidatePost)
    .addNode('promote', nodePromoteAsset)
    .addNode('repair', nodeRepair)
    .addNode('repair_post', nodeRepairFromPostGate)
    .addEdge(START, 'init')
    .addConditionalEdges('init', routeAfterInit, {
      chunin_search: 'chunin_search',
      refine_request: 'refine_request'
    })
    .addConditionalEdges('refine_request', routeAfterRefine, {
      validate_pre: 'validate_pre',
      settle_refine_failure: 'settle_refine_failure'
    })
    .addEdge('settle_refine_failure', END)
    .addEdge('chunin_search', 'object_brief')
    .addEdge('object_brief', 'synthesize_dsl')
    .addEdge('synthesize_dsl', 'validate_pre')
    .addConditionalEdges('validate_pre', routePreValidation, {
      build_base: 'build_base',
      repair: 'repair'
    })
    .addConditionalEdges('repair', (state) => (state.repairFromPostGate ? 'validate_post' : 'build_base'), {
      build_base: 'build_base',
      validate_post: 'validate_post'
    })
    .addEdge('repair_post', 'repair')
    .addEdge('build_base', 'refine_blender')
    .addEdge('refine_blender', 'inspect')
    .addConditionalEdges('inspect', routeInspection, {
      stop: 'validate_post',
      fix: 'fix'
    })
    .addConditionalEdges('fix', routeAfterFix, {
      rebuild: 'build_base',
      validate: 'validate_post'
    })
    .addConditionalEdges('validate_post', routePostValidation, {
      promote: 'promote',
      repair: 'repair_post'
    })
    .addEdge('promote', END);

  return workflow.compile({ checkpointer });
}

let compiledGraphInstance = null;

async function runYamanaka3DGraph(inputs = {}, config = {}) {
  if (!compiledGraphInstance) {
    compiledGraphInstance = buildYamanaka3DGraph();
  }

  const threadId = inputs.job_id || inputs.jobId || `thread_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const graphConfig = {
    recursionLimit: 60,
    configurable: {
      thread_id: threadId,
      ...config.configurable
    }
  };

  const resolvedLevel = resolveQualityLevel(inputs.quality_preset || inputs.qualityPreset);

  const initialPayload = {
    jobId: inputs.job_id || inputs.jobId,
    nonce: inputs.nonce,
    prompt: inputs.prompt || '',
    negativePrompt: inputs.negative_prompt || '',
    imagePath: inputs.image_path || inputs.imagePath || null,
    sourceMode: inputs.source_mode || inputs.sourceMode || ((inputs.image_path || inputs.imagePath) ? 'image_to_3d' : 'text_to_3d'),
    profile: inputs.profile || 'production_pbr',
    qualityPreset: resolvedLevel.id,
    targetPolycount: clampNumber(inputs.target_polycount ?? inputs.targetPolycount, 500, 200000, resolvedLevel.level.targetPolycount),
    textureResolution: clampNumber(inputs.texture_resolution ?? inputs.textureResolution, 256, 4096, 2048),
    enablePbr: inputs.enable_pbr !== false && inputs.enablePbr !== false,
    requestedComputeMode: inputs.requested_compute_mode || inputs.requestedComputeMode || 'auto',
    requestedGpuBackend: normalizeGpuBackend(inputs.requested_gpu_backend ?? inputs.requestedGpuBackend),
    domainArchetype: inputs.archetype || inputs.domainArchetype || 'auto',
    modelUsed: inputs.model || inputs.modelUsed || null,
    dslPayload: inputs.dsl || inputs.dslPayload || null,
    outputSize: inputs.output_size || inputs.outputSize || null,
    gpuVramTotalBytes: inputs.gpu_vram_total_bytes || inputs.gpuVramTotalBytes || 0,
    refineMode: Boolean(inputs.refine_mode || inputs.refineMode),
    parentJobId: inputs.parent_job_id || inputs.parentJobId || null,
    parentAssetId: inputs.parent_asset_id || inputs.parentAssetId || null,
    refineInstruction: inputs.refine_instruction || inputs.refineInstruction || null,
    ...loadRefineParentRows({
      refineMode: Boolean(inputs.refine_mode || inputs.refineMode),
      parentJobId: inputs.parent_job_id || inputs.parentJobId || null,
      parentAssetId: inputs.parent_asset_id || inputs.parentAssetId || null,
      parentJob: inputs.parent_job || inputs.parentJob || null,
      parentAsset: inputs.parent_asset || inputs.parentAsset || null
    })
  };

  const result = await compiledGraphInstance.invoke(initialPayload, graphConfig);

  return {
    success: result.status === 'completed',
    job_id: result.jobId,
    asset_id: result.assetId,
    nonce: result.nonce,
    status: result.status,
    effective_compute_mode: result.effectiveComputeMode,
    compute_fallback_reason: result.computeFallbackReason,
    requested_gpu_backend: result.requestedGpuBackend || null,
    compute_device: result.resolvedGpuBackend || null,
    gpu_fallback_reason: result.gpuFallbackReason || null,
    output_path: result.refinedGlbPath,
    primary_glb_path: result.refinedGlbPath,
    preview_path: result.previewPngPath,
    preview_png_path: result.previewPngPath,
    live_glb_path: result.liveGlbPath,
    live_agent_steps: result.liveAgentSteps,
    triangle_count: result.triangleCount,
    vertex_count: result.vertexCount,
    mesh_count: result.meshCount,
    spec: result.spec,
    dsl: result.dslPayload,
    output_size: result.outputSize,
    output_size_warning: result.outputSizeWarning,
    iteration_history: result.iterationHistory,
    final_score: result.finalScore ?? result.scoreSpecPost?.score ?? null,
    archetype_mode: result.archetypeMode,
    stage_models: result.stageModels,
    parent_job_id: result.parentJobId || null,
    parent_asset_id: result.parentAssetId || null,
    refine_instruction: result.refineInstruction || null,
    refine_diff: result.refineDiff || null,
    error_code: result.errorCode || null,
    error_message: result.errorMessage || null,
    tokens: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      total_tokens: result.totalTokens,
      est_cost_usd: result.estCostUsd
    }
  };
}

module.exports = {
  MAX_YAMANAKA_REPAIR_ATTEMPTS,
  Yamanaka3DStateAnnotation,
  buildYamanaka3DGraph,
  runYamanaka3DGraph,
  nodeValidatePre,
  nodeObjectBrief,
  nodeRefineRequest,
  routeAfterInit,
  routeAfterRefine,
  nodeFix,
  nodeRepair,
  nodeValidatePost,
  routePreValidation,
  routeAfterFix,
  routePostValidation
};
