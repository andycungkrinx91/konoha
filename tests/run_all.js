#!/usr/bin/env node
/**
 * Konoha comprehensive test suite runner (pure Node.js runtime).
 * Discovers and runs all JS test suites in the tests/ directory with strict
 * container, CI, or Option H1 host-isolated sandbox guarantees.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');
const { assertMaintenanceSandbox, HOST_ISOLATED_MARKER } = require('./helpers/sandbox_guard');
const {
  sourceFingerprint,
  acquireSeedBuildLock,
  releaseSeedBuildLock,
  acquireSeedLease,
  releaseSeedLease,
  writeSuiteMeta,
  cleanupSuiteDir,
  pruneStaleSuiteDirs,
  pruneSeeds
} = require('./helpers/seed_lifecycle');

const SEED_SOURCE_ROOT = path.join(__dirname, '..');
const WEB_BUILD_INDEX = path.join(SEED_SOURCE_ROOT, 'apps', 'web', 'build', 'index.js');
const EXPLICIT_SEED_DIR = process.env.KONOHA_SEED_DIR ? path.resolve(process.env.KONOHA_SEED_DIR) : null;

const isCleanupSeed = process.argv.includes('--cleanup-seed');
const isPruneStale = process.argv.includes('--prune-stale');
const isSeedOnly = process.argv.includes('--seed-only');
const keepFailedSnapshot = process.argv.includes('--keep-failed-snapshot');
const includePython = process.argv.includes('--include-python');
const isParallel = process.argv.includes('--parallel') || process.env.KONOHA_TEST_PARALLEL === '1';
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 4;
const shardArg = process.argv.find((a) => a.startsWith('--shard='));
const shardValue = shardArg ? shardArg.split('=')[1] : process.env.KONOHA_TEST_SHARD;
const { selectShard, parseShard } = require('./helpers/shard');
const filterArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

const webBuildExists = fs.existsSync(WEB_BUILD_INDEX);
const isHostMaintenance = isCleanupSeed || isPruneStale;
if (!isHostMaintenance && !webBuildExists && process.env.CI !== 'true' && process.env.KONOHA_SANDBOX_CONTAINER !== '1') {
  console.error("Missing apps/web/build/index.js — run 'rtk pnpm build:web' before executing host-isolated tests.");
  process.exit(1);
}

const guardResult = assertMaintenanceSandbox(process.env, {
  hostRunner: true,
  runnerPath: __filename,
  seedIsolated: true,
  suiteSnapshotsIsolated: true,
  webBuildFresh: webBuildExists || isHostMaintenance
});
const GUARD_MODE = guardResult.mode;

const SEED_SENTINELS = [
  ['.konoha', 'konoha.db'],
  ['.konoha', 'server.js'],
  ['.konoha', '.autosetup-done'],
  ['.agents', 'skills', 'konoha', 'SKILL.md']
];

function seedIsComplete(dir) {
  return SEED_SENTINELS.every((parts) => fs.existsSync(path.join(dir, ...parts)));
}

function seedIsCurrent(dir) {
  if (!seedIsComplete(dir)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.konoha', '.auto_setup_state.json'), 'utf8'));
    return Boolean(state) &&
      state.version === require('../package.json').version &&
      state.sourceFingerprint === sourceFingerprint(SEED_SOURCE_ROOT) &&
      state.copiedFingerprint === sourceFingerprint(path.join(dir, '.konoha'));
  } catch (_) {
    return false;
  }
}

let goldenSeedInfo = null;
let activeSeedLeasePath = null;
let activeBuildLockPath = null;
let activeBuildingSeedDir = null;
let shuttingDown = false;
const activeSuites = new Map();

function _terminateChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch (_) {}
}

function _onTerminationSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const sigCode = signal === 'SIGINT' ? 130 : 143;
  console.error(`\n[SIGNAL] Received ${signal}; terminating ${activeSuites.size} active suite(s) and cleaning temp snapshots...`);
  for (const entry of activeSuites.values()) {
    _terminateChild(entry.child);
    cleanupSuiteDir(entry.suiteHome, `${entry.name} (${signal})`);
  }
  activeSuites.clear();
  releaseSeedLease(activeSeedLeasePath);
  if (activeBuildingSeedDir && !EXPLICIT_SEED_DIR && !seedIsComplete(activeBuildingSeedDir)) {
    cleanupSuiteDir(activeBuildingSeedDir, 'interrupted-seed-build');
  }
  releaseSeedBuildLock(activeBuildLockPath);
  process.exit(sigCode);
}

process.on('SIGINT', () => _onTerminationSignal('SIGINT'));
process.on('SIGTERM', () => _onTerminationSignal('SIGTERM'));

if (isCleanupSeed || isPruneStale) {
  const suiteSweep = pruneStaleSuiteDirs(os.tmpdir());
  const seedSweep = pruneSeeds({
    tmpDir: os.tmpdir(),
    seedIsComplete,
    seedIsCurrent,
    removeAllCurrent: isCleanupSeed
  });
  console.log(`[CLEANUP] Stale suites removed: ${suiteSweep.removed.length}, skipped-live: ${suiteSweep.skippedLive.length}, ambiguous: ${suiteSweep.skippedAmbiguous.length}`);
  console.log(`[CLEANUP] Seeds removed: ${seedSweep.removed.length}, retained: ${seedSweep.retained.length}, skipped-active: ${seedSweep.skippedActive.length}`);
  for (const s of suiteSweep.skippedLive) console.log(`  [ACTIVE/LOCKED SUITE] ${s}`);
  for (const s of seedSweep.skippedActive) console.log(`  [ACTIVE/LOCKED SEED] ${s}`);
  process.exit(0);
}

function candidateSeeds() {
  let names = [];
  try { names = fs.readdirSync(os.tmpdir()); } catch { names = []; }
  const scanned = names
    .filter((n) => n.startsWith('konoha_golden_seed'))
    .map((n) => path.join(os.tmpdir(), n))
    .filter((dir) => {
      try { return fs.statSync(dir).isDirectory(); } catch { return false; }
    })
    .sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    });
  return EXPLICIT_SEED_DIR ? [EXPLICIT_SEED_DIR] : scanned;
}

function prepareSeedTarget() {
  if (!EXPLICIT_SEED_DIR) return { seedDir: fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_golden_seed_')), ownedNew: true };
  if (fs.existsSync(EXPLICIT_SEED_DIR)) {
    if (!seedIsComplete(EXPLICIT_SEED_DIR) && fs.readdirSync(EXPLICIT_SEED_DIR).length > 0) {
      throw new Error(
        `[SEED] KONOHA_SEED_DIR=${EXPLICIT_SEED_DIR} is neither empty nor a complete seed; refusing to overwrite it. `
        + 'Remove it yourself if it is a half-built seed from an interrupted run.'
      );
    }
    fs.rmSync(EXPLICIT_SEED_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXPLICIT_SEED_DIR, { recursive: true });
  return { seedDir: EXPLICIT_SEED_DIR, ownedNew: false };
}

function ensureSeedNodeModules(seedDir) {
  const link = path.join(seedDir, '.konoha', 'node_modules');
  const target = path.join(__dirname, '..', 'node_modules');
  if (!fs.existsSync(target)) return;
  let stat = null;
  try { stat = fs.lstatSync(link); } catch { /* absent */ }
  if (stat && stat.isSymbolicLink()) {
    try { if (fs.realpathSync(link) === fs.realpathSync(target)) return; } catch { /* dangling */ }
  }
  if (stat) fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function stampSourceFingerprint(seedDir) {
  try {
    const stateFile = path.join(seedDir, '.konoha', '.auto_setup_state.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const copied = path.join(seedDir, '.konoha');
    state.version = require('../package.json').version;
    state.sourceFingerprint = sourceFingerprint(SEED_SOURCE_ROOT);
    state.copiedFingerprint = sourceFingerprint(copied);
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
  } catch { /* missing stamp costs one rebuild */ }
}

function getGoldenSeed() {
  if (goldenSeedInfo) return goldenSeedInfo;
  for (const dir of candidateSeeds()) {
    if (seedIsCurrent(dir)) {
      ensureSeedNodeModules(dir);
      if (!isSeedOnly) activeSeedLeasePath = acquireSeedLease(dir);
      goldenSeedInfo = { dir };
      return goldenSeedInfo;
    }
  }

  const { seedDir, ownedNew } = prepareSeedTarget();
  const lock = acquireSeedBuildLock(seedDir);
  activeBuildLockPath = lock.lockPath;
  activeBuildingSeedDir = ownedNew ? seedDir : null;

  try {
    if (seedIsCurrent(seedDir)) {
      ensureSeedNodeModules(seedDir);
      if (!isSeedOnly) activeSeedLeasePath = acquireSeedLease(seedDir);
      goldenSeedInfo = { dir: seedDir };
      return goldenSeedInfo;
    }

    console.log(`[SEED] Building golden seed in ${seedDir} (first-run init, can take several minutes) ...`);
    const seedStart = Date.now();
    const env = {
      ...process.env,
      HOME: seedDir,
      USERPROFILE: seedDir,
      KONOHA_DB_PATH: path.join(seedDir, '.konoha', 'konoha.db'),
      KONOHA_BOOTSTRAP_PASSWORD: process.env.KONOHA_BOOTSTRAP_PASSWORD || 'konohagakure'
    };
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'init', '--yes'], {
      cwd: seedDir,
      env,
      encoding: 'utf-8',
      timeout: 3600000
    });
    const seedElapsed = ((Date.now() - seedStart) / 1000).toFixed(1);
    if (!seedIsComplete(seedDir)) {
      throw new Error(`[SEED] init did not produce a complete seed in ${seedElapsed}s (status ${res.status}). ${(res.stderr || '').trim().split('\n').slice(-5).join(' | ')}`);
    }
    stampSourceFingerprint(seedDir);
    console.log(`[SEED] Golden seed ready (${seedElapsed}s)`);
    if (!isSeedOnly) activeSeedLeasePath = acquireSeedLease(seedDir);
    goldenSeedInfo = { dir: seedDir };
    return goldenSeedInfo;
  } catch (err) {
    if (ownedNew) cleanupSuiteDir(seedDir, 'failed-seed-build');
    throw err;
  } finally {
    activeBuildingSeedDir = null;
    releaseSeedBuildLock(lock.lockPath);
    activeBuildLockPath = null;
  }
}

function copySeedDir(seedDir, suiteHome) {
  const src = `${seedDir}/.`;
  const dest = `${suiteHome}/`;
  const attempts = [
    ['cp', '-a', '--reflink=auto', '--no-preserve=ownership', src, dest],
    ['cp', '-a', '--no-preserve=ownership', src, dest],
    ['cp', '-a', src, dest],
    ['cp', '-r', '--no-preserve=ownership', src, dest],
    ['cp', '-r', src, dest],
  ];
  for (const args of attempts) {
    const res = spawnSync(args[0], args.slice(1), { encoding: 'utf-8' });
    if (res.status === 0 && !res.error) {
      ensureSeedNodeModules(suiteHome);
      return;
    }
  }
  const linkDir = path.join('.konoha', 'node_modules');
  fs.cpSync(seedDir, suiteHome, {
    recursive: true,
    filter: (from) => {
      const rel = path.relative(seedDir, from);
      return rel !== linkDir && !rel.startsWith(`${linkDir}${path.sep}`);
    }
  });
  ensureSeedNodeModules(suiteHome);
}

function createSuiteSnapshot(name) {
  const seed = getGoldenSeed();
  const suiteHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_suite_'));
  copySeedDir(seed.dir, suiteHome);
  writeSuiteMeta(suiteHome, { runnerPid: process.pid, childPid: null, suite: name, createdAt: new Date().toISOString() });

  const konohaModules = path.join(suiteHome, '.konoha', 'node_modules');
  const existingNodePath = process.env.NODE_PATH || '';
  const suiteNodePath = existingNodePath ? `${konohaModules}${path.delimiter}${existingNodePath}` : konohaModules;
  const realHome = (() => {
    try { return os.userInfo().homedir; } catch (_) { return os.homedir(); }
  })();

  const env = {
    ...process.env,
    HOME: suiteHome,
    USERPROFILE: suiteHome,
    KONOHA_DB_PATH: path.join(suiteHome, '.konoha', 'konoha.db'),
    PYTHONUSERBASE: process.env.PYTHONUSERBASE || path.join(realHome, '.local'),
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(realHome, '.cache', 'ms-playwright'),
    KONOHA_TEST_SANDBOX: '1',
    ...(GUARD_MODE === 'host-isolated' ? { [HOST_ISOLATED_MARKER]: '1' } : {}),
    NODE_PATH: suiteNodePath
  };

  return {
    home: suiteHome,
    env,
    cleanup: (ok) => {
      if (!ok && keepFailedSnapshot) {
        console.warn(`[SNAPSHOT KEPT] Failed suite '${name}' preserved at: ${suiteHome}`);
        return;
      }
      cleanupSuiteDir(suiteHome, name);
    }
  };
}

function warmSeed() {
  try {
    return getGoldenSeed();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (isSeedOnly) {
  const seed = warmSeed();
  console.log(`[SEED] ${seed.dir}`);
  process.exit(0);
}

// Reap stale suites from prior killed runs only after proving owner PIDs are dead.
pruneStaleSuiteDirs(os.tmpdir());

const testsDir = __dirname;
const files = fs.readdirSync(testsDir);
const UNRELEASED_PREFIXES = ['test_yamanaka_'];
const isUnreleased = (f) => UNRELEASED_PREFIXES.some((p) => f.startsWith(p));

let jsTests = files.filter((f) =>
  (f.endsWith('.test.js') || f.startsWith('test_') || f.startsWith('verify_')) &&
  f.endsWith('.js') &&
  f !== 'run_all.js' &&
  (filterArg ? f.toLowerCase().includes(filterArg.toLowerCase()) : !isUnreleased(f))
).sort();

if (shardValue) {
  let shard = null;
  try { shard = parseShard(shardValue); } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const discovered = jsTests.length;
  jsTests = selectShard(jsTests, shard.index, shard.count);
  if (jsTests.length === 0) {
    console.error(`[SHARD] ${shard.index}/${shard.count} selected 0 of ${discovered} suites; refusing to report an empty shard as passing.`);
    process.exit(2);
  }
  console.log(`[SHARD] ${shard.index}/${shard.count}: ${jsTests.length} of ${discovered} suites`);
}

const pyTests = includePython ? files.filter((f) =>
  f.startsWith('test_') && f.endsWith('.py') &&
  (!filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
).sort() : [];

console.log('====================================================');
console.log(`       KONOHA TEST SUITE RUNNER (${GUARD_MODE})     `);
console.log('====================================================');
console.log(`Discovered ${jsTests.length} JS test suites${includePython ? ` and ${pyTests.length} Python suites` : ''} (${isParallel ? `parallel mode, concurrency ${concurrency}` : 'sequential mode'}).\n`);
const unreleased = filterArg ? [] : files.filter((f) => f.startsWith('test_') && f.endsWith('.js') && isUnreleased(f)).sort();
if (unreleased.length > 0) {
  console.log(`Not run: ${unreleased.length} suite(s) for unreleased features (${UNRELEASED_PREFIXES.join(',')})`);
  for (const s of unreleased) console.log(`  - ${s}`);
  console.log('');
}

let passed = 0;
let failed = 0;
const failList = [];
const seedWarmStart = Date.now();
warmSeed();
console.log(`[SEED] Seed check: ${((Date.now() - seedWarmStart) / 1000).toFixed(1)}s\n`);
const startTime = Date.now();

function runSuiteSync(cmd, args, name) {
  if (shuttingDown) return;
  process.stdout.write(`[SUITE] Running: ${name} ... `);
  const snapshot = createSuiteSnapshot(name);
  const token = `${name}_${Date.now()}`;
  activeSuites.set(token, { name, suiteHome: snapshot.home, child: null });
  const start = Date.now();
  let ok = false;
  try {
    const res = spawnSync(cmd, args, { encoding: 'utf-8', env: snapshot.env });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    ok = res.status === 0;
    if (ok) {
      console.log(`PASS (${elapsed}s)`);
      passed++;
    } else {
      console.log(`FAIL (exit code ${res.status})`);
      if (res.stdout) console.log(res.stdout);
      if (res.stderr) console.error(res.stderr);
      failed++;
      failList.push(name);
    }
  } finally {
    activeSuites.delete(token);
    snapshot.cleanup(ok);
  }
}

function runSuiteAsync(cmd, args, name) {
  if (shuttingDown) return Promise.resolve();
  return new Promise((resolve) => {
    const snapshot = createSuiteSnapshot(name);
    const start = Date.now();
    const child = spawn(cmd, args, { env: snapshot.env });
    const token = `${name}_${child.pid || Date.now()}`;
    activeSuites.set(token, { name, suiteHome: snapshot.home, child });
    writeSuiteMeta(snapshot.home, { runnerPid: process.pid, childPid: child.pid || null, suite: name, createdAt: new Date().toISOString() });

    let out = '';
    let err = '';
    let settled = false;
    const suiteTimeoutMs = Number(process.env.KONOHA_TEST_TIMEOUT) || 3600000;
    const timer = setTimeout(() => {
      if (!settled) {
        err += `\n[TIMEOUT] Suite ${name} timed out after ${suiteTimeoutMs / 1000}s and was terminated.`;
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }, suiteTimeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeSuites.delete(token);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const ok = status === 0;
      if (ok) {
        console.log(`[SUITE] Running: ${name} ... PASS (${elapsed}s)`);
        passed++;
      } else {
        console.log(`[SUITE] Running: ${name} ... FAIL (exit code ${status})`);
        if (out) console.log(out);
        if (err) console.error(err);
        failed++;
        failList.push(name);
      }
      snapshot.cleanup(ok);
      resolve();
    };

    child.on('close', (status) => settle(status));
    child.on('error', (e) => {
      err += `\n[SPAWN ERROR] ${e && e.message ? e.message : e}`;
      settle(1);
    });
  });
}

async function runAllParallel() {
  const isSequential = (f) => f.includes('_attribution.') || f === 'test_akatsuki_lab_isolation.js' || f === 'test_akatsuki_skill_authz_db_isolation.js' || f === 'test_akatsuki_init.js' || f === 'test_akatsuki_security_centralization.js' || f === 'test_vector_search.js';
  const parallelPool = jsTests.filter((f) => !isSequential(f));
  const sequentialPool = jsTests.filter((f) => isSequential(f));

  let index = 0;
  async function worker() {
    while (!shuttingDown && index < parallelPool.length) {
      const f = parallelPool[index++];
      await runSuiteAsync(process.execPath, [path.join(testsDir, f)], f);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  for (const f of sequentialPool) {
    if (shuttingDown) break;
    runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
  }
  if (includePython) {
    for (const f of pyTests) {
      if (shuttingDown) break;
      runSuiteSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(testsDir, f)], f);
    }
  }
  finish();
}

function finish() {
  releaseSeedLease(activeSeedLeasePath);
  activeSeedLeasePath = null;
  const seedSweep = pruneSeeds({ tmpDir: os.tmpdir(), seedIsComplete, seedIsCurrent, removeAllCurrent: false });
  if (seedSweep.removed.length > 0) {
    console.log(`[CLEANUP] Pruned ${seedSweep.removed.length} stale/excess seed(s); retained ${seedSweep.retained.length}.`);
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed in ${totalDuration}s.`);
  if (failed > 0) {
    console.error(`Failed suites: ${failList.join(', ')}`);
    process.exit(1);
  } else {
    console.log('All test suites completed successfully!');
    process.exit(0);
  }
}

if (isParallel) {
  runAllParallel();
} else {
  for (const f of jsTests) {
    if (shuttingDown) break;
    runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
  }
  if (includePython) {
    for (const f of pyTests) {
      if (shuttingDown) break;
      runSuiteSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(testsDir, f)], f);
    }
  }
  finish();
}
