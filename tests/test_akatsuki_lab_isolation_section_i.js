#!/usr/bin/env node
'use strict';

/**
 * Plan §3 — Lab DB ↔ main DB physical isolation, section I (I1–I8).
 *
 * Every case runs on throwaway roots: KONOHA_DB_PATH and KONOHA_LAB_DB_ROOT
 * point at mkdtemp dirs, so a mistake here cannot touch a real install.
 * No real container is started; provisioning uses a mock runner.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-sec-i-'));
const MAIN_DB = path.join(TMP_ROOT, 'konoha.db');
const LAB_ROOT = path.join(TMP_ROOT, 'akatsuki-lab');

process.env.KONOHA_DB_PATH = MAIN_DB;
process.env.KONOHA_LAB_DB_ROOT = LAB_ROOT;
process.env.HOME = TMP_ROOT;
process.env.USERPROFILE = TMP_ROOT;
process.env.KONOHA_HOME = path.join(TMP_ROOT, '.konoha');
process.env.KONOHA_AKATSUKI_CONFIG = path.join(TMP_ROOT, '.konoha', 'akatsuki_config.json');

const Database = require('../src/sqlite_driver');
const dbModule = require('../src/db');
const authz = require('../src/skill_authorization');
const labDb = require('../src/workflow/akatsuki/lab_db');
const lab = require('../src/workflow/akatsuki/lab');
const { initLab } = require('../src/workflow/akatsuki/init');

let passed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

function ensureMainDb() {
  const conn = new Database(MAIN_DB);
  dbModule.setupSchema(conn);
  conn.exec("INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, byte_size, line_count, file_path) VALUES ('blue-skill','blue-skill','skill','','body',4,1,'/tmp/blue.md')");
  conn.close();
}

function sha(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
  catch (_) { return null; }
}

function snapshotMain() {
  return {
    db: sha(MAIN_DB),
    wal: sha(`${MAIN_DB}-wal`),
    shm: sha(`${MAIN_DB}-shm`)
  };
}

function mockRunner() {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes('list') || args.includes('inspect')) {
      return { status: 0, stdout: '[]', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  runner.calls = calls;
  return runner;
}

function mainRowCount() {
  const conn = new Database(MAIN_DB);
  const n = conn.prepare('SELECT COUNT(*) AS c FROM skills').get().c;
  conn.close();
  return n;
}

console.log('Running section I — lab/main physical isolation...');

ensureMainDb();

runTest('I1 provisioning leaves the main DB byte-identical', () => {
  const before = snapshotMain();
  const runner = mockRunner();
  try {
    initLab({ engines: 'lxc', profile: 'minimal', lab_name: 'i1-lab' }, {
      platform: 'linux', runner, mockProvisionResult: { ok: true, status: 'running' },
      mockInstallResult: { ok: true, tools_installed: [] }
    });
    lab.provisionLab('i1-lab', 'lxc', { platform: 'linux', runner });
  } catch (_) {
    // Provisioning may decline without a real engine; the assertion below is
    // about the main DB, which must be untouched either way.
  }
  assert.deepStrictEqual(snapshotMain(), before, 'main DB and sidecars must be byte-identical');
});

runTest('I2 initLab never opens the main DB through getConnection', () => {
  const saved = dbModule.getConnection;
  let opened = 0;
  dbModule.getConnection = () => { opened++; throw new Error('main DB opened during lab provisioning'); };
  try {
    initLab({ engines: 'docker', profile: 'minimal', lab_name: 'i2-lab' }, {
      platform: 'darwin', runner: mockRunner(),
      mockProvisionResult: { ok: true, status: 'running' },
      mockInstallResult: { ok: true, tools_installed: [] }
    });
  } finally {
    dbModule.getConnection = saved;
  }
  assert.strictEqual(opened, 0, 'getConnection must not be reached by initLab');
});

runTest('I3 confirmed teardown deletes lab.db + sidecars, main DB survives', () => {
  const conn = labDb.openLabDb();
  conn.exec("INSERT INTO lab_runs (lab_name, engine, workflow, started_at) VALUES ('i3','lxc','recon','2026-11-09T00:00:00Z')");
  conn.close();
  const labPath = labDb.getLabDbPath();
  assert.ok(fs.existsSync(labPath), 'lab DB must exist before teardown');

  const res = lab.teardownLab('i3-lab', 'lxc', {
    platform: 'linux',
    runner: () => ({ status: 0, stdout: '', stderr: '' })
  });
  assert.strictEqual(res.cleanup_confirmed, true);

  for (const suffix of ['', '-wal', '-shm']) {
    assert.strictEqual(fs.existsSync(labPath + suffix), false, `lab${suffix} must be gone`);
  }
  assert.ok(fs.existsSync(MAIN_DB), 'main DB must survive lab teardown');
  assert.ok(mainRowCount() > 0, 'main DB rows must survive lab teardown');
});

runTest('I4 unconfirmed teardown retains the lab DB and leaves main untouched', () => {
  const conn = labDb.openLabDb();
  conn.exec("INSERT INTO lab_runs (lab_name, engine, workflow, started_at) VALUES ('i4','lxc','recon','2026-11-09T00:00:00Z')");
  conn.close();
  const labPath = labDb.getLabDbPath();
  const before = snapshotMain();

  const res = lab.teardownLab('i4-lab', 'lxc', {
    platform: 'linux',
    runner: () => ({ status: 1, stdout: '', stderr: 'permission denied' })
  });
  assert.strictEqual(res.cleanup_confirmed, false);
  assert.ok(fs.existsSync(labPath), 'lab DB must be retained when cleanup is unconfirmed');
  assert.deepStrictEqual(snapshotMain(), before, 'main DB must be untouched');
});

runTest('I5 a lab.db symlink to the main DB is rejected by openLabDb', () => {
  const saved = process.env.KONOHA_LAB_DB_ROOT;
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'i5-lab-'));
  try {
    process.env.KONOHA_LAB_DB_ROOT = root;
    fs.symlinkSync(MAIN_DB, path.join(root, 'lab.db'));
    assert.throws(
      () => labDb.openLabDb(),
      (err) => err.code === authz.LAB_DB_ISOLATION_VIOLATION,
      'openLabDb must refuse a symlink that escapes to the main DB'
    );
  } finally {
    if (saved === undefined) delete process.env.KONOHA_LAB_DB_ROOT;
    else process.env.KONOHA_LAB_DB_ROOT = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

runTest('I6 concurrent main and lab writes stay independent', () => {
  const mainConn = new Database(MAIN_DB);
  const labConn = labDb.openLabDb();
  const mainBefore = mainConn.prepare('SELECT COUNT(*) AS c FROM skills').get().c;
  const labBefore = labConn.prepare('SELECT COUNT(*) AS c FROM lab_runs').get().c;

  for (let i = 0; i < 25; i++) {
    mainConn.exec(`INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, byte_size, line_count, file_path) VALUES ('i6-${i}','i6-${i}','skill','','b',1,1,'/tmp/i6-${i}.md')`);
    labConn.exec(`INSERT INTO lab_runs (lab_name, engine, workflow, started_at) VALUES ('i6-${i}','lxc','recon','2026-11-09T00:00:00Z')`);
  }

  assert.strictEqual(mainConn.prepare('SELECT COUNT(*) AS c FROM skills').get().c, mainBefore + 25);
  assert.strictEqual(labConn.prepare('SELECT COUNT(*) AS c FROM lab_runs').get().c, labBefore + 25);
  const mainHasLabRuns = mainConn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lab_runs'").get();
  assert.strictEqual(mainHasLabRuns, undefined, 'main DB must not define lab_runs');

  mainConn.close();
  labConn.close();
});

runTest('I7 reopening the lab DB preserves lab schema and leaves main unchanged', () => {
  const before = snapshotMain();
  const first = labDb.openLabDb();
  const runs = first.prepare('SELECT COUNT(*) AS c FROM lab_runs').get().c;
  first.close();

  const second = labDb.openLabDb();
  const toolCount = second.prepare('SELECT COUNT(*) AS c FROM kali_tools').get().c;
  assert.strictEqual(second.prepare('SELECT COUNT(*) AS c FROM lab_runs').get().c, runs, 'lab rows must persist across reopen');
  assert.strictEqual(toolCount, 361, 'kali_tools must be seeded with the bundled catalog');
  for (const t of ['kali_tools', 'lab_runs', 'lab_tool_invocations', 'red_skill_audit']) {
    assert.ok(second.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), `${t} must exist`);
  }
  second.close();
  assert.deepStrictEqual(snapshotMain(), before, 'main DB must be unchanged by lab reopen');
});

runTest('I8 real boundary: default lab path, and getConnection refuses it', () => {
  const saved = process.env.KONOHA_LAB_DB_ROOT;
  delete process.env.KONOHA_LAB_DB_ROOT;
  try {
    const labPath = labDb.getLabDbPath();
    assert.strictEqual(labPath, path.join(os.homedir(), '.konoha', 'akatsuki-lab', 'lab.db'));
    assert.throws(
      () => dbModule.getConnection(labPath),
      (err) => err.code === 'LAB_DB_ISOLATION_VIOLATION'
    );
    assert.throws(
      () => dbModule.getConnection(path.join(authz.getLabDbDir(), 'lab.db')),
      (err) => err.code === 'LAB_DB_ISOLATION_VIOLATION'
    );
  } finally {
    if (saved === undefined) delete process.env.KONOHA_LAB_DB_ROOT;
    else process.env.KONOHA_LAB_DB_ROOT = saved;
  }
});

runTest('I9 a hardlink inside the lab root pointing at the main DB is rejected', () => {
  const saved = process.env.KONOHA_LAB_DB_ROOT;
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'i9-lab-'));
  try {
    process.env.KONOHA_LAB_DB_ROOT = root;
    const link = path.join(root, 'lab.db');
    fs.linkSync(MAIN_DB, link);
    // realpath cannot see a hardlink: the link keeps its own path and only the
    // inode identifies it as the main DB.
    assert.notStrictEqual(fs.realpathSync(link), fs.realpathSync(MAIN_DB), 'realpath keeps the hardlink name');
    assert.strictEqual(fs.statSync(link).ino, fs.statSync(MAIN_DB).ino);
    assert.throws(
      () => labDb.openLabDb(),
      (err) => err.code === authz.LAB_DB_ISOLATION_VIOLATION,
      'openLabDb must refuse a hardlink to the main DB'
    );
    assert.doesNotThrow(() => authz.assertLabDbPath(path.join(root, 'fresh.db')), 'an ordinary lab path must still pass');
  } finally {
    if (saved === undefined) delete process.env.KONOHA_LAB_DB_ROOT;
    else process.env.KONOHA_LAB_DB_ROOT = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

runTest('I10 an unreadable main DB fails closed instead of assuming separation', () => {
  const saved = process.env.KONOHA_LAB_DB_ROOT;
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'i10-lab-'));
  const realStat = fs.statSync;
  try {
    process.env.KONOHA_LAB_DB_ROOT = root;
    // The lab target must exist, otherwise the guard short-circuits before
    // comparing inodes and this test would pass for the wrong reason.
    const target = path.join(root, 'lab.db');
    fs.writeFileSync(target, 'lab');
    fs.statSync = function (p, ...rest) {
      if (String(p).includes(path.basename(MAIN_DB))) {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return realStat.call(fs, p, ...rest);
    };
    assert.throws(
      () => authz.assertLabDbPath(target),
      (err) => err.code === authz.LAB_DB_ISOLATION_VIOLATION,
      'an unstat-able main DB must reject, not imply a distinct inode'
    );
  } finally {
    fs.statSync = realStat;
    if (saved === undefined) delete process.env.KONOHA_LAB_DB_ROOT;
    else process.env.KONOHA_LAB_DB_ROOT = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
  // A genuinely absent main DB is not an error: fresh installs must proceed.
  const saved2 = process.env.KONOHA_LAB_DB_ROOT;
  const root2 = fs.mkdtempSync(path.join(TMP_ROOT, 'i10b-lab-'));
  try {
    process.env.KONOHA_LAB_DB_ROOT = root2;
    assert.doesNotThrow(() => authz.assertLabDbPath(path.join(root2, 'lab.db')));
  } finally {
    if (saved2 === undefined) delete process.env.KONOHA_LAB_DB_ROOT;
    else process.env.KONOHA_LAB_DB_ROOT = saved2;
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

cleanup();
console.log(`\n${passed} test cases passed.`);