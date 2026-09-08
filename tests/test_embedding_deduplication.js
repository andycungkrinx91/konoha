#!/usr/bin/env node
'use strict';

/**
 * tests/test_embedding_deduplication.js — Unit tests for Embedding Feature Deduplication,
 * Persona & Project Context Memory Deduplication, Token-Efficiency, and Anti-Hallucination guarantees.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/db');
const personaMemory = require('../src/persona_memory');
const vectorSearch = require('../src/vector_search');

async function run() {
  console.log('Running test_embedding_deduplication tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_dedup_'));
  const testDbPath = path.join(tmpDir, 'test_dedup.db');

  const conn = db.getConnection(testDbPath, false);
  db.setupSchema(conn);

  try {
    // 1. Chunk document deduplication
    const markdown = `# Section 1
This is repeated content.

# Section 2
This is unique content.

# Section 1
This is repeated content.
`;
    const chunks = vectorSearch.chunkDocument(markdown);
    assert.strictEqual(chunks.length, 2, `Expected 2 unique chunks, found ${chunks.length}`);
    const texts = chunks.map(c => c[1]);
    assert.ok(texts.some(t => t.includes('Section 1')));
    assert.ok(texts.some(t => t.includes('Section 2')));
    console.log('✓ Chunk document deduplication passed');

    // 2. Embed cache deduplication
    const t1 = 'Deterministic embedding test for caching.';
    const t2 = '  Deterministic   embedding test for caching.  ';

    const mockVec = new Float32Array(384);
    for (let i = 0; i < 384; i++) mockVec[i] = 1.0;
    const normVal = Math.sqrt(384);
    for (let i = 0; i < 384; i++) mockVec[i] /= normVal;

    const normKey = t1.trim().split(/\s+/).join(' ');
    const h = crypto.createHash('sha256').update(normKey, 'utf8').digest('hex');
    vectorSearch._EMBED_CACHE.set(h, mockVec);

    const res1 = await vectorSearch.embedText(t1);
    const res2 = await vectorSearch.embedText(t2);

    assert.strictEqual(res1.length, 384);
    assert.strictEqual(res2.length, 384);
    for (let i = 0; i < 384; i++) {
      assert.strictEqual(res1[i], mockVec[i]);
      assert.strictEqual(res2[i], mockVec[i]);
    }
    console.log('✓ Embed cache deduplication passed');

    // 3. DB-level embedding blob reuse
    conn.prepare("INSERT INTO skills (name, skill_name, type, content) VALUES ('skill-base', 'skill-base', 'skill', 'base content')").run();
    conn.prepare("INSERT INTO skills (name, skill_name, type, content) VALUES ('skill-derived', 'skill-derived', 'skill', 'derived content')").run();

    const existingText = 'Universal layout invariant: brand logo on the far left.';
    const mockBlob = Buffer.alloc(384 * 4);
    for (let i = 0; i < 384; i++) mockBlob.writeFloatLE(0.5, i * 4);

    conn.prepare(
      'INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)'
    ).run('skill-base', 0, existingText, mockBlob);

    // Index another skill containing exact same text
    await vectorSearch.indexSingleSkillChunks(conn, 'skill-derived', existingText);

    const row = conn.prepare(
      "SELECT embedding FROM skill_chunks WHERE skill_name = 'skill-derived' AND chunk_text = ?"
    ).get(existingText);

    assert.ok(row, 'Row in skill_chunks must exist');
    assert.ok(Buffer.isBuffer(row.embedding) || row.embedding instanceof Uint8Array);
    assert.ok(Buffer.from(row.embedding).equals(mockBlob), 'Pre-existing embedding blob must be reused');
    console.log('✓ DB-level embedding blob reuse passed');

    // 4. Persona memory deduplication
    const agent = 'anbu';
    const content = 'Always enforce database migrations before starting service.';

    const memId1 = personaMemory.saveMemory({
      agentName: agent,
      content,
      title: 'Migration rule',
      importance: 2,
      dbPath: testDbPath
    });

    const memId2 = personaMemory.saveMemory({
      agentName: agent,
      content,
      title: 'Updated migration rule',
      importance: 5,
      dbPath: testDbPath
    });

    assert.strictEqual(memId1, memId2, 'Duplicate save must return identical ID');
    const count = personaMemory.countMemories({ agentName: agent, dbPath: testDbPath });
    assert.strictEqual(count, 1, 'Memory count must be 1');

    const mems = personaMemory.listMemories({ agentName: agent, dbPath: testDbPath });
    assert.strictEqual(mems[0].importance, 5, 'Importance must be updated to 5');
    console.log('✓ Persona memory deduplication passed');

    // 5. Prompt context token efficiency and anti-hallucination
    const profile = {
      project_name: 'ecommerce-frontend',
      project_path: '/var/app/ecommerce',
      framework: 'Next.js 16',
      styling: 'Tailwind CSS v4',
      package_manager: 'pnpm',
      context_summary: 'E-commerce platform with 10 light-mode themes and server actions.'
    };
    const memories = [
      { memory_type: 'rule', content: 'Always place brand logo on far-left.' },
      { memory_type: 'rule', content: 'Always place brand logo on far-left.' }, // duplicate
      { memory_type: 'decision', content: 'Use Zustand for lightweight local cart state.' }
    ];

    // Non-compact
    const fullBlock = personaMemory.formatProjectContextForPrompt(profile, memories, 2, false);
    assert.ok(fullBlock.includes('Next.js 16'));
    assert.ok(fullBlock.includes('Tailwind CSS v4'));
    assert.strictEqual(
      (fullBlock.match(/Always place brand logo on far-left/g) || []).length,
      1,
      'Duplicate rule should not be duplicated in prompt'
    );
    assert.ok(fullBlock.length < 800);

    // Auto-compact
    const compactBlock = personaMemory.formatProjectContextForPrompt(profile, memories, 2, true);
    assert.ok(compactBlock.includes('Project Context Memory (Auto-Compacted)'));
    assert.ok(compactBlock.includes('`ecommerce-frontend` (Next.js 16 • Tailwind CSS v4 • pnpm)'));
    assert.ok(compactBlock.length < 350);
    console.log('✓ Prompt context token efficiency and anti-hallucination passed');

    console.log('\nAll test_embedding_deduplication tests passed!');
  } finally {
    conn.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
