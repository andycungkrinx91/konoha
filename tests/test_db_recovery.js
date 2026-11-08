'use strict';

/**
 * tests/test_db_recovery.js — Adversarial security & disaster recovery tests
 * for SQLite health diagnostics, backup restoration, and read-only salvage.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const {
  validateDatabasePath,
  checkIntegrity,
  checkDatabase,
  detectCorruption,
  restoreDatabase,
  autoRecoverIfNeeded,
  salvageDatabase,
  buildSafeTableDdl
} = require('../src/db_recovery');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_db_recovery_test_'));

function cleanup() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

process.on('exit', cleanup);

function seedSampleDb(dbPath, rows = ['hokage', 'anbu', 'jonin']) {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score INTEGER DEFAULT 10);');
  const stmt = db.prepare('INSERT INTO items (name, score) VALUES (?, ?);');
  rows.forEach((name, idx) => stmt.run(name, (idx + 1) * 10));
  db.close();
}

console.log('Running test_db_recovery.js...\n');

// Baseline healthy database integrity check and corruption detection
console.log('1. Verifying checkIntegrity and detectCorruption on a clean database...');
const cleanDbPath = path.join(TMP_DIR, 'clean.db');
seedSampleDb(cleanDbPath);

const cleanCheck = checkIntegrity(cleanDbPath);
assert.strictEqual(cleanCheck.ok, true, 'Clean database must return ok: true');
assert.strictEqual(cleanCheck.status, 'OK', 'Clean database status must be OK');
assert.strictEqual(cleanCheck.details[0], 'ok');

const cleanDetect = detectCorruption(cleanDbPath);
assert.strictEqual(cleanDetect.ok, true);
assert.strictEqual(cleanDetect.corrupt, false);
assert.strictEqual(cleanDetect.reason, null);
console.log('  ✓ Clean database checkIntegrity and detectCorruption passed');

const backupDbPath = path.join(TMP_DIR, 'clean_backup.db');
fs.copyFileSync(cleanDbPath, backupDbPath);
const originalBackupBytes = fs.readFileSync(backupDbPath);
assert.strictEqual(checkIntegrity(backupDbPath).ok, true);

// Deterministic corruption at offset 16..80
console.log('2. Corrupting database via deterministic 64-byte overwrite at offset 16...');
const corruptDbPath = path.join(TMP_DIR, 'corrupt.db');
fs.copyFileSync(cleanDbPath, corruptDbPath);
const corruptBuf = fs.readFileSync(corruptDbPath);
for (let i = 16; i < 80; i++) {
  corruptBuf[i] = 0xAA;
}
fs.writeFileSync(corruptDbPath, corruptBuf);

const corruptDetect = detectCorruption(corruptDbPath);
assert.strictEqual(corruptDetect.ok, false);
assert.strictEqual(corruptDetect.corrupt, true);
assert.ok(corruptDetect.reason);
const corruptCheck = checkIntegrity(corruptDbPath);
assert.strictEqual(corruptCheck.ok, false);
assert.strictEqual(corruptCheck.status, 'CORRUPTED');
console.log(`  ✓ Corruption detected cleanly: ${corruptDetect.reason}`);

// Restore from verified backup with atomic archive and byte-for-byte backup preservation
console.log('3. Verifying restoreDatabase with atomic archive creation and backup integrity...');
const restoreResult = restoreDatabase({
  dbPath: corruptDbPath,
  backupPath: backupDbPath,
  force: true
});
assert.strictEqual(restoreResult.restored, true);
assert.strictEqual(restoreResult.method, 'backup');
assert.ok(restoreResult.archived && fs.existsSync(restoreResult.archived));
assert.strictEqual(checkIntegrity(corruptDbPath).ok, true);
assert.ok(fs.readFileSync(backupDbPath).equals(originalBackupBytes), 'Backup file must remain byte-for-byte identical');

const restoredDb = new DatabaseSync(corruptDbPath);
const countRow = restoredDb.prepare('SELECT COUNT(*) as count FROM items;').get();
assert.strictEqual(Number(countRow.count), 3);
restoredDb.close();
console.log('  ✓ restoreDatabase succeeded, archived corrupt DB, and preserved backup bytes');

// CLI subcommands verification
console.log('4. Verifying CLI commands (konoha db check and konoha db restore)...');
execFileSync(process.execPath, [CLI_PATH, 'db', 'check', cleanDbPath], { encoding: 'utf8', stdio: 'pipe' });

fs.writeFileSync(corruptDbPath, corruptBuf);
let corruptCliFailed = false;
try {
  execFileSync(process.execPath, [CLI_PATH, 'db', 'check', corruptDbPath], { encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  corruptCliFailed = true;
  assert.strictEqual(err.status, 1);
}
assert.ok(corruptCliFailed, 'CLI check on corrupted DB must exit 1');

const restoreOut = execFileSync(process.execPath, [
  CLI_PATH, 'db', 'restore', corruptDbPath, '--from', backupDbPath, '--force'
], { encoding: 'utf8', stdio: 'pipe' });
assert.ok(restoreOut.includes('recovery successful') || restoreOut.includes('Restored'));
assert.strictEqual(checkIntegrity(corruptDbPath).ok, true);
console.log('  ✓ CLI check and restore subcommands verified');

// Corrupt backup rejection and live DB preservation
console.log('5. Verifying corrupt backup rejection preserves live database...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'badbackup_'));
  const liveDb = path.join(dir, 'live.db');
  const badBackup = path.join(dir, 'bad.backup.db');
  seedSampleDb(liveDb, ['keepme']);
  fs.writeFileSync(badBackup, Buffer.alloc(4096, 0x41));
  const beforeBytes = fs.readFileSync(liveDb);

  assert.throws(() => {
    restoreDatabase({ dbPath: liveDb, backupPath: badBackup });
  }, /corrupt/i);
  assert.ok(fs.readFileSync(liveDb).equals(beforeBytes), 'Live DB bytes must remain untouched');
  const report = checkDatabase(liveDb);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.foreignKeyViolations, 0);
  console.log('  ✓ Corrupt backup rejected without touching live DB');
}

// Shell command injection, special characters, Unicode, spaces, quotes, and leading hyphens
console.log('6. Verifying shell metacharacter immunity, spaces, quotes, Unicode, and leading hyphens...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'shell_meta_'));
  const markerFile = path.join(dir, 'pwned_marker');

  const weirdNames = [
    `db_$(touch "${markerFile}").db`,
    `db_\`touch "${markerFile}"\`.db`,
    `db_"; touch "${markerFile}" #.db`,
    `db_| touch "${markerFile}" &.db`,
    'my "quoted" & spaced database.db',
    '東京_データベース_2026.db',
    '-leading-hyphen-db.db'
  ];

  for (const fileName of weirdNames) {
    const dbFile = path.join(dir, fileName);
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    seedSampleDb(dbFile, ['alpha', 'beta']);

    const checkRes = checkIntegrity(dbFile);
    assert.strictEqual(checkRes.ok, true, `checkIntegrity failed for ${fileName}: ${checkRes.details}`);
    assert.strictEqual(fs.existsSync(markerFile), false, `Command injection marker must NEVER exist for ${fileName}`);

    // Corrupt header and salvage without backup
    const raw = fs.readFileSync(dbFile);
    for (let i = 16; i < 80; i++) raw[i] = 0xBB;
    fs.writeFileSync(dbFile, raw);

    const salvageOutcome = restoreDatabase({ dbPath: dbFile, force: true });
    assert.strictEqual(salvageOutcome.restored, true, `Salvage failed for ${fileName}: ${salvageOutcome.details}`);
    assert.strictEqual(salvageOutcome.method, 'salvage');
    assert.strictEqual(checkIntegrity(dbFile).ok, true);
    assert.strictEqual(fs.existsSync(markerFile), false, `Command injection marker must NEVER exist after restore for ${fileName}`);
  }

  // Verify leading hyphen via CLI with `--` separator and flag rejection without `--`
  const hyphenDb = path.join(dir, '-leading-hyphen-db.db');
  execFileSync(process.execPath, [CLI_PATH, 'db', 'check', '--', hyphenDb], { encoding: 'utf8', stdio: 'pipe' });

  let unknownFlagRejected = false;
  try {
    execFileSync(process.execPath, [CLI_PATH, 'db', 'check', '--malicious-flag'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    unknownFlagRejected = true;
    assert.strictEqual(err.status, 1);
  }
  assert.ok(unknownFlagRejected, 'CLI must reject unknown leading-hyphen flags when not preceded by --');
  console.log('  ✓ Shell metacharacters, spaces, quotes, Unicode, and leading hyphens handled safely');
}

// Path traversal, prefix confusion, symlinks, unexpected absolute paths, and non-DB extensions
console.log('7. Verifying path traversal, symlink escape, prefix confusion, and boundary defenses...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'boundaries_'));
  const validDb = path.join(dir, 'valid.db');
  seedSampleDb(validDb);

  // Path traversal
  const traversalCheck = validateDatabasePath(`${dir}/../traversal.db`);
  assert.strictEqual(traversalCheck.ok, false);
  assert.strictEqual(traversalCheck.code, 'PATH_TRAVERSAL_REJECTED');

  // Control characters / null byte
  const nullByteCheck = validateDatabasePath(`${validDb}\0.sh`);
  assert.strictEqual(nullByteCheck.ok, false);
  assert.strictEqual(nullByteCheck.code, 'CONTROL_CHAR_REJECTED');

  // Forbidden system paths
  const etcCheck = validateDatabasePath('/etc/passwd');
  assert.strictEqual(etcCheck.ok, false);
  assert.strictEqual(etcCheck.code, 'FORBIDDEN_PATH_REJECTED');

  const outsideAbsCheck = validateDatabasePath('/var/lib/untrusted_outside.db');
  assert.strictEqual(outsideAbsCheck.ok, false);
  assert.strictEqual(outsideAbsCheck.code, 'OUTSIDE_ALLOWED_BOUNDARY');

  // Path-prefix confusion: allowedRoot = /tmp/.../allowed, target = /tmp/.../allowed_evil/x.db
  const allowedRoot = path.join(dir, 'allowed');
  const evilSibling = path.join(dir, 'allowed_evil');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(evilSibling, { recursive: true });
  const prefixConfusedDb = path.join(evilSibling, 'confused.db');
  seedSampleDb(prefixConfusedDb);
  const prefixCheck = validateDatabasePath(prefixConfusedDb, { allowedRoots: [allowedRoot] });
  assert.strictEqual(prefixCheck.ok, false);
  assert.strictEqual(prefixCheck.code, 'OUTSIDE_ALLOWED_BOUNDARY');

  // Non-DB extension rejection (protects package.json, scripts, source files)
  const fakeJson = path.join(dir, 'package.json');
  fs.writeFileSync(fakeJson, '{"name":"do-not-touch"}');
  const extCheck = validateDatabasePath(fakeJson);
  assert.strictEqual(extCheck.ok, false);
  assert.strictEqual(extCheck.code, 'INVALID_DB_IDENTITY');
  assert.throws(() => restoreDatabase({ dbPath: fakeJson, force: true }), /extension/i);
  assert.strictEqual(fs.readFileSync(fakeJson, 'utf8'), '{"name":"do-not-touch"}');

  // Directory passed as DB path
  const subDirAsDb = path.join(dir, 'folder.db');
  fs.mkdirSync(subDirAsDb);
  const dirCheck = validateDatabasePath(subDirAsDb);
  assert.strictEqual(dirCheck.ok, false);
  assert.strictEqual(dirCheck.code, 'NOT_REGULAR_FILE');

  // Symlinked DB file
  const symlinkDb = path.join(dir, 'symlink.db');
  fs.symlinkSync(validDb, symlinkDb);
  const symCheck = validateDatabasePath(symlinkDb);
  assert.strictEqual(symCheck.ok, false);
  assert.strictEqual(symCheck.code, 'SYMLINK_REJECTED');
  assert.throws(() => restoreDatabase({ dbPath: symlinkDb, backupPath: validDb, force: true }), /Symbolic link/i);

  // Symlinked parent directory
  const realSub = path.join(dir, 'real_sub');
  fs.mkdirSync(realSub);
  const symSub = path.join(dir, 'sym_sub');
  fs.symlinkSync(realSub, symSub);
  const symParentDb = path.join(symSub, 'inside.db');
  const symParentCheck = validateDatabasePath(symParentDb);
  assert.strictEqual(symParentCheck.ok, false);
  assert.strictEqual(symParentCheck.code, 'SYMLINK_REJECTED');

  // Symlinked -wal sidecar protection
  const walTarget = path.join(dir, 'precious_target.txt');
  fs.writeFileSync(walTarget, 'DO_NOT_DELETE_ME');
  const dbWithWalSymlink = path.join(dir, 'wal_symlink_test.db');
  seedSampleDb(dbWithWalSymlink);
  fs.symlinkSync(walTarget, `${dbWithWalSymlink}-wal`);
  assert.throws(() => {
    restoreDatabase({ dbPath: dbWithWalSymlink, backupPath: validDb, force: true });
  }, /Unsafe sidecar file rejected/i);
  assert.strictEqual(fs.readFileSync(walTarget, 'utf8'), 'DO_NOT_DELETE_ME');
  fs.unlinkSync(`${dbWithWalSymlink}-wal`);

  // Nonexistent file
  const missingDb = path.join(dir, 'does_not_exist.db');
  const missingIntegrity = checkIntegrity(missingDb);
  assert.strictEqual(missingIntegrity.ok, false);
  assert.strictEqual(missingIntegrity.status, 'FILE_NOT_FOUND');

  // Read-only directory handling
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const roDir = path.join(dir, 'readonly_dir');
    fs.mkdirSync(roDir);
    const roDb = path.join(roDir, 'ro.db');
    seedSampleDb(roDb);
    fs.chmodSync(roDir, 0o500);
    try {
      assert.throws(() => {
        restoreDatabase({ dbPath: roDb, backupPath: validDb, force: true });
      });
      assert.strictEqual(checkIntegrity(roDb).ok, true, 'Original DB in read-only dir must remain intact');
    } finally {
      fs.chmodSync(roDir, 0o700);
    }
  }
  console.log('  ✓ Path traversal, prefix confusion, symlinks, extensions, and permissions verified');
}

// SQLite salvage recovery & malicious SQL content neutralization
console.log('8. Verifying SQLite salvage against malicious schemas, triggers, PRAGMAs, and payloads...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'salvage_sec_'));
  const pwnedDbPath = path.join(dir, 'attached_pwn.db');
  const markerPath = path.join(dir, 'trigger_marker.db');

  // Craft a database containing:
  // - Legitimate table + data including SQL injection strings and CLI dot-commands
  // - Malicious TRIGGER attempting unintended writes
  // - Malicious VIEW
  // - Corrupted sqlite_master entry injected via writable_schema containing multi-statement ATTACH DATABASE
  const maliciousDbPath = path.join(dir, 'malicious.db');
  const mdb = new DatabaseSync(maliciousDbPath);
  mdb.exec('CREATE TABLE safe_records (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);');
  const ins = mdb.prepare('INSERT INTO safe_records (payload) VALUES (?);');
  ins.run("normal_value");
  ins.run("'); ATTACH DATABASE '" + pwnedDbPath + "' AS pwn; CREATE TABLE pwn.x(a INT); --");
  ins.run("\n.shell touch " + markerPath + "\n.output " + markerPath + "\n");
  ins.run("PRAGMA writable_schema = ON; LOAD_EXTENSION('evil');");

  // Create a malicious trigger that would fire on INSERT if triggers were copied
  mdb.exec(`
    CREATE TABLE trigger_sink (msg TEXT);
    CREATE TRIGGER evil_trigger AFTER INSERT ON safe_records
    BEGIN
      INSERT INTO trigger_sink (msg) VALUES ('TRIGGER_EXECUTED');
    END;
    CREATE VIEW evil_view AS SELECT payload FROM safe_records;
  `);

  // Create a table whose sqlite_master DDL will be binary-patched on disk to contain a multi-statement ATTACH payload
  const ddlPlaceholder = 'CREATE TABLE poison_tbl (id INT /*____POISON_DDL_PATCH_SLOT_0123456789____*/)';
  mdb.exec(`${ddlPlaceholder};`);
  mdb.close();

  // Binary-patch the sqlite_master DDL inside the raw SQLite file on disk
  const rawMalicious = fs.readFileSync(maliciousDbPath);
  const needle = Buffer.from('/*____POISON_DDL_PATCH_SLOT_0123456789____*/', 'utf8');
  const replacementStr = `); ATTACH DATABASE 'pwn.db' AS p;--`.padEnd(needle.length, ' ');
  const replacementBuf = Buffer.from(replacementStr, 'utf8');
  const idx = rawMalicious.indexOf(needle);
  assert.ok(idx !== -1, 'Expected to locate DDL patch slot in raw database file');
  replacementBuf.copy(rawMalicious, idx);
  fs.writeFileSync(maliciousDbPath, rawMalicious);

  const salvagedTarget = path.join(dir, 'salvaged_clean.db');
  const salvageRes = salvageDatabase(maliciousDbPath, salvagedTarget, { stagingDir: dir });
  assert.strictEqual(salvageRes.ok, true, `salvageDatabase should succeed: ${salvageRes.reason}`);
  assert.strictEqual(fs.existsSync(pwnedDbPath), false, 'ATTACH DATABASE payload must NEVER execute');
  assert.strictEqual(fs.existsSync(markerPath), false, 'CLI dot-command payload must NEVER execute');

  const verifyDb = new DatabaseSync(salvagedTarget, { readOnly: true });
  const rows = verifyDb.prepare('SELECT payload FROM safe_records ORDER BY id ASC').all();
  assert.strictEqual(rows.length, 4, 'All 4 data rows (including literal SQLi/dot-command text) must be preserved');
  assert.ok(rows[1].payload.includes('ATTACH DATABASE'));
  assert.ok(rows[2].payload.includes('.shell touch'));

  // Verify triggers, views, and poison_tbl were stripped
  const masterObjects = verifyDb.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  const types = masterObjects.map((o) => o.type);
  const names = masterObjects.map((o) => o.name);
  assert.ok(!types.includes('trigger'), 'No triggers may be copied into salvaged database');
  assert.ok(!types.includes('view'), 'No views may be copied into salvaged database');
  assert.ok(!names.includes('poison_tbl'), 'Table with multi-statement/ATTACH DDL must be rejected');

  const sinkRows = verifyDb.prepare('SELECT COUNT(*) as c FROM trigger_sink').get();
  assert.strictEqual(Number(sinkRows.c), 0, 'Malicious trigger must never have fired during row salvage');
  verifyDb.close();

  // Direct unit tests on buildSafeTableDdl
  assert.strictEqual(
    buildSafeTableDdl(null, 'evil', 'CREATE TABLE evil (id INT); ATTACH DATABASE "x" AS y;').ok,
    false,
    'DDL with semicolon injection must be rejected'
  );
  assert.strictEqual(
    buildSafeTableDdl(null, 'evil_vt', 'CREATE VIRTUAL TABLE evil_vt USING fts3(content)').ok,
    false,
    'Virtual table DDL must be rejected'
  );
  console.log('  ✓ Malicious triggers, views, writable_schema DDL, ATTACH, PRAGMAs, and dot-commands neutralized');
}

// Mid-file B-tree page corruption salvage & non-SQLite garbage fail-closed test
console.log('9. Verifying B-tree page corruption row salvage and garbage file fail-closed behavior...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'btree_salvage_'));
  const pagedDb = path.join(dir, 'paged.db');
  const db = new DatabaseSync(pagedDb);
  db.exec('PRAGMA page_size = 1024;');
  db.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, body TEXT);');
  const ins = db.prepare('INSERT INTO logs (body) VALUES (?);');
  for (let i = 0; i < 60; i++) {
    ins.run(`entry_${i}_${'x'.repeat(80)}`);
  }
  db.close();

  // Corrupt a single leaf page near the end of the file while keeping page 1 (schema) intact
  const raw = fs.readFileSync(pagedDb);
  assert.ok(raw.length >= 4096);
  const lastPageStart = raw.length - 1024;
  for (let i = lastPageStart; i < raw.length; i++) {
    raw[i] = 0xFF;
  }
  fs.writeFileSync(pagedDb, raw);
  assert.strictEqual(checkIntegrity(pagedDb).ok, false, 'Page-corrupted DB must fail checkIntegrity');

  const outcome = restoreDatabase({ dbPath: pagedDb, force: true });
  assert.strictEqual(outcome.restored, true, 'Salvage should recover surviving pages');
  assert.strictEqual(outcome.method, 'salvage');
  assert.strictEqual(checkIntegrity(pagedDb).ok, true, 'Salvaged DB must pass integrity_check');

  const reopened = new DatabaseSync(pagedDb, { readOnly: true });
  const surviving = reopened.prepare('SELECT COUNT(*) as c FROM logs').get();
  reopened.close();
  assert.ok(Number(surviving.c) > 0 && Number(surviving.c) < 60, `Expected partial row salvage (got ${surviving.c}/60)`);

  // Completely non-SQLite garbage file with no backup must fail closed and leave original file intact
  const garbageDb = path.join(dir, 'garbage.db');
  const garbageBytes = Buffer.alloc(4096, 0x41);
  fs.writeFileSync(garbageDb, garbageBytes);
  const garbageOutcome = restoreDatabase({ dbPath: garbageDb, force: true });
  assert.strictEqual(garbageOutcome.restored, false);
  assert.strictEqual(garbageOutcome.method, 'none');
  assert.ok(fs.readFileSync(garbageDb).equals(garbageBytes), 'Failed salvage must leave original file untouched');
  console.log(`  ✓ B-tree partial salvage recovered ${surviving.c}/60 rows and garbage file failed closed safely`);
}

// Atomic replacement rollback, WAL/SHM sidecar restoration, staging cleanup, and concurrency lock
console.log('10. Verifying atomic rollback, WAL/SHM sidecars, staging cleanup, and concurrency lock...');
{
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'atomic_concurrency_'));
  const liveDb = path.join(dir, 'live.db');
  const goodBackup = path.join(dir, 'backup.db');
  seedSampleDb(liveDb, ['original_one']);
  seedSampleDb(goodBackup, ['backup_one', 'backup_two']);

  const origDbBytes = fs.readFileSync(liveDb);
  const origWalBytes = Buffer.from('simulated-wal-bytes');
  const origShmBytes = Buffer.from('simulated-shm-bytes');
  fs.writeFileSync(`${liveDb}-wal`, origWalBytes);
  fs.writeFileSync(`${liveDb}-shm`, origShmBytes);

  // Simulate atomic replacement failure after archive step
  assert.throws(() => {
    restoreDatabase({
      dbPath: liveDb,
      backupPath: goodBackup,
      force: true,
      _simulateAtomicFailure: true
    });
  }, /Simulated atomic replacement failure/);

  // Original DB and sidecars must be rolled back byte-for-byte
  assert.ok(fs.readFileSync(liveDb).equals(origDbBytes), 'Rolled-back live.db must match original bytes');
  assert.ok(fs.readFileSync(`${liveDb}-wal`).equals(origWalBytes), 'Rolled-back live.db-wal must match original bytes');
  assert.ok(fs.readFileSync(`${liveDb}-shm`).equals(origShmBytes), 'Rolled-back live.db-shm must match original bytes');

  // Verify no stray .konoha-recovery-stage-* or lock files remain
  const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('.konoha-recovery-stage-') || f.endsWith('.recovery.lock'));
  assert.strictEqual(leftovers.length, 0, `Staging and lock files must be cleaned up, found: ${leftovers.join(', ')}`);

  // Simulate active concurrent lock file and verify second recovery is rejected cleanly
  const lockFile = `${liveDb}.recovery.lock`;
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
  try {
    assert.throws(() => {
      restoreDatabase({ dbPath: liveDb, backupPath: goodBackup, force: true });
    }, /CONCURRENT_RECOVERY_LOCKED/);
  } finally {
    fs.unlinkSync(lockFile);
  }

  // Also verify autoRecoverIfNeeded end-to-end
  const corruptLive = fs.readFileSync(liveDb);
  for (let i = 16; i < 80; i++) corruptLive[i] = 0xCC;
  fs.writeFileSync(liveDb, corruptLive);
  const autoRes = autoRecoverIfNeeded(liveDb, goodBackup);
  assert.strictEqual(autoRes, true);
  assert.strictEqual(checkIntegrity(liveDb).ok, true);
  console.log('  ✓ Atomic rollback, sidecar preservation, staging cleanup, and concurrency lock verified');
}

console.log('\n====================================================');
console.log('✔ All SQLite disaster recovery & security tests passed!');
console.log('====================================================');
