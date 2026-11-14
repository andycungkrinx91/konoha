'use strict';

/**
 * tests/helpers/seed_lifecycle.js
 *
 * Golden seed concurrency locking, reader leases, extended asset/lockfile
 * fingerprinting, and liveness-checked temporary directory cleanup for
 * host-isolated and CI/container test runner execution.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LEASE_SUBDIR = '.konoha_leases';
const SUITE_META_FILE = '.konoha_suite_meta.json';
const MAX_RETAINED_SEEDS = 1;
const LOCK_POLL_MS = 250;
const LOCK_WAIT_DEFAULT_MS = 600000;
const SLEEP_ARR = new Int32Array(new SharedArrayBuffer(4));

function _sleepSync(ms) {
  Atomics.wait(SLEEP_ARR, 0, 0, Math.max(1, ms));
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function _updateFileHash(hash, relPath, fullPath) {
  hash.update(relPath);
  try {
    hash.update(fs.readFileSync(fullPath));
  } catch (_) {
    /* unreadable file still contributes its relative path */
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint across code, scripts, runtime
 * assets (WASM grammars), lockfile/manifest, and the built Web UI bundle.
 *
 * @param {string} root
 * @returns {string}
 */
function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') continue;
      if (entry.name === LEASE_SUBDIR || entry.name === SUITE_META_FILE) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        _updateFileHash(hash, path.relative(root, full), full);
      }
    }
  };

  for (const sub of ['src', 'bin', 'scripts', 'assets']) {
    walk(path.join(root, sub));
  }

  for (const rel of ['package.json', 'pnpm-lock.yaml', path.join('apps', 'web', 'build', 'index.js'), path.join('apps', 'web', 'build', 'build-meta.json')]) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) _updateFileHash(hash, rel, full);
  }

  // When checksumming `.konoha` itself, include top-level runtime entrypoints (e.g. server.js).
  if (path.basename(root) === '.konoha') {
    for (const rel of ['server.js']) {
      const full = path.join(root, rel);
      if (fs.existsSync(full)) _updateFileHash(hash, rel, full);
    }
  }

  return hash.digest('hex');
}

function getBuildLockPath(seedDir) {
  return `${path.resolve(seedDir)}.build.lock`;
}

function _readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Acquires an exclusive O_CREAT|O_EXCL sibling build lock for a seed directory.
 * Reaps dead owner locks (ESRCH); waits bounded time for live concurrent builders.
 *
 * @param {string} seedDir
 * @param {number} [waitMs]
 * @returns {{ lockPath: string }}
 */
function acquireSeedBuildLock(seedDir, waitMs = Number(process.env.KONOHA_SEED_LOCK_WAIT_MS) || LOCK_WAIT_DEFAULT_MS) {
  const lockPath = getBuildLockPath(seedDir);
  const lockParent = path.dirname(lockPath);
  if (lockParent && !fs.existsSync(lockParent)) {
    fs.mkdirSync(lockParent, { recursive: true });
  }
  const deadline = Date.now() + Math.max(0, waitMs);

  while (true) {
    try {
      const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
      fs.writeFileSync(lockPath, payload, { flag: 'wx', encoding: 'utf8' });
      return { lockPath };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      const meta = _readJsonSafe(lockPath);
      const ownerPid = meta && meta.pid;
      if (ownerPid && !isPidAlive(ownerPid)) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
        continue;
      }
      if (!ownerPid) {
        let stat = null;
        try { stat = fs.statSync(lockPath); } catch { stat = null; }
        // Corrupt empty lock older than 5s can be safely reaped; fresh ones may still be writing.
        if (!stat || Date.now() - stat.mtimeMs > 5000) {
          try { fs.unlinkSync(lockPath); } catch (_) {}
          continue;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(`[SEED] Timed out waiting for build lock ${lockPath} held by PID ${ownerPid || 'unknown'}`);
      }
      _sleepSync(LOCK_POLL_MS);
    }
  }
}

function releaseSeedBuildLock(lockPath) {
  if (!lockPath) return;
  const meta = _readJsonSafe(lockPath);
  if (meta && meta.pid && Number(meta.pid) !== process.pid && isPidAlive(meta.pid)) return;
  try {
    fs.unlinkSync(lockPath);
  } catch (_) {}
}

function acquireSeedLease(seedDir) {
  const leaseDir = path.join(seedDir, LEASE_SUBDIR);
  fs.mkdirSync(leaseDir, { recursive: true });
  const nonce = crypto.randomBytes(4).toString('hex');
  const leasePath = path.join(leaseDir, `${process.pid}_${nonce}.json`);
  fs.writeFileSync(leasePath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
  return leasePath;
}

function releaseSeedLease(leasePath) {
  if (!leasePath) return;
  try {
    fs.unlinkSync(leasePath);
  } catch (_) {}
}

/**
 * Reaps dead PID lease files and returns active live lease PIDs.
 * @param {string} seedDir
 * @param {string|null} [excludeLeasePath]
 * @returns {number[]}
 */
function reapDeadLeases(seedDir, excludeLeasePath = null) {
  const leaseDir = path.join(seedDir, LEASE_SUBDIR);
  if (!fs.existsSync(leaseDir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(leaseDir);
  } catch {
    return [];
  }
  const activePids = [];
  const excluded = excludeLeasePath ? path.resolve(excludeLeasePath) : null;

  for (const name of entries) {
    const full = path.join(leaseDir, name);
    if (excluded && path.resolve(full) === excluded) continue;
    const meta = _readJsonSafe(full);
    if (meta && isPidAlive(meta.pid)) {
      activePids.push(Number(meta.pid));
    } else {
      try { fs.unlinkSync(full); } catch (_) {}
    }
  }
  return activePids;
}

function isSeedInUse(seedDir, excludeLeasePath = null) {
  const lockPath = getBuildLockPath(seedDir);
  if (fs.existsSync(lockPath)) {
    const lockMeta = _readJsonSafe(lockPath);
    if (lockMeta && isPidAlive(lockMeta.pid)) return true;
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
  return reapDeadLeases(seedDir, excludeLeasePath).length > 0;
}

function writeSuiteMeta(suiteHome, meta) {
  try {
    fs.writeFileSync(
      path.join(suiteHome, SUITE_META_FILE),
      JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }),
      'utf8'
    );
  } catch (_) {}
}

function readSuiteMeta(suiteHome) {
  return _readJsonSafe(path.join(suiteHome, SUITE_META_FILE));
}

function cleanupSuiteDir(suiteHome, label = '') {
  if (!suiteHome) return true;
  try {
    fs.rmSync(suiteHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return !fs.existsSync(suiteHome);
  } catch (err) {
    const tag = label ? ` (${label})` : '';
    console.warn(`[CLEANUP WARN] Could not remove ${suiteHome}${tag}: ${err.message}`);
    return false;
  }
}

/**
 * Reaps stale `konoha_suite_*` directories left by killed/crashed runners only
 * after confirming both runnerPid and childPid are dead (ESRCH).
 */
function pruneStaleSuiteDirs(tmpDir = os.tmpdir()) {
  const removed = [];
  const skippedLive = [];
  const skippedAmbiguous = [];
  let entries = [];
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { removed, skippedLive, skippedAmbiguous };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('konoha_suite_')) continue;
    const full = path.join(tmpDir, entry.name);
    const meta = readSuiteMeta(full);
    if (!meta || !meta.runnerPid) {
      skippedAmbiguous.push(full);
      continue;
    }
    if (isPidAlive(meta.runnerPid) || (meta.childPid && isPidAlive(meta.childPid))) {
      skippedLive.push(full);
      continue;
    }
    if (cleanupSuiteDir(full, 'stale-sweep')) {
      removed.push(full);
    } else {
      skippedLive.push(full);
    }
  }
  return { removed, skippedLive, skippedAmbiguous };
}

/**
 * Applies deterministic seed retention policy across `os.tmpdir()/konoha_golden_seed*`
 * (and reaps orphaned dead `.build.lock` files). Never touches unrecognized
 * non-empty directories or seeds held by a live builder/reader.
 */
function pruneSeeds({
  tmpDir = os.tmpdir(),
  seedIsComplete,
  seedIsCurrent,
  removeAllCurrent = false,
  excludeLeasePath = null
}) {
  const removed = [];
  const retained = [];
  const skippedActive = [];
  let entries = [];
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { removed, retained, skippedActive };
  }

  // Reap dead build locks in tmpDir even if their directory is already gone.
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('konoha_golden_seed') && entry.name.endsWith('.build.lock')) {
      const lockPath = path.join(tmpDir, entry.name);
      const meta = _readJsonSafe(lockPath);
      if (meta && !isPidAlive(meta.pid)) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
      }
    }
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('konoha_golden_seed'))
    .map((e) => {
      const full = path.join(tmpDir, e.name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch { mtimeMs = 0; }
      return { dir: full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let currentKept = 0;
  for (const item of dirs) {
    const dir = item.dir;
    if (isSeedInUse(dir, excludeLeasePath)) {
      skippedActive.push(dir);
      retained.push(dir);
      continue;
    }
    const complete = seedIsComplete(dir);
    const current = complete && seedIsCurrent(dir);
    const keepLimit = removeAllCurrent ? 0 : MAX_RETAINED_SEEDS;

    if (current && currentKept < keepLimit) {
      currentKept++;
      retained.push(dir);
      continue;
    }

    // Remove stale (!current), incomplete dead-locked (!complete), or excess duplicate seeds.
    if (cleanupSuiteDir(dir, current ? 'duplicate-seed' : complete ? 'stale-seed' : 'incomplete-seed')) {
      removed.push(dir);
    } else {
      retained.push(dir);
    }
  }

  return { removed, retained, skippedActive };
}

module.exports = {
  LEASE_SUBDIR,
  SUITE_META_FILE,
  MAX_RETAINED_SEEDS,
  isPidAlive,
  sourceFingerprint,
  getBuildLockPath,
  acquireSeedBuildLock,
  releaseSeedBuildLock,
  acquireSeedLease,
  releaseSeedLease,
  reapDeadLeases,
  isSeedInUse,
  writeSuiteMeta,
  readSuiteMeta,
  cleanupSuiteDir,
  pruneStaleSuiteDirs,
  pruneSeeds
};
