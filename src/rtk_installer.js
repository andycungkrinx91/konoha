'use strict';

/**
 * src/rtk_installer.js — Automated RTK installation and refresh utility.
 * Shared across client managers and CLI bootstrap.
 */

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { isRtkInstalled } = require('./platform_utils');

function refreshRtk(silent = true) {
  if (isRtkInstalled()) return { ok: true, reason: 'already-installed' };
  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  try {
    const available = spawnSync(cargo, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    if (available.status !== 0) return { ok: false, reason: 'cargo-not-installed' };
    const result = spawnSync(cargo, ['install', '--git', 'https://github.com/rtk-ai/rtk', '--locked', '--force'], {
      encoding: 'utf-8', timeout: 600000, stdio: silent ? 'ignore' : 'inherit', windowsHide: true
    });
    if (result.status !== 0) return { ok: false, reason: 'rtk-refresh-failed' };
    const home = os.homedir();
    const cargoBin = path.join(home, '.cargo', 'bin');
    const localBin = path.join(home, '.local', 'bin');
    process.env.PATH = [cargoBin, localBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
    return isRtkInstalled() ? { ok: true, reason: 'refreshed' } : { ok: false, reason: 'rtk-refresh-failed' };
  } catch (error) {
    return { ok: false, reason: 'rtk-refresh-failed', error: error.message };
  }
}

function _tryBrewInstallRtk(silent) {
  try {
    const brewAvail = spawnSync('brew', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (brewAvail.status !== 0) return false;
    let result = spawnSync('brew', ['install', 'rtk'], {
      encoding: 'utf-8', timeout: 180000, stdio: silent ? 'ignore' : 'inherit'
    });
    if (result.status !== 0) {
      result = spawnSync('brew', ['install', 'rtk-ai/tap/rtk'], {
        encoding: 'utf-8', timeout: 180000, stdio: silent ? 'ignore' : 'inherit'
      });
    }
    return result.status === 0;
  } catch (_) { return false; }
}

function _tryCargoInstallRtk(silent, cargo) {
  try {
    const available = spawnSync(cargo, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    if (available.status !== 0) return false;
    const result = spawnSync(cargo, ['install', '--git', 'https://github.com/rtk-ai/rtk', '--locked'], {
      encoding: 'utf-8', timeout: 600000, stdio: silent ? 'ignore' : 'inherit', windowsHide: true
    });
    return result.status === 0;
  } catch (error) {
    if (!silent) process.stderr.write(`[rtk] cargo install unavailable: ${error.message}\n`);
    return false;
  }
}

function ensureRtkInstalled(silent = true) {
  if (isRtkInstalled()) return { ok: true, reason: 'already-installed' };

  const home = os.homedir();
  const addToPath = () => {
    const cargoBin = path.join(home, '.cargo', 'bin');
    const localBin = path.join(home, '.local', 'bin');
    process.env.PATH = [cargoBin, localBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
  };
  addToPath();
  if (isRtkInstalled()) return { ok: true, reason: 'already-installed' };

  if (process.platform !== 'win32') {
    try {
      const scriptRes = spawnSync('sh', ['-c', 'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh'], {
        encoding: 'utf-8', timeout: 180000, stdio: silent ? 'ignore' : 'inherit'
      });
      if (scriptRes.status === 0) {
        addToPath();
        if (isRtkInstalled()) return { ok: true, reason: 'installed' };
      }
    } catch (_) { /* intentional best-effort fallback */ }

    if (_tryBrewInstallRtk(silent)) {
      addToPath();
      if (isRtkInstalled()) return { ok: true, reason: 'installed' };
    }
  }

  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  if (_tryCargoInstallRtk(silent, cargo)) {
    addToPath();
    if (isRtkInstalled()) return { ok: true, reason: 'installed' };
  }

  return { ok: false, reason: 'rtk-install-failed' };
}

module.exports = {
  isRtkInstalled,
  ensureRtkInstalled,
  refreshRtk
};
