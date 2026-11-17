'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { fileExists, checkPortActive } = require('../../src/platform_utils');
const { SKILLS_DB_DIR, UI_PORT } = require('./paths');
const deployUtils = require('../../src/deploy_utils');
const { C, header, log, info, success, warn, error, drawLogo } = require('./format');

const {
  isSystemdAvailable,
  getServiceStatus,
  cmdUiService
} = require('./ui_service');

const { cmdUiBuild } = require('./ui_build');

function openUrlInBrowser(targetUrl) {
  if (typeof targetUrl !== 'string' || !targetUrl.trim()) return;
  let parsed;
  try {
    parsed = new URL(targetUrl.trim());
  } catch (_) {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

  const validHostnames = ['127.0.0.1', 'localhost', '::1', '[::1]'];
  const hostname = parsed.hostname.toLowerCase();
  if (!validHostnames.includes(hostname)) return;

  const safeUrl = parsed.toString();
  const p = process.platform;
  try {
    if (p === 'darwin') {
      spawn('open', [safeUrl], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    } else if (p === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', targetUrl], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    } else {
      spawn('xdg-open', [safeUrl], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    }
  } catch (_) { /* intentional fallback */ }
}

function uiPidFileForPort(port) {
  const p = parseInt(port, 10);
  return path.join(SKILLS_DB_DIR, p === UI_PORT ? 'ui.pid' : `ui-${p}.pid`);
}

function cmdUiHelp() {
  log(`
${C.cyan}konoha ui${C.reset} — Konoha Web Configuration UI management

${C.bold}USAGE${C.reset}
  konoha ui <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}start${C.reset}       Run the Web UI in the foreground; press Ctrl+C to stop
  ${C.cyan}build${C.reset}       Compile/build the production SvelteKit UI bundle in apps/web/

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--port=<n>${C.reset}   Port to bind (default: ${UI_PORT})
  ${C.cyan}--host=<h>${C.reset}   Host to bind (default: 127.0.0.1)
  ${C.cyan}--no-open${C.reset}    Do not automatically open the browser on start

${C.bold}EXAMPLES${C.reset}
  konoha ui start
  konoha ui start --port=8080 --no-open
  konoha ui build
`);
}

function parseHostPortOptions(args) {
  let port = UI_PORT;
  let host = '127.0.0.1';
  let openBrowser = true;
  let silent = false;
  let token = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    else if (a.startsWith('--port=')) port = parseInt(a.slice('--port='.length), 10);
    else if (a === '--host' && args[i + 1]) host = args[++i];
    else if (a.startsWith('--host=')) host = a.slice('--host='.length);
    else if (a === '--token' && args[i + 1]) token = args[++i];
    else if (a.startsWith('--token=')) token = a.slice('--token='.length);
    else if (a === '--no-open') openBrowser = false;
    else if (a === '--silent') silent = true;
  }
  return { port, host, openBrowser, silent, token };
}

function portInUseNotice(host, port) {
  return `Konoha Web UI is already running on http://${host}:${port}/. Press Ctrl+C in that terminal before starting another.`;
}

async function assertSingleInstance(port, host) {
  if (await checkPortActive(port)) {
    warn(portInUseNotice(host, port));
    process.exit(1);
  }
}

async function cmdUiStart(args = []) {
  const { port, host, token, openBrowser } = parseHostPortOptions(args);
  await assertSingleInstance(port, host);
  return cmdWebForeground({ port, host, openBrowser, token, openUrlInBrowser });
}

function parseTargetPort(args, defaultPort = UI_PORT) {
  let target = defaultPort;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) target = parseInt(args[++i], 10);
    else if (args[i].startsWith('--port=')) target = parseInt(args[i].slice('--port='.length), 10);
  }
  return target;
}

function terminatePidProcess(pid) {
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true }); } catch (_) { /* non-fatal */ }
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch (_) { /* non-fatal */ }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) { /* non-fatal */ }
}

function killPidFromPidFile(pidFile) {
  if (!fileExists(pidFile)) return;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      terminatePidProcess(pid);
      safeUnlink(pidFile);
    }
  } catch (_) { /* non-fatal */ }
}

function _killPidFromNetstatLine(line, stopPort) {
  if (!line.includes(`:${stopPort} `) || !line.includes('LISTENING')) return;
  const parts = line.trim().split(/\s+/);
  const pid = parts[parts.length - 1];
  if (!pid || !/^\d+$/.test(pid) || pid === '0') return;
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true }); } catch (_) { /* taskkill best-effort; listener may already be gone */ }
}

function _killWindowsPortListeners(stopPort) {
  try {
    execSync(`powershell -NoProfile -Command "$p = (Get-NetTCPConnection -LocalPort ${stopPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`, { stdio: 'ignore', windowsHide: true });
  } catch (_) { /* non-fatal */ }
  try {
    const netstat = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    for (const line of netstat.split('\n')) _killPidFromNetstatLine(line, stopPort);
  } catch (_) { /* non-fatal */ }
}

async function terminatePortListeners(stopPort) {
  for (let attempt = 0; attempt < 10 && await checkPortActive(stopPort); attempt++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!await checkPortActive(stopPort)) return;

  if (process.platform !== 'win32') {
    try { execSync(`fuser -k ${stopPort}/tcp`, { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
    return;
  }
  _killWindowsPortListeners(stopPort);
}

function stopSystemdIfActive(stopPort) {
  if (stopPort !== UI_PORT || !isSystemdAvailable()) return;
  try {
    const out = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (out === 'active') {
      execSync('systemctl --user stop konoha-ui.service', { stdio: 'ignore' });
    }
  } catch (_) { /* non-fatal */ }
}

async function cmdUiStop(args = []) {
  const stopPort = parseTargetPort(args, UI_PORT);
  header('Stopping Konoha Web Configuration UI');
  const pidFile = uiPidFileForPort(stopPort);
  stopSystemdIfActive(stopPort);
  killPidFromPidFile(pidFile);

  await terminatePortListeners(stopPort);
  if (await checkPortActive(stopPort)) {
    warn(`Port ${stopPort} is still active. There may be a foreground process running.`);
  } else {
    success('Konoha Web UI stopped successfully.');
  }
}

function setupForegroundShutdown(srv, resolve) {
  const handleShutdown = async () => {
    log(`\n${C.yellow}Shutting down Konoha Web UI...${C.reset}`);
    if (srv && srv.instance) await srv.instance.stop();
    resolve();
    process.exit(0);
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
  if (process.platform === 'win32') {
      process.on('SIGBREAK', handleShutdown);
  }
}

async function cmdWebForeground(options = {}) {
  const port = options.port || Number(process.env.PORT) || UI_PORT;
  const host = options.host || process.env.HOST || '127.0.0.1';
  const openBrowser = process.env.KONOHA_DOCKER === '1' ? false : (options.openBrowser !== false);
  const token = options.token || null;

  const buildHandler = path.join(deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', '..', 'apps', 'web'), 'build', 'handler.js');
  if (!fs.existsSync(buildHandler)) {
    info('Frontend build not found. Automatically building Konoha Web UI...');
    await cmdUiBuild();
  }

  const { startWebServer } = require('../../src/web_server');
  drawLogo();
  header('🌐 Konoha Web Configuration UI');
  info(`Starting local web server on http://${host}:${port}/ ...`);

  let srv;
  try {
    srv = await startWebServer({ port, host, token });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      warn(portInUseNotice(host, port));
    } else {
      error(`Failed to start web server: ${err.message}`);
    }
    process.exit(1);
  }

  success(`Web UI ready at: http://${host}:${port}/`);
  info(`CSRF session token active: ${srv.token}`);

  if (openBrowser && options.openUrlInBrowser) {
    options.openUrlInBrowser(`http://${host}:${port}/`);
  }

  log(`\n${C.dim}Press Ctrl+C to stop the Web UI server.${C.reset}\n`);

  await new Promise((resolve) => {
    setupForegroundShutdown(srv, resolve);
  });
}

async function cmdUi(args = []) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (args.includes('help') || args.includes('--help') || args.includes('-h') || subcommand === 'help') {
    cmdUiHelp();
    return;
  }

  switch (subcommand) {
    case 'start':
      await cmdUiStart(subArgs);
      break;
    case 'build':
      await cmdUiBuild();
      break;
    default:
      cmdUiHelp();
      break;
  }
}

module.exports = {
  cmdUi,
  cmdUiStop,
  checkPortActive,
  getServiceStatus,
  cmdUiService
};
