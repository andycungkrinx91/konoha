#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const { startWebServer } = require('../src/web_server');

async function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('Running test_web_ui tests...');
  const port = process.env.KONOHA_UI_TEST_PORT ? parseInt(process.env.KONOHA_UI_TEST_PORT, 10) : 1409;
  const srv = await startWebServer({ port, host: '127.0.0.1' });
  const token = srv.token;
  console.log('✓ Web server started on port ' + port);

  try {
    // 1. Health endpoint
    const health = await request({ hostname: '127.0.0.1', port, path: '/api/v1/health', method: 'GET' });
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'healthy');
    assert.strictEqual(health.data.port, port);
    assert.ok(health.data.skills_count > 0);
    assert.strictEqual(health.data.agents_count, 7);
    console.log('✓ GET /api/v1/health passed');

    // 2. CSRF rejection without token
    const unauth = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { name: 'unauth-test', port: 9999, provider: 'openai' });
    assert.strictEqual(unauth.status, 403, 'Must reject state-changing request without CSRF token');
    console.log('✓ CSRF 403 rejection without token passed');

    // 3. Bridge CRUD with CSRF token
    const testBridgeName = 'test-web-ui-bridge';
    const create = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, {
      name: testBridgeName,
      port: 19876,
      provider: 'openai',
      enabled: true,
      target_url: 'http://localhost:11434'
    });
    assert.strictEqual(create.status, 201);
    console.log('✓ POST /api/v1/bridges (create) passed');

    // List bridges
    const list = await request({ hostname: '127.0.0.1', port, path: '/api/v1/bridges', method: 'GET' });
    assert.strictEqual(list.status, 200);
    const created = list.data.find(b => b.name === testBridgeName);
    assert.ok(created, 'Created bridge must appear in list');
    console.log('✓ GET /api/v1/bridges passed');

    // Toggle bridge
    const toggle = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges/' + testBridgeName,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, { enabled: false });
    assert.strictEqual(toggle.status, 200);
    console.log('✓ PATCH /api/v1/bridges/:name (toggle) passed');

    // Delete bridge
    const del = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges/' + testBridgeName,
      method: 'DELETE',
      headers: { 'X-Konoha-Web-Token': token }
    });
    assert.strictEqual(del.status, 200);
    console.log('✓ DELETE /api/v1/bridges/:name passed');

    // Bridge status & models
    const bridgeStatus = await request({ hostname: '127.0.0.1', port, path: '/api/v1/bridges/status', method: 'GET' });
    assert.strictEqual(bridgeStatus.status, 200);
    assert.strictEqual(bridgeStatus.data.router_port, 19999);
    assert.strictEqual(typeof bridgeStatus.data.gateway_running, 'boolean');
    assert.ok(Array.isArray(bridgeStatus.data.bridges));
    console.log('✓ GET /api/v1/bridges/status (with gateway & port runtime) passed');

    const bridgeModels = await request({ hostname: '127.0.0.1', port, path: '/api/v1/bridges/models', method: 'GET' });
    assert.strictEqual(bridgeModels.status, 200);
    assert.ok(Array.isArray(bridgeModels.data.models));
    console.log('✓ GET /api/v1/bridges/models passed');

    // 4. Agents endpoint
    const agents = await request({ hostname: '127.0.0.1', port, path: '/api/v1/agents', method: 'GET' });
    assert.strictEqual(agents.status, 200);
    assert.strictEqual(agents.data.length, 7);
    const names = agents.data.map(a => a.name);
    assert.ok(names.includes('sannin'));
    assert.ok(names.includes('genin'));
    assert.ok(names.includes('kage'));
    console.log('✓ GET /api/v1/agents passed');

    // 5. Skills endpoint
    const skills = await request({ hostname: '127.0.0.1', port, path: '/api/v1/skills?limit=5', method: 'GET' });
    assert.strictEqual(skills.status, 200);
    assert.ok(skills.data.length > 0);
    const firstSkillName = skills.data[0].name;

    const skillDetail = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/skills/' + encodeURIComponent(firstSkillName),
      method: 'GET'
    });
    assert.strictEqual(skillDetail.status, 200);
    assert.ok(skillDetail.data.content);
    console.log('✓ GET /api/v1/skills and /api/v1/skills/:name passed');

    // 5b. Skills CRUD (Create, Embed, Unembed, Delete)
    const testSkillSlug = 'test-e2e-skill';
    const createSkill = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/skills',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, {
      name: testSkillSlug,
      description: 'E2E test skill for Web UI',
      tags: 'test, e2e, ninja',
      content: '# E2E Test Skill\nInstructions for test.',
      embed_agent: 'anbu'
    });
    assert.strictEqual(createSkill.status, 201);
    assert.strictEqual(createSkill.data.name, testSkillSlug);
    console.log('✓ POST /api/v1/skills (create) passed');

    const embedSkill = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/skills/${testSkillSlug}/embed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, { agent: 'jonin' });
    assert.strictEqual(embedSkill.status, 200);
    console.log('✓ POST /api/v1/skills/:name/embed passed');

    const unembedSkill = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/skills/${testSkillSlug}/unembed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, { agent: 'jonin' });
    assert.strictEqual(unembedSkill.status, 200);

    const unembedAnbu = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/skills/${testSkillSlug}/unembed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, { agent: 'anbu' });
    assert.strictEqual(unembedAnbu.status, 200);
    console.log('✓ POST /api/v1/skills/:name/unembed passed');

    const deleteSkill = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/v1/skills/${testSkillSlug}`,
      method: 'DELETE',
      headers: {
        'X-Konoha-Web-Token': token
      }
    });
    assert.strictEqual(deleteSkill.status, 200);
    console.log('✓ DELETE /api/v1/skills/:name passed');

    // 6. Savings endpoint
    const savings = await request({ hostname: '127.0.0.1', port, path: '/api/v1/savings', method: 'GET' });
    assert.strictEqual(savings.status, 200);
    assert.ok(savings.data.today);
    console.log('✓ GET /api/v1/savings passed');

    // 6b. Semble endpoints
    const sembleStatus = await request({ hostname: '127.0.0.1', port, path: '/api/v1/semble', method: 'GET' });
    assert.strictEqual(sembleStatus.status, 200);
    assert.strictEqual(sembleStatus.data.name, 'Semble MCP');
    console.log('✓ GET /api/v1/semble passed');

    const sembleSavings = await request({ hostname: '127.0.0.1', port, path: '/api/v1/semble/savings', method: 'GET' });
    assert.strictEqual(sembleSavings.status, 200);
    assert.ok(sembleSavings.data.today);
    console.log('✓ GET /api/v1/semble/savings passed');

    const sembleSearch = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/semble/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': token
      }
    }, { query: 'find_skills', limit: 3 });
    assert.strictEqual(sembleSearch.status, 200);
    assert.ok(Array.isArray(sembleSearch.data.results));
    console.log('✓ POST /api/v1/semble/search passed');

    // 6c. SearXNG Web Search endpoints
    const searchStatus = await request({ hostname: '127.0.0.1', port, path: '/api/v1/search/status', method: 'GET' });
    assert.strictEqual(searchStatus.status, 200);
    assert.strictEqual(searchStatus.data.provider, 'SearXNG Multi-Source Chain');
    assert.strictEqual(searchStatus.data.zero_api_key, true);
    console.log('✓ GET /api/v1/search/status passed');

    const searchLogs = await request({ hostname: '127.0.0.1', port, path: '/api/v1/search/logs', method: 'GET' });
    assert.strictEqual(searchLogs.status, 200);
    assert.ok(Array.isArray(searchLogs.data.logs));
    console.log('✓ GET /api/v1/search/logs passed');

    // 7. Doctor endpoint
    const doc = await request({ hostname: '127.0.0.1', port, path: '/api/v1/doctor', method: 'GET' });
    assert.strictEqual(doc.status, 200);
    assert.ok(doc.data.results.length > 0);
    console.log('✓ GET /api/v1/doctor passed');

    // 8. Clients endpoint
    const clients = await request({ hostname: '127.0.0.1', port, path: '/api/v1/clients', method: 'GET' });
    assert.strictEqual(clients.status, 200);
    assert.strictEqual(clients.data.length, 7);
    assert.ok(clients.data.some(c => c.id === 'pi' && c.name === 'Pi (pi.dev)'));
    console.log('✓ GET /api/v1/clients passed (7 clients incl. Pi)');

    // 9. Static UI HTML — CSRF token must NOT be rendered into the page source
    //    (HttpOnly cookie + GET /api/v1/csrf are the only delivery channels).
    //    The root route 307-redirects to /dashboard; the served page must stay clean.
    const rootRes = await request({ hostname: '127.0.0.1', port, path: '/', method: 'GET' });
    assert.strictEqual(rootRes.status, 307, 'root must redirect to the dashboard');
    const htmlRes = await request({ hostname: '127.0.0.1', port, path: '/dashboard', method: 'GET' });
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(typeof htmlRes.data === 'string');
    assert.ok(!htmlRes.data.includes(token), 'session token must not appear in HTML body');
    assert.ok(!/<meta[^>]+konoha-web-token/.test(htmlRes.data), 'konoha-web-token meta tag must not be injected');
    console.log('✓ Static SPA serving (dashboard redirect) without CSRF token leakage passed');

  } finally {
    await srv.instance.stop();
    console.log('✓ Server stopped');
  }

  // 10. Test CLI daemon commands
  const { execSync } = require('child_process');
  const cliPath = require('path').join(__dirname, '..', 'bin', 'cli.js');
  
  execSync(`node "${cliPath}" ui start --port=1405 --no-open`, { stdio: 'pipe' });
  const statusOut = execSync(`node "${cliPath}" ui status --port=1405`, { stdio: 'pipe' }).toString();
  assert.ok(statusOut.includes('RUNNING') || statusOut.includes('1405'), 'UI status must report running');

  execSync(`node "${cliPath}" ui stop --port=1405`, { stdio: 'pipe' });
  const stoppedOut = execSync(`node "${cliPath}" ui status --port=1405`, { stdio: 'pipe' }).toString();
  assert.ok(stoppedOut.includes('STOPPED'), 'UI status must report stopped');
  console.log('✓ CLI ui start/status/stop commands passed');

  // 11. Test CLI build command
  execSync(`node "${cliPath}" ui build`, { stdio: 'pipe' });
  assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'apps', 'web', 'build', 'index.js')), 'Production build artifact must exist');
  console.log('✓ CLI ui build command passed');

  console.log('\nAll test_web_ui tests passed successfully!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
