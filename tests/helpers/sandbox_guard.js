'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * Pure evaluation function for standalone test sandbox guard.
 *
 * @param {object} [env=process.env] - Environment variables object.
 * @param {string|null} [realHome=null] - The real user home (defaults to os.userInfo().homedir).
 * @param {string} [marker='KONOHA_TEST_SANDBOX'] - Sandbox marker environment variable name.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateSandboxGuard(env = process.env, realHome = null, marker = 'KONOHA_TEST_SANDBOX') {
  if (realHome === null) {
    try {
      realHome = os.userInfo().homedir;
    } catch (_) {
      realHome = null;
    }
  }

  const currentHome = env ? env.HOME : undefined;

  // Refuse whenever HOME matches real user home, regardless of marker
  if (realHome && currentHome === realHome) {
    return {
      allowed: false,
      reason: "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
    };
  }

  // Refuse if HOME is missing
  if (!currentHome) {
    return {
      allowed: false,
      reason: "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
    };
  }

  // Allow when HOME is isolated / different from realHome
  if (realHome && currentHome !== realHome) {
    return { allowed: true };
  }

  // Fallback refusal
  return {
    allowed: false,
    reason: "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
  };
}

/**
 * Enforces sandbox guard at runtime. If running standalone against real HOME,
 * prints the refusal message and exits with code 1.
 */
function assertSandbox(env = process.env, realHome = null, marker = 'KONOHA_TEST_SANDBOX') {
  const result = evaluateSandboxGuard(env, realHome, marker);
  if (!result.allowed) {
    console.error(result.reason);
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(1);
    }
  }
}

/**
 * Repo-maintenance guard.
 *
 * The Konoha suite mutates HOME, the Konoha database, `node_modules`, and the
 * working tree. A developer machine also carries a real global `konoha`, a
 * populated `~/.konoha`, and a client config the harness would inherit, so a
 * host run is not evidence about the tree under test — it is evidence about
 * that machine. Maintenance runs are therefore accepted only inside the
 * container sandbox (`pnpm test:sandbox`) or on an ephemeral CI runner.
 *
 * The decision is made in this process, from this process's environment, so a
 * shell wrapper cannot lift it: `rtk node tests/run_all.js` refuses exactly
 * like `node tests/run_all.js`, because RTK rewrites argv, not this check.
 */
const CONTAINER_MARKER = 'KONOHA_SANDBOX_CONTAINER';
const HOST_ISOLATED_MARKER = 'KONOHA_HOST_ISOLATED';

function _resolveSafe(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch (_) {
    return abs;
  }
}

function _isWithinDir(childPath, parentDir) {
  const childResolved = _resolveSafe(childPath);
  const parentResolved = _resolveSafe(parentDir);
  const norm = (v) => (process.platform === 'win32' ? v.toLowerCase() : v);
  const c = norm(childResolved);
  const p = norm(parentResolved);
  return c !== p && c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function _hasHostIsolatedChildInvariants(env, realHome = null, tmpDir = os.tmpdir()) {
  if (!env || env[HOST_ISOLATED_MARKER] !== '1' || env.KONOHA_TEST_SANDBOX !== '1') {
    return false;
  }
  const home = env.HOME;
  const userProfile = env.USERPROFILE;
  const dbPath = env.KONOHA_DB_PATH;
  if (!home || !userProfile || !dbPath) return false;

  const resolvedRealHome = realHome || (() => {
    try { return os.userInfo().homedir; } catch (_) { return null; }
  })();
  if (resolvedRealHome && _resolveSafe(home) === _resolveSafe(resolvedRealHome)) {
    return false;
  }
  if (_resolveSafe(userProfile) !== _resolveSafe(home)) {
    return false;
  }
  if (!_isWithinDir(home, tmpDir)) {
    return false;
  }
  return _isWithinDir(dbPath, path.join(home, '.konoha'));
}

function evaluateMaintenanceGuard(env = process.env, options = {}) {
  if (env && env[CONTAINER_MARKER] === '1') return { allowed: true, mode: 'container' };
  if (env && env.CI === 'true') return { allowed: true, mode: 'ci' };

  const expectedRunner = path.resolve(__dirname, '..', 'run_all.js');
  if (
    options &&
    options.hostRunner === true &&
    options.runnerPath &&
    path.resolve(options.runnerPath) === expectedRunner &&
    options.seedIsolated === true &&
    options.suiteSnapshotsIsolated === true &&
    options.webBuildFresh === true
  ) {
    return { allowed: true, mode: 'host-isolated' };
  }

  if (_hasHostIsolatedChildInvariants(env, options.realHome, options.tmpDir || os.tmpdir())) {
    return { allowed: true, mode: 'host-isolated' };
  }

  return {
    allowed: false,
    mode: 'host',
    reason:
      'Refusing to run the Konoha maintenance suite on the host without Option H1 isolation or container sandbox. ' +
      'Run `node tests/run_all.js` (host-isolated mode), or `pnpm test:sandbox` (Docker by default; ' +
      '`KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox` on macOS). ' +
      'RTK does not lift bare host execution: the guard is evaluated inside this process, so `rtk node tests/run_all.js` refuses identically without runner isolation.'
  };
}

function assertMaintenanceSandbox(env = process.env, options = {}) {
  const result = evaluateMaintenanceGuard(env, options);
  if (!result.allowed) {
    console.error(result.reason);
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(1);
    }
  }
  return result;
}

module.exports = {
  evaluateSandboxGuard,
  assertSandbox,
  evaluateMaintenanceGuard,
  assertMaintenanceSandbox,
  HOST_ISOLATED_MARKER
};
