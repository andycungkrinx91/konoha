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

  // 1. Refuse whenever HOME matches real user home, regardless of marker
  if (realHome && currentHome === realHome) {
    return {
      allowed: false,
      reason: "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
    };
  }

  // 2. Refuse if HOME is missing
  if (!currentHome) {
    return {
      allowed: false,
      reason: "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
    };
  }

  // 3. Allow when HOME is isolated / different from realHome
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

module.exports = {
  evaluateSandboxGuard,
  assertSandbox
};
