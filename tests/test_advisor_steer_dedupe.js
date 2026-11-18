#!/usr/bin/env node
'use strict';

/**
 * Advisor steers are token-expensive and the same violation re-fires on every
 * turn it is still unfixed. Verify: one steer per signature per cooldown, a
 * fresh violation still steers, a genuine change still steers, and the drift
 * judge only spends a model call when keyword overlap is thin.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'tests', 'helpers', 'isolate_db'));

const steering = require(path.join(ROOT, 'src', 'workflow', 'kage-reviewer', 'advisor_steering'));
const monitor = require(path.join(ROOT, 'src', 'workflow', 'kage-reviewer', 'advisor_monitor'));

const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-dedupe-'));

function steer(opts) {
  return steering.enqueueAdvisorSteer({ taskDir, client: 'omp', targetAgent: 'anbu', ...opts });
}

function queue() {
  return steering.peekPendingAdvisorSteers(taskDir);
}

// The same violation twice in a row is one steer.
const violations = [{ type: 'todo_drift', detail: '@anbu skipped the retry task' }];
const first = steer({ violations, directive: 'Do the retry task.' });
const second = steer({ violations, directive: 'Do the retry task.' });
assert.strictEqual(queue().length, 1, 'duplicate steer must not be enqueued twice');
assert.strictEqual(second.id, first.id, 'duplicate call must return the existing steer');

// A different directive is a different steer.
steer({ violations, directive: 'Stop and read the plan first.' });
assert.strictEqual(queue().length, 2, 'changed directive must enqueue');

// A different violation type is a different steer.
steer({ violations: [{ type: 'goal_drift', detail: 'off goal' }], directive: 'Do the retry task.' });
assert.strictEqual(queue().length, 3, 'changed violation type must enqueue');

// Zero cooldown restores unconditional enqueue (explicit opt-out).
steer({ violations, directive: 'Do the retry task.', cooldownMs: 0 });
assert.strictEqual(queue().length, 4, 'cooldownMs=0 must disable dedupe');

// After the cooldown expires the same steer is allowed again.
steering.acknowledgeAdvisorSteers(taskDir, 'anbu');
const queuePath = path.join(taskDir, '.konoha_advisor_steers.json');
const raw = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
for (const item of raw) item.created_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
fs.writeFileSync(queuePath, JSON.stringify(raw));
const before = JSON.parse(fs.readFileSync(queuePath, 'utf8')).length;
steer({ violations, directive: 'Do the retry task.' });
assert.strictEqual(JSON.parse(fs.readFileSync(queuePath, 'utf8')).length, before + 1, 'expired cooldown must allow a re-steer');

// The drift judge is only consulted on thin keyword overlap.
assert.strictEqual(monitor.isDriftAmbiguous('add retry backoff to the bridge fetch call', 'no relation whatsoever here'), false,
  'zero overlap is not ambiguous: the keyword check already catches it');
assert.strictEqual(monitor.isDriftAmbiguous('add retry backoff to the bridge fetch call', 'backoff retry backoff retry backoff retry'), false,
  'full overlap is not ambiguous');
assert.strictEqual(monitor.isDriftAmbiguous('add retry backoff to the bridge fetch call', 'backoff plus cache layer added'), true,
  'thin overlap must be probed');
assert.strictEqual(monitor.isDriftAmbiguous('add retry backoff to the bridge fetch call', 'backoff on the bridge call, plus a cache'), false,
  'half the goal terms present is not ambiguous');
assert.strictEqual(monitor.isDriftAmbiguous('', 'anything at all here'), false, 'no goal is never ambiguous');

// The async evaluator stays free when the turn is unambiguous.
(async () => {
  const clean = await monitor.evaluateWorkerTurnAsync({
    agent: 'anbu',
    goal: 'add retry backoff to the bridge fetch call',
    summary: 'added backoff retry to the bridge fetch call, exit 0',
    status: 'completed',
    validation: ['node --test exited 0'],
    enqueueSteer: false
  });
  assert.strictEqual(clean.status, 'IDLE_OK', `unambiguous clean turn must cost nothing, got ${clean.status}`);

  // A model-issued drift verdict is appended to the deterministic ones.
  const drifted = monitor.evaluateWorkerTurn({
    agent: 'anbu',
    goal: 'add retry backoff to the bridge fetch call',
    summary: 'rewrote the CLI help text',
    status: 'completed',
    validation: ['node --test exited 0'],
    enqueueSteer: false
  }, { modelDrift: { source: 'model', drift: true, reason: 'Summary describes CLI help text, not the requested bridge retry.' } });
  assert.strictEqual(drifted.interrupted, true, 'model drift verdict must interrupt the turn');
  assert.strictEqual(drifted.status, 'INTERRUPT_CORRECTION');
  assert(drifted.violations.some((v) => v.type === 'goal_drift' && /CLI help text/.test(v.detail)), 'model reason must reach the steer directive');

  console.log('  steer queue length after dedupe probe: ' + queue().length);
  console.log('PASS test_advisor_steer_dedupe.js');
})().catch((err) => { console.error(err); process.exit(1); });
