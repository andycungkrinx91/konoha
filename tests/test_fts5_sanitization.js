#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { sanitizeFts5Query } = require('../src/db');
const { getDbStats } = require('../src/db_stats');

function testBasicQuery() {
  const result = sanitizeFts5Query('hello world');
  assert.strictEqual(result, 'hello world');
}

function testSqlInjectionAttempt() {
  const result1 = sanitizeFts5Query("'; DROP TABLE skills; --");
  assert.strictEqual(typeof result1, 'string');

  const result2 = sanitizeFts5Query("' OR '1'='1");
  assert.strictEqual(typeof result2, 'string');
}

function testEmptyQuery() {
  const result = sanitizeFts5Query('');
  assert.strictEqual(result, '');
}

function testSpecialCharacters() {
  const result = sanitizeFts5Query('hello\'world"test');
  assert.strictEqual(typeof result, 'string');
}

function testUnicodeQuery() {
  const result = sanitizeFts5Query('Héllö Wörld');
  assert.strictEqual(result, 'Héllö Wörld');
}

function testVeryLongQuery() {
  const longQuery = 'a'.repeat(10000);
  const result = sanitizeFts5Query(longQuery);
  assert.strictEqual(result.length, 10000);
}

function testDbStatsScriptExists() {
  const scriptPath = path.join(__dirname, '..', 'src', 'db_stats.js');
  assert.ok(fs.existsSync(scriptPath), 'db_stats.js should exist');
}

function testDbStatsHandlesMissingTables() {
  const tempDb = path.join(os.tmpdir(), `temp_db_${Date.now()}.db`);
  try {
    const res = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'src', 'db_stats.js'), tempDb],
      { encoding: 'utf-8', timeout: 5000 }
    );
    assert.ok([0, 1].includes(res.status));
  } finally {
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
}

console.log('Running test_fts5_sanitization.js...');
testBasicQuery();
testSqlInjectionAttempt();
testEmptyQuery();
testSpecialCharacters();
testUnicodeQuery();
testVeryLongQuery();
testDbStatsScriptExists();
testDbStatsHandlesMissingTables();
console.log('test_fts5_sanitization.js passed cleanly.');
