#!/usr/bin/env node
'use strict';

/**
 * tests/test_persona_memory.js — Unit tests for Konoha persona and memory manager.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const personaMemory = require('../src/persona_memory');
const db = require('../src/db');

async function run() {
  console.log('Running test_persona_memory tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona_mem_'));
  const testDbPath = path.join(tmpDir, 'test_skills.db');
  personaMemory.DB_PATH = testDbPath;
  db.DB_PATH = testDbPath;

  try {
    // 1. Save and query memory
    const memId = personaMemory.saveMemory({
      agentName: 'anbu',
      title: 'Postgres Connection Pooling',
      content: 'Always configure max_connections and keepalives for PostgreSQL connections.',
      memoryType: 'rule',
      tags: 'database,postgres',
      importance: 2,
      dbPath: testDbPath
    });
    assert.ok(memId, 'Memory ID should be generated');

    const results = personaMemory.queryMemories({
      agentName: 'anbu',
      query: 'PostgreSQL keepalive configuration',
      dbPath: testDbPath
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, memId);
    assert.ok(results[0].content.includes('PostgreSQL'));
    console.log('✓ Save and query memory passed');

    // 2. List and count memories
    personaMemory.saveMemory({ agentName: 'anbu', content: 'Rule 1', title: 'Rule 1', dbPath: testDbPath });
    personaMemory.saveMemory({ agentName: 'anbu', content: 'Rule 2', title: 'Rule 2', dbPath: testDbPath });
    personaMemory.saveMemory({ agentName: 'jonin', content: 'UI Rule 1', title: 'UI Rule 1', dbPath: testDbPath });

    const countAll = personaMemory.countMemories({ dbPath: testDbPath });
    assert.strictEqual(countAll, 4); // 1 from test 1 + 3 new

    const countAnbu = personaMemory.countMemories({ agentName: 'anbu', dbPath: testDbPath });
    assert.strictEqual(countAnbu, 3);

    const anbuList = personaMemory.listMemories({ agentName: 'anbu', dbPath: testDbPath });
    assert.strictEqual(anbuList.length, 3);
    console.log('✓ List and count memories passed');

    // 3. Delete memory
    const kageMemId = personaMemory.saveMemory({ agentName: 'kage', content: 'Architectural Rule', title: 'Arch', dbPath: testDbPath });
    const countBefore = personaMemory.countMemories({ dbPath: testDbPath });

    const deleted = personaMemory.deleteMemory(kageMemId, testDbPath);
    assert.strictEqual(deleted, true);
    assert.strictEqual(personaMemory.countMemories({ dbPath: testDbPath }), countBefore - 1);
    console.log('✓ Delete memory passed');

    // 4. Format memories for prompt
    const mems = [
      { memory_type: 'rule', content: 'Use strict typing.' },
      { memory_type: 'preference', content: 'Light mode only.' }
    ];
    const block = personaMemory.formatMemoriesForPrompt(mems);
    assert.ok(block.includes('### Agent Persona Memory & Learned Rules:'));
    assert.ok(block.includes('- [RULE] Use strict typing.'));
    assert.ok(block.includes('- [PREFERENCE] Light mode only.'));
    console.log('✓ Format memories for prompt passed');

    // 5. Backslashes and special characters
    const crazyContent = "Special path: C:\\\\\\\\Users\\\\Admin\\\\AppData\\\\Local\\\\temp AND quotes \"' ` and slashes ///";
    const crazyId = personaMemory.saveMemory({
      agentName: 'anbu',
      title: 'Backslash Test',
      content: crazyContent,
      dbPath: testDbPath
    });
    assert.ok(crazyId);

    const crazyQuery = "\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ Users Admin AppData \\\\\\\\\\\\";
    const resCrazy = personaMemory.queryMemories({
      agentName: 'anbu',
      query: crazyQuery,
      dbPath: testDbPath
    });
    assert.ok(resCrazy.length >= 1);
    assert.ok(resCrazy.some(m => m.id === crazyId), 'Query must find the backslash memory');
    console.log('✓ Backslashes and special characters passed');

    // 6. FTS5 boolean operators sanitization
    personaMemory.saveMemory({ agentName: 'kage', content: 'Rule about caching and invalidation', title: 'Caching', dbPath: testDbPath });
    for (const badQuery of ['AND', 'OR', 'NOT', 'AND OR NOT', 'caching AND', 'OR invalidation', 'AND AND AND']) {
      const res = personaMemory.queryMemories({
        agentName: 'kage',
        query: badQuery,
        dbPath: testDbPath
      });
      assert.ok(Array.isArray(res), `Query "${badQuery}" should return an array without throwing`);
    }
    console.log('✓ FTS5 boolean operators sanitization passed');

    // 7. DB schema integrity
    const conn = personaMemory.getDb(testDbPath);
    personaMemory.initMemoryTables(conn);

    const cols = conn.prepare("PRAGMA table_info(persona_memories)").all().map(r => r.name);
    const expectedCols = ['id', 'agent_name', 'memory_type', 'title', 'content', 'tags', 'importance', 'created_at', 'updated_at'];
    for (const c of expectedCols) {
      assert.ok(cols.includes(c), `Column ${c} must exist in persona_memories`);
    }

    const ftsCols = conn.prepare("PRAGMA table_info(persona_memories_fts)").all().map(r => r.name);
    assert.ok(ftsCols.includes('id'), 'id must exist in persona_memories_fts');
    assert.ok(ftsCols.includes('content'), 'content must exist in persona_memories_fts');
    conn.close();
    console.log('✓ DB schema integrity passed');

    console.log('\nAll test_persona_memory tests passed!');
  } finally {
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
