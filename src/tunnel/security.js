/**
 * Ingress Security Gate.
 * Enforces Cloudflare Zero Trust Edge identity validation with standalone PIN fallback,
 * anti-spoofing controls, and rate-limiting.
 */

'use strict';

const crypto = require('crypto');
const configModule = require('./config');

const failedPinAttempts = new Map(); // ip -> { count, lastAttempt }
const jwksCache = new Map(); // authDomain -> { certs, expiresAt }
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function setCachedJwks(authDomain, keys) {
  jwksCache.set(authDomain, { certs: keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
}

function clearJwksCache() {
  jwksCache.clear();
}

function getCachedJwks(authDomain) {
  const cached = jwksCache.get(authDomain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.certs;
  }
  return null;
}

function verifyCfAccessJwt(cfJwt, authDomain, expectedAud) {
  if (!cfJwt || typeof cfJwt !== 'string') return { valid: false, error: 'Missing token' };
  const parts = cfJwt.split('.');
  if (parts.length !== 3) return { valid: false, error: 'Malformed JWT structure' };

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    return { valid: false, error: 'Failed to decode JWT segments' };
  }

  if (header.alg !== 'RS256') {
    return { valid: false, error: `Unsupported JWT algorithm: ${header.alg}` };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) {
    return { valid: false, error: 'Access denied: Cloudflare Zero Trust token expired' };
  }

  if (expectedAud) {
    const aud = payload.aud;
    const match = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
    if (!match) {
      return { valid: false, error: 'Access denied: Cloudflare Access AUD mismatch' };
    }
  }

  const certs = getCachedJwks(authDomain);
  if (!certs || certs.length === 0) {
    return { valid: false, error: 'Cloudflare Access verification: JWKS not cached or domain unverified' };
  }

  const kid = header.kid;
  const keyObj = certs.find(k => k.kid === kid) || certs[0];
  if (!keyObj) {
    return { valid: false, error: `Key matching kid '${kid}' not found in JWKS` };
  }

  let publicKey = null;
  if (keyObj.publicKey) {
    publicKey = keyObj.publicKey;
  } else if (keyObj.cert) {
    publicKey = keyObj.cert;
  } else if (keyObj.x5c && keyObj.x5c[0]) {
    publicKey = `-----BEGIN CERTIFICATE-----\n${keyObj.x5c[0]}\n-----END CERTIFICATE-----`;
  } else if (keyObj.n && keyObj.e) {
    publicKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: keyObj.n,
        e: keyObj.e
      },
      format: 'jwk'
    });
  }

  if (!publicKey) {
    return { valid: false, error: 'Could not derive public key from JWKS key object' };
  }

  const signedContent = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');

  try {
    const isVerified = crypto.verify('RSA-SHA256', Buffer.from(signedContent), publicKey, signature);
    if (!isVerified) {
      return { valid: false, error: 'Access denied: Invalid Cloudflare Access JWT signature' };
    }
  } catch (err) {
    return { valid: false, error: `Signature verification error: ${err.message}` };
  }

  return { valid: true, payload };
}

/**
 * Determine if an incoming HTTP request originated remotely (via Cloudflare Tunnel, ngrok, or WAN).
 */
function isRemoteRequest(req) {
  if (!req || !req.headers) return false;

  // Cloudflare Edge verification headers
  if (req.headers['cf-ray'] || req.headers['cf-connecting-ip'] || req.headers['cf-visitor']) {
    return true;
  }

  // Forwarded proxy headers
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto']) {
    return true;
  }

  // Host header analysis
  const host = String(req.headers.host || '').toLowerCase();
  if (host.includes('.trycloudflare.com') || host.includes('.ngrok') || host.includes('.loca.lt')) {
    return true;
  }

  const hostWithoutPort = host.split(':')[0];
  const isLocalHost = hostWithoutPort === 'localhost' ||
                      hostWithoutPort === '127.0.0.1' ||
                      hostWithoutPort === '::1' ||
                      hostWithoutPort === '0.0.0.0';
  if (!isLocalHost) {
    return true;
  }

  // Check socket remote address if accessed directly over network interface
  const remoteAddr = req.socket?.remoteAddress;
  if (remoteAddr && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr)) {
    return true;
  }

  return false;
}

/**
 * Validates remote request headers against Cloudflare Zero Trust or PIN fallback with anti-spoofing checks.
 */
function verifyRemoteAccess(req) {
  const host = String(req.headers['host'] || '').toLowerCase();
  const isTryCloudflare = host.includes('.trycloudflare.com');

  const cfJwt = req.headers['cf-access-jwt-assertion'];

  // Cloudflare Zero Trust Access is ONLY accepted on named/custom tunnels (never on trycloudflare.com Quick Tunnels)
  if (!isTryCloudflare && cfJwt) {
    const config = configModule.getTunnelConfig();
    const authDomain = config.auth_domain || process.env.KONOHA_TUNNEL_AUTH_DOMAIN;
    const aud = config.aud || process.env.KONOHA_TUNNEL_AUD;

    if (!authDomain) {
      return {
        authenticated: false,
        error: 'Cloudflare Access verification requires auth_domain configured',
        requiresPin: true
      };
    }

    const verification = verifyCfAccessJwt(cfJwt, authDomain, aud);
    if (verification.valid) {
      const payload = verification.payload;
      return {
        authenticated: true,
        authType: 'cloudflare_zero_trust',
        userEmail: payload.email || payload.sub || 'authenticated-cf-user'
      };
    } else {
      return {
        authenticated: false,
        error: verification.error || 'Access denied: Cloudflare Zero Trust verification failed',
        requiresPin: true
      };
    }
  }

  const config = configModule.getTunnelConfig();
  const requiredPin = config.auth_pin;

  // Extract candidate PIN from Authorization Bearer, Cookie, or X-Konoha-Pin header (query string disallowed)
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cookiePin = (req.headers['cookie'] || '').match(/konoha_pin=([^;]+)/)?.[1];
  const headerPin = req.headers['x-konoha-pin'];

  const candidatePin = bearerToken || (cookiePin ? decodeURIComponent(cookiePin) : '') || headerPin;

  if (requiredPin && candidatePin) {
    const candidateBuf = Buffer.from(String(candidatePin).trim());
    const requiredBuf = Buffer.from(String(requiredPin).trim());
    if (candidateBuf.length === requiredBuf.length && crypto.timingSafeEqual(candidateBuf, requiredBuf)) {
      return {
        authenticated: true,
        authType: 'pin'
      };
    }
  }

  return {
    authenticated: false,
    error: 'Access denied: Valid PIN or Cloudflare Zero Trust authentication required',
    requiresPin: true
  };
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const MAX_PIN_ENTRIES = 10000;
const PIN_ATTEMPT_WINDOW_MS = 60000;
const MAX_FAILED_ATTEMPTS = 5;

function isLoopbackIp(ip) {
  if (!ip) return false;
  const s = String(ip).trim().toLowerCase();
  return LOOPBACK_IPS.has(s);
}

function pruneFailedAttempts(now = Date.now()) {
  // First pass: prune expired entries
  for (const [key, record] of failedPinAttempts.entries()) {
    if (now - record.lastAttempt > PIN_ATTEMPT_WINDOW_MS) {
      failedPinAttempts.delete(key);
    }
  }
  // Second pass: if still at or above capacity, evict oldest entries
  while (failedPinAttempts.size >= MAX_PIN_ENTRIES) {
    const oldestKey = failedPinAttempts.keys().next().value;
    failedPinAttempts.delete(oldestKey);
  }
}

/**
 * Rate limit check for brute-force PIN attempts (max 5 failures per minute).
 * Loopback, MCP, and internal agent traffic bypasses rate-limiting.
 */
function checkPinRateLimit(ip) {
  if (!ip || isLoopbackIp(ip)) {
    return { allowed: true };
  }
  const now = Date.now();
  const record = failedPinAttempts.get(ip);
  if (!record) return { allowed: true };
  if (now - record.lastAttempt > PIN_ATTEMPT_WINDOW_MS) {
    failedPinAttempts.delete(ip);
    return { allowed: true };
  }
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    const waitSec = Math.ceil((PIN_ATTEMPT_WINDOW_MS - (now - record.lastAttempt)) / 1000);
    return { allowed: false, waitSec };
  }
  return { allowed: true };
}

function recordPinFailure(ip) {
  if (!ip || isLoopbackIp(ip)) {
    return;
  }
  const now = Date.now();
  if (!failedPinAttempts.has(ip) && failedPinAttempts.size >= MAX_PIN_ENTRIES) {
    pruneFailedAttempts(now);
  }
  const record = failedPinAttempts.get(ip) || { count: 0, lastAttempt: now };
  record.count += 1;
  record.lastAttempt = now;
  // Re-insert to refresh insertion order for LRU eviction
  failedPinAttempts.delete(ip);
  failedPinAttempts.set(ip, record);
}

function resetPinFailure(ip) {
  if (!ip || isLoopbackIp(ip)) return;
  failedPinAttempts.delete(ip);
}

function getFailedAttemptsSize() {
  return failedPinAttempts.size;
}

function hasPinFailure(ip) {
  return failedPinAttempts.has(ip);
}

/**
 * Render lightweight secure PIN entry HTML page for browser visitors.
 */
function renderPinEntryPage() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Konoha Remote Ingress</title>',
    '  <style>',
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }',
    '    .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2rem; max-width: 400px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; }',
    '    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 700; color: #38bdf8; }',
    '    p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }',
    '    input { width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid #475569; background: #0f172a; color: #fff; font-size: 1.25rem; text-align: center; letter-spacing: 0.25em; margin-bottom: 1rem; }',
    '    input:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }',
    '    button { width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: none; background: #0284c7; color: #fff; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s; }',
    '    button:hover { background: #0369a1; }',
    '    .err { color: #f87171; font-size: 0.875rem; margin-top: 0.75rem; display: none; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="card">',
    '    <h1>🍃 Konoha Ingress</h1>',
    '    <p>Protected Remote Access. Enter your access PIN.</p>',
    '    <form id="pinForm">',
    '      <input type="password" id="pinInput" placeholder="••••••" maxlength="12" autofocus required autocomplete="current-password" />',
    '      <button type="submit">Unlock Dashboard</button>',
    '      <div id="errMsg" class="err">Invalid Access PIN</div>',
    '    </form>',
    '  </div>',
    '  <script>',
    '    document.getElementById("pinForm").onsubmit = async (e) => {',
    '      e.preventDefault();',
    '      const pin = document.getElementById("pinInput").value.trim();',
    '      const res = await fetch("/api/v1/auth/pin", {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json" },',
    '        body: JSON.stringify({ pin })',
    '      });',
    '      const data = await res.json();',
    '      if (data.ok) {',
    '        window.location.reload();',
    '      } else {',
    '        const err = document.getElementById("errMsg");',
    '        err.style.display = "block";',
    '        err.textContent = data.error || "Invalid Access PIN";',
    '      }',
    '    };',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
}

module.exports = {
  isRemoteRequest,
  verifyRemoteAccess,
  checkPinRateLimit,
  recordPinFailure,
  resetPinFailure,
  renderPinEntryPage,
  getFailedAttemptsSize,
  hasPinFailure,
  setCachedJwks,
  clearJwksCache,
  verifyCfAccessJwt
};
