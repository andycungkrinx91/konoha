#!/usr/bin/env node
/**
 * Delegation integrity regression test.
 *
 * Defects pinned here:
 *   1. A `wordCount <= 12` cutoff forced `fast_track` for genuinely multi-step
 *      prompts ("add login page and api endpoint" = 6 words), so the LangGraph
 *      pipeline was skipped entirely (phase `done`, tasks []) and the main agent
 *      executed alone — no subagent was ever dispatched.
 *   2. `reviewNode` raised Gate 2 "Delivery Sign-Off" even though every task was
 *      still `pending` with `completed_dispatches: []` — the workflow claimed
 *      delivery ready with zero subagent work.
 *   3. `completeNode` stamped the DB record `completed` without any delegated
 *      work; `planNode` reads that as "plan already approved", which skips Gate 1
 *      and leaves a freshly spawned subagent staring at a finished task.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const { classifyExecutionTrack } = require(path.join(REPO, 'src', 'mcp', 'workflow_sannin.js'));
const { reviewNode } = require(path.join(REPO, 'src', 'mcp', 'langgraph', 'nodes', 'review.js'));
const wc = require(path.join(REPO, 'src', 'mcp', 'workflow_common.js'));

function freshTaskDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('short multi-step prompts delegate instead of fast-tracking', () => {
  const mustDelegate = [
    'add login page and api endpoint',
    'fix the null pointer in upload handler',
    'migrate the database schema to postgres',
    'refactor auth module into separate services',
    'update button color',
    'build a marketplace'
  ];
  for (const prompt of mustDelegate) {
    assert.equal(classifyExecutionTrack(prompt), 'full_sdlc', `"${prompt}" must enter the SDLC pipeline and delegate`);
  }

  const mayFastTrack = [
    'fix typo',
    'update version',
    'what does this function do?',
    'explain the auth flow',
    'restart the server',
    'search for the config loader',
    '/anbu add login',
    'fast_track: add thing'
  ];
  for (const prompt of mayFastTrack) {
    assert.equal(classifyExecutionTrack(prompt), 'fast_track', `"${prompt}" should stay fast-track`);
  }

  // Explicit overrides always win, in both directions.
  assert.equal(classifyExecutionTrack('full_sdlc: add login page and api endpoint'), 'full_sdlc');
  assert.equal(classifyExecutionTrack('fast_track: add login page and api endpoint'), 'fast_track');
});

test('review refuses to raise Gate 2 while delegated tasks are pending', async () => {
  const taskDir = freshTaskDir('deleg-guard-');
  wc.saveWorkflowStatus(taskDir, {
    task_id: 'G',
    phase: 'review',
    tasks: [
      { id: 'task_1', agent: 'jonin', status: 'pending' },
      { id: 'task_2', agent: 'anbu', status: 'pending' }
    ],
    completed_dispatches: []
  });

  const res = await reviewNode({ taskDir, threadId: 'G', client: 'claudecode' });

  assert.equal(res.delegationPending, true, 'review must report pending delegation');
  assert.deepEqual(res.pending_task_ids, ['task_1', 'task_2']);
  assert.equal(res.hitlStage, null, 'Gate 2 must NOT be raised on unexecuted work');
  assert.notEqual(res.phase, 'review');
  assert.equal(res.resumeNode, 'node_dispatch', 'must go back to dispatch, not forward to sign-off');

  const persisted = wc.loadWorkflowStatus(taskDir);
  assert.equal(persisted.hitl_gate, null);
  assert.equal(persisted.phase, 'execute');
});

test('review still reaches Gate 2 when every task genuinely completed', async () => {
  const taskDir = freshTaskDir('deleg-happy-');
  wc.saveWorkflowStatus(taskDir, {
    task_id: 'H',
    phase: 'review',
    confidence: 99,
    ai_slop_findings: 0,
    ai_slop_clean: true,
    report: 'delivered',
    tasks: [
      { id: 'task_1', agent: 'jonin', status: 'completed' },
      { id: 'task_2', agent: 'anbu', status: 'completed' }
    ],
    completed_dispatches: ['d1', 'd2']
  });

  const res = await reviewNode({ taskDir, threadId: 'H', client: 'claudecode' });
  // The review verdict depends on the host (aislop availability, repo contents,
  // advisor context), so a bare "expected gate2" does not say which gate rejected
  // the delivery. Report every input to the verdict plus the persisted gate record.
  let akatsukiReview = null;
  try {
    akatsukiReview = JSON.parse(fs.readFileSync(path.join(taskDir, 'akatsuki_review.json'), 'utf8'));
  } catch (_) {
    akatsukiReview = null;
  }
  const verdictDiag = {
    phase: res.phase,
    gateVerdict: res.gateVerdict,
    confidence: res.confidence,
    akatsukiPassed: res.akatsukiPassed,
    remediationReason: res.status && res.status.remediation_reason,
    aislopGate: res.status && res.status.aislop_gate,
    akatsukiDecision: akatsukiReview && (akatsukiReview.decision || akatsukiReview.gate_decision),
    akatsukiFindings: akatsukiReview && akatsukiReview.findings,
    advisorViolations: res.status && res.status.advisor_review && res.status.advisor_review.violations,
  };
  assert.equal(
    res.hitlStage,
    'gate2',
    `completed work must still reach delivery sign-off (${JSON.stringify(verdictDiag)})`
  );
  assert.equal(res.gateVerdict, 'pending_signoff');
});

test('completeNode does not stamp completion without delegated work', async () => {
  const { completeNode } = require(path.join(REPO, 'src', 'mcp', 'langgraph', 'nodes', 'complete.js'));
  const calls = [];
  const sdlcPath = require.resolve(path.join(REPO, 'src', 'workflow', 'kage-reviewer', 'sdlc_manager.js'));
  const sdlc = require(sdlcPath);
  const orig = sdlc.updateTask;
  sdlc.updateTask = (id, patch) => { calls.push({ id, patch }); };
  try {
    // No tasks, no dispatches -> fast-track/no-op: must not mark completed.
    const emptyDir = freshTaskDir('deleg-noop-');
    wc.saveWorkflowStatus(emptyDir, { task_id: 'N', phase: 'execute', tasks: [], completed_dispatches: [] });
    await completeNode({ taskDir: emptyDir, threadId: 'N' });
    assert.equal(
      calls.filter((c) => c.patch && c.patch.status === 'completed').length,
      0,
      'a no-op run must not be stamped completed (would let planNode skip Gate 1)'
    );

    // Real delegated work -> completion is legitimately recorded.
    const doneDir = freshTaskDir('deleg-done-');
    wc.saveWorkflowStatus(doneDir, {
      task_id: 'D',
      phase: 'review',
      tasks: [{ id: 'task_1', agent: 'anbu', status: 'completed' }],
      completed_dispatches: ['d1']
    });
    await completeNode({ taskDir: doneDir, threadId: 'D' });
    assert.ok(
      calls.some((c) => c.patch && c.patch.status === 'completed'),
      'genuine delegated work must still be recorded as completed'
    );
  } finally {
    sdlc.updateTask = orig;
  }
});
