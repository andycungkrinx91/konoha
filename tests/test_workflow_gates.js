#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

function write(root, name, value) {
  fs.writeFileSync(path.join(root, name), value, 'utf8');
}

function advanceToPlan(root) {
  write(root, 'prompt.md', 'Implement a small backend fix');
  const first = JSON.parse(server.runMcpWorkflow(root));
  assert.strictEqual(first.phase, 'explore');
  write(root, 'findings.md', 'The backend fix is isolated.');
  write(root, 'result.md', 'Genin completed exploration.');
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
    write(root, 'prompt.md', 'Implement a fix');
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
    write(root2, 'result.md', 'Kage approved two separate tasks.');
    const execute = JSON.parse(server.runMcpWorkflow(root2));
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
    write(root3, 'result.md', 'Kage approved the implementation plan.');
    const execute = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(execute.agent, 'anbu');
    write(root3, 'result.md', 'API fixed.');
    const document = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(document.phase, 'document');
    write(root3, 'result.md', 'Documentation complete.');
    const review = JSON.parse(server.runMcpWorkflow(root3));
    assert.strictEqual(review.phase, 'review');
    write(root3, 'result.md', 'Review rejected because validation is missing.');
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
      findings: []
    }));
    write(root3, 'result.md', 'Kage approved all work.');
    const approved = JSON.parse(server.runMcpWorkflow(root3));
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
    write(root4, 'result.md', 'Kage approved the implementation plan.');
    const execute = JSON.parse(server.runMcpWorkflow(root4));
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
    write(root5, 'result.md', 'Kage approved the implementation plan.');
    const execute = JSON.parse(server.runMcpWorkflow(root5));
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
    write(root6, 'result.md', 'Kage approved the security assessment plan.');
    const execute = JSON.parse(server.runMcpWorkflow(root6));
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
    write(root6, 'result.md', 'Documented local pentest report and remediation recommendations.');

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

    const doneState = JSON.parse(server.runMcpWorkflow(root6));
    assert.strictEqual(doneState.phase, 'done');
    assert.ok(fs.existsSync(path.join(root6, 'final_report.md')));
    console.log('✓ Anbu pentest dev local workflow approval passed');
  } finally {
    server.WORKSPACE_ROOT = prevRoot;
    fs.rmSync(root6, { recursive: true, force: true });
  }

  console.log('\nAll test_workflow_gates passed cleanly!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
