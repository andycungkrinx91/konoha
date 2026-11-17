'use strict';

/**
 * Shared timeout parsing, process-tree termination, and shard watchdog helpers
 * used by `tests/run_all.js` and verified directly by `tests/test_test_sharding.js`.
 */

const { spawnSync } = require('child_process');
const { isPidAlive } = require('./seed_lifecycle');

const DEFAULT_TEST_TIMEOUT_MS = 3600000;

/**
 * Resolves the first strictly positive finite integer millisecond value across
 * candidate values, falling back to `fallbackMs` when none is valid.
 */
function parsePositiveTimeoutMs(candidates, fallbackMs = DEFAULT_TEST_TIMEOUT_MS) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const raw of list) {
    if (raw === undefined || raw === null) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return Math.floor(num);
    }
  }
  return fallbackMs;
}

function _isProcessGroupAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  if (process.platform === 'win32') return isPidAlive(num);
  try {
    process.kill(-num, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') return true;
    return isPidAlive(num);
  }
}

function _isChildGone(child) {
  if (!child) return true;
  if (child.pid) return !_isProcessGroupAlive(child.pid);
  return child.exitCode !== null || child.signalCode !== null;
}

function terminateChildTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (_) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  } catch (_) {}
}

function _delay(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

async function _waitForChildrenExit(entries, timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (entries.every((e) => _isChildGone(e.child))) return true;
    await _delay(25);
  }
  return entries.every((e) => _isChildGone(e.child));
}

async function terminateSuitesBeforeCleanup(activeSuites, label, cleanupFn, options = {}) {
  const graceMs = options.graceMs ?? 500;
  const killWaitMs = options.killWaitMs ?? 500;
  const entries = Array.from(activeSuites.values());

  for (const entry of entries) {
    terminateChildTree(entry.child, 'SIGTERM');
  }

  const exitedGracefully = await _waitForChildrenExit(entries, graceMs);
  if (!exitedGracefully) {
    for (const entry of entries) {
      if (!_isChildGone(entry.child)) {
        terminateChildTree(entry.child, 'SIGKILL');
      }
    }
    await _waitForChildrenExit(entries, killWaitMs);
  }

  for (const entry of entries) {
    if (typeof cleanupFn === 'function') {
      cleanupFn(entry.suiteHome, `${entry.name} (${label})`);
    }
  }
  activeSuites.clear();
}

function armShardWatchdog({
  shard,
  timeoutMs,
  activeSuites,
  cleanupSuiteDir,
  onBeforeExit,
  exit = process.exit,
  graceMs = 500,
  killWaitMs = 500
}) {
  if (!shard) return { cancel: () => {}, timeoutMs: 0 };
  const effectiveMs = parsePositiveTimeoutMs(timeoutMs, DEFAULT_TEST_TIMEOUT_MS);
  let fired = false;

  const timer = setTimeout(async () => {
    if (fired) return;
    fired = true;
    console.error(`\n[TIMEOUT] Shard ${shard} test run exceeded ${effectiveMs / 1000}s; terminating ${activeSuites.size} active suite(s).`);
    await terminateSuitesBeforeCleanup(activeSuites, 'shard-timeout', cleanupSuiteDir, { graceMs, killWaitMs });
    if (typeof onBeforeExit === 'function') onBeforeExit();
    exit(1);
  }, effectiveMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    timeoutMs: effectiveMs,
    cancel: () => clearTimeout(timer)
  };
}

module.exports = {
  DEFAULT_TEST_TIMEOUT_MS,
  parsePositiveTimeoutMs,
  terminateChildTree,
  terminateSuitesBeforeCleanup,
  armShardWatchdog
};
