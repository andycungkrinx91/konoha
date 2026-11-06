'use strict';

/**
 * Object-brief stage of the Yamanaka 3D workflow: locks components, real-world
 * dimensions, proportions and materials BEFORE the scene spec. Image mode derives the
 * brief from the stage-1 analysis instead of a fresh text call. Extracted from graph.js
 * so the graph module keeps room for the refine-fork wiring under the 700-line ceiling.
 */

const fs = require('fs');
const { getConnection } = require('../../db');
const { updateJobStage } = require('../../mcp/three_asset/db_3d_schema');
const { generateObjectBrief, buildObjectBriefFromAnalysis } = require('../../mcp/three_asset/vision_spec');
const { analyzeReferenceImage } = require('../../mcp/three_asset/image_analysis');
const { buildTargets } = require('../../mcp/three_asset/archetype_policy');
const { formatReferenceContext } = require('./chunin_stage');

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
      model: state.modelUsed,
      referenceContext: formatReferenceContext(state.referenceSources)
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

module.exports = {
  nodeObjectBrief
};
