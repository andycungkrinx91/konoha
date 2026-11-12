/**
 * Test Suite: schema traceability.
 *
 * Every table a fresh `setupSchema` creates must be documented in the audit
 * traceability table, and the canonical table list must stay at 30 declared tables. Guards
 * against a table appearing in code with no audit row, and against the audit
 * drifting from the DDL.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const AUDIT_DOC = path.join(REPO_ROOT, 'docs', 'security', 'DATABASE-SCHEMA-AUDIT-2026-11-09.md');
// 30 declared tables + 12 FTS5 shadow tables. `_sqliteai_vector` and
// `sqlite_%` are runtime-owned and platform-dependent (`_sqliteai_vector` only
// exists where the vector extension loads), so neither counts. Matches the
// phase-6 assertion in tests/test_schema_migrations_and_lifecycle.js.
const RAW_TABLE_COUNT = 42;
const DECLARED_TABLE_COUNT = 30;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-trace-test-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'trace.db');

const db = require('../src/db');
const conn = db.getConnection();
db.setupSchema(conn);

function freshTables() {
  return conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name)
    // Extension-owned runtime state: present only where the vector extension
    // loads, so it must not participate in the canonical base-DDL count.
    .filter((name) => name !== '_sqliteai_vector');
}

function assertCanonicalTableList() {
  const all = freshTables();
  assert.strictEqual(
    all.length,
    RAW_TABLE_COUNT,
    `Fresh setupSchema must produce exactly ${RAW_TABLE_COUNT} tables, got ${all.length}: ${all.join(', ')}`
  );
  // FTS5 shadows and `_sqliteai_vector` are extension-owned runtime state
  // created on connection open, not base DDL (plan Section 7.6).
  const declared = all.filter(
    (t) => !/_fts_(data|idx|config|docsize|content)$/.test(t) && t !== '_sqliteai_vector'
  );
  assert.strictEqual(
    declared.length,
    DECLARED_TABLE_COUNT,
    `Expected ${DECLARED_TABLE_COUNT} declared tables, got ${declared.length}: ${declared.join(', ')}`
  );
  for (const forbidden of ['kali_tools', 'lab_runs', 'lab_tool_invocations', 'red_skill_audit']) {
    assert.ok(!all.includes(forbidden), `Fresh schema must not contain ${forbidden}`);
  }
}

function assertEveryTableIsDocumented() {
  assert.ok(fs.existsSync(AUDIT_DOC), `Audit document missing: ${AUDIT_DOC}`);
  const doc = fs.readFileSync(AUDIT_DOC, 'utf8');
  // FTS5 shadow tables (skills_fts_data, _idx, _config, _docsize) are created by
  // the extension behind skills_fts / persona_memories_fts. Document the virtual
  // table; the shadows come with it.
  const declared = freshTables().filter((t) => !/_fts_(data|idx|config|docsize|content)$/.test(t));
  const undocumented = declared.filter((table) => !doc.includes(table));
  assert.deepStrictEqual(
    undocumented,
    [],
    `Every fresh table must appear in the audit document; missing: ${undocumented.join(', ')}`
  );
}

function assertUserVersionSingleWriter() {
  const roots = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'bin')];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'templates') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (path.resolve(full) === path.resolve(REPO_ROOT, 'src', 'db_schema.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/user_version\s*=\s*\d/.test(text) || /PRAGMA\s+user_version\s*=\s*\d/.test(text)) {
        offenders.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepStrictEqual(offenders, [], `Only src/db_schema.js may write PRAGMA user_version; offenders: ${offenders.join(', ')}`);
}

function runTests() {
  console.log('Running test_schema_traceability.js...');

  assertCanonicalTableList();
  assertEveryTableIsDocumented();
  assertUserVersionSingleWriter();

  conn.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`✓ Schema traceability verified: ${RAW_TABLE_COUNT} tables (${DECLARED_TABLE_COUNT} declared), all documented, single user_version writer.`);
  process.exit(0);
}

try {
  runTests();
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
}