#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const vector_search = require('../src/vector_search');

async function testRrfDeterministicOrdering() {
  const list1 = ['item-a', 'item-b', 'item-c'];
  const list2 = ['item-b', 'item-a', 'item-d'];

  const fused1 = vector_search.reciprocalRankFusion([list1, list2], 60);
  const fused2 = vector_search.reciprocalRankFusion([list1, list2], 60);

  assert.deepStrictEqual(fused1, fused2, 'RRF should be completely deterministic');
  const topKeys = fused1.map(([k]) => k);
  assert.strictEqual(topKeys[0], 'item-a');
  assert.ok(topKeys.slice(0, 2).includes('item-b'));
  assert.ok(topKeys.slice(2).includes('item-c'));
  assert.ok(topKeys.slice(2).includes('item-d'));
}

async function testExtensionLoadUnavailableFallback() {
  const mockConn = {
    loadExtension() {
      throw new Error('not authorized');
    }
  };
  const res = vector_search.enableLoadExtensionSafe(mockConn);
  assert.strictEqual(res, false, 'Should return false when enableLoadExtensionSafe fails');
}

async function testChunkBackfillIdempotency() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-vec-test-'));
  try {
    const testDb = path.join(tmp, 'skills_vector_test.db');
    const conn = db.getConnection(testDb);
    db.setupSchema(conn);

    const content = `# Architecture Overview
This is the system architecture guide.

## Security Practices
Follow standard security hardening rules.
`;
    conn.prepare(`
      INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('kage-skill', 'kage-skill', 'skill', 'architecture, security', content, '/path/SKILL.md', content.length, 10);

    const cnt1 = await vector_search.backfillAllEmbeddings(conn, false);
    assert.ok(cnt1 > 0, 'Should have created chunks on first backfill');

    const total1 = conn.prepare("SELECT COUNT(*) as c FROM skill_chunks WHERE skill_name = 'kage-skill'").get().c;

    const cnt2 = await vector_search.backfillAllEmbeddings(conn, false);
    assert.strictEqual(cnt2, 0, 'Second incremental backfill should create 0 new chunks');

    const total2 = conn.prepare("SELECT COUNT(*) as c FROM skill_chunks WHERE skill_name = 'kage-skill'").get().c;
    assert.strictEqual(total1, total2, 'Chunk count must remain identical');
    conn.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testSkillChunksSchemaAndColumns() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-vec-schema-'));
  try {
    const testDb = path.join(tmp, 'test.db');
    const conn = db.getConnection(testDb);
    db.setupSchema(conn);

    const columns = new Set(conn.prepare("PRAGMA table_info(skill_chunks);").all().map(r => r.name));
    const expected = new Set(['id', 'skill_name', 'chunk_index', 'chunk_text', 'embedding']);
    for (const exp of expected) {
      assert.ok(columns.has(exp), `skill_chunks missing required column: ${exp}`);
    }
    conn.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testMultilingualIndonesianQueriesTop5() {
  const realDb = path.join(os.homedir(), '.konoha', 'konoha.db');
  if (!fs.existsSync(realDb)) {
    console.log('Skipping testMultilingualIndonesianQueriesTop5: ~/.konoha/konoha.db not found');
    return;
  }

  const conn = db.getConnection(realDb);
  try {
    const testCases = [
      ['Bagaimana cara membuat styling antarmuka frontend yang modern dan rapi', 'jonin-skill'],
      ['Deployment infrastruktur cloud dan perbaikan bug backend', 'anbu-skill'],
      ['Keputusan arsitektur sistem dan audit keamanan kode', 'kage-skill'],
      ['Mencari struktur kode dan pemetaan dependensi berkas', 'genin-skill'],
      ['Menulis dokumentasi teknis panduan API dan README', 'tokubetsu-jonin-skill'],
    ];

    for (const [idQuery, expectedSkill] of testCases) {
      const results = await vector_search.findSkillSemantic(conn, idQuery, 5, 20);
      const matchedNames = results.map(r => r.name);
      const matchedSkillNames = results.map(r => r.skill_name || r.skillName);
      const found = matchedNames.some((n, idx) => n.includes(expectedSkill) || (matchedSkillNames[idx] && matchedSkillNames[idx].includes(expectedSkill)));
      assert.ok(found, `Query '${idQuery}' did not retrieve '${expectedSkill}' in top-5: ${matchedNames.join(', ')}`);
    }
  } finally {
    conn.close();
  }
}

async function run() {
  console.log('Running test_vector_search.js...');
  console.log('1. testRrfDeterministicOrdering');
  await testRrfDeterministicOrdering();
  console.log('2. testExtensionLoadUnavailableFallback');
  await testExtensionLoadUnavailableFallback();
  console.log('3. testChunkBackfillIdempotency');
  await testChunkBackfillIdempotency();
  console.log('4. testSkillChunksSchemaAndColumns');
  await testSkillChunksSchemaAndColumns();
  console.log('5. testMultilingualIndonesianQueriesTop5');
  await testMultilingualIndonesianQueriesTop5();
  console.log('test_vector_search.js passed cleanly.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
