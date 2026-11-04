'use strict';

/**
 * Four user-facing generation quality levels.
 *
 * A user only has to learn `low`, `normal`, `high`, `ultra`; each level expands
 * into the one knob the procedural builder genuinely reads — the target
 * polycount, which drives segment density in `scene_builder.resolveSegments`.
 * Geometry is the real quality lever in this pipeline, so a level never
 * advertises a texture or material switch the builder would ignore.
 *
 * Legacy identifiers (`draft`, `standard`) stay resolvable so jobs recorded
 * before the rename and older API clients keep landing on the same level.
 */

const QUALITY_LEVELS = Object.freeze({
  low: Object.freeze({
    id: 'low',
    label: 'Low',
    summary: 'Fast silhouette preview for layout and scale checks',
    targetPolycount: 3000
  }),
  normal: Object.freeze({
    id: 'normal',
    label: 'Normal',
    summary: 'Everyday game asset with smooth curved surfaces',
    targetPolycount: 12000
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    summary: 'Hero asset with dense bevelled edges for close-up shots',
    targetPolycount: 35000
  }),
  ultra: Object.freeze({
    id: 'ultra',
    label: 'Ultra',
    summary: 'Maximum tessellation for film-grade close-ups',
    targetPolycount: 85000
  })
});

const LEVEL_ORDER = Object.freeze(['low', 'normal', 'high', 'ultra']);

const LEGACY_ALIASES = Object.freeze({
  draft: 'low',
  standard: 'normal',
  medium: 'normal',
  max: 'ultra',
  maximum: 'ultra'
});

const POLYCOUNT_FLOOR = 500;
const POLYCOUNT_CEILING = 200000;

function normalizeLevelId(name) {
  if (name === null || name === undefined || name === '') return null;
  const key = String(name).trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (QUALITY_LEVELS[key]) return key;
  if (LEGACY_ALIASES[key]) return LEGACY_ALIASES[key];
  return null;
}

function resolveQualityLevel(name, fallbackId = 'normal') {
  const requested = name === null || name === undefined || name === '' ? null : String(name).trim().toLowerCase();
  const matched = normalizeLevelId(requested);
  const id = matched || normalizeLevelId(fallbackId) || 'normal';
  return {
    id,
    level: QUALITY_LEVELS[id],
    requested,
    aliased: Boolean(requested) && requested !== id,
    known: matched !== null
  };
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function expandLevelOptions(levelId, overrides = {}) {
  const { level } = resolveQualityLevel(levelId);
  return {
    quality_preset: level.id,
    target_polycount: clampInt(overrides.target_polycount, POLYCOUNT_FLOOR, POLYCOUNT_CEILING, level.targetPolycount)
  };
}

function listQualityLevels() {
  return LEVEL_ORDER.map((id) => ({ ...QUALITY_LEVELS[id] }));
}

module.exports = {
  QUALITY_LEVELS,
  LEVEL_ORDER,
  LEGACY_ALIASES,
  POLYCOUNT_FLOOR,
  POLYCOUNT_CEILING,
  normalizeLevelId,
  resolveQualityLevel,
  expandLevelOptions,
  listQualityLevels
};
