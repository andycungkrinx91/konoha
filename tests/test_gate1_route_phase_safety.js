'use strict';

// Gate 1 must never approve a task that has no plan and no gate recorded.
// A task sitting in the 'route' phase has neither, so a supplied choice must be
// rejected rather than silently authorizing execution.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log('  PASS ' + name);
  } catch (err) {
    failures += 1;
    console.log('  FAIL ' + name + '\n    ' + err.message);
  }
}

console.log('\nGate 1 route-phase safety');

check('workflow_sannin has no route-phase gate bypass', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'workflow_sannin.js'), 'utf8');
  const fnStart = src.indexOf('function _handlePendingGateSannin');
  assert.ok(fnStart >= 0, 'handler not found');
  const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
  assert.ok(!/phase === 'route'/.test(fnBody), 'route phase must not satisfy isGate1');
  assert.ok(!/routedWithChoice/.test(fnBody), 'routedWithChoice bypass must not exist');
});

check('workflow_runner isGate1 does not accept route phase', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'workflow_runner.js'), 'utf8');
  const decl = src.match(/const isGate1 = [^;]+;/);
  assert.ok(decl, 'isGate1 declaration not found');
  assert.ok(!/phase === 'route'/.test(decl[0]), 'isGate1 must not accept route phase');
});

check('a planless routed task is left unapproved by runSannin', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gate1-route-'));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  const cacheKeys = ['KONOHA_HOME', 'KONOHA_TASK_DIR'];
  const prevEnv = {};
  for (const key of cacheKeys) {
    prevEnv[key] = process.env[key];
    delete process.env[key];
  }
  const taskDir = path.join(home, 'tasks', 'route-only-task');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify({
    schema_version: 2,
    phase: 'route',
    assigned_agent: 'sannin',
    task_id: 'route-only-task',
    prompt: 'audit something',
    tasks: [],
  }, null, 2));
  try {
    const { runSannin } = require('../src/mcp/workflow_sannin.js');
    runSannin(undefined, taskDir, ROOT, 'sess-route-only', { choice: '1', refinement: 'approve' });
    const after = JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'));
    assert.ok(!after.plan_approved, 'route-phase choice must not set plan_approved');
  } finally {
    process.env.HOME = prevHome;
    for (const key of cacheKeys) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check('workflow_runner rejects a route-phase choice behaviorally', () => {
  const { _handleGateOptions } = require('../src/mcp/workflow_runner.js');
  const status = {
    schema_version: 2,
    phase: 'route',
    task_id: 'route-only-task',
    prompt: 'audit something',
    tasks: [],
  };
  const result = _handleGateOptions({ choice: '1', refinement: 'approve' }, status, 'route', '/tmp/gate1-runner-probe', null);
  assert.ok(!status.plan_approved, 'route-phase choice must not set plan_approved');
  const nextPhase = result && result.phase;
  assert.notStrictEqual(nextPhase, 'execute', 'route-phase choice must not advance to execute');
  assert.strictEqual(result && result.response, undefined, 'route-phase choice must not produce a gate response');
});

if (failures > 0) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\ngate1 route-phase safety: OK');
