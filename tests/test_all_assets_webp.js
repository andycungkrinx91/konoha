#!/usr/bin/env node
'use strict';

/**
 * tests/test_all_assets_webp.js
 *
 * Verifies that:
 * 1. All 17 canonical animation assets in `assets/` exist in native Animated WebP (.webp) format.
 * 2. Zero legacy .gif files remain in `assets/`.
 * 3. Every .webp file passes `validateAnimatedWebP` binary structural verification.
 * 4. Active Markdown files (README.md, docs) contain ZERO broken .gif image embeds.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateAnimatedWebP } = require('../src/tools/document_engine');

console.log('Running test_all_assets_webp.js...\n');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

// 1. Expected 17 canonical animation assets
const EXPECTED_WEBP_ASSETS = [
  'demo-agy.webp',
  'demo-claude.webp',
  'demo-codex.webp',
  'demo-commandcode.webp',
  'demo-cursor.webp',
  'demo-opencode.webp',
  'demo-pi.webp',
  'demo-skill-embed.webp',
  'demo-skills.webp',
  'demo-web.webp',
  'demo.webp',
  'konoha-jonin-flow.webp',
  'konoha-kage-gate.webp',
  'konoha-orchestration-flow.webp',
  'konoha-qa-flow.webp',
  'konoha-telegram-flow.webp',
  'testing.webp'
];

console.log('1. Checking that all 17 Animated WebP assets exist and legacy GIFs are removed...');
const actualGifs = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.gif'));
assert.strictEqual(actualGifs.length, 0, `Expected 0 .gif files in assets/, found: ${actualGifs.join(', ')}`);
console.log('  ✓ 0 legacy .gif files found in assets/');

for (const webpName of EXPECTED_WEBP_ASSETS) {
  const filePath = path.join(ASSETS_DIR, webpName);
  assert.ok(fs.existsSync(filePath), `Expected asset does not exist: assets/${webpName}`);
}
console.log(`  ✓ All ${EXPECTED_WEBP_ASSETS.length} expected .webp assets exist in assets/`);

// 2. Binary structural verification of every WebP asset
console.log('\n2. Verifying pure Node.js binary structure via validateAnimatedWebP...');
for (const webpName of EXPECTED_WEBP_ASSETS) {
  const filePath = path.join(ASSETS_DIR, webpName);
  const val = validateAnimatedWebP(filePath);

  assert.strictEqual(val.valid, true, `Asset ${webpName} must be a valid WebP bitstream`);
  assert.strictEqual(val.isAnimated, true, `Asset ${webpName} must have the animation flag set`);
  assert.ok(val.frameCount > 0, `Asset ${webpName} must have at least 1 frame, found ${val.frameCount}`);
  assert.ok(val.canvasWidth > 0 && val.canvasHeight > 0, `Asset ${webpName} must have non-zero dimensions`);
  assert.strictEqual(val.loopCount, 0, `Asset ${webpName} must loop infinitely (loopCount 0)`);
  console.log(`  ✓ assets/${webpName} (${val.canvasWidth}x${val.canvasHeight}, ${val.frameCount} frames, ${val.totalDurationMs}ms, loop: ${val.loopCount})`);
}

// 3. Scan active Markdown files for broken .gif embeds
console.log('\n3. Scanning active Markdown files for broken .gif image embeds...');

function walkMarkdown(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'SecurityCompliance') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      files = files.concat(walkMarkdown(full));
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const mdFiles = [path.join(ROOT_DIR, 'README.md')].concat(walkMarkdown(path.join(ROOT_DIR, 'docs')));
const brokenEmbeds = [];

for (const f of mdFiles) {
  const relPath = path.relative(ROOT_DIR, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    // Check for image tags embedding assets/*.gif
    if (/(?:<img[^>]+src=["'][^"']*assets\/[^"']+\.gif|<summary>[^<]*\.gif<\/code>|!\[[^\]]*\]\([^)]*assets\/[^)]+\.gif\))/i.test(line)) {
      brokenEmbeds.push({ file: relPath, line: idx + 1, text: line.trim() });
    }
  });
}

assert.strictEqual(
  brokenEmbeds.length,
  0,
  `Found broken .gif embeds in active markdown files:\n${brokenEmbeds.map(b => `  ${b.file}:${b.line} -> ${b.text}`).join('\n')}`
);
console.log(`  ✓ Verified ${mdFiles.length} active markdown files with ZERO broken .gif embeds!`);

console.log('\n====================================================');
console.log('✓ All 17 Animated WebP assets and Markdown embeds verified cleanly!');
console.log('====================================================');
