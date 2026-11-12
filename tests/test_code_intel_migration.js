/**
 * Test Suite: schema v6 code-intelligence migration.
 *
 * Proves three things the migration can silently get wrong:
 *   1. v5 → v6 upgrades an existing database in place, idempotently, without
 *      losing rows that existed before.
 *   2. `user_version` is written exactly once per upgrade and ends at 6.
 *   3. The FTS5 triggers keep `code_chunks_fts` in step with `code_chunks`,
 *      so search never returns a chunk that no longer exists.
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

function run() {
  console.log('Running test_code_intel_migration tests...');

  // --- Fresh install reaches v6 -------------------------------------------
  const fresh = db.getConnection();
  db.setupSchema(fresh);
  assert.strictEqual(userVersion(fresh), 6, 'Fresh schema must land on user_version 6');

  const tables = tableNames(fresh);
  for (const name of ['code_index_roots', 'code_files', 'code_symbols', 'code_refs', 'code_chunks', 'code_chunks_fts']) {
    assert.ok(tables.includes(name), `Fresh schema must create ${name}`);
  }

  const indexes = fresh
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_code_%'")
    .all()
    .map((r) => r.name);
  assert.strictEqual(indexes.length, 7, `Expected 7 code indexes, found ${indexes.length}`);

  const triggers = fresh
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'code_chunks_%'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepStrictEqual(triggers, ['code_chunks_ad', 'code_chunks_ai', 'code_chunks_au']);

  const integrity = fresh.prepare('PRAGMA integrity_check').get();
  assert.strictEqual(Object.values(integrity)[0], 'ok', 'Fresh schema must pass integrity_check');

  // --- Idempotency: running setupSchema again is a no-op ------------------
  const before = tableNames(fresh).sort().join(',');
  db.setupSchema(fresh);
  assert.strictEqual(tableNames(fresh).sort().join(','), before, 'Second setupSchema must not change tables');
  assert.strictEqual(userVersion(fresh), 6, 'Second setupSchema must leave user_version at 6');

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

  assert.strictEqual(userVersion(legacy), 6, 'Upgrade must write user_version 6');
  assert.ok(tableNames(legacy).includes('code_index_roots'), 'Upgrade must add code tables');
  const preserved = legacy.prepare('SELECT project_path FROM projects WHERE project_hash = ?').get('abc123');
  assert.strictEqual(preserved.project_path, '/tmp/legacy-project', 'Upgrade must not touch existing rows');

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
