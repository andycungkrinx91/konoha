#!/usr/bin/env node
'use strict';

/**
 * tests/test_bridge_gateway.js — Test Konoha Bridge Router database schemas and operations.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');

async function run() {
  console.log('Running test_bridge_gateway tests...');
  const dbPath = db.DB_PATH;
  assert.ok(fs.existsSync(dbPath), `Database missing: ${dbPath}. Run migration first.`);

  const conn = db.getDb(dbPath);
  try {
    // 1. Bridges schema
    const cols = conn.prepare('PRAGMA table_info(bridges);').all();
    const colMap = {};
    for (const c of cols) {
      colMap[c.name] = c.type;
    }
    const expectedColumns = ['name', 'port', 'provider', 'enabled', 'target_url', 'api_key'];
    for (const col of expectedColumns) {
      assert.ok(col in colMap, `Column '${col}' is missing from bridges table.`);
    }
    console.log('✓ Bridges schema verified');

    // 2. Bridge creation and retrieval
    conn.prepare(`
      INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
      VALUES ('test_bridge', 12345, 'openai', 1, 'http://localhost:12345', 'dummy_key')
    `).run();

    const row = conn.prepare("SELECT port, provider FROM bridges WHERE name='test_bridge'").get();
    assert.ok(row, 'Bridge row must exist');
    assert.strictEqual(row.port, 12345);
    assert.strictEqual(row.provider, 'openai');

    // Clean up
    conn.prepare("DELETE FROM bridges WHERE name='test_bridge'").run();
    const rowAfter = conn.prepare("SELECT port, provider FROM bridges WHERE name='test_bridge'").get();
    assert.strictEqual(rowAfter, undefined);
    console.log('✓ Bridge creation and retrieval verified');

    console.log('\nAll test_bridge_gateway tests passed!');
  } finally {
    conn.close();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
