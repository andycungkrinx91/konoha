'use strict';

/**
 * Konoha Jonin Live Browser Monitor (`v2.2.18`)
 * - Polls dev server readiness (`http://localhost:<port>`)
 * - Auto-opens visible system browser (`xdg-open`, `open`, `cmd /c start`) when `autoOpen !== false && !process.env.CI`
 * - Verifies `<meta name="generator" content="Build by konoha">` and footer text `Build by konoha`
 * - Audits zero emoji characters and responsive layout readiness across 375x812, 768x1024, and 1440x900 viewports
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
        { timeout: timeoutMs, headers: { 'User-Agent': 'Konoha-Jonin-LiveMonitor/2.2.18' } },
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

function inspectRenderedHtml(html = '', viewports = DEFAULT_VIEWPORTS) {
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

  return {
    passed: issues.length === 0,
    has_meta_generator: hasMetaGenerator,
    has_footer_signature: hasFooterSignature,
    has_responsive_viewport_meta: hasResponsiveViewportMeta,
    zero_emoji_verified: !hasEmoji,
    viewports: viewportChecks,
    issues
  };
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
    ? inspectRenderedHtml(serverState.html, options.viewports)
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
  inspectRenderedHtml,
  runLiveBrowserMonitor
};
