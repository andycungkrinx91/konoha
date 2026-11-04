#!/usr/bin/env node
'use strict';

/**
 * tests/test_quality_levels.js
 * Guards the four-level quality ladder (low / normal / high / ultra):
 * canonical roster, legacy aliases, expansion shape, and measured
 * geometry growth through buildSceneFromSpec.
 */

const assert = require('assert');
const {
  QUALITY_LEVELS,
  LEVEL_ORDER,
  LEGACY_ALIASES,
  POLYCOUNT_FLOOR,
  POLYCOUNT_CEILING,
  normalizeLevelId,
  resolveQualityLevel,
  expandLevelOptions,
  listQualityLevels
} = require('../src/mcp/three_asset/quality_levels');
const { QUALITY_PRESETS } = require('../src/mcp/three_asset/style_profile');
const { buildSceneFromSpec } = require('../src/mcp/three_asset/scene_builder');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  \u2713 ${label}`);
}

console.log('Running test_quality_levels.js...');

console.log('\n--- 1. Canonical ladder ---');
check('four levels in low/normal/high/ultra order', () => {
  assert.deepStrictEqual(LEVEL_ORDER, ['low', 'normal', 'high', 'ultra']);
  assert.deepStrictEqual(Object.keys(QUALITY_LEVELS), LEVEL_ORDER);
});
check('every level carries id, label, summary and targetPolycount', () => {
  for (const id of LEVEL_ORDER) {
    const level = QUALITY_LEVELS[id];
    assert.strictEqual(level.id, id);
    assert.ok(level.label && typeof level.label === 'string', `${id} label`);
    assert.ok(level.summary && level.summary.length > 20, `${id} summary`);
    assert.ok(Number.isInteger(level.targetPolycount), `${id} polycount`);
    assert.deepStrictEqual(Object.keys(level).sort(), ['id', 'label', 'summary', 'targetPolycount']);
  }
});
check('polycounts are strictly monotonic and inside the accepted band', () => {
  const counts = LEVEL_ORDER.map((id) => QUALITY_LEVELS[id].targetPolycount);
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i] > counts[i - 1], `level ${LEVEL_ORDER[i]} must exceed ${LEVEL_ORDER[i - 1]}`);
  }
  assert.ok(counts[0] >= POLYCOUNT_FLOOR, 'low level above floor');
  assert.ok(counts[counts.length - 1] <= POLYCOUNT_CEILING, 'ultra level below ceiling');
});

console.log('\n--- 2. Aliases and resolution ---');
check('legacy aliases resolve to canonical ids', () => {
  for (const [alias, id] of Object.entries(LEGACY_ALIASES)) {
    assert.strictEqual(normalizeLevelId(alias), id, `${alias} -> ${id}`);
  }
});
check('legacy standard still resolves to normal', () => {
  const resolved = resolveQualityLevel('standard');
  assert.strictEqual(resolved.id, 'normal');
  assert.strictEqual(resolved.requested, 'standard');
  assert.strictEqual(resolved.aliased, true);
  assert.strictEqual(resolved.known, true);
});
check('unknown preset falls back to the supplied default and reports known:false', () => {
  const resolved = resolveQualityLevel('not-a-level');
  assert.strictEqual(resolved.id, 'normal');
  assert.strictEqual(resolved.known, false);
  assert.strictEqual(resolveQualityLevel('not-a-level', 'ultra').id, 'ultra');
  assert.strictEqual(resolveQualityLevel('', 'high').id, 'high');
});

console.log('\n--- 3. Expansion exposes only real knobs ---');
check('expandLevelOptions returns quality_preset and target_polycount only', () => {
  for (const id of LEVEL_ORDER) {
    const options = expandLevelOptions(id);
    assert.deepStrictEqual(Object.keys(options).sort(), ['quality_preset', 'target_polycount']);
    assert.strictEqual(options.quality_preset, id);
    assert.strictEqual(options.target_polycount, QUALITY_LEVELS[id].targetPolycount);
  }
});
check('explicit override wins but is clamped to the accepted band', () => {
  assert.strictEqual(expandLevelOptions('high', { target_polycount: 9999 }).target_polycount, 9999);
  assert.strictEqual(expandLevelOptions('high', { target_polycount: 10 }).target_polycount, POLYCOUNT_FLOOR);
  assert.strictEqual(expandLevelOptions('high', { target_polycount: 1e9 }).target_polycount, POLYCOUNT_CEILING);
});
check('QUALITY_PRESETS mirrors the ladder and carries no phantom keys', () => {
  for (const id of LEVEL_ORDER) {
    assert.deepStrictEqual(QUALITY_PRESETS[id], { targetPolycount: QUALITY_LEVELS[id].targetPolycount });
  }
  for (const [alias, id] of Object.entries(LEGACY_ALIASES)) {
    assert.deepStrictEqual(QUALITY_PRESETS[alias], { targetPolycount: QUALITY_LEVELS[id].targetPolycount });
  }
});
check('listQualityLevels returns copies, not live references', () => {
  const listed = listQualityLevels();
  assert.strictEqual(listed.length, LEVEL_ORDER.length);
  listed[0].targetPolycount = 1;
  assert.notStrictEqual(QUALITY_LEVELS[LEVEL_ORDER[0]].targetPolycount, 1);
});

console.log('\n--- 4. Measured geometry growth (deterministic fixture) ---');
const FIXTURE_NODES = [
  { geometry: { type: 'sphere', params: { radius: 0.5 } } },
  { geometry: { type: 'torus', params: { radius: 0.6, tube: 0.08 } } },
  { geometry: { type: 'cylinder', params: { radiusTop: 0.12, radiusBottom: 0.18, height: 1.2 } } }
];

function countTriangles(geometry) {
  if (!geometry) return 0;
  const index = geometry.getIndex ? geometry.getIndex() : null;
  if (index && index.count) return Math.round(index.count / 3);
  const position = geometry.getAttribute ? geometry.getAttribute('position') : null;
  return position && position.count ? Math.round(position.count / 3) : 0;
}

async function measureLadder() {
  const rows = [];
  for (const id of LEVEL_ORDER) {
    const spec = {
      name: `quality-fixture-${id}`,
      target_polycount: QUALITY_LEVELS[id].targetPolycount,
      style: { bevel: 0.06 },
      nodes: FIXTURE_NODES.map((node, i) => ({
        ...node,
        name: `node-${i}`,
        transform: { position: [i * 0.1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: '#8899aa', metallic: 0.2, roughness: 0.5 }
      }))
    };
    const built = await buildSceneFromSpec(spec);
    const triangles = built.scene
      ? built.scene.children.reduce((sum, child) => sum + countTriangles(child.geometry), 0)
      : 0;
    rows.push({ id, triangles });
  }
  check('scene builder emits meshes for every level', () => {
    for (const row of rows) assert.ok(row.triangles > 0, `${row.id} produced no geometry`);
  });
  check('triangle count strictly increases level by level', () => {
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i].triangles > rows[i - 1].triangles,
        `${rows[i].id} (${rows[i].triangles}) must exceed ${rows[i - 1].id} (${rows[i - 1].triangles})`
      );
    }
  });
  check('ultra is at least twice as dense as normal', () => {
    const normal = rows.find((row) => row.id === 'normal').triangles;
    const ultra = rows.find((row) => row.id === 'ultra').triangles;
    assert.ok(ultra >= normal * 2, `ultra ${ultra} vs normal ${normal}`);
  });
  console.log(
    '  measured triangles: ' +
      rows.map((row) => `${row.id}=${row.triangles.toLocaleString()}`).join(' · ')
  );
}

console.log('\n--- 5. Orchestrator honours every budget ---');
async function measureOrchestratorLadder() {
  const { generate3DAsset } = require('../src/mcp/three_asset/index');
  const os = require('os');
  const fsx = require('fs');
  const pathx = require('path');
  const outRoot = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'quality-orchestrator-'));
  const rows = [];
  try {
    for (const id of LEVEL_ORDER) {
      const result = await generate3DAsset({
        name: 'OrchestratorLadder' + id,
        archetype: 'commerce',
        out_dir: pathx.join(outRoot, id),
        format: 'glb',
        target_polycount: QUALITY_LEVELS[id].targetPolycount
      });
      rows.push({ id, triangles: result.triangles });
    }
  } finally {
    fsx.rmSync(outRoot, { recursive: true, force: true });
  }
  check('generate3DAsset reports geometry for every level', () => {
    for (const row of rows) assert.ok(row.triangles > 0, `${row.id} exported no geometry`);
  });
  check('exported triangle count strictly increases level by level', () => {
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i].triangles > rows[i - 1].triangles,
        `${rows[i].id} (${rows[i].triangles}) must exceed ${rows[i - 1].id} (${rows[i - 1].triangles})`
      );
    }
  });
  check('orchestrator low budget stays below ultra budget', () => {
    const low = rows.find((row) => row.id === 'low').triangles;
    const ultra = rows.find((row) => row.id === 'ultra').triangles;
    assert.ok(ultra >= low * 4, `ultra ${ultra} must dwarf low ${low}`);
  });
  console.log(
    '  orchestrator triangles: ' + rows.map((row) => `${row.id}=${row.triangles.toLocaleString()}`).join(' · ')
  );
}

measureLadder()
  .then(() => measureOrchestratorLadder())
  .then(() => {
    console.log(`\n${passed} quality-level assertions passed.`);
  })
  .catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    process.exit(1);
  });
