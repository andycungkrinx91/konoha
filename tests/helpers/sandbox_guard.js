'use strict';

const os = require('os');

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

function evaluateMaintenanceGuard(env = process.env) {
  if (env && env[CONTAINER_MARKER] === '1') return { allowed: true, mode: 'container' };
  if (env && env.CI === 'true') return { allowed: true, mode: 'ci' };
  return {
    allowed: false,
    mode: 'host',
    reason:
      'Refusing to run the Konoha maintenance suite on the host. The gate is the container sandbox: ' +
      '`pnpm test:sandbox` (Docker by default; `KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox` on macOS). ' +
      'RTK does not lift this: the guard is evaluated inside this process, so `rtk node tests/run_all.js` refuses identically.'
  };
}

function assertMaintenanceSandbox(env = process.env) {
  const result = evaluateMaintenanceGuard(env);
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
  assertMaintenanceSandbox
};
