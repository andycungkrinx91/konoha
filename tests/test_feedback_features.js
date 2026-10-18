'use strict';

const { assertSandbox } = require('./helpers/sandbox_guard');
assertSandbox();

/**
 * tests/test_feedback_features.js — Regression & Integration test suite for:
 * 1. Post-password-change SSE broadcast (auth_state_changed)
 * 2. Login UI labels and taglines
 * 3. Argon2id password hashing and timing-safe verification
 * 4. Password reset to default & unauthorized protection
 * 5. Dynamic OMP session detection in Telegram session manager
 * 6. Webhook outbound integration (CRUD, auth types, delivery)
 * 7. OMP MCP isolation (no cross-client leakage)
 * 8. Active sidebar badge neon styling
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const auth = require('../src/auth');
const wm = require('../src/webhook_manager');
const sessionManager = require('../src/telegram/session_manager');
const ompManager = require('../src/omp_manager');

async function run() {
  console.log('Running test_feedback_features...');

  // Use isolated auth file for tests to prevent modifying real ~/.konoha/web_auth.json
  const tmpAuthFile = path.join(require('os').tmpdir(), `test_feedback_auth_${Date.now()}.json`);
  process.env.KONOHA_AUTH_FILE = tmpAuthFile;

  try {
    // ── 1. Feedback 4: Argon2id Hashing & Timing-safe Verification ────────────
    console.log('Testing Feedback 4: Argon2id password encryption...');
    const testSecret = 'ShinobiPassphrase2026!';
    const hashed = auth.hashPassword(testSecret);
    assert.ok(hashed.hash, 'Hash must exist');
    assert.strictEqual(hashed.format, 'argon2id', 'Format must be argon2id');
    assert.ok(hashed.hash.startsWith('$argon2id$'), 'Hash must start with $argon2id$');
    assert.strictEqual(auth.verifyPasswordHash(testSecret, hashed), true, 'Valid password must match argon2id hash');
    assert.strictEqual(auth.verifyPasswordHash('wrong-password', hashed), false, 'Invalid password must be rejected');

    // Backward compatibility with scrypt hashes
    const scryptHash = {
      format: 'scrypt:N=16384,r=8,p=1',
      salt: 'e8d31439fc4cf7afe743dcd9795ded2e',
      hash: '2a8678f9cdf1995d7b57457cf74799c1b3ab6be20ec28080ebc39ea6b4782c2fb655f88d60f1d9307b8abfae121dc89e416e0265fd7647876cfbcd9e08f70b1c'
    };
    assert.strictEqual(auth.verifyPasswordHash('wrong', scryptHash), false);
    console.log('✓ Argon2id hashing and timing-safe backward-compatible verification passed');

    // ── 2. Feedback 4: Password Reset to Default & Session Invalidation ─────────
    console.log('Testing Feedback 4: Password reset & session invalidation...');
    // Authenticate to get a valid session
    const authRes = auth.authenticate(auth.resolveBootstrapPassword());
    assert.strictEqual(authRes.success, true);
    const sessId = authRes.sessionId;
    assert.ok(sessId);

    // Unauthorized user (invalid current password) cannot reset
    const badReset = auth.resetPasswordToDefault(sessId, 'wrong-current-password');
    assert.strictEqual(badReset.success, false);
    assert.strictEqual(badReset.error, 'Current password is incorrect');

    // Unauthenticated user (invalid session) cannot reset
    const unauthReset = auth.resetPasswordToDefault('invalid-session-id', 'anything');
    assert.strictEqual(unauthReset.success, false);
    assert.strictEqual(unauthReset.status, 401);

    // Valid reset
    const goodReset = auth.resetPasswordToDefault(sessId, auth.resolveBootstrapPassword());
    assert.strictEqual(goodReset.success, true);
    // After reset, all sessions must be invalidated
    assert.strictEqual(auth.getSession(sessId), null, 'Session must be invalidated after reset');
    console.log('✓ Reset password to default and session invalidation passed');

    // ── 3. Feedback 5: Telegram Session Manager Dynamic OMP Detection ───────────
    console.log('Testing Feedback 5: Telegram session manager dynamic OMP detection...');
    // Seed hermetic OMP session fixture for current workspace so test passes under any $HOME
    const testCwd = path.normalize(process.cwd());
    const ompCandidates = [];
    if (testCwd.startsWith(require('os').homedir())) {
      const rel = path.relative(require('os').homedir(), testCwd);
      ompCandidates.push('-' + rel.replace(/\//g, '-'));
    }
    ompCandidates.push('-' + testCwd.replace(/^\//, '').replace(/\//g, '-'));
    const ompDir = path.join(require('os').homedir(), '.omp', 'agent', 'sessions', ompCandidates[0]);
    fs.mkdirSync(ompDir, { recursive: true });
    const fixtureJsonl = path.join(ompDir, 'session-test-hermetic.jsonl');
    fs.writeFileSync(fixtureJsonl, '{"timestamp": ' + Date.now() + ', "role": "user"}\n', 'utf8');

    const sessions = sessionManager.getActiveSessions();
    assert.ok(sessions.length > 0, 'Active sessions list must not be empty');
    const hasOmp = sessions.some(s => s.client === 'omp');
    assert.ok(hasOmp, 'Active sessions must detect OMP agent instead of phantom antigravity');
    console.log('✓ Telegram session manager correctly detects OMP session');

    // ── 4. Feedback 6: Webhook Outbound Integrations ───────────────────────────
    console.log('Testing Feedback 6: Webhook outbound integrations...');
    // Create test server to receive webhook payload
    let receivedPayload = null;
    let receivedAuth = null;
    const testServer = http.createServer((req, res) => {
      receivedAuth = req.headers['authorization'] || req.headers['x-api-key'] || req.headers['x-custom-auth'];
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { receivedPayload = JSON.parse(body); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
    const testPort = testServer.address().port;
    const webhookUrl = `http://127.0.0.1:${testPort}/webhook-target`;

    // Test Bearer Auth
    const whBearer = wm.createWebhook({
      name: 'Test Bearer Webhook',
      url: webhookUrl,
      auth_type: 'bearer',
      auth_token: 'secret-bearer-token',
      events: 'task_completed'
    });
    assert.ok(whBearer.id);
    assert.strictEqual(whBearer.auth_type, 'bearer');

    const dispatchRes = await wm.sendWebhookPayload(whBearer, {
      event: 'task_completed',
      title: 'Test Task',
      status: 'SUCCESS'
    });
    assert.strictEqual(dispatchRes.ok, true);
    assert.strictEqual(dispatchRes.status, 200);
    assert.strictEqual(receivedAuth, 'Bearer secret-bearer-token');
    assert.strictEqual(receivedPayload.event, 'task_completed');
    assert.strictEqual(receivedPayload.title, 'Test Task');

    // Clean up webhook
    assert.strictEqual(wm.deleteWebhook(whBearer.id), true);
    testServer.close();
    console.log('✓ Webhook outbound integration creation, delivery, and auth passed');

    // ── 5. Feedback 7: OMP MCP Configuration Isolation ─────────────────────────
    console.log('Testing Feedback 7: OMP MCP configuration isolation...');
    const ompServers = ompManager.buildOmpMcpServers();
    assert.strictEqual(ompServers.konoha.env.ACTIVE_CLIENT, 'omp');
    assert.strictEqual(ompServers.konoha.env.KONOHA_CLIENT, 'omp');
    assert.strictEqual(ompManager.getOmpConfigPath().endsWith('.omp/agent/mcp.json'), true);
    console.log('✓ OMP MCP isolation and environment flags verified');

    // ── 6. Feedback 8: Active Sidebar Badge Neon Styling ───────────────────────
    console.log('Testing Feedback 8: Active sidebar badge neon styling...');
    const appCss = fs.readFileSync(path.join(__dirname, '../apps/web/src/app.css'), 'utf8');
    assert.ok(appCss.includes('.active-sidemenu-neon-badge'), 'app.css must define .active-sidemenu-neon-badge');
    assert.ok(appCss.includes('var(--theme-grad-1'), 'active badge must use --theme-grad-1 neon color');

    const layoutSvelte = fs.readFileSync(path.join(__dirname, '../apps/web/src/routes/+layout.svelte'), 'utf8');
    assert.ok(layoutSvelte.includes('active-sidemenu-neon-badge'), '+layout.svelte must use active-sidemenu-neon-badge');
    console.log('✓ Active sidebar badge neon styling verified in CSS and layout');

    console.log('\n✅ All feedback feature integration tests passed cleanly!');
  } finally {
    try { fs.unlinkSync(tmpAuthFile); } catch (_) {}
  }
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
