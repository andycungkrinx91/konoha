'use strict';
/**
 * Regression: a sparse, mislabeled synthetic spec must be lifted to the archetype baseline
 * and carry the pipeline-resolved domain before it reaches buildSceneFromSpec.
 * Guards the engine test contract "rich multi-mesh vehicle compound" without any LLM call.
 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { enrichSynthesizedSpec } = require(path.join(ROOT, 'src/mcp/three_asset/vision_spec.js'));
const { buildSceneFromSpec } = require(path.join(ROOT, 'src/mcp/three_asset/scene_builder.js'));

const sparseTruckSpec = () => ({
  name: 'SajiraHauler3D',
  archetype: 'application',
  target_polycount: 12000,
  nodes: [
    { name: 'tractor', type: 'box', geometry: { width: 2.4, height: 2.1, depth: 6.4 }, transform: { position: [0, 1.2, 0] } },
    { name: 'trailer', type: 'box', geometry: { width: 2.4, height: 2.4, depth: 8.2 }, transform: { position: [0, 1.5, -7.4] } },
    { name: 'tube_517', type: 'cylinder', geometry: { radius: 0.5, height: 0.3 }, transform: { position: [1.1, 0.5, 2.2] } },
    { name: 'tube_574', type: 'cylinder', geometry: { radius: 0.5, height: 0.3 }, transform: { position: [-1.1, 0.5, 2.2] } }
  ]
});

(async () => {
  const results = [];
  const check = async (label, fn) => {
    try {
      await fn();
      results.push(`pass: ${label}`);
    } catch (err) {
      results.push(`FAIL: ${label} :: ${err.message}`);
      process.exitCode = 1;
    }
  };

  await check('sparse truck spec is lifted to the logistics baseline', async () => {
    const spec = await enrichSynthesizedSpec('heavy electric semi truck for cargo logistics', sparseTruckSpec(), 'SajiraHauler3D', 12000, 'logistics');
    assert.strictEqual(spec.archetype, 'logistics', 'archetype must carry the resolved domain');
    assert.ok(spec.nodes.length >= 12, `expected >= 12 nodes, got ${spec.nodes.length}`);
  });

  await check('lifted spec builds a multi-mesh vehicle compound', async () => {
    const spec = await enrichSynthesizedSpec('heavy electric semi truck for cargo logistics', sparseTruckSpec(), 'SajiraHauler3D', 12000, 'logistics');
    const built = await buildSceneFromSpec(spec);
    assert.ok(built.meshCount >= 11, `expected >= 11 meshes, got ${built.meshCount}`);
    assert.ok(built.triangleCount > 200, `expected > 200 triangles, got ${built.triangleCount}`);
    results.push(`info: nodes=${spec.nodes.length} meshes=${built.meshCount} triangles=${built.triangleCount}`);
  });

  await check('rich specs are left untouched (no gratuitous padding)', async () => {
    const rich = sparseTruckSpec();
    rich.archetype = 'game-vehicle';
    rich.nodes = Array.from({ length: 20 }, (_, i) => ({
      name: `panel_${i}`, type: 'box', geometry: { width: 0.5, height: 0.2, depth: 0.5 }, transform: { position: [i * 0.1, 0.2, 0] }
    }));
    const spec = await enrichSynthesizedSpec('armoured dropship', rich, 'Dropship', 12000, 'game-vehicle');
    assert.strictEqual(spec.nodes.length, 20, 'already-rich spec must not be padded');
    assert.strictEqual(spec.archetype, 'game-vehicle');
  });

  await check('application prompts keep the application label', async () => {
    const spec = await enrichSynthesizedSpec('saas analytics dashboard shell', { ...sparseTruckSpec(), nodes: sparseTruckSpec().nodes.map((n) => ({ ...n })) }, 'Shell', 12000, 'application');
    assert.strictEqual(spec.archetype, 'application');
  });

  for (const line of results) console.log(`  ${line.startsWith('FAIL') ? '✗' : '✓'} ${line}`);
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} checks, ${failed} failed`);
})().catch((err) => {
  console.error('test crashed:', err);
  process.exit(1);
});
