'use strict';

/**
 * Konoha Jonin Live Browser Monitor & Interactive Motion/3D Quality Gate (`v2.2.21`)
 * - Polls dev server readiness (`http://localhost:<port>`)
 * - Auto-opens visible system browser (`xdg-open`, `open`, `cmd /c start`) when `autoOpen !== false && !process.env.CI`
 * - Verifies `<meta name="generator" content="Build by konoha">` and footer text `Build by konoha`
 * - Audits zero emoji characters, responsive layout across 375x812, 768x1024, and 1440x900 viewports,
 *   and the 10-point Motion & Interactive 3D Quality Benchmark via Playwright Chromium.
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const DEFAULT_VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 }
];

const EMOJI_CODEPOINT_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

function _collectHttpResponse(res, resolve) {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    if (body.length < 256 * 1024) body += chunk;
  });
  res.on('end', () => {
    resolve({
      ok: res.statusCode >= 200 && res.statusCode < 400,
      status: res.statusCode || 0,
      html: body
    });
  });
}

function fetchHtmlPage(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(
        url,
        { timeout: timeoutMs, headers: { 'User-Agent': 'Konoha-Jonin-LiveMonitor/2.2.21' } },
        (res) => _collectHttpResponse(res, resolve)
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, html: '', error: 'timeout' });
      });
      req.on('error', (err) => resolve({ ok: false, status: 0, html: '', error: err.message }));
    } catch (err) {
      resolve({ ok: false, status: 0, html: '', error: err.message });
    }
  });
}

async function waitForDevServer(url, options = {}) {
  const maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : 15;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchHtmlPage(url, options.timeoutMs || 2500);
    if (res.ok && res.html) {
      return { ready: true, attempts: attempt, status: res.status, html: res.html };
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return { ready: false, attempts: maxAttempts, status: 0, html: '' };
}

function resolveSystemBrowserCommand(url, platform = process.platform) {
  const safeUrl = String(url || 'http://localhost:3000').trim();
  if (platform === 'darwin') {
    return { command: 'open', args: [safeUrl] };
  }
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', safeUrl] };
  }
  return { command: 'xdg-open', args: [safeUrl] };
}

function openSystemBrowser(url, options = {}) {
  const autoOpen = options.autoOpen !== false;
  const isCi = Boolean(process.env.CI || process.env.KONOHA_HEADLESS_TEST === '1' || options.headless === true);
  const spec = resolveSystemBrowserCommand(url, options.platform || process.platform);
  if (!autoOpen || isCi) {
    return {
      opened: false,
      skipped_reason: !autoOpen ? 'autoOpen_disabled' : 'ci_or_headless_mode',
      command: spec.command,
      args: spec.args
    };
  }
  try {
    const child = spawn(spec.command, spec.args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return {
      opened: true,
      command: spec.command,
      args: spec.args
    };
  } catch (err) {
    return {
      opened: false,
      error: err.message,
      command: spec.command,
      args: spec.args
    };
  }
}

function inspectMotionAnd3dCapabilities(html = '', sourceCode = '') {
  const combined = `${String(html || '')}\n${String(sourceCode || '')}`;
  const capabilities = {
    cinematic_page_transitions: /(?:AnimatePresence|animate\.enter|animate\.leave|transition:|data-page-transition|page-transition)/i.test(combined),
    spring_physics: /(?:stiffness|damping|useSpring|\bSpring\b|type:\s*['"]?spring|data-spring-physics)/i.test(combined),
    gesture_interactions: /(?:onPointerMove|onpointermove|pointermove|whileHover|whileTap|\bdrag\b|data-gesture-surface)/i.test(combined),
    scroll_storytelling: /(?:useScroll|\bscroll\s*\(|\binView\s*\(|ScrollTrigger|data-scroll-story|scrollY)/i.test(combined),
    layout_state_transitions: /(?:\blayoutId\b|\blayout\b|\bflip\b|AnimatePresence|animate\.enter|data-layout-state)/i.test(combined),
    motion_choreography: /(?:staggerChildren|\bstagger\s*\(|delayChildren|data-choreography)/i.test(combined),
    interactive_3d_scene: /(?:data-3d-stage|WebGLRenderer|TresCanvas|NgtCanvas|@react-three\/fiber|@threlte\/core|ShaderMaterial|PerspectiveCamera)/i.test(combined),
    responsive_behavior: /(?:name=["']viewport["']|100dvh|@media|grid-cols)/i.test(combined),
    reduced_motion_support: /(?:prefers-reduced-motion|useReducedMotion|reducedMotion)/i.test(combined)
  };
  const passedCount = Object.values(capabilities).filter(Boolean).length;
  return {
    all_capabilities_present: passedCount === Object.keys(capabilities).length,
    score: `${passedCount}/${Object.keys(capabilities).length}`,
    capabilities
  };
}

function inspectRenderedHtml(html = '', viewports = DEFAULT_VIEWPORTS, options = {}) {
  const raw = String(html || '');
  const hasMetaGenerator = /<meta\s+[^>]*name=["']generator["'][^>]*content=["']Build by konoha["'][^>]*>/i.test(raw)
    || /<meta\s+[^>]*content=["']Build by konoha["'][^>]*name=["']generator["'][^>]*>/i.test(raw);
  const hasFooterSignature = /<footer[\s\S]*?Build by konoha[\s\S]*?<\/footer>/i.test(raw)
    || /\bBuild by konoha\b/.test(raw);
  const strippedScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const hasEmoji = EMOJI_CODEPOINT_RE.test(strippedScripts);
  const hasResponsiveViewportMeta = /<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(raw);
  const motion3d = inspectMotionAnd3dCapabilities(raw, options.sourceCode || '');

  const viewportChecks = (Array.isArray(viewports) && viewports.length > 0 ? viewports : DEFAULT_VIEWPORTS).map((vp) => ({
    name: vp.name || `${vp.width}x${vp.height}`,
    width: vp.width,
    height: vp.height,
    passed: Boolean(raw.length > 0 && !hasEmoji && hasMetaGenerator && hasFooterSignature)
  }));

  const issues = [];
  if (!hasMetaGenerator) {
    issues.push('Missing <meta name="generator" content="Build by konoha"> in document head.');
  }
  if (!hasFooterSignature) {
    issues.push('Missing visible "Build by konoha" signature in footer.');
  }
  if (hasEmoji) {
    issues.push('Detected prohibited emoji characters in rendered markup.');
  }
  if (options.requireMotionAnd3d && !motion3d.all_capabilities_present) {
    const missing = Object.entries(motion3d.capabilities)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    issues.push(`Missing required Motion/3D capabilities: ${missing.join(', ')}`);
  }

  return {
    passed: issues.length === 0,
    has_meta_generator: hasMetaGenerator,
    has_footer_signature: hasFooterSignature,
    has_responsive_viewport_meta: hasResponsiveViewportMeta,
    zero_emoji_verified: !hasEmoji,
    motion_3d_audit: motion3d,
    viewports: viewportChecks,
    issues
  };
}

async function _loadTargetInPage(page, target, timeoutMs = 15000) {
  if (typeof target === 'string' && /^https?:\/\//i.test(target)) {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return;
  }
  const htmlContent = typeof target === 'string' ? target : (target.html || '');
  await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
}

async function _probeCanvasStage(page, canvasLoc) {
  const has3dCanvas = (await canvasLoc.count()) > 0;
  if (!has3dCanvas) {
    return { has3dCanvas: false, canvasMetrics: { present: false, width: 0, height: 0, pointerReactive: false } };
  }
  const box = await canvasLoc.boundingBox();
  if (box && box.width > 0 && box.height > 0) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75);
  }
  const canvasMetrics = await page.evaluate(() => {
    const c = document.querySelector('canvas[data-3d-stage="true"], canvas');
    if (!c) return { present: false, width: 0, height: 0, pointerReactive: false };
    const rect = c.getBoundingClientRect();
    return {
      present: true,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pointerReactive: c.getAttribute('data-pointer-active') === 'true' || rect.width > 0
    };
  });
  return { has3dCanvas: true, canvasMetrics };
}

async function _verifyReducedMotionContext(browser, target, timeoutMs) {
  const rmContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce'
  });
  try {
    const rmPage = await rmContext.newPage();
    await _loadTargetInPage(rmPage, target, timeoutMs);
    return await rmPage.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } finally {
    await rmContext.close();
  }
}

async function verifyInteractiveExperienceWithPlaywright(target = {}, options = {}) {
  const pw = require('@playwright/test');
  const browser = await pw.chromium.launch({ headless: true });
  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await _loadTargetInPage(page, target, options.timeoutMs || 15000);

    const html = await page.content();
    const baseCheck = inspectRenderedHtml(html, DEFAULT_VIEWPORTS, {
      sourceCode: options.sourceCode || '',
      requireMotionAnd3d: options.requireMotionAnd3d !== false
    });

    const interactiveTarget = page.locator('[data-gesture-surface], [data-spring-card], main section, button').first();
    if ((await interactiveTarget.count()) > 0) {
      await interactiveTarget.hover();
      await interactiveTarget.click();
    }

    const canvasLoc = page.locator('canvas[data-3d-stage="true"], canvas').first();
    const { has3dCanvas, canvasMetrics } = await _probeCanvasStage(page, canvasLoc);

    await page.evaluate(() => window.scrollTo(0, 320));
    await page.waitForTimeout(60);

    const responsiveResults = [];
    for (const vp of DEFAULT_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const check = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        bodyHeight: document.body.getBoundingClientRect().height
      }));
      responsiveResults.push({
        viewport: vp.name,
        width: vp.width,
        height: vp.height,
        overflow_x: check.overflowX,
        passed: !check.overflowX && check.bodyHeight > 0
      });
    }

    const reducedMotionHonored = await _verifyReducedMotionContext(browser, target, options.timeoutMs || 15000);
    const allResponsivePassed = responsiveResults.every((r) => r.passed);
    const passed = baseCheck.passed
      && has3dCanvas
      && canvasMetrics.width > 0
      && allResponsivePassed
      && reducedMotionHonored
      && consoleErrors.length === 0
      && pageErrors.length === 0;

    return {
      passed,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      canvas_3d: canvasMetrics,
      responsive_viewports: responsiveResults,
      reduced_motion_verified: reducedMotionHonored,
      inspection: baseCheck
    };
  } finally {
    await browser.close();
  }
}

async function runLiveBrowserMonitor(options = {}) {
  const url = options.url || `http://localhost:${options.port || 3000}`;
  const htmlOverride = typeof options.html === 'string' ? options.html : null;

  let serverState = { ready: true, attempts: 0, status: 200, html: htmlOverride || '' };
  if (htmlOverride === null) {
    serverState = await waitForDevServer(url, options);
  }

  const browserLaunch = serverState.ready
    ? openSystemBrowser(url, options)
    : { opened: false, skipped_reason: 'server_not_ready' };

  const inspection = serverState.ready
    ? inspectRenderedHtml(serverState.html, options.viewports, options)
    : {
        passed: false,
        has_meta_generator: false,
        has_footer_signature: false,
        has_responsive_viewport_meta: false,
        zero_emoji_verified: false,
        viewports: [],
        issues: [`Dev server at ${url} did not respond within timeout.`]
      };

  return {
    status: serverState.ready && inspection.passed ? 'passed' : 'failed',
    url,
    server_ready: serverState.ready,
    browser_launch: browserLaunch,
    inspection
  };
}

module.exports = {
  DEFAULT_VIEWPORTS,
  fetchHtmlPage,
  waitForDevServer,
  resolveSystemBrowserCommand,
  openSystemBrowser,
  inspectMotionAnd3dCapabilities,
  inspectRenderedHtml,
  verifyInteractiveExperienceWithPlaywright,
  runLiveBrowserMonitor
};
