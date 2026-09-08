#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

function setupTask(taskRoot, name, promptText = null) {
  const d = path.join(taskRoot, name);
  fs.mkdirSync(d, { recursive: true });
  if (promptText !== null) {
    fs.writeFileSync(path.join(d, 'prompt.md'), promptText, 'utf8');
  }
  return d;
}

function writeResult(task, agentName, summary) {
  fs.writeFileSync(path.join(task, 'result.md'), `## ${agentName} Output\n\n${summary}\n`, 'utf8');
  fs.writeFileSync(path.join(task, `result_${agentName}.md`), `## ${agentName} Detail\n\n${summary}\n`, 'utf8');
}

function writeFindings(task, content) {
  fs.writeFileSync(path.join(task, 'findings.md'), content, 'utf8');
}

function writePlan(task, content) {
  fs.writeFileSync(path.join(task, 'plan.md'), content, 'utf8');
}

function writeResearch(task, content) {
  fs.writeFileSync(path.join(task, 'research_results.json'), content, 'utf8');
}

async function run() {
  const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_wf_'));

  try {
    console.log('Running test_workflow_loop tests...');

    // T01: Missing prompt.md returns error
    const taskEmpty = setupTask(taskRoot, 'empty');
    const resT01 = JSON.parse(server.runMcpWorkflow(taskEmpty));
    assert.strictEqual(resT01.status, 'error');
    assert.ok((resT01.message || '').includes('No prompt.md'));
    assert.strictEqual(resT01.phase, 'route');
    console.log('✓ T01: Missing prompt passed');

    // T02: Route phase advances to explore
    const taskT02 = setupTask(taskRoot, 'route_explore', 'Refactor auth to use JWT');
    const resT02 = JSON.parse(server.runMcpWorkflow(taskT02));
    assert.strictEqual(resT02.status, 'ready');
    assert.strictEqual(resT02.phase, 'explore');
    assert.strictEqual(resT02.agent, 'genin');
    const statusT02 = JSON.parse(fs.readFileSync(path.join(taskT02, 'status.json'), 'utf8'));
    assert.strictEqual(statusT02.phase, 'explore');
    assert.strictEqual(statusT02.assigned_agent, 'genin');
    console.log('✓ T02: Route to explore passed');

    // T03: Explore phase dispatches genin
    const taskT03 = setupTask(taskRoot, 'explore_genin', 'Trace the API authentication flow end-to-end');
    const resT03 = JSON.parse(server.runMcpWorkflow(taskT03));
    assert.strictEqual(resT03.status, 'ready');
    assert.strictEqual(resT03.phase, 'explore');
    assert.strictEqual(resT03.agent, 'genin');
    const delegateT03 = fs.readFileSync(path.join(taskT03, 'delegate.md'), 'utf8');
    assert.ok(delegateT03.includes('agent: genin'));
    assert.ok(delegateT03.includes('Phase: Explore'));
    assert.ok(delegateT03.includes('Trace the API authentication flow end-to-end'));
    assert.strictEqual(fs.existsSync(path.join(taskT03, 'result.md')), false);
    console.log('✓ T03: Explore dispatches genin passed');

    // T04: After genin plan dispatches kage
    const taskT04 = setupTask(taskRoot, 'genin_plan', 'Redesign the payment module');
    const r1T04 = JSON.parse(server.runMcpWorkflow(taskT04));
    assert.strictEqual(r1T04.phase, 'explore');
    writeFindings(taskT04, '# Findings\n\nPayment uses Stripe API, handled in payments/service.py\n');
    writeResult(taskT04, 'genin', 'Mapped payment module successfully.');
    const r2T04 = JSON.parse(server.runMcpWorkflow(taskT04));
    assert.strictEqual(r2T04.status, 'ready');
    assert.strictEqual(r2T04.phase, 'plan');
    assert.strictEqual(r2T04.agent, 'kage');
    const delegateT04 = fs.readFileSync(path.join(taskT04, 'delegate.md'), 'utf8');
    assert.ok(delegateT04.includes('agent: kage'));
    assert.ok(delegateT04.includes('Payment uses Stripe API'));
    console.log('✓ T04: Genin to kage plan passed');

    // T05: Kage needs research routed to chunin
    const taskT05 = setupTask(taskRoot, 'plan_research', 'Implement OAuth2 flow');
    server.runMcpWorkflow(taskT05);
    writeFindings(taskT05, '# Findings\n\nNo OAuth2 support currently.\n');
    writeResult(taskT05, 'genin', 'Mapped codebase.');
    const r2T05 = JSON.parse(server.runMcpWorkflow(taskT05));
    assert.strictEqual(r2T05.phase, 'plan');
    assert.strictEqual(r2T05.agent, 'kage');
    writePlan(taskT05, 'needs_research: true\nresearch_query: OAuth2 PKCE best practices\n');
    writeResult(taskT05, 'kage', 'Requires OAuth2 research.');
    const r3T05 = JSON.parse(server.runMcpWorkflow(taskT05));
    assert.strictEqual(r3T05.status, 'ready');
    assert.strictEqual(r3T05.phase, 'research');
    assert.strictEqual(r3T05.agent, 'chunin');
    console.log('✓ T05: Kage needs research routes to chunin passed');

    // T06: After research plan re-dispatches kage
    const taskT06 = setupTask(taskRoot, 'research_plan2', 'Implement OAuth2');
    server.runMcpWorkflow(taskT06);
    writeFindings(taskT06, '# Findings\n\nNo OAuth2.\n');
    writeResult(taskT06, 'genin', 'Mapped.');
    server.runMcpWorkflow(taskT06);
    writePlan(taskT06, 'needs_research: true\nresearch_query: OAuth2 PKCE\n');
    writeResult(taskT06, 'kage', 'Requires research.');
    server.runMcpWorkflow(taskT06);
    const dtextT06 = fs.readFileSync(path.join(taskT06, 'delegate.md'), 'utf8');
    assert.ok(dtextT06.includes('agent: chunin'));
    assert.ok(dtextT06.includes('OAuth2 PKCE'));
    writeResearch(taskT06, '{"findings": ["PKCE recommended"], "synthesis": "Use auth code+PKCE"}');
    writeResult(taskT06, 'chunin', 'Research complete.');
    const r4T06 = JSON.parse(server.runMcpWorkflow(taskT06));
    assert.strictEqual(r4T06.status, 'ready');
    assert.strictEqual(r4T06.phase, 'plan');
    assert.strictEqual(r4T06.agent, 'kage');
    console.log('✓ T06: Research re-dispatches kage passed');

    // T07: Kage no research routes to execute
    const taskT07 = setupTask(taskRoot, 'plan_execute', 'Fix a CSS bug');
    server.runMcpWorkflow(taskT07);
    writeFindings(taskT07, '# Findings\n\nCSS in styles/app.css line 42.\n');
    writeResult(taskT07, 'genin', 'Found CSS location.');
    server.runMcpWorkflow(taskT07);
    writePlan(taskT07, '## Plan\n\nFix the CSS bug at line 42.\n');
    writeResult(taskT07, 'kage', 'Plan ready.');
    const r3T07 = JSON.parse(server.runMcpWorkflow(taskT07));
    assert.strictEqual(r3T07.status, 'ready');
    assert.strictEqual(r3T07.phase, 'execute');
    assert.ok(r3T07.agent !== null);
    console.log('✓ T07: Kage no research routes to execute passed');

    // T08: Execute phase dispatches first pending agent (anbu)
    const taskT08 = setupTask(taskRoot, 'execute_anbu', 'Fix API bug');
    server.runMcpWorkflow(taskT08);
    writeFindings(taskT08, '# Findings\n\nBug in api/handler.py\n');
    writeResult(taskT08, 'genin', 'Mapped.');
    server.runMcpWorkflow(taskT08);
    writePlan(taskT08, '## Plan\n\n- [anbu]: Fix authentication middleware in api/handler.py\n- [jonin]: Update the login form styling\n');
    writeResult(taskT08, 'kage', 'Plan ready.');
    const r3T08 = JSON.parse(server.runMcpWorkflow(taskT08));
    assert.strictEqual(r3T08.status, 'ready');
    assert.strictEqual(r3T08.phase, 'execute');
    assert.strictEqual(r3T08.agent, 'anbu');
    const dtextT08 = fs.readFileSync(path.join(taskT08, 'delegate.md'), 'utf8');
    assert.ok(dtextT08.includes('agent: anbu'));
    assert.ok(dtextT08.includes('authentication middleware'));
    console.log('✓ T08: Execute dispatches first pending agent passed');

    // T09: Execute phase dispatches second after first done
    const taskT09 = setupTask(taskRoot, 'execute_multi', 'Fix bug and update UI');
    server.runMcpWorkflow(taskT09);
    writeFindings(taskT09, '# Findings\n\nBackend and frontend affected.\n');
    writeResult(taskT09, 'genin', 'Mapped.');
    server.runMcpWorkflow(taskT09);
    writePlan(taskT09, '## Plan\n\n- [anbu]: Fix the API bug\n- [jonin]: Update the login form\n');
    writeResult(taskT09, 'kage', 'Plan ready.');
    const r3T09 = JSON.parse(server.runMcpWorkflow(taskT09));
    assert.strictEqual(r3T09.phase, 'execute');
    assert.strictEqual(r3T09.agent, 'anbu');
    writeResult(taskT09, 'anbu', 'API bug fixed.');
    const r4T09 = JSON.parse(server.runMcpWorkflow(taskT09));
    assert.strictEqual(r4T09.status, 'ready');
    assert.strictEqual(r4T09.phase, 'execute');
    assert.strictEqual(r4T09.agent, 'jonin');
    console.log('✓ T09: Execute dispatches second agent passed');

    // T10: Document phase dispatches tokubetsu
    const taskT10 = setupTask(taskRoot, 'document_phase', 'Complete feature');
    server.runMcpWorkflow(taskT10);
    writeFindings(taskT10, '# Findings\n\nMapped.\n');
    writeResult(taskT10, 'genin', 'Mapped.');
    server.runMcpWorkflow(taskT10);
    writePlan(taskT10, '## Plan\n\n- [anbu]: Build the API\n- [jonin]: Build the UI\n');
    writeResult(taskT10, 'kage', 'Plan ready.');
    server.runMcpWorkflow(taskT10);
    writeResult(taskT10, 'anbu', 'API built.');
    server.runMcpWorkflow(taskT10);
    writeResult(taskT10, 'jonin', 'UI built.');
    const r5T10 = JSON.parse(server.runMcpWorkflow(taskT10));
    assert.strictEqual(r5T10.status, 'ready');
    assert.strictEqual(r5T10.phase, 'document');
    assert.strictEqual(r5T10.agent, 'tokubetsu-jonin');
    console.log('✓ T10: Document phase dispatches tokubetsu passed');

    // T11: Synthesize writes final report
    const taskT11 = setupTask(taskRoot, 'synthesize_phase', 'Build feature X');
    fs.writeFileSync(path.join(taskT11, 'status.json'), JSON.stringify({
      phase: 'synthesize',
      assigned_agent: 'sannin',
      executed: {
        anbu: { task: 'Build backend', result: 'Backend complete.', iterations: 1 },
        jonin: { task: 'Build frontend', result: 'Frontend complete.', iterations: 1 }
      },
      history: []
    }));
    writeFindings(taskT11, '# Findings\n\nMapped.\n');
    fs.writeFileSync(path.join(taskT11, 'kage_review.json'), JSON.stringify({
      approved: true,
      verified_task_ids: ['anbu', 'jonin'],
      validation: ['all configured checks passed'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      findings: []
    }));
    writePlan(taskT11, '## Plan\n\nDo everything.\n');
    writeResearch(taskT11, '{"query": "X best practices", "findings": []}');
    fs.writeFileSync(path.join(taskT11, 'final_docs.md'), '# Final Documentation\n\nAll compiled.');
    const resT11 = JSON.parse(server.runMcpWorkflow(taskT11));
    assert.strictEqual(resT11.status, 'completed');
    assert.strictEqual(resT11.phase, 'done');
    assert.ok(resT11.final_report_path);
    assert.ok(fs.existsSync(path.join(taskT11, 'final_report.md')));
    const reportT11 = fs.readFileSync(path.join(taskT11, 'final_report.md'), 'utf8');
    assert.ok(reportT11.includes('Build feature X'));
    assert.ok(reportT11.includes('Backend complete.'));
    assert.ok(reportT11.includes('Frontend complete.'));
    console.log('✓ T11: Synthesize writes final report passed');

    // T12: Done phase returns completed
    const taskT12 = setupTask(taskRoot, 'done_phase', 'Some task');
    fs.writeFileSync(path.join(taskT12, 'status.json'), JSON.stringify({ phase: 'done', history: [] }));
    const res1T12 = JSON.parse(server.runMcpWorkflow(taskT12));
    assert.strictEqual(res1T12.status, 'completed');
    assert.strictEqual(res1T12.phase, 'done');
    const res2T12 = JSON.parse(server.runMcpWorkflow(taskT12));
    assert.strictEqual(res2T12.status, 'completed');
    assert.strictEqual(res2T12.phase, 'done');
    console.log('✓ T12: Done phase returns completed passed');

    // T13: Status.json persists across calls
    const taskT13 = setupTask(taskRoot, 'persistence', 'Test persistence');
    const r1T13 = JSON.parse(server.runMcpWorkflow(taskT13));
    assert.strictEqual(r1T13.phase, 'explore');
    const status1T13 = JSON.parse(fs.readFileSync(path.join(taskT13, 'status.json'), 'utf8'));
    assert.strictEqual(status1T13.phase, 'explore');
    assert.ok(status1T13.created_at);
    writeFindings(taskT13, '# Findings\n\nMapped.\n');
    writeResult(taskT13, 'genin', 'Done.');
    const r2T13 = JSON.parse(server.runMcpWorkflow(taskT13));
    assert.strictEqual(r2T13.phase, 'plan');
    const status2T13 = JSON.parse(fs.readFileSync(path.join(taskT13, 'status.json'), 'utf8'));
    assert.strictEqual(status2T13.phase, 'plan');
    assert.strictEqual(status2T13.assigned_agent, 'kage');
    console.log('✓ T13: Status.json persists passed');

    console.log('\nAll 13 workflow loop tests passed cleanly!');
  } finally {
    fs.rmSync(taskRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
