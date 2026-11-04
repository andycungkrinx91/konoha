#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies that task reconciliation only reclaims genuinely abandoned work.
 * A task waiting on a human approval must never be force-timed-out.
 */

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbmod = require('../src/db');
const sdlc = require('../src/workflow/kage-reviewer/sdlc_manager');

const tmpDb = path.join(os.tmpdir(), `konoha-reconcile-${Date.now()}.db`);
const conn = dbmod.getConnection(tmpDb, false);
dbmod.setupSchema(conn);

const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function seed(id, status, evidence = '{}') {
  conn.prepare(`
    INSERT INTO sdlc_tasks (id, description, status, evidence, project_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, `task ${id}`, status, evidence, '/tmp/proj', old, old);
}

const freshHeartbeat = new Date(Date.now() - 5 * 60 * 1000).toISOString();
seed('t_approval', 'pending_plan_approval');
seed('t_signoff', 'pending_human_signoff');
seed('t_running_fresh', 'in_progress', JSON.stringify({ last_heartbeat_at: freshHeartbeat }));
seed('t_running', 'in_progress');
seed('t_remediating', 'remediating');
conn.close();

const result = sdlc.reconcileStaleTasks({ maxAgeMs: 30 * 60 * 1000 }, tmpDb);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

const check = dbmod.getConnection(tmpDb, false);
const statusOf = (id) => (check.prepare('SELECT status FROM sdlc_tasks WHERE id = ?').get(id) || {}).status;

console.log('reconciliation of stale tasks');

test('human-gated approval task is untouched', () => {
  assert.strictEqual(statusOf('t_approval'), 'pending_plan_approval',
    'a task awaiting human approval must never be timed out');
});

test('human-gated signoff task is untouched', () => {
  assert.strictEqual(statusOf('t_signoff'), 'pending_human_signoff',
    'a task awaiting human signoff must never be timed out');
});

test('running task with fresh heartbeat is untouched', () => {
  assert.strictEqual(statusOf('t_running_fresh'), 'in_progress',
    'a task with recent heartbeat must not be timed out even if updated_at is old');
});

test('genuinely stale running task is reconciled', () => {
  assert.strictEqual(statusOf('t_running'), 'timed_out');
});

test('genuinely stale remediating task is reconciled', () => {
  assert.strictEqual(statusOf('t_remediating'), 'timed_out');
});

test('only the two abandoned tasks were reported', () => {
  assert.strictEqual(result.reconciled_count, 2, `got ${result.reconciled_count}`);
  assert.deepStrictEqual([...result.reconciled_ids].sort(), ['t_remediating', 't_running']);
});

test('reconciliation is idempotent', () => {
  const again = sdlc.reconcileStaleTasks({ maxAgeMs: 30 * 60 * 1000 }, tmpDb);
  assert.strictEqual(again.reconciled_count, 0);
  assert.strictEqual(statusOf('t_approval'), 'pending_plan_approval');
  assert.strictEqual(statusOf('t_signoff'), 'pending_human_signoff');
  assert.strictEqual(statusOf('t_running_fresh'), 'in_progress');
});

check.close();
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
