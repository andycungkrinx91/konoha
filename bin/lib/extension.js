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
const { HOME } = require('./paths');
const { fileExists } = require('./prompt');
const { log, info, warn, success } = require('./format');
const { SEMBLE_PACKAGE } = require('../../src/semble_manager');

const PINNED_UV_VERSION = '0.9.5';

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
      const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.ps1`);
      try {
        execSync(`powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://astral.sh/uv/${PINNED_UV_VERSION}/install.ps1' -OutFile '${scriptPath}'"`, { stdio: stdioOpt });
        if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
          execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: stdioOpt });
        }
      } catch (psErr) {
        if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
        try {
          execSync(`winget install --id astral-sh.uv --version ${PINNED_UV_VERSION} -e --source winget`, { stdio: stdioOpt });
        } catch (_) {
          throw psErr;
        }
      } finally {
        try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
      }
    } else {
      const scriptPath = path.join(tmpDir, `uv-install-${Date.now()}.sh`);
      try {
        execSync(`curl -LsSf "https://astral.sh/uv/${PINNED_UV_VERSION}/install.sh" -o "${scriptPath}"`, { stdio: stdioOpt });
        if (fs.existsSync(scriptPath) && fs.statSync(scriptPath).size > 0) {
          execSync(`sh "${scriptPath}"`, { stdio: stdioOpt });
        }
      } finally {
        try { fs.rmSync(scriptPath, { force: true }); } catch (_) { /* best effort cleanup */ }
      }
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

function getAgentBrowserCommand() {
  const isWin = process.platform === 'win32';
  const abCmd = isWin ? 'agent-browser.cmd' : 'agent-browser';
  try {
    const res = spawnSync(abCmd, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
    if (res.status === 0) {
      return abCmd;
    }
  } catch { /* intentional best-effort fallback */ }

  const home = os.homedir();
  const candidates = [];
  if (isWin) {
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, 'npm', 'agent-browser.cmd'),
        path.join(process.env.APPDATA, 'yarn', 'bin', 'agent-browser.cmd')
      );
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(
        path.join(process.env.LOCALAPPDATA, 'pnpm', 'agent-browser.cmd')
      );
    }
    candidates.push(
      path.join(home, 'AppData', 'Roaming', 'npm', 'agent-browser.cmd'),
      path.join(home, 'AppData', 'Local', 'pnpm', 'agent-browser.cmd')
    );
  } else {
    candidates.push(
      path.join(home, '.local', 'bin', 'agent-browser'),
      path.join(home, '.npm-global', 'bin', 'agent-browser'),
      path.join(home, '.pnpm-global', 'bin', 'agent-browser'),
      path.join(home, '.yarn', 'bin', 'agent-browser'),
      '/usr/local/bin/agent-browser',
      '/usr/bin/agent-browser',
      '/bin/agent-browser'
    );
  }

  for (const p of candidates) {
    if (p && fileExists(p)) {
      try {
        const res = spawnSync(p, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
        if (res.status === 0) {
          return p;
        }
      } catch { /* intentional best-effort fallback */ }
    }
  }

  return null;
}

function installAgentBrowser(silent = false) {
  const existing = getAgentBrowserCommand();
  if (existing) {
    return true;
  }

  if (!silent) info('Attempting to install "agent-browser" CLI for browser automation...');

  const isWin = process.platform === 'win32';
  const PINNED_AB_PACKAGE = 'agent-browser@0.3.1';
  const pkgManagers = [
    {
      name: 'npm',
      cmd: isWin ? 'npm.cmd' : 'npm',
      args: ['install', '-g', PINNED_AB_PACKAGE]
    },
    {
      name: 'pnpm',
      cmd: isWin ? 'pnpm.cmd' : 'pnpm',
      args: ['add', '-g', PINNED_AB_PACKAGE]
    },
    {
      name: 'yarn',
      cmd: isWin ? 'yarn.cmd' : 'yarn',
      args: ['global', 'add', PINNED_AB_PACKAGE]
    }
  ];

  for (const pm of pkgManagers) {
    try {
      const check = spawnSync(pm.cmd, ['--version'], { encoding: 'utf-8', shell: isWin, windowsHide: true });
      if (check.status === 0) {
        const stdioOpt = silent ? 'ignore' : 'inherit';
        const installRes = spawnSync(pm.cmd, pm.args, { stdio: stdioOpt, shell: isWin, windowsHide: true });
        if (installRes.status === 0) {
          if (!silent) success(`agent-browser installed successfully via ${pm.name}!`);
          return true;
        }
      }
    } catch { /* intentional best-effort fallback */ }
  }

  if (!silent) {
    warn('Could not auto-install agent-browser. You can install it manually: npm install -g agent-browser');
  }
  return false;
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
      try {
        if (fileExists(fullPath)) {
          return fullPath;
        }
      } catch { /* intentional best-effort fallback */ }
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
  findIdeExecutable
};
