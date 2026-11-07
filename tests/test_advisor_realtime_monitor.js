'use strict';

/**
 * Verification Suite: Component 7 — Real-Time Idle `@advisor` Worker Manager & Hallucination Guard
 * (`<= 1,000 Tokens` / Turn Hard Budget, `0 Tokens` When Idle, OMP-Aligned `evict_stale_results: true`)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAX_ADVISOR_TURN_TOKENS,
  MAX_ADVISOR_TURN_BYTES,
  clampAdvisorBytes,
  estimateTokens,
  evaluateWorkerTurn
} = require('../src/workflow/kage-reviewer/advisor_monitor');

async function runTests() {
  console.log('Running test_advisor_realtime_monitor.js...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-advisor-test-'));
  const validFile = path.join(tmpDir, 'valid.js');
  fs.writeFileSync(validFile, "'use strict';\nmodule.exports = { ok: true };\n", 'utf8');

  assert.strictEqual(MAX_ADVISOR_TURN_TOKENS, 1000);
  assert.strictEqual(MAX_ADVISOR_TURN_BYTES, 4000);

  const hugeSummary = 'Implemented backend endpoint with validation. '.repeat(500);
  const clamped = clampAdvisorBytes(hugeSummary, MAX_ADVISOR_TURN_BYTES);
  const byteLength = Buffer.byteLength(clamped, 'utf8');
  const tokenEstimate = estimateTokens(clamped);
  assert.ok(byteLength <= MAX_ADVISOR_TURN_BYTES, `Clamped bytes ${byteLength} exceeded ${MAX_ADVISOR_TURN_BYTES}`);
  assert.ok(tokenEstimate <= MAX_ADVISOR_TURN_TOKENS, `Clamped tokens ${tokenEstimate} exceeded ${MAX_ADVISOR_TURN_TOKENS}`);

  const idleRes = evaluateWorkerTurn({
    agent: 'anbu',
    delegatedTodo: 'Implement backend endpoint with validation',
    summary: 'Implemented backend endpoint with validation in valid.js and verified unit tests.',
    ownedFiles: [validFile],
    filesModified: [validFile],
    worktreePath: tmpDir,
    status: 'completed',
    validation: ['node tests/run_all.js: 5 passed (exit 0)']
  });
  assert.strictEqual(idleRes.status, 'IDLE_OK');
  assert.strictEqual(idleRes.interrupted, false);
  assert.strictEqual(idleRes.tokens_used, 0, 'Compliant worker turn must consume 0 advisor output tokens');
  assert.strictEqual(idleRes.evict_stale_results, true);

  const conflictFile = path.join(tmpDir, 'conflict.js');
  fs.writeFileSync(conflictFile, '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> branch\n', 'utf8');
  const nonExistentFile = path.join(tmpDir, 'hallucinated_ghost_file.js');

  const interruptRes = evaluateWorkerTurn({
    agent: 'jonin',
    delegatedTodo: 'Build responsive navigation header component',
    summary: 'TODO: placeholder implementation completed successfully without running tests',
    ownedFiles: [validFile],
    filesModified: [conflictFile, nonExistentFile, '/etc/outside_worktree.js'],
    worktreePath: tmpDir,
    checkDiskExistence: true,
    status: 'completed',
    validation: []
  });

  assert.strictEqual(interruptRes.status, 'INTERRUPT_CORRECTION');
  assert.strictEqual(interruptRes.interrupted, true);
  assert.strictEqual(interruptRes.evict_stale_results, true);
  assert.ok(interruptRes.tokens_used <= MAX_ADVISOR_TURN_TOKENS, 'Interrupt directive must stay <= 1,000 tokens');
  assert.ok(interruptRes.violations.some((v) => v.type === 'owned_files_breach' || v.type === 'worktree_escape'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'fabricated_file'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'conflict_marker'));
  assert.ok(interruptRes.violations.some((v) => v.type === 'placeholder_slop'));
  assert.ok(interruptRes.directive && interruptRes.directive.includes('[ADVISOR INTERRUPT'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('PASS test_advisor_realtime_monitor.js');
}

runTests().catch((err) => {
  console.error('FAIL test_advisor_realtime_monitor.js:', err);
  process.exit(1);
});
