'use strict';

/**
 * bin/lib/upgrade_verify.js — the "did the upgrade actually take?" gate.
 *
 * `konoha upgrade` can install a new package and still leave `konoha` on PATH
 * resolving to an older copy (a ~/.local/bin shim ahead of the npm prefix, a
 * stale nvm shim). Reporting success in that state is the 2.2.19 defect, so the
 * version a fresh shell would run is spawned and compared against the package
 * that was installed.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { fileExists } = require('./prompt');
const { error } = require('./format');

/** First `konoha` a fresh shell resolves, or null. */
function resolvePathKonoha(isWin = process.platform === 'win32') {
  const name = isWin ? 'konoha.cmd' : 'konoha';
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Version that PATH's `konoha` reports, spawned as its own process.
 * `path: null` means nothing named konoha is on PATH — after an install that
 * just succeeded that is a failure, not a neutral case.
 */
function readPathKonohaVersion(isWin = process.platform === 'win32') {
  const cliPath = resolvePathKonoha(isWin);
  if (!cliPath) return { path: null, version: null, error: 'no konoha executable on PATH' };
  try {
    const res = isWin
      ? spawnSync(`"${cliPath}" --version`, { encoding: 'utf8', timeout: 60000, shell: true, windowsHide: true })
      : spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    // `konoha --version` prints a banner and an update check; only the labelled
    // line is this binary's version. A bare semver match could pick up the
    // "Latest:" version from the registry response instead.
    const labelled = out.match(/Current Version:\s*v?(\d+\.\d+\.\d+)/);
    if (labelled) return { path: cliPath, version: labelled[1] };
    return { path: cliPath, version: null, error: `exit ${res.status}, no "Current Version" line` };
  } catch (err) {
    return { path: cliPath, version: null, error: err.message };
  }
}

function failUpgradeVerification(reason, cleanTarget, onPath) {
  error(`Upgrade verification failed: ${reason}`);
  error(`  PATH resolves 'konoha' to: ${onPath.path || '<not found on PATH>'}`);
  error(`  Expected: ${cleanTarget}`);
  error(`Re-run: npm install -g konoha-mcp@${cleanTarget}`);
  process.exit(1);
}

/**
 * Throws-by-exiting unless the PATH binary reports the version the package
 * install produced. Returns the probe result on success.
 */
function assertPathVersionMatches(installedVersion, cleanTarget, isWin = process.platform === 'win32') {
  const onPath = readPathKonohaVersion(isWin);
  if (onPath.path === null) {
    failUpgradeVerification('no konoha executable could be found on PATH after the install.', cleanTarget, onPath);
  }
  if (onPath.version === null) {
    failUpgradeVerification(
      `PATH 'konoha' at ${onPath.path} did not report a version (${onPath.error || 'no output'}).`,
      cleanTarget,
      onPath
    );
  }
  if (onPath.version !== installedVersion) {
    failUpgradeVerification(
      `PATH 'konoha' reports v${onPath.version} but the installed package is v${installedVersion}.`,
      cleanTarget,
      onPath
    );
  }
  return onPath;
}

/**
 * `KONOHA_UPGRADE_TARGET=<path/to/konoha-mcp-x.y.z.tgz>` points the upgrade at a
 * local tarball instead of the registry. It exists so the upgrade path can be
 * exercised end-to-end against an unpublished build; with it unset the upgrade
 * behaves exactly as before.
 *
 * Returns null when unset. Exits on a path that does not exist: a typo must not
 * silently fall through to a registry upgrade of a different version.
 */
function resolveUpgradeTargetOverride() {
  const raw = process.env.KONOHA_UPGRADE_TARGET;
  if (!raw) return null;
  const tarballPath = path.resolve(raw);
  if (!fileExists(tarballPath)) {
    error(`KONOHA_UPGRADE_TARGET does not exist: ${tarballPath}`);
    process.exit(1);
  }
  let targetVer = '';
  let extractError = '';
  try {
    const res = spawnSync('tar', ['-xzOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true
    });
    if (res.status !== 0) {
      extractError = `tar exited ${res.status}`;
    } else {
      const parsed = JSON.parse(res.stdout);
      if (parsed && /\d+\.\d+\.\d+/.test(String(parsed.version || ''))) targetVer = String(parsed.version).trim();
      else extractError = 'package/package.json has no version';
    }
  } catch (err) {
    extractError = err.message;
  }
  // The override's whole purpose is to verify a specific build. Guessing the
  // version from the running CLI would compare the tarball against itself.
  if (!targetVer) {
    error(`KONOHA_UPGRADE_TARGET is not a readable konoha-mcp tarball (${extractError || 'unknown error'}): ${tarballPath}`);
    process.exit(1);
  }
  return { tarballPath, targetVer, targetTag: `v${targetVer}` };
}

module.exports = {
  resolvePathKonoha,
  readPathKonohaVersion,
  failUpgradeVerification,
  assertPathVersionMatches,
  resolveUpgradeTargetOverride
};
