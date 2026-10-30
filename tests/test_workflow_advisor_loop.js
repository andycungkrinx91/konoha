// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  runMcpWorkflow,
  saveWorkflowStatus,
  workflowReviewApproved
} = require('../src/mcp/workflow');

function run() {
  console.log('Running test_workflow_advisor_loop...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_advisor_test_'));

  try {
    // 1. Verify workflowReviewApproved blocks when advisor_approved is false
    const passingTasks = [
      { id: 'task-1', agent: 'anbu', task: 'Implement backend service', status: 'completed', validation: ['test_pass'] }
    ];
    const statusWithAdvisorReject = {
      tasks: passingTasks,
      review: {
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        categories: { task: 100, evidence: 100, security: 100, regression: 100, slop: 100 },
        advisor_approved: false,
        advisor_feedback: 'Missing integration smoke test in /tmp isolation'
      }
    };

    assert.strictEqual(
      workflowReviewApproved(tmpDir, statusWithAdvisorReject),
      false,
      'workflowReviewApproved must return false when advisor_approved is false'
    );
    console.log('✓ workflowReviewApproved blocks on advisor rejection');

    // 2. Verify routeWorkflow triggers remediation loop on advisor rejection
    const workflowStatus = {
      schema_version: 2,
      created_at: new Date().toISOString(),
      phase: 'review',
      assigned_agent: 'kage',
      current_dispatch: {
        id: 'dispatch-review-1',
        phase: 'review',
        agent: 'kage'
      },
      completed_dispatches: [],
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Implement backend service', status: 'completed', validation: ['test_pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Implement backend service', result: 'done', validation: ['test_pass'] }
      },
      review: {
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        categories: { task: 100, evidence: 100, security: 100, regression: 100, slop: 100 },
        advisor_approved: false,
        advisor_feedback: 'Missing integration smoke test'
      }
    };

    saveWorkflowStatus(tmpDir, workflowStatus);
    { const { reportFromAgent } = require('../src/mcp/memory_project_context'); reportFromAgent('kage', 'Kage review finished', 'completed', null, null, null, null, tmpDir, 'dispatch-review-1', ['review executed, exit 0']); }
    const routeResultRaw = runMcpWorkflow(tmpDir);
    const routeResult = JSON.parse(routeResultRaw);

    assert.strictEqual(routeResult.status, 'remediation', 'Route status must be remediation');
    assert.strictEqual(routeResult.phase, 'execute', 'Phase must revert to execute');
    assert.strictEqual(routeResult.gate, 'advisor', 'Gate must be identified as advisor');
    assert.strictEqual(routeResult.agent, 'anbu', 'Remediation agent must be anbu for backend feedback');
    assert.strictEqual(routeResult.advisor_cycles, 1, 'advisor_cycles must be 1');
    assert.ok(routeResult.task_id.startsWith('advisor-fix-1'), 'Task ID must be advisor-fix-1');
    assert.ok(routeResult.task.includes('Missing integration smoke test'), 'Task text must include advisor feedback');
    console.log('✓ runMcpWorkflow dispatches advisor remediation fix task to anbu');

    // 3. Verify Jonin is selected when advisor feedback is UI-related
    const uiWorkflowStatus = {
      schema_version: 2,
      created_at: new Date().toISOString(),
      phase: 'review',
      assigned_agent: 'kage',
      current_dispatch: {
        id: 'dispatch-review-2',
        phase: 'review',
        agent: 'kage'
      },
      completed_dispatches: [],
      tasks: [
        { id: 'task-ui', agent: 'jonin', task: 'Build landing page', status: 'completed', validation: ['lint_clean'] }
      ],
      executed: {
        'task-ui': { agent: 'jonin', task: 'Build landing page', result: 'ui built', validation: ['lint_clean'] }
      },
      review: {
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        categories: { task: 100, evidence: 100, security: 100, regression: 100, slop: 100 },
        advisor_approved: false,
        advisor_feedback: 'Button contrast in dark mode does not meet WCAG AA standards'
      }
    };

    saveWorkflowStatus(tmpDir, uiWorkflowStatus);
    { const { reportFromAgent } = require('../src/mcp/memory_project_context'); reportFromAgent('kage', 'Kage review finished', 'completed', null, null, null, null, tmpDir, 'dispatch-review-2', ['review executed, exit 0']); }
    const uiRouteResultRaw = runMcpWorkflow(tmpDir);
    const uiRouteResult = JSON.parse(uiRouteResultRaw);

    assert.strictEqual(uiRouteResult.status, 'remediation');
    assert.strictEqual(uiRouteResult.agent, 'jonin', 'Remediation agent must be jonin for UI contrast feedback');
    console.log('✓ runMcpWorkflow dispatches UI advisor remediation to jonin');

    // 4. Verify approval after advisor remediation completes
    const resolvedStatus = {
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Implement backend service', status: 'completed', validation: ['test_pass'] },
        { id: 'advisor-fix-1', agent: 'anbu', task: 'Add integration test', status: 'completed', validation: ['smoke_pass'] }
      ],
      review: {
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        categories: { task: 100, evidence: 100, security: 100, regression: 100, slop: 100 },
        advisor_approved: true,
        advisor_feedback: 'All acceptance criteria and smoke tests verified'
      }
    };

    assert.strictEqual(
      workflowReviewApproved(tmpDir, resolvedStatus),
      true,
      'workflowReviewApproved must return true when advisor_approved is true'
    );
    console.log('✓ workflowReviewApproved passes when advisor approves');

    // 5. Verify circuit breaker blocks after 7 cycles
    const excessiveCyclesStatus = {
      schema_version: 2,
      created_at: new Date().toISOString(),
      phase: 'review',
      advisor_cycles: 7, // Next will be 8
      current_dispatch: { id: 'dispatch-review-overflow', phase: 'review', agent: 'kage' },
      completed_dispatches: [],
      tasks: passingTasks,
      executed: { 'task-1': { agent: 'anbu', task: 'test', result: 'ok', validation: ['test_pass'] } },
      review: {
        approved: true,
        confidence: 100,
        ai_slop_clean: true,
        ai_slop_findings: 0,
        categories: { task: 100, evidence: 100, security: 100, regression: 100, slop: 100 },
        advisor_approved: false,
        advisor_feedback: 'Persistent architectural blocker'
      }
    };

    saveWorkflowStatus(tmpDir, excessiveCyclesStatus);
    { const { reportFromAgent } = require('../src/mcp/memory_project_context'); reportFromAgent('kage', 'Kage review finished', 'completed', null, null, null, null, tmpDir, 'dispatch-review-overflow', ['review executed, exit 0']); }
    const overflowResult = JSON.parse(runMcpWorkflow(tmpDir));
    assert.strictEqual(overflowResult.status, 'blocked', 'Circuit breaker must block when advisor_cycles > 7');
    assert.strictEqual(overflowResult.advisor_cycles, 8);
    console.log('✓ Circuit breaker trips and blocks after 7 advisor cycles');

    console.log('\nAll test_workflow_advisor_loop tests passed cleanly!');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

run();
