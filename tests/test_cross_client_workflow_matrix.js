#!/usr/bin/env node
'use strict';

/**
 * tests/test_cross_client_workflow_matrix.js
 *
 * Cross-client test matrix covering all 8 supported clients:
 * Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, and OMP.
 *
 * Verifies in an isolated fixture:
 * 1. Client initialization writes expected canonical MCP server entries.
 * 2. User request reaches Sannin and classifies/routes.
 * 3. Workflow transitions to explore phase with Genin.
 * 4. Workflow reaches configured gate (Gate 1 Plan Approval in HITL mode).
 * 5. Direct MCP argument path enforced; bypass / retired file-based IPC rejected with deterministic error.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Force test isolation
const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-matrix-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });
process.env.KONOHA_DB_PATH = path.join(os.tmpdir(), 'konoha-qa', 'skills.db');

const agentManager = require('../src/agent_manager');
const { runMcpAgent } = require('../src/mcp/memory_subagent_runner');
const { reportFromAgent } = require('../src/mcp/memory_project_context');
const { runMcpWorkflow } = require('../src/mcp/workflow_runner');
const { saveWorkflowStatus, loadWorkflowStatus } = require('../src/mcp/workflow_common');

console.log('Running cross-client workflow enforcement test matrix...');
console.log(`Isolated fixture root: ${QA_ROOT}`);

const CLIENTS = [
  'antigravity',
  'cursor',
  'claudecode',
  'opencode',
  'commandcode',
  'codex',
  'pi',
  'omp'
];

// Verify supported clients list (installer registry keys: `claude` is the CLI binary).
assert.deepStrictEqual(
  agentManager.SUPPORTED_CLIENTS.slice().sort(),
  ['antigravity', 'claude', 'codex', 'commandcode', 'cursor', 'omp', 'opencode', 'pi']
);

// Verify invalid client rejection
assert.throws(() => {
  agentManager.ensureClientSetup('unsupported_editor');
}, /Unknown or unsupported client: unsupported_editor/);

const invalidDispatch = agentManager.validateWorkflowDispatch({
  task: 'read prompt.md'
});
assert.strictEqual(invalidDispatch.ok, false);
assert.strictEqual(invalidDispatch.reason, 'retired_file_ipc');
assert.match(invalidDispatch.error, /retired and rejected/);

// Test Matrix for all 8 supported clients
for (const client of CLIENTS) {
  console.log(`\n--- Testing Client: ${client.toUpperCase()} ---`);

  const clientHome = path.join(QA_ROOT, client, 'home');
  const clientProj = path.join(QA_ROOT, client, 'project');
  fs.mkdirSync(clientHome, { recursive: true });
  fs.mkdirSync(clientProj, { recursive: true });

  // A. Initialization writes canonical MCP configuration
  let configPath = null;
  if (client === 'antigravity') {
    configPath = path.join(clientHome, '.gemini', 'config', 'mcp_config.json');
    agentManager.ensureClientSetup('antigravity', { home: clientHome, configPath, silent: true });
  } else if (client === 'cursor') {
    configPath = path.join(clientHome, '.cursor', 'mcp.json');
    agentManager.ensureClientSetup('cursor', { home: clientHome, configPath, silent: true, deployProject: false });
  } else if (client === 'claudecode') {
    configPath = path.join(clientHome, '.claude.json');
    agentManager.ensureClientSetup('claude', { home: clientHome, configPath, silent: true });
  } else if (client === 'opencode') {
    configPath = path.join(clientHome, '.config', 'opencode', 'opencode.json');
    agentManager.ensureClientSetup('opencode', { home: clientHome, configPath, silent: true, force: true, skipDetection: true });
  } else if (client === 'commandcode') {
    configPath = path.join(clientHome, '.commandcode', 'mcp.json');
    agentManager.ensureClientSetup('commandcode', { home: clientHome, configPath, silent: true, force: true });
  } else if (client === 'codex') {
    configPath = path.join(clientHome, '.codex', 'config.toml');
    agentManager.ensureClientSetup('codex', { home: clientHome, configPath, silent: true, force: true, skipDetection: true });
  } else if (client === 'pi') {
    configPath = path.join(clientHome, '.pi', 'agent', 'mcp.json');
    agentManager.ensureClientSetup('pi', { home: clientHome, configPath, silent: true, force: true, skipDetection: true });
  } else if (client === 'omp') {
    configPath = path.join(clientHome, '.omp', 'agent', 'mcp.json');
    agentManager.ensureClientSetup('omp', { home: clientHome, configPath, silent: true });
  }

  assert.ok(fs.existsSync(configPath), `Client ${client} must write config at ${configPath}`);
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  assert.match(rawConfig, /konoha/, `Client ${client} config must declare konoha server`);
  assert.doesNotMatch(rawConfig, /["']semble["']\s*:\s*\{/, `Client ${client} config must not declare the retired semble server`);
  assert.match(rawConfig, /aislop/, `Client ${client} config must declare aislop server`);
  console.log(`  ✓ Canonical MCP configuration verified: ${configPath}`);

  // B. User request reaches Sannin and classifies/routes
  // Pin the identity: without this the ambient harness env decides which client
  // Sannin resolves, so the matrix silently tests one client eight times.
  process.env.ACTIVE_CLIENT = client;
  const testSession = `test-sess-${client}-${Date.now()}`;
  const prompt = 'Refactor user database schema and implement order processing api endpoint';
  const sanninRaw = agentManager.runCanonicalWorkflow(prompt, {
    projectPath: clientProj,
    sessionId: testSession
  });
  const sanninRes = JSON.parse(sanninRaw);
  assert.strictEqual(sanninRes.status, 'routed', `Sannin must route the request for ${client}`);
  assert.ok(sanninRes.task_id, `Task ID must be generated for ${client}`);
  assert.ok(sanninRes.flow_hash, `Flow hash must be computed for ${client}`);
  assert.ok(sanninRes.task_dir, `Task directory must be resolved for ${client}`);
  assert.strictEqual(sanninRes.selected_agent, 'anbu', 'Backend prompt must route to anbu');
  assert.strictEqual(sanninRes.execution_mode, 'delegate', 'Execution mode must be delegate');
  if (client === 'pi') {
    assert.ok(sanninRes.instructions.includes('UNSUPPORTED_NATIVE_SPAWN'), 'Pi must report the unsupported-spawn payload');
  } else {
    assert.ok(sanninRes.instructions.includes('## Spawn (mandatory)'), `Instructions must include spawn directive for ${client}`);
  }
  assert.ok(sanninRes.advisor_supervisor && sanninRes.advisor_supervisor.started_from_beginning === true && sanninRes.advisor_supervisor.state === 'idle', `Sannin must start @advisor idle from turn 0 for ${client}`);
  assert.ok(sanninRes.advisor_spawn_directive && sanninRes.advisor_spawn_directive.agent === 'advisor' && sanninRes.advisor_spawn_directive.started_from_beginning === true, `Sannin must return advisor_spawn_directive for ${client}`);
  // The turn-0 instruction must be a call the client can actually make. A bare
  // `--idle` CLI flag is meaningless to `task`/`Agent`/`Task`/`spawn_agent`.
  assert.ok(typeof sanninRes.advisor_spawn_directive.spawn_call === 'string' && sanninRes.advisor_spawn_directive.spawn_call.length > 0, `Sannin must return an executable advisor spawn call for ${client}`);
  assert.ok(sanninRes.instructions.includes(sanninRes.advisor_spawn_directive.spawn_call), `Sannin instructions must carry the executable advisor spawn call for ${client}`);
  console.log(`  ✓ Reached Sannin router: task_id=${sanninRes.task_id}, agent=${sanninRes.selected_agent}, advisor=${sanninRes.advisor_supervisor.state}`);

  // C. Genin invoked for exploration
  const exploreRaw = agentManager.dispatchWorkflow(sanninRes.task_dir);
  const exploreRes = JSON.parse(exploreRaw);
  assert.strictEqual(exploreRes.phase, 'explore', 'Phase must advance to explore');
  assert.strictEqual(exploreRes.agent, 'genin', 'Exploration must assign genin');
  console.log(`  ✓ Genin invoked for exploration phase in ${sanninRes.task_dir}`);

  // D. Workflow reaches configured gate (Gate 1 Plan Approval in HITL mode)
  // Genin completes via structured report_from_agent (never result.md)
  reportFromAgent('genin', 'Exploration findings: found auth controller and security gaps', 'completed', null, null, null, null, sanninRes.task_dir, exploreRes.dispatch_id, ['explore traced 3 files, exit 0']);
  fs.writeFileSync(path.join(sanninRes.task_dir, 'findings.md'), 'Findings: auth endpoints need audit log middleware.', 'utf8');
  const planRaw = agentManager.dispatchWorkflow(sanninRes.task_dir);
  const planRes = JSON.parse(planRaw);
  assert.strictEqual(planRes.phase, 'plan', 'Workflow must advance to plan phase after explore');
  assert.strictEqual(planRes.agent, 'kage', 'Kage must be assigned to compile action plan');

  // Simulate Kage writing plan.md
  fs.writeFileSync(path.join(sanninRes.task_dir, 'plan.md'), '## Action Plan\n\n1. [anbu] Refactor auth controller.\n2. [anbu] Add audit log service.\n', 'utf8');
  // Kage completes the plan phase via structured report_from_agent (never result.md)
  reportFromAgent('kage', 'Compiled action plan in plan.md', 'completed', null, null, null, null, sanninRes.task_dir, planRes.dispatch_id, ['plan reviewed, exit 0']);

  // Next dispatch evaluates plan and reaches Gate 1 (Plan Approval)
  const gateRaw = agentManager.dispatchWorkflow(sanninRes.task_dir);
  const gateRes = JSON.parse(gateRaw);
  assert.strictEqual(gateRes.status, 'pending_plan_approval', 'Must block on Gate 1 Plan Approval');
  assert.strictEqual(gateRes.hitl_gate, 'Gate 1 (Plan Approval)');
  assert.ok(gateRes.interactive_prompt, 'Gate 1 must return interactive prompt');
  assert.ok(gateRes.interactive_prompt.choices.includes('Compact and approve'));
  assert.ok(gateRes.interactive_prompt.choices.includes('Reject and Regenerate PLAN'));

  // Calling sannin without choice keeps task paused at Gate 1
  const sanninPauseRaw = agentManager.runCanonicalWorkflow(null, {
    taskDir: sanninRes.task_dir,
    projectPath: clientProj,
    sessionId: testSession
  });
  const sanninPause = JSON.parse(sanninPauseRaw);
  assert.strictEqual(sanninPause.status, 'pending_plan_approval', 'Must stay paused when no choice is given');

  // Submitting choice 1 (Compact and approve) approves plan and advances to execute
  const approvedRaw = agentManager.runCanonicalWorkflow('1. Compact and approve', {
    taskDir: sanninRes.task_dir,
    projectPath: clientProj,
    sessionId: testSession
  });
  const approvedRes = JSON.parse(approvedRaw);
  assert.strictEqual(approvedRes.phase, 'execute', 'Phase must advance to execute after human approval');
  console.log('  ✓ Reached Gate 1 (Plan Approval) checkpoint and approved interactively');

  // E. Direct MCP argument enforcement & bypass rejection
  // Queue an advisor steer for anbu and confirm direct MCP agent runner injects it automatically
  const { enqueueAdvisorSteer } = require('../src/workflow/kage-reviewer/advisor_monitor');
  enqueueAdvisorSteer({
    taskDir: sanninRes.task_dir,
    client,
    targetAgent: 'anbu',
    violations: [{ type: 'todo_drift', detail: 'stay on auth controller' }],
    directive: `[ADVISOR STEER] Stay aligned on auth controller for ${client}`
  });

  // Direct MCP call succeeds
  const directMcpRaw = runMcpAgent('anbu', {
    task: 'Add audit log interceptor to auth controller',
    context: 'src/auth/controller.js',
    constraints: 'zero downtime',
    taskId: sanninRes.task_id,
    projectPath: clientProj,
    sessionId: testSession,
    taskDir: sanninRes.task_dir
  });
  const directMcpRes = JSON.parse(directMcpRaw);
  if (client === 'pi') {
    // Pi has no native subagent tool without the pi-subagents extension, so the
    // runner must refuse to hand back a spawn it cannot perform.
    assert.strictEqual(directMcpRes.status, 'unsupported_native_spawn');
    assert.strictEqual(directMcpRes.agent, 'anbu');
  } else {
    assert.strictEqual(directMcpRes.status, 'ready');
    assert.strictEqual(directMcpRes.agent, 'anbu');
    assert.strictEqual(directMcpRes.phase, 'execution');
    assert.ok(Array.isArray(directMcpRes.advisor_steers_delivered) && directMcpRes.advisor_steers_delivered.length === 1, `runMcpAgent must deliver pending advisor steer for ${client}`);
    assert.ok(directMcpRes.instructions.includes('[ADVISOR STEER DIRECTIVE'), `Instructions must carry injected [ADVISOR STEER DIRECTIVE for ${client}`);
  }

  // Retired file IPC rejection
  const bypassEmptyRaw = runMcpAgent('anbu', {});
  const bypassEmpty = JSON.parse(bypassEmptyRaw);
  assert.strictEqual(bypassEmpty.status, 'error');
  assert.strictEqual(bypassEmpty.reason, 'retired_file_ipc');
  assert.match(bypassEmpty.error, /retired and rejected/);

  const bypassPromptMdRaw = runMcpAgent('anbu', { task: 'read prompt.md and proceed' });
  const bypassPromptMd = JSON.parse(bypassPromptMdRaw);
  assert.strictEqual(bypassPromptMd.status, 'error');
  assert.strictEqual(bypassPromptMd.reason, 'retired_file_ipc');

  const bypassDelegateMdRaw = runMcpAgent('anbu', { task: 'load delegate.md constraints' });
  const bypassDelegateMd = JSON.parse(bypassDelegateMdRaw);
  assert.strictEqual(bypassDelegateMd.status, 'error');
  assert.strictEqual(bypassDelegateMd.reason, 'retired_file_ipc');
  console.log('  ✓ Direct structured MCP arguments enforced; retired file-based IPC rejected');
}

// Cleanup isolated test fixture
try {
  fs.rmSync(QA_ROOT, { recursive: true, force: true });
} catch (_) {}

console.log('\n✔ All 8 client configurations verified in isolated fixture cleanly.');
