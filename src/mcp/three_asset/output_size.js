'use strict';

/**
 * src/mcp/three_asset/output_size.js
 *
 * Output size (preview / inspection render / reference image) — deliberately
 * separate from the square power-of-two Texture Resolution control.
 */

const ORIENTATIONS = Object.freeze(['portrait', 'landscape', 'square']);
const ASPECT_PRESETS = Object.freeze({
  '1:1': Object.freeze([1, 1]),
  '4:3': Object.freeze([4, 3]),
  '3:4': Object.freeze([3, 4]),
  '16:9': Object.freeze([16, 9]),
  '9:16': Object.freeze([9, 16])
});
const LONG_EDGE_PRESETS = Object.freeze([512, 1024, 2048, 4096]);
const MIN_EDGE = 64;
const MAX_EDGE = 8192;
const DEFAULT_ORIENTATION = 'landscape';
const DEFAULT_ASPECT = '16:9';
const DEFAULT_LONG_EDGE = 1024;
const WARN_LONG_EDGE = 4096;

function isFinitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function evenFloor(value) {
  const rounded = Math.floor(value / 2) * 2;
  return rounded >= MIN_EDGE ? rounded : MIN_EDGE;
}

function ensureEven(value) {
  const clamped = Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(value)));
  return clamped % 2 === 0 ? clamped : clamped + 1 > MAX_EDGE ? clamped - 1 : clamped + 1;
}

function orientationForAspect(aspectRatio) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(aspectRatio || ''));
  if (!match) return DEFAULT_ORIENTATION;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0) || !(h > 0)) return DEFAULT_ORIENTATION;
  if (Math.abs(w - h) < 1e-9) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

function defaultAspectForOrientation(orientation) {
  if (orientation === 'portrait') return '9:16';
  if (orientation === 'square') return '1:1';
  return DEFAULT_ASPECT;
}

function snapAspect(width, height) {
  const ratio = width / height;
  let best = null;
  let bestDelta = Infinity;
  for (const [label, [w, h]] of Object.entries(ASPECT_PRESETS)) {
    const preset = w / h;
    const delta = Math.abs(ratio - preset) / preset;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = label;
    }
  }
  if (best && bestDelta <= 0.02) return best;
  return `${width}:${height}`;
}

function resolvePresetSize(aspectRatio, longEdge) {
  const pair = ASPECT_PRESETS[aspectRatio] || ASPECT_PRESETS[DEFAULT_ASPECT];
  const [aw, ah] = pair;
  // Long edge travels to whichever axis is longer in the preset.
  const aspectRatioValue = aw / ah;
  let width;
  let height;
  if (aspectRatioValue >= 1) {
    width = longEdge;
    height = longEdge / aspectRatioValue;
  } else {
    height = longEdge;
    width = longEdge * aspectRatioValue;
  }
  return { width: ensureEven(width), height: ensureEven(height) };
}

/**
 * Resolve a user-facing output size selection into concrete pixel dimensions.
 * Custom W×H wins when both are finite; otherwise the orientation/aspect/long-edge
 * preset path is used. Never throws.
 */
function resolveOutputSize(options = {}) {
  const opts = options || {};
  if (isFinitePositive(opts.width) && isFinitePositive(opts.height)) {
    const width = ensureEven(opts.width);
    const height = ensureEven(opts.height);
    return {
      width,
      height,
      aspect_ratio: snapAspect(width, height),
      orientation: orientationForAspect(`${width}:${height}`),
      long_edge: Math.max(width, height),
      source: 'custom'
    };
  }

  const orientation = ORIENTATIONS.includes(opts.orientation) ? opts.orientation : DEFAULT_ORIENTATION;
  let aspectRatio = ASPECT_PRESETS[opts.aspectRatio] ? opts.aspectRatio : defaultAspectForOrientation(orientation);
  // Keep orientation and aspect coherent when only one of them was supplied.
  const aspectOrientation = orientationForAspect(aspectRatio);
  if (opts.orientation && opts.aspectRatio && aspectOrientation !== orientation) {
    aspectRatio = defaultAspectForOrientation(orientation);
  }
  const longEdge = isFinitePositive(opts.longEdge)
    ? Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(opts.longEdge)))
    : DEFAULT_LONG_EDGE;

  const { width, height } = resolvePresetSize(aspectRatio, longEdge);
  return {
    width,
    height,
    aspect_ratio: aspectRatio,
    orientation: orientationForAspect(aspectRatio),
    long_edge: Math.max(width, height),
    source: 'preset'
  };
}

/**
 * Clamp an output size against available VRAM when the effective compute mode is GPU.
 * 4 bytes/px, 4 concurrent buffers, 4x headroom. Passthrough for CPU / unknown VRAM.
 */
function clampOutputSizeForVram(size, options = {}) {
  const opts = options || {};
  const base = resolveOutputSize(size || {});
  const vram = Number(opts.vramTotalBytes);
  if (opts.effectiveComputeMode !== 'gpu' || !(vram > 0)) return { ...base, clamped: false };

  // 4 bytes/px × 4 buffers (beauty + depth + normal + temp) × 4x headroom = 64 bytes/px.
  const maxPixels = vram / 64;
  const cap = Math.max(MIN_EDGE, Math.floor(Math.sqrt(maxPixels)));
  const maxEdge = Math.max(base.width, base.height);
  if (maxEdge <= cap) return { ...base, clamped: false, vram_cap_edge: cap };

  const scale = cap / maxEdge;
  const width = evenFloor(base.width * scale);
  const height = evenFloor(base.height * scale);
  return {
    ...base,
    width,
    height,
    long_edge: Math.max(width, height),
    clamped: true,
    requested_max_edge: maxEdge,
    vram_cap_edge: cap
  };
}

/**
 * Human-readable warning string for an output size, or null when nothing needs flagging.
 */
function withWarningSuffix(size) {
  const s = size || {};
  if (s.clamped) {
    return `Output Size ${s.requested_max_edge}px exceeded the VRAM budget and was clamped to ${Math.max(s.width, s.height)}px.`;
  }
  if (Math.max(s.width || 0, s.height || 0) >= WARN_LONG_EDGE) {
    return `Output Size ${Math.max(s.width, s.height)}px is very large and may exhaust VRAM under Force GPU.`;
  }
  return null;
}

module.exports = {
  ORIENTATIONS,
  ASPECT_PRESETS,
  LONG_EDGE_PRESETS,
  MIN_EDGE,
  MAX_EDGE,
  DEFAULT_ORIENTATION,
  DEFAULT_ASPECT,
  DEFAULT_LONG_EDGE,
  WARN_LONG_EDGE,
  orientationForAspect,
  resolveOutputSize,
  clampOutputSizeForVram,
  withWarningSuffix
};
