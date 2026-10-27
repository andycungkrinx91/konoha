#!/usr/bin/env node
/**
 * scripts/generate_web_demo_gif.js
 * Generates an authentic animated WebP/GIF for the Konoha Web UI
 * (SvelteKit + Svelte 5 + 10-Theme System) using pure Playwright + FFmpeg
 * by capturing real browser navigation across the Konoha Web Dashboard on 127.0.0.1:1404.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { validateAnimatedWebP } = require('../src/workflow/tokubetsu-scribe/document_engine');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const TMP_FRAMES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-web-frames-'));

const TARGET_WIDTH = 1100;
const TARGET_HEIGHT = 680;

fs.mkdirSync(ASSETS_DIR, { recursive: true });

async function ensureWebServer() {
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

function buildCompositeHtml(dataUri, urlDisplay, badgeText) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${TARGET_WIDTH}px;
    height: ${TARGET_HEIGHT}px;
    background: #081026;
    overflow: hidden;
    font-family: 'JetBrains Mono', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  }
  .browser-header {
    height: 38px;
    background: #0f1e45;
    border-bottom: 1px solid #23449b;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
  }
  .controls {
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }
  .url-pill {
    flex: 1;
    height: 24px;
    background: #081026;
    border: 1px solid #23449b;
    border-radius: 6px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    color: #94a3b8;
  }
  .badge {
    height: 22px;
    background: rgba(79, 131, 255, 0.15);
    border: 1px solid #4f83ff;
    border-radius: 5px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    font-size: 10px;
    font-weight: 700;
    color: #b18cff;
    letter-spacing: 0.5px;
  }
  .content-frame {
    width: ${TARGET_WIDTH}px;
    height: ${TARGET_HEIGHT - 38}px;
    overflow: hidden;
  }
  .content-img {
    width: ${TARGET_WIDTH}px;
    height: auto;
    display: block;
  }
</style>
</head>
<body>
  <div class="browser-header">
    <div class="controls">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
    </div>
    <div class="url-pill">🔒 ${urlDisplay}</div>
    <div class="badge">${badgeText}</div>
  </div>
  <div class="content-frame">
    <img class="content-img" src="${dataUri}" />
  </div>
</body>
</html>`;
}

async function main() {
  console.log('==========================================================');
  console.log('   KONOHA FRONTEND WEB UI DEMO ANIMATION GENERATOR        ');
  console.log('   SvelteKit + Svelte 5 + Sharingan Dark Mode / 10 Themes ');
  console.log('==========================================================');

  await ensureWebServer();

  // Reset web auth to guarantee known password
  spawnSync('node', [path.join(ROOT_DIR, 'bin', 'cli.js'), 'auth', 'reset'], { stdio: 'inherit', cwd: ROOT_DIR });

  console.log('▶ Launching Chromium with viewport 1280x800...');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const compositePage = await browser.newPage({ viewport: { width: TARGET_WIDTH, height: TARGET_HEIGHT } });

    const pages = [
      ['http://127.0.0.1:1404/', '00_login.png', 'http://127.0.0.1:1404/ • Cyberpunk Login Gateway', 'PASSPHRASE AUTH • 10-THEMES', 2800],
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
      ['http://127.0.0.1:1404/remote', '13_remote.png', 'http://127.0.0.1:1404/remote • Remote Access & Telegram Bot', 'TELEGRAM BOT · TUNNEL · PROMPT QUEUE', 3000],
      ['http://127.0.0.1:1404/docs', '14_docs.png', 'http://127.0.0.1:1404/docs • Documentation', 'ARCHITECTURE • API • CLI REFERENCE', 2400],
    ];

    const capturedFrames = [];

    for (let i = 0; i < pages.length; i++) {
      const [url, _fname, dispUrl, badge, dur] = pages[i];
      console.log(`  • Capturing [${i + 1}/${pages.length}]: ${dispUrl}...`);

      await page.goto(url, { waitUntil: 'load', timeout: 30000 });

      if (url === 'http://127.0.0.1:1404/') {
        await page.waitForSelector('#login-password', { timeout: 15000 });
        await page.waitForTimeout(600);
      } else if (url.endsWith('/dashboard')) {
        await page.waitForSelector('#konoha-app-root', { timeout: 15000 });
        await page.waitForTimeout(1500);
      } else if (url.endsWith('/detector')) {
        const fixtureDir = path.join('/tmp', 'konoha-demo-ai-site');
        fs.mkdirSync(path.join(fixtureDir, 'components', 'ui'), { recursive: true });
        const demoHtml = '<!doctype html><html><head><meta name="generator" content="v0.dev"><title>Create Next App</title></head><body><!-- Built with v0 --><p>Get started</p></body></html>';
        fs.writeFileSync(path.join(fixtureDir, 'index.html'), demoHtml);
        fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { 'lucide-react': '^1.0.0' } }, null, 2));
        await page.fill('#detect-target', fixtureDir);
        await page.click('button:has-text("Run Scan")');
        try {
          await page.waitForSelector('text=Findings', { timeout: 10000 });
        } catch (_) {
          /* ignore detection wait timeout */
        }
        await page.waitForTimeout(800);
      } else {
        await page.waitForSelector('#konoha-app-root', { timeout: 15000 });
        await page.waitForTimeout(1000);
      }

      const screenshotBuf = await page.screenshot({ type: 'png' });
      const dataUri = `data:image/png;base64,${screenshotBuf.toString('base64')}`;

      // Composite browser frame
      const compositeHtml = buildCompositeHtml(dataUri, dispUrl, badge);
      await compositePage.setContent(compositeHtml);
      const framePath = path.join(TMP_FRAMES_DIR, `frame_${String(i).padStart(4, '0')}.png`);
      await compositePage.screenshot({ path: framePath, type: 'png' });

      capturedFrames.push({ path: framePath, durationMs: dur });

      // After capturing login page, authenticate to access subsequent pages
      if (url === 'http://127.0.0.1:1404/') {
        try {
          console.log('    ⟳ Performing authentication and clearing mandatory bootstrap modal...');
          await page.fill('#login-password', 'konohagakure');
          await page.click('button:has-text("LOGIN")');

          const modalOrRoot = await Promise.race([
            page.waitForSelector('#current-password', { timeout: 15000 }).then(() => 'modal'),
            page.waitForSelector('#konoha-app-root', { timeout: 15000 }).then(() => 'root')
          ]);

          if (modalOrRoot === 'modal') {
            await page.fill('#current-password', 'konohagakure');
            await page.fill('#new-password', 'konohagakure2026!');
            await page.fill('#confirm-password', 'konohagakure2026!');
            await page.click('button:has-text("Update & Continue to Dashboard")');

            await page.waitForSelector('#login-password', { timeout: 15000 });
            await page.fill('#login-password', 'konohagakure2026!');
            await page.click('button:has-text("LOGIN")');
            await page.waitForSelector('#konoha-app-root', { timeout: 15000 });
          }
          await page.waitForTimeout(1000);
        } catch (err) {
          console.warn('    ⚠️ Note on auth flow:', err.message);
        }
      }
    }

    const outName = 'demo-web.webp';
    const outputPath = path.join(ASSETS_DIR, outName);
    console.log(`\n▶ Compiling ${capturedFrames.length} frames into assets/${outName} with FFmpeg libwebp_anim...`);

    const listFile = path.join(TMP_FRAMES_DIR, 'frames.txt');
    let listContent = '';
    for (let i = 0; i < capturedFrames.length; i++) {
      const durationSec = Math.max(0.1, capturedFrames[i].durationMs / 1000);
      listContent += `file '${capturedFrames[i].path}'\nduration ${durationSec.toFixed(3)}\n`;
    }
    if (capturedFrames.length > 0) {
      listContent += `file '${capturedFrames[capturedFrames.length - 1].path}'\n`;
    }
    fs.writeFileSync(listFile, listContent);

    const ffmpegRes = spawnSync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-vcodec', 'libwebp_anim',
      '-lossless', '0',
      '-compression_level', '6',
      '-q:v', '90',
      '-preset', 'drawing',
      '-loop', '0',
      outputPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    if (ffmpegRes.status !== 0) {
      throw new Error(`FFmpeg failed: ${ffmpegRes.stderr ? ffmpegRes.stderr.toString() : 'unknown error'}`);
    }

    validateAnimatedWebP(outputPath);
    const sizeKb = fs.statSync(outputPath).size / 1024;
    console.log(`✨ Successfully saved assets/${outName} (${sizeKb.toFixed(1)} KB, ${capturedFrames.length} frames)!`);
  } finally {
    try {
      await browser.close();
    } catch (_) {
      /* ignore browser close errors during shutdown */
    }
    try {
      fs.rmSync(TMP_FRAMES_DIR, { recursive: true, force: true });
    } catch (_) {
      /* ignore temp directory cleanup errors */
    }
    // Reset web auth back to clean bootstrap state (guaranteed cleanup)
    spawnSync('node', [path.join(ROOT_DIR, 'bin', 'cli.js'), 'auth', 'reset'], { stdio: 'inherit', cwd: ROOT_DIR });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error in generate_web_demo_gif.js:', err);
    process.exit(1);
  });
}

module.exports = { main };
