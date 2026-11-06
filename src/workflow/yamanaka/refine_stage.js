'use strict';

/**
 * Refine-fork stage of the Yamanaka 3D workflow.
 *
 * A refine run forks a brand-new job + asset from an existing parent asset. This node loads the
 * parent job row, CLONES the parent's own scene spec and patches only the targeted node(s) with
 * the user edit prompt, then seeds `spec`/`dslPayload` so the run joins the graph AFTER
 * object_brief and synthesize_dsl: the edited spec is the geometry input that validate_pre
 * scores and build_base meshes.
 *
 * The DSL text rendered for the fork is PERSISTED PROVENANCE (a readable record of the geometry
 * input); it is never parsed back to rebuild the spec. Clone-and-patch keeps every untouched
 * node, light and top-level field of the parent byte-identical.
 *
 * The parent's spec, photos and files are never rewritten. Any instruction that cannot be
 * expressed on the parent spec is a hard failure with an explicit error code; it is never
 * recorded and silently ignored.
 */

const { parseDslOrJson } = require('../../mcp/three_asset/vision_spec');
const { parseRefineIntent, applyIntentToSpec, compileRefineIntentToDsl } = require('../../mcp/three_asset/refine_dsl');

const REFINE_SOURCE_MODE = 'dsl_direct';

function _normalizeSpecCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    const parsed = parseDslOrJson(candidate);
    const spec = parsed && parsed.spec;
    return spec && Array.isArray(spec.nodes) && spec.nodes.length > 0 ? spec : null;
  }
  if (typeof candidate === 'object' && Array.isArray(candidate.nodes) && candidate.nodes.length > 0) {
    return candidate;
  }
  return null;
}

/**
 * Resolves the parent's persisted scene spec. The parent job's `dsl_payload_json` is the
 * canonical geometry record written by synthesize_dsl; the asset row's model metadata is
 * used only when the job payload is absent (older rows).
 */
function resolveParentSpec(parentJob, parentAsset = null) {
  const fromJob = _normalizeSpecCandidate(parentJob && parentJob.dsl_payload_json);
  if (fromJob) return { spec: fromJob, origin: 'parent_job.dsl_payload_json' };
  const fromAsset = _normalizeSpecCandidate(parentAsset && parentAsset.spec_json);
  if (fromAsset) return { spec: fromAsset, origin: 'parent_asset.spec_json' };
  return { spec: null, origin: null };
}

function validateRefineParent(parentJob, parentAsset, assetId) {
  if (!parentAsset) {
    return { error_code: 'PARENT_ASSET_NOT_FOUND', error: `Asset '${assetId}' not found` };
  }
  if (parentAsset.asset_status !== 'ready') {
    return {
      error_code: 'PARENT_ASSET_NOT_REFINABLE',
      error: `Asset '${assetId}' is '${parentAsset.asset_status}' and cannot be refined`
    };
  }
  if (!parentJob) {
    return {
      error_code: 'PARENT_JOB_MISSING',
      error: `Parent job '${parentAsset.job_id}' for asset '${assetId}' no longer exists`
    };
  }
  return null;
}

/**
 * Compiles the instruction into an edited spec by cloning the parent and patching ONLY the
 * targeted nodes. Returns `{ intent, spec, dsl }` or `{ error_code, error }`.
 */
function applyRefineIntent(instruction, parentSpec) {
  const intent = parseRefineIntent(instruction, parentSpec);
  if (intent.error_code) {
    return { error_code: intent.error_code, error: intent.error || intent.error_code };
  }
  const spec = applyIntentToSpec(intent, parentSpec);
  // Provenance only: rendered for the job record, never fed back into the pipeline.
  const dsl = compileRefineIntentToDsl(intent, spec);
  return { intent, spec, dsl };
}

function _canonical(value) {
  if (Array.isArray(value)) return value.map(_canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = _canonical(value[key]);
    return out;
  }
  return value;
}

/** Key-order independent fingerprint, so a clone can never look edited just by key order. */
function _stableFingerprint(value) {
  return JSON.stringify(_canonical(value));
}

/**
 * Structural comparison of the parent spec and the patched clone: identical iff every node is
 * deep-equal, i.e. the instruction changed no field at all. Comparison is per node so other
 * top-level fields (e.g. `lights`, which the profile pass may normalise later) cannot mask a
 * targeted edit, and an untouched clone can never look edited.
 */
function compareSpecStructure(parentSpec, refinedSpec) {
  const parentNodes = (parentSpec && parentSpec.nodes) || [];
  const refinedNodes = (refinedSpec && refinedSpec.nodes) || [];
  const changed = [];
  for (const node of refinedNodes) {
    const before = parentNodes.find((n) => n && n.name === node.name);
    if (!before || _stableFingerprint(before) !== _stableFingerprint(node)) changed.push(node.name);
  }
  const identical = changed.length === 0
    && parentNodes.length === refinedNodes.length
    && _stableFingerprint(parentSpec && parentSpec.lights) === _stableFingerprint(refinedSpec && refinedSpec.lights);
  return { identical, changed };
}

async function nodeRefineRequest(state) {
  const parentJob = state.parentJob || null;
  const parentAsset = state.parentAsset || null;
  const instruction = String(state.refineInstruction || '').trim();

  const parentError = validateRefineParent(parentJob, parentAsset, state.parentAssetId || parentAsset?.asset_id || '');
  if (parentError) return parentError;
  if (!instruction) {
    return { error_code: 'REFINE_INSTRUCTION_REQUIRED', error: 'A non-empty refine instruction is required' };
  }

  const { spec: parentSpec, origin } = resolveParentSpec(parentJob, parentAsset);
  if (!parentSpec) {
    return {
      error_code: 'PARENT_SPEC_MISSING',
      error: `Parent job '${parentJob.job_id}' has no persisted scene spec to refine (origin: ${origin || 'none'})`
    };
  }

  const applied = applyRefineIntent(instruction, parentSpec);
  if (applied.error_code) return applied;
  const { intent, spec } = applied;

  const fidelity = compareSpecStructure(parentSpec, spec);
  if (fidelity.identical) {
    return {
      error_code: 'REFINE_NO_OP',
      error: `refine instruction "${instruction.slice(0, 120)}" left every part unchanged`
    };
  }

  return {
    status: 'parsing_dsl',
    spec,
    dslPayload: applied.dsl,
    parentSpec,
    refineDiff: {
      parent_node_count: parentSpec.nodes.length,
      refined_node_count: spec.nodes.length,
      targets: intent.targets,
      changed_nodes: fidelity.changed,
      tokens: intent.tokens,
      scale_factor: intent.scaleFactor,
      source_origin: origin
    },
    parentJobId: parentJob.job_id,
    domainArchetype: parentSpec.archetype || state.domainArchetype
  };
}

module.exports = {
  REFINE_SOURCE_MODE,
  nodeRefineRequest,
  resolveParentSpec,
  validateRefineParent,
  applyRefineIntent,
  compareSpecStructure
};
