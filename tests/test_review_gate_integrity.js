'use strict';

// Regression coverage for two LangGraph review-node defects found by audit:
// - A cached Akatsuki gate was read verbatim, but the pass check looks at
//     `decision` while the raw blue-team report uses `gate_decision`. A BLOCKED
//     security review therefore counted as a pass — a fail-open delivery gate.
//     Partial/empty gate objects failed open the same way (`undefined !== false`).
// - Confidence/aislop results were cached on the first review pass, so a run
//     that began below 98% remediated against a frozen score and could never
//     recover, even after the code was fixed.
//
// reviewNode is exercised directly: going through the full graph lets the execute
// node re-run a fresh scan and overwrite seeded evidence, which would hide the
// very behaviour under test.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = path.join(os.tmpdir(), `konoha-review-gate-${process.pid}.db`);
process.env.KONOHA_DB_PATH = TMP_DB;

// review.js destructures runAislopGate at load time, so the stub must be installed
// on workflow_dispatch BEFORE the langgraph modules are required.
const dispatch = require(path.join(ROOT, 'src/mcp/workflow_dispatch'));
const originalGate = dispatch.runAislopGate;
let slopMode = 'pass';
let slopCalls = 0;
dispatch.runAislopGate = function stubGate() {
  slopCalls += 1;
  if (slopMode !== 'pass' && slopCalls === 1) {
    return { enforced: true, ok: false, pass: false, score: 70, findings: [{ severity: 'high' }] };
  }
  if (slopMode === 'stuck') {
    return { enforced: true, ok: false, pass: false, score: 70, findings: [{ severity: 'high' }] };
  }
  return { enforced: true, ok: true, pass: true, score: 100, findings: [] };
};

const { reviewNode } = require(path.join(ROOT, 'src/mcp/langgraph/nodes/review'));

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

// Signed off and fully green apart from the security verdict, so only the
// Akatsuki gate can explain a non-delivered outcome.
const BASE_STATUS = {
  phase: 'review',
  plan: '1. Implement auth',
  plan_approved: true,
  human_signed_off: true,
  confidence: 100,
  ai_slop_clean: true,
  ai_slop_findings: 0,
  report: 'done',
  tasks: [{ id: 'task_1', task: 'Implement auth', agent: 'anbu', status: 'completed' }],
  completed_dispatches: ['d1'],
};

async function runReview(seed, tag) {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), `lg-review-${tag}-`));
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(seed), 'utf8');
  return reviewNode(
    { taskDir, prompt: 'Implement OAuth login and token rotation', tokenBudget: 32768, threadId: `${tag}-${Date.now()}` },
    { configurable: { thread_id: `${tag}-${Date.now()}` } }
  );
}

(async () => {
  console.log('\nreview gate integrity');

  const blockedCases = [
    ['raw blue-team report (gate_decision) is blocked', {
      akatsuki_review: { gate_decision: 'blocked', critical_count: 1, high_count: 0, findings: [{ severity: 'critical' }] },
    }],
    ['normalized gate is blocked', {
      akatsuki_gate: { decision: 'blocked', passed: false, critical_count: 1, high_count: 0 },
    }],
    ['empty cached gate object', { akatsuki_gate: {} }],
    ['gate names a decision but no passed flag', { akatsuki_gate: { decision: 'passed' } }],
    ['unrecognized decision', { akatsuki_gate: { decision: 'weird', passed: true } }],
    ['review artifact carries no verdict', { akatsuki_review: { bogus: true } }],
    ['gate decision is failed', { akatsuki_gate: { decision: 'failed', passed: false } }],
    ['blue mode explicitly skipped', { akatsuki_gate: { decision: 'skipped_violation', passed: false } }],
  ];

  for (const [label, extra] of blockedCases) {
    const res = await runReview({ ...BASE_STATUS, ...extra }, label.replace(/[^a-z0-9]/gi, ''));
    check(`fails closed: ${label}`, () => {
      assert.notStrictEqual(res.phase, 'done', 'a blocked/unrecognized security verdict must not deliver');
      assert.notStrictEqual(res.gateVerdict, 'pass', 'must not record a pass verdict');
    });
  }

  for (const [label, extra] of [
    ['explicit passed gate', { akatsuki_gate: { decision: 'passed', passed: true, critical_count: 0, high_count: 0 } }],
    ['not applicable gate', { akatsuki_gate: { decision: 'not_applicable', passed: true } }],
  ]) {
    const res = await runReview({ ...BASE_STATUS, ...extra }, label.replace(/[^a-z0-9]/gi, ''));
    check(`allows delivery: ${label}`, () => {
      assert.strictEqual(res.phase, 'done', 'a clean security verdict with sign-off must deliver');
    });
  }

  // A run whose code starts bad and gets fixed must be able to leave remediation.
  slopMode = 'recovering';
  slopCalls = 0;
  {
    const res = await runReview({
      phase: 'review',
      plan: '1. Implement auth',
      plan_approved: true,
      tasks: [{ id: 'task_1', task: 'Implement auth', agent: 'anbu', status: 'completed' }],
      completed_dispatches: ['d1'],
      akatsuki_gate: { decision: 'passed', passed: true, critical_count: 0, high_count: 0 },
    }, 'recovering');
    check('confidence is re-evaluated on each review pass', () => {
      assert.strictEqual(slopCalls, 1, 'a single review pass must consult the slop gate, not a cached score');
      assert.notStrictEqual(res.phase, 'error', 'a failing score must remediate rather than error out');
    });
  }

  // And when the score is still cached on a later pass it must be recomputed:
  // the second invocation must call the gate again instead of trusting status.confidence.
  slopMode = 'pass';
  slopCalls = 0;
  {
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-stale-'));
    // Stale failing score from an earlier pass; the code is now clean.
    fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify({
      ...BASE_STATUS,
      confidence: 42,
      ai_slop_clean: false,
      ai_slop_findings: 5,
      akatsuki_gate: { decision: 'passed', passed: true, critical_count: 0, high_count: 0 },
    }), 'utf8');
    const res = await reviewNode(
      { taskDir, prompt: 'Implement OAuth login and rotation', tokenBudget: 32768, threadId: 'stale' },
      { configurable: { thread_id: 'stale' } }
    );
    check('a stale failing confidence is not reused', () => {
      assert.ok(slopCalls >= 1, 'the slop gate must run even when status.confidence is already set');
      assert.strictEqual(res.phase, 'done', 'a now-clean codebase must be allowed to deliver');
    });
  }

  dispatch.runAislopGate = originalGate;
  try { fs.rmSync(TMP_DB, { force: true }); } catch (_) { /* ignore */ }

  if (failures > 0) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nreview gate integrity: OK');
})();
