#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

async function run() {
  console.log('Running test_kage_reviewer_workflow tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kage_rev_'));

  try {
    // 1. Kage review dispatch when in review phase
    const status1 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status1);
    const res1 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res1.status, 'ready');
    assert.strictEqual(res1.phase, 'review');
    assert.strictEqual(res1.agent, 'kage');
    assert.ok(fs.existsSync(path.join(tmpDir, 'delegate.md')));
    console.log('✓ Kage review dispatch passed');

    // 2. Kage review rejection on validation errors
    const status2 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ]
    };
    server.saveWorkflowStatus(tmpDir, status2);
    server.runMcpWorkflow(tmpDir);

    const reviewArtifact2 = {
      approved: false,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      validation: ['FAIL: CVE vulnerability in dependency']
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact2), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Review completed with failures.', 'utf8');

    const res2 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res2.status, 'blocked');
    assert.strictEqual(res2.phase, 'review');
    assert.ok(res2.message.includes('Kage review'));
    console.log('✓ Kage review rejection on validation errors passed');

    // 3. Kage review rejection on low confidence
    const status3 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ]
    };
    server.saveWorkflowStatus(tmpDir, status3);
    server.runMcpWorkflow(tmpDir);

    const reviewArtifact3 = {
      approved: true,
      confidence: 85,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      validation: ['all tests passed']
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact3), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Review completed with 85% confidence.', 'utf8');

    const res3 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res3.status, 'blocked');
    assert.strictEqual(res3.phase, 'review');

    // 3b. Verify 97% confidence is still blocked (threshold is strictly >= 98%)
    server.runMcpWorkflow(tmpDir);
    reviewArtifact3.confidence = 97;
    delete reviewArtifact3.categories;
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact3), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Review completed with 97% confidence.', 'utf8');
    const res3b = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res3b.status, 'blocked');
    assert.strictEqual(res3b.phase, 'review');

    // 3c. Verify category-level confidence < 98 is blocked
    server.runMcpWorkflow(tmpDir);
    reviewArtifact3.confidence = 99;
    reviewArtifact3.categories = { 'Security Review': 97 };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact3), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Review completed with category failure.', 'utf8');
    const res3c = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res3c.status, 'blocked');
    assert.strictEqual(res3c.phase, 'review');
    console.log('✓ Kage review rejection on low confidence passed');

    // 4. Kage review approval advances to synthesize
    const status4 = {
      phase: 'review',
      tasks: [
        { id: 'task-1', agent: 'anbu', task: 'Build backend', status: 'completed', result: 'Done', validation: ['pass'] }
      ],
      executed: {
        'task-1': { agent: 'anbu', task: 'Build backend', result: 'Done', validation: ['pass'] }
      }
    };
    server.saveWorkflowStatus(tmpDir, status4);
    server.runMcpWorkflow(tmpDir);

    const debugScript = path.join(tmpDir, 'debug_check.py');
    fs.writeFileSync(debugScript, '# temp debug script', 'utf8');

    const reviewArtifact4 = {
      approved: true,
      confidence: 98,
      verified_task_ids: ['task-1'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      validation: ['all 10 tests passed successfully']
    };
    fs.writeFileSync(path.join(tmpDir, 'kage_review.json'), JSON.stringify(reviewArtifact4), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'result.md'), 'Kage review verified all tasks and security requirements.', 'utf8');

    const res4 = JSON.parse(server.runMcpWorkflow(tmpDir));
    assert.strictEqual(res4.status, 'completed');
    assert.strictEqual(res4.phase, 'done');
    assert.ok(fs.existsSync(path.join(tmpDir, 'final_report.md')));
    const finalReportContent = fs.readFileSync(path.join(tmpDir, 'final_report.md'), 'utf8');
    assert.ok(finalReportContent.includes('Minimum Required: ≥ 98%'), 'Report must specify Minimum Required: ≥ 98%');
    assert.ok(finalReportContent.includes('Minimum 98% required to allow delivery'), 'Report must specify Minimum 98% required');
    assert.strictEqual(fs.existsSync(debugScript), false);
    console.log('✓ Kage review approval advances to synthesize passed');

    console.log('\nAll test_kage_reviewer_workflow passed cleanly!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
