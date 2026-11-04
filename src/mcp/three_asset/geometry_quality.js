'use strict';

/**
 * Geometry hygiene for generated meshes.
 * Welds duplicate vertices, guarantees UV coverage for downstream texturing,
 * and restores coherent smooth normals where a surface is meant to read as one.
 */

const depLoader = require('./dep_loader');

const WELD_TOLERANCE = 1e-4;
const UV_WORLD_SCALE = 1;
const UV_AXIS_EPSILON = 1e-6;

let cachedUtils = null;

async function getGeometryUtils() {
  if (cachedUtils) return cachedUtils;
  try {
    const mod = await import('three/addons/utils/BufferGeometryUtils.js');
    cachedUtils = mod;
  } catch {
    cachedUtils = depLoader.loadAddon('utils/BufferGeometryUtils.js');
  }
  return cachedUtils;
}

function dominantAxis(geom) {
  if (!geom.boundingBox) geom.computeBoundingBox();
  const size = geom.boundingBox.max.clone().sub(geom.boundingBox.min);
  if (size.x >= size.y && size.x >= size.z) return 0;
  return size.y >= size.z ? 1 : 2;
}

function projectPlanarUv(geom, axis) {
  const pos = geom.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u;
    let v;
    if (axis === 0) {
      u = z;
      v = y;
    } else if (axis === 1) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u * UV_WORLD_SCALE;
    uv[i * 2 + 1] = v * UV_WORLD_SCALE;
  }
  const attr = new geom.attributes.position.constructor(uv, 2);
  geom.setAttribute('uv', attr);
}

function ensureUv(geom) {
  if (geom.attributes.uv) return false;
  projectPlanarUv(geom, dominantAxis(geom));
  return true;
}

function normalizeUvRange(geom) {
  const uv = geom.attributes.uv;
  if (!uv) return;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  if (spanU <= UV_AXIS_EPSILON && spanV <= UV_AXIS_EPSILON) return;
  const scaleU = spanU > UV_AXIS_EPSILON ? 1 / spanU : 1;
  const scaleV = spanV > UV_AXIS_EPSILON ? 1 / spanV : 1;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (uv.getX(i) - minU) * scaleU, (uv.getY(i) - minV) * scaleV);
  }
  uv.needsUpdate = true;
}

function weldVertices(utils, geom) {
  if (!utils || typeof utils.mergeVertices !== 'function') return { geometry: geom, welded: false };
  try {
    const merged = utils.mergeVertices(geom, WELD_TOLERANCE);
    const before = geom.attributes.position ? geom.attributes.position.count : 0;
    const after = merged.attributes.position ? merged.attributes.position.count : before;
    if (after === 0 || after > before) return { geometry: geom, welded: false };
    geom.dispose();
    return { geometry: merged, welded: after < before };
  } catch {
    return { geometry: geom, welded: false };
  }
}

/**
 * @param {object} THREE three module namespace
 * @param {object} geom BufferGeometry
 * @param {object} options { smooth, weld, uv }
 * @returns {object} BufferGeometry (possibly a replacement instance)
 */
async function finalizeGeometry(THREE, geom, options = {}) {
  if (!geom || typeof geom.getAttribute !== 'function') return geom;
  const smooth = options.smooth === true;
  const wantWeld = options.weld !== false;
  const wantUv = options.uv !== false;
  const utils = (wantWeld || smooth) ? await getGeometryUtils() : null;
  let result = geom;
  let welded = false;
  if (wantWeld) {
    const weldOutcome = weldVertices(utils, result);
    result = weldOutcome.geometry;
    welded = weldOutcome.welded;
  }
  if (wantUv) ensureUv(result);
  const needsNormals = !result.attributes.normal || (smooth && welded);
  if (needsNormals && typeof result.computeVertexNormals === 'function') {
    result.computeVertexNormals();
  }
  // UVs stay in world meters on purpose: per-mesh 0..1 normalization would break
  // texel-density continuity across parts that share a material.
  if (typeof result.computeBoundingBox === 'function') result.computeBoundingBox();
  if (typeof result.computeBoundingSphere === 'function') result.computeBoundingSphere();
  return result;
}

function geometryStats(geom) {
  if (!geom || !geom.attributes) return { triangles: 0, vertices: 0, indexed: false, hasUv: false };
  const pos = geom.attributes.position;
  const vertices = pos ? pos.count : 0;
  const triangles = geom.index ? Math.floor(geom.index.count / 3) : Math.floor(vertices / 3);
  return {
    triangles,
    vertices,
    indexed: Boolean(geom.index),
    hasUv: Boolean(geom.attributes.uv)
  };
}

module.exports = {
  WELD_TOLERANCE,
  UV_WORLD_SCALE,
  getGeometryUtils,
  finalizeGeometry,
  ensureUv,
  normalizeUvRange,
  geometryStats
};
