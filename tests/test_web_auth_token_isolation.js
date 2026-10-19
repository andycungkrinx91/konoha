// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const http = require('http');
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
    if (body !== null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const port = 1428;
  const srv = await startWebServer({ port, host: '127.0.0.1' });

  try {
    // 1. Verify GET /api/v1/auth/status does not leak session token
    const statusRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/status',
      method: 'GET'
    });
    assert.strictEqual(statusRes.status, 200, 'auth/status must return 200');
    assert.strictEqual(statusRes.data.token, undefined, 'auth/status must NOT return token');
    assert.strictEqual(typeof statusRes.data.authenticated, 'boolean');

    // 2. Verify GET /api/v1/auth/session does not leak session token
    const sessionRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/session',
      method: 'GET'
    });
    assert.strictEqual(sessionRes.status, 200, 'auth/session must return 200');
    assert.strictEqual(sessionRes.data.token, undefined, 'auth/session must NOT return token');

    // 3. Verify unauthenticated GET /api/v1/health returns only minimal metadata
    const unauthHealth = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/health',
      method: 'GET'
    });
    assert.strictEqual(unauthHealth.status, 200, 'health must return 200');
    assert.strictEqual(unauthHealth.data.status, 'healthy');
    assert.ok(unauthHealth.data.version);
    assert.strictEqual(unauthHealth.data.db_path, undefined, 'unauth health must not include db_path');
    assert.strictEqual(unauthHealth.data.port, undefined, 'unauth health must not include port');
    assert.strictEqual(unauthHealth.data.skills_count, undefined, 'unauth health must not include skills_count');

    // 4. Verify authenticated GET /api/v1/health includes full diagnostic metadata
    const authHealth = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/health',
      method: 'GET',
      headers: {
        'X-Konoha-Web-Token': srv.token
      }
    });
    assert.strictEqual(authHealth.status, 200, 'authenticated health must return 200');
    assert.strictEqual(authHealth.data.status, 'healthy');
    assert.ok(authHealth.data.db_path, 'authenticated health must include db_path');
    assert.strictEqual(authHealth.data.port, port, 'authenticated health must include port');
    assert.strictEqual(typeof authHealth.data.skills_count, 'number');

    console.log('✓ test_web_auth_token_isolation passed');
  } finally {
    if (srv && srv.instance && srv.instance.stop) {
      await srv.instance.stop();
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
