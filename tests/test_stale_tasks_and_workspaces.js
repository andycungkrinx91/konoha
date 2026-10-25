#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const db = require('../src/db');
const sdlc = require('../src/sdlc_manager');

async function run() {
  console.log('Running test_stale_tasks_and_workspaces...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_stale_ws_'));
  const testDb = path.join(tmpDir, 'test.db');
  const origDb = db.DB_PATH;
  db.DB_PATH = testDb;

  try {
    const conn = db.getConnection(testDb);
    db.setupSchema(conn);

    // 1. Test Stale Task Reconciliation
    const now = Date.now();
    const staleTime = new Date(now - 3600 * 1000).toISOString(); // 1 hour ago
    const freshTime = new Date(now - 60 * 1000).toISOString();   // 1 minute ago

    conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('task_stale_1', 'Stale task that crashed', 'in_progress', staleTime, staleTime);

    conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('task_fresh_1', 'Fresh live task', 'in_progress', freshTime, freshTime);

    const recResult = sdlc.reconcileStaleTasks({ maxAgeMs: 30 * 60 * 1000 }, testDb);
    assert.strictEqual(recResult.reconciled_count, 1, 'Exactly one stale task must be reconciled');
    assert.deepStrictEqual(recResult.reconciled_ids, ['task_stale_1']);

    const staleTask = sdlc.getTask('task_stale_1', testDb);
    assert.strictEqual(staleTask.status, 'timed_out', 'Stale task status must be reconciled to timed_out');

    const freshTask = sdlc.getTask('task_fresh_1', testDb);
    assert.strictEqual(freshTask.status, 'in_progress', 'Live task status must remain in_progress');
    console.log('✓ Stale task reconciliation logic passed');

    // 2. Test Active Workspaces Aggregation Across OMP, Claude, and Antigravity
    const wsOmp = path.join(tmpDir, 'workspace-omp');
    const wsClaude = path.join(tmpDir, 'workspace-claude');
    const wsAgy = path.join(tmpDir, 'workspace-agy');

    fs.mkdirSync(wsOmp, { recursive: true });
    fs.mkdirSync(wsClaude, { recursive: true });
    fs.mkdirSync(wsAgy, { recursive: true });

    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
      VALUES (?, ?, ?, ?)
    `).run('omp', wsOmp, 'sess_omp_1', new Date(now - 10000).toISOString());

    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
      VALUES (?, ?, ?, ?)
    `).run('claude', wsClaude, 'sess_claude_1', new Date(now - 20000).toISOString());

    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, last_active_at)
      VALUES (?, ?, ?, ?)
    `).run('antigravity', wsAgy, 'sess_agy_1', new Date(now - 30000).toISOString());

    conn.close();

    // Verify /api/v1/projects/current returns all active workspaces
    const serverMod = require('../src/web/controllers/skills_controller');
    const { handleSkillsRoutes } = serverMod;

    let resBody = null;
    let resStatus = 0;
    const mockRes = {
      writeHead: (st) => { resStatus = st; },
      end: (data) => { resBody = JSON.parse(data); },
      setHeader: () => {}
    };

    const mockReq = { method: 'GET', url: '/api/v1/projects/current' };
    const parsedUrl = new URL('http://localhost:1404/api/v1/projects/current');

    await handleSkillsRoutes(mockReq, mockRes, { broadcastEvent: () => {} }, parsedUrl, '/api/v1/projects/current', 'GET');

    assert.strictEqual(resStatus, 200);
    assert.ok(resBody && Array.isArray(resBody.active_workspaces), 'Response must have active_workspaces array');
    assert.strictEqual(resBody.active_workspaces.length, 3, 'All 3 client workspaces must be aggregated');

    const clients = resBody.active_workspaces.map(w => w.client);
    assert.ok(clients.includes('omp'), 'Must include omp active workspace');
    assert.ok(clients.includes('claude'), 'Must include claude active workspace');
    assert.ok(clients.includes('antigravity'), 'Must include antigravity active workspace');

    console.log('✓ Multi-client workspace aggregation passed across OMP, Claude, and Antigravity');
    console.log('\nAll tests in test_stale_tasks_and_workspaces passed!');
  } finally {
    db.DB_PATH = origDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
