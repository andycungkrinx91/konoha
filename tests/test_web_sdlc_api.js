// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * E2E tests for the SDLC governance HTTP API exposed by web_server.js.
 * Covers the endpoints backing the dashboard "SDLC Tasks" screen:
 *   - GET  /api/v1/sdlc/tasks
 *   - GET  /api/v1/sdlc/tasks/:id
 *   - POST /api/v1/sdlc/check-readiness
 *   - GET  /api/v1/sdlc/config
 *   - PATCH /api/v1/sdlc/config
 * Follows the test_web_ui.js pattern (startWebServer + srv.token for CSRF).
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
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
  const port = process.env.KONOHA_SDLC_TEST_PORT ? parseInt(process.env.KONOHA_SDLC_TEST_PORT, 10) : 1417;
  const srv = await startWebServer({ port, host: '127.0.0.1' });
  const token = srv.token;
  const base = { hostname: '127.0.0.1', port };
  const authHeaders = { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': token };
  const repoRoot = path.join(__dirname, '..');

  try {
    // 1. GET /api/v1/sdlc/tasks — list shape { tasks, count }
    const listRes = await request({ ...base, path: '/api/v1/sdlc/tasks', method: 'GET' });
    assert.strictEqual(listRes.status, 200, 'GET tasks must return 200');
    assert.ok(Array.isArray(listRes.data.tasks), 'tasks must be an array');
    assert.strictEqual(listRes.data.count, listRes.data.tasks.length, 'count must match tasks.length');
    for (const t of listRes.data.tasks) {
      assert.ok(t.id && typeof t.id === 'string', 'task rows must expose id');
      assert.ok(typeof t.status === 'string', 'task rows must expose status');
      assert.ok(typeof t.dor_result === 'object' && t.dor_result !== null, 'dor_result must be parsed JSON');
    }
    console.log(`✓ GET /api/v1/sdlc/tasks passed (${listRes.data.count} tasks, parsed dor_result)`);

    // 2. GET /api/v1/sdlc/tasks/:id — bogus id → 404
    const notFoundRes = await request({ ...base, path: '/api/v1/sdlc/tasks/task_does_not_exist_xyz', method: 'GET' });
    assert.strictEqual(notFoundRes.status, 404, 'bogus task id must return 404');
    assert.ok(notFoundRes.data.error, '404 must include error message');
    console.log('✓ GET /api/v1/sdlc/tasks/:id 404 passed');

    // 3. GET /api/v1/sdlc/tasks/ (empty id) → 400
    const emptyIdRes = await request({ ...base, path: '/api/v1/sdlc/tasks/', method: 'GET' });
    assert.strictEqual(emptyIdRes.status, 400, 'empty task id must return 400');
    assert.ok(emptyIdRes.data.error, '400 must include error message');
    console.log('✓ GET /api/v1/sdlc/tasks/ (empty id) 400 passed');

    // 4. POST /api/v1/sdlc/check-readiness WITHOUT token → CSRF rejection
    const csrfRes = await request(
      { ...base, path: '/api/v1/sdlc/check-readiness', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { task: 'x' }
    );
    assert.strictEqual(csrfRes.status, 403, 'unauthenticated POST must be rejected by CSRF gate');
    console.log('✓ POST /api/v1/sdlc/check-readiness CSRF gate passed');

    // 5. POST /api/v1/sdlc/check-readiness — ready task (references real repo file)
    const readyRes = await request(
      { ...base, path: '/api/v1/sdlc/check-readiness', method: 'POST', headers: authHeaders },
      { task: `Add unit tests for src/sdlc_manager.js covering the checkReadiness validation logic`, project_path: repoRoot }
    );
    assert.strictEqual(readyRes.status, 200, 'check-readiness must return 200');
    assert.ok(typeof readyRes.data.ready === 'boolean', 'ready must be boolean');
    assert.ok(Array.isArray(readyRes.data.missing), 'missing must be an array');
    assert.ok(['high', 'medium', 'low'].includes(readyRes.data.confidence), 'confidence must be high|medium|low');
    console.log(`✓ POST /api/v1/sdlc/check-readiness passed (ready=${readyRes.data.ready}, confidence=${readyRes.data.confidence})`);

    // 6. POST /api/v1/sdlc/check-readiness — substance check (too-short task)
    const shortRes = await request(
      { ...base, path: '/api/v1/sdlc/check-readiness', method: 'POST', headers: authHeaders },
      { task: 'fix it', project_path: repoRoot }
    );
    assert.strictEqual(shortRes.status, 200);
    assert.strictEqual(shortRes.data.ready, false, 'insubstantial task must not be ready');
    assert.ok(shortRes.data.missing.length > 0, 'insubstantial task must list missing criteria');
    console.log('✓ POST /api/v1/sdlc/check-readiness DoR substance check passed');

    // 7. GET /api/v1/sdlc/config — shape { project_path, dor_mode, review_mode }
    const cfgRes = await request({ ...base, path: `/api/v1/sdlc/config?project=${encodeURIComponent(repoRoot)}`, method: 'GET' });
    assert.strictEqual(cfgRes.status, 200, 'GET config must return 200');
    assert.ok(['advisory', 'enforced'].includes(cfgRes.data.dor_mode), 'dor_mode must be advisory|enforced');
    assert.ok(['self', 'cross-provider', 'cross_provider'].includes(cfgRes.data.review_mode), 'review_mode must be a known mode');
    console.log(`✓ GET /api/v1/sdlc/config passed (dor_mode=${cfgRes.data.dor_mode}, review_mode=${cfgRes.data.review_mode})`);

    // 8. PATCH /api/v1/sdlc/config WITHOUT token → CSRF rejection
    const cfgCsrfRes = await request(
      { ...base, path: '/api/v1/sdlc/config', method: 'PATCH', headers: { 'Content-Type': 'application/json' } },
      { project_path: repoRoot, dor_mode: 'advisory' }
    );
    assert.strictEqual(cfgCsrfRes.status, 403, 'unauthenticated PATCH must be rejected by CSRF gate');
    console.log('✓ PATCH /api/v1/sdlc/config CSRF gate passed');

    // 9. PATCH /api/v1/sdlc/config — persist and read back (unique temp project path to avoid touching real config)
    const testProject = `/tmp/konoha-sdlc-test-${Date.now()}`;
    const patchRes = await request(
      { ...base, path: '/api/v1/sdlc/config', method: 'PATCH', headers: authHeaders },
      { project_path: testProject, dor_mode: 'enforced', review_mode: 'cross-provider' }
    );
    assert.strictEqual(patchRes.status, 200, 'PATCH config must return 200');
    assert.strictEqual(patchRes.data.dor_mode, 'enforced', 'PATCH must echo normalized dor_mode');
    assert.strictEqual(patchRes.data.review_mode, 'cross-provider', 'PATCH must echo normalized review_mode');

    const rereadRes = await request({ ...base, path: `/api/v1/sdlc/config?project=${encodeURIComponent(testProject)}`, method: 'GET' });
    assert.strictEqual(rereadRes.status, 200);
    assert.strictEqual(rereadRes.data.dor_mode, 'enforced', 'PATCHed dor_mode must persist');
    assert.strictEqual(rereadRes.data.review_mode, 'cross-provider', 'PATCHed review_mode must persist');
    console.log('✓ PATCH /api/v1/sdlc/config + read-back passed (enforced / cross-provider)');

    // 10. PATCH with invalid mode values → must normalize, not crash
    const normRes = await request(
      { ...base, path: '/api/v1/sdlc/config', method: 'PATCH', headers: authHeaders },
      { project_path: testProject, dor_mode: 'hard-mandatory', review_mode: 'nonsense-mode' }
    );
    assert.strictEqual(normRes.status, 200, 'PATCH with unknown modes must normalize, not fail');
    assert.ok(['advisory', 'enforced'].includes(normRes.data.dor_mode), 'normalized dor_mode must be valid');
    console.log(`✓ PATCH /api/v1/sdlc/config normalization passed (hard-mandatory → ${normRes.data.dor_mode})`);

    // 11. DELETE /api/v1/sdlc/tasks/:id WITHOUT token → CSRF rejection
    const delNoToken = await request({ ...base, path: '/api/v1/sdlc/tasks/some_task', method: 'DELETE' });
    assert.strictEqual(delNoToken.status, 403, 'unauthenticated DELETE must be rejected by CSRF gate');
    console.log('✓ DELETE /api/v1/sdlc/tasks/:id CSRF gate passed');

    // 12. Create a test task, delete by ID, and verify 404 on re-deletion
    const sdlcManager = require('../src/sdlc_manager');
    const apiTestTask = sdlcManager.createTask({
      id: 'task_api_delete_me_1',
      description: 'API delete test task',
      status: 'pending'
    });
    assert.ok(apiTestTask, 'Test task must be created');

    const delRes = await request({
      ...base,
      path: `/api/v1/sdlc/tasks/${encodeURIComponent(apiTestTask.id)}`,
      method: 'DELETE',
      headers: authHeaders
    });
    assert.strictEqual(delRes.status, 200, 'DELETE task by ID must return 200');
    assert.strictEqual(delRes.data.ok, true, 'DELETE response must have ok: true');
    assert.strictEqual(delRes.data.id, apiTestTask.id, 'DELETE response must echo task id');

    const del404Res = await request({
      ...base,
      path: `/api/v1/sdlc/tasks/${encodeURIComponent(apiTestTask.id)}`,
      method: 'DELETE',
      headers: authHeaders
    });
    assert.strictEqual(del404Res.status, 404, 'Deleting already-deleted task must return 404');
    console.log('✓ DELETE /api/v1/sdlc/tasks/:id passed (200 success + 404 on subsequent delete)');

    // 13. Bulk DELETE /api/v1/sdlc/tasks?all=true
    sdlcManager.createTask({ id: 'task_api_bulk_1', description: 'Bulk 1' });
    sdlcManager.createTask({ id: 'task_api_bulk_2', description: 'Bulk 2' });
    const bulkDelRes = await request({
      ...base,
      path: '/api/v1/sdlc/tasks?all=true',
      method: 'DELETE',
      headers: authHeaders
    });
    assert.strictEqual(bulkDelRes.status, 200, 'DELETE /api/v1/sdlc/tasks?all=true must return 200');
    assert.strictEqual(bulkDelRes.data.ok, true, 'Bulk delete must report ok: true');
    assert.ok(bulkDelRes.data.deleted >= 2, 'Bulk delete must delete at least 2 tasks');
    console.log(`✓ DELETE /api/v1/sdlc/tasks?all=true passed (deleted ${bulkDelRes.data.deleted} tasks)`);

  } finally {
    await srv.instance.stop();
    console.log('✓ Server stopped');
  }

  console.log('\nAll test_web_sdlc_api tests passed successfully!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
