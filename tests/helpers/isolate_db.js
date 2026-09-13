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
  conn.close();
  dbPath = db.DB_PATH;
} catch (e) {
  // Non-fatal: suites that manage their own schema will still work.
  console.error(`[isolate_db] schema init warning: ${e.message}`);
}

module.exports = { dbPath };
