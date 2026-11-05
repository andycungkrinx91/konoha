'use strict';

const fs = require('fs');
const { parsePngPixels } = require('./image_relief');
const { readMaskPng } = require('./image_analysis');

const COMPARE_GRID = 256;
const BG_TOLERANCE = 24;

function isBinaryPngData(data, total) {
  for (let i = 0; i < total; i++) {
    const v = data[i * 4];
    if (v !== 0 && v !== 255) return false;
  }
  return true;
}

function sampleCornerBackground(png) {
  const edge = Math.max(1, Math.min(8, Math.floor(Math.min(png.width, png.height) / 4)));
  const corners = [
    [0, 0],
    [png.width - edge, 0],
    [0, png.height - edge],
    [png.width - edge, png.height - edge]
  ];
  const bg = [0, 0, 0];
  let n = 0;
  for (const [cx, cy] of corners) {
    for (let i = 0; i < edge * edge; i++) {
      const x = cx + (i % edge);
      const y = cy + Math.floor(i / edge);
      const idx = (y * png.width + x) * 4;
      bg[0] += png.data[idx];
      bg[1] += png.data[idx + 1];
      bg[2] += png.data[idx + 2];
      n++;
    }
  }
  if (n > 0) {
    bg[0] /= n;
    bg[1] /= n;
    bg[2] /= n;
  }
  return bg;
}

function loadAsMask(imageOrMaskPath) {
  if (!imageOrMaskPath || !fs.existsSync(imageOrMaskPath)) return null;
  const direct = readMaskPng(imageOrMaskPath);
  if (!direct) return null;
  try {
    const png = parsePngPixels(fs.readFileSync(imageOrMaskPath));
    if (!png) return null;
    const total = png.width * png.height;
    if (isBinaryPngData(png.data, total)) return direct;

    const bg = sampleCornerBackground(png);
    const gray = Buffer.alloc(total);
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const alpha = png.data[p + 3];
      const delta = Math.max(
        Math.abs(png.data[p] - bg[0]),
        Math.abs(png.data[p + 1] - bg[1]),
        Math.abs(png.data[p + 2] - bg[2])
      );
      gray[i] = alpha > 16 && delta > BG_TOLERANCE ? 255 : 0;
    }
    return { width: png.width, height: png.height, gray };
  } catch {
    return null;
  }
}

function foregroundBox(mask) {
  const { width, height, gray } = mask;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (gray[i] <= 127) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { x: 0, y: 0, width, height, empty: true };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, empty: false };
}

/** Resample the foreground bounding box of `mask` onto a COMPARE_GRID×COMPARE_GRID bitfield. */
function normalizeToGrid(mask, size = COMPARE_GRID) {
  const box = foregroundBox(mask);
  const out = new Uint8Array(size * size);
  if (box.empty) return out;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(mask.height - 1, box.y + Math.floor((y / size) * box.height));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(mask.width - 1, box.x + Math.floor((x / size) * box.width));
      out[y * size + x] = mask.gray[sy * mask.width + sx] > 127 ? 1 : 0;
    }
  }
  return out;
}

function cropFirstGridSlotIfWide(mask) {
  if (mask.width < mask.height * 1.3) return mask;
  const slotW = Math.floor(mask.width / 4);
  if (slotW <= 16) return mask;
  const frontGray = Buffer.alloc(slotW * mask.height);
  for (let y = 0; y < mask.height; y++) {
    mask.gray.copy(frontGray, y * slotW, y * mask.width, y * mask.width + slotW);
  }
  return { width: slotW, height: mask.height, gray: frontGray };
}

/**
 * Intersection-over-Union of two masks after aligning each to its foreground
 * bounding box on a 256×256 grid. Returns null when either image cannot be read.
 */
function maskIoU(maskPathA, maskPathB) {
  const rawA = loadAsMask(maskPathA);
  const b = loadAsMask(maskPathB);
  if (!rawA || !b) return null;
  const a = cropFirstGridSlotIfWide(rawA);
  const ga = normalizeToGrid(a);
  const gb = normalizeToGrid(b);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < ga.length; i++) {
    if (ga[i] && gb[i]) inter++;
    if (ga[i] || gb[i]) union++;
  }
  if (union === 0) return 0;
  return Number((inter / union).toFixed(4));
}

function computeNodeDimVector(node) {
  const p = node.geometry?.params || {};
  const rawSize = node.part?.size || p.size;
  if (Array.isArray(rawSize) && rawSize.length >= 3) {
    return [Number(rawSize[0]) || 1, Number(rawSize[1]) || 1, Number(rawSize[2]) || 1];
  }
  if (typeof p.radius === 'number') {
    const d = p.radius * 2;
    const h = typeof p.height === 'number' ? p.height : (typeof p.length === 'number' ? p.length + d : d);
    return [d, h, d];
  }
  if (typeof p.radiusTop === 'number' || typeof p.radiusBottom === 'number') {
    const d = Math.max(Number(p.radiusTop) || 0, Number(p.radiusBottom) || 0) * 2 || 1;
    return [d, Number(p.height) || 1, d];
  }
  return [Number(p.width) || 1, Number(p.height) || 1, Number(p.depth) || 1];
}

function extractSpecHeightToWidthRatio(spec) {
  if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) return null;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const node of spec.nodes) {
    if (!node || typeof node !== 'object') continue;
    const pos = node.part?.position || node.transform?.position || [0, 0, 0];
    const scale = node.transform?.scale || [1, 1, 1];
    const [sx, sy, sz] = computeNodeDimVector(node);
    const wx = sx * (Math.abs(Number(scale[0])) || 1);
    const wy = sy * (Math.abs(Number(scale[1])) || 1);
    const wz = sz * (Math.abs(Number(scale[2])) || 1);
    const cx = Number(pos[0]) || 0;
    const cy = Number(pos[1]) || 0;
    const cz = Number(pos[2]) || 0;
    minX = Math.min(minX, cx - wx * 0.5);
    maxX = Math.max(maxX, cx + wx * 0.5);
    minY = Math.min(minY, cy - wy * 0.5);
    maxY = Math.max(maxY, cy + wy * 0.5);
    minZ = Math.min(minZ, cz - wz * 0.5);
    maxZ = Math.max(maxZ, cz + wz * 0.5);
  }
  const width = (maxX - minX) || (maxZ - minZ);
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return Number((height / width).toFixed(4));
}

function extractObjectRatio(source) {
  if (typeof source.height_to_width_ratio === 'number' && source.height_to_width_ratio > 0) {
    return source.height_to_width_ratio;
  }
  if (source.proportions && typeof source.proportions === 'object') {
    const fromProp = extractRatio(source.proportions);
    if (fromProp !== null) return fromProp;
  }
  if (typeof source.aspect_ratio === 'number' && source.aspect_ratio > 0) {
    return 1 / source.aspect_ratio;
  }
  if (Array.isArray(source.dimensions) && source.dimensions.length >= 2 && source.dimensions[0] > 0) {
    const h = source.dimensions.length >= 3 ? source.dimensions[2] : source.dimensions[1];
    return h / source.dimensions[0];
  }
  if (source.bbox && Array.isArray(source.bbox.size) && source.bbox.size.length >= 3) {
    const horiz = Math.max(Number(source.bbox.size[0]) || 0, Number(source.bbox.size[1]) || 0);
    const vert = Number(source.bbox.size[2]) || 0;
    if (horiz > 0 && vert > 0) return vert / horiz;
  }
  if (source.bbox && source.bbox.width > 0 && source.bbox.height > 0) {
    return source.bbox.height / source.bbox.width;
  }
  if (Array.isArray(source.nodes)) {
    return extractSpecHeightToWidthRatio(source);
  }
  return null;
}

function extractRatio(source) {
  if (source === null || source === undefined) return null;
  if (typeof source === 'number' && Number.isFinite(source) && source > 0) return source;
  if (typeof source === 'string') {
    const mask = loadAsMask(source);
    if (!mask) return null;
    const box = foregroundBox(mask);
    if (box.empty || box.width <= 0) return null;
    return box.height / box.width;
  }
  if (typeof source === 'object') {
    return extractObjectRatio(source);
  }
  return null;
}

/**
 * Compare render vs reference height-to-width ratios within relative `tolerance`.
 * Accepts numbers, mask/render file paths, scene_report objects or analysis objects.
 * Returns null when either ratio is unavailable.
 */
function boxRatioOk(render, reference, tolerance = 0.25) {
  const r = extractRatio(render);
  const ref = extractRatio(reference);
  if (r === null || ref === null || !(ref > 0)) return null;
  const relDelta = Math.abs(r - ref) / ref;
  return relDelta <= tolerance;
}

/**
 * Left/right symmetry score in [0..1] over the foreground bounding box of a mask
 * or render image. Returns null when the file cannot be read.
 */
function symmetryScore(maskPath) {
  const rawMask = loadAsMask(maskPath);
  if (!rawMask) return null;
  const mask = cropFirstGridSlotIfWide(rawMask);
  const box = foregroundBox(mask);
  if (box.empty) return null;
  let sum = 0;
  let n = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const mirror = box.x + box.width - 1 - (x - box.x);
      sum += Math.abs(mask.gray[y * mask.width + x] - mask.gray[y * mask.width + mirror]);
      n++;
    }
  }
  if (!n) return null;
  return Number(Math.max(0, Math.min(1, 1 - sum / n / 255)).toFixed(4));
}

module.exports = {
  maskIoU,
  boxRatioOk,
  symmetryScore,
  extractRatio,
  extractSpecHeightToWidthRatio,
  loadAsMask,
  foregroundBox,
  COMPARE_GRID
};
