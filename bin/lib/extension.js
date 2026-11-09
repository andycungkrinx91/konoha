'use strict';

/**
 * bin/lib/extension.js — IDE Extensions & External Tooling Management.
 *
 * Manages:
 * - uv and uvx detection, fallback paths, and installation
 * - Semble package refresh
 * - agent-browser CLI installation and discovery
 * - Antigravity IDE detection and Konoha Bridge extension lifecycle
 *   (Strictly scoped to Antigravity IDE only; never installed into Cursor, VS Code, etc.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const { HOME, INSTALL_BUILD_MIGRATE_TIMEOUT_MS } = require('./paths');
const { fileExists } = require('./prompt');
const { log, info, warn, success } = require('./format');
const { SEMBLE_PACKAGE } = require('../../src/semble_manager');

const PINNED_UV_VERSION = '0.9.5';

function installUvWindows(tmpDir, stdioOpt, silent) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.ps1`);
  try {
    execSync(`powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://astral.sh/uv/${PINNED_UV_VERSION}/install.ps1' -OutFile '${scriptPath}'"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
      execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
  } catch (psErr) {
    if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
    execSync(`winget install --id astral-sh.uv --version ${PINNED_UV_VERSION} -e --source winget`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
  }
}

function installUvPosix(tmpDir, stdioOpt) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.sh`);
  try {
    execSync(`curl -LsSf "https://astral.sh/uv/${PINNED_UV_VERSION}/install.sh" -o "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
      execSync(`sh "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
  }
}

function installUv(silent = false) {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return true;
  } catch { /* intentional best-effort fallback */ }

  if (!silent) info(`Attempting to install pinned "uv" v${PINNED_UV_VERSION} for Semble MCP...`);
  try {
    const stdioOpt = silent ? 'ignore' : 'inherit';
    const tmpDir = os.tmpdir();
    if (process.platform === 'win32') {
      installUvWindows(tmpDir, stdioOpt, silent);
    } else {
      installUvPosix(tmpDir, stdioOpt);
    }
    if (!silent) success('uv installed successfully!');
    return true;
  } catch (err) {
    if (!silent) {
      warn(`Failed to auto-install uv: ${err.message}`);
      log('Please install uv manually: https://docs.astral.sh/uv/');
    }
    return false;
  }
}

function getUvCommand() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return 'uv';
  } catch { /* intentional best-effort fallback */ }

  const home = os.homedir();
  const localPaths = [];
  if (process.platform === 'win32') {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'programs', 'uv', 'uv.exe')
    );
  } else {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv'),
      path.join(home, '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
      '/usr/bin/uv'
    );
  }

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch { /* intentional best-effort fallback */ }
    }
  }

  return null;
}

function refreshSemblePackage(silent = true) {
  const uvxCmd = getUvxCommand();
  try {
    const result = spawnSync(uvxCmd, ['--from', SEMBLE_PACKAGE, 'semble', '--version'], {
      encoding: 'utf8', timeout: 120000, stdio: silent ? 'ignore' : 'inherit', windowsHide: true
    });
    return result.status === 0
      ? { ok: true, command: uvxCmd }
      : { ok: false, reason: `semble-refresh-failed-${result.status}` };
  } catch (error) {
    return { ok: false, reason: 'semble-refresh-failed', error: error.message };
  }
}

function getUvxCommand() {
  const uvCmd = getUvCommand();
  if (!uvCmd) return 'uvx';
  if (uvCmd !== 'uv') {
    const companionUvx = path.join(path.dirname(uvCmd), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    if (fileExists(companionUvx)) {
      return companionUvx;
    }
  }
  return 'uvx';
}

function getCandidateAgentBrowserPaths(isWin, home) {
  if (isWin) {
    const candidates = [];
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, 'npm', 'agent-browser.cmd'),
        path.join(process.env.APPDATA, 'yarn', 'bin', 'agent-browser.cmd')
      );
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'agent-browser.cmd'));
    }
    candidates.push(
      path.join(home, 'AppData', 'Roaming', 'npm', 'agent-browser.cmd'),
      path.join(home, 'AppData', 'Local', 'pnpm', 'agent-browser.cmd')
    );
    return candidates;
  }
  return [
    path.join(home, '.local', 'bin', 'agent-browser'),
    path.join(home, '.npm-global', 'bin', 'agent-browser'),
    path.join(home, '.pnpm-global', 'bin', 'agent-browser'),
    path.join(home, '.yarn', 'bin', 'agent-browser'),
    '/usr/local/bin/agent-browser',
    '/usr/bin/agent-browser',
    '/bin/agent-browser'
  ];
}

function probeAgentBrowser(cmd, isWin) {
  try {
    const res = isWin
      ? spawnSync(`"${cmd}" --version`, { encoding: 'utf-8', shell: true, windowsHide: true })
      : spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
    if (res.status === 0) return { ok: true };
    return { ok: false, stderr: `${(res.stderr || res.stdout || '').trim()}`.slice(0, 300) };
  } catch (err) {
    return { ok: false, stderr: err.message };
  }
}

function getAgentBrowserCommand() {
  const isWin = process.platform === 'win32';
  const abCmd = isWin ? 'agent-browser.cmd' : 'agent-browser';
  const probed = probeAgentBrowser(abCmd, isWin);
  if (probed.ok) return abCmd;

  const candidates = getCandidateAgentBrowserPaths(isWin, os.homedir());
  for (const p of candidates) {
    if (!p || !fileExists(p)) continue;
    if (probeAgentBrowser(p, isWin).ok) return p;
  }
  return null;
}

function tryInstallWithPm(pm, isWin, stdioOpt) {
  try {
    const check = isWin
      ? spawnSync(`"${pm.cmd}" --version`, { encoding: 'utf-8', shell: true, windowsHide: true })
      : spawnSync(pm.cmd, ['--version'], { encoding: 'utf-8' });
    if (check.status !== 0) return false;
    const installRes = isWin
      ? spawnSync(`"${pm.cmd}" ${pm.args.join(' ')}`, { stdio: stdioOpt, shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS })
      : spawnSync(pm.cmd, pm.args, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    return installRes.status === 0;
  } catch {
    return false;
  }
}

const PINNED_AB_PACKAGE = 'agent-browser@0.3.1';

function resolveInstalledAgentBrowser() {
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'agent-browser.cmd' : 'agent-browser';
  const managed = path.join(HOME, '.konoha', 'tools', 'node_modules', '.bin', bin);
  return fileExists(managed) ? managed : null;
}

function tryManagedLocalInstall(isWin, stdioOpt) {
  const prefix = path.join(HOME, '.konoha', 'tools');
  // The Windows path build joins args into one shell string, so a HOME containing
  // spaces (common: C:\Users\First Last) would split --prefix and install to the
  // wrong directory. Quote it for the shell form only.
  const prefixArg = isWin ? `"${prefix}"` : prefix;
  const candidates = [
    { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--prefix', prefixArg, PINNED_AB_PACKAGE] },
    { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['add', '--prefix', prefixArg, PINNED_AB_PACKAGE] }
  ];
  for (const pm of candidates) {
    if (!tryInstallWithPm(pm, isWin, stdioOpt)) continue;
    const resolved = resolveInstalledAgentBrowser();
    if (resolved && probeAgentBrowser(resolved, isWin).ok) return resolved;
  }
  return null;
}

function tryNpxFallback() {
  const isWin = process.platform === 'win32';
  try {
    const res = isWin
      ? spawnSync(`"npx" --yes ${PINNED_AB_PACKAGE} --version`, { encoding: 'utf-8', shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS })
      : spawnSync('npx', ['--yes', PINNED_AB_PACKAGE, '--version'], { encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (res.status === 0) return `npx --yes ${PINNED_AB_PACKAGE}`;
  } catch { /* best-effort */ }
  return null;
}

/**
 * Resolve or provision the agent-browser CLI.
 * Returns { ok, command, via, reason } where `ok` is true only when a command was
 * verified to run (`--version` exits 0). Never reports success for an installed
 * package whose native binary is missing.
 */
function installAgentBrowserDetailed(silent = false) {
  const existing = getAgentBrowserCommand();
  if (existing) return { ok: true, command: existing, via: 'global', reason: null };

  if (!silent) info('Attempting to install "agent-browser" CLI for browser automation...');

  const isWin = process.platform === 'win32';
  const pkgManagers = [
    { name: 'npm', cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '-g', PINNED_AB_PACKAGE] },
    { name: 'pnpm', cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['add', '-g', PINNED_AB_PACKAGE] },
    { name: 'yarn', cmd: isWin ? 'yarn.cmd' : 'yarn', args: ['global', 'add', PINNED_AB_PACKAGE] }
  ];

  const stdioOpt = silent ? 'ignore' : 'inherit';
  const attempts = [];
  for (const pm of pkgManagers) {
    if (tryInstallWithPm(pm, isWin, stdioOpt)) {
      const resolved = getAgentBrowserCommand();
      if (resolved) {
        if (!silent) success(`agent-browser installed successfully via ${pm.name}!`);
        return { ok: true, command: resolved, via: 'global', reason: null };
      }
      attempts.push(`${pm.name}: installed but "agent-browser --version" failed`);
    } else {
      attempts.push(`${pm.name}: install command failed`);
    }
  }

  const managed = tryManagedLocalInstall(isWin, stdioOpt);
  if (managed) return { ok: true, command: managed, via: 'local', reason: null };

  const viaNpx = tryNpxFallback();
  if (viaNpx) return { ok: true, command: viaNpx, via: 'npx', reason: null };

  const reason = attempts.length ? attempts.join('; ') : 'no package manager or npx fallback succeeded';
  if (!silent) {
    warn(`Could not auto-install agent-browser (${reason}). Install manually: npm install -g ${PINNED_AB_PACKAGE}`);
  }
  return { ok: false, command: null, via: null, reason };
}

/**
 * Download the browser binaries agent-browser drives. Separate from installation:
 * the npm package can be present while its native binary or Chromium is missing.
 */
function provisionAgentBrowser(silent = false) {
  const cmd = getAgentBrowserCommand();
  if (!cmd) return { ok: false, reason: 'agent-browser CLI not resolved' };
  const isWin = process.platform === 'win32';
  const args = ['install'];
  if (process.platform === 'linux') args.push('--with-deps');
  try {
    const res = isWin
      ? spawnSync(`"${cmd}" ${args.join(' ')}`, { encoding: 'utf-8', shell: true, windowsHide: true, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS })
      : spawnSync(cmd, args, { encoding: 'utf-8', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (res.status === 0) return { ok: true, reason: null };
    const detail = `${(res.stderr || res.stdout || '').trim()}`.slice(0, 400);
    if (!silent) warn(`agent-browser provisioning failed: ${detail}`);
    return { ok: false, reason: detail || `agent-browser install exited ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function installAgentBrowser(silent = false) {
  return installAgentBrowserDetailed(silent).ok;
}

function findIdeExecutable(name) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);

  if (!isWin) {
    dirs.push(path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin');
  }

  for (const d of dirs) {
    for (const ext of exts) {
      const fullPath = path.join(d, name + ext);
      if (fileExists(fullPath)) return fullPath;
    }
  }
  return null;
}

module.exports = {
  installUv,
  getUvCommand,
  refreshSemblePackage,
  getUvxCommand,
  getAgentBrowserCommand,
  installAgentBrowser,
  installAgentBrowserDetailed,
  provisionAgentBrowser,
  findIdeExecutable
};
