'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../src/sqlite_driver');

console.log('Running test_sqlite_driver.js...');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-driver-test-'));
const dbPath = path.join(tmpDir, 'test.db');

try {
  const db = new Database(dbPath);
  assert.strictEqual(db.open, true, 'Database should be open');
  assert.strictEqual(db.readonly, false, 'Database should not be readonly');
  assert.strictEqual(db.inTransaction, false, 'Database should not initially be in transaction');

  // PRAGMA & Exec
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const journalMode = db.pragma('journal_mode', { simple: true });
  assert.strictEqual(journalMode, 'wal', 'journal_mode should be wal');

  // Schema creation
  db.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score REAL,
      payload BLOB,
      is_active INTEGER DEFAULT 1
    );
    CREATE VIRTUAL TABLE items_fts USING fts5(name, content=items, content_rowid=id);
    CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, name) VALUES (new.id, new.name);
    END;
  `);

  // Prepared statement - run with named parameters & lenient types (boolean, undefined, buffer)
  const insertStmt = db.prepare('INSERT INTO items (name, score, payload, is_active) VALUES (@name, @score, @payload, @is_active)');
  const res1 = insertStmt.run({
    name: 'first item',
    score: 98.5,
    payload: Buffer.from('hello-blob'),
    is_active: true,
    extra_field_ignored: 'ignore me'
  });
  assert.strictEqual(res1.changes, 1, 'changes should be 1');
  assert.strictEqual(res1.lastInsertRowid, 1, 'lastInsertRowid should be 1');

  // Positional parameters
  const insertPos = db.prepare('INSERT INTO items (name, score, payload, is_active) VALUES (?, ?, ?, ?)');
  insertPos.run('second item', 88.0, null, false);

  // Statement get
  const row1 = db.prepare('SELECT * FROM items WHERE id = ?').get(1);
  assert.strictEqual(row1.name, 'first item');
  assert.strictEqual(row1.score, 98.5);
  assert.strictEqual(row1.is_active, 1);
  assert.ok(Buffer.isBuffer(row1.payload), 'Blob should be normalized to Buffer');
  assert.strictEqual(row1.payload.toString(), 'hello-blob');

  // Statement all
  const allRows = db.prepare('SELECT id, name FROM items ORDER BY id ASC').all();
  assert.strictEqual(allRows.length, 2);
  assert.strictEqual(allRows[0].name, 'first item');
  assert.strictEqual(allRows[1].name, 'second item');

  // Statement iterate
  const names = [];
  for (const row of db.prepare('SELECT name FROM items ORDER BY id ASC').iterate()) {
    names.push(row.name);
  }
  assert.deepStrictEqual(names, ['first item', 'second item']);

  // FTS5 MATCH and bm25()
  const searchResults = db.prepare('SELECT rowid, bm25(items_fts) AS rank FROM items_fts WHERE items_fts MATCH ?').all('first');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].rowid, 1);

  // Transactions: commit
  const txCommit = db.transaction((namesToAdd) => {
    for (const n of namesToAdd) {
      insertStmt.run({ name: n, score: 50.0, payload: null, is_active: 1 });
    }
  });
  txCommit(['tx1', 'tx2']);
  assert.strictEqual(db.prepare('SELECT count(*) AS cnt FROM items').get().cnt, 4);

  // Transactions: rollback
  const txFail = db.transaction(() => {
    insertStmt.run({ name: 'will rollback', score: 10.0, payload: null, is_active: 1 });
    throw new Error('intentional failure');
  });
  assert.throws(() => txFail(), /intentional failure/);
  assert.strictEqual(db.prepare('SELECT count(*) AS cnt FROM items').get().cnt, 4, 'Rollback should restore count');
  assert.strictEqual(db.inTransaction, false, 'inTransaction must be false after rollback');

  // Nested transactions (savepoints)
  const nestedTx = db.transaction(() => {
    insertStmt.run({ name: 'outer', score: 1.0, payload: null, is_active: 1 });
    try {
      db.transaction(() => {
        insertStmt.run({ name: 'inner fail', score: 2.0, payload: null, is_active: 1 });
        throw new Error('inner rollback');
      })();
    } catch (_) {
      // Caught inner error; outer transaction proceeds
    }
    insertStmt.run({ name: 'outer2', score: 3.0, payload: null, is_active: 1 });
  });
  nestedTx();

  const finalNames = db.prepare("SELECT name FROM items WHERE name LIKE 'outer%'").all().map(r => r.name);
  assert.deepStrictEqual(finalNames, ['outer', 'outer2'], 'Inner savepoint rolled back while outer committed');

  db.close();
  assert.strictEqual(db.open, false, 'Database should be closed');

  console.log('✓ All test_sqlite_driver.js assertions passed cleanly!');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
