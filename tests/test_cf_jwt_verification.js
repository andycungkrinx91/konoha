// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const security = require('../src/tunnel/security');
const configModule = require('../src/tunnel/config');

// Helper to generate RSA key pair and valid JWT
function generateTestJwt(payloadOverrides = {}, kid = 'test-key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    email: 'andy@example.com',
    sub: 'test-user-id',
    iss: 'https://testteam.cloudflareaccess.com',
    aud: 'test-aud-12345',
    iat: nowSec - 60,
    exp: nowSec + 3600,
    ...payloadOverrides
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signedContent = `${headerB64}.${payloadB64}`;

  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedContent), privateKey);
  const signatureB64 = signature.toString('base64url');
  const jwt = `${signedContent}.${signatureB64}`;

  return { jwt, publicKey, kid, payload };
}

function runTests() {
  const origGet = configModule.getTunnelConfig;

  try {
    // 1. Rejection when cfJwt is present but auth_domain is not configured
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'named',
      provider: 'cloudflare',
      auth_domain: '',
      aud: '',
      auth_pin: '849201'
    });

    const unconfiguredDomainReq = {
      headers: {
        host: 'konoha.customdomain.com',
        'cf-access-jwt-assertion': 'any.dummy.jwt'
      }
    };
    const resNoDomain = security.verifyRemoteAccess(unconfiguredDomainReq);
    assert.strictEqual(resNoDomain.authenticated, false);
    assert.strictEqual(resNoDomain.requiresPin, true);
    assert.ok(resNoDomain.error.includes('auth_domain configured'));

    // 2. Rejection of forged JWT with email header alone (email fallback removed)
    configModule.getTunnelConfig = () => ({
      enabled: 1,
      mode: 'named',
      provider: 'cloudflare',
      auth_domain: 'testteam.cloudflareaccess.com',
      aud: 'test-aud-12345',
      auth_pin: '849201'
    });

    const forgedReq = {
      headers: {
        host: 'konoha.customdomain.com',
        'cf-access-jwt-assertion': 'header.forgedpayload.badsig',
        'cf-access-authenticated-user-email': 'attacker@example.com'
      }
    };
    const resForged = security.verifyRemoteAccess(forgedReq);
    assert.strictEqual(resForged.authenticated, false, 'Forged JWT must NOT authenticate');
    assert.strictEqual(resForged.requiresPin, true);

    // 3. Rejection of expired token
    const expiredData = generateTestJwt({ exp: Math.floor(Date.now() / 1000) - 300 });
    security.setCachedJwks('testteam.cloudflareaccess.com', [{
      kid: expiredData.kid,
      publicKey: expiredData.publicKey
    }]);

    const expiredReq = {
      headers: {
        host: 'konoha.customdomain.com',
        'cf-access-jwt-assertion': expiredData.jwt
      }
    };
    const resExpired = security.verifyRemoteAccess(expiredReq);
    assert.strictEqual(resExpired.authenticated, false);
    assert.ok(resExpired.error.includes('expired'));

    // 4. Rejection on AUD mismatch
    const audMismatchData = generateTestJwt({ aud: 'wrong-aud-99999' });
    security.setCachedJwks('testteam.cloudflareaccess.com', [{
      kid: audMismatchData.kid,
      publicKey: audMismatchData.publicKey
    }]);

    const audMismatchReq = {
      headers: {
        host: 'konoha.customdomain.com',
        'cf-access-jwt-assertion': audMismatchData.jwt
      }
    };
    const resAudMismatch = security.verifyRemoteAccess(audMismatchReq);
    assert.strictEqual(resAudMismatch.authenticated, false);
    assert.ok(resAudMismatch.error.includes('AUD mismatch'));

    // 5. Successful authentication with valid RS256 signature
    const validData = generateTestJwt();
    security.setCachedJwks('testteam.cloudflareaccess.com', [{
      kid: validData.kid,
      publicKey: validData.publicKey
    }]);

    const validReq = {
      headers: {
        host: 'konoha.customdomain.com',
        'cf-access-jwt-assertion': validData.jwt
      }
    };
    const resValid = security.verifyRemoteAccess(validReq);
    assert.strictEqual(resValid.authenticated, true);
    assert.strictEqual(resValid.authType, 'cloudflare_zero_trust');
    assert.strictEqual(resValid.userEmail, 'andy@example.com');

    console.log('✓ test_cf_jwt_verification passed');
  } finally {
    configModule.getTunnelConfig = origGet;
    security.clearJwksCache();
  }
}

runTests();
