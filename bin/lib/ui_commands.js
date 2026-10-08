'use strict';

/**
 * bin/lib/ui_commands.js — Local Browser-based Web Configuration UI Commands.
 *
 * Provides cross-platform lifecycle management for the Konoha Web UI:
 * - Build: Vite + SvelteKit + adapter-node with Windows EBUSY protection
 * - Daemon: Background execution with windowsHide, SIGTERM/SIGBREAK, port-scoped PID files
 * - Service: OS-level user services (systemd on Linux, launchd on macOS)
 * - Process management: Port polling, socket teardown, process tree killing (taskkill /F /T)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { SKILLS_DB_DIR } = require('./paths');
const deployUtils = require('../../src/deploy_utils');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m'
};

function log(msg) { console.log(msg); }
function header(title) {
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}\n${'═'.repeat(60)}`);
}
function info(msg) { console.log(`  \x1b[38;2;0;200;255mϟ\x1b[0m ${msg}`); }
function success(msg) { console.log(`  \x1b[38;2;0;255;255m⚡\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[38;2;255;200;0m↯\x1b[0m ${msg}`); }
function error(msg) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function drawLogo() {
  console.log('🍃 \x1b[1m\x1b[32mKonoha\x1b[0m');
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function ensureDir(p) {
  try { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); } catch (_) { /* intentional best-effort directory creation */ }
}

function checkPortActive(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function openUrlInBrowser(targetUrl) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', targetUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

function uiPidFileForPort(port) {
  return parseInt(port, 10) === 1404
    ? path.join(SKILLS_DB_DIR, 'ui.pid')
    : path.join(SKILLS_DB_DIR, `ui-${parseInt(port, 10)}.pid`);
}

function cmdUiHelp() {
  log(`
${C.cyan}konoha ui${C.reset} (or ${C.cyan}konoha web${C.reset}) — Manage the local browser-based Web Configuration UI

${C.bold}USAGE${C.reset}
  konoha ui <subcommand> [options]
  konoha web <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}start${C.reset}       Start the Web UI server as a background daemon (default port: 1404)
  ${C.cyan}stop${C.reset}        Stop the running Web UI server daemon
  ${C.cyan}restart${C.reset}     Restart the Web UI server
  ${C.cyan}status${C.reset}      Display current Web UI server status, PID, port, and health
  ${C.cyan}service${C.reset}     Manage the Web UI as an OS background daemon service (install, uninstall, status, restart)
  ${C.cyan}open${C.reset}        Open http://127.0.0.1:1404 in your default browser

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--port <num>${C.reset}        Port to listen on (default: 1404)
  ${C.cyan}--host <ip>${C.reset}         Host to bind on (default: 127.0.0.1)
  ${C.cyan}--foreground, -f${C.reset}    Run in the foreground instead of background daemon
  ${C.cyan}--no-open${C.reset}           Do not automatically open default browser
  ${C.cyan}--token <str>${C.reset}       Specify custom CSRF token

${C.bold}EXAMPLES${C.reset}
  konoha ui start
  konoha ui stop
  konoha ui restart
  konoha ui status
  konoha ui start --port 1404 --no-open
  konoha ui start --foreground
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
    if (a === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (a.startsWith('--port=')) {
      port = parseInt(a.slice('--port='.length), 10);
    } else if (a === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (a.startsWith('--host=')) {
      host = a.slice('--host='.length);
    } else if (a === '--no-open') {
      openBrowser = false;
    } else if (a === '--foreground' || a === '-f') {
      foreground = true;
    } else if (a === '--silent' || a === '-s') {
      silent = true;
    } else if (a === '--token' && args[i + 1]) {
      token = args[++i];
    }
  }
  return { port, host, openBrowser, foreground, silent, token };
}

async function cmdUiDaemon(args = []) {
  const { port, host, token } = parseHostPortOptions(args);
  const { startWebServer } = require('../../src/web_server');
  let srv;
  const pidFile = uiPidFileForPort(port);
  try {
    srv = await startWebServer({ port, host, token });
  } catch (_) {
    try {
      if (fileExists(pidFile)) {
        const recorded = fs.readFileSync(pidFile, 'utf8').trim();
        if (recorded === String(process.pid)) fs.unlinkSync(pidFile);
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    process.exit(1);
  }

  const shutdown = async () => {
    try {
      if (srv && srv.instance) {
        await Promise.race([
          srv.instance.stop(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    } catch (_) { /* intentional best-effort fallback: exit below regardless */ }
    try {
      if (fileExists(pidFile)) {
        const recorded = fs.readFileSync(pidFile, 'utf8').trim();
        if (recorded === String(process.pid)) fs.unlinkSync(pidFile);
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGHUP', shutdown);
  if (process.platform === 'win32') {
    process.on('SIGBREAK', shutdown);
  }

  await new Promise(() => {});
}

async function cmdWebForeground(options = {}) {
  const port = options.port || 1404;
  const host = options.host || '127.0.0.1';
  const openBrowser = options.openBrowser !== false;
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
    error(`Failed to start web server: ${err.message}`);
    process.exit(1);
  }

  success(`Web UI ready at: http://${host}:${port}/`);
  info(`CSRF session token active: ${srv.token}`);

  if (openBrowser) {
    openUrlInBrowser(`http://${host}:${port}/`);
  }

  log(`\n${C.dim}Press Ctrl+C to stop the Web UI server.${C.reset}\n`);

  await new Promise((resolve) => {
    const handleShutdown = async () => {
      log(`\n${C.yellow}Shutting down Konoha Web UI...${C.reset}`);
      if (srv && srv.instance) {
        await srv.instance.stop();
      }
      resolve();
      process.exit(0);
    };
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
    if (process.platform === 'win32') {
      process.on('SIGBREAK', handleShutdown);
    }
  });
}

async function ensureUiDaemonAutoStart(options = {}) {
  const port = options.port || 1404;
  const host = options.host || '127.0.0.1';
  const silent = Boolean(options.silent);
  const optOut = String(process.env.KONOHA_UI_AUTOSTART || '').trim().toLowerCase();
  if (optOut === '0' || optOut === 'false' || optOut === 'off' || optOut === 'no') {
    return { started: false, reason: 'disabled' };
  }
  try {
    if (await checkPortActive(port)) {
      return { started: false, reason: 'already-active' };
    }
  } catch { /* intentional best-effort fallback: port probe failure must never crash the installer */ }
  const startArgs = ['--no-open', `--port=${port}`, `--host=${host}`];
  if (silent) startArgs.push('--silent');
  await cmdUiStart(startArgs);
  return { started: true };
}

async function cmdUiStart(args = []) {
  const parsed = parseHostPortOptions(args);
  const { port, host, foreground, silent, token } = parsed;
  const openBrowser = parsed.openBrowser;

  if (foreground) {
    return await cmdWebForeground({ port, host, openBrowser, token });
  }

  if (!silent) header('Starting Konoha Web Configuration UI');
  const active = await checkPortActive(port);
  const pidFile = uiPidFileForPort(port);

  if (active) {
    let existingPid = null;
    if (fileExists(pidFile)) {
      try { existingPid = fs.readFileSync(pidFile, 'utf8').trim(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
    if (!silent) info(`Konoha Web UI is already active on http://${host}:${port}/${existingPid ? ` (PID: ${existingPid})` : ''}`);
    if (openBrowser) {
      openUrlInBrowser(`http://${host}:${port}/`);
    }
    return;
  }

  if (fileExists(pidFile)) {
    try {
      const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (_) {
          try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (process.platform !== 'win32') {
    try {
      const daemonPattern = `ui daemon --port=${port}`;
      const pgrep = execSync(`pgrep -f "${daemonPattern}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pgrep) {
        for (let attempt = 0; attempt < 5; attempt++) {
          if (await checkPortActive(port)) {
            if (!silent) info(`Konoha Web UI is already active on http://${host}:${port}/ (PID: ${pgrep.split('\n')[0]})`);
            if (openBrowser) openUrlInBrowser(`http://${host}:${port}/`);
            return;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        try { execSync(`pkill -f "${daemonPattern}"`, { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const buildHandler = path.join(deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', '..', 'apps', 'web'), 'build', 'handler.js');
  if (!fs.existsSync(buildHandler)) {
    if (!silent) info('Frontend build not found. Automatically building Konoha Web UI...');
    await cmdUiBuild();
  }

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
    if (!silent) warn(`Background UI process failed to spawn: ${err && err.message ? err.message : err}`);
  });
  child.unref();

  if (child.pid) {
    try {
      if (!fs.existsSync(SKILLS_DB_DIR)) {
        fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
      }
      fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    } catch (e) {
      if (!silent) warn(`Could not save UI PID file: ${e.message}`);
    }
  }

  let started = false;
  const maxAttempts = process.platform === 'win32' ? 30 : 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkPortActive(port)) {
      started = true;
      break;
    }
  }

  if (started) {
    if (!silent) {
      success(`Konoha Web UI started successfully in background!`);
      info(`URL: http://${host}:${port}/  (PID: ${child.pid || 'unknown'})`);
      info(`To stop: konoha ui stop | To restart: konoha ui restart`);
    }
    if (openBrowser) {
      openUrlInBrowser(`http://${host}:${port}/`);
    }
  } else {
    if (!silent) warn(`Background process spawned (PID: ${child.pid}), but port ${port} is not yet responding. Run "konoha ui status" to verify.`);
  }
}

async function cmdUiStop(args = []) {
  let stopPort = 1404;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) stopPort = parseInt(args[++i], 10);
    else if (args[i].startsWith('--port=')) stopPort = parseInt(args[i].slice('--port='.length), 10);
  }
  header('Stopping Konoha Web Configuration UI');
  const pidFile = uiPidFileForPort(stopPort);
  const daemonPattern = `ui daemon --port=${stopPort}`;

  if (stopPort === 1404 && isSystemdAvailable()) {
    try {
      const out = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (out === 'active') {
        try { execSync('systemctl --user stop konoha-ui.service', { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback */ }
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  const pidBelongsToPort = (pid) => {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (process.platform === 'win32') {
      try {
        process.kill(pid, 0);
        return true;
      } catch (_) {
        return false;
      }
    }
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      return cmdline.includes(daemonPattern);
    } catch (_) {
      return false;
    }
  };

  if (fileExists(pidFile)) {
    try {
      const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0 && pidBelongsToPort(pid)) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
          } else {
            process.kill(pid, 'SIGTERM');
          }
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (process.platform !== 'win32') {
    try {
      execSync(`pkill -f "${daemonPattern}"`, { stdio: 'ignore' });
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  for (let attempt = 0; attempt < 10 && await checkPortActive(stopPort); attempt++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  let stillActive = await checkPortActive(stopPort);
  if (stillActive && process.platform !== 'win32') {
    try {
      execSync(`fuser -k ${stopPort}/tcp`, { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 400));
      stillActive = await checkPortActive(stopPort);
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  } else if (stillActive && process.platform === 'win32') {
    try {
      execSync(`powershell -NoProfile -Command "$p = (Get-NetTCPConnection -LocalPort ${stopPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`, { stdio: 'ignore', windowsHide: true });
      await new Promise((r) => setTimeout(r, 400));
      stillActive = await checkPortActive(stopPort);
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    if (stillActive) {
      try {
        const netstat = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        const lines = netstat.split('\n');
        for (const line of lines) {
          if (line.includes(`:${stopPort} `) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (Number.isFinite(pid) && pid > 0) {
              try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true }); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            }
          }
        }
        await new Promise((r) => setTimeout(r, 400));
        stillActive = await checkPortActive(stopPort);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  if (stillActive) {
    warn(`Port ${stopPort} is still active. There may be a foreground process running.`);
  } else {
    success('Konoha Web UI stopped successfully.');
  }
}

async function cmdUiRestart(args = []) {
  header('Restarting Konoha Web Configuration UI');
  let restartPort = 1404;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) restartPort = parseInt(args[++i], 10);
    else if (args[i].startsWith('--port=')) restartPort = parseInt(args[i].slice('--port='.length), 10);
  }
  if (restartPort === 1404 && isSystemdAvailable()) {
    try {
      const out = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (out === 'active') {
        info('Restarting via systemd user service...');
        execSync('systemctl --user restart konoha-ui.service', { stdio: 'inherit' });
        success('Konoha Web UI systemd service restarted successfully.');
        return;
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }
  info('Stopping running instance...');
  await cmdUiStop(args);
  for (let i = 0; i < 20; i++) {
    if (!await checkPortActive(restartPort)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  info('Starting new instance...');
  await cmdUiStart(args);
}

async function cmdUiStatus(args = []) {
  let port = 1404;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    else if (args[i].startsWith('--port=')) port = parseInt(args[i].slice('--port='.length), 10);
  }

  header('Konoha Web Configuration UI Status');
  const active = await checkPortActive(port);
  const pidFile = uiPidFileForPort(port);
  let pid = null;
  if (fileExists(pidFile)) {
    try { pid = fs.readFileSync(pidFile, 'utf8').trim(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (active) {
    let healthData = null;
    try {
      const http = require('http');
      healthData = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/v1/health`, { timeout: 1000 }, (res) => {
          let raw = '';
          res.on('data', chunk => raw += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch (_) { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
      log(`    OS Service:   ${svc.type} (${svc.active ? C.green + 'active' : C.yellow + 'inactive'}${C.reset}, ${svc.enabled ? 'enabled' : 'disabled'})`);
    } else {
      log(`    OS Service:   ${C.dim}not installed${C.reset} (run: ${C.cyan}konoha ui service install${C.reset} for boot autostart)`);
    }
  } else {
    log(`  ${C.dim}○ STOPPED${C.reset}  Web UI is not currently running.`);
    log(`    Run ${C.cyan}konoha ui start${C.reset} to launch the UI in the background.`);
    log(`    Run ${C.cyan}konoha ui service install${C.reset} to configure automatic startup on boot.`);
  }
}

function getSystemdUserServicePath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'konoha-ui.service');
}

function getLaunchdPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.konoha.ui.plist');
}

function isSystemdAvailable() {
  if (process.platform !== 'linux') return false;
  try {
    const out = execSync('systemctl --user is-system-running || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return out === 'running' || out === 'degraded';
  } catch (_) {
    return false;
  }
}

function isLaunchdAvailable() {
  return process.platform === 'darwin';
}

async function getServiceStatus() {
  if (isSystemdAvailable()) {
    const serviceFile = getSystemdUserServicePath();
    if (!fileExists(serviceFile)) {
      return { type: 'systemd', installed: false, active: false, enabled: false };
    }
    try {
      const activeOut = execSync('systemctl --user is-active konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      const enabledOut = execSync('systemctl --user is-enabled konoha-ui.service || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      return {
        type: 'systemd',
        installed: true,
        active: activeOut === 'active',
        enabled: enabledOut === 'enabled',
        state: activeOut,
        path: serviceFile
      };
    } catch (_) {
      return { type: 'systemd', installed: true, active: false, enabled: false, path: serviceFile };
    }
  } else if (isLaunchdAvailable()) {
    const plistFile = getLaunchdPlistPath();
    if (!fileExists(plistFile)) {
      return { type: 'launchd', installed: false, active: false, enabled: false };
    }
    try {
      const listOut = execSync('launchctl list || true', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const loaded = listOut.includes('com.konoha.ui');
      return {
        type: 'launchd',
        installed: true,
        active: loaded,
        enabled: true,
        state: loaded ? 'active' : 'inactive',
        path: plistFile
      };
    } catch (_) {
      return { type: 'launchd', installed: true, active: false, enabled: false, path: plistFile };
    }
  }
  return { type: 'unsupported', installed: false, active: false, enabled: false };
}

function cmdUiServiceHelp() {
  log(`
${C.cyan}konoha ui service${C.reset} — Manage Konoha Web UI as an operating system background daemon service

${C.bold}USAGE${C.reset}
  konoha ui service <subcommand> [options]
  konoha service <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}install${C.reset}     Install and enable Web UI as an OS user service (systemd on Linux, launchd on macOS)
  ${C.cyan}uninstall${C.reset}   Stop, disable, and remove the OS daemon service
  ${C.cyan}status${C.reset}      Show current OS daemon service state
  ${C.cyan}start${C.reset}       Start the OS daemon service
  ${C.cyan}stop${C.reset}        Stop the OS daemon service
  ${C.cyan}restart${C.reset}     Restart the OS daemon service

${C.bold}EXAMPLES${C.reset}
  konoha ui service install
  konoha ui service status
  konoha ui service restart
  konoha ui service uninstall
`);
}

async function cmdUiService(args = []) {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdUiServiceHelp();
    return;
  }

  const isLinux = isSystemdAvailable();
  const isMac = isLaunchdAvailable();

  if (subcommand === 'status') {
    header('Konoha Web UI OS Daemon Service Status');
    const svc = await getServiceStatus();
    const portActive = await checkPortActive(1404);
    if (!svc.installed) {
      log(`  ${C.dim}○ NOT INSTALLED${C.reset}  OS daemon service unit is not registered.`);
      log(`    Supported platform: ${isLinux ? 'Linux (systemd --user)' : isMac ? 'macOS (launchd)' : process.platform}`);
      log(`    Run ${C.cyan}konoha ui service install${C.reset} to configure automatic startup on boot.`);
      log(`    Port 1404 listener: ${portActive ? C.green + 'ACTIVE (manual/detached daemon)' : C.dim + 'INACTIVE'}${C.reset}\n`);
      return;
    }
    log(`  Platform:     ${svc.type.toUpperCase()}`);
    log(`  Unit File:    ${svc.path}`);
    log(`  State:        ${svc.active ? C.green + '● ACTIVE (' + svc.state + ')' : C.yellow + '○ INACTIVE (' + svc.state + ')'}${C.reset}`);
    log(`  Enabled:      ${svc.enabled ? C.green + 'YES (starts automatically on login/boot)' : C.yellow + 'NO'}${C.reset}`);
    log(`  Web URL:      ${portActive ? C.cyan + 'http://127.0.0.1:1404/ (READY)' : C.yellow + 'PORT 1404 NOT RESPONDING'}${C.reset}\n`);
    return;
  }

  if (subcommand === 'install') {
    header('Installing Konoha Web UI OS Daemon Service');
    if (isLinux) {
      const userDir = path.join(os.homedir(), '.config', 'systemd', 'user');
      ensureDir(userDir);
      const servicePath = getSystemdUserServicePath();
      const nodePath = process.execPath;
      const cliPath = path.resolve(__dirname, '..', 'cli.js');
      const unitContent = `[Unit]
Description=Konoha Web Configuration UI Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} ui daemon --port=1404 --host=127.0.0.1
Restart=always
RestartSec=3s
Environment=NODE_ENV=production
Environment=KONOHA_UI_DAEMON=true

[Install]
WantedBy=default.target
`;
      fs.writeFileSync(servicePath, unitContent, 'utf8');
      info(`Created systemd user service unit: ${servicePath}`);
      try {
        execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
        execSync('systemctl --user enable konoha-ui.service', { stdio: 'ignore' });
        execSync('systemctl --user restart konoha-ui.service', { stdio: 'ignore' });
      } catch (e) {
        warn(`systemctl: ${e.message}`);
      }
      success('Konoha Web UI systemd user service installed and started successfully!');
      info('URL: http://127.0.0.1:1404/');
      return;
    } else if (isMac) {
      const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
      ensureDir(agentsDir);
      const plistPath = getLaunchdPlistPath();
      const nodePath = process.execPath;
      const cliPath = path.resolve(__dirname, '..', 'cli.js');
      const logPath = path.join(os.homedir(), '.konoha', 'ui-service.log');
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.konoha.ui</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>ui</string>
    <string>daemon</string>
    <string>--port=1404</string>
    <string>--host=127.0.0.1</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
      fs.writeFileSync(plistPath, plistContent, 'utf8');
      info(`Created launchd agent plist: ${plistPath}`);
      try {
        execSync(`launchctl load -w "${plistPath}"`, { stdio: 'ignore' });
      } catch (e) {
        warn(`launchctl load: ${e.message}`);
      }
      success('Konoha Web UI launchd daemon service installed and loaded successfully!');
      info('URL: http://127.0.0.1:1404/');
      return;
    } else {
      error('OS daemon service installation is currently supported on Linux (systemd) and macOS (launchd).');
      log(`On Windows, use ${C.cyan}konoha ui start${C.reset} to run as a background daemon process.`);
      process.exit(1);
    }
  }

  if (subcommand === 'uninstall') {
    header('Uninstalling Konoha Web UI OS Daemon Service');
    if (isLinux) {
      const servicePath = getSystemdUserServicePath();
      try { execSync('systemctl --user stop konoha-ui.service', { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback */ }
      try { execSync('systemctl --user disable konoha-ui.service', { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback */ }
      if (fileExists(servicePath)) {
        try { fs.unlinkSync(servicePath); } catch (_) { /* intentional best-effort fallback */ }
      }
      try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback */ }
      success('Konoha Web UI systemd user service uninstalled successfully.');
      return;
    } else if (isMac) {
      const plistPath = getLaunchdPlistPath();
      try { execSync(`launchctl unload -w "${plistPath}"`, { stdio: 'ignore' }); } catch (_) { /* intentional best-effort fallback */ }
      if (fileExists(plistPath)) {
        try { fs.unlinkSync(plistPath); } catch (_) { /* intentional best-effort fallback */ }
      }
      success('Konoha Web UI launchd user service uninstalled successfully.');
      return;
    } else {
      error('OS daemon service uninstall is supported on Linux (systemd) and macOS (launchd).');
      process.exit(1);
    }
  }

  if (subcommand === 'start') {
    if (isLinux) {
      try { execSync('systemctl --user start konoha-ui.service', { stdio: 'inherit' }); success('Started konoha-ui.service'); } catch (e) { error(`start: ${e.message}`); }
    } else if (isMac) {
      try { execSync(`launchctl start com.konoha.ui`, { stdio: 'inherit' }); success('Started com.konoha.ui'); } catch (e) { error(`start: ${e.message}`); }
    } else {
      error('Service start is supported on Linux and macOS.');
    }
    return;
  }

  if (subcommand === 'stop') {
    if (isLinux) {
      try { execSync('systemctl --user stop konoha-ui.service', { stdio: 'inherit' }); success('Stopped konoha-ui.service'); } catch (e) { error(`stop: ${e.message}`); }
    } else if (isMac) {
      try { execSync(`launchctl stop com.konoha.ui`, { stdio: 'inherit' }); success('Stopped com.konoha.ui'); } catch (e) { error(`stop: ${e.message}`); }
    } else {
      error('Service stop is supported on Linux and macOS.');
    }
    return;
  }

  if (subcommand === 'restart') {
    if (isLinux) {
      try { execSync('systemctl --user restart konoha-ui.service', { stdio: 'inherit' }); success('Restarted konoha-ui.service'); } catch (e) { error(`restart: ${e.message}`); }
    } else if (isMac) {
      try {
        execSync(`launchctl stop com.konoha.ui`, { stdio: 'ignore' });
        execSync(`launchctl start com.konoha.ui`, { stdio: 'inherit' });
        success('Restarted com.konoha.ui');
      } catch (e) { error(`restart: ${e.message}`); }
    } else {
      error('Service restart is supported on Linux and macOS.');
    }
    return;
  }

  error(`Unknown service subcommand: ${subcommand}`);
  log(`Run ${C.cyan}konoha ui service help${C.reset} for usage.`);
  process.exit(1);
}

async function cmdUiBuild() {
  header('Building Konoha Web UI (SvelteKit + Node Adapter)');
  let webDir = deployUtils.resolveWebUiDir({ preferSources: true });
  if (!webDir) {
    const candidates = [
      path.resolve(process.cwd(), 'apps', 'web'),
      path.resolve(process.cwd()),
      path.resolve(__dirname, '..', '..', 'apps', 'web'),
      path.join(SKILLS_DB_DIR, 'apps', 'web')
    ];
    for (const cand of candidates) {
      const pkg = path.join(cand, 'package.json');
      if (fileExists(pkg) && (fileExists(path.join(cand, 'src', 'routes')) || fileExists(path.join(cand, 'public')))) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          if (parsed.scripts && parsed.scripts.build) {
            webDir = cand;
            break;
          }
        } catch (_) { /* intentional best-effort fallback: unreadable package.json ignored */ }
      }
    }
  }
  const hasSources = webDir && fileExists(path.join(webDir, 'package.json'))
    && (fileExists(path.join(webDir, 'src', 'routes')) || fileExists(path.join(webDir, 'public')));
  if (!hasSources) {
    const installedHandler = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build', 'handler.js');
    if (fileExists(installedHandler)) {
      info('Web UI sources not found in current directory, but pre-built UI is ready:');
      log(`    ↳ Build:   ${installedHandler}`);
      log(`    ↳ Service: konoha ui status`);
      log(`    ↳ Launch:  konoha ui start (or konoha web)\n`);
      success('Pre-built Konoha Web UI is healthy and ready to serve.');
      return;
    }
    error(`Web UI sources not found (looked in: ${webDir || 'workspace'}).`);
    info(`The pre-built UI at ${path.join(SKILLS_DB_DIR, 'apps', 'web', 'build')} is served automatically by 'konoha ui start'.`);
    info(`To rebuild the UI from source, clone the Konoha repository: pnpm --dir apps/web run build`);
    process.exit(1);
  }
  try {
    const isWin = process.platform === 'win32';
    const { env: buildEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
    const hasPnpm = (() => {
      try {
        const cmd = isWin ? 'where pnpm' : 'which pnpm';
        execSync(cmd, { stdio: 'ignore' });
        return true;
      } catch (_) { return false; }
    })();

    const isZeroDep = fileExists(path.join(webDir, 'scripts', 'build.js'));
    const viteBin = path.join(webDir, 'node_modules', '.bin', isWin ? 'vite.cmd' : 'vite');
    if (!isZeroDep && !fileExists(viteBin)) {
      info(`Installing apps/web dependencies in ${webDir}...`);
      if (hasPnpm) {
        try {
          execSync('pnpm install', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
        } catch (_) {
          try {
            execSync('npm install', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
          } catch (e) {
            warn(`Could not install apps/web dependencies: ${e.message}`);
          }
        }
      } else {
        try {
          execSync('npm install', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
        } catch (e) {
          warn(`Could not install apps/web dependencies: ${e.message}`);
        }
      }
    }
    info('Running build in apps/web...');
    if (hasPnpm) {
      try {
        execSync('pnpm run build', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
      } catch (_) {
        execSync('npm run build', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
      }
    } else {
      execSync('npm run build', { cwd: webDir, stdio: 'inherit', shell: isWin, env: buildEnv });
    }
    // Refresh the installed runtime copy so 'konoha ui start' serves the new build
    const installedBuild = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
    if (path.resolve(webDir) !== path.resolve(path.dirname(installedBuild))) {
      try {
        if (!fs.existsSync(installedBuild)) {
          fs.mkdirSync(installedBuild, { recursive: true });
        }
        fs.cpSync(path.join(webDir, 'build'), installedBuild, { recursive: true, force: true });
        const destWebDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
        const destWebPkg = path.join(destWebDir, 'package.json');
        if (!fileExists(destWebPkg)) {
          fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: '2.1.0', type: 'module', private: true }, null, 2) + '\n');
        }
        fs.writeFileSync(path.join(installedBuild, 'package.json'), '{\n  "type": "module"\n}\n');
        info(`Installed runtime UI refreshed: ${installedBuild}`);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
    try {
      const localBuildPkg = path.join(webDir, 'build', 'package.json');
      if (!fs.existsSync(localBuildPkg)) {
        fs.writeFileSync(localBuildPkg, '{\n  "type": "module"\n}\n');
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    success('Production build completed in apps/web/build/');
  } catch (err) {
    error(`Build failed: ${err.message}`);
    process.exit(1);
  }
}

async function cmdUiPreview(args = []) {
  header('Previewing Konoha Web UI Production Build');
  let port = 1404;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    else if (args[i].startsWith('--port=')) port = parseInt(args[i].slice('--port='.length), 10);
  }

  const buildIndex = path.join(deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', '..', 'apps', 'web'), 'build', 'index.js');
  if (!fs.existsSync(buildIndex)) {
    warn('Production build not found. Running "konoha ui build" first...');
    await cmdUiBuild();
  }

  info(`Starting preview server on port ${port}...`);
  const child = spawn(process.execPath || 'node', [buildIndex], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1' }),
    stdio: 'inherit'
  });

  process.on('SIGINT', () => {
    child.kill('SIGTERM');
    process.exit(0);
  });
}

async function cmdUi(args = []) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand) {
    await cmdUiStatus(args);
    return;
  }
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
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
    case 'build':
      await cmdUiBuild(subArgs);
      break;
    case 'preview':
      await cmdUiPreview(subArgs);
      break;
    case 'open':
      openUrlInBrowser('http://127.0.0.1:1404/');
      break;
    case 'daemon':
      await cmdUiDaemon(subArgs);
      break;
    case 'service':
      await cmdUiService(subArgs);
      break;
    default:
      if (subcommand.startsWith('-')) {
        await cmdUiStart(args);
      } else {
        error(`Unknown ui subcommand: ${subcommand}`);
        log(`Run ${C.cyan}konoha ui help${C.reset} for usage.`);
        process.exit(1);
      }
  }
}

async function cmdWeb(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdUiHelp();
    return;
  }
  const first = args[0];
  if (first && ['start', 'stop', 'restart', 'status', 'open', 'daemon', 'service'].includes(first)) {
    return await cmdUi(args);
  }
  const parsed = parseHostPortOptions(args);
  await cmdWebForeground({
    port: parsed.port,
    host: parsed.host,
    openBrowser: parsed.openBrowser,
    token: parsed.token
  });
}

module.exports = {
  openUrlInBrowser,
  uiPidFileForPort,
  cmdUiHelp,
  cmdUiDaemon,
  cmdWebForeground,
  ensureUiDaemonAutoStart,
  cmdUiStart,
  cmdUiStop,
  cmdUiRestart,
  cmdUiStatus,
  getSystemdUserServicePath,
  getLaunchdPlistPath,
  isSystemdAvailable,
  isLaunchdAvailable,
  getServiceStatus,
  cmdUiServiceHelp,
  cmdUiService,
  cmdUiBuild,
  cmdUiPreview,
  cmdUi,
  cmdWeb
};
