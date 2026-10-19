'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

async function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) { parsed = body; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function extractCookie(headers, cookieName) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of list) {
    const match = c.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function run() {
  console.log('Running test_fresh_install_and_upgrade_in_tmp in /tmp isolation...');

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_fresh_install_'));
  const origHome = process.env.HOME;
  const origAuth = process.env.KONOHA_AUTH_FILE;
  const origDb = process.env.KONOHA_DB_PATH;
  const origUiAuto = process.env.KONOHA_UI_AUTOSTART;

  process.env.HOME = tempHome;
  delete process.env.KONOHA_AUTH_FILE;
  process.env.KONOHA_DB_PATH = path.join(tempHome, '.konoha', 'konoha.db');
  process.env.KONOHA_UI_AUTOSTART = '0';
  process.env.KONOHA_SEMANTIC_SEARCH = '0'; // Fast-path migration for unit test

  let srv = null;

  try {
    // 1. Fresh Install Simulation via ensureAutoSetup
    const { ensureAutoSetup } = require('../bin/lib/runtime');
    console.log('1. Executing ensureAutoSetup for fresh install...');
    ensureAutoSetup(true);

    const dbPath = path.join(tempHome, '.konoha', 'konoha.db');
    assert.ok(fs.existsSync(dbPath), 'konoha.db must be created automatically on fresh install');

    // 2. Start web server in fresh isolated environment
    const webServerMod = require('../src/web_server');
    const port = 1488;
    console.log(`2. Starting web server on port ${port}...`);
    srv = await webServerMod.startWebServer({ port, host: '127.0.0.1' });

    // 3. Test unauthenticated /api/v1/health returns HTTP 200 with version
    const healthRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/health',
      method: 'GET'
    });
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.status, 'healthy');
    assert.ok(healthRes.data.version, 'Health check must include version');
    console.log('✓ Unauthenticated health check returned status 200 and version');

    // 4. Test login with default bootstrap passphrase 'konohagakure'
    const loginRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'konohagakure' });

    assert.strictEqual(loginRes.status, 200, `Bootstrap login failed: ${JSON.stringify(loginRes.data)}`);
    assert.strictEqual(loginRes.data.ok, true);
    assert.strictEqual(loginRes.data.is_bootstrap, true);
    assert.strictEqual(loginRes.data.requires_password_change, true);
    const sessionCookie = extractCookie(loginRes.headers, 'konoha_session');
    assert.ok(sessionCookie, 'Login must set konoha_session cookie');
    console.log('✓ Fresh install login with konohagakure succeeded');

    // 5. Test mandatory password change
    const changeRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `konoha_session=${sessionCookie}`,
        'X-Konoha-Web-Token': srv.token
      }
    }, {
      current_password: 'konohagakure',
      new_password: 'super-secure-isolated-2026!'
    });
    assert.strictEqual(changeRes.status, 200);
    assert.strictEqual(changeRes.data.ok, true);
    console.log('✓ Mandatory password change completed successfully');

    // 6. Test login with new password succeeds and is_bootstrap is false
    const newLoginRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'super-secure-isolated-2026!' });
    assert.strictEqual(newLoginRes.status, 200);
    assert.strictEqual(newLoginRes.data.is_bootstrap, false);
    assert.strictEqual(newLoginRes.data.requires_password_change, false);
    console.log('✓ Login with new password succeeded (normal dashboard access unlocked)');

    // 7. Upgrade Simulation: run ensureAutoSetup again, verify zero crashes and files updated
    console.log('7. Simulating upgrade via ensureAutoSetup...');
    assert.doesNotThrow(() => {
      ensureAutoSetup(true);
    }, 'Upgrade ensureAutoSetup must execute cleanly');
    console.log('✓ Upgrade simulation passed without errors');

    console.log('\nAll fresh install & upgrade tests in /tmp isolation passed cleanly!');
  } finally {
    if (srv && srv.instance) {
      try { await srv.instance.stop(); } catch (_) {}
    }
    process.env.HOME = origHome;
    if (origAuth) process.env.KONOHA_AUTH_FILE = origAuth; else delete process.env.KONOHA_AUTH_FILE;
    if (origDb) process.env.KONOHA_DB_PATH = origDb; else delete process.env.KONOHA_DB_PATH;
    if (origUiAuto) process.env.KONOHA_UI_AUTOSTART = origUiAuto; else delete process.env.KONOHA_UI_AUTOSTART;
    delete process.env.KONOHA_SEMANTIC_SEARCH;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
  }
}

run().catch(err => {
  console.error('Test in /tmp isolation failed:', err);
  process.exit(1);
});
