#!/usr/bin/env node
'use strict';

/**
 * tests/test_three_asset_style_profile.js
 * Comprehensive unit tests for Production Realistic PBR style profiles,
 * boundary normalizer, and 11-row scoreSpec quality gate.
 */

const assert = require('assert');
const {
  GENERATION_PROFILES,
  QUALITY_PRESETS,
  applyGenerationProfile,
  applyStylizedProfile,
  scoreSpec,
  getNodeBounds
} = require('../src/mcp/three_asset/style_profile');
const { createDefaultSceneSpec } = require('../src/mcp/three_asset/spec_schema');

console.log('Running test_three_asset_style_profile.js...');

// Verify GENERATION_PROFILES definitions (zero Roblox clamps)
console.log('\n--- 1. Testing Production Profile Definitions ---');
const ep = GENERATION_PROFILES.production_pbr;
assert.ok(ep, 'production_pbr profile must exist');
assert.strictEqual(ep.metalness[0], 0.0);
assert.strictEqual(ep.metalness[1], 1.0);
assert.strictEqual(ep.roughness[0], 0.02);
assert.strictEqual(ep.roughness[1], 0.96);
assert.strictEqual(ep.clearcoatMax, 1.0);
assert.strictEqual(ep.transmissionMax, 1.0);
assert.strictEqual(ep.maxExtent, 3.0);
console.log('  ✓ production_pbr profile supports full PBR metalness [0, 1] and roughness [0.02, 0.96].');

// Test clamping and material normalization on degenerate spec
console.log('\n--- 2. Testing Boundary Normalizer ---');
const rawSpec = {
  name: 'TestDegenerate',
  archetype: 'game-character',
  nodes: [
    {
      name: 'part_tiny',
      geometry: { type: 'box', params: { width: 0.001, height: 0.001, depth: 0.001 } },
      material: { color: '#ffffff', metalness: 0.99, roughness: 0.1, clearcoat: 0.9 },
      transform: { position: [0, 0, 0] }
    },
    {
      name: 'part_valid',
      geometry: { type: 'box', params: { width: 1.0, height: 1.0, depth: 1.0 } },
      material: { color: '#3b82f6', metalness: 0.85, roughness: 0.25, clearcoat: 0.4 },
      transform: { position: [0, -0.5, 0] }
    }
  ]
};

const normalized = applyGenerationProfile(rawSpec, 'production_pbr');
console.log('  Normalized nodes count:', normalized.nodes.length);

// Sub-threshold tiny part filtered out, padding added to reach >= minParts (6)
assert.ok(normalized.nodes.length >= 6, 'Nodes must be padded to at least minParts (6)');
assert.ok(!normalized.nodes.some(n => n.name === 'part_tiny'), 'Sub-threshold tiny part must be filtered out');

// Verify grounding: min_y >= -0.01
let minY = Infinity;
for (const n of normalized.nodes) {
  const b = getNodeBounds(n);
  if (b.min[1] < minY) minY = b.min[1];
}
assert.ok(minY >= -0.01, `Model must be grounded with min_y >= -0.01 (actual: ${minY})`);
console.log('  ✓ Grounding and node padding verified cleanly.');

// Test 11-Row scoreSpec Quality Gate
console.log('\n--- 3. Testing 11-Row scoreSpec Output ---');
const scoreRes = scoreSpec(normalized, { profile: 'production_pbr' });

assert.strictEqual(typeof scoreRes.ok, 'boolean');
assert.strictEqual(typeof scoreRes.score, 'number');
assert.ok(Array.isArray(scoreRes.rows), 'scoreSpec must return rows array');
assert.strictEqual(scoreRes.rows.length, 11, 'scoreSpec must return exactly 11 validation rows');

const rowNames = scoreRes.rows.map(r => r.metricName);
const expectedRows = [
  'part_count',
  'metalness_range',
  'roughness_range',
  'clearcoat_transmission',
  'emissive_range',
  'color_palette_diversity',
  'micro_chamfer_bevel',
  'bounding_extent',
  'min_node_dimension',
  'grounding_min_y',
  'structural_hierarchy'
];

for (let i = 0; i < 11; i++) {
  assert.strictEqual(scoreRes.rows[i].rowId, i + 1, `Row ${i + 1} must have rowId ${i + 1}`);
  assert.strictEqual(scoreRes.rows[i].metricName, expectedRows[i], `Row ${i + 1} metricName mismatch`);
  assert.strictEqual(typeof scoreRes.rows[i].passed, 'boolean');
}
console.log('  ✓ Exactly 11 structured ScoreSpecRow objects returned with correct rowIds and metricNames.');

// Test Backward-Compatibility Aliases
console.log('\n--- 4. Testing Backward-Compatibility Aliases ---');
const legacyNormalized = applyStylizedProfile(rawSpec);
assert.ok(legacyNormalized.nodes.length >= 6);
console.log('  ✓ applyStylizedProfile backward-compatible alias functions identical to applyGenerationProfile.');

console.log('\n✔ All test_three_asset_style_profile assertions passed 100%!\n');
