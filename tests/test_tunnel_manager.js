'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate test database
const testDbPath = path.join(os.tmpdir(), `konoha_test_tunnel_${Date.now()}.db`);
process.env.KONOHA_DB_PATH = testDbPath;

const dbModule = require('../src/db');
const conn = dbModule.getConnection(testDbPath);
dbModule.setupSchema(conn);

const tunnelConfig = require('../src/tunnel/config');
const tunnelManager = require('../src/tunnel/manager');
const tunnelSecurity = require('../src/tunnel/security');

console.log('Running test_tunnel_manager.js...');

try {
  // 1. Initial default configuration test
  const initial = tunnelConfig.getTunnelConfig();
  assert.strictEqual(initial.id, 1, 'Config ID must be 1');
  assert.strictEqual(initial.enabled, 0, 'Default enabled state must be 0');
  assert.strictEqual(initial.provider, 'cloudflare', 'Default provider must be cloudflare');

  // 2. Save configuration test
  const saved = tunnelConfig.saveTunnelConfig({
    provider: 'cloudflare',
    mode: 'named',
    custom_domain: 'konoha.example.com',
    auth_pin: '849201',
    enabled: 1
  });
  assert.strictEqual(saved.enabled, 1, 'Enabled must be 1');
  assert.strictEqual(saved.custom_domain, 'konoha.example.com', 'Custom domain must match');
  assert.strictEqual(saved.auth_pin, '849201', 'Auth PIN must match');

  // 3. Security verification test: Cloudflare Zero Trust (Mode A - No PIN required)
  const reqWithCfZeroTrust = {
    headers: {
      'cf-access-authenticated-user-email': 'andy@example.com',
      'cf-access-jwt-assertion': 'jwt.token.here'
    }
  };
  const cfAuthResult = tunnelSecurity.verifyRemoteAccess(reqWithCfZeroTrust);
  assert.strictEqual(cfAuthResult.authenticated, true, 'Cloudflare Zero Trust request must be authenticated');
  assert.strictEqual(cfAuthResult.authType, 'cloudflare_zero_trust', 'Auth type must be cloudflare_zero_trust');
  assert.strictEqual(cfAuthResult.userEmail, 'andy@example.com', 'User email must be captured');

  // 4. Security verification test: Standalone PIN fallback
  const reqWithValidPin = {
    headers: {
      'authorization': 'Bearer 849201'
    }
  };
  const pinAuthResult = tunnelSecurity.verifyRemoteAccess(reqWithValidPin);
  assert.strictEqual(pinAuthResult.authenticated, true, 'Valid PIN request must be authenticated');
  assert.strictEqual(pinAuthResult.authType, 'pin', 'Auth type must be pin');

  // 5. Security verification test: Rejected unauthorized request
  const reqUnauthorized = {
    headers: {
      'authorization': 'Bearer 000000'
    }
  };
  const failAuthResult = tunnelSecurity.verifyRemoteAccess(reqUnauthorized);
  assert.strictEqual(failAuthResult.authenticated, false, 'Invalid PIN must be rejected');
  assert.ok(failAuthResult.error, 'Must provide error message');

  // 6. Security verification: Spoofed headers on trycloudflare.com Quick Tunnel must be rejected
  const reqSpoofedOnQuickTunnel = {
    headers: {
      host: 'abc-xyz.trycloudflare.com',
      'cf-access-authenticated-user-email': 'attacker@evil.com',
      'cf-access-jwt-assertion': 'fake.jwt.token'
    }
  };
  const spoofResult = tunnelSecurity.verifyRemoteAccess(reqSpoofedOnQuickTunnel);
  assert.strictEqual(spoofResult.authenticated, false, 'Spoofed Cloudflare headers on trycloudflare must be rejected');
  assert.strictEqual(spoofResult.requiresPin, true, 'Quick tunnel must require valid PIN');

  // 7. Remote detection check
  assert.strictEqual(tunnelSecurity.isRemoteRequest({ headers: { host: 'abc.trycloudflare.com' } }), true, 'trycloudflare must be detected as remote');
  assert.strictEqual(tunnelSecurity.isRemoteRequest({ headers: { host: 'localhost:1404' } }), false, 'localhost must not be detected as remote');

  // 8. Rate limiting test
  for (let i = 0; i < 5; i++) {
    tunnelSecurity.recordPinFailure('192.0.2.1');
  }
  const rateLimitResult = tunnelSecurity.checkPinRateLimit('192.0.2.1');
  assert.strictEqual(rateLimitResult.allowed, false, 'Should be rate limited after 5 failed attempts');
  tunnelSecurity.resetPinFailure('192.0.2.1');
  assert.strictEqual(tunnelSecurity.checkPinRateLimit('192.0.2.1').allowed, true, 'Rate limit resets cleanly');

  // 9. Manager status inspection
  const status = tunnelManager.getTunnelStatus();
  assert.ok(status !== null, 'Status must return an object');
  assert.strictEqual(typeof status.enabled, 'number', 'Enabled must be number');
  assert.strictEqual(typeof status.has_pin, 'boolean', 'has_pin must be boolean');

  console.log('✓ All Public Tunnel & Security Gate tests passed cleanly.');
} finally {
  try { fs.unlinkSync(testDbPath); } catch (_) {}
}
