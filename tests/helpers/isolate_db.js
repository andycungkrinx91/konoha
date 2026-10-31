/**
 * Test DB isolation helper.
 *
 * Point src/db.js at a throwaway temp database for this test process (and any
 * child processes it spawns, since they inherit the env), then initialize the
 * full schema in it. This prevents SDLC / workflow / delegation test suites
 * from writing junk task rows into the production database at
 * ~/.konoha/konoha.db while still behaving like a real Konoha runtime.
 *
 * Usage: require this file BEFORE any other src/ module in a test suite:
 *   require('./helpers/isolate_db');
 * or './isolate_db' when the helper lives next to the suite.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.KONOHA_DB_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_db_'));
  process.env.KONOHA_DB_PATH = path.join(dir, 'test.db');
}

// Initialize the schema in the isolated DB (getConnection does NOT auto-create
// tables; production DBs were initialized at install time).
let dbPath = process.env.KONOHA_DB_PATH;
try {
  const db = require('../../src/db');
  const conn = db.getConnection(null, false);
  db.setupSchema(conn);

  // Assert 100% schema parity against live production DB if present
  const prodPath = path.normalize(path.join(os.homedir(), '.konoha', 'konoha.db'));
  if (fs.existsSync(prodPath)) {
    const Database = require('../../src/sqlite_driver');
    const prodConn = new Database(prodPath, { readonly: true });
    try {
      const prodTables = prodConn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '_sqliteai%' AND name NOT LIKE 'vector0_%' ORDER BY name").all().map(r => r.name);
      const testTables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '_sqliteai%' AND name NOT LIKE 'vector0_%' ORDER BY name").all().map(r => r.name);
      for (const t of prodTables) {
        if (!testTables.includes(t)) {
          throw new Error(`[isolate_db] Schema parity error: table '${t}' missing from isolated DB`);
        }
        const prodCols = prodConn.prepare(`PRAGMA table_info(${t})`).all().map(c => `${c.name}:${c.type}:${c.pk}`);
        const testCols = conn.prepare(`PRAGMA table_info(${t})`).all().map(c => `${c.name}:${c.type}:${c.pk}`);
        if (prodCols.join(',') !== testCols.join(',')) {
          throw new Error(`[isolate_db] Schema parity error: column mismatch for table '${t}'`);
        }
        const prodFks = prodConn.prepare(`PRAGMA foreign_key_list(${t})`).all();
        const testFks = conn.prepare(`PRAGMA foreign_key_list(${t})`).all();
        if (prodFks.length !== testFks.length) {
          throw new Error(`[isolate_db] Schema parity error: FK count mismatch for table '${t}'`);
        }
      }
    } finally {
      try { prodConn.close(); } catch (_) {}
    }
  }

  conn.close();
  dbPath = db.DB_PATH;
} catch (e) {
  // Non-fatal: suites that manage their own schema will still work.
  console.error(`[isolate_db] schema init warning: ${e.message}`);
}

module.exports = { dbPath };
