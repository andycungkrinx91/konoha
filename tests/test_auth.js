#!/usr/bin/env node
'use strict';

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const { startWebServer } = require('../src/web_server');
const { hashPassword } = require('../src/auth');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;


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

// Deterministic isolated credential fixture (sandbox HOME or KONOHA_AUTH_FILE).
function prepareAuthFile(env) {
  const authDir = env.KONOHA_HOME || path.join(env.HOME, '.konoha');
  fs.mkdirSync(authDir, { recursive: true });
  const authFile = env.KONOHA_AUTH_FILE || path.join(authDir, 'web_auth.json');
  if (fs.existsSync(authFile)) fs.rmSync(authFile);
  return authFile;
}

// Auth config path and session TTL are read from process.env at module load, so
// isolated fixtures must run in a child process with those variables pre-set.
const ISOLATION_SCRIPT = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startWebServer } = require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'web_server'))});

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

function cookieOf(headers, name) {
  const list = [].concat(headers['set-cookie'] || []);
  for (const c of list) {
    const m = c.match(new RegExp(name + '=([^;]+)'));
    if (m) return m[1];
  }
  return null;
}

function net() {
  return /^\d+$/.test(process.env.KONOHA_ISO_PORT || '') ? parseInt(process.env.KONOHA_ISO_PORT, 10) : 1447;
}

async function call(port, method, pathName, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.token) headers['X-Konoha-Web-Token'] = opts.token;
  return request({ hostname: '127.0.0.1', port, path: pathName, method, headers }, opts.body);
}

async function main() {
  const port = net();
  const ttl = process.env.KONOHA_SESSION_TTL_MS;
  const srv = await startWebServer({ port, host: '127.0.0.1' });
  try {
    if (process.env.KONOHA_ISO_SCENARIO === 'corrupt') {
      const login = await call(port, 'POST', '/api/v1/auth/login', { body: { password: 'konohagakure' } });
      assert.strictEqual(login.status, 401);
      assert.notStrictEqual(login.data.error, 'Invalid password', 'corrupt store must not report a credential mismatch');
      assert.ok(!('sessionId' in login.data), 'corrupt store must not issue a session');
      const status = await call(port, 'GET', '/api/v1/auth/status');
      assert.strictEqual(status.data.authenticated, false);
      assert.strictEqual(fs.readFileSync(process.env.KONOHA_AUTH_FILE, 'utf8'), '{ not valid json');
      console.log('CORRUPT_ONLY_OK');
      return;
    }

    const login = await call(port, 'POST', '/api/v1/auth/login', { body: { password: 'konohagakure' } });
    assert.strictEqual(login.status, 200, 'bootstrap login: ' + JSON.stringify(login.data));
    const session = cookieOf(login.headers, 'konoha_session');
    assert.ok(session);

    const change = await call(port, 'POST', '/api/v1/auth/change-password', {
      cookie: 'konoha_session=' + session,
      token: srv.token,
      body: { current_password: 'konohagakure', new_password: 'isolated-new-pass-2026!' }
    });

    if (process.env.KONOHA_ISO_SCENARIO === 'persist-fail') {
      assert.strictEqual(change.status, 500, 'expected persistence failure, got ' + change.status);
      assert.strictEqual(change.data.error, 'Failed to persist new password');
      const status = await call(port, 'GET', '/api/v1/auth/status', { cookie: 'konoha_session=' + session });
      assert.strictEqual(status.data.requires_password_change, true, 'bootstrap flag must survive failed write');
      const blocked = await call(port, 'GET', '/api/v1/bridges', { cookie: 'konoha_session=' + session, token: srv.token });
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual(blocked.data.requires_password_change, true);
      console.log('PERSIST_FAIL_OK');
      return;
    }

    assert.strictEqual(change.status, 200, 'change-password: ' + JSON.stringify(change.data));
    const allowed = await call(port, 'GET', '/api/v1/bridges', { cookie: 'konoha_session=' + session });
    assert.strictEqual(allowed.status, 200);
    await new Promise(r => setTimeout(r, parseInt(ttl, 10) + 400));
    const expired = await call(port, 'GET', '/api/v1/bridges', { cookie: 'konoha_session=' + session, token: srv.token });
    assert.strictEqual(expired.status, 401);
    assert.strictEqual(expired.data.requires_login, true);
    const after = await call(port, 'GET', '/api/v1/auth/status', { cookie: 'konoha_session=' + session });
    assert.strictEqual(after.data.authenticated, false);
    console.log('EXPIRY_OK');
  } finally {
    await srv.instance.stop();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err && err.message || err); process.exit(1); });
`;

function writeBootstrapVerifier(authFile) {
  const bootstrap = hashPassword('konohagakure');
  fs.writeFileSync(authFile, JSON.stringify({
    format: bootstrap.format,
    salt: bootstrap.salt,
    hash: bootstrap.hash,
    is_bootstrap: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }), { mode: 0o600 });
}

function runIsolated(scenario, authFile, ttlMs = SESSION_TTL_MS, { denyWrite = false } = {}) {
  const { spawnSync } = require('child_process');
  const guard = denyWrite
    ? "{\n  const __fs = require('fs');\n  const __open = __fs.openSync;\n  __fs.openSync = function (target, ...rest) {\n    if (String(target) === process.env.KONOHA_AUTH_FILE) {\n      const err = new Error('EACCES: simulated unwritable credential store');\n      err.code = 'EACCES';\n      throw err;\n    }\n    return __open.call(__fs, target, ...rest);\n  };\n}\n"
    : '';
  const result = spawnSync(process.execPath, ['-e', guard + ISOLATION_SCRIPT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      KONOHA_AUTH_FILE: authFile,
      KONOHA_SESSION_TTL_MS: String(ttlMs),
      KONOHA_ISO_SCENARIO: scenario,
      KONOHA_ISO_PORT: String(ISOLATION_PORT)
    }
  });
  return result;
}

function portIsFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 25; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error('No free port found for auth isolation tests');
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
  const authFile = prepareAuthFile(process.env);
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

    // 11. Reusing the current password is rejected without clearing any state
    const reuseCurrent = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `konoha_session=${newSessionCookie}`,
        'X-Konoha-Web-Token': serverToken
      }
    }, {
      current_password: 'super-secure-ninja-2026!',
      new_password: 'super-secure-ninja-2026!'
    });
    assert.strictEqual(reuseCurrent.status, 400);
    assert.strictEqual(reuseCurrent.data.error, 'New password must differ from the current password');
    console.log('✓ Reusing the current password rejected with 400');

    // 12. Wrong current password is rejected
    const wrongCurrent = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `konoha_session=${newSessionCookie}`,
        'X-Konoha-Web-Token': serverToken
      }
    }, {
      current_password: 'not-the-current-password',
      new_password: 'another-new-password-2026'
    });
    assert.strictEqual(wrongCurrent.status, 400);
    assert.strictEqual(wrongCurrent.data.error, 'Current password is incorrect');
    console.log('✓ Wrong current password rejected with 400');

    // 13. Empty body is handled without crashing
    const emptyBody = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `konoha_session=${newSessionCookie}`,
        'X-Konoha-Web-Token': serverToken
      }
    }, {});
    assert.strictEqual(emptyBody.status, 400);
    console.log('✓ Empty change-password payload rejected with 400');

    // 14. Logout destroys session
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

    await srv.instance.stop();

    // ---- Isolated fault-injection scenarios (own credential file + TTL) ----
    await runPersistenceAndExpiryScenarios(port + 1, authFile);
  } finally {
    if (srv.instance) await srv.instance.stop();
    console.log('✓ Auth test server stopped cleanly');
  }
}

async function fetchWithToken(port, method, pathName, { body, cookie, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (token) headers['X-Konoha-Web-Token'] = token;
  return request({ hostname: '127.0.0.1', port, path: pathName, method, headers }, body);
}

let ISOLATION_PORT = 0;

async function runPersistenceAndExpiryScenarios(basePort, authFile) {
  ISOLATION_PORT = await findFreePort(basePort + 10);
  const fixtureDir = path.join(path.dirname(authFile), 'auth-isolation-fixtures');
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.mkdirSync(fixtureDir, { recursive: true });

  // A. Persistence failure: the bootstrap verifier loads, but every write to the
  //    credential file is rejected, so the change must report 500 and keep the
  //    gate closed.
  const blockedFile = path.join(fixtureDir, 'unwritable', 'web_auth.json');
  fs.mkdirSync(path.dirname(blockedFile), { recursive: true });
  writeBootstrapVerifier(blockedFile);
  const persistFail = runIsolated('persist-fail', blockedFile, SESSION_TTL_MS, { denyWrite: true });
  assert.strictEqual(persistFail.status, 0, `persistence-failure scenario failed: ${persistFail.stderr || persistFail.stdout}`);
  assert.ok(persistFail.stdout.includes('PERSIST_FAIL_OK'));
  console.log('✓ Failed password persistence keeps the bootstrap flag and blocks access');

  // B. Corrupt credential store: fail closed, never reinstall the bootstrap.
  const corruptFile = path.join(fixtureDir, 'corrupt', 'web_auth.json');
  fs.mkdirSync(path.dirname(corruptFile), { recursive: true });
  fs.writeFileSync(corruptFile, '{ not valid json', { mode: 0o600 });
  const corrupt = runIsolated('corrupt', corruptFile);
  assert.strictEqual(corrupt.status, 0, `corrupt-store scenario failed: ${corrupt.stderr || corrupt.stdout}`);
  assert.ok(corrupt.stdout.includes('CORRUPT_ONLY_OK'));
  console.log('✓ Corrupt credential store fails closed without reinstalling bootstrap');

  // C. Session expiry after a successful password change.
  const expiryFile = path.join(fixtureDir, 'expiry', 'web_auth.json');
  fs.mkdirSync(path.dirname(expiryFile), { recursive: true });
  writeBootstrapVerifier(expiryFile);
  const expiry = runIsolated('expiry', expiryFile, 1500);
  assert.strictEqual(expiry.status, 0, `session-expiry scenario failed: ${expiry.stderr || expiry.stdout}`);
  assert.ok(expiry.stdout.includes('EXPIRY_OK'));
  console.log('✓ Expired sessions are denied and reported unauthenticated');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
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
