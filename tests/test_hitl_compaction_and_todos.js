'use strict';

/**
 * Verification Suite: Component 3 — Native Walkthrough & TODO Visibility, HITL Gates,
 * and Post-Approval Automatic Context Compaction Across All 8 Clients
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncTodoAndWalkthrough, buildClientTodoDirective } = require('../src/mcp/todo_walkthrough_sync');
const { buildGate1Prompt, parseGateChoice, applyGate1Choice } = require('../src/mcp/workflow_gates');

async function runTests() {
  console.log('Running test_hitl_compaction_and_todos.js...');

  const tmpTaskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-hitl-test-'));

  const sampleTodos = [
    { id: 'step_1', content: 'Audit codebase with @genin', status: 'completed', agent: 'genin' },
    { id: 'step_2', content: 'Implement fix with @anbu', status: 'in_progress', agent: 'anbu' }
  ];
  const sampleWalkthrough = [
    { step: 1, title: 'Discovery', agent: 'genin', status: 'completed' },
    { step: 2, title: 'Implementation', agent: 'anbu', status: 'in_progress' }
  ];

  const clientExpectedTools = {
    antigravity: 'task_boundary',
    claude: 'TodoWrite',
    cursor: 'TodoWrite',
    opencode: 'todowrite',
    commandcode: 'TodoWrite',
    codex: 'update_plan',
    omp: 'todo_write',
    pi: 'todo_write'
  };

  for (const [client, expectedTool] of Object.entries(clientExpectedTools)) {
    const dir = buildClientTodoDirective(client, sampleTodos, sampleWalkthrough);
    assert.strictEqual(dir.native_tool, expectedTool, `Expected ${expectedTool} for ${client}, got ${dir.native_tool}`);
    assert.ok(dir.markdown_checklist.includes('step_1'));
  }

  const statusObj = {
    phase: 'plan_approval',
    prompt: 'Fix authentication token refresh race condition',
    tasks: sampleTodos,
    findings: 'Verbose discovery output '.repeat(200),
    plan: '# Execution Plan\n' + 'Detailed exploratory research notes and verbose draft paragraphs.\n'.repeat(120)
  };
  const synced = syncTodoAndWalkthrough(statusObj, {
    taskDir: tmpTaskDir,
    client: 'antigravity'
  });
  assert.strictEqual(synced.todos.length, 2);
  assert.ok(synced.walkthrough_steps.length >= 4);
  assert.ok(fs.existsSync(path.join(tmpTaskDir, 'walkthrough_todos.json')));

  const gate1Raw = buildGate1Prompt(statusObj, tmpTaskDir, 'task_test_1', statusObj.plan);
  const gate1Parsed = JSON.parse(gate1Raw);
  assert.strictEqual(gate1Parsed.status, 'pending_plan_approval');
  assert.ok(gate1Parsed.hitl_gate_meta && gate1Parsed.hitl_gate_meta.required === true);
  assert.strictEqual(gate1Parsed.hitl_gate_meta.choices.length, 3);
  assert.ok(Array.isArray(gate1Parsed.todos) && gate1Parsed.todos.length === 2);

  const planFile = path.join(tmpTaskDir, 'plan.md');
  fs.writeFileSync(planFile, statusObj.plan, 'utf8');
  const choiceObj = parseGateChoice('1. Compact and approve');
  const mockSdlc = { updateTask: () => {} };
  const approveRes = applyGate1Choice(choiceObj, statusObj, tmpTaskDir, mockSdlc);
  assert.strictEqual(approveRes.approved, true, 'applyGate1Choice option 1 must approve plan');
  assert.ok(approveRes.compaction && approveRes.compaction.compacted === true, 'Must execute automatic context compaction');
  assert.ok(approveRes.compaction.bytes_saved > 0, 'Must save bytes during post-approval compaction');
  assert.ok(Array.isArray(approveRes.todos) && approveRes.todos.length === 2, 'Must include synced todos on approval');

  fs.rmSync(tmpTaskDir, { recursive: true, force: true });
  console.log('PASS test_hitl_compaction_and_todos.js');
}

runTests().catch((err) => {
  console.error('FAIL test_hitl_compaction_and_todos.js:', err);
  process.exit(1);
});
