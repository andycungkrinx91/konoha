#!/usr/bin/env node
'use strict';

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

const assert = require('assert');
const http = require('http');
const { startWebServer } = require('../src/web_server');

function request(options, body = null) {
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

function extractCookie(headers, cookieName) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of list) {
    const match = c.match(new RegExp(`${cookieName}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function run() {
  console.log('Running test_auth tests...');
  const port = process.env.KONOHA_UI_TEST_PORT ? parseInt(process.env.KONOHA_UI_TEST_PORT, 10) + 1 : 1419;
  const srv = await startWebServer({ port, host: '127.0.0.1' });
  const serverToken = srv.token;
  console.log('✓ Web server started for auth tests on port ' + port);

  try {
    // 1. Initial auth status check (unauthenticated)
    const status1 = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/status',
      method: 'GET'
    });
    assert.strictEqual(status1.status, 200);
    assert.strictEqual(status1.data.authenticated, false);
    assert.strictEqual(status1.data.is_bootstrap, true);
    console.log('✓ Initial unauthenticated status check passed');

    // 2. Browser access to protected endpoint without auth must return 401
    const browserUnauth = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Sec-Fetch-Site': 'same-origin'
      }
    });
    assert.strictEqual(browserUnauth.status, 401);
    assert.strictEqual(browserUnauth.data.requires_login, true);
    console.log('✓ Unauthenticated browser access rejected with 401');

    // 3. Login with wrong password returns 401
    const badLogin = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'wrong-password-123' });
    assert.strictEqual(badLogin.status, 401);
    assert.strictEqual(badLogin.data.error, 'Invalid password');
    console.log('✓ Invalid password login rejected with 401');

    // 4. Login with default bootstrap password 'konohagakure'
    const loginRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'konohagakure' });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.ok, true);
    assert.strictEqual(loginRes.data.is_bootstrap, true);
    assert.strictEqual(loginRes.data.requires_password_change, true);
    assert.ok(loginRes.data.sessionId);

    const sessionCookie = extractCookie(loginRes.headers, 'konoha_session');
    assert.ok(sessionCookie, 'Must set konoha_session cookie');
    console.log('✓ Login with bootstrap credential succeeded, session created');

    // 5. Protected endpoint access while in bootstrap mode must return 403 (Mandatory password change)
    const bootstrapBlocked = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges',
      method: 'GET',
      headers: {
        'Cookie': `konoha_session=${sessionCookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    });
    assert.strictEqual(bootstrapBlocked.status, 403);
    assert.strictEqual(bootstrapBlocked.data.requires_password_change, true);
    console.log('✓ Protected route blocked with 403 while bootstrap password active');

    // 6. Change password to secure custom password
    const changeRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `konoha_session=${sessionCookie}`,
        'X-Konoha-Web-Token': serverToken
      }
    }, {
      current_password: 'konohagakure',
      new_password: 'super-secure-ninja-2026!'
    });
    assert.strictEqual(changeRes.status, 200);
    assert.strictEqual(changeRes.data.ok, true);
    console.log('✓ Mandatory password change completed successfully');

    // 7. Auth status now shows authenticated: true, is_bootstrap: false, requires_password_change: false
    const status2 = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/status',
      method: 'GET',
      headers: {
        'Cookie': `konoha_session=${sessionCookie}`
      }
    });
    assert.strictEqual(status2.status, 200);
    assert.strictEqual(status2.data.authenticated, true);
    assert.strictEqual(status2.data.is_bootstrap, false);
    assert.strictEqual(status2.data.requires_password_change, false);
    console.log('✓ Auth status updated: is_bootstrap is now false');

    // 8. Protected endpoint now accessible after password change
    const afterChangeAccess = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/bridges',
      method: 'GET',
      headers: {
        'Cookie': `konoha_session=${sessionCookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    });
    assert.strictEqual(afterChangeAccess.status, 200);
    console.log('✓ Protected route fully accessible after password change');

    // 9. Old bootstrap password rejected on subsequent login attempt
    const oldLogin = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'konohagakure' });
    assert.strictEqual(oldLogin.status, 401);
    console.log('✓ Old bootstrap password rejected on subsequent login');

    // 10. Login with new password succeeds
    const newLogin = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { password: 'super-secure-ninja-2026!' });
    assert.strictEqual(newLogin.status, 200);
    assert.strictEqual(newLogin.data.is_bootstrap, false);
    assert.strictEqual(newLogin.data.requires_password_change, false);
    const newSessionCookie = extractCookie(newLogin.headers, 'konoha_session');
    assert.ok(newSessionCookie);
    console.log('✓ Login with new password succeeds with normal dashboard access');

    // 11. Logout destroys session
    const logoutRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/logout',
      method: 'POST',
      headers: {
        'Cookie': `konoha_session=${newSessionCookie}`,
        'X-Konoha-Web-Token': serverToken
      }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Status is now unauthenticated
    const statusAfterLogout = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/status',
      method: 'GET',
      headers: {
        'Cookie': `konoha_session=${newSessionCookie}`
      }
    });
    assert.strictEqual(statusAfterLogout.data.authenticated, false);
    console.log('✓ Logout successfully invalidated session');

  } finally {
    await srv.instance.stop();
    console.log('✓ Auth test server stopped cleanly');
  }
}

if (require.main === module) {
  run().then(() => {
    console.log('✅ All test_auth tests passed!');
    process.exit(0);
  }).catch(err => {
    console.error('❌ test_auth failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
