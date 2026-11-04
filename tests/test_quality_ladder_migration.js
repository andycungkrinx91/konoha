#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { safeIdent, QUALITY_LADDER_TABLES, applyQualityLadderMigration } = require('../src/mcp/three_asset/db_3d_schema');
const Database = require('../src/sqlite_driver');

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  \u2713 ${label}`);
}

console.log('Running test_quality_ladder_migration.js...');

console.log('\n--- 1. Identifier guard ---');
check('accepts every canonical ladder table', () => {
  for (const table of QUALITY_LADDER_TABLES) assert.strictEqual(safeIdent(table), table);
});
check('accepts staged table names', () => {
  assert.strictEqual(safeIdent('generation_jobs__ladder_stage'), 'generation_jobs__ladder_stage');
});
check('rejects statement separators', () => {
  assert.throws(() => safeIdent('assets; DROP TABLE assets'), /Unsafe SQL identifier/);
});
check('rejects comment truncation', () => {
  assert.throws(() => safeIdent('assets--'), /Unsafe SQL identifier/);
});
check('rejects quoted identifiers', () => {
  assert.throws(() => safeIdent('"assets"'), /Unsafe SQL identifier/);
});
check('rejects leading digits', () => {
  assert.throws(() => safeIdent('1assets'), /Unsafe SQL identifier/);
});
check('rejects whitespace and newlines', () => {
  assert.throws(() => safeIdent('assets\n'), /Unsafe SQL identifier/);
});
check('rejects non-string coercion hazards', () => {
  assert.throws(() => safeIdent({ toString: () => 'assets; --' }), /Unsafe SQL identifier/);
});

console.log('\n--- 2. Migration leaves no staging artefacts ---');
check('legacy narrow schema widens in place and cleans up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-safety-'));
  const dbFile = path.join(dir, 'probe.db');
  const conn = new Database(dbFile);
  try {
    const narrowCheck = "CHECK (quality_preset IN ('draft', 'standard', 'high', 'ultra'))";
    conn.exec('CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, quality_preset TEXT NOT NULL ' + narrowCheck + ');');
    conn.exec('CREATE TABLE assets (id TEXT PRIMARY KEY, quality_preset TEXT NOT NULL ' + narrowCheck + ');');
    conn.exec('CREATE INDEX idx_generation_jobs_quality ON generation_jobs(quality_preset);');
    conn.prepare('INSERT INTO generation_jobs (id, quality_preset) VALUES (?, ?)').run('legacy_job', 'draft');
    applyQualityLadderMigration(conn);
    const jobSql = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_jobs'").get().sql;
    assert.ok(jobSql.includes("'low'"), 'widened CHECK must list the canonical ladder');
    const legacy = conn.prepare('SELECT quality_preset FROM generation_jobs WHERE id = ?').get('legacy_job');
    assert.strictEqual(legacy.quality_preset, 'draft');
    const staged = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%ladder_stage%'")
      .all();
    assert.deepStrictEqual(staged, []);
    const index = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_generation_jobs_quality'")
      .get();
    assert.ok(index, 'dependent index must be restored');
    conn.prepare('INSERT INTO assets (id, quality_preset) VALUES (?, ?)').run('new_asset', 'ultra');
    applyQualityLadderMigration(conn);
    const secondPass = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%ladder_stage%'")
      .all();
    assert.deepStrictEqual(secondPass, [], 'second pass must be a no-op');
  } finally {
    if (conn && typeof conn.close === 'function') conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('non-canonical CHECK shape fails loud instead of silently skipping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-drift-'));
  const conn = new Database(path.join(dir, 'probe.db'));
  try {
    conn.exec('CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, quality_preset TEXT NOT NULL DEFAULT \'standard\');');
    assert.throws(() => applyQualityLadderMigration(conn), /SCHEMA DRIFT/);
  } finally {
    if (conn && typeof conn.close === 'function') conn.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} migration-safety assertions passed.`);
console.log('root: ' + root);
