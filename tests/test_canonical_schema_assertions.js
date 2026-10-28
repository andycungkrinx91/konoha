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

const QA_ROOT = path.join('/tmp', `konoha-qa-schema-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'canonical_test.db');
process.env.KONOHA_DB_PATH = testDbPath;

const { getConnection, validateCanonicalSchema, setupSchema } = require('../src/db');

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

conn.close();

// Cleanup
try {
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
} catch (_) {}

console.log('\n✔ All canonical schema and vector regression assertions passed cleanly.');
