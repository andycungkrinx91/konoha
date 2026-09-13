#!/usr/bin/env node
/**
 * Node.js port of generate_web_demo_gif.py (@napi-rs/canvas + Playwright).
 * Generates a 100% authentic animated GIF for the Konoha Web UI
 * (SvelteKit 3 RC + Svelte 5) by capturing real browser navigation
 * across the Konoha Web Dashboard on 127.0.0.1:1404.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { chromium } = require('playwright');
const { saveGif, registerFonts, canvasFont } = require('./lib/shared');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const TMP_FRAMES_DIR = '/tmp/konoha-web-frames';

// Visual dimensions
const TARGET_WIDTH = 1100;
const TARGET_HEIGHT = 680;
const HEADER_HEIGHT = 38;

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(TMP_FRAMES_DIR, { recursive: true });

function roundRect(ctx, x1, y1, x2, y2, r) {
  ctx.beginPath();
  ctx.moveTo(x1 + r, y1);
  ctx.arcTo(x2, y1, x2, y2, r);
  ctx.arcTo(x2, y2, x1, y2, r);
  ctx.arcTo(x1, y2, x1, y1, r);
  ctx.arcTo(x1, y1, x2, y1, r);
  ctx.closePath();
}

async function ensureWebServer() {
  /** Ensure Konoha Web server is active on 127.0.0.1:1404. */
  try {
    const res = await fetch('http://127.0.0.1:1404/api/v1/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 200) {
      console.log('✓ Web UI server is already active on port 1404.');
      return true;
    }
  } catch (_e) {
    /* fall through and launch */
  }

  console.log('▶ Launching Konoha Web UI on port 1404...');
  const res = spawnSync(
    'node',
    [path.join(ROOT_DIR, 'bin', 'cli.js'), 'ui', 'start', '--port', '1404', '--no-open'],
    { stdio: 'inherit', cwd: ROOT_DIR }
  );
  if (res.status !== 0) {
    throw new Error('Failed to launch Konoha Web UI server');
  }
  await new Promise((r) => setTimeout(r, 2000));
  return true;
}

/** Compose screenshot into an elegant browser window frame. */
async function compositeBrowserFrame(screenshotPath, urlDisplay, badgeText) {
  const baseImg = await loadImage(screenshotPath);

  // Calculate crop / resize for viewport
  const contentW = TARGET_WIDTH;
  const contentH = TARGET_HEIGHT - HEADER_HEIGHT;

  // Scale screenshot to fit width
  const wScale = contentW / baseImg.width;
  const scaledH = Math.round(baseImg.height * wScale);

  const content = createCanvas(contentW, contentH);
  const cctx = content.getContext('2d');
  if (scaledH > contentH) {
    // Crop top
    cctx.drawImage(baseImg, 0, 0, baseImg.width, baseImg.height, 0, 0, contentW, scaledH);
  } else {
    // Pad bottom with slate background
    cctx.fillStyle = 'rgb(248,250,252)';
    cctx.fillRect(0, 0, contentW, contentH);
    cctx.drawImage(baseImg, 0, 0, baseImg.width, baseImg.height, 0, 0, contentW, scaledH);
  }

  // Create canvas
  const canvas = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  // 1. Header bar
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.fillRect(0, 0, TARGET_WIDTH, HEADER_HEIGHT);
  ctx.strokeStyle = 'rgb(226,232,240)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT - 1.5);
  ctx.lineTo(TARGET_WIDTH, HEADER_HEIGHT - 1.5);
  ctx.stroke();

  // 2. Window Controls (traffic lights)
  const dotY = HEADER_HEIGHT >> 1;
  ctx.fillStyle = 'rgb(239,68,68)'; // Close (Red)
  ctx.beginPath();
  ctx.ellipse(19, dotY, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgb(245,158,11)'; // Minimize (Yellow)
  ctx.beginPath();
  ctx.ellipse(35, dotY, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgb(16,185,129)'; // Maximize (Green)
  ctx.beginPath();
  ctx.ellipse(51, dotY, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. URL Pill Bar
  const pillX1 = 70;
  const pillX2 = TARGET_WIDTH - 240;
  const pillY1 = 6;
  const pillY2 = HEADER_HEIGHT - 7;
  roundRect(ctx, pillX1, pillY1, pillX2, pillY2, 6);
  ctx.fillStyle = 'rgb(241,245,249)';
  ctx.fill();
  ctx.strokeStyle = 'rgb(203,213,225)';
  ctx.stroke();

  // URL Text
  ctx.font = canvasFont(11, false);
  ctx.fillStyle = 'rgb(51,65,85)';
  ctx.fillText(`🔒 ${urlDisplay}`, pillX1 + 10, pillY1 + 4);

  // 4. Badge on Far Right
  const badgeW = 200;
  const badgeX = TARGET_WIDTH - badgeW - 14;
  roundRect(ctx, badgeX, pillY1, badgeX + badgeW, pillY2, 5);
  ctx.fillStyle = 'rgb(238,242,255)';
  ctx.fill();
  ctx.strokeStyle = 'rgb(199,210,254)';
  ctx.stroke();
  ctx.font = canvasFont(10, true);
  ctx.fillStyle = 'rgb(67,56,202)';
  ctx.fillText(badgeText, badgeX + 8, pillY1 + 4);

  // 5. Paste content
  ctx.drawImage(content, 0, HEADER_HEIGHT);
  return canvas;
}

async function main() {
  console.log('==========================================================');
  console.log('   KONOHA FRONTEND WEB UI DEMO GIF GENERATOR             ');
  console.log('   SvelteKit 3 (RC) + Svelte 5 + 10 Light-Mode Themes     ');
  console.log('==========================================================');

  registerFonts();
  await ensureWebServer();

  // Set viewport + launch real browser
  console.log('▶ Launching Chromium with viewport 1280x800...');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // (url, filename, display_url, badge, duration_ms)
  const pages = [
    ['http://127.0.0.1:1404/dashboard', '01_dashboard.png', 'http://127.0.0.1:1404/dashboard • Mission Control', 'CPU · MEMORY · DISK · FEATURE METRICS', 3000],
    ['http://127.0.0.1:1404/agents', '02_agents.png', 'http://127.0.0.1:1404/agents • Ninja Subagents', '7 NINJAS • MODEL CONFIG', 2400],
    ['http://127.0.0.1:1404/bridges', '03_bridges.png', 'http://127.0.0.1:1404/bridges • LLM Bridge Gateway', 'GATEWAY :19999 • SIDECAR :1313', 2200],
    ['http://127.0.0.1:1404/skills', '04_skills.png', 'http://127.0.0.1:1404/skills • Skills Registry', '68 SKILLS • EMBED / UNEMBED', 2200],
    ['http://127.0.0.1:1404/savings', '05_savings.png', 'http://127.0.0.1:1404/savings • Token Savings Breakdown', 'TOOL-BY-TOOL METRICS', 2200],
    ['http://127.0.0.1:1404/context', '06_context.png', 'http://127.0.0.1:1404/context • Project Memory', 'PERSISTENT INVARIANTS', 2000],
    ['http://127.0.0.1:1404/persona', '07_persona.png', 'http://127.0.0.1:1404/persona • Episodic Memory', 'SQLITE FTS5 SEARCH', 2000],
    ['http://127.0.0.1:1404/search', '08_search.png', 'http://127.0.0.1:1404/search • Multi-Source Search', 'SEARXNG • ZERO-API-KEY', 2000],
    ['http://127.0.0.1:1404/doctor', '09_doctor.png', 'http://127.0.0.1:1404/doctor • Village Diagnostics', '7 CLIENTS SELF-HEALING', 2000],
    ['http://127.0.0.1:1404/tasks', '10_tasks.png', 'http://127.0.0.1:1404/tasks • SDLC Tasks & Governance', 'DOR GATES • ANTI-SLOP AUDIT', 2200],
    ['http://127.0.0.1:1404/clients', '11_clients.png', 'http://127.0.0.1:1404/clients • Client Setup', 'ANTIGRAVITY · PI · CURSOR', 2000],
    ['http://127.0.0.1:1404/detector', '12_detector.png', 'http://127.0.0.1:1404/detector • Website AI Detector', 'AI FINGERPRINTS • 0-20 HUMAN-BUILT', 3200],
    ['http://127.0.0.1:1404/docs', '13_docs.png', 'http://127.0.0.1:1404/docs • Documentation', 'ARCHITECTURE • API • CLI REFERENCE', 2400],
  ];

  const frames = [];
  for (const [url, fname, dispUrl, badge, dur] of pages) {
    const outPath = path.join(TMP_FRAMES_DIR, fname);
    console.log(`  • Capturing: ${dispUrl} ...`);

    // Navigate to URL and take a screenshot
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    if (url.endsWith('/dashboard')) {
      // Wait for the first 5s metrics poll so the Grafana panels render data.
      await page.waitForTimeout(6500);
    } else if (url.endsWith('/detector')) {
      // Run a real scan against a fixture site so the demo shows findings.
      const fixtureDir = path.join('/tmp', 'konoha-demo-ai-site');
      fs.mkdirSync(path.join(fixtureDir, 'components', 'ui'), { recursive: true });
      fs.writeFileSync(path.join(fixtureDir, 'index.html'),
        '<!doctype html><html><head><meta name="generator" content="v0.dev"><title>Create Next App</title></head>' +
        '<body><i data-lucide="palette"></i><!-- Built with v0 --><p>Get started by editing app/page.tsx</p></body></html>');
      fs.writeFileSync(path.join(fixtureDir, 'package.json'),
        JSON.stringify({ name: 'demo', dependencies: { 'lucide-react': '^1.0.0' } }, null, 2));
      await page.fill('#detect-target', fixtureDir);
      await page.click('button:has-text("Run Scan")');
      await page.waitForSelector('text=Findings', { timeout: 20000 });
      await page.waitForTimeout(800);
    } else {
      await page.waitForTimeout(1200);
    }
    await page.screenshot({ path: outPath });

    // Build composite frame
    const frameCanvas = await compositeBrowserFrame(outPath, dispUrl, badge);
    frames.push({ canvas: frameCanvas, duration: dur });
  }

  await browser.close();

  console.log(`\n▶ Compiling ${frames.length} frames into assets/demo-web.gif ...`);
  const outputGif = path.join(ASSETS_DIR, 'demo-web.gif');
  saveGif(frames, outputGif);

  const sizeKb = fs.statSync(outputGif).size / 1024;
  console.log(`✨ Successfully saved assets/demo-web.gif (${sizeKb.toFixed(1)} KB, ${frames.length} frames)!`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
