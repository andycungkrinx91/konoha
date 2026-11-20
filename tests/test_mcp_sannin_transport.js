#!/usr/bin/env node
'use strict';

/**
 * The deployed MCP transport must reach the LangGraph workflow, not just the
 * routing envelope.
 *
 * Defect pinned here: `handleToolCall` dispatched `sannin` through the
 * synchronous router, which only ran `runSannin`. A fresh workspace therefore
 * answered every call with `status: routed` / `phase: delegation` — no Gate 1,
 * no Gate 2, no confidence, no picker — and the workflow never advanced.
 *
 * Second defect pinned here: a turn that stopped on the per-turn token budget
 * also carried `hitlPending` from the checkpoint, so the merge path reported a
 * parked gate with no `hitl_gate`/`picker`/`choices` to answer. A gate envelope
 * is now the only proof of a parked gate, and a budget pause resumes instead of
 * being handed back to the caller.
 *
 * Third defect pinned here: an answered Gate 1 was reported as `routed`, which
 * told the caller a subagent had been dispatched when nothing had run. The
 * honest envelope is `spawn_pending` plus a directive, and the workflow only
 * advances once `report_from_agent` records the slice. The report evidence below
 * is synthetic on purpose — this suite pins the envelope → report → resume
 * transition; real child execution is pinned by test_subagent_spawning_p0.js.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-mcp-transport-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-mcp-ws-'));
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-mcp-db-'));

const savedEnv = { ...process.env };
process.env.HOME = home;
process.env.KONOHA_DB_PATH = path.join(dbDir, 'konoha.db');
process.env.KONOHA_WORKSPACE_ROOT = workspace;
process.env.ACTIVE_CLIENT = 'omp';
process.env.KONOHA_CLIENT = 'omp';

fs.writeFileSync(path.join(workspace, 'index.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
execFileSync('git', ['init', '-q'], { cwd: workspace });
execFileSync('git', ['add', '-A'], { cwd: workspace });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: workspace });

const db = require(path.join(REPO, 'src', 'db.js'));
db.setupSchema(db.getConnection());
const server = require(path.join(REPO, 'src', 'file_tools_mcp.js'));

let nextId = 1;

async function callTool(name, args) {
  const res = await server.handleToolCall(nextId++, {
    name,
    arguments: JSON.stringify(args),
  });
  const text = res.result.content[0].text;
  const parsed = JSON.parse(text);
  assert.ok(!parsed.error, `${name} failed: ${text.slice(0, 400)}`);
  return parsed;
}

async function sannin(args) {
  return callTool('sannin', args);
}

async function run() {
  const prompt = 'Add a CSV row parser with tests';

  const gate1 = await sannin({ prompt, project_path: workspace, session_id: 'transport-1' });
  assert.equal(gate1.status, 'awaiting_human', 'the transport path must park on Gate 1, not return a routing envelope');
  assert.equal(gate1.hitlStage, 'gate1', 'Gate 1 stage must be reported');
  assert.equal(gate1.hitlPending, true);
  assert.ok(gate1.hitl_gate, 'Gate 1 payload must name the gate');
  assert.ok(Array.isArray(gate1.hitl_gate_meta && gate1.hitl_gate_meta.choices) && gate1.hitl_gate_meta.choices.length >= 3, 'Gate 1 must offer its choices');
  assert.ok(gate1.picker && gate1.picker.transport, 'Gate 1 must carry a picker binding for the active client');
  assert.equal(gate1.picker.transport, 'native_tool', 'omp must get the native picker');
  assert.equal(gate1.picker.tool, 'ask');
  assert.equal(gate1.instructions, undefined, 'a parked gate must not tell the agent to spawn a subagent');
  assert.ok(gate1.langgraph_checkpoint && gate1.langgraph_checkpoint.graph_phase === 'plan');
  assert.ok(gate1.task_dir, 'task_dir is required to answer the gate');

  // The MCP transport cannot spawn a child: the graph ends the turn with a spawn
  // directive and the caller runs it. Reporting the result back is what resumes the
  // workflow, so this is the sequence a real client performs. The report evidence
  // here is synthetic on purpose — this suite pins the envelope → report → resume
  // transition, and real child execution is pinned by test_subagent_spawning_p0.js.
  const SYNTHETIC_EVIDENCE = 'transport fixture, no command executed: synthetic exit 0 marker';
  async function spawnAndReport(awaiting, taskDir, label) {
    assert.equal(awaiting.status, 'spawn_pending', `${label} must hand the caller a spawn directive, not claim a parked gate`);
    assert.equal(awaiting.next_action, 'spawn_and_report');
    assert.equal(awaiting.resume_node, 'node_execute');
    assert.ok(!awaiting.hitlStage, `${label} must not report a gate that was never reached`);
    assert.ok(awaiting.instructions === undefined, `${label} must not claim a spawned child`);
    const pending = awaiting.spawn_pending;
    assert.ok(Array.isArray(pending) && pending.length > 0, `${label} must name the slices to spawn`);
    for (const slice of pending) {
      assert.ok(slice.task_id, `${label} slice must carry its task id`);
      assert.ok(typeof slice.spawn_directive === 'string' && slice.spawn_directive.length > 0, `${label} slice must carry the directive to run`);
      const report = await callTool('report_from_agent', {
        task_dir: taskDir,
        agent_name: slice.agent || 'kage',
        task_id: slice.task_id,
        summary: 'Transport fixture: delegated slice recorded with tests; nothing was spawned or run.',
        validation: [SYNTHETIC_EVIDENCE]
      });
      assert.equal(report.task_status, 'completed', `a report with validation evidence must complete ${slice.task_id}`);
      assert.equal(report.verified, true, `a report with validation evidence must verify ${slice.task_id}`);
    }
    return pending;
  }

  const gate2Pending = await sannin({ prompt, task_dir: gate1.task_dir, choice: '1' });
  await spawnAndReport(gate2Pending, gate1.task_dir, 'an answered Gate 1');

  const gate2 = await sannin({ prompt, task_dir: gate1.task_dir });
  assert.equal(gate2.status, 'awaiting_human', 'a reported slice must advance to Gate 2, not pause on the token budget');
  assert.equal(gate2.hitlStage, 'gate2');
  assert.ok(gate2.hitl_gate, 'Gate 2 payload must name the gate');
  assert.ok(gate2.picker && gate2.picker.transport, 'Gate 2 must carry a picker binding');
  assert.equal(typeof gate2.confidence, 'number', 'Gate 2 must report the Kage confidence score');
  assert.ok(gate2.confidence >= 98, `confidence ${gate2.confidence} is below the delivery floor`);
  assert.ok(gate2.akatsuki_gate, 'Gate 2 must report the Akatsuki blue-team verdict');
  assert.equal(gate2.akatsuki_gate.decision, 'passed');

  const done = await sannin({ prompt, task_dir: gate1.task_dir, choice: '1' });
  assert.equal(done.status, 'completed', 'an answered Gate 2 must complete the workflow');
  assert.equal(done.phase, 'done');
  assert.equal(typeof done.confidence, 'number', 'the sign-off response must carry the confidence it judged');
  assert.ok(done.akatsuki_gate, 'the sign-off response must carry the Akatsuki verdict');
  assert.ok(done.report, 'the sign-off response must carry the report');

  // A report without validation evidence must never verify. This is the other half
  // of the spawn contract: the caller may report, but only evidence completes a slice.
  const noEvidenceG1 = await sannin({ prompt: 'Build evidence-free report guard with tests', project_path: workspace, session_id: 'transport-no-evidence' });
  assert.equal(noEvidenceG1.hitlStage, 'gate1');
  const noEvidencePending = await sannin({ prompt: 'Build evidence-free report guard with tests', task_dir: noEvidenceG1.task_dir, choice: '1' });
  assert.equal(noEvidencePending.status, 'spawn_pending');
  const noEvidenceSlice = noEvidencePending.spawn_pending[0];
  const bareReport = await callTool('report_from_agent', {
    task_dir: noEvidenceG1.task_dir,
    agent_name: noEvidenceSlice.agent || 'kage',
    task_id: noEvidenceSlice.task_id,
    summary: 'Transport fixture: evidence-free report guard recorded without tests.'
  });
  assert.equal(bareReport.verified, false, 'a report with no validation evidence must not verify');
  assert.equal(bareReport.task_status, 'unverified', 'a report with no validation evidence must be recorded unverified');
  const afterBare = await sannin({ prompt: 'Build evidence-free report guard with tests', task_dir: noEvidenceG1.task_dir });
  assert.notEqual(afterBare.status, 'completed', 'an unverified report must not complete the workflow');

  // Security: auto_signoff: true over MCP sannin must NEVER bypass Gate 2 when hitl_mode is enabled
  const lockedG1 = await sannin({ prompt: 'Build locked HITL delivery module with tests', project_path: workspace, session_id: 'transport-hitl-lock', auto_signoff: true });
  assert.equal(lockedG1.status, 'awaiting_human');
  assert.equal(lockedG1.hitlStage, 'gate1');
  const lockedPending = await sannin({ prompt: 'Build locked HITL delivery module with tests', task_dir: lockedG1.task_dir, choice: '1', auto_signoff: true });
  await spawnAndReport(lockedPending, lockedG1.task_dir, 'an answered locked Gate 1');
  const lockedG2 = await sannin({ prompt: 'Build locked HITL delivery module with tests', task_dir: lockedG1.task_dir, auto_signoff: true });
  assert.equal(lockedG2.status, 'awaiting_human', 'Gate 2 must remain enforced when hitl_mode is enabled even if auto_signoff=true');
  assert.equal(lockedG2.hitlStage, 'gate2');

  // Security: protocol.js must enforce manifest validation (reject unknown thread_id on sannin)
  const protocol = require(path.join(REPO, 'src', 'mcp', 'protocol.js'));
  protocol.setInitialized(true);
  const badProto = await protocol.handleRequest({
    jsonrpc: '2.0',
    id: 9001,
    method: 'tools/call',
    params: { name: 'sannin', arguments: { prompt: 'hello', thread_id: 'hijack-thread' } }
  });
  assert.equal(badProto.result.isError, true, 'protocol.js must reject unknown argument thread_id on sannin');
  const badProtoPayload = JSON.parse(badProto.result.content[0].text);
  assert.equal(badProtoPayload.error, 'invalid_arguments');

  // Security: reviewNode must fail closed if runAislopGate throws on a real project
  const reviewNodePath = require.resolve(path.join(REPO, 'src', 'mcp', 'langgraph', 'nodes', 'review.js'));
  const wfDispatchPath = require.resolve(path.join(REPO, 'src', 'mcp', 'workflow_dispatch.js'));
  const wfDispatchMod = require(wfDispatchPath);
  const origRunAislopGate = wfDispatchMod.runAislopGate;
  wfDispatchMod.runAislopGate = () => { throw new Error('Simulated aislop crash'); };
  delete require.cache[reviewNodePath];
  try {
    const { reviewNode } = require(reviewNodePath);
    const failTaskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-review-failclosed-'));
    try {
      const revRes = await reviewNode({
        prompt: 'Verify fail-closed aislop',
        taskDir: failTaskDir,
        projectPath: workspace,
        autoSignoff: true,
        status: { plan_approved: true, akatsuki_gate: { decision: 'passed', passed: true } }
      });
      assert.equal(revRes.gateVerdict, 'remediate', 'runAislopGate throw must fail closed to remediate');
      assert.equal(revRes.status.ai_slop_clean, false);
      assert.equal(revRes.confidence, 0);
    } finally {
      fs.rmSync(failTaskDir, { recursive: true, force: true });
    }
  } finally {
    wfDispatchMod.runAislopGate = origRunAislopGate;
    delete require.cache[reviewNodePath];
  }

  // Security (M3): a single-turn direct_subagent call supplying hitlChoice='1' when hitl_mode='enabled'
  // must park at Gate 2 instead of signing off without Gate 2 ever having been entered.
  const { runKonohaGraph } = require(path.join(REPO, 'src', 'mcp', 'langgraph'));
  const { setSliceExecutor, clearSliceExecutor } = require(path.join(REPO, 'src', 'mcp', 'langgraph', 'slice_executor_registry'));
  const m3TaskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-m3-direct-gate2-'));
  try {
    fs.writeFileSync(path.join(m3TaskDir, 'status.json'), JSON.stringify({
      project_path: workspace,
      hitl_mode: 'enabled',
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      akatsuki_gate: { decision: 'passed', passed: true }
    }, null, 2), 'utf8');
    const m3ThreadId = `m3-direct-${Date.now()}`;
    // The stale hitlChoice is the thing under test, not spawning: a graph that
    // stopped at spawn_pending would never reach the Gate 2 decision at all. This
    // executor stands in for the client that runs the slice; the call count below
    // proves it actually ran instead of being silently ignored.
    let m3Executions = 0;
    setSliceExecutor(m3ThreadId, async (task) => {
      m3Executions += 1;
      return { task_id: task.id, status: 'completed', summary: `Checked ${task.id}`, child_execution_verified: true };
    });
    const m3Res = await runKonohaGraph({
      prompt: '/anbu Check auth flow',
      projectPath: workspace,
      taskDir: m3TaskDir,
      hitlChoice: '1',
      threadId: m3ThreadId
    });
    clearSliceExecutor(m3ThreadId);
    assert.ok(m3Executions > 0, 'the stand-in executor must have run the slice for Gate 2 to be reachable');
    assert.equal(m3Res.hitlPending, true, 'Turn-1 direct_subagent with stale hitlChoice must still park on Gate 2 when HITL is enabled');
    assert.equal(m3Res.hitlStage, 'gate2');
    assert.ok(!m3Res.status || !m3Res.status.human_signed_off, 'human_signed_off must remain false before Gate 2 was presented');
  } finally {
    fs.rmSync(m3TaskDir, { recursive: true, force: true });
  }

  console.log('\nMCP sannin transport: Gate 1 → Gate 2 → completion + security regression checks verified');
}

run()
  .then(() => {
    try { db.close(); } catch (_) { /* already closed */ }
    process.env = savedEnv;
    // Windows keeps the SQLite handle open past db.close(), so teardown is best-effort:
    // the assertions above already decided the exit code. Matches the sibling suites.
    for (const dir of [home, workspace, dbDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (_) { /* locked until exit */ }
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFAIL ' + err.message);
    console.error(err.stack);
    try { db.close(); } catch (_) { /* already closed */ }
    process.exit(1);
  });
