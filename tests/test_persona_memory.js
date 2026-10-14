#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

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

    // 8. Session isolation contract (Decision A)
    const projPath = '/tmp/proj_iso_test_' + Date.now();
    const sess1 = 'sess-iso-alpha-001';
    const sess2 = 'sess-iso-beta-002';

    // Session 1: saves an episodic memory and a project rule
    personaMemory.saveMemory({
      agentName: 'anbu',
      content: 'Session 1 debug findings: port 9001 used',
      title: 'Sess1 finding',
      memoryType: 'episodic',
      sessionId: sess1,
      projectPath: projPath,
      dbPath: testDbPath
    });

    personaMemory.saveMemory({
      agentName: 'anbu',
      content: 'Project architecture rule: use PostgreSQL 16',
      title: 'Sess1 rule',
      memoryType: 'rule',
      sessionId: sess1,
      projectPath: projPath,
      dbPath: testDbPath
    });

    // Agent-facing queryMemories from Session 2:
    // Episodic memory from Session 1 must NOT leak into Session 2
    const memsAgentQuery = personaMemory.queryMemories({
      agentName: 'anbu',
      sessionId: sess2,
      projectPath: projPath,
      dbPath: testDbPath
    });
    const hasSess1Episodic = memsAgentQuery.some(m => m.content.includes('port 9001'));
    const hasSess1Rule = memsAgentQuery.some(m => m.content.includes('PostgreSQL 16'));
    assert.strictEqual(hasSess1Episodic, false, 'Agent-facing queryMemories must NOT leak episodic memory across sessions');
    assert.strictEqual(hasSess1Rule, true, 'Agent-facing queryMemories may share non-episodic project rules across sessions');

    // Agent-facing targeted query for the episodic term stays per-session
    const memsEpisodicSearch = personaMemory.queryMemories({
      agentName: 'anbu',
      query: 'port 9001',
      sessionId: sess2,
      projectPath: projPath,
      dbPath: testDbPath
    });
    const hasEpisInSearch = memsEpisodicSearch.some(m => m.content.includes('port 9001'));
    assert.strictEqual(hasEpisInSearch, false, 'Targeted search for foreign session episodic memory must not return foreign episodic memory');

    // Cross-session listing requires explicit option (allSessions / crossSession)
    const listWithoutOption = personaMemory.listMemories({
      sessionId: sess2,
      projectPath: projPath,
      dbPath: testDbPath
    });
    assert.strictEqual(listWithoutOption.some(m => m.content.includes('port 9001')), false,
      'Listing without allSessions/crossSession must not leak foreign episodic memory');

    const listWithAllSessions = personaMemory.listMemories({
      sessionId: sess2,
      projectPath: projPath,
      allSessions: true,
      dbPath: testDbPath
    });
    assert.strictEqual(listWithAllSessions.some(m => m.content.includes('port 9001')), true,
      'Listing with explicit allSessions: true must include memories across all sessions');

    const listWithCrossSession = personaMemory.listMemories({
      sessionId: sess2,
      projectPath: projPath,
      crossSession: true,
      dbPath: testDbPath
    });
    assert.strictEqual(listWithCrossSession.some(m => m.content.includes('port 9001')), true,
      'Listing with explicit crossSession: true must include memories across all sessions');

    // Web UI listing pattern (explicit allSessions: true) shows memories across sessions
    const webUiList = personaMemory.listMemories({
      allSessions: true,
      dbPath: testDbPath
    });
    assert.ok(webUiList.some(m => m.content.includes('port 9001')), 'Web UI listing with allSessions: true shows memories across sessions');

    const webUiQuery = personaMemory.queryMemories({
      query: 'port 9001',
      allSessions: true,
      dbPath: testDbPath
    });
    assert.ok(webUiQuery.some(m => m.content.includes('port 9001')), 'Web UI query with allSessions: true finds memories across sessions');

    // Agent-facing query where sessionId is completely omitted/unknown
    const memsOmittedSession = personaMemory.queryMemories({
      agentName: 'anbu',
      projectPath: projPath,
      dbPath: testDbPath
    });
    assert.strictEqual(
      memsOmittedSession.some(m => m.content.includes('port 9001')),
      false,
      'When sessionId is omitted, episodic memory must NOT be returned'
    );
    assert.strictEqual(
      memsOmittedSession.some(m => m.content.includes('PostgreSQL 16')),
      true,
      'When sessionId is omitted, project-level non-episodic rule must still be returned'
    );

    // Listing without any sessionId and without allSessions must NOT leak foreign episodic memory
    const listNoSessionNoOpt = personaMemory.listMemories({
      projectPath: projPath,
      dbPath: testDbPath
    });
    assert.strictEqual(
      listNoSessionNoOpt.some(m => m.content.includes('port 9001')),
      false,
      'Listing without sessionId and without allSessions must NOT return foreign episodic memory'
    );
    assert.strictEqual(
      listNoSessionNoOpt.some(m => m.content.includes('PostgreSQL 16')),
      true,
      'Listing without sessionId must still return non-episodic project rules'
    );
    console.log('✓ Session isolation contract (Decision A) verified');

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
