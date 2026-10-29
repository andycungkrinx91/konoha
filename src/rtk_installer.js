'use strict';

/**
 * src/rtk_installer.js — Automated RTK installation and refresh utility.
 * Shared across client managers and CLI bootstrap.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { isRtkInstalled } = require('./platform_utils');

// Known trusted SHA-256 hashes for upstream RTK installer script to guarantee supply-chain integrity
const TRUSTED_INSTALLER_HASHES = new Set([
  '7ca3997314f631b8ad267e5add9af4b7a2f0351bdab0b1c5a9b7ed4008d0434a'
]);

function _downloadAndVerifyInstallerScript(url, silent) {
  const tmpScriptPath = path.join(os.tmpdir(), `rtk_install_${crypto.randomBytes(8).toString('hex')}.sh`);
  try {
    const curlRes = spawnSync('curl', ['-fsSL', url, '-o', tmpScriptPath], {
      timeout: 30000,
      windowsHide: true,
      stdio: silent ? 'ignore' : 'inherit'
    });
    if (curlRes.status !== 0 || !fs.existsSync(tmpScriptPath)) return null;

    const content = fs.readFileSync(tmpScriptPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (!TRUSTED_INSTALLER_HASHES.has(hash)) {
      if (!silent) process.stderr.write(`[rtk] Install script integrity verification failed (SHA-256 mismatch): ${hash}\n`);
      try { fs.unlinkSync(tmpScriptPath); } catch (_) { /* non-fatal cleanup */ }
      return null;
    }
    return tmpScriptPath;
  } catch (err) {
    if (!silent) process.stderr.write(`[rtk] Failed to download or verify install script: ${err.message}\n`);
    try { if (fs.existsSync(tmpScriptPath)) fs.unlinkSync(tmpScriptPath); } catch (_) { /* non-fatal cleanup */ }
    return null;
  }
}

function refreshRtk(silent = true) {
  if (isRtkInstalled()) return { ok: true, reason: 'already-installed' };
  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  try {
    const available = spawnSync(cargo, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    if (available.status !== 0) return { ok: false, reason: 'cargo-not-installed' };
    const result = spawnSync(cargo, ['install', '--git', 'https://github.com/rtk-ai/rtk', '--locked'], {
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

function _executeVerifiedInstallScript(verifiedScript, silent) {
  try {
    const scriptRes = spawnSync('sh', [verifiedScript], {
      encoding: 'utf-8', timeout: 180000, stdio: silent ? 'ignore' : 'inherit', windowsHide: true
    });
    return scriptRes.status === 0;
  } catch (_) {
    return false;
  } finally {
    try { fs.unlinkSync(verifiedScript); } catch (_) { /* non-fatal cleanup */ }
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
    const verifiedScript = _downloadAndVerifyInstallerScript(
      'https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh',
      silent
    );
    if (verifiedScript && _executeVerifiedInstallScript(verifiedScript, silent)) {
      addToPath();
      if (isRtkInstalled()) return { ok: true, reason: 'installed' };
    }

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
