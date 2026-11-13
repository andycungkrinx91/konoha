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

async function sannin(args) {
  const res = await server.handleToolCall(nextId++, {
    name: 'sannin',
    arguments: JSON.stringify(args),
  });
  const text = res.result.content[0].text;
  const parsed = JSON.parse(text);
  assert.ok(!parsed.error, `sannin failed: ${text.slice(0, 400)}`);
  return parsed;
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

  const gate2 = await sannin({ prompt, task_dir: gate1.task_dir, choice: '1' });
  assert.equal(gate2.status, 'awaiting_human', 'an answered Gate 1 must park on Gate 2, not pause on the token budget');
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

  console.log('\nMCP sannin transport: Gate 1 → Gate 2 → completion verified');
}

run()
  .then(() => {
    try { db.close(); } catch (_) { /* already closed */ }
    process.env = savedEnv;
    for (const dir of [home, workspace, dbDir]) fs.rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFAIL ' + err.message);
    console.error(err.stack);
    try { db.close(); } catch (_) { /* already closed */ }
    process.exit(1);
  });
