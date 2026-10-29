'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { fileExists, ensureDir, checkPortActive: defaultCheckPortActive } = require('../../src/platform_utils');
const { C, header, log, info, success, warn, error } = require('./format');

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

function getSystemdStatus(serviceFile) {
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
}

function getLaunchdStatus(plistFile) {
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

async function getServiceStatus() {
  if (isSystemdAvailable()) return getSystemdStatus(getSystemdUserServicePath());
  if (isLaunchdAvailable()) return getLaunchdStatus(getLaunchdPlistPath());
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

function installSystemdService() {
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
}

function installLaunchdService() {
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
}

function uninstallSystemdService() {
  const servicePath = getSystemdUserServicePath();
  try { execSync('systemctl --user stop konoha-ui.service', { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  try { execSync('systemctl --user disable konoha-ui.service', { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  if (fileExists(servicePath)) {
    try { fs.unlinkSync(servicePath); } catch (_) { /* non-fatal */ }
  }
  try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  success('Konoha Web UI systemd user service uninstalled successfully.');
}

function uninstallLaunchdService() {
  const plistPath = getLaunchdPlistPath();
  try { execSync(`launchctl unload -w "${plistPath}"`, { stdio: 'ignore' }); } catch (_) { /* non-fatal */ }
  if (fileExists(plistPath)) {
    try { fs.unlinkSync(plistPath); } catch (_) { /* non-fatal */ }
  }
  success('Konoha Web UI launchd user service uninstalled successfully.');
}

function restartLaunchdService() {
  try {
    execSync('launchctl stop com.konoha.ui', { stdio: 'ignore' });
  } catch (_) { /* non-fatal */ }
  execSync('launchctl start com.konoha.ui', { stdio: 'inherit' });
}

function runLaunchdAction(action) {
  try {
    if (action === 'restart') {
      restartLaunchdService();
    } else {
      execSync(`launchctl ${action} com.konoha.ui`, { stdio: 'inherit' });
    }
    success(`${action.charAt(0).toUpperCase() + action.slice(1)}ed com.konoha.ui`);
  } catch (e) {
    error(`${action}: ${e.message}`);
  }
}

function handleServiceAction(action, isLinux, isMac) {
  if (isLinux) {
    try {
      execSync(`systemctl --user ${action} konoha-ui.service`, { stdio: 'inherit' });
      success(`${action.charAt(0).toUpperCase() + action.slice(1)}ed konoha-ui.service`);
    } catch (e) {
      error(`${action}: ${e.message}`);
    }
    return;
  }
  if (isMac) {
    runLaunchdAction(action);
    return;
  }
  error(`Service ${action} is supported on Linux and macOS.`);
}

async function renderServiceStatusView(isLinux, isMac, checkPortActive) {
  header('Konoha Web UI OS Daemon Service Status');
  const svc = await getServiceStatus();
  const portActive = await checkPortActive(1404);
  if (!svc.installed) {
    log(`  ${C.dim}○ NOT INSTALLED${C.reset}  OS daemon service unit is not registered.`);
    log(`    Supported platform: ${isLinux ? 'Linux (systemd --user)' : isMac ? 'macOS (launchd)' : process.platform}`);
    log(`    Run ${C.cyan}konoha ui service install${C.reset} to configure automatic startup on boot.`);
    log(`    Port 1404 listener: ${portActive ? `${C.green}ACTIVE (manual/detached daemon)` : `${C.dim}INACTIVE`}${C.reset}\n`);
    return;
  }
  log(`  Platform:     ${svc.type.toUpperCase()}`);
  log(`  Unit File:    ${svc.path}`);
  log(`  State:        ${svc.active ? `${C.green}● ACTIVE (${svc.state})` : `${C.yellow}○ INACTIVE (${svc.state})`}${C.reset}`);
  log(`  Enabled:      ${svc.enabled ? `${C.green}YES (starts automatically on login/boot)` : `${C.yellow}NO`}${C.reset}`);
  log(`  Web URL:      ${portActive ? `${C.cyan}http://127.0.0.1:1404/ (READY)` : `${C.yellow}PORT 1404 NOT RESPONDING`}${C.reset}\n`);
}

async function cmdUiService(args = [], checkPortActive = defaultCheckPortActive) {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdUiServiceHelp();
    return;
  }

  const isLinux = isSystemdAvailable();
  const isMac = isLaunchdAvailable();

  if (subcommand === 'status') {
    await renderServiceStatusView(isLinux, isMac, checkPortActive);
    return;
  }
  if (subcommand === 'install') {
    header('Installing Konoha Web UI OS Daemon Service');
    if (isLinux) installSystemdService();
    else if (isMac) installLaunchdService();
    else {
      error('OS daemon service installation is supported on Linux (systemd) and macOS (launchd).');
      log(`On Windows, use ${C.cyan}konoha ui start${C.reset} to run as a background daemon process.`);
      process.exit(1);
    }
    return;
  }
  if (subcommand === 'uninstall') {
    header('Uninstalling Konoha Web UI OS Daemon Service');
    if (isLinux) uninstallSystemdService();
    else if (isMac) uninstallLaunchdService();
    else {
      error('OS daemon service uninstall is supported on Linux (systemd) and macOS (launchd).');
      process.exit(1);
    }
    return;
  }
  if (['start', 'stop', 'restart'].includes(subcommand)) {
    handleServiceAction(subcommand, isLinux, isMac);
    return;
  }

  error(`Unknown service subcommand: ${subcommand}`);
  log(`Run ${C.cyan}konoha ui service help${C.reset} for usage.`);
  process.exit(1);
}

module.exports = {
  getSystemdUserServicePath,
  getLaunchdPlistPath,
  isSystemdAvailable,
  isLaunchdAvailable,
  getServiceStatus,
  cmdUiServiceHelp,
  cmdUiService
};
