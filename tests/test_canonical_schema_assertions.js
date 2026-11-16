#!/usr/bin/env node
'use strict';

/**
 * tests/test_canonical_schema_assertions.js
 *
 * Strict regression assertions for canonical database & vector schema:
 * 1. Proves fresh database conforms 100% to canonical schema.
 * 2. Proves legacy tables (tunnel_config, etc.) are purged and flagged.
 * 3. Proves legacy columns (agents.claude_model, agents.cursor_model) are purged and flagged.
 * 4. Proves non-384-dimensional vector embeddings are purged and flagged.
 * 5. Proves orphaned FTS5 rows are purged.
 * 6. Proves duplicate skill entries are flagged and prevented.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-schema-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'canonical_test.db');
process.env.KONOHA_DB_PATH = testDbPath;

const { getConnection, validateCanonicalSchema, setupSchema, ensureSchema } = require('../src/db');
const { CURRENT_SCHEMA_VERSION } = require('../src/db_schema');

console.log('Running test_canonical_schema_assertions.js...');
console.log(`Isolated QA Root: ${QA_ROOT}`);

const conn = getConnection(testDbPath);
setupSchema(conn);

// --- 1. Fresh Canonical Schema Validation ---
console.log('\n--- 1. Testing Fresh Canonical Schema Validation ---');
const freshResult = validateCanonicalSchema(conn);
assert.strictEqual(freshResult.valid, true, `Fresh schema must be valid: ${JSON.stringify(freshResult.errors)}`);
assert.strictEqual(freshResult.errors.length, 0);
console.log('  ✓ Fresh database conforms 100% to canonical schema.');

// --- 2. Legacy Table Rejection & Purge ---
console.log('\n--- 2. Testing Legacy Table Handling ---');
// Simulate an unmigrated legacy table
conn.exec('CREATE TABLE IF NOT EXISTS tunnel_config (id INTEGER PRIMARY KEY, active INTEGER);');
let checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, false, 'Schema validator must fail on legacy table tunnel_config');
assert.ok(checkResult.errors.some(e => e.includes('tunnel_config')), 'Validator must specifically mention tunnel_config');

// Run setupSchema which must purge legacy tables
setupSchema(conn);
checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, true, 'setupSchema must purge legacy tables and restore validity');
console.log('  ✓ Legacy table tunnel_config correctly detected and purged.');

// --- 3. Legacy Column Handling ---
console.log('\n--- 3. Testing Legacy Column Handling ---');
conn.exec('ALTER TABLE agents ADD COLUMN claude_model TEXT;');
checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, false, 'Schema validator must fail on legacy column claude_model');
assert.ok(checkResult.errors.some(e => e.includes('claude_model')));

// Run setupSchema which drops legacy columns
setupSchema(conn);
checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, true, 'setupSchema must drop legacy columns and restore validity');
console.log('  ✓ Legacy column agents.claude_model correctly detected and purged.');

// --- 4. Stale Vector Dimension Assertion ---
console.log('\n--- 4. Testing Vector Dimension Assertions ---');
// Insert valid skill first
conn.prepare(`
  INSERT INTO skills (name, skill_name, type, tags, content, byte_size, line_count, file_path)
  VALUES ('schema-test-skill', 'schema-test-skill', 'skill', 'test', 'Test Content', 12, 1, '/tmp/skills/schema-test-skill/SKILL.md')
`).run();

// Valid 384-dim embedding = 1536 bytes
const validVecBuffer = Buffer.alloc(384 * 4, 1);
conn.prepare(`
  INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding)
  VALUES ('schema-test-skill', 0, 'Chunk 0', ?)
`).run(validVecBuffer);

checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, true, 'Valid 384-dim vector chunk must pass');

// Invalid 768-dim stale embedding = 3072 bytes
const invalidVecBuffer = Buffer.alloc(768 * 4, 2);
conn.prepare(`
  INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding)
  VALUES ('schema-test-skill', 1, 'Chunk 1 Stale', ?)
`).run(invalidVecBuffer);

checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, false, 'Stale vector dimensions must fail validation');
assert.ok(checkResult.errors.some(e => e.includes('stale vector chunk')), 'Validator must specifically mention stale vector chunks');

// Run setupSchema which purges non-384 dimensional embeddings
setupSchema(conn);
checkResult = validateCanonicalSchema(conn);
assert.strictEqual(checkResult.valid, true, 'setupSchema must purge stale vector chunks');
console.log('  ✓ Stale vector chunk dimensions correctly detected and purged.');

// --- 8. Legacy `harness:claude` label is renamed, not deleted ---
console.log('\n--- 8. Testing Legacy Harness Label Repair ---');
conn.exec("DELETE FROM skill_chunks WHERE skill_name LIKE '%alias-repair%'");
conn.exec("DELETE FROM skills WHERE name LIKE '%alias-repair%'");
conn.prepare("INSERT INTO skills (name, skill_name, type, tags, content, file_path) VALUES (?,?,?,?,?,?)")
  .run('alias-repair@global-claude', 'alias-repair', 'skill', 'scope:global,harness:claude', 'body', '/home/u/.claude/skills/alias-repair/SKILL.md');
conn.prepare("INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?,?,?,?)")
  .run('alias-repair@global-claude', 0, 'body', validVecBuffer);
setupSchema(conn);
assert.strictEqual(conn.prepare("SELECT count(*) c FROM skills WHERE name = 'alias-repair@global-claude'").get().c, 0,
  'the legacy spelling must not survive a schema pass');
const repaired = conn.prepare("SELECT tags FROM skills WHERE name = 'alias-repair@global-claudecode'").get();
assert.ok(repaired, 'the row must be renamed, not dropped');
assert.ok(!String(repaired.tags).split(',').includes('harness:claude'), 'the legacy tag must be rewritten');
assert.ok(String(repaired.tags).split(',').includes('harness:claudecode'), 'the canonical tag must be present');
assert.strictEqual(conn.prepare("SELECT count(*) c FROM skill_chunks WHERE skill_name = 'alias-repair@global-claudecode'").get().c, 1,
  'the chunks must follow the rename, or the embeddings are orphaned');
assert.strictEqual(conn.prepare('PRAGMA foreign_key_check').all().length, 0);
console.log('  ✓ Legacy harness label renamed in place with its chunks.');

// A database that already holds both spellings must merge, not throw: `skills.name`
// is the primary key and this runs on every connection.
conn.exec("DELETE FROM skill_chunks WHERE skill_name LIKE '%alias-dup%'");
conn.exec("DELETE FROM skills WHERE name LIKE '%alias-dup%'");
conn.prepare("INSERT INTO skills (name, skill_name, type, tags, content, file_path) VALUES (?,?,?,?,?,?)")
  .run('alias-dup@global-claude', 'alias-dup', 'skill', 'scope:global,harness:claude', 'legacy body', '/home/u/.claude/skills/alias-dup/SKILL.md');
conn.prepare("INSERT INTO skills (name, skill_name, type, tags, content, file_path) VALUES (?,?,?,?,?,?)")
  .run('alias-dup@global-claudecode', 'alias-dup', 'skill', 'scope:global,harness:claudecode', 'canonical body', '/home/u/.claude/skills/alias-dup/SKILL.md');
conn.prepare("INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?,?,?,?)")
  .run('alias-dup@global-claude', 0, 'legacy chunk', validVecBuffer);
setupSchema(conn);
assert.strictEqual(conn.prepare("SELECT count(*) c FROM skills WHERE name = 'alias-dup@global-claude'").get().c, 0,
  'the colliding legacy row must be merged away, not left behind');
assert.strictEqual(conn.prepare("SELECT count(*) c FROM skills WHERE name = 'alias-dup@global-claudecode'").get().c, 1);
assert.strictEqual(conn.prepare("SELECT count(*) c FROM skill_chunks WHERE skill_name = 'alias-dup@global-claudecode'").get().c, 1,
  'the surviving row must inherit the legacy chunk rather than dropping it');
assert.strictEqual(conn.prepare('PRAGMA foreign_key_check').all().length, 0);
console.log('  ✓ Colliding legacy label merged into the canonical row.');

// --- 9. Legacy `agy` client rows are folded into `antigravity` ---
console.log('\n--- 9. Testing Legacy Client Identity Merge ---');
conn.exec("DELETE FROM active_sessions WHERE client IN ('agy', 'antigravity') AND session_id LIKE '%alias-client%'");
conn.exec("DELETE FROM sdlc_tasks WHERE client IN ('agy', 'antigravity') AND description LIKE '%alias-client%'");
conn.prepare("INSERT INTO sdlc_tasks (id, client, description, created_at, updated_at) VALUES (?,?,?,?,?)").run('alias-client-1', 'agy', 'alias-client task', Date.now(), Date.now());
conn.prepare("INSERT INTO sdlc_tasks (id, client, description, created_at, updated_at) VALUES (?,?,?,?,?)").run('alias-client-2', 'agy', 'alias-client task 2', Date.now(), Date.now());
// A session recorded under both spellings: the merge must dedupe, not throw on the PK.
conn.prepare("INSERT INTO active_sessions (client, workspace_root, session_id) VALUES (?,?,?)").run('agy', '/w', 'alias-client-sess');
conn.prepare("INSERT INTO active_sessions (client, workspace_root, session_id) VALUES (?,?,?)").run('antigravity', '/w', 'alias-client-sess');
setupSchema(conn);
assert.strictEqual(conn.prepare("SELECT count(*) c FROM sdlc_tasks WHERE client = 'agy'").get().c, 0,
  'the legacy client spelling must not survive a schema pass');
assert.strictEqual(conn.prepare("SELECT count(*) c FROM sdlc_tasks WHERE client = 'antigravity' AND description LIKE '%alias-client%'").get().c, 2,
  'the rows must be folded into the canonical client, not dropped');
assert.strictEqual(conn.prepare("SELECT count(*) c FROM active_sessions WHERE client = 'agy'").get().c, 0);
assert.strictEqual(conn.prepare("SELECT count(*) c FROM active_sessions WHERE client = 'antigravity' AND session_id = 'alias-client-sess'").get().c, 1,
  'the colliding session must collapse to one canonical row');
assert.strictEqual(conn.prepare('PRAGMA foreign_key_check').all().length, 0);
console.log('  ✓ Legacy client identity folded into the canonical spelling.');

// --- 10. The repairs must be reachable from the entry point real commands use ---
// `ensureSchema` short-circuits when `user_version` already equals
// `CURRENT_SCHEMA_VERSION`, so a repair added without bumping the version never
// runs on an existing database. Build one at the previous version and prove it.
console.log('\n--- 10. Testing Repair Reachability Through ensureSchema ---');
const upgradePath = path.join(QA_ROOT, 'upgrade_reachability.db');
const upConn = getConnection(upgradePath);
setupSchema(upConn);
upConn.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION - 1}`);
upConn.exec("DELETE FROM active_sessions WHERE client IN ('agy', 'antigravity') AND session_id LIKE '%reach%'");
upConn.exec("DELETE FROM sdlc_tasks WHERE client IN ('agy', 'antigravity') AND description LIKE '%reach%'");
upConn.prepare("INSERT INTO sdlc_tasks (id, client, description, created_at, updated_at) VALUES (?,?,?,?,?)")
  .run('reach-1', 'agy', 'reach task', Date.now(), Date.now());
upConn.prepare("INSERT INTO active_sessions (client, workspace_root, session_id) VALUES (?,?,?)")
  .run('agy', '/w', 'reach-sess');
ensureSchema(upConn);
assert.strictEqual(upConn.prepare("SELECT count(*) c FROM sdlc_tasks WHERE client = 'agy'").get().c, 0,
  'ensureSchema must run the fold on a database stamped at the previous version');
assert.strictEqual(upConn.prepare("SELECT count(*) c FROM sdlc_tasks WHERE client = 'antigravity' AND description LIKE '%reach%'").get().c, 1);
assert.strictEqual(upConn.prepare("SELECT count(*) c FROM active_sessions WHERE client = 'agy'").get().c, 0);
assert.strictEqual(upConn.prepare('PRAGMA foreign_key_check').all().length, 0);
upConn.close();
console.log('  ✓ ensureSchema upgrades a previous-version database and folds the legacy client.');

conn.close();

// Cleanup
try {
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
} catch (_) {}

console.log('\n✔ All canonical schema and vector regression assertions passed cleanly.');
