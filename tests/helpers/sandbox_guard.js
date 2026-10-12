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

  // 1. If explicit sandbox marker is set, allow execution
  if (env && env[marker] === '1') {
    return { allowed: true };
  }

  // 2. If HOME is isolated / different from realHome, allow execution
  const currentHome = env ? env.HOME : undefined;
  if (currentHome && realHome && currentHome !== realHome) {
    return { allowed: true };
  }

  // 3. Otherwise, refuse execution to prevent real HOME mutation
  return {
    allowed: false,
    reason: "Refusing to run standalone test against real $HOME without sandbox. Run via 'npm test' or set KONOHA_TEST_SANDBOX=1."
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
