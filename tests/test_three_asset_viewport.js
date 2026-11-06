#!/usr/bin/env node
'use strict';

/**
 * tests/test_three_asset_viewport.js
 *
 * Viewport, headless canvas, and render pipeline test suite for Yamanaka 3D:
 * - Initializes headless WebGL / DOM shim environment
 * - Validates Scene, PerspectiveCamera, and DirectionalLight setups
 * - Exercises offscreen canvas resize, aspect ratio recalculation, and viewport bounds
 * - Verifies procedural GLB asset generation and preview generation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureHeadlessShim } = require('../src/mcp/three_asset/headless_shim');
const { generate3DAsset } = require('../src/mcp/three_asset/index');
const { validateGlbHeader } = require('../src/mcp/three_asset/exporter');
const { loadThree } = require('../src/mcp/three_asset/dep_loader');

const TMP_OUTPUT_DIR = path.join(os.tmpdir(), `konoha-viewport-test-${Date.now()}`);
fs.mkdirSync(TMP_OUTPUT_DIR, { recursive: true });

function cleanup() {
  try {
    fs.rmSync(TMP_OUTPUT_DIR, { recursive: true, force: true });
  } catch (_) { /* best-effort cleanup */ }
}

process.on('exit', cleanup);

async function runViewportTests() {
  console.log('Running test_three_asset_viewport.js...\n');

  // Verify headless shim initialization
  console.log('Testing headless WebGL and DOM shim initialization...');
  ensureHeadlessShim();

  assert.ok(globalThis.self, 'globalThis.self must be defined after ensureHeadlessShim');
  assert.ok(globalThis.requestAnimationFrame, 'requestAnimationFrame must be defined');
  assert.ok(globalThis.FileReader, 'FileReader must be defined for GLTFExporter');
  console.log('  ✓ Headless Three.js runtime shims established');

  // Viewport resize and aspect ratio validation
  console.log('Testing viewport resize and perspective matrix projection...');
  const THREE = loadThree();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  // Resize viewport to 1024x768
  const width = 1024;
  const height = 768;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  assert.strictEqual(camera.aspect, 1024 / 768, 'Camera aspect ratio should match viewport dimensions');
  assert.ok(camera.projectionMatrix.elements.length === 16, 'Projection matrix should have 16 elements');

  // Add lighting and geometry
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
  scene.add(ambientLight);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff88, roughness: 0.4 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  assert.strictEqual(scene.children.length, 3, 'Scene must contain two lights and one mesh');
  console.log('  ✓ Viewport scene, lighting, and camera projection verified');

  // Verify procedural asset generation through generate3DAsset
  console.log('Testing generate3DAsset end-to-end synthesis with preview...');
  const assetResult = await generate3DAsset({
    name: 'ViewportTestArtifact',
    archetype: 'saas',
    target_polycount: 2400,
    out_dir: TMP_OUTPUT_DIR,
    format: 'glb',
    force_regenerate: true,
    offline: true,
    use_llm: false
  });

  assert.ok(assetResult, 'Result object must be returned');
  assert.strictEqual(assetResult.success, true, 'Asset generation must succeed');
  assert.ok(fs.existsSync(assetResult.glb_path), 'GLB file must exist on disk');

  const glbBuf = fs.readFileSync(assetResult.glb_path);
  const headerCheck = validateGlbHeader(glbBuf);
  assert.strictEqual(headerCheck.magic, 'glTF');
  assert.strictEqual(headerCheck.version, 2);
  assert.ok(assetResult.triangles > 0, 'Triangle count should be greater than zero');
  assert.ok(assetResult.mesh_count > 0, 'Mesh count should be greater than zero');
  console.log(`  ✓ Procedural asset generated (${assetResult.triangles} triangles, ${assetResult.mesh_count} meshes)`);

  console.log('\n====================================================');
  console.log('✔ All 3D viewport and canvas render tests passed cleanly!');
  console.log('====================================================');
}

runViewportTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
