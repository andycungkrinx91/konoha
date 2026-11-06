'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let resolveStoredPid = null;

/** The refiner owns the lock file, so the pid lookup is injected rather than duplicated. */
function setStoredPidResolver(fn) {
  resolveStoredPid = typeof fn === 'function' ? fn : null;
}

const CREDENTIAL_PATTERNS = [
  // `Authorization: Bearer <token>` must be matched as a whole: the generic keyword rule
  // below would consume only the word "Bearer" and leave the secret in place.
  { re: /((?:authorization|proxy-authorization)\s*[=:]\s*bearer\s+)([^\s"',;]+)/gi, kind: 'prefixed' },
  { re: /((?:api[_-]?key|token|secret|password|passwd|authorization)\s*[=:]\s*)(?!bearer\b)([^\s"',;]{4,})/gi, kind: 'prefixed' },
  { re: /(\bbearer\s+)([A-Za-z0-9._~+/-]+=*)/gi, kind: 'prefixed' },
  // URL userinfo carries no prefix group: both halves are masked, and the host must be
  // re-emitted from the third group so the account is never revealed.
  { re: /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)(@)/gi, kind: 'userinfo' }
];

/** Masks credential-shaped substrings before any captured worker output is surfaced. */
function redactCredentials(text) {
  let out = String(text || '');
  for (const { re, kind } of CREDENTIAL_PATTERNS) {
    out = out.replace(re, (_match, prefix, _secret, suffixOrHost, hostSuffix) => {
      if (kind === 'userinfo') return `${prefix}[redacted]:[redacted]${hostSuffix}`;
      return `${prefix}[redacted]${suffixOrHost || ''}`;
    });
  }
  return out;
}

function liveQueueDir() {
  return path.join(os.homedir(), '.konoha', 'blender_queue');
}

/**
 * The detached GUI worker has no console of its own, so anything it prints on
 * stdout/stderr (a Blender traceback, an uncaught timer error) is only
 * observable through this log. Host-level, not test-level: the worker outlives
 * the process that spawned it.
 */
function liveWorkerLogPath() {
  return path.join(os.homedir(), '.konoha', 'blender_worker.log');
}

const WORKER_LOG_TAIL_LINES = 20;
const WORKER_LOG_MAX_BYTES = 4 * 1024 * 1024;

function rotateWorkerLog(logPath) {
  try {
    if (fs.statSync(logPath).size < WORKER_LOG_MAX_BYTES) return;
    fs.renameSync(logPath, `${logPath}.1`);
  } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
}

function excerptWorkerLog() {
  let raw;
  try {
    const stat = fs.statSync(liveWorkerLogPath());
    const start = Math.max(0, stat.size - 256 * 1024);
    const handle = fs.openSync(liveWorkerLogPath(), 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      raw = buffer.toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch (_) {
    return null;
  }
  const tail = redactCredentials(raw).split('\n').filter((line) => line.trim()).slice(-WORKER_LOG_TAIL_LINES);
  return tail.length > 0 ? tail.join('\n') : null;
}

function describeWorkerProcess(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    return cmdline ? `pid ${pid}: ${redactCredentials(cmdline)}` : `pid ${pid}`;
  } catch (_) {
    return null;
  }
}

function isBlenderWorkerAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (_) {
    return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('blender_live_worker.py');
  } catch (_) {
    return /blender/i.test(describeWorkerProcess(pid) || '');
  }
}

/**
 * Surfaces why a request produced no answer: whether the worker pid is still
 * alive and what it last wrote to its log. Never includes the request payload.
 */
function describeVanishedRequest(detail) {
  const pid = typeof resolveStoredPid === "function" ? resolveStoredPid() : null;
  const alive = isBlenderWorkerAlive(pid);
  const processLine = alive
    ? `live worker still running (${describeWorkerProcess(pid) || `pid ${pid}`})`
    : 'live worker is not running';
  const logTail = excerptWorkerLog();
  const parts = [
    `Live Blender session request vanished before a result was written (${detail}; ${processLine}; log ${liveWorkerLogPath()})`
  ];
  if (logTail) parts.push(`worker log tail:\n${logTail}`);
  else parts.push(`worker log tail: <unreadable or empty at ${liveWorkerLogPath()}>`);
  return parts.join('\n');
}

module.exports = {
  liveQueueDir,
  liveWorkerLogPath,
  rotateWorkerLog,
  excerptWorkerLog,
  describeWorkerProcess,
  isBlenderWorkerAlive,
  describeVanishedRequest,
  redactCredentials,
  setStoredPidResolver
};
