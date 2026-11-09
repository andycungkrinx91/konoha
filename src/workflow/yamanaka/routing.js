'use strict';

/**
 * Pure LangGraph edge resolvers for the Yamanaka 3D graph.
 * Extracted from graph.js to keep that module inside the 700-line ceiling.
 * State in, node name out — no I/O, no mutation.
 */

const MAX_YAMANAKA_REPAIR_ATTEMPTS = 3;

/** Refine forks skip object_brief + synthesize_dsl: the edited parent spec is already built. */
function routeAfterInit(state) {
  return state.refineMode ? 'refine_request' : 'chunin_search';
}

function routeAfterRefine(state) {
  return state.errorCode ? 'settle_refine_failure' : 'validate_pre';
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
  // Post-gate repairs carry their own budget: sharing the pre-gate counter meant
  // three DSL repairs left nothing for a mesh that only failed after refinement.
  if ((state.postRepairAttempts || 0) < MAX_YAMANAKA_REPAIR_ATTEMPTS) return 'repair';
  return 'promote';
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

module.exports = {
  MAX_YAMANAKA_REPAIR_ATTEMPTS,
  clampNumber,
  routeAfterInit,
  routeAfterRefine,
  routePreValidation,
  routeAfterFix,
  routePostValidation
};
