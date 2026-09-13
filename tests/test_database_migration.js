#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../src/db');

const MIGRATE_SCRIPT = fs.existsSync(path.join(os.homedir(), '.konoha', 'migrate.js'))
  ? path.join(os.homedir(), '.konoha', 'migrate.js')
  : path.join(__dirname, '..', 'src', 'migrate.js');

function testSchemaTables() {
  assert.ok(fs.existsSync(DB_PATH), `Database not found at ${DB_PATH}. Run migration first.`);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
  const tables = new Set(rows.map(r => r.name));
  db.close();

  const expectedTables = ['skills', 'tool_calls', 'agents', 'bridges', 'skill_chunks'];
  for (const t of expectedTables) {
    assert.ok(tables.has(t), `Table '${t}' is missing from schema.`);
  }
}

function testFts5Indexing() {
  assert.ok(fs.existsSync(DB_PATH), `Database not found at ${DB_PATH}.`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const result = db.prepare("SELECT name, content FROM skills_fts WHERE content MATCH 'security' LIMIT 1;").get();
    if (result) {
      assert.ok(result.name !== undefined);
      assert.ok(result.content !== undefined);
    }
  } finally {
    db.close();
  }
}

function testMigrationExecution() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-migrate-'));
  try {
    const tempDb = path.join(tmp, 'konoha-test-migrate.db');
    const skillsDir = path.join(tmp, 'skills', 'genin-skill');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      '---\nname: genin-skill\ndescription: exploration\n---\n# Scout\n',
      'utf-8'
    );

    const proc = spawnSync(
      process.execPath,
      [MIGRATE_SCRIPT, '--db-path', tempDb, '--skills-dir', path.dirname(skillsDir), '--require-skill', 'genin-skill', '--skip-embeddings'],
      { encoding: 'utf-8', timeout: 60000 }
    );
    assert.strictEqual(proc.status, 0, `Migration script execution failed: ${proc.stderr}\nStdout: ${proc.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('Running test_database_migration.js...');
testSchemaTables();
testFts5Indexing();
testMigrationExecution();
console.log('test_database_migration.js passed cleanly.');
