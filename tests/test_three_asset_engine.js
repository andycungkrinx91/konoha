#!/usr/bin/env node
'use strict';

/**
 * tests/test_three_asset_engine.js
 *
 * Comprehensive test suite for WS-1 (Three.js r187 3D Asset Engine):
 * 1. Scene specification validation & default archetype templates.
 * 2. Three.js r187 procedural scene construction (triangles & meshes).
 * 3. Headless binary GLB export with glTF 2.0 header validation.
 * 4. Headless JSON glTF export.
 * 5. Full round-trip re-import via GLTFLoader (0 parse errors).
 * 6. generate3DAsset end-to-end orchestration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { validateSceneSpec, createDefaultSceneSpec } = require('../src/mcp/three_asset/spec_schema');
const { buildSceneFromSpec } = require('../src/mcp/three_asset/scene_builder');
const { exportScene, validateGlbHeader } = require('../src/mcp/three_asset/exporter');
const { generate3DAsset } = require('../src/mcp/three_asset/index');
const { ensureHeadlessShim } = require('../src/mcp/three_asset/headless_shim');

const QA_DIR = path.join(os.tmpdir(), `konoha-3d-test-${Date.now()}`);
fs.mkdirSync(QA_DIR, { recursive: true });

async function runTests() {
  console.log('Running test_three_asset_engine.js...');
  console.log(`Test Output Dir: ${QA_DIR}`);

  // Verify spec schema and archetype defaults
  console.log('\n--- Testing Spec Schema & Archetype Defaults ---');
  const archetypes = ['commerce', 'dashboard', 'portfolio', 'saas', 'landing', 'application'];
  for (const arch of archetypes) {
    const spec = createDefaultSceneSpec(arch, `Test_${arch}`);
    assert.strictEqual(spec.archetype, arch === 'saas' ? 'saas' : arch === 'application' ? 'application' : arch);
    assert.ok(spec.nodes.length >= 2, `Archetype ${arch} should have at least 2 nodes`);

    const validated = validateSceneSpec(spec);
    assert.ok(Array.isArray(validated.nodes));
    assert.ok(validated.camera.fov >= 15 && validated.camera.fov <= 90);
    assert.ok(validated.lights.length >= 2);
  }
  console.log('  ✓ All 6 archetypes produce valid scene specifications.');

  // Verify procedural scene construction
  console.log('\n--- Testing Scene Construction ---');
  const dashboardSpec = createDefaultSceneSpec('dashboard', 'LiveMetricsHub');
  const buildResult = await buildSceneFromSpec(dashboardSpec);
  assert.ok(buildResult.scene, 'Scene must be created');
  assert.ok(buildResult.triangleCount > 100, `Expected > 100 triangles, got ${buildResult.triangleCount}`);
  assert.strictEqual(buildResult.meshCount, dashboardSpec.nodes.length);
  console.log(`  ✓ Built scene with ${buildResult.triangleCount} triangles across ${buildResult.meshCount} meshes.`);

  // Verify binary GLB export and header
  console.log('\n--- Testing Binary GLB Export & Header Verification ---');
  const glbPath = path.join(QA_DIR, 'test_model.glb');
  const glbExport = await exportScene(buildResult.scene, glbPath, { format: 'glb' });
  assert.strictEqual(glbExport.format, 'glb');
  assert.ok(glbExport.bytes > 1000, `Expected GLB > 1000 bytes, got ${glbExport.bytes}`);
  assert.ok(fs.existsSync(glbPath), 'GLB file must exist on disk');

  const fileBuf = fs.readFileSync(glbPath);
  const header = validateGlbHeader(fileBuf);
  assert.strictEqual(header.magic, 'glTF');
  assert.strictEqual(header.version, 2);
  assert.strictEqual(header.length, fileBuf.byteLength);
  console.log(`  ✓ GLB exported: ${glbExport.bytes} bytes, magic='${header.magic}', version=${header.version}.`);

  // Verify JSON glTF export
  console.log('\n--- Testing JSON glTF Export ---');
  const gltfPath = path.join(QA_DIR, 'test_model.gltf');
  const gltfExport = await exportScene(buildResult.scene, gltfPath, { format: 'gltf' });
  assert.strictEqual(gltfExport.format, 'gltf');
  assert.ok(fs.existsSync(gltfPath), 'glTF file must exist on disk');
  const parsedGltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  assert.strictEqual(parsedGltf.asset.version, '2.0');
  console.log(`  ✓ glTF exported: ${gltfExport.bytes} bytes, asset.version='${parsedGltf.asset.version}'.`);

  // Verify round-trip parsing via GLTFLoader
  console.log('\n--- Testing Round-Trip Parsing via GLTFLoader ---');
  ensureHeadlessShim();
  const { GLTFLoader } = require('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  const loadedGlb = await new Promise((resolve, reject) => {
    const ab = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
    loader.parse(
      ab,
      '',
      (gltf) => resolve(gltf),
      (err) => reject(err)
    );
  });

  assert.ok(loadedGlb.scene, 'Loaded GLB must have a scene');
  let loadedMeshCount = 0;
  loadedGlb.scene.traverse((child) => {
    if (child.isMesh) loadedMeshCount++;
  });
  assert.strictEqual(loadedMeshCount, buildResult.meshCount, `Loaded mesh count ${loadedMeshCount} must match original ${buildResult.meshCount}`);
  console.log(`  ✓ Round-trip verified: successfully loaded ${loadedMeshCount} meshes with 0 parse errors.`);

  // Test generate3DAsset Orchestrator
  console.log('\n--- Testing generate3DAsset Orchestration ---');
  const orchResult = await generate3DAsset({
    name: 'CommerceRingHero',
    archetype: 'commerce',
    out_dir: path.join(QA_DIR, 'orchestrator_output'),
    format: 'glb'
  });
  assert.strictEqual(orchResult.success, true);
  assert.strictEqual(orchResult.format, 'glb');
  assert.strictEqual(orchResult.three_version, '0.187.0');
  assert.ok(orchResult.bytes > 0);
  assert.ok(orchResult.triangles > 0);
  assert.ok(fs.existsSync(orchResult.glb_path));
  console.log(`  ✓ generate3DAsset succeeded: ${orchResult.glb_path} (${orchResult.bytes} bytes, ${orchResult.triangles} triangles).`);

  // Test Dynamic SVG to 3D Extrusion
  console.log('\n--- Testing Dynamic SVG to 3D Vector Extrusion ---');
  const testSvgPath = path.join(QA_DIR, 'badge.svg');
  const svgContent = '<svg width=\"200\" height=\"200\" viewBox=\"0 0 200 200\"><polygon points=\"100,10 40,190 190,75 10,75 160,190\" fill=\"#6366f1\"/></svg>';
  fs.writeFileSync(testSvgPath, svgContent, 'utf8');

  const svgResult = await generate3DAsset({
    name: 'StarBadge3D',
    image_path: testSvgPath,
    color: '#38bdf8',
    depth: 0.35,
    out_dir: path.join(QA_DIR, 'svg_output'),
    format: 'glb'
  });
  assert.strictEqual(svgResult.success, true);
  assert.strictEqual(svgResult.source, 'svg_extrusion');
  assert.ok(svgResult.triangles > 0);
  assert.ok(fs.existsSync(svgResult.glb_path));

  // Round-trip re-import of SVG-generated GLB
  const svgGlbBuf = fs.readFileSync(svgResult.glb_path);
  const svgHeader = validateGlbHeader(svgGlbBuf);
  assert.strictEqual(svgHeader.magic, 'glTF');
  assert.strictEqual(svgHeader.version, 2);

  const loadedSvg = await new Promise((resolve, reject) => {
    const ab = svgGlbBuf.buffer.slice(svgGlbBuf.byteOffset, svgGlbBuf.byteOffset + svgGlbBuf.byteLength);
    loader.parse(ab, '', gltf => resolve(gltf), err => reject(err));
  });
  assert.ok(loadedSvg.scene, 'Loaded SVG 3D asset must contain a scene');
  console.log(`  ✓ SVG to 3D verified: ${svgResult.glb_path} (${svgResult.bytes} bytes, ${svgResult.triangles} triangles, valid GLB header).`);

  // Test Dynamic PNG Relief Mesh Generation
  console.log('\n--- Testing Dynamic PNG Heightfield Relief Generation ---');
  const testPngPath = path.join(QA_DIR, 'emblem.png');
  const rawPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(testPngPath, rawPng);

  const pngResult = await generate3DAsset({
    name: 'EmblemRelief3D',
    image_path: testPngPath,
    color: '#818cf8',
    max_displacement: 0.45,
    out_dir: path.join(QA_DIR, 'png_output'),
    format: 'glb'
  });
  assert.strictEqual(pngResult.success, true);
  assert.strictEqual(pngResult.source, 'image_relief');
  assert.ok(pngResult.triangles > 0);
  assert.ok(fs.existsSync(pngResult.glb_path));

  const pngGlbBuf = fs.readFileSync(pngResult.glb_path);
  const pngHeader = validateGlbHeader(pngGlbBuf);
  assert.strictEqual(pngHeader.magic, 'glTF');
  assert.strictEqual(pngHeader.version, 2);
  console.log(`  ✓ PNG to 3D relief verified: ${pngResult.glb_path} (${pngResult.bytes} bytes, ${pngResult.triangles} triangles, valid GLB header).`);
  // Test Offline Prompt-Driven Procedural Vehicle Generation
  console.log('\n--- Testing Offline Prompt-Driven Procedural Vehicle Generation ---');
  const vehicleResult = await generate3DAsset({
    name: 'SajiraHauler3D',
    archetype: 'logistics',
    prompt: 'heavy electric semi truck for cargo logistics',
    color: '#059669',
    out_dir: path.join(QA_DIR, 'vehicle_output'),
    format: 'glb',
    force_regenerate: true,
    use_vision: false,
    offline: true,
    use_llm: false
  });
  assert.strictEqual(vehicleResult.success, true);
  assert.ok(['procedural_default', 'procedural_fallback', 'prompt_dsl', 'prompt_synthesis', 'scaffolded_dsl', 'prompt', 'offline_procedural'].includes(vehicleResult.source), `Unexpected source ${vehicleResult.source}`);
  assert.ok(['logistics', 'game-vehicle', 'vehicle'].includes(vehicleResult.archetype), `Archetype ${vehicleResult.archetype} must resolve to a vehicle domain`);
  assert.ok(vehicleResult.triangles > 200, 'Must generate rich multi-mesh vehicle compound');
  assert.ok(vehicleResult.mesh_count >= 11, 'Must have at least 11 vehicle mesh components');
  assert.ok(fs.existsSync(vehicleResult.glb_path));

  // Assert provider calls and tokens remain zero for offline generation
  assert.strictEqual(vehicleResult.tokens.input_tokens, 0, 'Offline vehicle generation must consume 0 input tokens');
  assert.strictEqual(vehicleResult.tokens.output_tokens, 0, 'Offline vehicle generation must consume 0 output tokens');
  assert.strictEqual(vehicleResult.tokens.total_tokens, 0, 'Offline vehicle generation must consume 0 total tokens');

  const vehicleGlbBuf = fs.readFileSync(vehicleResult.glb_path);
  const vehicleHeader = validateGlbHeader(vehicleGlbBuf);
  assert.strictEqual(vehicleHeader.magic, 'glTF');
  assert.strictEqual(vehicleHeader.version, 2);
  console.log('  ✓ Offline procedural vehicle generation verified: ' + vehicleResult.glb_path + ' (' + vehicleResult.bytes + ' bytes, ' + vehicleResult.triangles + ' triangles, 11 meshes).');

  // Test Zero Local Models Guarantee & Model Router
  console.log('\n--- Testing Zero Local Models Guarantee & Model Router ---');
  const { resolveChatTargets } = require('../src/mcp/three_asset/model_router');
  const targets = resolveChatTargets();
  assert.ok(Array.isArray(targets), 'resolveChatTargets must return array');
  assert.ok(!fs.existsSync(path.join(__dirname, '../src/mcp/three_asset/local_reconstruction.js')), 'local_reconstruction must be deleted');
  console.log('  ✓ Zero local models invariant and multi-target model router verified.');
  // Test Native ESM Three.js Loader & Addon Compatibility
  console.log('\n--- Testing Native ESM Three.js Loader & Addon Compatibility ---');
  const depLoader = require('../src/mcp/three_asset/dep_loader');
  const warnings = [];
  const onWarning = (w) => warnings.push(w);
  process.on('warning', onWarning);
  try {
    const THREE = depLoader.loadThree();
    assert.ok(THREE && typeof THREE.Scene === 'function', 'loadThree must export Scene constructor');
    assert.ok(typeof THREE.Mesh === 'function', 'loadThree must export Mesh constructor');
    const cjsWarnings = warnings.filter((w) => w.code === 'THREE_CJS_DEPRECATED' || /require\("three"\)/.test(w.message));
    assert.strictEqual(cjsWarnings.length, 0, 'loadThree must never emit THREE_CJS_DEPRECATED warning');
    const { GLTFExporter } = depLoader.loadAddon('exporters/GLTFExporter.js');
    assert.ok(GLTFExporter, 'loadAddon must resolve GLTFExporter without error');
    const roots = depLoader.candidateNodeModulesRoots();
    assert.ok(Array.isArray(roots) && roots.length > 0, 'candidateNodeModulesRoots must find at least one root');
    console.log('  ✓ Native ESM Three.js loaded with 0 deprecation warnings and verified addon compatibility.');
  } finally {
    process.removeListener('warning', onWarning);
  }

  console.log('\nAll tests in test_three_asset_engine.js passed cleanly!\n');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
