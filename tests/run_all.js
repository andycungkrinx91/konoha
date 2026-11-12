#!/usr/bin/env node
/**
 * Konoha comprehensive test suite runner (pure Node.js runtime).
 * Discovers and runs all JS test suites in the tests/ directory.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

let goldenSeedInfo = null;
const SEED_SOURCE_ROOT = path.join(__dirname, '..');

function sourceFingerprint(root) {
  // Version alone is not enough: the seed embeds a byte-copy of the CLI tree, so
  // any edit between seed creation and reuse makes test_runtime_mirror_parity
  // report phantom divergence. Hash the tree that is actually under test.
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        hash.update(path.relative(root, full));
        try { hash.update(fs.readFileSync(full)); } catch { /* unreadable file, name still counts */ }
      }
    }
  };
  for (const sub of ['src', 'bin', 'scripts']) walk(path.join(root, sub));
  return hash.digest('hex');
}

// A seed is only reusable when the init actually finished: every artifact the
// suites depend on must exist. `.auto_setup_state.json` is deliberately absent
// here: only `konoha doctor` runs ensureAutoSetup() (bin/cli.js), so `init
// --yes` never writes it and requiring it forces a full rebuild every run.
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

// CI restores a persistent seed from a cache and points KONOHA_SEED_DIR at it.
// That directory is checked first so a cache hit never depends on tmpdir naming.
const EXPLICIT_SEED_DIR = process.env.KONOHA_SEED_DIR ? path.resolve(process.env.KONOHA_SEED_DIR) : null;

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
  // When CI names the seed directory it is the only candidate: silently reusing
  // an unrelated tmpdir seed would leave the cached path empty and pay the
  // rebuild again on the next run.
  return EXPLICIT_SEED_DIR ? [EXPLICIT_SEED_DIR] : scanned;
}

function prepareExplicitSeedDir() {
  // Only a directory this runner owns is ever wiped: an empty one (cache miss)
  // or a complete-but-stale seed. Anything else is refused rather than deleted.
  if (!EXPLICIT_SEED_DIR) return fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_golden_seed_'));
  if (fs.existsSync(EXPLICIT_SEED_DIR)) {
    if (!seedIsComplete(EXPLICIT_SEED_DIR) && fs.readdirSync(EXPLICIT_SEED_DIR).length > 0) {
      throw new Error(`[SEED] KONOHA_SEED_DIR=${EXPLICIT_SEED_DIR} is neither empty nor a seed directory; refusing to overwrite it.`);
    }
    fs.rmSync(EXPLICIT_SEED_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(EXPLICIT_SEED_DIR, { recursive: true });
  return EXPLICIT_SEED_DIR;
}

// `.konoha/node_modules` is a link into the checkout's node_modules, and it is
// the one thing in the seed a cache round-trip can mangle: tar either drops it
// or materializes the whole tree, which would then be copied into every suite
// snapshot. Re-point it at the checkout before the seed is used.
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

function getGoldenSeed() {
  if (goldenSeedInfo) return goldenSeedInfo;
  for (const dir of candidateSeeds()) {
    if (seedIsCurrent(dir)) {
      ensureSeedNodeModules(dir);
      goldenSeedInfo = { dir };
      return goldenSeedInfo;
    }
  }
  const seedDir = prepareExplicitSeedDir();
  // The init is silent for minutes on slow filesystems; without this line a
  // stalled seed build looks identical to a hung runner.
  console.log(`[SEED] Building golden seed in ${seedDir} (first-run init, can take several minutes) ...`);
  const seedStart = Date.now();
  const env = {
    ...process.env,
    HOME: seedDir,
    // os.homedir() reads USERPROFILE on win32 and ignores HOME, so a suite that
    // calls it would escape the sandbox and touch the real profile.
    USERPROFILE: seedDir,
    KONOHA_DB_PATH: path.join(seedDir, '.konoha', 'konoha.db'),
    KONOHA_UI_AUTOSTART: '0',
    KONOHA_BOOTSTRAP_PASSWORD: process.env.KONOHA_BOOTSTRAP_PASSWORD || 'konohagakure'
  };
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'init', '--yes'], {
    cwd: seedDir,
    env,
    encoding: 'utf-8',
    // First-run initialization on a clean HOME can take several minutes
    timeout: 3600000
  });
  const seedElapsed = ((Date.now() - seedStart) / 1000).toFixed(1);
  if (!seedIsComplete(seedDir)) {
    // A partial seed is rejected by seedIsCurrent anyway; failing here points
    // at the init instead of surfacing as 279 identical suite failures.
    throw new Error(`[SEED] init did not produce a complete seed in ${seedElapsed}s (status ${res.status}). ${(res.stderr || '').trim().split('\n').slice(-5).join(' | ')}`);
  }
  // Stamped after the check: `konoha init` never writes this state file (see
  // SEED_SENTINELS), so the seed's own freshness record is created here.
  stampSourceFingerprint(seedDir);
  console.log(`[SEED] Golden seed ready (${seedElapsed}s)`);
  goldenSeedInfo = { dir: seedDir };
  return goldenSeedInfo;
}

function stampSourceFingerprint(seedDir) {
  try {
    const stateFile = path.join(seedDir, '.konoha', '.auto_setup_state.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    // sourceFingerprint: the repo tree this seed was built from.
    // copiedFingerprint: the tree the seed actually wrote, so a partial or
    // externally-modified seed cannot be blessed as current.
    const copied = path.join(seedDir, '.konoha');
    // The init may skip ensureAutoSetup, leaving no state file behind; the seed
    // is still valid, but only if the version is stamped here as well.
    state.version = require('../package.json').version;
    state.sourceFingerprint = sourceFingerprint(SEED_SOURCE_ROOT);
    state.copiedFingerprint = sourceFingerprint(copied);
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
  } catch { /* a missing stamp only costs one extra seed rebuild */ }
}

function copySeedDir(seedDir, suiteHome) {
  // `cp -a` preserves ownership, which fails with EPERM in sandboxes where
  // the seed files' uid/gid cannot be reproduced ("failed to preserve
  // ownership ... Operation not permitted"). Dropping ownership preservation
  // keeps the copy identical in content. The plain `cp -a` attempts stay in
  // the chain for systems without GNU --no-preserve (macOS/BSD cp rejects
  // the flag) and for environments where chown works.
  // `fs.cpSync` stays last: it is the only fallback when no `cp` exists
  // (Windows), and it only works on a fresh destination — a previous
  // partial copy leaves `.konoha/node_modules` as a symlink into the repo
  // tree, which cpSync resolves and then refuses to copy into itself
  // (ERR_FS_CP_EINVAL). The `cp -r` step below succeeds in exactly that
  // state, so cpSync is only reached when `cp` itself is unavailable.
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
  // `cp -a` preserves `.konoha/node_modules` as a link in one syscall; cpSync
  // has to resolve or recreate it, and on Windows recreating a symlink needs a
  // privilege the runner does not have — so it walks the ~36k-file
  // node_modules tree instead. That walk, once per suite with four suites
  // running, is the bulk of a Windows run. Copy everything else and rebuild
  // the link as a junction (unprivileged on Windows) afterwards.
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

  const konohaModules = path.join(suiteHome, '.konoha', 'node_modules');
  const existingNodePath = process.env.NODE_PATH || '';
  const suiteNodePath = existingNodePath ? `${konohaModules}${path.delimiter}${existingNodePath}` : konohaModules;

  const realUserBase = (() => {
    try {
      return path.join(os.userInfo().homedir, '.local');
    } catch (_) {
      return path.join(os.homedir(), '.local');
    }
  })();

  const realPlaywrightPath = (() => {
    try {
      return path.join(os.userInfo().homedir, '.cache', 'ms-playwright');
    } catch (_) {
      return path.join(os.homedir(), '.cache', 'ms-playwright');
    }
  })();

  const env = {
    ...process.env,
    HOME: suiteHome,
    // Mirrors the seed env: without this, os.homedir() on win32 resolves to the
    // real profile while the product reads HOME, so paths diverge mid-suite.
    USERPROFILE: suiteHome,
    KONOHA_DB_PATH: path.join(suiteHome, '.konoha', 'konoha.db'),
    KONOHA_UI_AUTOSTART: '0',
    PYTHONUSERBASE: process.env.PYTHONUSERBASE || realUserBase,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || realPlaywrightPath,
    KONOHA_TEST_SANDBOX: '1',
    NODE_PATH: suiteNodePath
  };

  if (name === 'test_ui_autostart.js') {
    delete env.KONOHA_UI_AUTOSTART;
  }

  return {
    home: suiteHome,
    env,
    cleanup: () => {
      try {
        fs.rmSync(suiteHome, { recursive: true, force: true });
      } catch (_) {}
    }
  };
}

// CI builds the seed in its own step so the ~4 minute first-run init is cached
// across runs instead of landing inside whichever suite happens to start first.
if (process.argv.includes('--seed-only')) {
  const seed = getGoldenSeed();
  console.log(`[SEED] ${seed.dir}`);
  process.exit(0);
}

const testsDir = __dirname;
const files = fs.readdirSync(testsDir);
const includePython = process.argv.includes('--include-python');
const isParallel = process.argv.includes('--parallel') || process.env.KONOHA_TEST_PARALLEL === '1';
const concurrencyArg = process.argv.find(a => a.startsWith('--concurrency='));
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 4;
const shardArg = process.argv.find(a => a.startsWith('--shard='));
const filterArg = process.argv.slice(2).find(a => !a.startsWith('--'));
// Comma-separated filename substrings to skip. Local CI mirrors that cannot run a
// subsystem (no GPU, no Blender, no Windows guest driver) set this instead of
// deleting suites, so the GitHub workflow keeps covering them.
const excludePatterns = (process.env.KONOHA_TEST_EXCLUDE || '')
  .split(',')
  .map(p => p.trim().toLowerCase())
  .filter(Boolean);
const isExcluded = f => excludePatterns.some(p => f.toLowerCase().includes(p));

let jsTests = files.filter(f =>
  (f.endsWith('.test.js') || f.startsWith('test_') || f.startsWith('verify_')) &&
  f.endsWith('.js') &&
  f !== 'run_all.js' &&
  !isExcluded(f) &&
  (!filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
).sort();

if (shardArg) {
  const [shardNum, totalShards] = shardArg.split('=')[1].split('/').map(Number);
  if (shardNum && totalShards && shardNum <= totalShards) {
    const chunkSize = Math.ceil(jsTests.length / totalShards);
    jsTests = jsTests.slice((shardNum - 1) * chunkSize, shardNum * chunkSize);
  }
}

const pyTests = includePython ? files.filter(f =>
  f.startsWith('test_') && f.endsWith('.py') &&
  (!filterArg || f.toLowerCase().includes(filterArg.toLowerCase()))
).sort() : [];

console.log('====================================================');
console.log('       KONOHA JAVASCRIPT TEST SUITE RUNNER          ');
console.log('====================================================');
console.log(`Discovered ${jsTests.length} JS test suites${includePython ? ` and ${pyTests.length} Python suites` : ''} (${isParallel ? `parallel mode, concurrency ${concurrency}` : 'sequential mode'}).\n`);
if (excludePatterns.length > 0) {
  const skipped = files.filter(f => f.startsWith('test_') && f.endsWith('.js') && isExcluded(f)).sort();
  console.log(`Excluded via KONOHA_TEST_EXCLUDE (${excludePatterns.join(',')}): ${skipped.length} suite(s)`);
  for (const s of skipped) console.log(`  - ${s}`);
  console.log('');
}

let passed = 0;
let failed = 0;
const failList = [];
// Build or validate the seed once, before any suite is scheduled. Left to the
// first suite it blocks the event loop for minutes (spawnSync) while the other
// workers sit parked, and its cost is attributed to whatever suite won the race.
const seedWarmStart = Date.now();
try {
  getGoldenSeed();
} catch (err) {
  // The guard in prepareExplicitSeedDir throws rather than deleting a directory
  // it did not create; surface it as a failed run, not a stack trace mid-suite.
  console.error(err.message);
  process.exit(1);
}
console.log(`[SEED] Seed check: ${((Date.now() - seedWarmStart) / 1000).toFixed(1)}s\n`);
const startTime = Date.now();

function runSuiteSync(cmd, args, name) {
  process.stdout.write(`[SUITE] Running: ${name} ... `);
  const snapshot = createSuiteSnapshot(name);
  // Timed from after the snapshot: the ~400 MB seed copy is harness overhead,
  // and charging it to the suite made a 2 s suite report as minutes.
  const start = Date.now();
  try {
    const res = spawnSync(cmd, args, {
      encoding: 'utf-8',
      env: snapshot.env
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (res.status === 0) {
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
    snapshot.cleanup();
  }
}

function runSuiteAsync(cmd, args, name) {
  return new Promise((resolve) => {
    const snapshot = createSuiteSnapshot(name);
    const start = Date.now();
    const child = spawn(cmd, args, {
      env: snapshot.env
    });
    let out = '';
    let err = '';
    let settled = false;
    // Suites that do full install/migration work are orders of magnitude slower
    // in a VM than on a dev host; a flat cap kills them mid-flight. One cap for
    // every suite: a slow suite that hangs is caught by the run's own deadline,
    // and a per-suite split only ever mislabels the next slow suite.
    const suiteTimeoutMs = Number(process.env.KONOHA_TEST_TIMEOUT) || 3600000;
    const timer = setTimeout(() => {
      if (!settled) {
        err += `\n[TIMEOUT] Suite ${name} timed out after ${suiteTimeoutMs / 1000}s and was terminated.`;
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }, suiteTimeoutMs);

    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      snapshot.cleanup();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (status === 0) {
        console.log(`[SUITE] Running: ${name} ... PASS (${elapsed}s)`);
        passed++;
      } else {
        console.log(`[SUITE] Running: ${name} ... FAIL (exit code ${status})`);
        if (out) console.log(out);
        if (err) console.error(err);
        failed++;
        failList.push(name);
      }
      resolve();
    };

    child.on('close', status => settle(status));
    // A spawn failure (missing exec, EACCES) emits 'error' and never 'close';
    // without this listener the suite would sit until the timeout and then
    // wait forever on a promise that can no longer settle.
    child.on('error', (e) => {
      err += `\n[SPAWN ERROR] ${e && e.message ? e.message : e}`;
      settle(1);
    });
  });
}

async function runAllParallel() {
  // Host daemon, attribution, and vector search access shared resources; run them sequentially
  const isSequential = f => f.includes('_attribution.') || f === 'test_akatsuki_lab_isolation.js' || f === 'test_akatsuki_skill_authz_db_isolation.js' || f === 'test_akatsuki_init.js' || f === 'test_akatsuki_security_centralization.js' || f === 'test_vector_search.js';
  const parallelPool = jsTests.filter(f => !isSequential(f));
  const sequentialPool = jsTests.filter(f => isSequential(f));

  let index = 0;
  async function worker() {
    while (index < parallelPool.length) {
      const f = parallelPool[index++];
      await runSuiteAsync(process.execPath, [path.join(testsDir, f)], f);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (sequentialPool.length > 0) {
    for (const f of sequentialPool) {
      runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
    }
  }

  if (includePython) {
    for (const f of pyTests) {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      runSuiteSync(pyCmd, [path.join(testsDir, f)], f);
    }
  }

  finish();
}

function finish() {
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
    runSuiteSync(process.execPath, [path.join(testsDir, f)], f);
  }
  if (includePython) {
    for (const f of pyTests) {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      runSuiteSync(pyCmd, [path.join(testsDir, f)], f);
    }
  }
  finish();
}
