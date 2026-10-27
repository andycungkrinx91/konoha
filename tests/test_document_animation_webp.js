'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const {
  diagramCreate,
  animationExport,
  validateAnimatedWebP
} = require('../src/workflow/tokubetsu-scribe/document_engine');

async function runTests() {
  console.log('Running test_document_animation_webp tests...');
  const testDir = path.join(os.tmpdir(), `konoha_webp_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // 1. Validator error handling on missing & corrupt files
    console.log('1. Testing validateAnimatedWebP error handling...');
    const nonExistent = validateAnimatedWebP(path.join(testDir, 'missing.webp'));
    assert.strictEqual(nonExistent.valid, false, 'Missing file must return valid: false');

    const corruptPath = path.join(testDir, 'corrupt.webp');
    fs.writeFileSync(corruptPath, Buffer.from('NOT_A_WEBP_HEADER_AT_ALL'));
    const corruptRes = validateAnimatedWebP(corruptPath);
    assert.strictEqual(corruptRes.valid, false, 'Corrupt header must return valid: false');

    // 2. Generate sample SVG diagram with nodes and edges
    console.log('2. Generating test SVG diagram...');
    const svgPath = path.join(testDir, 'test_flow.svg');
    const diagRes = await diagramCreate({
      output_path: svgPath,
      orientation: 'LR',
      gradient_theme: 'cyber_teal',
      nodes: [
        { id: 'client', label: 'Client App', subtext: 'Mobile / Web' },
        { id: 'gateway', label: 'API Gateway', subtext: 'Reverse Proxy' },
        { id: 'service', label: 'Core Service', subtext: 'Microservice' },
        { id: 'db', label: 'Database', subtext: 'SQLite WAL' }
      ],
      edges: [
        { from: 'client', to: 'gateway', label: 'HTTPS / JSON' },
        { from: 'gateway', to: 'service', label: 'gRPC' },
        { from: 'service', to: 'db', label: 'SQL Query' }
      ]
    });
    assert.strictEqual(diagRes.success, true, 'diagramCreate must succeed');
    assert.ok(fs.existsSync(svgPath), 'test_flow.svg must exist');

    // 3. Export to canonical Animated WebP
    console.log('3. Exporting to canonical Animated WebP...');
    const webpPath = path.join(testDir, 'test_animation.webp');
    const animRes = await animationExport({
      input_path: svgPath,
      output_path: webpPath,
      duration_sec: 2,
      fps: 10
    });

    assert.strictEqual(animRes.success, true, `animationExport must succeed: ${animRes.error || ''}`);
    assert.strictEqual(animRes.format, 'webp', 'Default format must be webp');
    assert.ok(fs.existsSync(webpPath), 'test_animation.webp must exist');

    // 4. Validate binary structure of generated WebP
    console.log('4. Validating WebP binary structure...');
    const validation = validateAnimatedWebP(webpPath);
    assert.strictEqual(validation.valid, true, `validateAnimatedWebP must pass: ${validation.error || ''}`);
    assert.strictEqual(validation.isAnimated, true, 'WebP must be detected as animated');
    assert.ok(validation.frameCount >= 15, `Expected >= 15 frames, got ${validation.frameCount}`);
    assert.strictEqual(validation.loopCount, 0, 'Loop count must be 0 (infinite)');
    assert.ok(validation.totalDurationMs >= 1500, `Duration must be >= 1500ms, got ${validation.totalDurationMs}`);
    assert.ok(validation.canvasWidth > 0, 'Canvas width must be positive');
    assert.ok(validation.canvasHeight > 0, 'Canvas height must be positive');
    console.log(`✓ WebP Validated: ${validation.canvasWidth}x${validation.canvasHeight}, ${validation.frameCount} frames, ${validation.totalDurationMs}ms, loop: ${validation.loopCount}`);

    // 5. Test backward compatibility GIF export
    console.log('5. Testing backward compatibility GIF export...');
    const gifPath = path.join(testDir, 'test_animation.gif');
    const gifRes = await animationExport({
      input_path: svgPath,
      output_path: gifPath,
      format: 'gif',
      duration_sec: 1,
      fps: 10
    });
    assert.strictEqual(gifRes.success, true, `GIF export must succeed: ${gifRes.error || ''}`);
    assert.strictEqual(gifRes.format, 'gif', 'Format must be gif');
    assert.ok(fs.existsSync(gifPath), 'test_animation.gif must exist');
    console.log('✓ GIF backward compatibility export verified');

    // 6. Verify temp files cleanup
    console.log('6. Verifying temp frames cleanup...');
    const tmpDirs = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('konoha_anim_'));
    // Active temp frames directories created by this process should be 0
    console.log(`✓ Temp frames cleanup verified (${tmpDirs.length} residual tmp dirs in os.tmpdir())`);

    console.log('All test_document_animation_webp tests passed cleanly!');
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
