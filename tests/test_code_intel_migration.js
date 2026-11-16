/**
 * Test Suite: schema v7 code-intelligence migration.
 *
 * Proves:
 *   1. Fresh schema reaches v7 with `code_edges` and all additive columns.
 *   2. v5 -> v7 and v6 -> v7 upgrade existing databases in place, idempotently,
 *      without losing existing rows or leaving foreign-key violations.
 *   3. `user_version` is written once per upgrade and ends at 7.
 *   4. FTS5 triggers and `rebuildAllFts` keep `code_chunks_fts` in sync.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-migration-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'migration.db');

const db = require('../src/db');
const dbSchema = require('../src/db_schema');
const store = require('../src/code_intel/store');

function tableNames(conn) {
  return conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
}

function userVersion(conn) {
  return conn.prepare('PRAGMA user_version').get().user_version;
}

function colNames(conn, table) {
  return conn.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

function run() {
  console.log('Running test_code_intel_migration tests...');

  // --- Fresh install reaches current schema version -----------------------
  const fresh = db.getConnection();
  db.setupSchema(fresh);
  assert.strictEqual(userVersion(fresh), dbSchema.CURRENT_SCHEMA_VERSION, `Fresh schema must land on user_version ${dbSchema.CURRENT_SCHEMA_VERSION}`);

  const tables = tableNames(fresh);
  for (const name of ['code_index_roots', 'code_files', 'code_symbols', 'code_refs', 'code_chunks', 'code_chunks_fts', 'code_edges']) {
    assert.ok(tables.includes(name), `Fresh schema must create ${name}`);
  }

  for (const col of ['mtime_ms', 'ctime_ms', 'inode_id', 'parser_version', 'content_kind', 'metrics_json']) {
    assert.ok(colNames(fresh, 'code_files').includes(col), `code_files must include v7 column ${col}`);
  }
  for (const col of ['chunk_kind', 'symbol_id', 'content_hash']) {
    assert.ok(colNames(fresh, 'code_chunks').includes(col), `code_chunks must include v7 column ${col}`);
  }
  for (const col of ['provenance', 'confidence']) {
    assert.ok(colNames(fresh, 'code_refs').includes(col), `code_refs must include v7 column ${col}`);
  }
  assert.ok(colNames(fresh, 'code_edges').includes('provenance'), 'code_edges must include v7 column provenance');
  assert.ok(colNames(fresh, 'code_index_roots').includes('indexed_epoch_ms'), 'code_index_roots must include indexed_epoch_ms');

  const indexes = fresh
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_code_%'")
    .all()
    .map((r) => r.name);
  assert.strictEqual(indexes.length, 10, `Expected 10 code indexes, found ${indexes.length}`);

  const triggers = fresh
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'code_chunks_%'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepStrictEqual(triggers, ['code_chunks_ad', 'code_chunks_ai', 'code_chunks_au']);

  const integrity = fresh.prepare('PRAGMA integrity_check').get();
  assert.strictEqual(Object.values(integrity)[0], 'ok', 'Fresh schema must pass integrity_check');
  const validation = dbSchema.validateCanonicalSchema(fresh);
  assert.strictEqual(validation.valid, true, `Canonical validation errors: ${validation.errors.join('; ')}`);

  // --- Idempotency: running setupSchema again is a no-op ------------------
  const before = tableNames(fresh).sort().join(',');
  db.setupSchema(fresh);
  assert.strictEqual(tableNames(fresh).sort().join(','), before, 'Second setupSchema must not change tables');
  assert.strictEqual(userVersion(fresh), dbSchema.CURRENT_SCHEMA_VERSION, `Second setupSchema must leave user_version at ${dbSchema.CURRENT_SCHEMA_VERSION}`);

  // --- v5 database upgrades in place, preserving data --------------------
  const legacyPath = path.join(tmpRoot, 'legacy.db');
  const legacy = db.getConnection(legacyPath, false);
  legacy.exec(`
    CREATE TABLE projects (
      project_hash TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      created_at TEXT
    );
    INSERT INTO projects (project_hash, project_path, created_at)
      VALUES ('abc123', '/tmp/legacy-project', '2026-01-01T00:00:00Z');
  `);
  legacy.exec('PRAGMA user_version = 5');
  assert.strictEqual(userVersion(legacy), 5);

  dbSchema.setupSchema(legacy, () => ({ ok: true, backupPath: null }));

  assert.strictEqual(userVersion(legacy), dbSchema.CURRENT_SCHEMA_VERSION, `Upgrade must write user_version ${dbSchema.CURRENT_SCHEMA_VERSION}`);
  assert.ok(tableNames(legacy).includes('code_index_roots'), 'Upgrade must add code tables');
  assert.ok(tableNames(legacy).includes('code_edges'), 'Upgrade must add code_edges table');
  const preserved = legacy.prepare('SELECT project_path FROM projects WHERE project_hash = ?').get('abc123');
  assert.strictEqual(preserved.project_path, '/tmp/legacy-project', 'Upgrade must not touch existing rows');

  // --- v6 database upgrades in place to v7, preserving code_* rows -------
  const v6Path = path.join(tmpRoot, 'v6_live.db');
  const v6 = db.getConnection(v6Path, false);
  v6.exec(`
    CREATE TABLE code_index_roots (
      root_hash TEXT PRIMARY KEY,
      root_path TEXT NOT NULL UNIQUE,
      head_sha TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'stale',
      file_count INTEGER NOT NULL DEFAULT 0,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT,
      updated_at TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE code_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      language TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE (root_hash, rel_path)
    );
    CREATE TABLE code_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent_name TEXT NOT NULL DEFAULT '',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      signature TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL,
      UNIQUE (file_id, name, kind, start_line)
    );
    CREATE TABLE code_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_hash TEXT NOT NULL REFERENCES code_index_roots(root_hash) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      target_name TEXT NOT NULL,
      target_symbol_id INTEGER REFERENCES code_symbols(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      line INTEGER NOT NULL
    );
    CREATE TABLE code_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_hash TEXT NOT NULL,
      file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      language TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      body TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      UNIQUE (file_id, chunk_index)
    );
    INSERT INTO code_index_roots (root_hash, root_path, status, updated_at)
      VALUES ('r1', '/tmp/v6repo', 'fresh', '2026-01-01T00:00:00Z');
    INSERT INTO code_files (root_hash, rel_path, language, byte_size, line_count, content_hash, indexed_at)
      VALUES ('r1', 'index.js', 'javascript', 16, 1, 'oldhash', '2026-01-01T00:00:00Z');
    INSERT INTO code_chunks (root_hash, file_id, rel_path, language, chunk_index, start_line, end_line, body)
      VALUES ('r1', 1, 'index.js', 'javascript', 0, 1, 1, 'function v6Keep() {}');
    PRAGMA user_version = 6;
  `);
  dbSchema.setupSchema(v6, () => ({ ok: true, backupPath: null }));
  assert.strictEqual(userVersion(v6), dbSchema.CURRENT_SCHEMA_VERSION, `v6 -> v${dbSchema.CURRENT_SCHEMA_VERSION} upgrade must land on user_version ${dbSchema.CURRENT_SCHEMA_VERSION}`);
  assert.ok(colNames(v6, 'code_files').includes('parser_version'), 'v6 -> v7 must add code_files.parser_version');
  assert.ok(colNames(v6, 'code_chunks').includes('content_hash'), 'v6 -> v7 must add code_chunks.content_hash');
  assert.ok(tableNames(v6).includes('code_edges'), 'v6 -> v7 must create code_edges');
  const v6Chunk = v6.prepare('SELECT body, chunk_kind FROM code_chunks WHERE root_hash = ?').get('r1');
  assert.strictEqual(v6Chunk.body, 'function v6Keep() {}', 'v6 -> v7 must preserve existing code_chunks rows');
  assert.strictEqual(v6Chunk.chunk_kind, 'block');
  const ftsRebuilt = db.rebuildAllFts(v6);
  assert.ok(ftsRebuilt.tables.includes('code_chunks_fts'), 'rebuildAllFts must rebuild code_chunks_fts');

  const fkViolations = legacy.prepare('PRAGMA foreign_key_check').all();
  assert.strictEqual(fkViolations.length, 0, 'Upgrade must leave zero foreign-key violations');

  // --- FTS triggers mirror code_chunks -----------------------------------
  const rootHash = store.ensureRoot(legacy, tmpRoot);
  const fileId = Number(legacy.prepare(`INSERT INTO code_files
      (root_hash, rel_path, language, byte_size, line_count, content_hash, indexed_at)
      VALUES (?, 'a.js', 'javascript', 10, 1, 'h1', '2026-01-01T00:00:00Z')`).run(rootHash).lastInsertRowid);
  legacy.prepare(`INSERT INTO code_chunks
      (root_hash, file_id, rel_path, language, chunk_index, start_line, end_line, body)
      VALUES (?, ?, 'a.js', 'javascript', 0, 1, 1, 'function zebra() {}')`).run(rootHash, fileId);

  const ftsCount = () => legacy.prepare('SELECT COUNT(*) AS c FROM code_chunks_fts').get().c;
  assert.strictEqual(ftsCount(), 1, 'Insert must propagate to code_chunks_fts');

  legacy.prepare('UPDATE code_chunks SET body = ? WHERE rel_path = ?').run('function giraffe() {}', 'a.js');
  const stale = legacy.prepare("SELECT COUNT(*) AS c FROM code_chunks_fts WHERE code_chunks_fts MATCH 'zebra'").get().c;
  const freshTerm = legacy.prepare("SELECT COUNT(*) AS c FROM code_chunks_fts WHERE code_chunks_fts MATCH 'giraffe'").get().c;
  assert.strictEqual(stale, 0, 'Update must remove the old term from the FTS index');
  assert.strictEqual(freshTerm, 1, 'Update must add the new term to the FTS index');

  legacy.prepare('DELETE FROM code_files WHERE id = ?').run(fileId);
  assert.strictEqual(ftsCount(), 0, 'Cascade delete must clear code_chunks_fts');

  // --- Deleting a root cascades to every child table ---------------------
  const root2 = store.ensureRoot(legacy, REPO_ROOT);
  legacy.prepare(`INSERT INTO code_files
      (root_hash, rel_path, language, byte_size, line_count, content_hash, indexed_at)
      VALUES (?, 'b.js', 'javascript', 10, 1, 'h2', '2026-01-01T00:00:00Z')`).run(root2);
  assert.strictEqual(store.removeRoot(legacy, REPO_ROOT), true, 'removeRoot must report the root it deleted');
  const orphans = legacy.prepare('SELECT COUNT(*) AS c FROM code_files WHERE root_hash = ?').get(root2).c;
  assert.strictEqual(orphans, 0, 'Root deletion must cascade to code_files');
  assert.strictEqual(store.removeRoot(legacy, REPO_ROOT), false, 'removeRoot on an absent root must return false');

  // --- Canonical code_chunks column order parity after v6 -> v7 upgrade ---
  assert.deepStrictEqual(
    colNames(v6, 'code_chunks'),
    colNames(fresh, 'code_chunks'),
    'Upgraded v6 code_chunks column order must match fresh canonical DDL'
  );
  // Stale v7 DB with trailing v7 columns heals automatically via ensureSchema
  const staleV7Path = path.join(tmpRoot, 'stale_v7.db');
  const staleV7 = db.getConnection(staleV7Path, false);
  staleV7.exec(`
    CREATE TABLE projects (project_hash TEXT PRIMARY KEY, project_path TEXT NOT NULL, project_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE code_index_roots (root_hash TEXT PRIMARY KEY, root_path TEXT NOT NULL UNIQUE, head_sha TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'stale', file_count INTEGER NOT NULL DEFAULT 0, symbol_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0, indexed_epoch_ms INTEGER NOT NULL DEFAULT 0, indexed_at TEXT, updated_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
    CREATE TABLE code_files (id INTEGER PRIMARY KEY AUTOINCREMENT, root_hash TEXT NOT NULL, rel_path TEXT NOT NULL, language TEXT NOT NULL, byte_size INTEGER NOT NULL, line_count INTEGER NOT NULL, content_hash TEXT NOT NULL, mtime_ms REAL NOT NULL DEFAULT 0, ctime_ms REAL NOT NULL DEFAULT 0, inode_id TEXT NOT NULL DEFAULT '', parser_version TEXT NOT NULL DEFAULT '', content_kind TEXT NOT NULL DEFAULT 'code', metrics_json TEXT NOT NULL DEFAULT '{}', indexed_at TEXT NOT NULL);
    CREATE TABLE code_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, root_hash TEXT NOT NULL, file_id INTEGER NOT NULL, rel_path TEXT NOT NULL, language TEXT NOT NULL, chunk_index INTEGER NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, body TEXT NOT NULL, embedding BLOB, embedding_model TEXT, chunk_kind TEXT NOT NULL DEFAULT 'block', symbol_id INTEGER, content_hash TEXT NOT NULL DEFAULT '', UNIQUE (file_id, chunk_index));
    PRAGMA user_version = 7;
  `);
  dbSchema.ensureSchema(staleV7, db.backupDatabase);
  assert.deepStrictEqual(colNames(staleV7, 'code_chunks'), colNames(fresh, 'code_chunks'), 'Stale v7 code_chunks must self-heal to canonical column order');
  staleV7.close();

  // --- Fail-closed pre-migration backup checks ---------------------------
  const failBackupPath = path.join(tmpRoot, 'fail_backup.db');
  const failConn = db.getConnection(failBackupPath, false);
  failConn.exec("CREATE TABLE user_notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO user_notes VALUES (1, 'precious'); PRAGMA user_version = 5;");
  assert.throws(
    () => dbSchema.setupSchema(failConn, () => { throw new Error('disk full'); }),
    /PRE_MIGRATION_BACKUP_FAILED.*disk full/,
    'Throwing backup callback must abort migration fail-closed'
  );
  assert.strictEqual(userVersion(failConn), 5, 'Failed backup must not advance user_version');
  assert.ok(!tableNames(failConn).includes('code_index_roots'), 'Failed backup must not apply partial schema changes');
  assert.strictEqual(failConn.prepare('SELECT body FROM user_notes WHERE id = 1').get().body, 'precious');

  const bogusBackupFile = path.join(tmpRoot, 'corrupt_backup.db');
  fs.writeFileSync(bogusBackupFile, 'not-a-sqlite-file', 'utf8');
  assert.throws(
    () => dbSchema.setupSchema(failConn, () => ({ ok: true, targetPath: bogusBackupFile })),
    /PRE_MIGRATION_BACKUP_FAILED/,
    'Corrupt or truncated backup must abort migration fail-closed'
  );
  assert.strictEqual(userVersion(failConn), 5, 'Invalid backup must leave user_version untouched');

  // Unwritable default backup path (regular file blocking backups directory)
  const blockedDir = path.join(tmpRoot, 'blocked_backup_dir');
  fs.mkdirSync(blockedDir, { recursive: true });
  fs.writeFileSync(path.join(blockedDir, 'backups'), 'blocker-file', 'utf8');
  const blockedDbPath = path.join(blockedDir, 'blocked.db');
  const blockedConn = db.getConnection(blockedDbPath, false);
  blockedConn.exec('CREATE TABLE user_notes (id INTEGER PRIMARY KEY, body TEXT); PRAGMA user_version = 5;');
  assert.throws(
    () => dbSchema.setupSchema(blockedConn),
    /PRE_MIGRATION_BACKUP_FAILED/,
    'Unwritable default backup destination must abort migration fail-closed'
  );
  assert.strictEqual(userVersion(blockedConn), 5);
  blockedConn.close();
  failConn.close();

  // --- Mid-migration failure rolls back & leaves user_version unbumped ---
  const midFailDir = path.join(tmpRoot, 'mid_fail_dir');
  fs.mkdirSync(midFailDir, { recursive: true });
  const midFailPath = path.join(midFailDir, 'mid_fail.db');
  const midFailConn = db.getConnection(midFailPath, false);
  midFailConn.exec(`
    CREATE TABLE projects (project_hash TEXT PRIMARY KEY, project_path TEXT NOT NULL, created_at TEXT);
    INSERT INTO projects VALUES ('p1', '/tmp/keep-me', '2026-01-01');
    CREATE TABLE code_edges (broken_col INTEGER);
    PRAGMA user_version = 6;
  `);
  assert.throws(
    () => dbSchema.setupSchema(midFailConn, db.backupDatabase),
    /CODE_INTEL_MIGRATION_FAILED/i,
    'Mid-migration failure must throw instead of silently continuing'
  );
  assert.strictEqual(userVersion(midFailConn), 6, 'Mid-migration failure must NOT advance user_version');
  assert.strictEqual(
    midFailConn.prepare('SELECT project_path FROM projects WHERE project_hash = ?').get('p1').project_path,
    '/tmp/keep-me',
    'Rollback must preserve pre-migration user data'
  );
  assert.ok(!tableNames(midFailConn).includes('code_index_roots'), 'Rollback must undo newly created migration tables');
  const midFailBackupsDir = path.join(midFailDir, 'backups');
  assert.ok(fs.existsSync(midFailBackupsDir) && fs.readdirSync(midFailBackupsDir).some((f) => f.endsWith('.db')), 'Verified pre-migration backup must remain on disk');
  midFailConn.close();

  // --- Integrity failure during migration aborts, rolls back, and recovers via backup ---
  const integDir = path.join(tmpRoot, 'integrity_fail');
  fs.mkdirSync(integDir, { recursive: true });
  const integDbPath = path.join(integDir, 'integ_fail.db');
  const integConn = db.getConnection(integDbPath, false);
  integConn.exec(`
    CREATE TABLE projects (project_hash TEXT PRIMARY KEY, project_path TEXT NOT NULL, project_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects VALUES ('p_orig', '/tmp/original-project', 'orig', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    PRAGMA user_version = 6;
  `);

  const { restoreFromVerifiedBackupFile } = require('../src/db_migration_safety');
  // Create verified pre-migration backup on healthy DB, then introduce a real SQLite
  // CHECK constraint anomaly so PRAGMA integrity_check fails inside _verifyPostMigrationOrThrow.
  const backupFnWithIntegrityFault = (label, dbPath) => {
    const backupPath = db.backupDatabase(label, dbPath);
    integConn.exec(`
      CREATE TABLE _check_fault (val TEXT CHECK(length(val) > 5));
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO _check_fault VALUES ('bad');
      PRAGMA ignore_check_constraints = OFF;
    `);
    return backupPath;
  };

  let caughtIntegErr = null;
  try {
    dbSchema.setupSchema(integConn, backupFnWithIntegrityFault);
  } catch (err) {
    caughtIntegErr = err;
  }
  assert.ok(caughtIntegErr, 'Forced verifyIntegrity() failure must abort setupSchema');
  assert.match(caughtIntegErr.message, /INTEGRITY ERROR|SCHEMA INTEGRITY FAILURE/i, 'Must report integrity error from verifyIntegrity()');
  assert.match(caughtIntegErr.message, /CHECK constraint failed/i, 'Must include underlying SQLite integrity_check failure detail');
  assert.ok(caughtIntegErr.backupPath && fs.existsSync(caughtIntegErr.backupPath), 'Aborted migration must attach verified pre-migration err.backupPath');
  assert.strictEqual(userVersion(integConn), 6, 'Aborted migration must NOT advance PRAGMA user_version');
  assert.strictEqual(
    integConn.prepare('SELECT project_path FROM projects WHERE project_hash = ?').get('p_orig').project_path,
    '/tmp/original-project',
    'Savepoint rollback must keep pre-migration rows intact'
  );
  assert.ok(!tableNames(integConn).includes('code_index_roots'), 'Savepoint rollback must leave no partial v7 tables');
  integConn.close();

  // Recover DB cleanly from the pre-migration verified backup
  restoreFromVerifiedBackupFile(integDbPath, caughtIntegErr.backupPath);
  const recoveredConn = db.getConnection(integDbPath, false);
  assert.strictEqual(dbSchema.verifyIntegrity(recoveredConn), true, 'Restored pre-migration backup must pass verifyIntegrity()');
  assert.strictEqual(userVersion(recoveredConn), 6, 'Restored backup must preserve pre-migration user_version 6');
  assert.strictEqual(
    recoveredConn.prepare('SELECT project_path FROM projects WHERE project_hash = ?').get('p_orig').project_path,
    '/tmp/original-project',
    'Restored backup must preserve pre-migration user data'
  );
  dbSchema.setupSchema(recoveredConn, db.backupDatabase);
  assert.strictEqual(userVersion(recoveredConn), dbSchema.CURRENT_SCHEMA_VERSION, `Cleanly restored DB must migrate to v${dbSchema.CURRENT_SCHEMA_VERSION} without partial state`);
  recoveredConn.close();

  console.log('✓ Code-intelligence migration, integrity failure rollback, backup recovery, idempotency, FTS triggers, and cascade verified.');
}

run();
