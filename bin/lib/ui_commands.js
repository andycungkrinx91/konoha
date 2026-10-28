'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const deployUtils = require('../../src/deploy_utils');
const { fileExists } = require('../../src/platform_utils');
const { SKILLS_DB_DIR } = require('./paths');
const { C, header, log, info, success, warn } = require('./format');

const {
  isSystemdAvailable,
  getServiceStatus,
  cmdUiService
} = require('./ui_service');

const {
  cmdUiBuild,
  cmdUiPreview,
  cmdWebForeground
} = require('./ui_build');

function openUrlInBrowser(targetUrl) {
  const p = process.platform;
  let cmd;
  if (p === 'darwin') cmd = 'open';
  else if (p === 'win32') cmd = 'start ""';
  else cmd = 'xdg-open';

  try {
    execSync(`${cmd} "${targetUrl}"`, { stdio: 'ignore', windowsHide: true });
  } catch (_) { /* intentional fallback */ }
}

function uiPidFileForPort(port) {
  return path.join(SKILLS_DB_DIR, `ui_${port}.pid`);
}

function checkPortActive(port) {
  return new Promise((resolve) => {
    const s = http.get(`http://127.0.0.1:${port}/`, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function cmdUiHelp() {
  log(`
${C.cyan}konoha ui${C.reset} — Konoha Web Configuration UI management

${C.bold}USAGE${C.reset}
  konoha ui <subcommand> [options]
  konoha web [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}start${C.reset}       Start the Web UI server as a background daemon (default)
  ${C.cyan}stop${C.reset}        Stop the running background Web UI server
  ${C.cyan}restart${C.reset}     Restart the Web UI server
  ${C.cyan}status${C.reset}      Show whether the Web UI is currently running
  ${C.cyan}service${C.reset}     Manage OS background service daemon (systemd on Linux, launchd on macOS)
  ${C.cyan}build${C.reset}       Compile/build the production SvelteKit UI bundle in apps/web/
  ${C.cyan}preview${C.reset}     Preview the production build without installing as background daemon

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--port=<n>${C.reset}   Port to bind (default: 1404)
  ${C.cyan}--host=<h>${C.reset}   Host to bind (default: 127.0.0.1)
  ${C.cyan}--no-open${C.reset}    Do not automatically open the browser on start
  ${C.cyan}--fg${C.reset}         Run in foreground instead of detached background process

${C.bold}EXAMPLES${C.reset}
  konoha ui
  konoha ui start --port=8080
  konoha ui stop
  konoha ui restart
  konoha ui service install
  konoha ui status
`);
}

function parseHostPortOptions(args) {
  let port = 1404;
  let host = '127.0.0.1';
  let openBrowser = true;
  let foreground = false;
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
    else if (a === '--fg' || a === '--foreground') foreground = true;
    else if (a === '--silent') silent = true;
  }
  return { port, host, openBrowser, foreground, silent, token };
}

async function cmdUiDaemon(args = []) {
  const { port, host, token } = parseHostPortOptions(args);
  const pidFile = uiPidFileForPort(port);
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch (_) { /* non-fatal */ }

  const { startWebServer } = require('../../src/web_server');
  const srv = await startWebServer({ port, host, token });

  const shutdown = async () => {
    try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch (_) { /* non-fatal */ }
    if (srv && srv.instance) await srv.instance.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
}

async function ensureUiDaemonAutoStart(options = {}) {
  const port = options.port || 1404;
  const host = options.host || '127.0.0.1';
  const silent = Boolean(options.silent);
  const optOut = String(process.env.KONOHA_UI_AUTOSTART || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(optOut)) {
    return { started: false, reason: 'disabled' };
  }
  try {
    if (await checkPortActive(port)) return { started: false, reason: 'already-active' };
  } catch { /* non-fatal */ }

  if (!options.force && (!fileExists(path.join(SKILLS_DB_DIR, 'server.js')) || !fileExists(path.join(SKILLS_DB_DIR, 'konoha.db')))) {
    return { started: false, reason: 'not-initialized' };
  }

  const startArgs = ['--no-open', `--port=${port}`, `--host=${host}`];
  if (silent) startArgs.push('--silent');
  await cmdUiStart(startArgs);
  return { started: true };
}

function removeStalePid(pid, pidFile) {
  try {
    process.kill(pid, 0);
  } catch (_) {
    try { fs.unlinkSync(pidFile); } catch (_) { /* non-fatal */ }
  }
}

function cleanStalePidFile(pidFile) {
  if (!fileExists(pidFile)) return;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && pid > 0) removeStalePid(pid, pidFile);
  } catch (_) { /* non-fatal */ }
}

async function ensureBuildHandlerPresent(silent) {
  const buildHandler = path.join(deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', '..', 'apps', 'web'), 'build', 'handler.js');
  if (!fs.existsSync(buildHandler)) {
    if (!silent) info('Frontend build not found. Automatically building Konoha Web UI...');
    await cmdUiBuild();
  }
}

function spawnBackgroundDaemon(port, host, token, silent) {
  const cliPath = path.resolve(__dirname, '..', 'cli.js');
  const daemonArgs = [cliPath, 'ui', 'daemon', `--port=${port}`, `--host=${host}`];
  if (token) daemonArgs.push(`--token=${token}`);

  const { env: daemonEnv, nodePath: daemonNode } = deployUtils.resolveCompatibleNodeEnv(
    Object.assign({}, process.env, { KONOHA_UI_DAEMON: 'true' })
  );

  const child = spawn(daemonNode, daemonArgs, {
    detached: true,
    stdio: 'ignore',
    env: daemonEnv,
    windowsHide: true
  });
  child.on('error', (err) => {
    if (!silent) warn(`Background UI process failed to spawn: ${err?.message || err}`);
  });
  child.unref();

  const pidFile = uiPidFileForPort(port);
  if (child.pid) {
    try {
      if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
      fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    } catch (_) { /* non-fatal */ }
  }
  return child;
}

async function waitForPortReady(port) {
  const maxAttempts = 35;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkPortActive(port)) return true;
  }
  return false;
}

async function cmdUiStart(args = []) {
  const parsed = parseHostPortOptions(args);
  const { port, host, foreground, silent, token, openBrowser } = parsed;

  if (foreground) {
    return await cmdWebForeground({ port, host, openBrowser, token, openUrlInBrowser });
  }

  if (!silent) header('Starting Konoha Web Configuration UI');
  if (await checkPortActive(port)) {
    if (!silent) info(`Konoha Web UI is already active on http://${host}:${port}/`);
    if (openBrowser) openUrlInBrowser(`http://${host}:${port}/`);
    return;
  }

  const pidFile = uiPidFileForPort(port);
  cleanStalePidFile(pidFile);
  await ensureBuildHandlerPresent(silent);

  const child = spawnBackgroundDaemon(port, host, token, silent);
  const started = await waitForPortReady(port);

  if (started) {
    if (!silent) {
      success('Konoha Web UI started successfully in background!');
      info(`URL: http://${host}:${port}/  (PID: ${child.pid || 'unknown'})`);
      info('To stop: konoha ui stop | To restart: konoha ui restart');
    }
    if (openBrowser) openUrlInBrowser(`http://${host}:${port}/`);
  } else if (!silent) {
    warn(`Background process spawned (PID: ${child.pid}), but port ${port} is not yet responding. Run "konoha ui status" to verify.`);
  }
}

function parseTargetPort(args, defaultPort = 1404) {
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

async function terminatePortListeners(stopPort) {
  for (let attempt = 0; attempt < 10 && await checkPortActive(stopPort); attempt++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!await checkPortActive(stopPort)) return;

  if (process.platform !== 'win32') {
    try { execSync(`fuser -k ${stopPort}/tcp`, { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  } else {
    try {
      execSync(`powershell -NoProfile -Command "$p = (Get-NetTCPConnection -LocalPort ${stopPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`, { stdio: 'ignore', windowsHide: true });
    } catch (_) { /* non-fatal */ }
  }
}

function stopSystemdIfActive(stopPort) {
  if (stopPort !== 1404 || !isSystemdAvailable()) return;
  try {
    const out = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (out === 'active') {
      execSync('systemctl --user stop konoha-ui.service', { stdio: 'ignore' });
    }
  } catch (_) { /* non-fatal */ }
}

async function cmdUiStop(args = []) {
  const stopPort = parseTargetPort(args, 1404);
  header('Stopping Konoha Web Configuration UI');
  const pidFile = uiPidFileForPort(stopPort);
  const daemonPattern = `ui daemon --port=${stopPort}`;

  stopSystemdIfActive(stopPort);
  killPidFromPidFile(pidFile);

  if (process.platform !== 'win32') {
    try { execSync(`pkill -f "${daemonPattern}"`, { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  }

  await terminatePortListeners(stopPort);
  if (await checkPortActive(stopPort)) {
    warn(`Port ${stopPort} is still active. There may be a foreground process running.`);
  } else {
    success('Konoha Web UI stopped successfully.');
  }
}

function restartSystemdIfActive(restartPort) {
  if (restartPort !== 1404 || !isSystemdAvailable()) return false;
  try {
    const out = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (out === 'active') {
      info('Restarting via systemd user service...');
      execSync('systemctl --user restart konoha-ui.service', { stdio: 'inherit' });
      success('Konoha Web UI systemd service restarted successfully.');
      return true;
    }
  } catch (_) { /* non-fatal */ }
  return false;
}

async function cmdUiRestart(args = []) {
  header('Restarting Konoha Web Configuration UI');
  const restartPort = parseTargetPort(args, 1404);

  if (restartSystemdIfActive(restartPort)) return;

  info('Stopping running instance...');
  await cmdUiStop(args);
  for (let i = 0; i < 20; i++) {
    if (!await checkPortActive(restartPort)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  info('Starting new instance...');
  await cmdUiStart(args);
}

function readTokenFile() {
  const tokenFile = path.join(SKILLS_DB_DIR, 'web_token');
  try {
    return fileExists(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : null;
  } catch (_) {
    return null;
  }
}

function handleHealthResponse(res, resolve) {
  let raw = '';
  res.on('data', chunk => { raw += chunk; });
  res.on('end', () => {
    try {
      resolve(JSON.parse(raw));
    } catch (_) {
      resolve(null);
    }
  });
}

function fetchUiHealthData(port) {
  return new Promise((resolve) => {
    const token = readTokenFile();
    const headers = token ? { 'X-Konoha-Web-Token': token } : {};
    const req = http.get(`http://127.0.0.1:${port}/api/v1/health`, { headers, timeout: 1000 }, (res) => {
      handleHealthResponse(res, resolve);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function cmdUiStatus(args = []) {
  const port = parseTargetPort(args, 1404);
  header('Konoha Web Configuration UI Status');
  const active = await checkPortActive(port);
  const pidFile = uiPidFileForPort(port);
  let pid = null;
  if (fileExists(pidFile)) {
    try { pid = fs.readFileSync(pidFile, 'utf8').trim(); } catch (_) { /* non-fatal */ }
  }

  if (!active) {
    log(`  ${C.dim}○ STOPPED${C.reset}  Web UI is not currently running.`);
    log(`    Run ${C.cyan}konoha ui start${C.reset} to launch the UI in the background.`);
    log(`    Run ${C.cyan}konoha ui service install${C.reset} to configure automatic startup on boot.`);
    return;
  }

  const healthData = await fetchUiHealthData(port);
  log(`  ${C.green}● RUNNING${C.reset}  Web UI is active on ${C.cyan}http://127.0.0.1:${port}/${C.reset}`);
  log(`    Process ID:   ${pid || 'External / Foreground'}`);
  if (healthData) {
    log(`    Version:      v${healthData.version || '2.0.0'}`);
    log(`    Skills:       ${healthData.skills_count || healthData.skills || 0}`);
    log(`    Agents:       ${healthData.agents_count || healthData.agents || 7}`);
    log(`    Uptime:       ${Math.floor(healthData.uptime || 0)}s`);
  }
  const svc = await getServiceStatus();
  if (svc.installed) {
    log(`    OS Service:   ${svc.type} (${svc.active ? `${C.green}active` : `${C.yellow}inactive`}${C.reset}, ${svc.enabled ? 'enabled' : 'disabled'})`);
  } else {
    log(`    OS Service:   ${C.dim}not installed${C.reset} (run: ${C.cyan}konoha ui service install${C.reset} for boot autostart)`);
  }
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
    case 'stop':
      await cmdUiStop(subArgs);
      break;
    case 'restart':
      await cmdUiRestart(subArgs);
      break;
    case 'status':
      await cmdUiStatus(subArgs);
      break;
    case 'daemon':
      await cmdUiDaemon(subArgs);
      break;
    case 'service':
      await cmdUiService(subArgs, checkPortActive);
      break;
    case 'build':
      await cmdUiBuild();
      break;
    case 'preview':
      await cmdUiPreview(subArgs);
      break;
    default:
      await cmdUiStart(args);
      break;
  }
}

async function cmdWeb(args = []) {
  if (args.includes('help') || args.includes('--help') || args.includes('-h')) {
    log(`
${C.cyan}konoha web${C.reset} — Launch the Konoha Web Configuration UI

${C.bold}USAGE${C.reset}
  konoha web [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--port=<n>${C.reset}   Port to bind (default: 1404)
  ${C.cyan}--host=<h>${C.reset}   Host to bind (default: 127.0.0.1)
  ${C.cyan}--no-open${C.reset}    Do not automatically open the browser
  ${C.cyan}--bg${C.reset}         Run as detached background process (default: foreground)

${C.bold}EXAMPLES${C.reset}
  konoha web
  konoha web --port=8080 --no-open
  konoha web --bg
`);
    return;
  }

  if (args.includes('--bg') || args.includes('--background')) {
    const bgArgs = args.filter(a => a !== '--bg' && a !== '--background');
    await cmdUiStart(bgArgs);
    return;
  }

  const parsed = parseHostPortOptions(args);
  await cmdWebForeground({
    port: parsed.port,
    host: parsed.host,
    openBrowser: parsed.openBrowser,
    token: parsed.token,
    openUrlInBrowser
  });
}

module.exports = {
  cmdUi,
  cmdWeb,
  cmdUiStart,
  cmdUiStop,
  cmdUiRestart,
  cmdUiStatus,
  cmdUiDaemon,
  cmdUiHelp,
  cmdWebForeground,
  ensureUiDaemonAutoStart,
  checkPortActive,
  getServiceStatus,
  cmdUiService,
  cmdUiBuild,
  cmdUiPreview,
  openUrlInBrowser
};
