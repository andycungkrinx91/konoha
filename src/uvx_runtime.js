'use strict';

/**
 * uvx discovery plus the Aislop package pin.
 *
 * These lived in `semble_manager.js` alongside the Semble MCP wrapper. Semble
 * is gone; the Aislop paths still need a resolved `uvx` binary and the package
 * spec, so they moved here rather than being duplicated into nine importers.
 */

const AISLOP_PACKAGE = 'aislop@latest';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

function resolveUvxExecutablePath() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'uvx.exe' : 'uvx';
  const home = os.homedir();

  const candidateDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    isWin ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'uv') : '/usr/local/bin',
    '/usr/bin'
  ];
  for (const dir of candidateDirs) {
    if (!dir) continue;
    const full = path.join(dir, binName);
    if (fs.existsSync(full)) {
      try {
        const res = spawnSync(full, ['--version'], { encoding: 'utf-8', timeout: 2000, windowsHide: true, stdio: 'ignore' });
        if (res.status === 0) return full;
      } catch (_) { /* intentional fallback */ }
    }
  }

  try {
    const whichCmd = isWin ? 'where.exe' : 'which';
    const res = spawnSync(whichCmd, [binName], { encoding: 'utf-8', timeout: 2000, windowsHide: true });
    if (res.status === 0 && res.stdout) {
      const resolved = res.stdout.trim().split(/\r?\n/)[0].trim();
      if (resolved && fs.existsSync(resolved)) return resolved;
    }
  } catch (_) { /* intentional fallback */ }

  return isWin ? 'uvx.exe' : 'uvx';
}

module.exports = {
  AISLOP_PACKAGE,
  resolveUvxExecutablePath
};
