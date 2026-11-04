#!/usr/bin/env node
require('./helpers/isolate_db');
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const dbmod = require('../src/db');
const sdlc = require('../src/workflow/kage-reviewer/sdlc_manager');
const { ingestClientTasks, resetIngestMemo } = require('../src/client_task_ingest');
const { startWebServer } = require('../src/web_server');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Running test_client_task_ingest...');

  const tmpDb = path.join(os.tmpdir(), `konoha-ingest-${Date.now()}.db`);
  const conn = dbmod.getConnection(tmpDb, false);
  dbmod.setupSchema(conn);

  // Seed two active sessions: one omp, one claudecode
  const now = new Date().toISOString();
  conn.prepare(`
    INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
    VALUES (?, ?, ?, ?)
  `).run('omp', '/tmp/repo-alpha', 'sess_omp_101', now);

  conn.prepare(`
    INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
    VALUES (?, ?, ?, ?)
  `).run('claudecode', '/tmp/repo-beta', 'sess_claude_202', now);

  // Seed a pending_plan_approval row older than 30 min (must stay pending_plan_approval)
  const oldTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  conn.prepare(`
    INSERT INTO sdlc_tasks (id, description, status, project_path, session_id, client, created_at, updated_at)
    VALUES ('task_gated_old', 'Human gated task', 'pending_plan_approval', '/tmp/repo-alpha', 'sess_gated', 'omp', ?, ?)
  `).run(oldTime, oldTime);

  // Ingest with force=true
  resetIngestMemo();
  const res1 = ingestClientTasks({ dbPath: tmpDb, force: true });
  assert.strictEqual(res1.ingested_count, 2, 'Should ingest 2 sessions');

  const tasks1 = sdlc.listTasks({}, tmpDb);
  const ompTask = tasks1.find(t => t.id === 'session:sess_omp_101');
  const claudeTask = tasks1.find(t => t.id === 'session:sess_claude_202');
  const gatedTask = tasks1.find(t => t.id === 'task_gated_old');

  assert.ok(ompTask, 'omp session task must exist');
  assert.strictEqual(ompTask.client, 'omp');
  assert.strictEqual(ompTask.status, 'in_progress');
  assert.ok(ompTask.description.includes('repo-alpha'));
  const ompEv = typeof ompTask.evidence === 'object' ? ompTask.evidence : JSON.parse(ompTask.evidence);
  assert.strictEqual(ompEv.source, 'session');

  assert.ok(claudeTask, 'claudecode session task must exist');
  assert.strictEqual(claudeTask.client, 'claudecode');
  assert.strictEqual(claudeTask.status, 'in_progress');
  assert.ok(claudeTask.description.includes('repo-beta'));

  assert.ok(gatedTask, 'gated task must exist');
  assert.strictEqual(gatedTask.status, 'pending_plan_approval', 'pending_plan_approval older than 30m must stay intact');
  console.log('✓ Ingest of omp and claudecode sessions passed');

  // Duplicate prevention: if Konoha task exists with this session_id, do not ingest
  conn.prepare(`
    INSERT INTO sdlc_tasks (id, description, status, project_path, session_id, client, created_at, updated_at)
    VALUES ('task_konoha_existing', 'Real konoha task', 'in_progress', '/tmp/repo-gamma', 'sess_gamma_303', 'cursor', ?, ?)
  `).run(now, now);

  conn.prepare(`
    INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
    VALUES ('cursor', '/tmp/repo-gamma', 'sess_gamma_303', ?)
  `).run(now);

  const resDup = ingestClientTasks({ dbPath: tmpDb, force: true });
  const gammaSessionTask = sdlc.getTask('session:sess_gamma_303', tmpDb);
  assert.strictEqual(gammaSessionTask, null, 'Should not ingest when Konoha task already exists for session');
  console.log('✓ Duplicate prevention passed');

  // Stale/disappeared session auto-close
  conn.prepare("DELETE FROM active_sessions WHERE session_id = 'sess_omp_101'").run();
  const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  conn.prepare("UPDATE active_sessions SET last_active_at = ? WHERE session_id = 'sess_claude_202'").run(staleTime);

  const resClose = ingestClientTasks({ dbPath: tmpDb, force: true });
  assert.ok(resClose.closed_count >= 2, 'Should close both session tasks');

  const ompTaskAfter = sdlc.getTask('session:sess_omp_101', tmpDb);
  assert.strictEqual(ompTaskAfter.status, 'completed', 'Deleted session task should be completed');
  const ompEvAfter = typeof ompTaskAfter.evidence === 'object' ? ompTaskAfter.evidence : JSON.parse(ompTaskAfter.evidence);
  assert.strictEqual(ompEvAfter.source, 'session', 'Evidence source=session must be preserved');

  const claudeTaskAfter = sdlc.getTask('session:sess_claude_202', tmpDb);
  assert.strictEqual(claudeTaskAfter.status, 'completed', 'Stale session task should be completed');
  console.log('✓ Auto-closing disappeared and stale session tasks passed');

  // Memo behavior
  const resMemo = ingestClientTasks({ dbPath: tmpDb, force: false });
  assert.strictEqual(resMemo.memoized, true, 'Subsequent call within 10s should be memoized');
  console.log('✓ 10-second memo behavior passed');

  // Test GET /api/v1/sdlc/tasks via real Web Server
  process.env.KONOHA_DB_PATH = tmpDb;
  dbmod.DB_PATH = tmpDb;
  resetIngestMemo();

  // Re-insert live session for server test
  conn.prepare(`
    INSERT OR REPLACE INTO active_sessions (client, workspace_root, session_id, last_active_at)
    VALUES (?, ?, ?, ?)
  `).run('omp', '/tmp/repo-live', 'sess_live_404', new Date().toISOString());

  const srv = await startWebServer({ port: 1419, host: '127.0.0.1' });
  try {
    const listRes = await request({ hostname: '127.0.0.1', port: 1419, path: '/api/v1/sdlc/tasks', method: 'GET' });
    assert.strictEqual(listRes.status, 200);
    const liveTask = listRes.data.tasks.find(t => t.id === 'session:sess_live_404');
    assert.ok(liveTask, 'GET /api/v1/sdlc/tasks should auto-ingest live session');
    assert.strictEqual(liveTask.client, 'omp');
    assert.strictEqual(liveTask.status, 'in_progress');
    console.log('✓ Web Server GET /api/v1/sdlc/tasks auto-ingest verified');

    // Test POST /api/v1/sdlc/tasks/:id/approve for Gate 1 (pending_plan_approval)
    conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, project_path, created_at, updated_at)
      VALUES ('task_gate1_approval', 'Gate 1 test', 'pending_plan_approval', '/tmp/repo-live', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

    const approve1Res = await request({
      hostname: '127.0.0.1',
      port: 1419,
      path: '/api/v1/sdlc/tasks/task_gate1_approval/approve',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': srv.token }
    });
    assert.strictEqual(approve1Res.status, 200, 'Approve Gate 1 should return 200');
    assert.strictEqual(approve1Res.data.task.status, 'in_progress', 'Gate 1 approval should move to in_progress');
    const ev1 = typeof approve1Res.data.task.evidence === 'object' ? approve1Res.data.task.evidence : JSON.parse(approve1Res.data.task.evidence);
    assert.strictEqual(ev1.approval_action, 'approve_plan');
    console.log('✓ POST /api/v1/sdlc/tasks/:id/approve Gate 1 (plan approval) verified');

    // Test POST /api/v1/sdlc/tasks/:id/approve for Gate 2 (pending_human_signoff)
    conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, project_path, created_at, updated_at)
      VALUES ('task_gate2_signoff', 'Gate 2 test', 'pending_human_signoff', '/tmp/repo-live', ?, ?)
    `).run(new Date().toISOString(), new Date().toISOString());

    const approve2Res = await request({
      hostname: '127.0.0.1',
      port: 1419,
      path: '/api/v1/sdlc/tasks/task_gate2_signoff/approve',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': srv.token }
    });
    assert.strictEqual(approve2Res.status, 200, 'Approve Gate 2 should return 200');
    assert.strictEqual(approve2Res.data.task.status, 'completed', 'Gate 2 sign-off should move to completed');
    const ev2 = typeof approve2Res.data.task.evidence === 'object' ? approve2Res.data.task.evidence : JSON.parse(approve2Res.data.task.evidence);
    assert.strictEqual(ev2.approval_action, 'sign_off');
    console.log('✓ POST /api/v1/sdlc/tasks/:id/approve Gate 2 (human signoff) verified');
  } finally {
    await srv.instance.stop();
  }

  conn.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true });

  console.log('All test_client_task_ingest checks passed cleanly!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
