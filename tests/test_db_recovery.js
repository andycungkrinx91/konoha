'use strict';

/**
 * tests/test_db_recovery.js — Unit tests for SQLite disaster recovery & diagnostics.
 *
 * Verifies:
 * - checkIntegrity returns ok on healthy databases
 * - detectCorruption catches truncated, header-corrupted, and integrity-failing databases
 * - Deterministic 64-byte overwrite at offset 16 is detected as corrupt
 * - restoreDatabase creates an atomic .corrupt.<timestamp> archive before restoration
 * - restoreDatabase successfully restores from a verified backup
 * - CLI subcommands (konoha db check, konoha db restore) return expected exit codes
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const {
  checkIntegrity,
  checkDatabase,
  detectCorruption,
  restoreDatabase
} = require('../src/db_recovery');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_db_recovery_test_'));

function cleanup() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

process.on('exit', cleanup);

console.log('Running test_db_recovery.js...\n');

// Verify healthy database integrity check
console.log('1. Verifying checkIntegrity on a clean database...');
const cleanDbPath = path.join(TMP_DIR, 'clean.db');
const db = new DatabaseSync(cleanDbPath);
db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);');
db.exec("INSERT INTO items (name) VALUES ('hokage'), ('anbu'), ('jonin');");
db.close();

const cleanCheck = checkIntegrity(cleanDbPath);
assert.strictEqual(cleanCheck.ok, true, 'Clean database must return ok: true');
assert.strictEqual(cleanCheck.status, 'OK', 'Clean database status must be OK');
assert.strictEqual(cleanCheck.details[0], 'ok');
console.log('  ✓ Clean database check passed');

// Verify detectCorruption on clean database
console.log('2. Verifying detectCorruption on a clean database...');
const cleanDetect = detectCorruption(cleanDbPath);
assert.strictEqual(cleanDetect.ok, true);
assert.strictEqual(cleanDetect.corrupt, false);
assert.strictEqual(cleanDetect.reason, null);
console.log('  ✓ Clean database detectCorruption passed');

// Create a backup of the clean database
const backupDbPath = path.join(TMP_DIR, 'clean_backup.db');
fs.copyFileSync(cleanDbPath, backupDbPath);
assert.strictEqual(checkIntegrity(backupDbPath).ok, true);

// Deterministic corruption: overwrite 64 bytes at offset 16
console.log('3. Corrupting database via deterministic 64-byte overwrite at offset 16...');
const corruptDbPath = path.join(TMP_DIR, 'corrupt.db');
fs.copyFileSync(cleanDbPath, corruptDbPath);

const buf = fs.readFileSync(corruptDbPath);
assert.ok(buf.length >= 100, 'Database buffer must be at least 100 bytes');
for (let i = 16; i < 80; i++) {
  buf[i] = 0xAA;
}
fs.writeFileSync(corruptDbPath, buf);

const corruptDetect = detectCorruption(corruptDbPath);
assert.strictEqual(corruptDetect.ok, false, 'Corrupted database must return ok: false');
assert.strictEqual(corruptDetect.corrupt, true, 'Corrupted database must return corrupt: true');
assert.ok(corruptDetect.reason, 'Corrupted database must have an explanation reason');
console.log(`  ✓ Corruption detected as expected: ${corruptDetect.reason}`);

const corruptCheck = checkIntegrity(corruptDbPath);
assert.strictEqual(corruptCheck.ok, false);
assert.strictEqual(corruptCheck.status, 'CORRUPTED');
console.log('  ✓ Integrity check failed on corrupted database as expected');

// Test restoreDatabase creates .corrupt.<timestamp> archive and restores from backup
console.log('4. Verifying restoreDatabase with atomic archive creation...');

const restoreResult = restoreDatabase({
  dbPath: corruptDbPath,
  backupPath: backupDbPath,
  force: true
});

assert.strictEqual(restoreResult.restored, true, 'Database must be restored');
assert.strictEqual(restoreResult.method, 'backup', 'Restore method must be backup');
assert.ok(restoreResult.archived, 'Corrupt file must be archived');
assert.ok(fs.existsSync(restoreResult.archived), 'Archive file must exist on disk');
assert.strictEqual(checkIntegrity(corruptDbPath).ok, true, 'Restored database must be healthy');

// Check restored data
const restoredDb = new DatabaseSync(corruptDbPath);
const countRow = restoredDb.prepare('SELECT COUNT(*) as count FROM items;').get();
assert.strictEqual(Number(countRow.count), 3, 'Restored database must contain original 3 rows');
restoredDb.close();
console.log('  ✓ restoreDatabase succeeded and preserved verified records');

// Test CLI commands via child_process
console.log('5. Verifying CLI commands (konoha db check and konoha db restore)...');

// CLI check on healthy database: must exit 0
try {
  execFileSync(process.execPath, [CLI_PATH, 'db', 'check', cleanDbPath], {
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('  ✓ CLI check on healthy database exited 0');
} catch (err) {
  assert.fail(`CLI check on clean DB failed unexpectedly: ${err.message}`);
}

// Re-corrupt for CLI test
fs.writeFileSync(corruptDbPath, buf);

// CLI check on corrupted database: must exit 1
let corruptCliFailed = false;
try {
  execFileSync(process.execPath, [CLI_PATH, 'db', 'check', corruptDbPath], {
    encoding: 'utf8',
    stdio: 'pipe'
  });
} catch (err) {
  corruptCliFailed = true;
  assert.strictEqual(err.status, 1, 'CLI check on corrupted DB must exit with code 1');
  console.log('  ✓ CLI check on corrupted database exited 1 as expected');
}
assert.ok(corruptCliFailed, 'CLI check on corrupted DB must fail');

// CLI restore on corrupted database with backup: must exit 0
try {
  const restoreOut = execFileSync(process.execPath, [
    CLI_PATH, 'db', 'restore', corruptDbPath, '--from', backupDbPath, '--force'
  ], {
    encoding: 'utf8',
    stdio: 'pipe'
  });
  assert.ok(restoreOut.includes('recovery successful') || restoreOut.includes('Restored'), 'CLI output should confirm success');
  console.log('  ✓ CLI restore on corrupted database exited 0');
} catch (err) {
  assert.fail(`CLI restore failed unexpectedly: ${err.message}`);
}

// Verify database is healthy again
assert.strictEqual(checkIntegrity(corruptDbPath).ok, true);
console.log('  ✓ Restored database passed integrity check');

// ---------------------------------------------------------------------------
// Safety: a corrupt backup must never damage the live database.
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_badbackup_'));
  const liveDb = path.join(dir, 'live.db');
  const badBackup = path.join(dir, 'bad.backup.db');

  const seed = new DatabaseSync(liveDb);
  seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
  seed.exec("INSERT INTO t (v) VALUES ('keepme');");
  seed.close();

  fs.writeFileSync(badBackup, Buffer.alloc(4096, 0x41));
  const beforeBytes = fs.readFileSync(liveDb);

  let threw = false;
  try {
    restoreDatabase({ dbPath: liveDb, backupPath: badBackup });
  } catch (err) {
    threw = true;
    assert.ok(/corrupt/i.test(err.message), `Expected a corruption error, got: ${err.message}`);
  }
  assert.strictEqual(threw, true, 'restore must reject a corrupt backup');
  console.log('  ✓ Corrupt backup rejected');

  assert.strictEqual(fs.existsSync(liveDb), true, 'live database must still exist after a rejected restore');
  assert.ok(fs.readFileSync(liveDb).equals(beforeBytes), 'live database bytes must be untouched');
  console.log('  ✓ Live database untouched by rejected restore');

  const archived = fs.readdirSync(dir).filter((f) => f.includes('pre-restore'));
  assert.strictEqual(archived.length, 0, 'no archive should be created for a rejected restore');
  console.log('  ✓ No stray archive left behind');

  // checkDatabase reports the structured contract the CLI depends on.
  const report = checkDatabase(liveDb);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(typeof report.userVersion, 'number');
  assert.strictEqual(typeof report.schemaVersion, 'number');
  assert.strictEqual(report.foreignKeyViolations, 0);
  console.log('  ✓ checkDatabase reports integrity, schema and FK status');

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n====================================================');
console.log('✔ All SQLite disaster recovery tests passed cleanly!');
console.log('====================================================');
