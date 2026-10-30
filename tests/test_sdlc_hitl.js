#!/usr/bin/env node
'use strict';

/**
 * tests/test_sdlc_hitl.js
 * Unit and integration tests for Configurable Two-Stage HITL Mode (Workstream B).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sdlc_hitl_'));
const dbPath = path.join(tmpDir, 'test.db');
process.env.KONOHA_DB_PATH = dbPath;

const db = require('../src/db');
db.DB_PATH = dbPath;
const initConn = db.getConnection(dbPath);
db.setupSchema(initConn);
initConn.close();

const sdlc = require('../src/workflow/kage-reviewer/sdlc_manager');

console.log('Running test_sdlc_hitl tests...');

try {
  // 1. Default hitl_mode is enabled
  const config1 = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(config1.hitl_mode, 'enabled', 'Default hitl_mode must be "enabled"');
  console.log('  ✓ Default hitl_mode verified as "enabled".');

  // 2. Set hitl_mode to disabled (autonomous)
  const updated1 = sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'disabled' }, dbPath);
  assert.strictEqual(updated1.hitl_mode, 'disabled', 'hitl_mode should be updated to "disabled"');
  const readBack1 = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(readBack1.hitl_mode, 'disabled');
  console.log('  ✓ setProjectSdlcConfig successfully set hitl_mode to "disabled".');

  // 3. Set hitl_mode back to enabled
  const updated2 = sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, dbPath);
  assert.strictEqual(updated2.hitl_mode, 'enabled');
  console.log('  ✓ setProjectSdlcConfig successfully restored hitl_mode to "enabled".');

  // 4. CLI command: konoha project set hitl-mode disabled
  const cliRes = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'bin', 'cli.js'),
    'project', 'set', 'hitl-mode', 'disabled', tmpDir
  ], {
    env: { ...process.env, KONOHA_DB_PATH: dbPath },
    encoding: 'utf8'
  });
  assert.strictEqual(cliRes.status, 0, `CLI project set failed: ${cliRes.stderr}`);
  const cliReadBack = sdlc.getProjectSdlcConfig(tmpDir, dbPath);
  assert.strictEqual(cliReadBack.hitl_mode, 'disabled');
  console.log('  ✓ CLI command "konoha project set hitl-mode disabled" updated database.');

  // Restore hitl_mode to enabled for workflow gate testing
  sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, dbPath);
  const { runMcpWorkflow, saveWorkflowStatus } = require('../src/mcp/workflow');

  // 5. Workflow Gate 1 (Plan Approval) blocking in enabled mode
  console.log('  Testing Workflow Gate 1 (Plan Approval)...');
  const taskDirGate1 = path.join(tmpDir, 'task_gate1');
  fs.mkdirSync(taskDirGate1, { recursive: true });
  fs.writeFileSync(path.join(taskDirGate1, 'plan.md'), '# Implementation Plan\n- [anbu]: Build backend auth API\n- [jonin]: Build frontend auth form\n', 'utf8');
  const statusGate1 = {
    task_id: 'task_gate1',
    phase: 'plan',
    prompt: 'Implement auth system',
    project_path: tmpDir,
    current_dispatch: {
      id: 'disp-plan-1',
      phase: 'plan',
      agent: 'kage'
    },
    completed_dispatches: ['disp-plan-1'],
    dispatch_results: { 'disp-plan-1': 'Plan generated' }
  };
  saveWorkflowStatus(taskDirGate1, statusGate1);
  sdlc.createTask({ id: 'task_gate1', description: 'Implement auth system', status: 'in_progress', project_path: tmpDir });

  // Run workflow -> should pause at Gate 1
  const gate1Res = JSON.parse(runMcpWorkflow(taskDirGate1));
  assert.strictEqual(gate1Res.status, 'pending_plan_approval', 'Must return pending_plan_approval when hitl_mode is enabled');
  assert.strictEqual(gate1Res.phase, 'plan_approval');
  assert.strictEqual(gate1Res.hitl_gate, 'Gate 1 (Plan Approval)');
  assert.ok(gate1Res.interactive_prompt, 'Gate 1 must return structured interactive_prompt');
  assert.strictEqual(gate1Res.interactive_prompt.gate, 'gate_1');
  assert.deepStrictEqual(gate1Res.interactive_prompt.choices, [
    '1. Compact and approve',
    '2. Reject and Regenerate PLAN',
    'Input Refine PLAN'
  ]);
  assert.ok(gate1Res.message.includes('1. Compact and approve'));
  assert.ok(gate1Res.message.includes('2. Reject and Regenerate PLAN'));

  // Verify task in DB updated to pending_plan_approval
  const dbTaskGate1 = sdlc.getTask('task_gate1');
  assert.strictEqual(dbTaskGate1.status, 'pending_plan_approval', 'DB task status must be pending_plan_approval');

  // Verify re-running without approval stays paused
  const gate1PauseRes = JSON.parse(runMcpWorkflow(taskDirGate1));
  assert.strictEqual(gate1PauseRes.status, 'pending_plan_approval');

  // Test interactive choice 2: Reject & Regenerate PLAN with refinement
  const gate1RegenRes = JSON.parse(runMcpWorkflow(taskDirGate1, { choice: '2. Reject and Regenerate PLAN', refinement: 'Add rate limiting' }));
  assert.strictEqual(gate1RegenRes.phase, 'plan', 'Choice 2 must re-trigger plan phase with Kage');
  assert.strictEqual(gate1RegenRes.agent, 'kage');

  // Simulate Kage compiling refined plan and re-pausing at Gate 1
  fs.writeFileSync(path.join(taskDirGate1, 'plan.md'), '# Refined Plan\n- [anbu]: Build auth API with rate limiting\n', 'utf8');
  { const stx = JSON.parse(fs.readFileSync(path.join(taskDirGate1, 'status.json'), 'utf8')); const { reportFromAgent } = require('../src/mcp/memory_project_context'); reportFromAgent('kage', 'Refined action plan written', 'completed', null, null, null, null, taskDirGate1, stx.current_dispatch.id, ['plan refined, exit 0']); }
  const gate1RePrompt = JSON.parse(runMcpWorkflow(taskDirGate1));
  assert.strictEqual(gate1RePrompt.status, 'pending_plan_approval');

  // Human approves plan interactively via choice 1: Compact and approve
  const gate1ApprovedRes = JSON.parse(runMcpWorkflow(taskDirGate1, { choice: '1. Compact and approve' }));
  assert.strictEqual(gate1ApprovedRes.status, 'ready');
  assert.strictEqual(gate1ApprovedRes.phase, 'execute');
  assert.strictEqual(gate1ApprovedRes.agent, 'anbu');
  console.log('  ✓ Workflow Gate 1 (Plan Approval) interactive choices (approve, regenerate/refine) verified successfully.');

  // 6. Workflow Gate 2 (Delivery Sign-Off) blocking in enabled mode
  console.log('  Testing Workflow Gate 2 (Delivery Sign-Off)...');
  const taskDirGate2 = path.join(tmpDir, 'task_gate2');
  fs.mkdirSync(taskDirGate2, { recursive: true });
  fs.writeFileSync(path.join(taskDirGate2, 'kage_review.json'), JSON.stringify({
    status: 'approved',
    approved: true,
    confidence: 100,
    ai_slop_clean: true,
    ai_slop_findings: 0,
    security_reviewed: true,
    rollback_reviewed: true,
    rollback_plan: 'git revert',
    verified_task_ids: ['task-1'],
    validation: ['npm test exit 0']
  }), 'utf8');
  const statusGate2 = {
    task_id: 'task_gate2',
    phase: 'review',
    prompt: 'Implement auth system',
    project_path: tmpDir,
    tasks: [{ id: 'task-1', agent: 'anbu', task: 'Build auth', status: 'completed', validation: ['npm test exit 0'] }],
    completed_executors: ['task-1'],
    current_dispatch: { id: 'disp-rev-1', phase: 'review', agent: 'kage' },
    completed_dispatches: ['disp-rev-1'],
    dispatch_results: { 'disp-rev-1': 'Review approved' },
    review: {
      status: 'approved',
      approved: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      security_reviewed: true,
      rollback_reviewed: true,
      rollback_plan: 'git revert',
      verified_task_ids: ['task-1'],
      validation: ['npm test exit 0']
    }
  };
  saveWorkflowStatus(taskDirGate2, statusGate2);
  sdlc.createTask({ id: 'task_gate2', description: 'Implement auth system', status: 'in_progress', project_path: tmpDir });

  // Run workflow -> should pause at Gate 2
  const gate2Res = JSON.parse(runMcpWorkflow(taskDirGate2));
  assert.strictEqual(gate2Res.status, 'pending_human_signoff', 'Must return pending_human_signoff when hitl_mode is enabled');
  assert.strictEqual(gate2Res.phase, 'delivery_signoff');
  assert.strictEqual(gate2Res.hitl_gate, 'Gate 2 (Delivery Sign-Off)');
  assert.ok(gate2Res.interactive_prompt, 'Gate 2 must return structured interactive_prompt');
  assert.strictEqual(gate2Res.interactive_prompt.gate, 'gate_2');
  assert.deepStrictEqual(gate2Res.interactive_prompt.choices, [
    '1. Compact and approve',
    '2. Remediation'
  ]);
  assert.ok(gate2Res.message.includes('1. Compact and approve'));
  assert.ok(gate2Res.message.includes('2. Remediation'));

  // Verify task in DB updated to pending_human_signoff
  const dbTaskGate2 = sdlc.getTask('task_gate2');
  assert.strictEqual(dbTaskGate2.status, 'pending_human_signoff', 'DB task status must be pending_human_signoff');

  // Verify re-running without sign-off stays paused
  const gate2PauseRes = JSON.parse(runMcpWorkflow(taskDirGate2));
  assert.strictEqual(gate2PauseRes.status, 'pending_human_signoff');

  // Human signs off interactively via choice 1: Compact and approve
  const gate2SignedRes = JSON.parse(runMcpWorkflow(taskDirGate2, { choice: '1. Compact and approve' }));
  assert.strictEqual(gate2SignedRes.status, 'completed');
  assert.strictEqual(gate2SignedRes.phase, 'done');
  console.log('  ✓ Workflow Gate 2 (Delivery Sign-Off) interactive choices verified successfully.');

  // 7. Authoritative Gate Enforcement under Autonomous / YOLO Mode (hitl_mode: disabled)
  console.log('  Testing Authoritative Gate Enforcement under Autonomous / YOLO Mode (hitl_mode: disabled)...');
  sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'disabled' }, dbPath);

  // 7a. Autonomous Gate 1: cannot bypass without explicit human approval
  const taskDirAuto1 = path.join(tmpDir, 'task_auto1');
  fs.mkdirSync(taskDirAuto1, { recursive: true });
  fs.writeFileSync(path.join(taskDirAuto1, 'plan.md'), '# Implementation Plan\n- [anbu]: Build backend\n', 'utf8');
  const statusAuto1 = {
    task_id: 'task_auto1',
    phase: 'plan',
    prompt: 'Auto task',
    project_path: tmpDir,
    current_dispatch: { id: 'disp-auto-1', phase: 'plan', agent: 'kage' },
    completed_dispatches: ['disp-auto-1'],
    dispatch_results: { 'disp-auto-1': 'Plan generated' }
  };
  saveWorkflowStatus(taskDirAuto1, statusAuto1);
  sdlc.createTask({ id: 'task_auto1', description: 'Auto task', status: 'in_progress', project_path: tmpDir });

  // Autonomous mode must NOT bypass Gate 1
  const auto1Res = JSON.parse(runMcpWorkflow(taskDirAuto1));
  assert.strictEqual(auto1Res.status, 'pending_plan_approval', 'Autonomous/YOLO mode must NOT bypass Gate 1; explicit approval is mandatory');
  assert.strictEqual(auto1Res.phase, 'plan_approval');
  assert.strictEqual(auto1Res.hitl_gate, 'Gate 1 (Plan Approval)');

  // Verify re-running without approval stays strictly paused
  const auto1PauseRes = JSON.parse(runMcpWorkflow(taskDirAuto1));
  assert.strictEqual(auto1PauseRes.status, 'pending_plan_approval', 'Re-running without approval must stay paused at Gate 1');

  // Test YOLO Gate 1 rejection with refinement loops back to Kage plan
  const auto1RejectRes = JSON.parse(runMcpWorkflow(taskDirAuto1, { choice: '2. Reject and Regenerate PLAN', refinement: 'Add schema validation' }));
  assert.strictEqual(auto1RejectRes.phase, 'plan', 'Gate 1 rejection must loop back to plan phase with Kage');
  assert.strictEqual(auto1RejectRes.agent, 'kage');

  // Simulate Kage compiling updated plan
  fs.writeFileSync(path.join(taskDirAuto1, 'plan.md'), '# Refined Auto Plan\n- [anbu]: Build backend with validation\n', 'utf8');
  { const stx = JSON.parse(fs.readFileSync(path.join(taskDirAuto1, 'status.json'), 'utf8')); const { reportFromAgent } = require('../src/mcp/memory_project_context'); reportFromAgent('kage', 'Refined action plan written', 'completed', null, null, null, null, taskDirAuto1, stx.current_dispatch.id, ['plan refined, exit 0']); }
  const auto1RePrompt = JSON.parse(runMcpWorkflow(taskDirAuto1));
  assert.strictEqual(auto1RePrompt.status, 'pending_plan_approval', 'Must re-pause at Gate 1 after plan regeneration');

  // Explicit approval advances to execute under autonomous mode
  const auto1ApprovedRes = JSON.parse(runMcpWorkflow(taskDirAuto1, { choice: '1. Compact and approve' }));
  assert.strictEqual(auto1ApprovedRes.status, 'ready');
  assert.strictEqual(auto1ApprovedRes.phase, 'execute');
  console.log('  ✓ Autonomous/YOLO mode strictly paused at Gate 1; rejection looped and approval advanced cleanly.');

  // 7b. Autonomous Gate 2: cannot bypass without explicit human sign-off
  const taskDirAuto2 = path.join(tmpDir, 'task_auto2');
  fs.mkdirSync(taskDirAuto2, { recursive: true });
  fs.writeFileSync(path.join(taskDirAuto2, 'kage_review.json'), JSON.stringify({
    status: 'approved',
    approved: true,
    confidence: 100,
    ai_slop_clean: true,
    ai_slop_findings: 0,
    security_reviewed: true,
    rollback_reviewed: true,
    rollback_plan: 'git revert',
    verified_task_ids: ['task-auto-2'],
    validation: ['exit 0']
  }), 'utf8');
  const statusAuto2 = {
    task_id: 'task_auto2',
    phase: 'review',
    prompt: 'Auto task 2',
    project_path: tmpDir,
    tasks: [{ id: 'task-auto-2', agent: 'anbu', task: 'Build backend', status: 'completed', validation: ['exit 0'] }],
    completed_executors: ['task-auto-2'],
    current_dispatch: { id: 'disp-auto-2', phase: 'review', agent: 'kage' },
    completed_dispatches: ['disp-auto-2'],
    dispatch_results: { 'disp-auto-2': 'Review approved' },
    review: {
      status: 'approved',
      approved: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      security_reviewed: true,
      rollback_reviewed: true,
      rollback_plan: 'git revert',
      verified_task_ids: ['task-auto-2'],
      validation: ['exit 0']
    }
  };
  saveWorkflowStatus(taskDirAuto2, statusAuto2);
  sdlc.createTask({ id: 'task_auto2', description: 'Auto task 2', status: 'in_progress', project_path: tmpDir });

  // Autonomous mode must NOT bypass Gate 2
  const auto2Res = JSON.parse(runMcpWorkflow(taskDirAuto2));
  assert.strictEqual(auto2Res.status, 'pending_human_signoff', 'Autonomous/YOLO mode must NOT bypass Gate 2; explicit sign-off is mandatory');
  assert.strictEqual(auto2Res.phase, 'delivery_signoff');
  assert.strictEqual(auto2Res.hitl_gate, 'Gate 2 (Delivery Sign-Off)');

  // Verify re-running without sign-off stays strictly paused
  const auto2PauseRes = JSON.parse(runMcpWorkflow(taskDirAuto2));
  assert.strictEqual(auto2PauseRes.status, 'pending_human_signoff', 'Re-running without sign-off must stay paused at Gate 2');

  // Test YOLO Gate 2 rejection/remediation loops back to remediation
  const auto2RemediateRes = JSON.parse(runMcpWorkflow(taskDirAuto2, { choice: '2. Remediation' }));
  assert.strictEqual(auto2RemediateRes.status, 'ready');
  assert.strictEqual(auto2RemediateRes.phase, 'execute', 'Gate 2 remediation choice must loop back to execute');
  const dbTaskAuto2 = sdlc.getTask('task_auto2');
  assert.strictEqual(dbTaskAuto2.status, 'remediating', 'DB task status must transition to remediating');

  // Complete remediation and pass review again
  const statusAuto2Rem = {
    ...statusAuto2,
    phase: 'review',
    current_dispatch: { id: 'disp-auto-2b', phase: 'review', agent: 'kage' },
    completed_dispatches: ['disp-auto-2', 'disp-auto-2b'],
    dispatch_results: { 'disp-auto-2b': 'Review approved after remediation' }
  };
  saveWorkflowStatus(taskDirAuto2, statusAuto2Rem);
  const auto2RePrompt = JSON.parse(runMcpWorkflow(taskDirAuto2));
  assert.strictEqual(auto2RePrompt.status, 'pending_human_signoff', 'Must re-pause at Gate 2 awaiting sign-off after remediation');

  // Explicit delivery sign-off advances to done
  const auto2SignedRes = JSON.parse(runMcpWorkflow(taskDirAuto2, { choice: '1. Compact and approve' }));
  assert.strictEqual(auto2SignedRes.status, 'completed');
  assert.strictEqual(auto2SignedRes.phase, 'done');
  console.log('  ✓ Autonomous/YOLO mode strictly paused at Gate 2; remediation looped and sign-off completed cleanly.');

  // 8. Regression: Prompts with keywords ('continue', 'confirm', 'proceed', 'done', 'deliver', 'sign-off')
  // must NEVER self-bypass Gate 1 or Gate 2 when hitl_mode is enabled.
  console.log('  Testing Regression: Keyword-bearing prompts do not self-bypass gates...');
  sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, dbPath);

  // 8a. Gate 1 with prompt: "continue the refactor and confirm the pipeline, please proceed"
  const taskDirKwGate1 = path.join(tmpDir, 'task_kw_gate1');
  fs.mkdirSync(taskDirKwGate1, { recursive: true });
  fs.writeFileSync(path.join(taskDirKwGate1, 'plan.md'), '# Plan\n- [anbu]: continue refactoring\n', 'utf8');
  const statusKwGate1 = {
    task_id: 'task_kw_gate1',
    phase: 'plan',
    prompt: 'continue the refactor and confirm the pipeline, please proceed with yes/ok',
    project_path: tmpDir,
    current_dispatch: { id: 'disp-kw-1', phase: 'plan', agent: 'kage' },
    completed_dispatches: ['disp-kw-1'],
    dispatch_results: { 'disp-kw-1': 'Plan generated' }
  };
  saveWorkflowStatus(taskDirKwGate1, statusKwGate1);
  sdlc.createTask({ id: 'task_kw_gate1', description: statusKwGate1.prompt, status: 'in_progress', project_path: tmpDir });

  const kwGate1Res = JSON.parse(runMcpWorkflow(taskDirKwGate1));
  assert.strictEqual(kwGate1Res.status, 'pending_plan_approval', 'Keyword-bearing prompt must NOT self-bypass Gate 1');
  assert.strictEqual(kwGate1Res.phase, 'plan_approval');

  // Verify re-calling stays paused
  const kwGate1PauseRes = JSON.parse(runMcpWorkflow(taskDirKwGate1));
  assert.strictEqual(kwGate1PauseRes.status, 'pending_plan_approval');
  console.log('  ✓ Gate 1 with "continue/confirm/proceed/yes" keywords strictly paused awaiting approval.');

  // 8b. Gate 2 with prompt: "when done deliver the build, sign-off and approve"
  const taskDirKwGate2 = path.join(tmpDir, 'task_kw_gate2');
  fs.mkdirSync(taskDirKwGate2, { recursive: true });
  fs.writeFileSync(path.join(taskDirKwGate2, 'kage_review.json'), JSON.stringify({
    status: 'approved',
    approved: true,
    confidence: 100,
    ai_slop_clean: true,
    ai_slop_findings: 0,
    security_reviewed: true,
    rollback_reviewed: true,
    rollback_plan: 'git revert',
    verified_task_ids: ['task-kw-2'],
    validation: ['exit 0']
  }), 'utf8');
  const statusKwGate2 = {
    task_id: 'task_kw_gate2',
    phase: 'review',
    prompt: 'when done deliver the build, sign-off and approve all accepted changes',
    project_path: tmpDir,
    tasks: [{ id: 'task-kw-2', agent: 'anbu', task: 'Build', status: 'completed', validation: ['exit 0'] }],
    completed_executors: ['task-kw-2'],
    current_dispatch: { id: 'disp-kw-2', phase: 'review', agent: 'kage' },
    completed_dispatches: ['disp-kw-2'],
    dispatch_results: { 'disp-kw-2': 'Review approved' },
    review: {
      status: 'approved',
      approved: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      security_reviewed: true,
      rollback_reviewed: true,
      rollback_plan: 'git revert',
      verified_task_ids: ['task-kw-2'],
      validation: ['exit 0']
    }
  };
  saveWorkflowStatus(taskDirKwGate2, statusKwGate2);
  sdlc.createTask({ id: 'task_kw_gate2', description: statusKwGate2.prompt, status: 'in_progress', project_path: tmpDir });

  const kwGate2Res = JSON.parse(runMcpWorkflow(taskDirKwGate2));
  assert.strictEqual(kwGate2Res.status, 'pending_human_signoff', 'Keyword-bearing prompt must NOT self-bypass Gate 2');
  assert.strictEqual(kwGate2Res.phase, 'delivery_signoff');

  // Verify re-calling stays paused
  const kwGate2PauseRes = JSON.parse(runMcpWorkflow(taskDirKwGate2));
  assert.strictEqual(kwGate2PauseRes.status, 'pending_human_signoff');
  console.log('  ✓ Gate 2 with "done/deliver/sign-off/approve" keywords strictly paused awaiting sign-off.');

  // 9. Fast-Track Direct Request (Point 1.3: Dual-Track Execution Engine)
  console.log('  Testing Dual-Track Execution Engine (Fast-Track vs Full SDLC)...');
  const { classifyExecutionTrack, routeByKeywordsWithPrompt } = require('../src/mcp/workflow');

  // 9a. Slash commands and targeted fixes classified as fast_track
  assert.strictEqual(classifyExecutionTrack('/anbu fix the auth endpoint'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/jonin build user card'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/genin inspect routes'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/chunin search docs for drizzle'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/kage audit security'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/tokubetsu-jonin write release notes'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('/sannin triage the issue'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('single-file typo fix in server.js'), 'fast_track');
  assert.strictEqual(classifyExecutionTrack('quick question about sqlite'), 'fast_track');

  // Greenfield and multi-subsystem tasks classified as full_sdlc
  assert.strictEqual(classifyExecutionTrack('Build fullstack e-commerce marketplace from scratch'), 'full_sdlc');
  assert.strictEqual(classifyExecutionTrack('Architect and implement microservices pipeline'), 'full_sdlc');

  // Regression: Mixed prompts containing both full_sdlc signals and fast_track words (e.g. explain, quick fix)
  // MUST prioritize full_sdlc so greenfield tasks are never misclassified as fast_track
  assert.strictEqual(classifyExecutionTrack('build a fullstack marketplace from scratch, and explain the architecture'), 'full_sdlc');
  assert.strictEqual(classifyExecutionTrack('architect and refactor the auth subsystem with a quick fix for legacy tokens'), 'full_sdlc');
  assert.strictEqual(classifyExecutionTrack('greenfield e-commerce app with single-file component scaffolds'), 'full_sdlc');
  assert.strictEqual(classifyExecutionTrack('pure quick question: explain how sessionTurn works'), 'fast_track');

  // 9b. Slash commands route directly to target subagent
  assert.strictEqual(routeByKeywordsWithPrompt(null, '/anbu check logs and telemetry'), 'anbu');
  assert.strictEqual(routeByKeywordsWithPrompt(null, '/jonin build navigation bar'), 'jonin');
  assert.strictEqual(routeByKeywordsWithPrompt(null, '/tokubetsu-jonin generate docx report'), 'tokubetsu_jonin');

  // 9c. Fast-track tasks require explicit Gate 1 plan approval if a plan is compiled
  sdlc.setProjectSdlcConfig(tmpDir, { hitl_mode: 'enabled' }, dbPath);
  const taskDirFast = path.join(tmpDir, 'task_fast_track');
  fs.mkdirSync(taskDirFast, { recursive: true });
  fs.writeFileSync(path.join(taskDirFast, 'plan.md'), '# Plan\n- [ ] Fix typo in line 42', 'utf8');

  const statusFast = {
    task_id: 'task_fast_track',
    phase: 'plan',
    prompt: '/anbu fix typo in config.js',
    execution_track: 'fast_track',
    project_path: tmpDir,
    current_dispatch: { id: 'disp-fast-1', phase: 'plan', agent: 'kage' },
    completed_dispatches: ['disp-fast-1'],
    dispatch_results: { 'disp-fast-1': '# Plan\n- [ ] Fix typo in line 42' }
  };
  saveWorkflowStatus(taskDirFast, statusFast);
  sdlc.createTask({ id: 'task_fast_track', description: statusFast.prompt, status: 'in_progress', project_path: tmpDir });

  const fastTrackRes = JSON.parse(runMcpWorkflow(taskDirFast));
  assert.strictEqual(fastTrackRes.status, 'pending_plan_approval', 'Fast-track tasks must pause at Gate 1 awaiting explicit plan approval');
  assert.strictEqual(fastTrackRes.phase, 'plan_approval');

  // Explicit approval transitions fast-track task to execution
  const fastTrackApproved = JSON.parse(runMcpWorkflow(taskDirFast, { choice: '1. Compact and approve' }));
  assert.strictEqual(fastTrackApproved.status, 'ready');
  assert.strictEqual(fastTrackApproved.phase, 'execute');
  console.log('  ✓ Fast-Track tasks strictly pause at Gate 1 and advance only upon explicit approval.');

  // 10. Unavailable Approval Transport Fails Closed
  console.log('  Testing Unavailable Approval Transport Fails Closed...');

  // 10a. Gate 1 fails closed when transport is unavailable / fails
  const taskDirFailClose1 = path.join(tmpDir, 'task_fail_close_1');
  fs.mkdirSync(taskDirFailClose1, { recursive: true });
  fs.writeFileSync(path.join(taskDirFailClose1, 'plan.md'), '# Plan\n- [anbu]: Deploy service\n', 'utf8');
  const statusFc1 = {
    task_id: 'task_fail_close_1',
    phase: 'plan',
    prompt: 'Deploy service with disabled notifications',
    project_path: tmpDir,
    current_dispatch: { id: 'disp-fc-1', phase: 'plan', agent: 'kage' },
    completed_dispatches: ['disp-fc-1'],
    dispatch_results: { 'disp-fc-1': 'Plan generated' }
  };
  saveWorkflowStatus(taskDirFailClose1, statusFc1);
  sdlc.createTask({ id: 'task_fail_close_1', description: statusFc1.prompt, status: 'in_progress', project_path: tmpDir });

  const notifier = require('../src/telegram/notifier');
  const origSendInteractive = notifier.sendInteractiveApproval;
  try {
    // Simulate failing/unavailable transport throwing an error
    notifier.sendInteractiveApproval = () => {
      throw new Error('Telegram bot service connection refused (offline)');
    };

    const fc1Res = JSON.parse(runMcpWorkflow(taskDirFailClose1));
    assert.strictEqual(fc1Res.status, 'pending_plan_approval', 'Gate 1 must fail closed and pause awaiting approval even if transport errors');
    assert.strictEqual(fc1Res.phase, 'plan_approval');
    const dbTaskFc1 = sdlc.getTask('task_fail_close_1');
    assert.strictEqual(dbTaskFc1.status, 'pending_plan_approval', 'DB task must remain in pending_plan_approval');

    // Re-running without explicit verdict stays paused
    const fc1Pause = JSON.parse(runMcpWorkflow(taskDirFailClose1));
    assert.strictEqual(fc1Pause.status, 'pending_plan_approval');

    // Explicit approval via direct choice still unlocks the workflow
    const fc1Unlock = JSON.parse(runMcpWorkflow(taskDirFailClose1, { choice: '1. Compact and approve' }));
    assert.strictEqual(fc1Unlock.status, 'ready');
    assert.strictEqual(fc1Unlock.phase, 'execute');
    console.log('  ✓ Gate 1 fails closed when transport throws error; remains paused until explicit verdict.');

    // 10b. Gate 2 fails closed when transport is unavailable / fails
    const taskDirFailClose2 = path.join(tmpDir, 'task_fail_close_2');
    fs.mkdirSync(taskDirFailClose2, { recursive: true });
    fs.writeFileSync(path.join(taskDirFailClose2, 'kage_review.json'), JSON.stringify({
      status: 'approved',
      approved: true,
      confidence: 100,
      ai_slop_clean: true,
      ai_slop_findings: 0,
      security_reviewed: true,
      rollback_reviewed: true,
      rollback_plan: 'git revert',
      verified_task_ids: ['task-fc-2'],
      validation: ['exit 0']
    }), 'utf8');
    const statusFc2 = {
      task_id: 'task_fail_close_2',
      phase: 'review',
      prompt: 'Deploy service with disabled notifications 2',
      project_path: tmpDir,
      tasks: [{ id: 'task-fc-2', agent: 'anbu', task: 'Deploy', status: 'completed', validation: ['exit 0'] }],
      completed_executors: ['task-fc-2'],
      current_dispatch: { id: 'disp-fc-2', phase: 'review', agent: 'kage' },
      completed_dispatches: ['disp-fc-2'],
      dispatch_results: { 'disp-fc-2': 'Review approved' },
      review: {
        status: 'approved',
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        security_reviewed: true,
        rollback_reviewed: true,
        rollback_plan: 'git revert',
        verified_task_ids: ['task-fc-2'],
        validation: ['exit 0']
      }
    };
    saveWorkflowStatus(taskDirFailClose2, statusFc2);
    sdlc.createTask({ id: 'task_fail_close_2', description: statusFc2.prompt, status: 'in_progress', project_path: tmpDir });

    const fc2Res = JSON.parse(runMcpWorkflow(taskDirFailClose2));
    assert.strictEqual(fc2Res.status, 'pending_human_signoff', 'Gate 2 must fail closed and pause awaiting sign-off even if transport errors');
    assert.strictEqual(fc2Res.phase, 'delivery_signoff');
    const dbTaskFc2 = sdlc.getTask('task_fail_close_2');
    assert.strictEqual(dbTaskFc2.status, 'pending_human_signoff', 'DB task must remain in pending_human_signoff');

    // Re-running without explicit sign-off stays paused
    const fc2Pause = JSON.parse(runMcpWorkflow(taskDirFailClose2));
    assert.strictEqual(fc2Pause.status, 'pending_human_signoff');

    // Explicit sign-off unlocks delivery
    const fc2Unlock = JSON.parse(runMcpWorkflow(taskDirFailClose2, { choice: '1. Compact and approve' }));
    assert.strictEqual(fc2Unlock.status, 'completed');
    assert.strictEqual(fc2Unlock.phase, 'done');
    console.log('  ✓ Gate 2 fails closed when transport throws error; remains paused until explicit verdict.');
  } finally {
    notifier.sendInteractiveApproval = origSendInteractive;
  }

} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\nAll test_sdlc_hitl tests passed cleanly!');
