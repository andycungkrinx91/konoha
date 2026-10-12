'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../src/sqlite_driver');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_g08_'));
const dbPath = path.join(tmpDir, 'test_concurrency.db');

try {
  // Test 1: Immediate write lock acquisition upfront
  {
    const db1 = new Database(dbPath);
    db1.exec("PRAGMA journal_mode = WAL; CREATE TABLE records (id INTEGER PRIMARY KEY, val TEXT);");
    const db2 = new Database(dbPath);
    db2.exec("PRAGMA busy_timeout = 50;");

    let lockErrorCaught = false;
    const tx = db1.transaction(() => {
      // Prior to any statement executions, db1 must already hold the RESERVED/write lock
      try {
        db2.exec("BEGIN IMMEDIATE");
        db2.exec("ROLLBACK");
      } catch (err) {
        if (/database is locked/i.test(err.message)) {
          lockErrorCaught = true;
        } else {
          throw err;
        }
      }
      db1.prepare("INSERT INTO records (val) VALUES (?)").run('test-val');
    });

    tx();

    assert.strictEqual(
      lockErrorCaught,
      true,
      'db.transaction() must execute BEGIN IMMEDIATE so concurrent writers are locked out upfront'
    );

    db1.close();
    db2.close();
  }

  // Test 2: Nested transactions (savepoints) work properly with BEGIN IMMEDIATE
  {
    const db = new Database(dbPath);
    let innerCommitted = false;
    const outerTx = db.transaction(() => {
      db.prepare("INSERT INTO records (val) VALUES (?)").run('outer');
      const innerTx = db.transaction(() => {
        db.prepare("INSERT INTO records (val) VALUES (?)").run('inner');
        innerCommitted = true;
      });
      innerTx();
    });

    outerTx();
    assert.strictEqual(innerCommitted, true, 'Nested transactions must succeed with savepoints');

    const rows = db.prepare("SELECT count(*) as c FROM records WHERE val IN ('outer', 'inner')").get();
    assert.strictEqual(rows.c, 2);
    db.close();
  }

  console.log('test_sqlite_immediate: PASS');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
