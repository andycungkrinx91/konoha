#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');

/**
 * tests/test_shared_context_layer.js — Cross-agent context reuse.
 *
 * Asserts that a finding reported by one specialist reaches the next specialist
 * spawned for the same task, stays out of the reporter's own prompt, is scoped
 * to its task, replaces itself on re-report, and never exceeds the byte budget.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sc = require(path.join(ROOT, 'src', 'mcp', 'shared_context'));
const { reportFromAgent } = require(path.join(ROOT, 'src', 'mcp', 'memory_project_context'));
const { runMcpAgent } = require(path.join(ROOT, 'src', 'mcp', 'memory_subagent_runner'));
const { saveWorkflowStatus, getResolvedTaskDir } = require(path.join(ROOT, 'src', 'mcp', 'workflow_common'));

console.log('Running test_shared_context_layer.js...');

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_shared_ctx_'));
const taskId = 'task-shared-ctx-probe';

// No findings yet → no block.
assert.strictEqual(sc.formatSharedContextBlock(sc.readSharedContext({ taskId, projectPath })), '');

// One producer publishes a finding.
sc.recordFinding({
  agent: 'genin',
  taskId,
  status: 'completed',
  summary: 'Bridge retry lives in src/bridge/request_retry.js; forwardWithRetry wraps every forward.',
  learnings: ['retry helper already exists'],
  filesModified: ['src/bridge/request_retry.js'],
  verified: true,
  projectPath
});

const rows = sc.readSharedContext({ taskId, excludeAgent: 'anbu', projectPath });
assert.strictEqual(rows.length, 1, 'consumer must see the sibling finding');
assert.strictEqual(rows[0].agent, 'genin');
assert.strictEqual(rows[0].files, 1);
assert(rows[0].summary.includes('request_retry.js'), 'summary must survive the round trip');

// Reporter does not see its own finding back.
assert.deepStrictEqual(sc.readSharedContext({ taskId, excludeAgent: 'genin', projectPath }), []);

// Task scoping: another task's findings stay out.
assert.deepStrictEqual(sc.readSharedContext({ taskId: 'task-other', projectPath }), []);

// Re-report is idempotent, and a changed report replaces instead of appending.
const firstId = sc.recordFinding({ agent: 'genin', taskId, summary: 'same text', verified: true, projectPath });
assert.strictEqual(sc.recordFinding({ agent: 'genin', taskId, summary: 'same text', verified: true, projectPath }), firstId, 'identical re-report must reuse the row');
sc.recordFinding({ agent: 'genin', taskId, summary: 'updated finding text', verified: true, projectPath });
const afterReplace = sc.readSharedContext({ taskId, projectPath });
assert.strictEqual(afterReplace.length, 1, 're-report must replace, not duplicate');
assert(afterReplace[0].summary.includes('updated finding text'));

// An unverified report must stay marked: the block is what siblings trust.
const unverifiedTaskId = 'task-unverified-probe';
sc.recordFinding({ agent: 'chunin', taskId: unverifiedTaskId, summary: 'probably the timeout comes from the proxy', verified: false, projectPath });
const unverifiedRows = sc.readSharedContext({ taskId: unverifiedTaskId, projectPath });
assert.strictEqual(unverifiedRows.length, 1);
assert.strictEqual(unverifiedRows[0].unverified, true, 'an unverified finding must carry the flag');
const unverifiedBlock = sc.formatSharedContextBlock(unverifiedRows);
assert(unverifiedBlock.includes('unverified'), 'the prompt block must not present unverified work as trusted');

// Byte budget holds even when every slot is filled with long summaries.
for (const agent of ['kage', 'jonin', 'anbu', 'chunin', 'akatsuki', 'yamanaka', 'tokubetsu-jonin']) {
  sc.recordFinding({ agent, taskId, summary: 'x'.repeat(600), verified: true, projectPath });
}
const fullBlock = sc.formatSharedContextBlock(sc.readSharedContext({ taskId, projectPath }));
assert(fullBlock.length > 0, 'block must render when findings exist');
assert(Buffer.byteLength(fullBlock, 'utf8') <= sc.SC_MAX_BYTES, `block ${Buffer.byteLength(fullBlock, 'utf8')} bytes exceeds budget`);
assert(sc.readSharedContext({ taskId, projectPath }).length <= sc.SC_MAX_ITEMS, 'finding count must be capped');

// End-to-end: a real report reaches the next specialist's prompt, and the
//    reporter's own prompt stays clean.
const e2eTaskId = 'task-e2e-probe';
const taskDir = getResolvedTaskDir(e2eTaskId, projectPath);
fs.mkdirSync(taskDir, { recursive: true });
saveWorkflowStatus(taskDir, { task_id: e2eTaskId, phase: 'execute', tasks: [], history: [] });

reportFromAgent({
  agent: 'genin',
  summary: 'Routing lives in src/mcp/sannin_router.js; decideRoute returns signals only.',
  status: 'completed',
  filesModified: ['src/mcp/sannin_router.js'],
  projectPath,
  taskDir,
  validation: 'node tests/test_token_budget_gate.js exited 0'
});

const anbu = JSON.parse(runMcpAgent('anbu', { task: 'Apply the retry change', projectPath, taskDir }));
assert(anbu.instructions.includes('Shared Task Context'), 'consumer prompt must carry the shared block');
assert(anbu.instructions.includes('sannin_router.js'), 'consumer prompt must carry the sibling finding content');
const genin = JSON.parse(runMcpAgent('genin', { task: 'Apply the retry change', projectPath, taskDir }));
assert(!genin.instructions.includes('Shared Task Context'), 'producer prompt must not echo its own finding');

console.log(`  block bytes: ${Buffer.byteLength(fullBlock, 'utf8')} (cap ${sc.SC_MAX_BYTES})`);
console.log('PASS test_shared_context_layer.js');
