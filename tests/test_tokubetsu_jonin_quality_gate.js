#!/usr/bin/env node
'use strict';

/**
 * tests/test_tokubetsu_jonin_quality_gate.js
 *
 * Verifies Tokubetsu-Jonin Quality Gate, ZeroGPT defense (< 3.0%),
 * and bounded regeneration loop in SDLC workflows.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  evaluateDeliverable,
  evaluateDeliverablesGate,
  THRESHOLDS
} = require('../src/mcp/doc_quality_gate');
const { runMcpWorkflow } = require('../src/mcp/workflow');
const { reportFromAgent } = require('../src/mcp/memory_reporting');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n🛡️  Testing Tokubetsu-Jonin Quality Gate & Regeneration Engine...\n');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_doc_qgate_test_'));

try {
  // Test 1: Clean human-written prose deliverable achieves score 0% and ZeroGPT 0.0%
  const cleanDoc = path.join(tmpDir, 'clean_report.txt');
  fs.writeFileSync(cleanDoc, `
On 14 October 2026 at 09:30 UTC, engineering teams completed migrating 48 Redis nodes to cluster-mode topology.
Latency dropped immediately.
The gateway sustained 14,200 concurrent requests across four availability zones without dropping a single active customer session.
Memory footprint stabilized at 412 MB.
Database replica lag remained below 3ms throughout the 45-minute cutover window.
`.trim(), 'utf8');

  const cleanEval = evaluateDeliverable(cleanDoc);
  check('Clean deliverable passes quality gate', cleanEval.passed === true);
  check('Clean deliverable has score < 3.0%', cleanEval.score < THRESHOLDS.MAX_SCORE, `score=${cleanEval.score}`);
  check('Clean deliverable has zerogpt_risk_score < 3.0%', cleanEval.zerogpt_risk_score < THRESHOLDS.MAX_ZEROGPT_RISK, `risk=${cleanEval.zerogpt_risk_score}`);
  check('Clean deliverable has 0 remediation hints', cleanEval.remediation_hints.length === 0);

  // Test 2: Deliverable with AI markers / cliches fails strictly (score >= 3.0%)
  const aiDoc = path.join(tmpDir, 'ai_slop_report.txt');
  fs.writeFileSync(aiDoc, `
It is crucial to remember that this comprehensive framework serves as a testament to innovation.
Furthermore, in today's digital landscape, we must delve into seamless synergies.
Moreover, it is important to note that this unlocks unprecedented possibilities.
`.trim(), 'utf8');

  const aiEval = evaluateDeliverable(aiDoc);
  check('AI slop deliverable fails quality gate', aiEval.passed === false);
  check('AI slop deliverable score exceeds threshold', aiEval.score >= THRESHOLDS.MAX_SCORE, `score=${aiEval.score}`);
  check('Remediation hints generated for AI slop', aiEval.remediation_hints.length > 0);
  check('Hints contain actionable guidance', aiEval.remediation_hints.some(h => h.includes('clichés') || h.includes('sentence lengths')));

  // Test 3: Missing or corrupt deliverable fails closed (score: 100)
  const missingEval = evaluateDeliverable(path.join(tmpDir, 'non_existent.pdf'));
  check('Non-existent deliverable fails closed', missingEval.passed === false);
  check('Non-existent deliverable receives fail-closed score 100', missingEval.score === 100);

  // Test 4: evaluateDeliverablesGate with passing deliverables advances cleanly
  const taskDirPass = path.join(tmpDir, 'task_pass');
  fs.mkdirSync(taskDirPass, { recursive: true });
  const statusPass = {
    deliverables: [cleanDoc],
    document_retry_count: 0
  };
  const gatePassResult = evaluateDeliverablesGate(taskDirPass, statusPass);
  check('evaluateDeliverablesGate passes with clean documents', gatePassResult.passed === true);
  check('Status records document_gate evidence', statusPass.document_gate && statusPass.document_gate.passed === true);
  check('No retry dispatched when gate passes', gatePassResult.status !== 'regenerate');

  // Test 5: evaluateDeliverablesGate with failing deliverable triggers regeneration (attempt 1)
  const taskDirRetry = path.join(tmpDir, 'task_retry');
  fs.mkdirSync(taskDirRetry, { recursive: true });
  const statusRetry = {
    deliverables: [aiDoc],
    document_retry_count: 0
  };
  const gateRetryResult = evaluateDeliverablesGate(taskDirRetry, statusRetry);
  check('Gate fails with AI slop deliverable', gateRetryResult.passed === false);
  check('Gate dispatches regenerate status', gateRetryResult.status === 'regenerate');
  check('Document retry count incremented to 1', statusRetry.document_retry_count === 1);
  check('Diagnostic feedback generated for subagent', typeof gateRetryResult.feedback === 'string' && gateRetryResult.feedback.includes('FAILED'));
  check('Font system directives included in feedback', gateRetryResult.feedback.includes('Konoha Font System'));

  // Test 6: Retry budget exhaustion (3 attempts) fails closed
  const statusExhaust = {
    deliverables: [aiDoc],
    document_retry_count: 3
  };
  const gateExhaustResult = evaluateDeliverablesGate(taskDirRetry, statusExhaust);
  check('Gate terminates when retry budget exhausted', gateExhaustResult.status === 'failed');
  check('Status marked as failed on exhaustion', statusExhaust.phase === 'failed');
  check('Error message clearly explains exhaustion and fail-closed posture', gateExhaustResult.error.includes('exhausted'));

  // Test 7: runMcpWorkflow document phase integration with dispatch cycle
  const taskDirWf = path.join(tmpDir, 'task_wf');
  fs.mkdirSync(taskDirWf, { recursive: true });

  const wfDocPath = path.join(taskDirWf, 'final_docs.md');
  fs.writeFileSync(wfDocPath, `It is crucial to remember that this comprehensive framework serves as a testament to innovation.
Furthermore, in today's digital landscape, we must delve into seamless synergies.
Moreover, it is important to note that this unlocks unprecedented possibilities.`);

  fs.writeFileSync(path.join(taskDirWf, 'status.json'), JSON.stringify({
    phase: 'document',
    deliverables: [wfDocPath],
    current_dispatch: { id: 'disp-doc-1', phase: 'document', agent: 'tokubetsu-jonin' },
    completed_dispatches: ['disp-doc-1'],
    dispatch_results: { 'disp-doc-1': 'Generated final_docs.md' },
    document_attempts: 0
  }, null, 2), 'utf8');

  // Step 1: document phase fails gate -> dispatches tokubetsu-jonin regeneration
  const wfStep1 = JSON.parse(runMcpWorkflow(taskDirWf));
  check('runMcpWorkflow triggers regenerate dispatch on failing deliverable', wfStep1.status === 'regenerate');
  check('Workflow stays in document phase during regeneration', wfStep1.phase === 'document');
  check('Subagent to dispatch is tokubetsu-jonin', wfStep1.agent === 'tokubetsu-jonin');

  // Step 2: simulate clean regeneration completion
  fs.writeFileSync(wfDocPath, `On 14 October 2026 at 09:30 UTC, engineering teams completed migrating 48 Redis nodes to cluster-mode topology.
Latency dropped immediately.
The gateway sustained 14,200 concurrent requests across four availability zones without dropping a single active customer session.
Memory footprint stabilized at 412 MB.
Database replica lag remained below 3ms throughout the 45-minute cutover window.`);

  const statusData = JSON.parse(fs.readFileSync(path.join(taskDirWf, 'status.json'), 'utf8'));
  statusData.current_dispatch = { id: wfStep1.dispatch_id, phase: 'document', agent: 'tokubetsu-jonin' };
  statusData.completed_dispatches.push(wfStep1.dispatch_id);
  statusData.dispatch_results[wfStep1.dispatch_id] = 'Regenerated clean final_docs.md';
  fs.writeFileSync(path.join(taskDirWf, 'status.json'), JSON.stringify(statusData, null, 2), 'utf8');

  const wfStep2 = JSON.parse(runMcpWorkflow(taskDirWf));
  check('runMcpWorkflow advances to review phase after deliverable passes gate', wfStep2.phase === 'review');
  check('Next subagent after passing gate is kage', wfStep2.agent === 'kage');

  // Test 8: reportFromAgent deliverable gate verification
  const reportAccepted = JSON.parse(reportFromAgent({
    task_id: 'test-doc-pass',
    agent: 'tokubetsu-jonin',
    status: 'completed',
    deliverables: [cleanDoc],
    validation: ['npm test exited with code 0']
  }));
  check('reportFromAgent accepts deliverable when score < 3.0%', reportAccepted.task_status === 'completed');

  const reportRejected = JSON.parse(reportFromAgent({
    task_id: 'test-doc-fail',
    agent: 'tokubetsu-jonin',
    status: 'completed',
    deliverables: [aiDoc],
    validation: ['npm test exited with code 0']
  }));
  check('reportFromAgent rejects deliverable when score >= 3.0%', reportRejected.task_status === 'rejected');
  check('reportFromAgent records quality gate violation reason', reportRejected.reason && reportRejected.reason.includes('exceeds 3.0%'));

} finally {
  // Cleanup temp files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
