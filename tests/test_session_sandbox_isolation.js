#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_session_sandbox_isolation.js
 * 
 * Verifies multi-session & cross-client isolation:
 * 1. Sandboxed tmp root paths (~/.konoha/tmp/<client>/<project_hash>/<session_id>/)
 * 2. Task resolution isolation between concurrent sessions & projects
 * 3. Persona memory isolation: memories in Session A do not leak to Session B
 * 4. SDLC task scoping by project_path and session_id
 * 5. MCP tool dispatch respects project_path and session_id
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cd = require('../src/mcp/client_detection');
const runtimeState = require('../src/mcp/runtime_state');
const { getResolvedTaskDir, runSannin } = require('../src/mcp/workflow');
const { executeTool } = require('../src/mcp/tool_dispatch');
const persona = require('../src/persona_memory');
const sdlc = require('../src/sdlc_manager');

async function run() {
  console.log('Running test_session_sandbox_isolation tests...');
  const testDbPath = process.env.KONOHA_DB_PATH;

  const projA = path.join(os.tmpdir(), 'konoha_test_proj_alpha_' + Date.now());
  const projB = path.join(os.tmpdir(), 'konoha_test_proj_beta_' + Date.now());
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });

  const sessA = 'agy_session_alpha_123';
  const sessB = 'pi_session_beta_456';

  try {
    // -------------------------------------------------------------
    // Test 1: getKonohaTmpRoot constructs distinct isolated sandboxes
    // -------------------------------------------------------------
    console.log('1. Verifying tmp root directory isolation...');
    const tmpA = cd.getKonohaTmpRoot(projA, sessA);
    const tmpB = cd.getKonohaTmpRoot(projB, sessB);

    assert.notStrictEqual(tmpA, tmpB, 'Tmp roots for different projects and sessions must be different');
    assert.ok(tmpA.includes(sessA), `tmpA (${tmpA}) must contain sessA (${sessA})`);
    assert.ok(tmpB.includes(sessB), `tmpB (${tmpB}) must contain sessB (${sessB})`);

    const hashA = crypto.createHash('sha256').update(projA).digest('hex').slice(0, 12);
    const hashB = crypto.createHash('sha256').update(projB).digest('hex').slice(0, 12);
    assert.ok(tmpA.includes(hashA), `tmpA (${tmpA}) must contain project A hash (${hashA})`);
    assert.ok(tmpB.includes(hashB), `tmpB (${tmpB}) must contain project B hash (${hashB})`);
    console.log('✓ Tmp root directory isolation verified');

    // -------------------------------------------------------------
    // Test 2: Task directory resolution isolation
    // -------------------------------------------------------------
    console.log('2. Verifying task directory resolution isolation...');
    const taskDirA = getResolvedTaskDir(null, projA, sessA);
    const taskDirB = getResolvedTaskDir(null, projB, sessB);

    assert.notStrictEqual(taskDirA, taskDirB, 'Task dirs for different sessions must never collide');
    assert.ok(taskDirA.startsWith(tmpA), `taskDirA must be inside tmpA`);
    assert.ok(taskDirB.startsWith(tmpB), `taskDirB must be inside tmpB`);

    // Simulate Sannin creating a task in session A
    const specificTaskA = path.join(tmpA, 'scratch', 'tasks', 'task_alpha_001');
    fs.mkdirSync(specificTaskA, { recursive: true });
    fs.writeFileSync(path.join(specificTaskA, 'prompt.md'), 'Task for Alpha in agy', 'utf8');
    fs.writeFileSync(path.join(specificTaskA, 'delegate.md'), '# Delegation for Alpha', 'utf8');

    // Now check what session B resolves when taskDir is null
    const resolvedInB = getResolvedTaskDir(null, projB, sessB);
    assert.ok(!resolvedInB.includes('task_alpha_001'), 'Session B must NEVER resolve to Session A task');
    assert.ok(!resolvedInB.startsWith(tmpA), 'Session B resolution must NEVER point to Session A tmp directory');

    // Check what session A resolves
    const resolvedInA = getResolvedTaskDir(null, projA, sessA);
    assert.strictEqual(resolvedInA, specificTaskA, 'Session A must resolve to its own latest task');
    console.log('✓ Task directory resolution isolation verified');

    // -------------------------------------------------------------
    // Test 3: Persona memory isolation (Episodic knowledge per-session)
    // -------------------------------------------------------------
    console.log('3. Verifying persona memory per-session isolation...');
    // Save episodic memory tagged with sessA
    persona.saveMemory({
      persona: 'anbu',
      content: 'Alpha session memory: specialized postgres port is 5433',
      sessionId: sessA,
      projectPath: projA,
      category: 'stack'
    });

    // Save episodic memory tagged with sessB
    persona.saveMemory({
      persona: 'anbu',
      content: 'Beta session memory: specialized redis port is 6380',
      sessionId: sessB,
      projectPath: projB,
      category: 'stack'
    });

    // Query memories from session B
    const memsB = persona.queryMemories({
      persona: 'anbu',
      sessionId: sessB,
      projectPath: projB
    });

    const bHasAlpha = memsB.some(m => m.content.includes('Alpha session memory'));
    const bHasBeta = memsB.some(m => m.content.includes('Beta session memory'));
    assert.strictEqual(bHasAlpha, false, 'Session B must NOT receive Session A episodic memory');
    assert.strictEqual(bHasBeta, true, 'Session B must receive its own session episodic memory');

    // Query memories from session A
    const memsA = persona.queryMemories({
      persona: 'anbu',
      sessionId: sessA,
      projectPath: projA
    });

    const aHasAlpha = memsA.some(m => m.content.includes('Alpha session memory'));
    const aHasBeta = memsA.some(m => m.content.includes('Beta session memory'));
    assert.strictEqual(aHasAlpha, true, 'Session A must receive its own session episodic memory');
    assert.strictEqual(aHasBeta, false, 'Session A must NOT receive Session B episodic memory');

    // A fresh session C in project A should NOT see session A episodic memory
    const sessC = 'agy_session_alpha_fresh_789';
    const memsC = persona.queryMemories({
      persona: 'anbu',
      sessionId: sessC,
      projectPath: projA
    });
    const cHasAlpha = memsC.some(m => m.content.includes('Alpha session memory'));
    assert.strictEqual(cHasAlpha, false, 'A new session C must not receive session A episodic memory');
    console.log('✓ Persona memory per-session isolation verified');

    // -------------------------------------------------------------
    // Test 4: SDLC Tasks Scoping
    // -------------------------------------------------------------
    console.log('4. Verifying SDLC tasks scoping...');
    sdlc.createTask({
      id: 'task_iso_alpha_1',
      description: 'Alpha task in sessA',
      status: 'in_progress',
      project_path: projA,
      session_id: sessA,
      client: 'antigravity'
    }, testDbPath);

    sdlc.createTask({
      id: 'task_iso_beta_1',
      description: 'Beta task in sessB',
      status: 'in_progress',
      project_path: projB,
      session_id: sessB,
      client: 'pi'
    }, testDbPath);

    const listProjA = sdlc.listTasks({ projectPath: projA }, testDbPath);
    assert.ok(listProjA.some(t => t.id === 'task_iso_alpha_1'), 'projA tasks must include task_iso_alpha_1');
    assert.ok(!listProjA.some(t => t.id === 'task_iso_beta_1'), 'projA tasks must NOT include task_iso_beta_1');

    const listSessB = sdlc.listTasks({ projectPath: projB, sessionId: sessB }, testDbPath);
    assert.ok(listSessB.some(t => t.id === 'task_iso_beta_1'), 'sessB tasks must include task_iso_beta_1');
    assert.ok(!listSessB.some(t => t.id === 'task_iso_alpha_1'), 'sessB tasks must NOT include task_iso_alpha_1');
    console.log('✓ SDLC tasks scoping verified');

    // -------------------------------------------------------------
    // Test 5: MCP Tool Dispatch Isolation
    // -------------------------------------------------------------
    console.log('5. Verifying MCP tool dispatch isolation...');
    const mcpTaskDirResA = JSON.parse(await executeTool('get_resolved_task_dir', {
      project_path: projA,
      session_id: sessA
    }));
    assert.strictEqual(mcpTaskDirResA.status, 'ok');
    assert.ok(mcpTaskDirResA.task_dir.includes(sessA));
    assert.ok(mcpTaskDirResA.task_dir.includes(hashA));

    const mcpTaskDirResB = JSON.parse(await executeTool('get_resolved_task_dir', {
      project_path: projB,
      session_id: sessB
    }));
    assert.strictEqual(mcpTaskDirResB.status, 'ok');
    assert.ok(mcpTaskDirResB.task_dir.includes(sessB));
    assert.ok(mcpTaskDirResB.task_dir.includes(hashB));
    assert.notStrictEqual(mcpTaskDirResA.task_dir, mcpTaskDirResB.task_dir);
    // -------------------------------------------------------------
    // Test 6: Environment variable leak resistance across clients
    // -------------------------------------------------------------
    console.log('6. Verifying environment variable leak resistance...');
    const origAgyConv = process.env.ANTIGRAVITY_CONVERSATION_ID;
    try {
      process.env.ANTIGRAVITY_CONVERSATION_ID = 'agy-leak-canary-777';
      // When client is explicitly pi, it must NEVER adopt ANTIGRAVITY_CONVERSATION_ID
      const piSess = cd.getActiveSessionId(projB, 'pi');
      assert.notStrictEqual(piSess, 'agy-leak-canary-777', 'Pi must never inherit ANTIGRAVITY_CONVERSATION_ID');

      // When client is explicitly claudecode, it must NEVER adopt ANTIGRAVITY_CONVERSATION_ID
      const claudeSess = cd.getActiveSessionId(projB, 'claudecode');
      assert.notStrictEqual(claudeSess, 'agy-leak-canary-777', 'Claude Code must never inherit ANTIGRAVITY_CONVERSATION_ID');
    } finally {
      if (origAgyConv !== undefined) process.env.ANTIGRAVITY_CONVERSATION_ID = origAgyConv;
      else delete process.env.ANTIGRAVITY_CONVERSATION_ID;
    }
    console.log('✓ Environment variable leak resistance verified');

    // -------------------------------------------------------------
    // Test 7: Foreign task directory isolation
    // -------------------------------------------------------------
    console.log('7. Verifying foreign task directory confinement...');
    const foreignTaskDir = path.join(tmpA, 'scratch', 'tasks', 'task_alpha_foreign_999');
    fs.mkdirSync(foreignTaskDir, { recursive: true });
    fs.writeFileSync(path.join(foreignTaskDir, 'delegate.md'), '# Foreign Alpha task', 'utf8');

    // When session B resolves its latest task with taskDir=null, it must NOT pick up session A's task
    const resolvedB = getResolvedTaskDir(null, projB, sessB);
    assert.ok(!resolvedB.includes('task_alpha_foreign_999'), 'Session B must never resolve to foreign task');
    assert.ok(!resolvedB.includes(hashA), 'Confined dir must NOT point to Project A');
    assert.ok(resolvedB.includes(hashB), 'Confined dir must be confined to Project B sandbox');
    console.log('✓ Foreign task directory confinement verified');

    // -------------------------------------------------------------
    // Test 8: Subagent tool invocation respects session_id & project_path
    // -------------------------------------------------------------
    console.log('8. Verifying subagent tool invocation isolation...');
    const anbuResRaw = await executeTool('anbu', {
      task: 'Fix specific beta backend bug',
      project_path: projB,
      session_id: sessB
    });
    const anbuRes = JSON.parse(anbuResRaw);
    assert.strictEqual(anbuRes.status, 'ready');
    assert.strictEqual(anbuRes.project_path, projB);
    assert.strictEqual(anbuRes.session_id, sessB);
    assert.ok(anbuRes.task_dir.includes(sessB), 'anbu task_dir must contain sessB');
    assert.ok(anbuRes.task_dir.includes(hashB), 'anbu task_dir must contain hashB');
    console.log('✓ Subagent tool invocation isolation verified');

    console.log('\nAll test_session_sandbox_isolation tests passed cleanly!');
  } finally {
    try { fs.rmSync(projA, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
    try { fs.rmSync(projB, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
  }
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
