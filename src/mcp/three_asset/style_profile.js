'use strict';

/**
 * Production Realistic 3D Style Profiles, Boundary Normalizer, and 11-Row scoreSpec Quality Gate.
 * Enforces uniform 3-unit extent, min(y)=0 grounding, micro-chamfer bevels, and physical PBR materials.
 */

const { detailParts } = require('./part_library');
const { QUALITY_LEVELS, LEGACY_ALIASES } = require('./quality_levels');

const GENERATION_PROFILES = Object.freeze({
  production_pbr: {
    name: 'production_pbr',
    minParts: 6,
    maxParts: 128,
    metalness: [0.0, 1.0],
    roughness: [0.02, 0.96],
    clearcoatMax: 1.0,
    transmissionMax: 1.0,
    emissiveIntensityMax: 8.0,
    maxColors: 32,
    minColors: 2,
    bevel: 0.025,
    maxExtent: 3.0,
    minNodeDim: 0.008
  },
  realistic: {
    name: 'realistic',
    minParts: 6,
    maxParts: 160,
    metalness: [0.0, 1.0],
    roughness: [0.01, 0.98],
    clearcoatMax: 1.0,
    transmissionMax: 1.0,
    emissiveIntensityMax: 8.0,
    maxColors: 48,
    minColors: 2,
    bevel: 0.02,
    maxExtent: 3.0,
    minNodeDim: 0.005
  },
  premium_stylized: {
    name: 'premium_stylized',
    minParts: 6,
    maxParts: 96,
    metalness: [0.0, 1.0],
    roughness: [0.04, 0.92],
    clearcoatMax: 1.0,
    transmissionMax: 0.95,
    emissiveIntensityMax: 6.0,
    maxColors: 24,
    minColors: 2,
    bevel: 0.035,
    maxExtent: 3.0,
    minNodeDim: 0.01
  },
  stylized: {
    name: 'premium_stylized',
    minParts: 6,
    maxParts: 96,
    metalness: [0.0, 1.0],
    roughness: [0.04, 0.92],
    clearcoatMax: 1.0,
    transmissionMax: 0.95,
    emissiveIntensityMax: 6.0,
    maxColors: 24,
    minColors: 2,
    bevel: 0.035,
    maxExtent: 3.0,
    minNodeDim: 0.01
  },
  draft: {
    name: 'draft',
    minParts: 4,
    maxParts: 64,
    metalness: [0.0, 1.0],
    roughness: [0.02, 0.98],
    clearcoatMax: 1.0,
    transmissionMax: 1.0,
    emissiveIntensityMax: 6.0,
    maxColors: 24,
    minColors: 1,
    bevel: 0.015,
    maxExtent: 3.0,
    minNodeDim: 0.01
  }
});

/**
 * Generation presets are derived from the canonical quality levels so the four
 * user-facing names and the internal tessellation table can never drift apart.
 * Legacy identifiers stay resolvable for jobs recorded before the rename.
 */
const QUALITY_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(QUALITY_LEVELS)
      .map(([id, level]) => [id, Object.freeze({ targetPolycount: level.targetPolycount })])
      .concat(
        Object.entries(LEGACY_ALIASES).map(([alias, id]) => [
          alias,
          Object.freeze({ targetPolycount: QUALITY_LEVELS[id].targetPolycount })
        ])
      )
  )
);

const STYLIZED_PROFILE = GENERATION_PROFILES.production_pbr;

/** Rows persisted before the 2.2.19 rename still carry the old profile key. */
const LEGACY_PROFILE_ALIASES = Object.freeze({
  enterprise_pbr: 'production_pbr'
});

function resolveProfile(profileName) {
  if (!profileName) return GENERATION_PROFILES.production_pbr;
  const key = String(profileName).toLowerCase();
  const resolved = LEGACY_PROFILE_ALIASES[key] || key;
  return GENERATION_PROFILES[resolved] || GENERATION_PROFILES.production_pbr;
}

function getNodeBounds(node) {
  const g = node.geometry || {};
  const p = g.params || {};
  const t = node.transform || {};
  const pos = t.position || [0, 0, 0];
  const scl = t.scale || [1, 1, 1];

  let sx = 1, sy = 1, sz = 1;
  const type = g.type || 'box';

  if (type === 'box' || type === 'roundedBox') {
    const rawW = p.width ?? (Array.isArray(p.size) ? p.size[0] : 1);
    const rawH = p.height ?? (Array.isArray(p.size) ? p.size[1] : 1);
    const rawD = p.depth ?? (Array.isArray(p.size) ? p.size[2] : 1);
    sx = (rawW || 1) * Math.abs(scl[0] || 1);
    sy = (rawH || 1) * Math.abs(scl[1] || 1);
    sz = (rawD || 1) * Math.abs(scl[2] || 1);
  } else if (type === 'sphere') {
    const r = (p.radius || 1);
    sx = r * 2 * Math.abs(scl[0] || 1);
    sy = r * 2 * Math.abs(scl[1] || 1);
    sz = r * 2 * Math.abs(scl[2] || 1);
  } else if (type === 'cylinder' || type === 'cone') {
    const r = Math.max(p.radiusTop || 0, p.radiusBottom || 0, p.radius || 1);
    sx = r * 2 * Math.abs(scl[0] || 1);
    sy = (p.height || 1) * Math.abs(scl[1] || 1);
    sz = r * 2 * Math.abs(scl[2] || 1);
  } else if (type === 'capsule') {
    const r = p.radius || 0.2;
    const l = p.length || 0.5;
    sx = r * 2 * Math.abs(scl[0] || 1);
    sy = (l + r * 2) * Math.abs(scl[1] || 1);
    sz = r * 2 * Math.abs(scl[2] || 1);
  } else if (type === 'torus') {
    const r = p.radius || 0.5;
    const tube = p.tube || 0.1;
    sx = (r + tube) * 2 * Math.abs(scl[0] || 1);
    sy = tube * 2 * Math.abs(scl[1] || 1);
    sz = (r + tube) * 2 * Math.abs(scl[2] || 1);
  } else {
    sx = Math.abs(scl[0] || 1);
    sy = Math.abs(scl[1] || 1);
    sz = Math.abs(scl[2] || 1);
  }

  const minX = pos[0] - sx / 2;
  const maxX = pos[0] + sx / 2;
  const minY = pos[1] - sy / 2;
  const maxY = pos[1] + sy / 2;
  const minZ = pos[2] - sz / 2;
  const maxZ = pos[2] + sz / 2;

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    dim: [sx, sy, sz]
  };
}

function applyGenerationProfile(rawSpec, profileName = 'production_pbr') {
  if (!rawSpec || typeof rawSpec !== 'object') return rawSpec;
  const spec = JSON.parse(JSON.stringify(rawSpec));
  const profile = resolveProfile(profileName || spec.profile);

  spec.nodes = spec.nodes || [];
  spec.style = spec.style || {};
  spec.style.bevel = profile.bevel;

  // Filter out sub-threshold tiny parts
  spec.nodes = spec.nodes.filter(node => {
    if (node.csg) return true;
    const b = getNodeBounds(node);
    const minDim = Math.min(...b.dim);
    return minDim >= profile.minNodeDim;
  });

  // Clamp and normalize material attributes
  for (const node of spec.nodes) {
    if (typeof node.material === 'string') {
      const mapped = spec.materials && typeof spec.materials[node.material] === 'object' ? spec.materials[node.material] : null;
      node.material = mapped ? { ...mapped } : { type: 'physical', color: node.material.startsWith('#') ? node.material : '#64748b', roughness: 0.35, metalness: 0.5 };
    }
    if (node.material && typeof node.material === 'object') {
      const mat = node.material;
      mat.metalness = Math.max(profile.metalness[0], Math.min(profile.metalness[1], mat.metalness ?? 0.5));
      mat.roughness = Math.max(profile.roughness[0], Math.min(profile.roughness[1], mat.roughness ?? 0.35));
      mat.clearcoat = Math.max(0, Math.min(profile.clearcoatMax, mat.clearcoat ?? 0.2));
      if (mat.transmission !== undefined) {
        mat.transmission = Math.max(0, Math.min(profile.transmissionMax, mat.transmission));
      }
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = Math.max(0, Math.min(profile.emissiveIntensityMax, mat.emissiveIntensity));
      }
    }
  }

  // Calculate overall bounding box
  let globalMinY = Infinity;
  let maxExtent = 0;

  for (const node of spec.nodes) {
    if (node.csg) continue;
    const b = getNodeBounds(node);
    if (b.min[1] < globalMinY) globalMinY = b.min[1];
    const spanX = Math.abs(b.max[0] - b.min[0]);
    const spanY = Math.abs(b.max[1] - b.min[1]);
    const spanZ = Math.abs(b.max[2] - b.min[2]);
    maxExtent = Math.max(maxExtent, spanX, spanY, spanZ);
  }

  // Min(y)=0 grounding
  if (Number.isFinite(globalMinY) && Math.abs(globalMinY) > 0.001) {
    const shiftY = -globalMinY;
    for (const node of spec.nodes) {
      if (node.transform && node.transform.position) {
        node.transform.position[1] += shiftY;
      }
    }
  }

  // Scale if bounding extent exceeds maxExtent
  if (maxExtent > profile.maxExtent && maxExtent > 0) {
    const scaleFactor = profile.maxExtent / maxExtent;
    for (const node of spec.nodes) {
      if (node.transform && node.transform.position) {
        node.transform.position[0] *= scaleFactor;
        node.transform.position[1] *= scaleFactor;
        node.transform.position[2] *= scaleFactor;
      }
      if (node.transform && node.transform.scale) {
        node.transform.scale[0] *= scaleFactor;
        node.transform.scale[1] *= scaleFactor;
        node.transform.scale[2] *= scaleFactor;
      }
    }
  }

  // Pad parts if below minParts
  if (spec.nodes.length < profile.minParts) {
    const needed = profile.minParts - spec.nodes.length;
    const paddingParts = detailParts(spec.nodes.length + needed, spec.nodes);
    spec.nodes.push(...paddingParts);
  }
  const distinctColors = new Set(
    spec.nodes.map((n) => n.material && n.material.color && String(n.material.color).toLowerCase()).filter(Boolean)
  );
  if (distinctColors.size < profile.minColors && spec.nodes.length >= 2) {
    const lastMat = spec.nodes[spec.nodes.length - 1].material || (spec.nodes[spec.nodes.length - 1].material = { type: 'physical' });
    lastMat.color = distinctColors.has('#38bdf8') ? '#f59e0b' : '#38bdf8';
  }
  return spec;
}

const applyStylizedProfile = applyGenerationProfile;

/**
 * 11-Row scoreSpec Quality Gate
 */
function appendMaterialRangeRows(nodes, profile, rows, issues) {
  const partCount = nodes.length;
  const partCountPassed = partCount >= profile.minParts && partCount <= profile.maxParts;
  if (!partCountPassed) issues.push(`Part count ${partCount} out of bounds [${profile.minParts}, ${profile.maxParts}]`);
  rows.push({ rowId: 1, metricName: 'part_count', measuredValue: partCount, threshold: `[${profile.minParts}, ${profile.maxParts}]`, passed: partCountPassed });

  const invalidMetalness = nodes.filter(n => n.material && (n.material.metalness < profile.metalness[0] || n.material.metalness > profile.metalness[1])).length;
  if (invalidMetalness > 0) issues.push(`${invalidMetalness} parts have metalness outside [${profile.metalness.join(', ')}]`);
  rows.push({ rowId: 2, metricName: 'metalness_range', measuredValue: invalidMetalness, threshold: 0, passed: invalidMetalness === 0 });

  const invalidRoughness = nodes.filter(n => n.material && (n.material.roughness < profile.roughness[0] || n.material.roughness > profile.roughness[1])).length;
  if (invalidRoughness > 0) issues.push(`${invalidRoughness} parts have roughness outside [${profile.roughness.join(', ')}]`);
  rows.push({ rowId: 3, metricName: 'roughness_range', measuredValue: invalidRoughness, threshold: 0, passed: invalidRoughness === 0 });

  const invalidCoatTrans = nodes.filter(n => n.material && ((n.material.clearcoat || 0) > profile.clearcoatMax || (n.material.transmission || 0) > profile.transmissionMax)).length;
  if (invalidCoatTrans > 0) issues.push(`${invalidCoatTrans} parts exceed clearcoat/transmission limits`);
  rows.push({ rowId: 4, metricName: 'clearcoat_transmission', measuredValue: invalidCoatTrans, threshold: 0, passed: invalidCoatTrans === 0 });

  const invalidEmissive = nodes.filter(n => n.material && (n.material.emissiveIntensity || 0) > profile.emissiveIntensityMax).length;
  if (invalidEmissive > 0) issues.push(`${invalidEmissive} parts exceed max emissive intensity ${profile.emissiveIntensityMax}`);
  rows.push({ rowId: 5, metricName: 'emissive_range', measuredValue: invalidEmissive, threshold: 0, passed: invalidEmissive === 0 });

  const colors = new Set(nodes.map(n => n.material && n.material.color && String(n.material.color).toLowerCase()).filter(Boolean));
  const colorCount = colors.size;
  const colorPassed = colorCount >= profile.minColors && colorCount <= profile.maxColors;
  if (!colorPassed) issues.push(`Color count ${colorCount} outside [${profile.minColors}, ${profile.maxColors}]`);
  rows.push({ rowId: 6, metricName: 'color_palette_diversity', measuredValue: colorCount, threshold: `[${profile.minColors}, ${profile.maxColors}]`, passed: colorPassed });
}

function appendBoundsAndHierarchyRows(spec, nodes, profile, rows, issues) {
  const bevelVal = (spec.style && typeof spec.style.bevel === 'number') ? spec.style.bevel : profile.bevel;
  const bevelPassed = bevelVal >= profile.bevel * 0.5;
  if (!bevelPassed) issues.push(`Style bevel ${bevelVal} below expected ${profile.bevel}`);
  rows.push({ rowId: 7, metricName: 'micro_chamfer_bevel', measuredValue: bevelVal, threshold: profile.bevel * 0.5, passed: bevelPassed });

  let maxExtent = 0;
  let minY = Infinity;
  let subThresholdDim = 0;
  for (const n of nodes) {
    if (n.csg) continue;
    const b = getNodeBounds(n);
    if (b.min[1] < minY) minY = b.min[1];
    maxExtent = Math.max(maxExtent, Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[1] - b.min[1]), Math.abs(b.max[2] - b.min[2]));
    if (Math.min(...b.dim) < profile.minNodeDim) subThresholdDim++;
  }

  const extentPassed = maxExtent <= profile.maxExtent * 1.05;
  if (!extentPassed) issues.push(`Max extent ${maxExtent.toFixed(2)} exceeds ${profile.maxExtent}`);
  rows.push({ rowId: 8, metricName: 'bounding_extent', measuredValue: Number(maxExtent.toFixed(3)), threshold: profile.maxExtent, passed: extentPassed });

  const minDimPassed = subThresholdDim === 0;
  if (!minDimPassed) issues.push(`${subThresholdDim} nodes have sub-threshold dimension < ${profile.minNodeDim}`);
  rows.push({ rowId: 9, metricName: 'min_node_dimension', measuredValue: subThresholdDim, threshold: 0, passed: minDimPassed });

  const grounded = !Number.isFinite(minY) || minY >= -0.05;
  if (!grounded) issues.push(`Grounding violated: minY is ${minY.toFixed(3)} (expected >= -0.05)`);
  rows.push({ rowId: 10, metricName: 'grounding_min_y', measuredValue: Number.isFinite(minY) ? Number(minY.toFixed(3)) : 0, threshold: -0.05, passed: grounded });

  const hierarchyPassed = nodes.length >= profile.minParts;
  if (!hierarchyPassed) issues.push('Hierarchy lacks sufficient semantic subcomponents');
  rows.push({ rowId: 11, metricName: 'structural_hierarchy', measuredValue: nodes.length, threshold: profile.minParts, passed: hierarchyPassed });
}

function appendObjectiveCheckRows(objective, rows, issues) {
  const iouTarget = Number(objective.silhouetteTarget ?? 0.8);
  const iou = objective.silhouetteIoU;
  const iouPassed = iou === null || iou === undefined ? true : Number(iou) >= iouTarget;
  if (!iouPassed) issues.push(`Silhouette overlap ${Number(iou).toFixed(3)} below target ${iouTarget.toFixed(2)}`);
  rows.push({ rowId: 12, metricName: 'silhouette_overlap', measuredValue: iou === null || iou === undefined ? null : Number(Number(iou).toFixed(4)), threshold: iouTarget, passed: iouPassed });

  const symTarget = Number(objective.symmetryMin ?? 0.85);
  const sym = objective.symmetry;
  const symPassed = sym === null || sym === undefined ? true : Number(sym) >= symTarget;
  if (!symPassed) issues.push(`Symmetry ${Number(sym).toFixed(3)} below target ${symTarget.toFixed(2)}`);
  rows.push({ rowId: 13, metricName: 'symmetry', measuredValue: sym === null || sym === undefined ? null : Number(Number(sym).toFixed(4)), threshold: symTarget, passed: symPassed });

  const ratioPassed = objective.boxRatioOk !== false;
  if (!ratioPassed) issues.push('Bounding-box height/width ratio drifted outside tolerance');
  rows.push({
    rowId: 14,
    metricName: 'bbox_scale_ratio',
    measuredValue: objective.boxRatio === null || objective.boxRatio === undefined ? null : Number(Number(objective.boxRatio).toFixed(4)),
    threshold: Number(objective.boxRatioTolerance ?? 0.25),
    passed: ratioPassed
  });
}

function scoreSpec(spec, options = {}) {
  const profile = resolveProfile(options.profile || (spec && spec.profile));
  const issues = [];
  const rows = [];

  if (!spec || !Array.isArray(spec.nodes)) {
    return {
      ok: false,
      passed: false,
      score: 0,
      totalScore: 0,
      rows: [],
      issues: ['Invalid specification or missing nodes array']
    };
  }

  appendMaterialRangeRows(spec.nodes, profile, rows, issues);
  appendBoundsAndHierarchyRows(spec, spec.nodes, profile, rows, issues);
  const objective = options.checks && typeof options.checks === 'object' ? options.checks : null;
  if (objective) {
    appendObjectiveCheckRows(objective, rows, issues);
  }

  const passedRows = rows.filter(r => r.passed).length;
  const score = Math.round((passedRows / rows.length) * 100);

  return {
    ok: issues.length === 0,
    passed: issues.length === 0,
    score,
    totalScore: score,
    rows,
    issues
  };
}

module.exports = {
  GENERATION_PROFILES,
  QUALITY_PRESETS,
  STYLIZED_PROFILE,
  resolveProfile,
  getNodeBounds,
  applyGenerationProfile,
  applyStylizedProfile,
  scoreSpec
};
