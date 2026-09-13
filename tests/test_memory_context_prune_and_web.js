#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

/**
 * tests/test_memory_context_prune_and_web.js
 * End-to-end integration tests for:
 * 1. Project memory context 1-by-1 deletion
 * 2. Project memory context pruning (all and filtered)
 * 3. Web API endpoints (/api/v1/projects/:hash/memories/:id, /api/v1/projects/:hash/prune, /api/v1/savings)
 * 4. Faithful frontend & TUI savings metrics parity with zero fake percentage fallbacks
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const personaMemory = require('../src/persona_memory');
const db = require('../src/db');
const { startWebServer } = require('../src/web_server');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });
    req.on('error', reject);
    if (postData) {
      if (typeof postData === 'object') {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function run() {
  console.log('Running test_memory_context_prune_and_web tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem_prune_test_'));
  const testDbPath = path.join(tmpDir, 'test_konoha.db');
  personaMemory.DB_PATH = testDbPath;
  db.DB_PATH = testDbPath;

  let srv = null;
  const originalDbPath = db.DB_PATH;

  try {
    const mockProjectPath = path.join(tmpDir, 'mock_app');
    fs.mkdirSync(mockProjectPath, { recursive: true });

    // 1. Save project profile
    const projHash = personaMemory.saveOrUpdateProject(mockProjectPath, 'Always use Tailwind v4 and pnpm', null, testDbPath);
    assert.ok(projHash, 'Project hash should be generated');

    // 2. Add multiple project memory items
    const id1 = personaMemory.saveMemory({
      agentName: 'jonin',
      content: 'Learning 1: Use CSS variables for theme switching',
      title: 'Theme Switching Rule',
      memoryType: 'rule',
      importance: 3,
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });

    const id2 = personaMemory.saveMemory({
      agentName: 'anbu',
      content: 'Learning 2: Enable WAL mode for high concurrency',
      title: 'Database Rule',
      memoryType: 'rule',
      importance: 5,
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });

    const id3 = personaMemory.saveMemory({
      agentName: 'kage',
      content: 'Learning 3: Keep confidence gate above 97 percent',
      title: 'Audit Rule',
      memoryType: 'pattern',
      importance: 8,
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });

    assert.ok(id1 && id2 && id3, 'All 3 memory IDs should be generated');

    let mems = personaMemory.listMemories({ projectPath: mockProjectPath, dbPath: testDbPath });
    assert.strictEqual(mems.length, 3, 'Should have 3 memories for project');

    // 3. Test deleting memory context 1 by 1
    const deletedSingle = personaMemory.deleteMemory(String(id1), testDbPath);
    assert.strictEqual(deletedSingle, true, 'deleteMemory should return true for existing ID');

    mems = personaMemory.listMemories({ projectPath: mockProjectPath, dbPath: testDbPath });
    assert.strictEqual(mems.length, 2, 'Should have 2 memories remaining after deleting 1');
    assert.ok(!mems.some(m => m.id === id1), 'Deleted memory should not be present');

    // 4. Test pruning project memories with filters
    // Add another item with importance 2
    personaMemory.saveMemory({
      agentName: 'genin',
      content: 'Learning 4: Low importance observation',
      memoryType: 'observation',
      importance: 2,
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });

    mems = personaMemory.listMemories({ projectPath: mockProjectPath, dbPath: testDbPath });
    assert.strictEqual(mems.length, 3, 'Should have 3 memories now');

    // Prune where importance <= 2
    const pruneRes = personaMemory.pruneProjectMemories(projHash, { minImportance: 2 }, testDbPath);
    assert.strictEqual(pruneRes.deleted, 1, 'Should have pruned 1 item with importance <= 2');

    mems = personaMemory.listMemories({ projectPath: mockProjectPath, dbPath: testDbPath });
    assert.strictEqual(mems.length, 2, 'Should have 2 memories left');

    // Prune all remaining for this project
    const pruneAllRes = personaMemory.pruneProjectMemories(projHash, {}, testDbPath);
    assert.strictEqual(pruneAllRes.deleted, 2, 'Should have pruned all remaining memories for project');

    mems = personaMemory.listMemories({ projectPath: mockProjectPath, dbPath: testDbPath });
    assert.strictEqual(mems.length, 0, 'Project memories should now be completely empty');

    // Architectural invariants must be preserved
    const profile = personaMemory.getProjectProfile(projHash, testDbPath);
    assert.ok(profile, 'Project profile should still exist');
    assert.strictEqual(profile.context_summary, 'Always use Tailwind v4 and pnpm');

    // 5. Test Web Server API Endpoints
    const port = 14199;
    srv = await startWebServer({ port, host: '127.0.0.1' });
    const token = srv.token;
    const authHeaders = { 'Content-Type': 'application/json', 'X-Konoha-Web-Token': token };

    // Add 2 memories for API testing
    const apiMemId1 = personaMemory.saveMemory({
      agentName: 'jonin',
      content: 'API Test Learning 1',
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });
    personaMemory.saveMemory({
      agentName: 'anbu',
      content: 'API Test Learning 2',
      projectPath: mockProjectPath,
      dbPath: testDbPath
    });

    // Test API: Delete 1-by-1 via DELETE /api/v1/projects/:hash/memories/:id
    const delApiRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/projects/${projHash}/memories/${apiMemId1}`,
      method: 'DELETE',
      headers: authHeaders
    });
    assert.strictEqual(delApiRes.status, 200, 'DELETE /api/v1/projects/:hash/memories/:id should return 200');
    assert.strictEqual(delApiRes.data.deleted, true, 'API response should report deleted: true');

    // Test API: Prune via POST /api/v1/projects/:hash/prune
    const pruneApiRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/projects/${projHash}/prune`,
      method: 'POST',
      headers: authHeaders
    }, {});
    assert.strictEqual(pruneApiRes.status, 200, 'POST /api/v1/projects/:hash/prune should return 200');
    assert.strictEqual(pruneApiRes.data.deleted, 1, 'API prune should report 1 deleted item');

    // Test API: Prune with clearInvariants: true
    const pruneInvRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/projects/${projHash}/prune`,
      method: 'POST',
      headers: authHeaders
    }, { clearInvariants: true });
    assert.strictEqual(pruneInvRes.status, 200, 'POST prune with clearInvariants should return 200');
    assert.strictEqual(pruneInvRes.data.invariants_cleared, true, 'invariants_cleared should be true');

    const profAfterPrune = personaMemory.getProjectProfile(projHash, testDbPath);
    assert.strictEqual(profAfterPrune.context_summary, '', 'context_summary should be cleared');

    // Test API: DELETE /api/v1/projects (prune all registered workspaces)
    const pruneAllWsRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/projects',
      method: 'DELETE',
      headers: authHeaders
    });
    assert.strictEqual(pruneAllWsRes.status, 200, 'DELETE /api/v1/projects should return 200');
    assert.ok(pruneAllWsRes.data.deleted >= 1, 'Should report at least 1 deleted project');

    const allProjectsAfter = personaMemory.listProjects(testDbPath);
    assert.strictEqual(allProjectsAfter.length, 0, 'All projects should be pruned');

    // Test API: GET /api/v1/savings has combined metrics and NO fake defaults
    const savingsApiRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/savings',
      method: 'GET',
      headers: authHeaders
    });
    assert.strictEqual(savingsApiRes.status, 200, 'GET /api/v1/savings should return 200');
    assert.ok(savingsApiRes.data.combined, 'Response must include combined savings object');
    assert.ok(savingsApiRes.data.combined.today, 'Combined must include today stats');
    assert.ok(savingsApiRes.data.combined.last_7_days, 'Combined must include last_7_days stats');
    assert.ok(savingsApiRes.data.combined.all_time, 'Combined must include all_time stats');

    // Verify no fake 97% default when there are 0 calls in an empty DB
    if (savingsApiRes.data.today.calls === 0) {
      assert.strictEqual(savingsApiRes.data.today.pct_saved, 0, 'pct_saved must be 0% when there are 0 calls (no fake 97% default)');
    }

    console.log('✅ All memory context prune & web integration tests passed successfully!');
  } finally {
    if (srv && srv.instance) {
      await srv.instance.stop();
    }
    personaMemory.DB_PATH = originalDbPath;
    db.DB_PATH = originalDbPath;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
