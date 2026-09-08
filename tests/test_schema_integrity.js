#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');

function testMigrationCreatesRuntimeSchema() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-schema-test-'));
  try {
    const dbPath = path.join(tmp, 'skills.db');
    const skillsDir = path.join(tmp, 'skills');
    const skillDir = path.join(skillsDir, 'genin-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: genin-skill\ndescription: exploration\n---\n# Scout\n',
      'utf-8'
    );

    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'src', 'migrate.js'), '--db-path', dbPath, '--skills-dir', skillsDir, '--require-skill', 'genin-skill'],
      { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all();
    const tables = new Set(rows.map(r => r.name));
    for (const required of ['skills', 'skills_fts', 'tool_calls', 'active_sessions', 'agents', 'bridges']) {
      assert.ok(tables.has(required), `Expected table ${required} in database`);
    }

    const cols = db.prepare("PRAGMA table_info(agents)").all().map(c => c.name);
    assert.ok(cols.includes('model_tier'), 'Expected model_tier column in agents table');

    const skillRow = db.prepare("SELECT 1 FROM skills WHERE name = 'genin-skill'").get();
    assert.ok(skillRow, 'Expected genin-skill row in skills table');
    db.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testAgentImportAndBulkImport() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-agent-import-test-'));
  try {
    const env = { ...process.env, HOME: tmp };
    const agentsDir = path.join(tmp, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'agents.yaml'),
      '- name: jonin\n  skills:\n    - jonin-skill\n',
      'utf-8'
    );

    const script = path.join(ROOT, 'src', 'db_agents.js');
    for (const args of [['import'], ['--bulk-import', JSON.stringify([{ name: 'anbu', skills: ['anbu-skill'] }])]]) {
      const res = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
      assert.strictEqual(res.status, 0, res.stderr || res.stdout);
    }

    const listRes = spawnSync(process.execPath, [script, 'list'], { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
    assert.strictEqual(listRes.status, 0, listRes.stderr || listRes.stdout);
    const items = JSON.parse(listRes.stdout.trim());
    const names = new Set(items.map(i => i.name));
    assert.deepStrictEqual(names, new Set(['anbu', 'jonin']));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('Running test_schema_integrity.js...');
testMigrationCreatesRuntimeSchema();
testAgentImportAndBulkImport();
console.log('test_schema_integrity.js passed cleanly.');
