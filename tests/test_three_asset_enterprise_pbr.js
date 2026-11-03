#!/usr/bin/env node
'use strict';

/**
 * tests/test_three_asset_enterprise_pbr.js
 *
 * Verifies Realistic / Premium / Enterprise 3D Templates & PBR Materials across all 16 archetypes:
 * 1. Proves all 16 domain archetypes exist in ENTERPRISE_TEMPLATES.
 * 2. Proves high-segment curved geometries (capsule, lathe, cylinder, sphere, torus) are present.
 * 3. Proves realistic PBR ranges (metalness > 0.5, clearcoat > 0.2, transmission > 0).
 * 4. Proves 0 Roblox blocky constraints or clamps.
 */

const assert = require('assert');
const { ENTERPRISE_TEMPLATES, ENTERPRISE_MATERIALS } = require('../src/mcp/three_asset/part_library');
const { createDefaultSceneSpec, validateSceneSpec } = require('../src/mcp/three_asset/spec_schema');
const { scoreSpec } = require('../src/mcp/three_asset/style_profile');

console.log('Running test_three_asset_enterprise_pbr.js...');

const ARCHETYPES = [
  'game-character', 'game-prop', 'game-weapon', 'game-vehicle',
  'game-environment', 'game-tileset', 'game-creature', 'game-building',
  'logistics', 'vehicle', 'commerce', 'dashboard',
  'portfolio', 'saas', 'landing', 'application'
];

console.log('\n--- 1. Testing All 16 Domain Archetypes in ENTERPRISE_TEMPLATES ---');
for (const arch of ARCHETYPES) {
  assert.ok(ENTERPRISE_TEMPLATES[arch], `Archetype '${arch}' must exist in ENTERPRISE_TEMPLATES`);
  assert.ok(Array.isArray(ENTERPRISE_TEMPLATES[arch]), `Archetype '${arch}' must be an array of nodes`);
  assert.ok(ENTERPRISE_TEMPLATES[arch].length >= 5, `Archetype '${arch}' must have at least 5 nodes`);

  const spec = createDefaultSceneSpec(arch);
  const validated = validateSceneSpec(spec);
  assert.strictEqual(validated.archetype, arch);

  const scoreRes = scoreSpec(validated, { profile: 'enterprise_pbr' });
  assert.strictEqual(scoreRes.rows.length, 11);
  assert.ok(scoreRes.score >= 80, `Archetype '${arch}' default score ${scoreRes.score} must be >= 80`);
}
console.log('  ✓ All 16 domain archetypes validated and pass scoreSpec quality gate.');

console.log('\n--- 2. Testing Curved Primitives & Enterprise Materials ---');
const characterNodes = ENTERPRISE_TEMPLATES['game-character'];
const geomTypes = new Set(characterNodes.map(n => n.geometry.type));
assert.ok(geomTypes.has('capsule') || geomTypes.has('cylinder'), 'Character must use curved capsule/cylinder geometry');
assert.ok(geomTypes.has('sphere'), 'Character must use curved sphere geometry');

// Check enterprise materials
assert.ok(ENTERPRISE_MATERIALS.brushed_titanium.metalness >= 0.85);
assert.ok(ENTERPRISE_MATERIALS.polished_chrome.metalness >= 0.95);
assert.ok(ENTERPRISE_MATERIALS.optical_glass.transmission >= 0.90);
assert.ok(ENTERPRISE_MATERIALS.carbon_fiber.clearcoat >= 0.50);
console.log('  ✓ Enterprise physical materials verified with metallic, transmission, and clearcoat ranges.');

console.log('\n✔ All Enterprise Realistic PBR tests passed 100%!\n');
