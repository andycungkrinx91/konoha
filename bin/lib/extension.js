'use strict';

/**
 * bin/lib/extension.js — IDE Extensions & External Tooling Management.
 *
 * Manages:
 * - uv and uvx detection, fallback paths, and installation
 * - Semble package refresh
 * - Antigravity IDE detection and obsolete bridge registry cleanup
 *   (The konoha-bridge VSIX lifecycle was removed in v2.2.1; only stale registry keys are pruned.)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const { HOME, INSTALL_BUILD_MIGRATE_TIMEOUT_MS } = require('./paths');
const { getConfigValue } = require('./config_defaults');
const { fileExists } = require('./prompt');
const { log, info, warn, success } = require('./format');
const { SEMBLE_PACKAGE } = require('../../src/semble_manager');

const PINNED_UV_VERSION = '0.9.5';

function installUvWindows(tmpDir, stdioOpt, silent) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.ps1`);
  try {
    execSync(`powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '${getConfigValue('uv_install_url')}/${PINNED_UV_VERSION}/install.ps1' -OutFile '${scriptPath}'"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
      execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
    }
  } catch (psErr) {
    if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
    // Never inherit: winget outlives the timeout kill on Windows and keeps writing its
    // progress spinner into the inherited pipe, so a caller that reads us through a pipe
    // (CI tee) never sees EOF and the step hangs with no further output. Run 7 did exactly
    // that for hours after init had already printed its summary.
    execSync(`winget install --id astral-sh.uv --version ${PINNED_UV_VERSION} -e --source winget`, { stdio: 'ignore', timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS, windowsHide: true });
  } finally {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
  }
}

function installUvPosix(tmpDir, stdioOpt) {
  const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.sh`);
  try {
    execSync(`curl -LsSf "${getConfigValue('uv_install_url')}/${PINNED_UV_VERSION}/install.sh" -o "${scriptPath}"`, { stdio: stdioOpt, timeout: INSTALL_BUILD_MIGRATE_TIMEOUT_MS });
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

  // The download and the winget fallback both need egress that a sandboxed CI guest
  // does not have; there the attempt blocks the whole run instead of failing fast.
  if (process.env.KONOHA_SKIP_UV_INSTALL === '1') return false;

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
  findIdeExecutable
};
