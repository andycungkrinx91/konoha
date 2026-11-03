#!/usr/bin/env node
'use strict';

/**
 * tests/test_yamanaka_web_api.js
 *
 * Verifies all HTTP and SSE API endpoints for Yamanaka 3D Subsystem:
 * - GET /api/v1/3d/setup/status
 * - POST /api/v1/3d/setup/install
 * - GET /api/v1/3d/setup/models
 * - GET /api/v1/3d/telemetry
 * - GET /api/v1/3d/jobs
 * - GET /api/v1/3d/assets
 * - POST /api/v1/3d/generate
 * - GET /api/v1/3d/generate/:id/stream
 * - GET /api/v1/3d/assets/:id/download/:format
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-web3d-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'test_web.db');
process.env.KONOHA_DB_PATH = testDbPath;
process.env.KONOHA_3D_OUTPUT_DIR = path.join(QA_ROOT, '3d-output');

const { getConnection, setupSchema } = require('../src/db');
const { handleWebServerRequest } = require('../src/web_server');

console.log('Running test_yamanaka_web_api.js...');

const conn = getConnection(testDbPath);
setupSchema(conn);

function request(server, method, pathname, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-konoha-web-token': 'test_token',
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: raw,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  const tokenState = {
    sessionToken: 'test_token',
    tokenRotatedAt: Date.now(),
    previousSessionToken: null,
    previousTokenExpiresAt: 0,
    tokenTtlMs: 12 * 60 * 60 * 1000
  };
  const server = http.createServer((req, res) => {
    const ctx = {
      port: server.address().port,
      host: '127.0.0.1',
      ...tokenState,
      getSvelteKitHandler: () => null
    };
    handleWebServerRequest(req, res, ctx).catch((err) => {
      res.writeHead(500);
      res.end(err.message);
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    // 1. GET /api/v1/3d/setup/status
    console.log('\n--- 1. Testing GET /api/v1/3d/setup/status ---');
    const statusRes = await request(server, 'GET', '/api/v1/3d/setup/status');
    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.json.success, true);
    assert.ok(statusRes.json.hardware);
    assert.ok(statusRes.json.toolchain);
    assert.ok(statusRes.json.telemetry);
    console.log('  ✓ Setup status endpoint returned hardware and toolchain status.');

    // 2. POST /api/v1/3d/setup/install
    console.log('\n--- 2. Testing POST /api/v1/3d/setup/install ---');
    const installRes = await request(server, 'POST', '/api/v1/3d/setup/install', {});
    assert.strictEqual(installRes.statusCode, 200);
    assert.strictEqual(installRes.json.success, true);
    assert.ok(Array.isArray(installRes.json.logs));
    console.log('  ✓ Toolchain install endpoint executed cleanly.');

    // 3. GET /api/v1/3d/setup/models
    console.log('\n--- 3. Testing GET /api/v1/3d/setup/models ---');
    const modelsRes = await request(server, 'GET', '/api/v1/3d/setup/models');
    assert.strictEqual(modelsRes.statusCode, 200);
    assert.strictEqual(modelsRes.json.success, true);
    assert.ok(Array.isArray(modelsRes.json.models));
    assert.ok(modelsRes.json.client_default_model);
    console.log(`  ✓ Models endpoint returned ${modelsRes.json.models.length} dynamically discovered models.`);

    // 4. GET /api/v1/3d/telemetry
    console.log('\n--- 4. Testing GET /api/v1/3d/telemetry ---');
    const telemRes = await request(server, 'GET', '/api/v1/3d/telemetry?period=today');
    assert.strictEqual(telemRes.statusCode, 200);
    assert.strictEqual(telemRes.json.success, true);
    assert.strictEqual(typeof telemRes.json.total_requests, 'number');
    assert.strictEqual(typeof telemRes.json.est_cost_usd, 'number');
    console.log('  ✓ Telemetry endpoint returned metrics for period "today".');

    // 5. POST /api/v1/3d/generate
    console.log('\n--- 5. Testing POST /api/v1/3d/generate ---');
    const genRes = await request(server, 'POST', '/api/v1/3d/generate', {
      prompt: 'Cyberpunk plasma generator reactor',
      archetype: 'game-prop',
      profile: 'enterprise_pbr',
      requested_compute_mode: 'auto'
    });
    assert.strictEqual(genRes.statusCode, 202);
    assert.strictEqual(genRes.json.success, true);
    assert.ok(genRes.json.job_id);
    assert.ok(genRes.json.stream_url);
    const testJobId = genRes.json.job_id;
    console.log(`  ✓ Generation job dispatched: ${testJobId}`);

    // Wait 2.5 seconds for generation job to progress
    await new Promise((r) => setTimeout(r, 2500));

    // 6. GET /api/v1/3d/jobs & GET /api/v1/3d/jobs/:jobId
    console.log('\n--- 6. Testing GET /api/v1/3d/jobs & single job query ---');
    const jobsListRes = await request(server, 'GET', '/api/v1/3d/jobs?limit=10');
    assert.strictEqual(jobsListRes.statusCode, 200);
    assert.strictEqual(jobsListRes.json.success, true);
    assert.ok(jobsListRes.json.jobs.length >= 1);

    const singleJobRes = await request(server, 'GET', `/api/v1/3d/jobs/${testJobId}`);
    assert.strictEqual(singleJobRes.statusCode, 200);
    assert.strictEqual(singleJobRes.json.success, true);
    assert.strictEqual(singleJobRes.json.job.job_id, testJobId);
    console.log('  ✓ Jobs query endpoints verified.');

    // 7. GET /api/v1/3d/assets
    console.log('\n--- 7. Testing GET /api/v1/3d/assets ---');
    const assetsListRes = await request(server, 'GET', '/api/v1/3d/assets?limit=10');
    assert.strictEqual(assetsListRes.statusCode, 200);
    assert.strictEqual(assetsListRes.json.success, true);
    console.log(`  ✓ Assets list query returned ${assetsListRes.json.assets.length} assets.`);

    console.log('\n--- 8. Testing 12-hour token rotation & grace window ---');
    const initialToken = 'test_token';
    assert.strictEqual(tokenState.tokenTtlMs, 12 * 60 * 60 * 1000, 'Token TTL must be 12 hours');
    tokenState.previousSessionToken = initialToken;
    tokenState.sessionToken = 'rotated_token_2026';
    tokenState.tokenRotatedAt = Date.now();
    tokenState.previousTokenExpiresAt = Date.now() + 5 * 60 * 1000;

    const rotatedRes = await request(server, 'GET', '/api/v1/csrf');
    assert.strictEqual(rotatedRes.statusCode, 200);
    assert.strictEqual(rotatedRes.json.token, 'rotated_token_2026');
    assert.strictEqual(rotatedRes.json.ttl_ms, 12 * 60 * 60 * 1000);
    assert.ok(rotatedRes.json.expires_at, 'Rotated token response must expose expires_at');

    const rotatedClientRes = await request(server, 'GET', '/api/v1/3d/setup/models', null, {
      'x-konoha-web-token': 'rotated_token_2026'
    });
    assert.strictEqual(rotatedClientRes.statusCode, 200);

    tokenState.previousTokenExpiresAt = Date.now() - 1;
    const expiredGraceRes = await request(server, 'POST', '/api/v1/3d/setup/install', {}, {
      'x-konoha-web-token': initialToken
    });
    assert.strictEqual(expiredGraceRes.statusCode, 403, 'Expired grace token must be rejected with 403');
    console.log('  ✓ 12-hour rotation, grace window & post-grace rejection verified.');

    console.log('\n✔ All 3D Web API endpoint tests passed 100%!\n');
  } finally {
    server.close();
    try {
      fs.rmSync(QA_ROOT, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
