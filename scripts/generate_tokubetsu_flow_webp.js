#!/usr/bin/env node
'use strict';

/**
 * scripts/generate_tokubetsu_flow_webp.js
 * Generates the 6 canonical animated workflow diagrams embedded in the README and documentation
 * using the Tokubetsu-Jonin Light Design Standard:
 *   - Pure light canvas (#FFFFFF to #FAFBFD), slate dot matrix, subtle brand glow.
 *   - Base Theme 01 4-color gradient accents: Azure (#3B82F6), Teal (#14B8A6), Violet (#8B5CF6), Amber (#F97316).
 *   - White card nodes (#FFFFFF) with elevation shadows, colored accent top bars, and bold slate typography (#0F172A).
 *   - Animated marching dashed lines, flowing ambient tracks, and traveling pulse particles.
 *   - High-fidelity Playwright Chromium capture (deviceScaleFactor: 2) + FFmpeg libwebp_anim (-q:v 90).
 *   - Pure Node.js binary structural validation via validateAnimatedWebP.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const playwright = require('playwright');
const { validateAnimatedWebP } = require('../src/workflow/tokubetsu-scribe/document_engine');

const {
  generateOrchestrationHtml,
  generateJoninHtml,
  generateKageHtml,
  generateQaHtml,
  generateTelegramHtml,
  generateAkatsukiHtml
} = require('./lib/tokubetsu_flow_templates');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const UPDATE_FRAME_SCRIPT = `
  window.updateFrame = function (frameIdx, total) {
    const progress = frameIdx / total;
    const paths = document.querySelectorAll('.flow-path');
    paths.forEach((p) => {
      p.style.strokeDashoffset = -progress * 48;
    });

    const gauge = document.querySelector('.gauge-arc');
    if (gauge) {
      const sweep = 390;
      const currentOffset = 520 - (progress * sweep);
      gauge.style.strokeDashoffset = currentOffset;
    }

    const bars = document.querySelectorAll('.bar-fill');
    bars.forEach((b) => {
      const fullW = 470;
      b.setAttribute('width', Math.max(10, fullW * Math.min(1, progress * 1.15)));
    });

    const stamp = document.querySelector('.verdict-stamp');
    if (stamp) {
      const stampAlpha = progress > 0.4 ? Math.min(1, (progress - 0.4) * 2.5) : 0;
      stamp.style.opacity = stampAlpha;
    }
  };
`;

async function setupPageAnimatedHooks(page) {
  await page.evaluate(UPDATE_FRAME_SCRIPT);
}

async function captureFrames(page, totalFrames, tmpFramesDir) {
  for (let f = 0; f < totalFrames; f++) {
    await page.evaluate(({ f, totalFrames }) => {
      window.updateFrame(f, totalFrames);
    }, { f, totalFrames });

    const framePath = path.join(tmpFramesDir, `frame_${String(f).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
  }
}

function compileWebPWithFfmpeg(tmpFramesDir, fps, outputPath) {
  console.log('Compiling frames with FFmpeg libwebp_anim at High Quality (-q:v 90)...');
  const ffmpegArgs = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
    '-vcodec', 'libwebp_anim',
    '-lossless', '0',
    '-compression_level', '6',
    '-q:v', '90',
    '-preset', 'drawing',
    '-loop', '0',
    outputPath
  ];

  const res = spawnSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    throw new Error(`FFmpeg failed: ${res.stderr ? res.stderr.toString() : 'unknown'}`);
  }
}

async function renderAndExportWebP(htmlContent, outputPath, options = {}) {
  const { width = 1200, height = 760, totalFrames = 24, fps = 12 } = options;
  console.log(`\nRendering ${path.basename(outputPath)} (${width}x${height}, ${totalFrames} frames @ ${fps} fps)...`);
  const tmpFramesDir = fs.mkdtempSync(path.join(os.tmpdir(), `tokubetsu_flow_${Date.now()}_`));

  const browser = await playwright.chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    await setupPageAnimatedHooks(page);
    await captureFrames(page, totalFrames, tmpFramesDir);
  } finally {
    await browser.close();
  }

  compileWebPWithFfmpeg(tmpFramesDir, fps, outputPath);
  try { fs.rmSync(tmpFramesDir, { recursive: true, force: true }); } catch (_) { /* non-fatal */ }

  const validation = validateAnimatedWebP(outputPath);
  if (!validation.valid) {
    throw new Error(`Validation failed for ${outputPath}: ${validation.error}`);
  }

  const stat = fs.statSync(outputPath);
  console.log(`✓ Generated ${path.basename(outputPath)} (${validation.canvasWidth}x${validation.canvasHeight}, ${validation.frameCount} frames, ${(stat.size / 1024).toFixed(1)} KB)`);
  return { success: true, path: outputPath, sizeKb: (stat.size / 1024).toFixed(1) };
}

async function main() {
  console.log('================================================================');
  console.log('TOKUBETSU-JONIN ANIMATED WEBP GENERATOR (PURE LIGHT MODE STANDARD)');
  console.log('================================================================');

  const targets = [
    { name: 'konoha-orchestration-flow.webp', html: generateOrchestrationHtml(), w: 1200, h: 675, frames: 24, fps: 12 },
    { name: 'konoha-jonin-flow.webp', html: generateJoninHtml(), w: 1200, h: 760, frames: 24, fps: 12 },
    { name: 'konoha-kage-gate.webp', html: generateKageHtml(), w: 1200, h: 760, frames: 24, fps: 12 },
    { name: 'konoha-qa-flow.webp', html: generateQaHtml(), w: 1200, h: 760, frames: 24, fps: 12 },
    { name: 'konoha-telegram-flow.webp', html: generateTelegramHtml(), w: 1200, h: 760, frames: 24, fps: 12 },
    { name: 'konoha-akatsuki-flow.webp', html: generateAkatsukiHtml(), w: 1200, h: 760, frames: 24, fps: 12 }
  ];

  for (const t of targets) {
    const outPath = path.join(ASSETS_DIR, t.name);
    await renderAndExportWebP(t.html, outPath, { width: t.w, height: t.h, totalFrames: t.frames, fps: t.fps });
  }

  console.log('\n================================================================');
  console.log('✓ All 6 Tokubetsu-Jonin Animated Flow Diagrams Generated Cleanly!');
  console.log('================================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  renderAndExportWebP,
  generateOrchestrationHtml,
  generateJoninHtml,
  generateKageHtml,
  generateQaHtml,
  generateTelegramHtml,
  generateAkatsukiHtml
};
