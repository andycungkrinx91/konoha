#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

process.env.KONOHA_HITL_MODE = 'disabled';

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

function write(root, name, value) {
  fs.writeFileSync(path.join(root, name), value, 'utf8');
}

function seedPrompt(root, promptText) {
  write(root, 'status.json', JSON.stringify({
    schema_version: 2,
    phase: 'route',
    prompt: promptText
  }, null, 2));
}

function advanceToPlan(root) {
  seedPrompt(root, 'Implement a small backend fix');
  const first = JSON.parse(server.runMcpWorkflow(root));
  assert.strictEqual(first.phase, 'explore');
  write(root, 'findings.md', 'The backend fix is isolated.');
  { const st = JSON.parse(server.runMcpWorkflow(root)); server.reportFromAgent('genin', 'Exploration complete', 'completed', null, null, null, null, root, st.dispatch_id, ['explore traced 3 files, exit 0']); }
  const second = JSON.parse(server.runMcpWorkflow(root));
  assert.strictEqual(second.phase, 'plan');
  return second;
}

async function run() {
  console.log('Running test_workflow_gates tests...');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  const prevRoot = server.WORKSPACE_ROOT;
  server.WORKSPACE_ROOT = root;

  try {
    // 1. Stale result does not complete new dispatch
    seedPrompt(root, 'Implement a fix');
    const first = JSON.parse(server.runMcpWorkflow(root));
    assert.strictEqual(first.phase, 'explore');
    const before = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
    const second = JSON.parse(server.runMcpWorkflow(root));
    assert.strictEqual(second.phase, 'explore');
    const after = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
    assert.strictEqual(before.current_dispatch.id, after.current_dispatch.id);
    assert.deepStrictEqual(after.completed_dispatches, []);
    console.log('✓ Stale result does not complete new dispatch passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 2. Duplicate agent tasks remain unique
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root2;
  try {
    advanceToPlan(root2);
    write(root2, 'plan.md', '- [anbu]: Fix the API\n- [anbu]: Add the regression test\n');
    { const st = JSON.parse(server.runMcpWorkflow(root2)); server.reportFromAgent('kage', 'Plan approved', 'completed', null, null, null, null, root2, st.dispatch_id, ['plan reviewed, exit 0']); }
    const planGate = JSON.parse(server.runMcpWorkflow(root2));
    assert.strictEqual(planGate.phase, 'plan_approval');
    const execute = JSON.parse(server.runMcpWorkflow(root2, { choice: '1. Compact and approve' }));
    assert.strictEqual(execute.phase, 'execute');
    const status = JSON.parse(fs.readFileSync(path.join(root2, 'status.json'), 'utf8'));
    assert.deepStrictEqual(status.tasks.map(t => t.id), ['task-1', 'task-2']);
    assert.deepStrictEqual(status.tasks.map(t => t.task), ['Fix the API', 'Add the regression test']);
    console.log('✓ Duplicate agent tasks remain unique passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root2, { recursive: true, force: true });
  }

  // 3. Kage review blocks then approves delivery
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root3;
  try {
    advanceToPlan(root3);
    write(root3, 'plan.md', '- [anbu]: Fix the API\n');
    { const st = JSON.parse(server.runMcpWorkflow(root3)); server.reportFromAgent('kage', 'Plan approved', 'completed', null, null, null, null, root3, st.dispatch_id, ['plan reviewed, exit 0']); }
    server.runMcpWorkflow(root3);
    const execute = JSON.parse(server.runMcpWorkflow(root3, { choice: '1. Compact and approve' }));
    assert.strictEqual(execute.agent, 'anbu');
    { const stx = JSON.parse(fs.readFileSync(require('path').join(root3, 'status.json'), 'utf8')); server.reportFromAgent('anbu', 'API fixed', 'completed', null, null, null, null, root3, stx.current_dispatch.id, ['npm run build exited 0']); }
    const document = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(document.phase, 'document');
    { const stx = JSON.parse(fs.readFileSync(require('path').join(root3, 'status.json'), 'utf8')); server.reportFromAgent('tokubetsu-jonin', 'Docs complete', 'completed', null, null, null, null, root3, stx.current_dispatch.id, ['docs written, exit 0']); }
    const review = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(review.phase, 'review');
    { const stx = JSON.parse(fs.readFileSync(require('path').join(root3, 'status.json'), 'utf8')); server.reportFromAgent('kage', 'Review done', 'completed', null, null, null, null, root3, stx.current_dispatch.id, ['review executed, exit 0']); }
    const blocked = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(blocked.status, 'blocked');
    write(root3, 'kage_review.json', JSON.stringify({
      approved: true,
      verified_task_ids: ['task-1'],
      validation: ['all configured checks passed'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      confidence: 100,
      findings: []
    }));
    write(root3, 'result.md', 'Kage approved all work.');
    const gate2Res = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(gate2Res.phase, 'delivery_signoff');
    const approved = JSON.parse(server.runMcpWorkflow(root3, { choice: '1. Compact and approve' }));
    assert.strictEqual(approved.phase, 'done');
    assert.ok(fs.existsSync(path.join(root3, 'final_report.md')));
    const delivered = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(delivered.phase, 'done');
    console.log('✓ Kage review blocks then approves delivery passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root3, { recursive: true, force: true });
  }

  // 4. Structured report completes active task
  const root4 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root4;
  try {
    advanceToPlan(root4);
    write(root4, 'plan.md', '- [anbu]: Fix the API\n');
    { const st = JSON.parse(server.runMcpWorkflow(root4)); server.reportFromAgent('kage', 'Plan approved', 'completed', null, null, null, null, root4, st.dispatch_id, ['plan reviewed, exit 0']); }
    server.runMcpWorkflow(root4);
    const execute = JSON.parse(server.runMcpWorkflow(root4, { choice: '1. Compact and approve' }));
    const repStr = server.reportFromAgent('anbu', 'API fixed', 'completed', null, null, null, null, root4, execute.dispatch_id, ['npm run build exited 0']);
    const report = JSON.parse(repStr);
    assert.strictEqual(report.status, 'recorded');
    assert.ok(report.verified);
    const status = JSON.parse(fs.readFileSync(path.join(root4, 'status.json'), 'utf8'));
    assert.strictEqual(status.tasks[0].status, 'completed');
    assert.ok(status.tasks[0].verified);
    const nextState = JSON.parse(server.runMcpWorkflow(root4));
    assert.strictEqual(nextState.phase, 'document');
    console.log('✓ Structured report completes active task passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root4, { recursive: true, force: true });
  }

  // 5. Unverified report blocks task completion
  const root5 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root5;
  try {
    advanceToPlan(root5);
    write(root5, 'plan.md', '- [anbu]: Fix the API\n');
    { const st = JSON.parse(server.runMcpWorkflow(root5)); server.reportFromAgent('kage', 'Plan approved', 'completed', null, null, null, null, root5, st.dispatch_id, ['plan reviewed, exit 0']); }
    server.runMcpWorkflow(root5);
    const execute = JSON.parse(server.runMcpWorkflow(root5, { choice: '1. Compact and approve' }));
    const repStr = server.reportFromAgent('anbu', 'API fixed (claimed)', 'completed', null, null, null, null, root5, execute.dispatch_id, ['pass']);
    const report = JSON.parse(repStr);
    assert.strictEqual(report.status, 'recorded');
    assert.strictEqual(report.verified, false);
    assert.strictEqual(report.task_status, 'unverified');
    assert.ok(report.remediation);
    const status = JSON.parse(fs.readFileSync(path.join(root5, 'status.json'), 'utf8'));
    assert.strictEqual(status.tasks[0].status, 'unverified');
    assert.strictEqual(status.tasks[0].verified, false);
    const nextState = JSON.parse(server.runMcpWorkflow(root5));
    assert.strictEqual(nextState.phase, 'execute');
    console.log('✓ Unverified report blocks task completion passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root5, { recursive: true, force: true });
  }

  // 6. Anbu pentest dev local workflow approval
  const root6 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root6;
  try {
    advanceToPlan(root6);
    write(root6, 'plan.md', '- [anbu]: Perform penetration testing on local dev authentication endpoint (http://127.0.0.1:3000/auth)\n');
    { const st = JSON.parse(server.runMcpWorkflow(root6)); server.reportFromAgent('kage', 'Plan approved', 'completed', null, null, null, null, root6, st.dispatch_id, ['plan reviewed, exit 0']); }
    server.runMcpWorkflow(root6);
    const execute = JSON.parse(server.runMcpWorkflow(root6, { choice: '1. Compact and approve' }));
    assert.strictEqual(execute.agent, 'anbu');
    assert.strictEqual(execute.phase, 'execute');

    const repStr = server.reportFromAgent(
      'anbu',
      'Penetration test on local dev auth endpoint completed. Identified 1 low-severity warning, no critical exploits.',
      'completed',
      null, null, null, null,
      root6,
      execute.dispatch_id,
      [
        'pentest completed on http://127.0.0.1:3000/auth',
        'simulated SQL injection: input properly escaped, target returned 400 error',
        'simulated auth bypass: failed to bypass token verification',
        '0 critical vulnerabilities, 0 unhandled exploits'
      ]
    );
    const report = JSON.parse(repStr);
    assert.strictEqual(report.status, 'recorded');
    assert.ok(report.verified);

    const document = JSON.parse(server.runMcpWorkflow(root6));
    assert.strictEqual(document.phase, 'document');
    { const stx = JSON.parse(fs.readFileSync(require('path').join(root6, 'status.json'), 'utf8')); server.reportFromAgent('tokubetsu-jonin', 'Docs complete', 'completed', null, null, null, null, root6, stx.current_dispatch.id, ['docs written, exit 0']); }

    const review = JSON.parse(server.runMcpWorkflow(root6));
    assert.strictEqual(review.phase, 'review');

    write(root6, 'kage_review.json', JSON.stringify({
      approved: true,
      verified_task_ids: ['task-1'],
      validation: ['pentest completed on dev/local target with 0 unhandled exploits'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      confidence: 100,
      findings: []
    }));
    write(root6, 'result.md', 'Kage approved dev/local penetration testing results.');
    server.runMcpWorkflow(root6);
    const doneState = JSON.parse(server.runMcpWorkflow(root6, { choice: '1. Compact and approve' }));
    assert.strictEqual(doneState.phase, 'done');
    assert.ok(fs.existsSync(path.join(root6, 'final_report.md')));
    console.log('✓ Anbu pentest dev local workflow approval passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root6, { recursive: true, force: true });
  }

  // 7. Canonical workflow phase sequence & WORKFLOW_PHASES constant validation
  const root7 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_'));
  server.WORKSPACE_ROOT = root7;
  try {
    const workflow = require('../src/mcp/workflow');
    assert.ok(Array.isArray(workflow.WORKFLOW_PHASES), 'WORKFLOW_PHASES must be exported as an array');
    assert.deepStrictEqual(
      workflow.WORKFLOW_PHASES,
      ['route', 'explore', 'plan', 'research', 'execute', 'document', 'review', 'synthesize', 'done'],
      'WORKFLOW_PHASES must define exactly the 8 execution phases + done terminal state'
    );
    assert.ok(Object.isFrozen(workflow.WORKFLOW_PHASES), 'WORKFLOW_PHASES must be immutable (frozen)');

    // Pin the real phase sequence against state machine behavior
    const observedPhases = [];

    // Phase 1: route -> explore
    seedPrompt(root7, 'Research and execute full feature lifecycle');
    const s1 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s1.phase, 'explore');
    observedPhases.push('route', s1.phase);

    // Phase 2: explore -> plan (genin reports via structured channel)
    write(root7, 'findings.md', 'Initial exploration findings.');
    server.reportFromAgent('genin', 'Genin exploration complete', 'completed', null, null, null, null, root7, s1.dispatch_id, ['explore traced 3 files, exit 0']);
    const s2 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s2.phase, 'plan');
    observedPhases.push(s2.phase);

    // Phase 3: plan -> research (needs_research: true, kage reports via structured channel)
    write(root7, 'plan.md', 'needs_research: true\nInvestigate third-party API specification.');
    server.reportFromAgent('kage', 'Kage marked plan as needing research', 'completed', null, null, null, null, root7, s2.dispatch_id, ['plan reviewed, exit 0']);
    const s3 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s3.phase, 'research');
    observedPhases.push(s3.phase);

    // Phase 4: research -> plan (chunin reports via structured channel)
    write(root7, 'findings.md', 'Chunin researched API documentation.');
    server.reportFromAgent('chunin', 'Research completed with citations', 'completed', null, null, null, null, root7, s3.dispatch_id, ['research done, exit 0']);
    const s4 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s4.phase, 'plan');

    // Phase 5: plan -> execute (kage reports finalized plan via structured channel)
    write(root7, 'plan.md', '- [jonin]: Build frontend component\n');
    server.reportFromAgent('kage', 'Kage finalized implementation plan', 'completed', null, null, null, null, root7, s4.dispatch_id, ['plan reviewed, exit 0']);
    server.runMcpWorkflow(root7);
    const s5 = JSON.parse(server.runMcpWorkflow(root7, { choice: '1. Compact and approve' }));
    assert.strictEqual(s5.phase, 'execute');
    observedPhases.push(s5.phase);

    // Phase 6: execute -> document
    const repStr = server.reportFromAgent('jonin', 'Frontend UI built', 'completed', null, null, null, null, root7, s5.dispatch_id, ['npm run build passed']);
    assert.strictEqual(JSON.parse(repStr).status, 'recorded');
    const s6 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s6.phase, 'document');
    observedPhases.push(s6.phase);

    // Phase 7: document -> review (tokubetsu-jonin reports via structured channel)
    { const stx = JSON.parse(fs.readFileSync(path.join(root7, 'status.json'), 'utf8')); server.reportFromAgent('tokubetsu-jonin', 'Documentation written by Tokubetsu Jonin', 'completed', null, null, null, null, root7, stx.current_dispatch.id, ['docs written, exit 0']); }
    const s7 = JSON.parse(server.runMcpWorkflow(root7));
    assert.strictEqual(s7.phase, 'review');
    observedPhases.push(s7.phase);

    // Phase 8 & 9: review -> synthesize -> done
    write(root7, 'kage_review.json', JSON.stringify({
      approved: true,
      verified_task_ids: ['task-1'],
      validation: ['all tests passed'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      confidence: 100,
      findings: []
    }));
    { const stx = JSON.parse(fs.readFileSync(path.join(root7, 'status.json'), 'utf8')); server.reportFromAgent('kage', 'Kage review approved delivery', 'completed', null, null, null, null, root7, stx.current_dispatch.id, ['review approved, exit 0']); }
    server.runMcpWorkflow(root7);
    const s8 = JSON.parse(server.runMcpWorkflow(root7, { choice: '1. Compact and approve' }));
    assert.strictEqual(s8.status, 'completed');
    assert.strictEqual(s8.phase, 'done');
    observedPhases.push('synthesize', 'done');

    // Verify final report generated and history recorded synthesize phase
    assert.ok(fs.existsSync(path.join(root7, 'final_report.md')));
    const finalStatus = JSON.parse(fs.readFileSync(path.join(root7, 'status.json'), 'utf8'));
    assert.strictEqual(finalStatus.phase, 'done');
    assert.ok(finalStatus.history.some(h => h.phase === 'synthesize' && h.agent === 'sannin'), 'History must record synthesize phase');

    // Verify static AST/text phase literals in src/mcp/workflow.js (and modules) against WORKFLOW_PHASES
    const workflowJsPath = path.resolve(__dirname, '../src/mcp/workflow.js');
    let workflowSrc = fs.readFileSync(workflowJsPath, 'utf8');
    const workflowDir = path.dirname(workflowJsPath);
    for (const sub of ['workflow_runner.js', 'workflow_completion.js']) {
      const subPath = path.join(workflowDir, sub);
      if (fs.existsSync(subPath)) {
        workflowSrc += '\n' + fs.readFileSync(subPath, 'utf8');
      }
    }
    const phaseLiteralRegex = /status\.phase\s*=\s*['"]([a-z_-]+)['"]/g;
    const extractedLiterals = [];
    let match;
    while ((match = phaseLiteralRegex.exec(workflowSrc)) !== null) {
      extractedLiterals.push(match[1]);
    }

    assert.ok(extractedLiterals.length >= 13, `Must extract at least 13 transition phase literals, found ${extractedLiterals.length}`);
    for (const lit of extractedLiterals) {
      assert.ok(
        workflow.WORKFLOW_PHASES.includes(lit),
        `Extracted phase literal "${lit}" in workflow.js must be a member of WORKFLOW_PHASES`
      );
    }

    // Verify WORKFLOW_PHASES has no duplicates and equals canonical phase list
    const uniquePhases = new Set(workflow.WORKFLOW_PHASES);
    assert.strictEqual(uniquePhases.size, workflow.WORKFLOW_PHASES.length, 'WORKFLOW_PHASES must contain no duplicate phases');
    assert.deepStrictEqual(
      workflow.WORKFLOW_PHASES,
      ['route', 'explore', 'plan', 'research', 'execute', 'document', 'review', 'synthesize', 'done'],
      'WORKFLOW_PHASES must equal canonical 8 execution phases + done terminal state'
    );

    console.log('✓ Canonical workflow phase sequence & WORKFLOW_PHASES constant validation passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root7, { recursive: true, force: true });
  }

  // 8. Two-stage HITL gates test: Gate 1 (Plan Approval) & Gate 2 (Delivery Sign-Off)
  const root8 = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_gate_hitl_'));
  server.WORKSPACE_ROOT = root8;
  const origHitlMode = process.env.KONOHA_HITL_MODE;
  process.env.KONOHA_HITL_MODE = 'enabled';
  try {
    const sdlcManager = require('../src/workflow/kage-reviewer/sdlc_manager');
    const taskId = path.basename(root8);
    seedPrompt(root8, 'Feature with HITL gates');
    const r1 = JSON.parse(server.runMcpWorkflow(root8));
    assert.strictEqual(r1.phase, 'explore');

    write(root8, 'findings.md', 'Exploration findings.');
    server.reportFromAgent('genin', 'Genin done', 'completed', null, null, null, null, root8, r1.dispatch_id, ['explore done, exit 0']);
    const r2 = JSON.parse(server.runMcpWorkflow(root8));
    assert.strictEqual(r2.phase, 'plan');

    write(root8, 'plan.md', '- [anbu]: Core backend task\n');
    server.reportFromAgent('kage', 'Kage planning done', 'completed', null, null, null, null, root8, r2.dispatch_id, ['plan reviewed, exit 0']);
    // Under hitl_mode = 'enabled', finishing plan triggers Gate 1
    const rPlanApproval = JSON.parse(server.runMcpWorkflow(root8));
    assert.strictEqual(rPlanApproval.status, 'pending_plan_approval');
    assert.strictEqual(rPlanApproval.phase, 'plan_approval');
    assert.strictEqual(rPlanApproval.hitl_gate, 'Gate 1 (Plan Approval)');

    // In status.json, hitl_gate is 'plan_approval' and phase is 'plan'
    const statusPostPlan = JSON.parse(fs.readFileSync(path.join(root8, 'status.json'), 'utf8'));
    assert.strictEqual(statusPostPlan.hitl_gate, 'plan_approval');
    assert.strictEqual(statusPostPlan.phase, 'plan');

    // Calling runMcpWorkflow again while still unapproved stays paused
    const rStillPaused = JSON.parse(server.runMcpWorkflow(root8));
    assert.strictEqual(rStillPaused.status, 'pending_plan_approval');

    // Operator approves the plan in DB
    sdlcManager.updateTask(taskId, { status: 'in_progress' });

    // Next sannin workflow call transitions Gate 1 -> execute
    const rExecute = JSON.parse(server.runMcpWorkflow(root8));
    assert.strictEqual(rExecute.phase, 'execute');
    assert.strictEqual(rExecute.agent, 'anbu');

    console.log('✓ Two-stage HITL Gate 1 (Plan Approval) pause and resume verified');
  } finally {
    process.env.KONOHA_HITL_MODE = origHitlMode;
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root8, { recursive: true, force: true });
  }

  console.log('\nAll test_workflow_gates passed cleanly!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
