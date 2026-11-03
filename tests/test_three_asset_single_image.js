#!/usr/bin/env node
'use strict';

/**
 * tests/test_three_asset_single_image.js
 * Validates single image -> 3D conversion across PNG, JPG, WEBP, and SVG.
 * All fixtures generated dynamically at runtime in /tmp/ (zero committed binaries).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { generate3DAsset } = require('../src/mcp/three_asset/index');

console.log('Running test_three_asset_single_image.js...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-img-'));

function createTestPngBuffer(w = 16, h = 16) {
  const rawRow = Buffer.alloc(1 + w * 4);
  rawRow[0] = 0; // Filter None
  for (let i = 1; i <= w * 4; i += 4) {
    rawRow[i] = 79;
    rawRow[i + 1] = 70;
    rawRow[i + 2] = 229;
    rawRow[i + 3] = 255;
  }
  const rows = [];
  for (let r = 0; r < h; r++) rows.push(rawRow);
  const rawData = Buffer.concat(rows);
  const idatData = zlib.deflateSync(rawData);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    return Buffer.concat([len, t, data, Buffer.alloc(4)]);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const testSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" rx="10" fill="#3b82f6" />
  <circle cx="50" cy="50" r="25" fill="#facc15" />
</svg>`;

async function run() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  // Generate JPG and WEBP base64 data URLs using Chromium canvas
  const rasterDataUrls = await page.evaluate(async (svgStr) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 64, 64);
        ctx.drawImage(img, 0, 0, 64, 64);
        resolve({
          jpeg: canvas.toDataURL('image/jpeg', 0.9),
          webp: canvas.toDataURL('image/webp', 0.9)
        });
      };
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
    });
  }, testSvg);

  await browser.close();

  const pngBuf = createTestPngBuffer(16, 16);
  const pngDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(testSvg)}`;

  const testCases = [
    { format: 'svg', ext: '.svg', data: svgDataUrl, expectedSource: 'svg_extrusion' },
    { format: 'png', ext: '.png', data: pngDataUrl, expectedSource: 'image_relief' },
    { format: 'jpeg', ext: '.jpg', data: rasterDataUrls.jpeg, expectedSource: 'image_relief' },
    { format: 'webp', ext: '.webp', data: rasterDataUrls.webp, expectedSource: 'image_relief' }
  ];

  const generatedGlbs = new Set();

  for (const tc of testCases) {
    console.log(`Testing single-image conversion: ${tc.format.toUpperCase()} (${tc.ext})...`);
    const res = await generate3DAsset({
      name: `SingleImg_${tc.format}_${Date.now()}`,
      image: {
        name: `test_artwork${tc.ext}`,
        ext: tc.ext,
        data: tc.data
      },
      out_dir: tmpDir,
      use_vision: false
    });

    assert.strictEqual(res.success, true, `Conversion for ${tc.format} must succeed`);
    assert.strictEqual(res.source, tc.expectedSource, `Source must be ${tc.expectedSource}, got ${res.source}`);
    assert.ok(res.glb_path && fs.existsSync(res.glb_path), 'GLB file must exist on disk');

    // Validate binary glTF 2.0 header
    const buf = fs.readFileSync(res.glb_path);
    assert.ok(buf.length > 1000, `GLB file size ${buf.length} must be > 1000 bytes`);
    assert.strictEqual(buf.toString('utf8', 0, 4), 'glTF', 'Magic header must be glTF');
    assert.strictEqual(buf.readUInt32LE(4), 2, 'glTF binary version must be 2');

    generatedGlbs.add(res.glb_path);
    console.log(`  ✓ ${tc.format.toUpperCase()} -> ${res.source} (${res.triangles} tris, ${res.bytes} bytes)`);
  }

  assert.strictEqual(generatedGlbs.size, 4, 'All 4 image conversions must produce distinct unique filenames');
  console.log('\n✓ test_three_asset_single_image.js passed cleanly across all 4 formats!');
}

run()
  .catch(err => {
    console.error('\n✗ Single image test failed:', err);
    process.exit(1);
  })
  .finally(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });
