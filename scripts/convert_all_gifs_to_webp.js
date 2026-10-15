#!/usr/bin/env node
'use strict';

/**
 * scripts/convert_all_gifs_to_webp.js
 *
 * Batch converts all 17 legacy animated GIF assets in `assets/` into canonical
 * Animated WebP (.webp) format using FFmpeg libwebp_anim.
 *
 * Validates each generated WebP file with `validateAnimatedWebP` and removes
 * the legacy GIF file upon successful verification.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateAnimatedWebP } = require('../src/tools/document_engine');

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');

console.log('====================================================');
console.log('   KONOHA ANIMATED WEBP ASSET MIGRATION ENGINE      ');
console.log('====================================================\n');

let gifFiles = fs.readdirSync(ASSETS_DIR)
  .filter(f => f.endsWith('.gif'))
  .sort();

const TERMINAL_DEMOS = [
  'demo-agy.gif',
  'demo-claude.gif',
  'demo-codex.gif',
  'demo-commandcode.gif',
  'demo-cursor.gif',
  'demo-opencode.gif',
  'demo-pi.gif',
  'demo-skill-embed.gif',
  'demo-skills.gif',
  'demo-web.gif',
  'demo.gif',
  'testing.gif'
];

let useGitSource = false;
let tmpDir = null;

if (gifFiles.length === 0) {
  console.log('No .gif files found in assets/. Pulling original terminal demos from git history (4ad23a1)...');
  const os = require('os');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gifs_'));
  gifFiles = [];

  for (const demo of TERMINAL_DEMOS) {
    const tmpGif = path.join(tmpDir, demo);
    try {
      const gitOut = spawnSync('git', ['show', `4ad23a1:assets/${demo}`], { maxBuffer: 50 * 1024 * 1024 });
      if (gitOut.status === 0 && gitOut.stdout.length > 0) {
        fs.writeFileSync(tmpGif, gitOut.stdout);
        gifFiles.push(tmpGif);
      }
    } catch (_) {}
  }
  useGitSource = true;
  console.log(`Extracted ${gifFiles.length} terminal demo GIFs from git history for high-quality re-encoding.\n`);
} else {
  // If local gifs exist, filter out flow gifs if they are meant for generate_tokubetsu_flow_webp.js
  gifFiles = gifFiles.map(f => path.join(ASSETS_DIR, f));
}

if (gifFiles.length === 0) {
  console.log('No GIF sources available to convert.');
  process.exit(0);
}

const results = [];
let totalGifBytes = 0;
let totalWebpBytes = 0;

for (const gifPath of gifFiles) {
  const gifName = path.basename(gifPath);
  const baseName = path.basename(gifName, '.gif');
  const webpName = `${baseName}.webp`;
  const webpPath = path.join(ASSETS_DIR, webpName);

  const gifSize = fs.statSync(gifPath).size;
  totalGifBytes += gifSize;

  process.stdout.write(`Converting ${gifName} -> ${webpName}... `);

  // Encode with optimal animation parameters
  const ffmpegRes = spawnSync('ffmpeg', [
    '-y',
    '-i', gifPath,
    '-vcodec', 'libwebp_anim',
    '-lossless', '0',
    '-compression_level', '6',
    '-q:v', '90',
    '-preset', 'drawing',
    '-loop', '0',
    webpPath
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (ffmpegRes.status !== 0) {
    console.error(`\nFFmpeg failed for ${gifName}:`);
    console.error(ffmpegRes.stderr.toString());
    process.exit(1);
  }

  // Validate bitstream
  const val = validateAnimatedWebP(webpPath);
  if (!val.valid || !val.isAnimated) {
    console.error(`\nValidation failed for ${webpName}:`, val);
    process.exit(1);
  }

  const webpSize = fs.statSync(webpPath).size;
  totalWebpBytes += webpSize;
  const reduction = ((1 - webpSize / gifSize) * 100).toFixed(1);

  // Remove temporary or legacy gif
  try {
    fs.unlinkSync(gifPath);
  } catch (_) {}

  results.push({
    name: baseName,
    gifKb: (gifSize / 1024).toFixed(1),
    webpKb: (webpSize / 1024).toFixed(1),
    reduction: `${reduction}%`,
    frames: val.frameCount,
    dims: `${val.canvasWidth}x${val.canvasHeight}`
  });

  console.log(`✓ (${(webpSize / 1024).toFixed(1)} KB, -${reduction}%, ${val.frameCount} frames)`);
}

if (tmpDir && fs.existsSync(tmpDir)) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}

console.log('\n====================================================');
console.log('             COMPRESSION SUMMARY TABLE              ');
console.log('====================================================');
console.log('| Asset Name | Dimensions | Frames | Legacy GIF | Animated WebP | Reduction |');
console.log('|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.name} | ${r.dims} | ${r.frames} | ${r.gifKb} KB | **${r.webpKb} KB** | **${r.reduction}** |`);
}

const overallReduction = ((1 - totalWebpBytes / totalGifBytes) * 100).toFixed(1);
console.log('====================================================');
console.log(`Total Legacy GIF Size:   ${(totalGifBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Total Animated WebP Size: ${(totalWebpBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Overall File Size Reduction: ${overallReduction}%`);
console.log(`All ${results.length} GIF files successfully converted, validated, and replaced with .webp!`);
console.log('====================================================\n');
