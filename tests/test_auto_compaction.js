#!/usr/bin/env node
'use strict';

/**
 * tests/test_auto_compaction.js — E2E tests for Automatic Context Compaction after 2 prompts.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');
const personaMemory = require('../src/persona_memory');

async function run() {
  console.log('Running test_auto_compaction tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto_compact_'));
  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;
  const prevPersonaDb = personaMemory.DB_PATH;
  const prevActiveClient = server.ACTIVE_CLIENT;

  const testDbPath = path.join(tmpDir, 'test_skills.db');
  const projectDir = path.join(tmpDir, 'ecommerce_app');
  fs.mkdirSync(projectDir, { recursive: true });

  db.DB_PATH = testDbPath;
  server.DB_PATH = testDbPath;
  personaMemory.DB_PATH = testDbPath;

  // Setup minimal agent in DB
  const conn = db.getDb(testDbPath);
  conn.prepare(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      title TEXT,
      purpose TEXT,
      skills TEXT,
      constraints_text TEXT,
      instructions TEXT,
      model_tier TEXT
    )
  `).run();
  conn.prepare(`
    INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
    VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
  `).run();
  conn.close();

  // Mock package.json
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    name: 'ecommerce-app',
    dependencies: { next: '16.0.0', tailwindcss: '^4.0.0' }
  }));

  try {
    // 1. Turn 1 vs Turn 2 unified token-bounded prompt and prefix determinism
    server.SESSION_TURNS.clear();
    process.env.ANTIGRAVITY_CONVERSATION_ID = 'conv-test-123';
    server.ACTIVE_CLIENT = 'agy';

    const res1Json = server.runMcpAgent('jonin', {
      task: 'Scaffold hero section',
      project_path: projectDir
    });
    const res1 = JSON.parse(res1Json);
    const instr1 = res1.instructions || '';
    const len1 = instr1.length;

    const res2Json = server.runMcpAgent('jonin', {
      task: 'Scaffold hero section',
      project_path: projectDir
    });
    const res2 = JSON.parse(res2Json);
    const instr2 = res2.instructions || '';
    const len2 = instr2.length;

    assert.ok(len1 < 8000, `Turn 1 length (${len1}) must be < 8KB`);
    assert.ok(len2 < 8000, `Turn 2 length (${len2}) must be < 8KB`);
    assert.strictEqual(instr1, instr2, 'Same task across Turn 1 and Turn 2 must be 100% deterministic');
    assert.ok(instr1.includes('[Konoha Token Preservation: Active'));
    assert.ok(instr1.includes('ecommerce-app'));
    assert.ok(instr1.includes('Next.js'));
    assert.ok(instr1.includes('pnpm'));
    console.log('✓ Turn 1 vs Turn 2 unified token-bounded prompt passed');

    // 2. Multi-client support
    const clients = ['claudecode', 'commandcode', 'opencode', 'agy', 'cursor'];
    for (const client of clients) {
      server.ACTIVE_CLIENT = client;
      process.env.SESSION_ID = `session-${client}-999`;

      const r1 = JSON.parse(server.runMcpAgent('jonin', { task: 'Task 1', project_path: projectDir }));
      const r2 = JSON.parse(server.runMcpAgent('jonin', { task: 'Task 1', project_path: projectDir }));

      assert.ok(r1.instructions.length < 8000, `${client} prompt must be bounded (< 8KB)`);
      assert.strictEqual(r1.instructions, r2.instructions, `${client} prompt must be deterministic`);
      assert.ok(r2.instructions.includes('Token Preservation'), `${client} Turn 2 must include Token Preservation badge`);
      assert.ok(r2.instructions.includes('ecommerce-app'), `${client} Turn 2 must retain project context`);
    }
    console.log('✓ Multi-client support passed');

    // 3. Compact turn retains skill SOP and task authority
    const conn2 = db.getDb(testDbPath);
    conn2.prepare(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        skill_name TEXT,
        type TEXT,
        content TEXT,
        tags TEXT,
        byte_size INTEGER DEFAULT 0
      )
    `).run();
    conn2.prepare(`
      INSERT OR REPLACE INTO skills (name, skill_name, type, content, tags, byte_size)
      VALUES ('jonin-skill', 'jonin-skill', 'skill', 'Root cause first: reproduce the bug, read the failing code, then fix. Never delete prior fixes when a new error appears.', 'ui', 120)
    `).run();
    conn2.prepare("UPDATE agents SET instructions = ? WHERE name = 'jonin'").run(
      'Step 1. Reproduce the reported bug. '.repeat(60)
    );
    conn2.close();

    process.env.ANTIGRAVITY_CONVERSATION_ID = 'conv-compact-retention';
    server.ACTIVE_CLIENT = 'agy';
    server.SESSION_TURNS.clear();

    JSON.parse(server.runMcpAgent('jonin', { task: 'Turn one task', project_path: projectDir }));
    const r2Retention = JSON.parse(server.runMcpAgent('jonin', { task: 'Fix the DB9 reload bug', project_path: projectDir }));
    const instr2Retention = r2Retention.instructions || '';

    assert.ok(instr2Retention.includes('jonin-skill'), 'Must contain skill name');
    assert.ok(instr2Retention.includes('Root cause first'), 'Must contain skill SOP preview');
    assert.ok(instr2Retention.includes('authoritative task'), 'Must contain authoritative task directive');
    assert.ok(instr2Retention.includes('Never reinterpret, narrow, or replace'), 'Must contain task invariant directive');
    assert.ok(instr2Retention.includes('Fix the DB9 reload bug'), 'Must contain full task text');
    if (instr2Retention.includes('...[truncated]')) {
      const truncatedAt = instr2Retention.indexOf('...[truncated]');
      assert.ok(instr2Retention.slice(0, truncatedAt).includes('Reproduce the reported bug.'));
    }
    console.log('✓ Compact turn retains skill SOP and task authority passed');

    // 4. Session turn resets after idle
    delete process.env.ANTIGRAVITY_CONVERSATION_ID;
    delete process.env.CLAUDE_CONVERSATION_ID;
    delete process.env.OPENCODE_SESSION_ID;
    delete process.env.COMMANDCODE_SESSION_ID;
    delete process.env.CURSOR_SESSION_ID;
    delete process.env.SESSION_ID;

    server.SESSION_TURNS.clear();
    server.SESSION_TURN_LAST_ACCESS.clear();
    server.ACTIVE_CLIENT = 'agy';

    const cd = require('../src/mcp/client_detection');
    const sessKey = cd.getSessionKey(projectDir);
    const t1 = cd.getAndIncrementSessionTurn(sessKey);
    const t2 = cd.getAndIncrementSessionTurn(sessKey);
    assert.strictEqual(t1, 1);
    assert.strictEqual(t2, 2);

    // Simulate 31 minutes of inactivity
    server.SESSION_TURN_LAST_ACCESS.set(sessKey, server.SESSION_TURN_LAST_ACCESS.get(sessKey) - (server.SESSION_IDLE_RESET_SECONDS + 60));

    const t3 = cd.getAndIncrementSessionTurn(sessKey);
    assert.strictEqual(t3, 1, 'Turn counter must reset to 1 after 30 min idle');
    console.log('✓ Session turn resets after idle passed');

    // 5. Cross-session and Cross-project turn isolation
    const projectDirA = path.join(tmpDir, 'project-a');
    const projectDirB = path.join(tmpDir, 'project-b');
    fs.mkdirSync(projectDirA, { recursive: true });
    fs.mkdirSync(projectDirB, { recursive: true });

    server.SESSION_TURNS.clear();
    // Same client, different projects
    const keyProjA = cd.getSessionKey(projectDirA, 'sess-common');
    const keyProjB = cd.getSessionKey(projectDirB, 'sess-common');
    assert.notStrictEqual(keyProjA, keyProjB, 'Same client in different projects must have different keys');

    const turnA = cd.getAndIncrementSessionTurn(keyProjA);
    const turnA_next = cd.getAndIncrementSessionTurn(keyProjA);
    const turnB = cd.getAndIncrementSessionTurn(keyProjB);
    assert.strictEqual(turnA, 1);
    assert.strictEqual(turnA_next, 2);
    assert.strictEqual(turnB, 1, 'Project B must not inherit Project A turn count');

    // Different client, different projects
    server.ACTIVE_CLIENT = 'cursor';
    const keyCursorB = cd.getSessionKey(projectDirB, 'sess-1');
    server.ACTIVE_CLIENT = 'agy';
    const keyAgyA = cd.getSessionKey(projectDirA, 'sess-1');
    assert.notStrictEqual(keyCursorB, keyAgyA);

    // Different client, same project
    server.ACTIVE_CLIENT = 'cursor';
    const keyCursorSame = cd.getSessionKey(projectDirA, 'sess-1');
    server.ACTIVE_CLIENT = 'claudecode';
    const keyClaudeSame = cd.getSessionKey(projectDirA, 'sess-1');
    assert.notStrictEqual(keyCursorSame, keyClaudeSame);
    console.log('✓ Cross-session and cross-project turn isolation passed');

    console.log('\nAll test_auto_compaction tests passed!');
  } finally {
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    personaMemory.DB_PATH = prevPersonaDb;
    server.ACTIVE_CLIENT = prevActiveClient;
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
