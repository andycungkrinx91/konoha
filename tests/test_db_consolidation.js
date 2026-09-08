#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const db = require('../src/db');
const server = require('../src/server');
const migrate = require('../src/migrate');
const db_agents = require('../src/db_agents');
const db_bridges = require('../src/db_bridges');
const persona_memory = require('../src/persona_memory');

function testCanonicalDbPathOwnership() {
  assert.strictEqual(typeof db.DB_PATH, 'string');
  assert.ok(db.DB_PATH.endsWith('konoha.db'));
}

function testSkillsTableColumnSetRegression() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-db-cols-'));
  try {
    const testDb = path.join(tmp, 'test.db');
    const conn = db.getConnection(testDb);
    db.setupSchema(conn);

    const columns = new Set(conn.prepare("PRAGMA table_info(skills);").all().map(r => r.name));
    conn.close();

    const expectedColumns = new Set([
      'name', 'skill_name', 'type', 'tags',
      'content', 'file_path', 'byte_size', 'line_count'
    ]);
    assert.deepStrictEqual(columns, expectedColumns, 'Skills table columns do not match canonical schema');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testWalJournalModeAcrossEntrypoints() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-wal-test-'));
  try {
    const entrypoints = [
      ['db.getConnection', p => db.getConnection(p)],
      ['server.getDb', p => server.getDb(p)],
      ['migrate.setupDb', p => migrate.setupDb(p)],
      ['db_agents.getDbConnection', p => db_agents.getDbConnection(p)],
      ['db_bridges.getDbConnection', p => db_bridges.getDbConnection(p)],
      ['persona_memory.getDb', p => persona_memory.getDb(p)],
    ];

    for (const [name, fn] of entrypoints) {
      const subDb = path.join(tmp, `${name.replace('.', '_')}.db`);
      const conn = fn(subDb);
      try {
        const row = conn.prepare("PRAGMA journal_mode;").get();
        const mode = Object.values(row)[0].toLowerCase();
        assert.strictEqual(mode, 'wal', `${name} did not set WAL mode (got ${mode})`);
      } finally {
        conn.close();
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testDbStatsStandaloneUsesCanonicalSchema() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-db-stats-test-'));
  try {
    const testDb = path.join(tmp, 'test_stats.db');
    const conn = db.getConnection(testDb);
    db.setupSchema(conn);
    conn.prepare(`
      INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('test-skill', 'test-skill', 'skill', 'test', 'content', 'path', 100, 10);
    conn.close();

    const statsScript = path.join(__dirname, '..', 'src', 'db_stats.js');
    const res = spawnSync(process.execPath, [statsScript, testDb], { encoding: 'utf-8', timeout: 5000 });
    assert.strictEqual(res.status, 0, `db_stats.js failed: ${res.stderr}`);
    const data = JSON.parse(res.stdout.trim());
    assert.strictEqual(data.total, 1);
    assert.strictEqual(data.skills, 1);
    assert.strictEqual(data.bytes, 100);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('Running test_db_consolidation.js...');
testCanonicalDbPathOwnership();
testSkillsTableColumnSetRegression();
testWalJournalModeAcrossEntrypoints();
testDbStatsStandaloneUsesCanonicalSchema();
console.log('test_db_consolidation.js passed cleanly.');
