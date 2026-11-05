'use strict';

/**
 * src/mcp/three_asset/archetype_policy.js
 *
 * Routes procedural (hard-surface) subjects versus organic ones to distinct
 * readiness targets, iteration budgets and modeling techniques.
 */

const ORGANIC_ARCHETYPES = Object.freeze(['game-creature', 'game-character']);

const BASE_TARGETS = Object.freeze({
  hard_surface: Object.freeze({
    mode: 'hard_surface',
    minScore: 85,
    maxIterations: 3,
    silhouetteIoU: 0.80,
    boxRatioTolerance: 0.25,
    symmetryMin: 0.85,
    stallDelta: 1.0
  }),
  organic: Object.freeze({
    mode: 'organic',
    minScore: 92,
    maxIterations: 5,
    silhouetteIoU: 0.72,
    boxRatioTolerance: 0.35,
    symmetryMin: 0.75,
    stallDelta: 1.0
  })
});

function resolveArchetypeMode(archetype) {
  const key = String(archetype || '').trim().toLowerCase();
  return ORGANIC_ARCHETYPES.includes(key) ? 'organic' : 'hard_surface';
}

function isOrganicArchetype(archetype) {
  return resolveArchetypeMode(archetype) === 'organic';
}

/**
 * Build the readiness/iteration policy for a job. An object brief with explicit
 * proportions relaxes the organic silhouette target slightly (an authored brief
 * means the shape contract is known, so the pixel gate can be less brutal).
 */
function buildTargets(archetype, qualityPreset, objectBrief = null) {
  const mode = resolveArchetypeMode(archetype);
  const base = { ...BASE_TARGETS[mode] };
  const hasProportions = Boolean(
    objectBrief
    && objectBrief.proportions
    && Number.isFinite(Number(objectBrief.proportions.height_to_width_ratio))
  );
  if (mode === 'organic' && hasProportions) {
    base.silhouetteIoU = Number(Math.max(0.6, base.silhouetteIoU - 0.04).toFixed(3));
    base.boxRatioTolerance = Number(Math.min(0.45, base.boxRatioTolerance + 0.05).toFixed(3));
  }
  const preset = String(qualityPreset || '').toLowerCase();
  if (preset === 'low' || preset === 'draft') {
    base.minScore = Math.max(70, base.minScore - 8);
    base.maxIterations = Math.max(1, base.maxIterations - 1);
  } else if (preset === 'ultra' || preset === 'max' || preset === 'maximum') {
    base.maxIterations = Math.min(5, base.maxIterations + 1);
  }
  return {
    archetype: String(archetype || 'application'),
    mode,
    ...base,
    techniques: mode === 'organic'
      ? ['subdivision_surface', 'mirror_modifier', 'metaballs', 'normal_map', 'fur_shader']
      : ['bevel', 'weighted_normals', 'boolean_cleanup']
  };
}

/**
 * Decide whether the inspect loop should stop and move on to final validation.
 * Stops when the score passes, the iteration budget is spent, or the last two
 * iterations failed to improve by `stallDelta`.
 */
function shouldStopIterating(history, targets) {
  const entries = Array.isArray(history) ? history.filter((e) => e && Number.isFinite(e.score)) : [];
  if (entries.length === 0) return false;
  const latest = entries[entries.length - 1];
  if (latest.score >= targets.minScore) return true;
  if (entries.length >= targets.maxIterations) return true;
  if (entries.length >= 3) {
    const a = entries[entries.length - 3].score;
    const c = entries[entries.length - 1].score;
    if (c - a < (targets.stallDelta || 1.0)) return true;
  }
  return false;
}

/**
 * Which fixed inspection views a patch could have changed.
 */
function viewsForPatch(patch) {
  const views = new Set();
  const sets = Array.isArray(patch) ? patch : (patch ? [patch] : []);
  for (const item of sets) {
    const set = (item && item.set) || {};
    const size = Array.isArray(set.size) ? set.size : null;
    const position = Array.isArray(set.position) ? set.position : null;
    if (size) {
      if (size[0] !== undefined) views.add('front');
      if (size[1] !== undefined) views.add('side');
      if (size[2] !== undefined) {
        views.add('front');
        views.add('top');
      }
    }
    if (position) {
      if (position[0] !== undefined) views.add('front');
      if (position[1] !== undefined) views.add('side');
      if (position[2] !== undefined) {
        views.add('front');
        views.add('side');
      }
    }
    if (set.material) views.add('front');
  }
  views.add('three_quarter');
  return Array.from(views);
}

module.exports = {
  ORGANIC_ARCHETYPES,
  BASE_TARGETS,
  resolveArchetypeMode,
  isOrganicArchetype,
  buildTargets,
  shouldStopIterating,
  viewsForPatch
};
