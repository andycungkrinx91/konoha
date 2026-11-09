'use strict';

/**
 * Scene-spec synthesis stage of the Yamanaka 3D workflow: routes DSL payloads,
 * reference images and text prompts through the vision/spec pipeline, locks the
 * stage-1 reference analysis, stamps the resolved output size and records token
 * telemetry. Extracted from graph.js to keep the graph module under the 700-line
 * lint ceiling.
 */

const fs = require('fs');
const { getConnection } = require('../../db');
const { updateJobStage, record3DLlmRequest } = require('../../mcp/three_asset/db_3d_schema');
const {
  generateSceneSpecFromPrompt,
  generateSceneSpecFromImage,
  parseDslOrJson
} = require('../../mcp/three_asset/vision_spec');
const { analyzeReferenceImage } = require('../../mcp/three_asset/image_analysis');
const { buildTargets } = require('../../mcp/three_asset/archetype_policy');
const { resolveStageModels } = require('../../mcp/three_asset/model_router');
const { specToDSL } = require('../../mcp/three_asset/dsl_parser');

async function nodeSynthesizeDsl(state, config = {}) {
  const conn = getConnection();
  const onAction = config.configurable?.onAction || (() => {});
  const onSynthesisEvent = (event, payload) => {
    try {
      onAction({
        event,
        job_id: state.jobId,
        ...payload,
        timestamp: new Date().toISOString()
      });
    } catch { /* intentional best-effort fallback: optional 3D stage; base scene still produced */ }
  };
  let spec = null;
  let dsl = null;
  let modelUsed = state.modelUsed || 'inherited';
  let inTok = 0;
  let outTok = 0;
  let totalTok = 0;
  let cost = 0.0;
  let tokenSource = 'tokenizer_estimate';

  if (state.dslPayload) {
    const parsed = parseDslOrJson(state.dslPayload);
    spec = parsed?.spec;
    dsl = parsed?.dsl || state.dslPayload;
  } else if (state.imagePath && fs.existsSync(state.imagePath)) {
    // Stage-1 analysis is computed exactly once and reused by every later iteration.
    const referenceAnalysis = state.referenceAnalysis
      || (await analyzeReferenceImage(state.imagePath, { outputDir: state.stagingDir || undefined }));
    if (referenceAnalysis && !referenceAnalysis.error) {
      updateJobStage(conn, state.jobId, {
        reference_analysis_json: JSON.stringify(referenceAnalysis)
      });
    }
    const res = await generateSceneSpecFromImage({
      image_path: state.imagePath,
      prompt: state.prompt,
      archetype: state.domainArchetype,
      model: state.modelUsed,
      target_polycount: state.targetPolycount || 50000,
      object_brief: state.objectBrief || null,
      reference_analysis: referenceAnalysis && !referenceAnalysis.error ? referenceAnalysis : null,
      onAction: onSynthesisEvent
    });
    if (referenceAnalysis && !referenceAnalysis.error) {
      state = { ...state, referenceAnalysis };
    }
    ({ spec, dsl, modelUsed, inTok, outTok, totalTok, cost, tokenSource } = _unpackSynthesisResult(res, tokenSource));
  } else {
    const res = await generateSceneSpecFromPrompt(state.prompt || 'Futuristic production 3D model', {
      archetype: state.domainArchetype,
      model: state.modelUsed,
      target_polycount: state.targetPolycount || 50000,
      object_brief: state.objectBrief || null,
      onAction: onSynthesisEvent
    });
    ({ spec, dsl, modelUsed, inTok, outTok, totalTok, cost, tokenSource } = _unpackSynthesisResult(res, tokenSource));
  }

  function _unpackSynthesisResult(res, fallbackSource) {
    const tok = res.tokens || {};
    return {
      spec: res.spec,
      dsl: res.dsl,
      modelUsed: res.model_used,
      inTok: tok.input_tokens || 0,
      outTok: tok.output_tokens || 0,
      totalTok: tok.total_tokens || 0,
      cost: tok.est_cost_usd || 0.0,
      tokenSource: tok.token_source || fallbackSource
    };
  }

  // Record token telemetry in SQLite
  if (totalTok > 0) {
    record3DLlmRequest(conn, {
      job_id: state.jobId,
      request_kind: state.imagePath ? 'image_vision' : 'dsl_synthesis',
      provider: 'yamanaka_router',
      model: modelUsed,
      input_tokens: inTok,
      output_tokens: outTok,
      total_tokens: totalTok,
      token_source: tokenSource,
      est_cost_usd: cost
    });
  }

  const resolvedArchetype = (spec && spec.archetype) || state.domainArchetype;
  const archetypeTargets = buildTargets(resolvedArchetype, state.qualityPreset, state.objectBrief);
  if (spec && state.outputSize) {
    spec.output_size = {
      width: state.outputSize.width,
      height: state.outputSize.height,
      aspect_ratio: state.outputSize.aspect_ratio,
      orientation: state.outputSize.orientation
    };
  }
  const stageModels = resolveStageModels({ routing: modelUsed });

  updateJobStage(conn, state.jobId, {
    status: 'parsing_dsl',
    domain_archetype: resolvedArchetype,
    dsl_payload_json: JSON.stringify(spec || {}),
    model_used: modelUsed,
    input_tokens: inTok,
    output_tokens: outTok,
    total_tokens: totalTok,
    est_cost_usd: cost
  });

  return {
    status: 'parsing_dsl',
    domainArchetype: resolvedArchetype,
    archetypeTargets,
    archetypeMode: archetypeTargets.mode,
    stageModels,
    referenceAnalysis: state.referenceAnalysis || null,
    spec,
    dslPayload: dsl || (spec ? specToDSL(spec) : ''),
    modelUsed,
    inputTokens: inTok,
    outputTokens: outTok,
    totalTokens: totalTok,
    estCostUsd: cost
  };
}

module.exports = {
  nodeSynthesizeDsl
};
