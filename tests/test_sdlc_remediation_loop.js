#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_sdlc_remediation_loop.js — Tests Anti-Slop Delivery Gate & Kage->Anbu Remediation Loop.
 * Covers Phase 7 & Phase 8 of PLAN_NATIVE_SDLC.md:
 * - evaluateAntiSlopDeliveryGate (clean -> pass, dirty -> fail with findings)
 * - generateSlopFixTask (prompt generation from findings)
 * - Remediation loop execution in workflow engine:
 *   - Automatic dispatch to Anbu on slop failure
 *   - Cycle counting (slop_cycles)
 *   - Delegation depth circuit breaker tripping (> 7 cycles)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sdlc = require('../src/sdlc_manager');
const { runMcpWorkflow } = require('../src/mcp/workflow');

async function run() {
  console.log('Running test_sdlc_remediation_loop tests...');

  // 1. evaluateAntiSlopDeliveryGate - Clean Pass
  const cleanArtifact = {
    ai_slop_clean: true,
    ai_slop_findings: 0,
    findings: [],
    confidence: 99
  };
  const cleanGate = sdlc.evaluateAntiSlopDeliveryGate(cleanArtifact);
  assert.strictEqual(cleanGate.pass, true);
  assert.strictEqual(cleanGate.findings.length, 0);
  assert.ok(cleanGate.scanned_at);
  console.log('✓ Clean anti-slop delivery gate pass verified');

  // 2. evaluateAntiSlopDeliveryGate - Fail with findings
  const dirtyArtifact = {
    ai_slop_clean: false,
    ai_slop_findings: 2,
    findings: [
      'Unnecessary markdown preamble and filler conversational prose',
      { rule: 'R-SLOP-2', description: 'Vague TODO comments left in production code' }
    ],
    confidence: 85
  };
  const dirtyGate = sdlc.evaluateAntiSlopDeliveryGate(dirtyArtifact);
  assert.strictEqual(dirtyGate.pass, false);
  assert.strictEqual(dirtyGate.findings.length, 2);
  assert.strictEqual(dirtyGate.findings[0].rule, 'R-SLOP-1');
  assert.ok(dirtyGate.findings[0].description.includes('preamble'));
  assert.strictEqual(dirtyGate.findings[1].rule, 'R-SLOP-2');
  console.log('✓ Dirty anti-slop delivery gate failure & normalization verified');

  // 3. evaluateAntiSlopDeliveryGate - Null / Invalid Input
  const nullGate = sdlc.evaluateAntiSlopDeliveryGate(null);
  assert.strictEqual(nullGate.pass, false);
  assert.strictEqual(nullGate.findings[0].rule, 'R-00');
  console.log('✓ Invalid artifact fallback verified');

  // 4. generateSlopFixTask
  const fixPrompt = sdlc.generateSlopFixTask(dirtyGate);
  assert.ok(fixPrompt.includes('Remediate the following anti-slop Delivery Gate findings:'));
  assert.ok(fixPrompt.includes('[R-SLOP-1]'));
  assert.ok(fixPrompt.includes('[R-SLOP-2]'));
  assert.ok(fixPrompt.includes('Ensure 0 AI slop findings'));
  console.log('✓ Slop fix task generation verified');

  // 5. Workflow Remediation Loop: Phase 8 Kage -> Anbu Auto-Remediation
  const tmpWorkflowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc_remediation_test_'));
  try {
    const initialStatus = {
      version: 1,
      phase: 'review',
      assigned_agent: 'kage',
      task_id: 'task-auth-impl',
      tasks: [
        { id: 'task-auth-impl', agent: 'anbu', status: 'completed', validation: ['npm test exit 0'] }
      ],
      completed_executors: ['task-auth-impl'],
      pending_executors: [],
      remediation_loop: true,
      slop_cycles: 0,
      current_dispatch: {
        id: 'dispatch-review-1',
        phase: 'review',
        agent: 'kage',
        previous_result_hash: 'prev_hash_abc'
      },
      completed_dispatches: [],
      dispatch_results: {}
    };
    fs.writeFileSync(path.join(tmpWorkflowDir, 'status.json'), JSON.stringify(initialStatus, null, 2), 'utf8');

    // Simulate Kage review result with slop findings
    const kageReviewReport = {
      status: 'rejected',
      approved: false,
      confidence: 80,
      ai_slop_clean: false,
      ai_slop_findings: 1,
      findings: [
        'Overly verbose filler comments and simulated mock outputs detected'
      ],
      validation: ['npm test exit 0']
    };
    fs.writeFileSync(path.join(tmpWorkflowDir, 'kage_review.json'), JSON.stringify(kageReviewReport, null, 2), 'utf8');
    fs.writeFileSync(path.join(tmpWorkflowDir, 'result.md'), 'Kage Review Complete: Slop detected', 'utf8');

    // Run workflow in review phase with slop failure
    const step1Res = JSON.parse(await runMcpWorkflow(tmpWorkflowDir));
    assert.strictEqual(step1Res.status, 'remediation');
    assert.strictEqual(step1Res.phase, 'execute');
    assert.strictEqual(step1Res.agent, 'anbu');
    assert.strictEqual(step1Res.slop_cycles, 1);
    assert.ok(step1Res.message.includes('Dispatched remediation task to Anbu (cycle 1)'));

    // Check that delegate.md was written for Anbu
    const delegateContent = fs.readFileSync(path.join(tmpWorkflowDir, 'delegate.md'), 'utf8');
    assert.ok(delegateContent.includes('agent: anbu'));
    assert.ok(delegateContent.includes('Phase: Remediation (Anti-Slop Cycle 1)'));
    assert.ok(delegateContent.includes('Overly verbose filler comments'));

    // Verify updated status.json
    const updatedStatus = JSON.parse(fs.readFileSync(path.join(tmpWorkflowDir, 'status.json'), 'utf8'));
    assert.strictEqual(updatedStatus.slop_cycles, 1);
    assert.strictEqual(updatedStatus.phase, 'execute');
    assert.strictEqual(updatedStatus.assigned_agent, 'anbu');
    console.log('✓ Workflow remediation loop auto-dispatch to Anbu verified');

    // 5b. Workflow Remediation Loop: Phase 8 Kage -> Jonin Auto-Remediation for UI tasks
    const tmpJoninDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc_jonin_remediation_'));
    try {
      const joninStatus = {
        version: 1,
        phase: 'review',
        assigned_agent: 'kage',
        task_id: 'task-ui-landing',
        tasks: [
          { id: 'task-ui-landing', agent: 'jonin', status: 'completed', validation: ['pnpm run build exit 0'] }
        ],
        completed_executors: ['task-ui-landing'],
        executed: {
          'task-ui-landing': { agent: 'jonin', task: 'Build landing page', result: 'UI done', validation: ['pnpm run build exit 0'] }
        },
        pending_executors: [],
        remediation_loop: true,
        slop_cycles: 0,
        current_dispatch: {
          id: 'dispatch-review-jonin-1',
          phase: 'review',
          agent: 'kage',
          previous_result_hash: 'prev_hash_jonin'
        },
        completed_dispatches: [],
        dispatch_results: {}
      };
      fs.writeFileSync(path.join(tmpJoninDir, 'status.json'), JSON.stringify(joninStatus, null, 2), 'utf8');

      const kageReviewJonin = {
        status: 'rejected',
        approved: false,
        confidence: 82,
        ai_slop_clean: false,
        ai_slop_findings: 1,
        findings: [
          'Generic AI purple gradients and boilerplate cards detected in Tailwind CSS components'
        ],
        validation: ['pnpm run build exit 0']
      };
      fs.writeFileSync(path.join(tmpJoninDir, 'kage_review.json'), JSON.stringify(kageReviewJonin, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpJoninDir, 'result.md'), 'Kage Review Complete: UI slop detected', 'utf8');

      const joninStepRes = JSON.parse(await runMcpWorkflow(tmpJoninDir));
      assert.strictEqual(joninStepRes.status, 'remediation');
      assert.strictEqual(joninStepRes.phase, 'execute');
      assert.strictEqual(joninStepRes.agent, 'jonin');
      assert.strictEqual(joninStepRes.slop_cycles, 1);
      assert.ok(joninStepRes.message.includes('Dispatched remediation task to Jonin (cycle 1)'));

      const joninDelegate = fs.readFileSync(path.join(tmpJoninDir, 'delegate.md'), 'utf8');
      assert.ok(joninDelegate.includes('agent: jonin'));
      assert.ok(joninDelegate.includes('Generic AI purple gradients'));
      console.log('✓ Workflow remediation loop auto-dispatch to Jonin for UI tasks verified');
    } finally {
      fs.rmSync(tmpJoninDir, { recursive: true, force: true });
    }

    // 6. Workflow Remediation Loop: Circuit Breaker (> 7 cycles)
    // Fast-forward slop_cycles to 7
    updatedStatus.slop_cycles = 7;
    updatedStatus.phase = 'review';
    updatedStatus.assigned_agent = 'kage';
    updatedStatus.pending_executors = [];
    updatedStatus.current_dispatch = {
      id: 'dispatch-review-cb',
      phase: 'review',
      agent: 'kage',
      previous_result_hash: 'hash_before_cb'
    };
    fs.writeFileSync(path.join(tmpWorkflowDir, 'status.json'), JSON.stringify(updatedStatus, null, 2), 'utf8');
    // Write new result.md to trigger completion
    fs.writeFileSync(path.join(tmpWorkflowDir, 'result.md'), 'Kage Review Complete: Slop Still Present (Cycle 8)', 'utf8');

    const circuitBreakerRes = JSON.parse(await runMcpWorkflow(tmpWorkflowDir));
    assert.strictEqual(circuitBreakerRes.status, 'blocked');
    assert.strictEqual(circuitBreakerRes.phase, 'review');
    assert.strictEqual(circuitBreakerRes.slop_cycles, 8);
    assert.ok(circuitBreakerRes.message.includes('Delegation depth circuit breaker tripped (> 7 slop remediation cycles)'));

    const blockedStatus = JSON.parse(fs.readFileSync(path.join(tmpWorkflowDir, 'status.json'), 'utf8'));
    assert.strictEqual(blockedStatus.status, 'blocked');
    assert.strictEqual(blockedStatus.slop_cycles, 8);
    console.log('✓ Delegation depth circuit breaker (> 7 cycles) trip verified');

  } finally {
    fs.rmSync(tmpWorkflowDir, { recursive: true, force: true });
  }

  console.log('All test_sdlc_remediation_loop tests passed cleanly!\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
