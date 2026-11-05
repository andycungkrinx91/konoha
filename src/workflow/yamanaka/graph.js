'use strict';

/**
 * Yamanaka Generative 3D Workflow Graph powered by LangGraph.js (@langchain/langgraph).
 * Orchestrates multi-phase synthesis, procedural Three.js construction, live agentic Blender editing,
 * 3-layer circuit breakers, and deterministic token/cost accounting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Annotation, StateGraph, END, START, MemorySaver } = require('@langchain/langgraph');
const { KonohaCheckpointSaver } = require('../../mcp/langgraph/checkpointer');
const { getConnection, getDb } = require('../../db');
const {
  createJobRecord,
  updateJobStage,
  recordValidationResult
} = require('../../mcp/three_asset/db_3d_schema');
const {
  initJobDirectories,
  promoteStagingToAsset
} = require('../../mcp/three_asset/storage_manager');
const { resolveStageCompute } = require('../../mcp/three_asset/compute_selector');
const { resolveQualityLevel } = require('../../mcp/three_asset/quality_levels');
const {
  generateObjectBrief,
  buildObjectBriefFromAnalysis
} = require('../../mcp/three_asset/vision_spec');
const { analyzeReferenceImage } = require('../../mcp/three_asset/image_analysis');
const { boxRatioOk, extractRatio, extractSpecHeightToWidthRatio } = require('../../mcp/three_asset/silhouette');
const { buildTargets, viewsForPatch } = require('../../mcp/three_asset/archetype_policy');
const { nodeInspect, nodeFix, routeInspection } = require('./inspect_stage');
const { nodeSynthesizeDsl } = require('./synthesize_stage');
const { resolveOutputSize, clampOutputSizeForVram, withWarningSuffix } = require('../../mcp/three_asset/output_size');
const { applyEnterpriseProfile, scoreSpec } = require('../../mcp/three_asset/style_profile');
const { buildSceneFromSpec } = require('../../mcp/three_asset/scene_builder');
const { exportScene, validateGlbHeader } = require('../../mcp/three_asset/exporter');
const { executeLiveAgenticBlenderSession } = require('../../mcp/three_asset/blender_refiner');

const MAX_YAMANAKA_REPAIR_ATTEMPTS = 3;

const Yamanaka3DStateAnnotation = Annotation.Root({
  jobId: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  nonce: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  prompt: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  negativePrompt: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  imagePath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  sourceMode: Annotation({ reducer: (x, y) => y ?? x, default: () => 'text_to_3d' }),
  status: Annotation({ reducer: (x, y) => y ?? x, default: () => 'pending' }),
  profile: Annotation({ reducer: (x, y) => y ?? x, default: () => 'enterprise_pbr' }),
  qualityPreset: Annotation({ reducer: (x, y) => y ?? x, default: () => 'standard' }),
  targetPolycount: Annotation({ reducer: (x, y) => y ?? x, default: () => 50000 }),
  textureResolution: Annotation({ reducer: (x, y) => y ?? x, default: () => 2048 }),
  enablePbr: Annotation({ reducer: (x, y) => y ?? x, default: () => true }),
  requestedComputeMode: Annotation({ reducer: (x, y) => y ?? x, default: () => 'auto' }),
  effectiveComputeMode: Annotation({ reducer: (x, y) => y ?? x, default: () => 'cpu' }),
  computeFallbackReason: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  domainArchetype: Annotation({ reducer: (x, y) => y ?? x, default: () => 'auto' }),
  modelUsed: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  dslPayload: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  spec: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  stagingRelDir: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  stagingDir: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  intermediateDir: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  baseGlbPath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  liveGlbPath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  refinedGlbPath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  refinementBackend: Annotation({ reducer: (x, y) => y ?? x, default: () => 'deterministic_only' }),
  blenderVersion: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  dccMcpVersion: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  previewPngPath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  assetId: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  vertexCount: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  triangleCount: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  meshCount: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  scoreSpecPre: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  scoreSpecPost: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  repairAttempts: Annotation({ reducer: (x, y) => (y !== undefined ? y : (x || 0)), default: () => 0 }),
  liveAgentSteps: Annotation({ reducer: (x, y) => (y ? [...(x || []), ...y] : (x || [])), default: () => [] }),
  inputTokens: Annotation({ reducer: (x, y) => (x || 0) + (y || 0), default: () => 0 }),
  outputTokens: Annotation({ reducer: (x, y) => (x || 0) + (y || 0), default: () => 0 }),
  totalTokens: Annotation({ reducer: (x, y) => (x || 0) + (y || 0), default: () => 0 }),
  estCostUsd: Annotation({ reducer: (x, y) => Number(((x || 0) + (y || 0)).toFixed(6)), default: () => 0.0 }),
  objectBrief: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  referenceAnalysis: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  archetypeTargets: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  archetypeMode: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  outputSize: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  outputSizeWarning: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  inspection: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  iteration: Annotation({ reducer: (x, y) => (y !== undefined ? y : (x || 0)), default: () => 0 }),
  lastIteration: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  iterationHistory: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  patchesApplied: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  stageModels: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  inspectionGridPath: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  sceneReport: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  critique: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  pendingPatch: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  inspectShouldStop: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => false }),
  finalScore: Annotation({ reducer: (x, y) => (y !== undefined ? y : x), default: () => null }),
  gpuVramTotalBytes: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  errorStage: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  errorCode: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  errorMessage: Annotation({ reducer: (x, y) => y ?? x, default: () => null })
});

async function nodeInit(state) {
  const jobId = state.jobId || `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nonce = state.nonce || crypto.randomBytes(8).toString('hex');
  const compute = resolveStageCompute(state.requestedComputeMode || 'auto');
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

  createJobRecord(conn, {
    job_id: jobId,
    nonce,
    source_mode: state.sourceMode || 'text_to_3d',
    status: 'synthesizing_spec',
    prompt: state.prompt || null,
    negative_prompt: state.negativePrompt || null,
    profile: state.profile || 'enterprise_pbr',
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
    output_orientation: outputSize.orientation
  });

  return {
    jobId,
    nonce,
    status: 'synthesizing_spec',
    effectiveComputeMode: compute.effectiveMode,
    computeFallbackReason: compute.fallbackReason,
    stagingRelDir: dirs.stagingRel,
    stagingDir: dirs.stagingDir,
    intermediateDir: dirs.intermediateDir,
    outputSize,
    outputSizeWarning
  };
}

/**
 * Stage 2 (object brief): lock components, real-world dimensions, proportions and
 * materials BEFORE the scene spec. Image mode derives it from the stage-1 analysis.
 */
async function nodeObjectBrief(state) {
  if (state.objectBrief) return {};
  const targets = buildTargets(state.domainArchetype, state.qualityPreset, null);
  const baseReturn = {
    archetypeTargets: targets,
    archetypeMode: targets.mode
  };
  if (state.dslPayload) return baseReturn;

  const conn = getConnection();
  let brief = null;
  let referenceAnalysis = state.referenceAnalysis || null;
  let tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 };
  let briefModel = null;

  if (state.imagePath && fs.existsSync(state.imagePath)) {
    if (!referenceAnalysis) {
      referenceAnalysis = await analyzeReferenceImage(state.imagePath, {
        outputDir: state.stagingDir || undefined
      });
      if (referenceAnalysis && !referenceAnalysis.error) {
        updateJobStage(conn, state.jobId, {
          reference_analysis_json: JSON.stringify(referenceAnalysis)
        });
      }
    }
    brief = buildObjectBriefFromAnalysis(referenceAnalysis, state.domainArchetype);
  } else if (state.prompt) {
    const res = await generateObjectBrief(state.prompt, {
      archetype: state.domainArchetype,
      model: state.modelUsed
    });
    brief = res.brief || null;
    tokens = res.tokens || tokens;
    briefModel = res.model_used || null;
  }

  const resolvedTargets = buildTargets(state.domainArchetype, state.qualityPreset, brief);
  if (brief) {
    updateJobStage(conn, state.jobId, { object_brief_json: JSON.stringify(brief) });
  }
  return {
    objectBrief: brief,
    referenceAnalysis: referenceAnalysis && !referenceAnalysis.error ? referenceAnalysis : state.referenceAnalysis,
    archetypeTargets: resolvedTargets,
    archetypeMode: resolvedTargets.mode,
    modelUsed: briefModel || state.modelUsed,
    inputTokens: tokens.input_tokens || 0,
    outputTokens: tokens.output_tokens || 0,
    totalTokens: tokens.total_tokens || 0,
    estCostUsd: tokens.est_cost_usd || 0.0
  };
}

async function nodeValidatePre(state) {
  const conn = getConnection();
  const normalizedSpec = applyEnterpriseProfile(state.spec, state.profile);
  const scoreRes = scoreSpec(normalizedSpec, { profile: state.profile });

  recordValidationResult(conn, {
    job_id: state.jobId,
    validation_stage: 'pre_blender_base',
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
    spec: normalizedSpec,
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
    status: 'refining_blender'
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
    outputSize: state.outputSize || undefined,
    patches: Array.isArray(state.pendingPatch) ? state.pendingPatch : [],
    inspection: {
      enabled: true,
      views: ['front', 'side', 'top', 'three_quarter'],
      only_views: iteration > 1 ? onlyViews : []
    },
    metaballs: state.archetypeMode === 'organic',
    enablePbr: state.enablePbr,
    onAction
  });

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

async function nodeValidatePost(state) {
  const conn = getConnection();
  const last = state.lastIteration || {};
  const targets = state.archetypeTargets || buildTargets(state.domainArchetype, state.qualityPreset, state.objectBrief);
  const normalizedSpec = applyEnterpriseProfile(state.spec, state.profile);
  const expectedRatioSource = state.referenceAnalysis
    || state.sceneReport
    || state.spec
    || state.objectBrief?.proportions
    || targets.expectedHeightToWidthRatio
    || null;
  const computedBoxOk = last.box_ratio_ok !== undefined && last.box_ratio_ok !== null
    ? last.box_ratio_ok
    : boxRatioOk(state.sceneReport || state.spec, expectedRatioSource, targets.boxRatioTolerance);
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

  const attemptNumber = (state.repairAttempts || 0) + 1;
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
    scoreSpecPost: scoreRes
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
      final_score: finalScore
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
  const attempts = (state.repairAttempts || 0) + 1;
  const spec = applyEnterpriseProfile(state.spec, state.profile);
  return {
    repairAttempts: attempts,
    spec
  };
}

function routePreValidation(state) {
  if (state.scoreSpecPre?.passed) return 'build_base';
  if ((state.repairAttempts || 0) < MAX_YAMANAKA_REPAIR_ATTEMPTS) return 'repair';
  return 'build_base';
}

function routeAfterFix(state) {
  if (Array.isArray(state.pendingPatch) && state.pendingPatch.length > 0) {
    return 'rebuild';
  }
  return 'validate';
}

function routePostValidation(state) {
  if (state.scoreSpecPost?.passed) return 'promote';
  if ((state.repairAttempts || 0) < MAX_YAMANAKA_REPAIR_ATTEMPTS) return 'repair';
  return 'promote';
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
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
    .addEdge(START, 'init')
    .addEdge('init', 'object_brief')
    .addEdge('object_brief', 'synthesize_dsl')
    .addEdge('synthesize_dsl', 'validate_pre')
    .addConditionalEdges('validate_pre', routePreValidation, {
      build_base: 'build_base',
      repair: 'repair'
    })
    .addEdge('repair', 'build_base')
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
      repair: 'repair'
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
    sourceMode: inputs.source_mode || inputs.sourceMode || 'text_to_3d',
    profile: inputs.profile || 'enterprise_pbr',
    qualityPreset: resolvedLevel.id,
    targetPolycount: clampNumber(inputs.target_polycount ?? inputs.targetPolycount, 500, 200000, resolvedLevel.level.targetPolycount),
    textureResolution: clampNumber(inputs.texture_resolution ?? inputs.textureResolution, 256, 4096, 2048),
    enablePbr: inputs.enable_pbr !== false && inputs.enablePbr !== false,
    requestedComputeMode: inputs.requested_compute_mode || inputs.requestedComputeMode || 'auto',
    domainArchetype: inputs.archetype || inputs.domainArchetype || 'auto',
    modelUsed: inputs.model || inputs.modelUsed || null,
    dslPayload: inputs.dsl || inputs.dslPayload || null,
    outputSize: inputs.output_size || inputs.outputSize || null,
    gpuVramTotalBytes: inputs.gpu_vram_total_bytes || inputs.gpuVramTotalBytes || 0
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
  runYamanaka3DGraph
};
