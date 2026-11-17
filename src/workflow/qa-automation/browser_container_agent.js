'use strict';

/**
 * src/workflow/qa-automation/browser_container_agent.js — Persistent Playwright
 * Chromium controller executed inside the isolated Docker browser workspace.
 * Keeps a headed browser alive on DISPLAY=:99 across multiple agent commands
 * via a container-local UNIX domain socket (no unauthenticated TCP CDP port).
 */

const fs = require('fs');
const net = require('net');
const path = require('path');

const SOCKET_PATH = process.env.KONOHA_BROWSER_SOCKET || '/tmp/konoha-browser-agent.sock';
const ARTIFACTS_DIR = process.env.KONOHA_BROWSER_ARTIFACTS || '/tmp/konoha-artifacts';
const BUILD_ID = process.env.KONOHA_BROWSER_BUILD_ID || '';
const SESSION_ID = process.env.KONOHA_BROWSER_SESSION_ID || 'local';

function getHeadedLaunchArgs() {
  return [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist'
  ];
}

function parseCliArgs(argv) {
  const out = { serve: false, cmd: null, profileDir: '/tmp/pw-profile-default' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--serve') out.serve = true;
    else if (argv[i] === '--cmd' && argv[i + 1]) out.cmd = argv[++i];
    else if (argv[i] === '--profile-dir' && argv[i + 1]) out.profileDir = argv[++i];
  }
  return out;
}

async function _resolveLocator(page, target) {
  if (typeof target === 'string') return page.locator(target);
  if (target && target.role) {
    return page.getByRole(target.role, target.name ? { name: target.name, exact: Boolean(target.exact) } : undefined);
  }
  if (target && target.label) return page.getByLabel(target.label, { exact: Boolean(target.exact) });
  if (target && target.text) return page.getByText(target.text, { exact: Boolean(target.exact) });
  if (target && target.testid) return page.getByTestId(target.testid);
  return page.locator(String(target?.selector || 'body'));
}

async function _handleInspect(page, state, cmd) {
  const viewports = Array.isArray(cmd.viewports) && cmd.viewports.length > 0
    ? cmd.viewports
    : [
        { name: 'mobile', width: 375, height: 812 },
        { name: 'tablet', width: 768, height: 1024 },
        { name: 'desktop', width: 1440, height: 900 }
      ];
  const responsive = [];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const metrics = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      title: document.title
    }));
    responsive.push({ viewport: vp.name, ...vp, ...metrics, passed: !metrics.overflowX });
  }
  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { supported: false, renderer: null };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      supported: true,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    };
  });
  return {
    ok: true,
    session_id: SESSION_ID,
    build_id: state.buildId,
    url: page.url(),
    title: await page.title(),
    responsive,
    webgl,
    console_errors: state.consoleErrors.slice(-20),
    page_errors: state.pageErrors.slice(-20)
  };
}

async function executeCommand(page, state, cmd) {
  const op = String(cmd?.action || cmd?.op || 'status').toLowerCase();
  if (op === 'ping' || op === 'status') {
    return {
      ok: true,
      session_id: SESSION_ID,
      build_id: cmd.build_id || state.buildId,
      url: page.url(),
      title: await page.title(),
      console_errors: state.consoleErrors.length,
      page_errors: state.pageErrors.length,
      timestamp: new Date().toISOString()
    };
  }
  if (op === 'navigate' || op === 'goto' || op === 'open') {
    if (!cmd.url) throw new Error('url is required for navigate');
    if (cmd.build_id) state.buildId = String(cmd.build_id);
    await page.goto(String(cmd.url), { waitUntil: cmd.waitUntil || 'domcontentloaded', timeout: cmd.timeoutMs || 20000 });
    return { ok: true, action: 'navigate', url: page.url(), title: await page.title(), build_id: state.buildId };
  }
  if (op === 'click') {
    const loc = await _resolveLocator(page, cmd.target || cmd.selector);
    await loc.first().click({ timeout: cmd.timeoutMs || 10000 });
    return { ok: true, action: 'click', url: page.url() };
  }
  if (op === 'fill') {
    const loc = await _resolveLocator(page, cmd.target || cmd.selector);
    await loc.first().fill(String(cmd.value ?? ''), { timeout: cmd.timeoutMs || 10000 });
    return { ok: true, action: 'fill', url: page.url() };
  }
  if (op === 'hover') {
    const loc = await _resolveLocator(page, cmd.target || cmd.selector);
    await loc.first().hover({ timeout: cmd.timeoutMs || 10000 });
    return { ok: true, action: 'hover', url: page.url() };
  }
  if (op === 'press') {
    await page.keyboard.press(String(cmd.key || 'Enter'));
    return { ok: true, action: 'press', key: String(cmd.key || 'Enter') };
  }
  if (op === 'viewport') {
    await page.setViewportSize({ width: Number(cmd.width) || 1440, height: Number(cmd.height) || 900 });
    return { ok: true, action: 'viewport', width: Number(cmd.width) || 1440, height: Number(cmd.height) || 900 };
  }
  if (op === 'snapshot') {
    const scope = String(cmd.scope || 'main, [role="main"], body');
    const loc = page.locator(scope).first();
    const target = (await loc.count()) > 0 ? loc : page.locator('body');
    const yaml = await target.ariaSnapshot();
    return { ok: true, action: 'snapshot', url: page.url(), build_id: state.buildId, snapshot: String(yaml || '').slice(0, 3800) };
  }
  if (op === 'screenshot') {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const filePath = path.join(ARTIFACTS_DIR, `shot-${Date.now()}.jpg`);
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 60, fullPage: Boolean(cmd.fullPage) });
    return { ok: true, action: 'screenshot', path: filePath, build_id: state.buildId, url: page.url() };
  }
  if (op === 'inspect') {
    return _handleInspect(page, state, cmd);
  }
  if (op === 'reload') {
    if (cmd.build_id) state.buildId = String(cmd.build_id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    return { ok: true, action: 'reload', url: page.url(), build_id: state.buildId };
  }
  if (op === 'close') {
    state.closing = true;
    return { ok: true, action: 'close' };
  }
  throw new Error(`Unsupported browser agent action: ${op}`);
}

async function _dispatchSocketLine({ page, state, server, context, line, sock }) {
  try {
    const cmd = JSON.parse(line);
    const res = await executeCommand(page, state, cmd);
    sock.end(`${JSON.stringify(res)}\n`);
    if (state.closing) {
      server.close();
      await context.close();
      process.exit(0);
    }
  } catch (err) {
    sock.end(`${JSON.stringify({ ok: false, error: err.message })}\n`);
  }
}

async function runServer(profileDir) {
  const pw = require('playwright');
  const context = await pw.chromium.launchPersistentContext(profileDir, {
    headless: process.env.KONOHA_CONTAINER_HEADLESS === '1',
    viewport: { width: Number(process.env.SCREEN_WIDTH) || 1440, height: Number(process.env.SCREEN_HEIGHT) || 900 },
    args: getHeadedLaunchArgs()
  });
  const page = context.pages()[0] || await context.newPage();
  const state = {
    buildId: BUILD_ID,
    consoleErrors: [],
    pageErrors: [],
    closing: false
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') state.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => state.pageErrors.push(err.message));

  let cmdChain = Promise.resolve();
  const initialUrl = process.env.KONOHA_BROWSER_TARGET_URL;
  if (initialUrl) {
    cmdChain = cmdChain.then(() => page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null));
  }

  try { fs.unlinkSync(SOCKET_PATH); } catch (_) { /* ignore */ }
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      cmdChain = cmdChain.then(() => _dispatchSocketLine({ page, state, server, context, line, sock }));
    });
  });

  server.listen(SOCKET_PATH, () => {
    try { fs.chmodSync(SOCKET_PATH, 0o600); } catch (_) { /* ignore */ }
    process.stdout.write(JSON.stringify({ ready: true, session_id: SESSION_ID, socket: SOCKET_PATH }) + '\n');
  });

  const shutdown = async () => {
    try { server.close(); } catch (_) { /* ignore close error */ }
    try { await context.close(); } catch (_) { /* ignore close error */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function sendClientCommand(cmdJson) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH, () => {
      client.write(`${cmdJson}\n`);
    });
    let out = '';
    client.setEncoding('utf8');
    client.on('data', (c) => { out += c; });
    client.on('end', () => resolve(out.trim()));
    client.on('error', reject);
  });
}

if (require.main === module) {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.serve) {
    runServer(cli.profileDir).catch((err) => {
      process.stderr.write(`[browser_container_agent] ${err.message}\n`);
      process.exit(1);
    });
  } else if (cli.cmd) {
    sendClientCommand(cli.cmd)
      .then((res) => {
        process.stdout.write(`${res}\n`);
        process.exit(0);
      })
      .catch((err) => {
        process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
        process.exit(1);
      });
  } else {
    process.stderr.write('Usage: browser_container_agent.js --serve | --cmd <json>\n');
    process.exit(2);
  }
}

module.exports = { getHeadedLaunchArgs, parseCliArgs, executeCommand };
