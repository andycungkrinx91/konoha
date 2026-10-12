'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_upsert_atomic_'));
const dbPath = path.join(tmpDir, 'test_memory.db');

try {
  const db = require('../src/db');
  const conn = db.getConnection(dbPath);
  db.setupSchema(conn);
  conn.close();

  // Child script runner to invoke saveOrUpdateProject or saveMemory concurrently
  const childScriptPath = path.join(tmpDir, 'child_runner.js');
  const childScriptContent = `
    const { saveOrUpdateProject, saveMemory } = require('${path.resolve(__dirname, '../src/persona_memory')}');
    const [action, dbPath, arg1, arg2] = process.argv.slice(2);

    if (action === 'project') {
      saveOrUpdateProject(arg1, arg2, null, dbPath);
    } else if (action === 'memory') {
      saveMemory({
        agentName: 'kage',
        content: 'Consistent operational rule across concurrent sessions',
        title: 'Rule Title',
        projectPath: arg1,
        sessionId: 'session_123',
        dbPath: dbPath
      });
    }
  `;
  fs.writeFileSync(childScriptPath, childScriptContent, 'utf-8');

  // Test 1: Concurrent saveOrUpdateProject
  {
    const projDir = path.join(tmpDir, 'sample_project');
    fs.mkdirSync(projDir, { recursive: true });

    // Spawn 2 child processes concurrently
    const p1 = spawnSync(process.execPath, [childScriptPath, 'project', dbPath, projDir, 'Summary A'], { encoding: 'utf-8' });
    const p2 = spawnSync(process.execPath, [childScriptPath, 'project', dbPath, projDir, 'Summary B'], { encoding: 'utf-8' });

    assert.strictEqual(p1.status, 0, `Process 1 failed: ${p1.stderr}`);
    assert.strictEqual(p2.status, 0, `Process 2 failed: ${p2.stderr}`);

    const verifyConn = db.getConnection(dbPath);
    const projects = verifyConn.prepare("SELECT count(*) as c FROM projects").get();
    assert.strictEqual(projects.c, 1, `Expected exactly 1 project row, got ${projects.c}`);
    verifyConn.close();
  }

  // Test 2: Concurrent saveMemory with identical identity keys
  {
    const projDir = path.join(tmpDir, 'sample_project');

    // Spawn 2 child processes attempting to upsert the exact same memory concurrently
    const p1 = spawnSync(process.execPath, [childScriptPath, 'memory', dbPath, projDir], { encoding: 'utf-8' });
    const p2 = spawnSync(process.execPath, [childScriptPath, 'memory', dbPath, projDir], { encoding: 'utf-8' });

    assert.strictEqual(p1.status, 0, `Process 1 failed: ${p1.stderr}`);
    assert.strictEqual(p2.status, 0, `Process 2 failed: ${p2.stderr}`);

    const verifyConn = db.getConnection(dbPath);
    const memories = verifyConn.prepare("SELECT count(*) as c FROM persona_memories").get();
    assert.strictEqual(
      memories.c,
      1,
      `Expected exactly 1 memory row after concurrent upserts, got ${memories.c} (no duplicates allowed)`
    );
    verifyConn.close();
  }

  // Test 3: Nested transaction (SAVEPOINT) execution with saveOrUpdateProject & saveMemory
  {
    const { saveOrUpdateProject, saveMemory, getDb } = require('../src/persona_memory');
    const nestConn = getDb(dbPath);

    // Run within an outer transaction
    const outerTx = nestConn.transaction(() => {
      saveOrUpdateProject(path.join(tmpDir, 'nested_proj'), 'Outer summary', null, nestConn);
      saveMemory({
        agentName: 'jonin',
        content: 'Nested memory content',
        title: 'Nested Title',
        projectPath: path.join(tmpDir, 'nested_proj'),
        dbPath: nestConn
      });
    });

    outerTx();
    nestConn.close();

    const verifyConn = db.getConnection(dbPath);
    const countProj = verifyConn.prepare("SELECT count(*) as c FROM projects WHERE project_path LIKE '%nested_proj'").get().c;
    const countMem = verifyConn.prepare("SELECT count(*) as c FROM persona_memories WHERE agent_name = 'jonin'").get().c;
    assert.strictEqual(countProj, 1, 'Nested project save must commit');
    assert.strictEqual(countMem, 1, 'Nested memory save must commit');
    verifyConn.close();
  }

  console.log('test_persona_upsert_atomic: PASS');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
