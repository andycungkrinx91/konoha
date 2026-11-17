'use strict';

/**
 * tests/test_doctor_embedding_health.js — the `Vector Embeddings (semantic
 * search)` doctor row.
 *
 * A vector-less install still has a working FTS5 database, so an unembedded
 * corpus must be WARNING with a fix, never FAILED. Pinned because an earlier
 * version marked the healthy database row FAILED instead, which told users to
 * rebuild a database that was fine.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-doctor-embed-'));
const dbPath = path.join(tmpDir, 'konoha.db');
process.env.KONOHA_DB_PATH = dbPath;

const Database = require('../src/sqlite_driver');
const { checkEmbeddingHealth } = require('../bin/commands/doctor_services');
const { measureEmbeddingCoverage } = require('../bin/commands/init_migration');

function seed(conn, { skills, chunks }) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, content TEXT, type TEXT);
    CREATE TABLE IF NOT EXISTS skill_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT,
      embedding BLOB
    );
  `);
  const insSkill = conn.prepare("INSERT INTO skills (name, content, type) VALUES (?, ?, 'skill')");
  for (const name of skills) insSkill.run(name, `body for ${name}`);
  const insChunk = conn.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)');
  for (const [name, hasVector] of chunks) {
    insChunk.run(name, 0, `chunk for ${name}`, hasVector ? Buffer.alloc(16) : null);
  }
}

function row() {
  const rows = [];
  checkEmbeddingHealth({ record: (name, status, detail) => rows.push({ name, status, detail }) });
  assert.strictEqual(rows.length, 1, 'exactly one embedding row is recorded');
  return rows[0];
}

const conn = new Database(dbPath);
try {
  seed(conn, { skills: ['a', 'b'], chunks: [['a', true], ['b', false]] });

  // --- partially embedded -> WARNING with an actionable fix -----------------
  const partial = row();
  assert.strictEqual(partial.name, 'Vector Embeddings (semantic search)');
  assert.strictEqual(partial.status, 'WARNING', 'an unembedded skill is a WARNING, not a FAILED database');
  assert.ok(/1\/2 skills unembedded/.test(partial.detail), `expected "1/2 skills unembedded", got: ${partial.detail}`);
  assert.ok(partial.detail.includes('konoha migrate --rebuild-embeddings'), 'the row must name the fix');
  console.log('  ✓ partially embedded corpus reports WARNING with the rebuild command');

  // `konoha init`'s coverage block asks the same question, so it must give the
  // same answer: a NULL vector is pending, not done.
  const coverage = measureEmbeddingCoverage(dbPath);
  assert.strictEqual(coverage.canonicalPending, 1, `expected 1 pending skill, got ${JSON.stringify(coverage)}`);
  console.log('  ✓ measureEmbeddingCoverage counts NULL vectors as pending');

  // --- fully embedded -> HEALTHY --------------------------------------------
  conn.prepare('UPDATE skill_chunks SET embedding = ? WHERE skill_name = ?').run(Buffer.alloc(16), 'b');
  const healthy = row();
  assert.strictEqual(healthy.status, 'HEALTHY', `expected HEALTHY, got: ${healthy.detail}`);
  assert.ok(healthy.detail.includes('2 skills covered'), `expected coverage count, got: ${healthy.detail}`);
  console.log('  ✓ a fully embedded corpus reports HEALTHY');

  // --- no content -> INFO, not a warning ------------------------------------
  conn.exec('DELETE FROM skills; DELETE FROM skill_chunks;');
  const empty = row();
  assert.strictEqual(empty.status, 'INFO', `an empty corpus is INFO, got: ${empty.status}`);
  console.log('  ✓ an empty corpus reports INFO');

  // --- semantic search disabled -> WARNING naming the env var ---------------
  process.env.KONOHA_SEMANTIC_SEARCH = '0';
  const disabled = row();
  assert.strictEqual(disabled.status, 'WARNING');
  assert.ok(disabled.detail.includes('KONOHA_SEMANTIC_SEARCH'), `expected the env var, got: ${disabled.detail}`);
  assert.ok(disabled.detail.includes('Fix:'), 'the row must name the fix');
  delete process.env.KONOHA_SEMANTIC_SEARCH;
  console.log('  ✓ a disabled semantic-search switch reports WARNING with the env var');
} finally {
  conn.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('\n✓ doctor embedding health assertions passed');
