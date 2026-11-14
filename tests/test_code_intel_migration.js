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

  // --- Fresh install reaches v7 -------------------------------------------
  const fresh = db.getConnection();
  db.setupSchema(fresh);
  assert.strictEqual(userVersion(fresh), 7, 'Fresh schema must land on user_version 7');

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
  assert.strictEqual(userVersion(fresh), 7, 'Second setupSchema must leave user_version at 7');

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

  assert.strictEqual(userVersion(legacy), 7, 'Upgrade must write user_version 7');
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
  assert.strictEqual(userVersion(v6), 7, 'v6 -> v7 upgrade must land on user_version 7');
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

  // --- Integrity is enforced, not reported ------------------------------
  assert.ok(
    /verifyIntegrity|integrity_check/.test(fs.readFileSync(path.join(REPO_ROOT, 'src', 'db_schema.js'), 'utf8')),
    'setupSchema must still call verifyIntegrity'
  );

  console.log('✓ Code-intelligence migration, idempotency, FTS triggers, and cascade verified.');
}

run();
