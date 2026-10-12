'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const security = require('../src/tunnel/security');
const configModule = require('../src/tunnel/config');
const manager = require('../src/tunnel/manager');

test('Tunnel Auth Enforcement & G-22 Rate Limiting Protection', async (t) => {
  await t.test('1. verifyRemoteAccess never permits open_named unauthenticated bypass', () => {
    // Mock named tunnel with no auth_pin
    const origGet = configModule.getTunnelConfig;
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'named',
      provider: 'cloudflare',
      auth_pin: '',
      custom_domain: 'konoha.example.com'
    });

    try {
      const mockReq = {
        headers: { host: 'konoha.example.com' },
        query: {}
      };
      const result = security.verifyRemoteAccess(mockReq);
      assert.equal(result.authenticated, false, 'Must not be authenticated without PIN');
      assert.notEqual(result.authType, 'open_named', 'open_named must be completely eliminated');
      assert.equal(result.requiresPin, true);
    } finally {
      configModule.getTunnelConfig = origGet;
    }
  });

  await t.test('2. verifyRemoteAccess ignores and rejects PIN in query parameter (?pin=)', () => {
    const origGet = configModule.getTunnelConfig;
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'ephemeral',
      provider: 'cloudflare',
      auth_pin: '849201',
      custom_domain: 'konoha.trycloudflare.com'
    });

    try {
      const mockReq = {
        headers: { host: 'konoha.trycloudflare.com' },
        query: { pin: '849201' }
      };
      const result = security.verifyRemoteAccess(mockReq);
      assert.equal(result.authenticated, false, 'Must NOT authenticate using URL query param ?pin=');
      assert.equal(result.requiresPin, true);
    } finally {
      configModule.getTunnelConfig = origGet;
    }
  });

  await t.test('3. verifyRemoteAccess authenticates valid PIN via header or cookie using constant-time comparison', () => {
    const origGet = configModule.getTunnelConfig;
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'ephemeral',
      provider: 'cloudflare',
      auth_pin: '654321',
      custom_domain: 'konoha.trycloudflare.com'
    });

    try {
      // Valid header
      const reqHeader = {
        headers: { host: 'konoha.trycloudflare.com', 'x-konoha-pin': '654321' },
        query: {}
      };
      const resHeader = security.verifyRemoteAccess(reqHeader);
      assert.equal(resHeader.authenticated, true);
      assert.equal(resHeader.authType, 'pin');

      // Valid cookie
      const reqCookie = {
        headers: { host: 'konoha.trycloudflare.com', cookie: 'konoha_pin=654321' },
        query: {}
      };
      const resCookie = security.verifyRemoteAccess(reqCookie);
      assert.equal(resCookie.authenticated, true);
      assert.equal(resCookie.authType, 'pin');

      // Invalid PIN
      const reqBad = {
        headers: { host: 'konoha.trycloudflare.com', 'x-konoha-pin': '000000' },
        query: {}
      };
      const resBad = security.verifyRemoteAccess(reqBad);
      assert.equal(resBad.authenticated, false);
    } finally {
      configModule.getTunnelConfig = origGet;
    }
  });

  await t.test('4. saveTunnelConfig refuses empty or whitespace auth_pin when tunnel is enabled', () => {
    const origGet = configModule.getTunnelConfig;
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'ephemeral',
      provider: 'cloudflare',
      auth_pin: '123456',
      custom_domain: 'konoha.trycloudflare.com'
    });

    try {
      assert.throws(() => {
        configModule.saveTunnelConfig({ enabled: true, auth_pin: '   ' });
      }, /PIN cannot be empty/i);

      assert.throws(() => {
        configModule.saveTunnelConfig({ enabled: true, auth_pin: '' });
      }, /PIN cannot be empty/i);
    } finally {
      configModule.getTunnelConfig = origGet;
    }
  });

  await t.test('5. G-22: Client IP extraction does NOT trust spoofed proxy headers from untrusted socket peers', () => {
    const webServer = require('../src/web_server');
    // If getTrustedClientIp is exported or tested via request handling:
    assert.equal(typeof webServer.getTrustedClientIp, 'function', 'webServer must export getTrustedClientIp');

    // Untrusted remote socket peer sending spoofed cf-connecting-ip
    const untrustedReq = {
      socket: { remoteAddress: '203.0.113.195' },
      headers: {
        'cf-connecting-ip': '8.8.8.8',
        'x-forwarded-for': '1.1.1.1'
      }
    };
    const resolvedUntrusted = webServer.getTrustedClientIp(untrustedReq);
    assert.equal(resolvedUntrusted, '203.0.113.195', 'Untrusted socket connection must NOT honor spoofed proxy headers');

    // Loopback proxy peer sending cf-connecting-ip
    const loopbackReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        'cf-connecting-ip': '198.51.100.44'
      }
    };
    const resolvedLoopback = webServer.getTrustedClientIp(loopbackReq);
    assert.equal(resolvedLoopback, '198.51.100.44', 'Loopback/trusted proxy socket connection must honor cf-connecting-ip');
  });
});
