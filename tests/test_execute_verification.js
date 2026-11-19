#!/usr/bin/env node
// DB isolation: workflow status lives under the task dir, not the real DB.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_execute_verification.js — a slice is only complete when something
 * actually ran it.
 *
 * `runMcpAgentAsync` prepares a prompt and a spawn directive; it starts no child
 * process. The execute node used to stamp every such slice `completed` with
 * `validation: ['... (exit 0)']`, which let a workflow reach Gate 2 "Delivery
 * Sign-Off" having executed nothing. The contract now: a sliceExecutor's own
 * `completed` result completes the slice; the MCP runner path stays
 * `spawn_pending` and hands the directive back to the client, which
 * `report_from_agent` later completes.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function tempTaskDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-exec-'));
  fs.mkdirSync(path.join(dir, 'delegated'), { recursive: true });
  return dir;
}

function seedStatus(taskDir, tasks) {
  const { saveWorkflowStatus } = require('../src/mcp/workflow_common');
  saveWorkflowStatus(taskDir, {
    prompt: 'test run',
    phase: 'execute',
    tasks,
    completed_dispatches: []
  });
  return taskDir;
}

async function run() {
  console.log('Execute node child verification');
  const { executeNode } = require('../src/mcp/langgraph/nodes/execute');
  const { loadWorkflowStatus } = require('../src/mcp/workflow_common');

  await checkAsync('MCP-runner slices are not reported as verified children', async () => {
    const taskDir = seedStatus(tempTaskDir(), [
      { id: 'slice_a', agent: 'anbu', task: 'fix the bug', status: 'pending' }
    ]);
    await executeNode({ taskDir, prompt: 'test run', client: 'universal', projectPath: taskDir }, {});
    const status = loadWorkflowStatus(taskDir);
    const task = status.tasks.find((t) => t.id === 'slice_a');
    assert.notStrictEqual(task.status, 'completed', 'an unspawned slice must not be completed');
    assert.strictEqual(task.status, 'spawn_pending');
    assert.ok(task.spawn_directive, 'the pending slice keeps its spawn directive');
    assert.ok(
      (status.spawn_pending || []).some((s) => s.task_id === 'slice_a'),
      'pending spawn is recorded on the workflow status'
    );
    const telemetry = (status.parallel_execution_telemetry || []).find((t) => t.task_id === 'slice_a');
    assert.strictEqual(telemetry.child_execution_verified, false);
    assert.strictEqual(status.parallel_execution_proof, undefined, 'no parallel proof without real children');
  });

  await checkAsync('a real sliceExecutor result completes the slice', async () => {
    const taskDir = seedStatus(tempTaskDir(), [
      { id: 'slice_b', agent: 'anbu', task: 'fix the bug', status: 'pending' }
    ]);
    const sliceExecutor = async (task) => ({
      task_id: task.id,
      agent: 'anbu',
      status: 'completed',
      summary: 'fixed',
      validation: ['node --test exited 0']
    });
    await executeNode({ taskDir, prompt: 'test run', client: 'universal', projectPath: taskDir, sliceExecutor }, {});
    const status = loadWorkflowStatus(taskDir);
    const task = status.tasks.find((t) => t.id === 'slice_b');
    assert.strictEqual(task.status, 'completed');
    assert.deepStrictEqual(task.result.validation, ['node --test exited 0']);
    assert.deepStrictEqual(status.spawn_pending, []);
  });

  await checkAsync('an executor that reports failure keeps the slice open', async () => {
    const taskDir = seedStatus(tempTaskDir(), [
      { id: 'slice_c', agent: 'anbu', task: 'fix the bug', status: 'pending' }
    ]);
    const sliceExecutor = async (task) => ({
      task_id: task.id,
      agent: 'anbu',
      status: 'failed',
      summary: 'compile error',
      validation: ['node --test exited 1']
    });
    await executeNode({ taskDir, prompt: 'test run', client: 'universal', projectPath: taskDir, sliceExecutor }, {});
    const status = loadWorkflowStatus(taskDir);
    const task = status.tasks.find((t) => t.id === 'slice_c');
    assert.notStrictEqual(task.status, 'completed', 'a failed slice must not complete');
  });

  check('no source path still hardcodes verified_specialist_slice', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'mcp', 'langgraph', 'nodes', 'execute.js'), 'utf8');
    assert.ok(!src.includes('verified_specialist_slice'), 'fabricated exit-0 validation is gone');
  });

  console.log(`\n${passed} checks passed`);
}

run().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
