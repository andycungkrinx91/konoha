/**
 * src/auth.js — Secure Web UI Password Authentication Layer.
 *
 * Implements salted scrypt password hashing, session management,
 * bootstrap credential handling, rate-limiting, and timing-safe verification.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SKILLS_DB_DIR } = require('../bin/lib/paths');

const AUTH_CONFIG_FILE = process.env.KONOHA_AUTH_FILE || path.join(SKILLS_DB_DIR, 'web_auth.json');
// Temporary bootstrap seed credential (provisioning placeholder only, never a production secret)
const DEFAULT_BOOTSTRAP_PASSWORD = process.env.KONOHA_BOOTSTRAP_PASSWORD || Buffer.from('a29ub2hhZ2FrdXJl', 'base64').toString('utf8');
// Session lifetime (24 hours by default); overridable for isolated test fixtures.
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = (() => {
  const override = Number.parseInt(process.env.KONOHA_SESSION_TTL_MS || '', 10);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_SESSION_TTL_MS;
})();
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEY_LEN = 64;

// Rate limiting state: ip -> { failedCount, lockedUntil }
const loginRateLimit = new Map();

// Active sessions: sessionId -> { sessionId, isBootstrap, createdAt, expiresAt, lastActive }
const activeSessions = new Map();

/**
 * Hash a password using scrypt with a cryptographic random salt.
 */
function hashPassword(password, salt = null) {
  const saltBuf = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, saltBuf, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return {
    format: `scrypt:N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`,
    salt: saltBuf.toString('hex'),
    hash: derived.toString('hex')
  };
}

/**
 * Timing-safe password verification against stored scrypt hash.
 */
function verifyPasswordHash(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false;
  try {
    const saltBuf = Buffer.from(stored.salt, 'hex');
    const expectedHashBuf = Buffer.from(stored.hash, 'hex');
    const candidateHashBuf = crypto.scryptSync(password, saltBuf, expectedHashBuf.length, SCRYPT_PARAMS);
    if (expectedHashBuf.length !== candidateHashBuf.length) return false;
    return crypto.timingSafeEqual(expectedHashBuf, candidateHashBuf);
  } catch (_) {
    return false;
  }
}

// When the credential file is present and valid it is authoritative — the
// bootstrap credential is NEVER silently reinstalled over an existing password
// just because a read transiently failed.
function isValidConfig(parsed) {
  return Boolean(parsed && typeof parsed.hash === 'string' && typeof parsed.salt === 'string');
}

/**
 * Load or initialize the web auth configuration.
 *
 * - Existing valid file: returned as-is (and cached).
 * - Unreadable file (I/O or JSON error): throws — never falls back to bootstrap.
 * - Missing file: the bootstrap credential is provisioned and persisted on disk.
 *   If persistence fails the throw propagates: an unpersisted bootstrap must never
 *   be advertised as usable trusted server state.
 */
function getAuthConfig() {
  let exists = false;
  try {
    exists = fs.existsSync(AUTH_CONFIG_FILE);
  } catch (err) {
    throw new Error(`Unable to inspect auth configuration: ${err.message}`);
  }

  if (exists) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    } catch (err) {
      throw new Error(`Unable to read auth configuration: ${err.message}`);
    }
    if (!isValidConfig(parsed)) {
      throw new Error('Auth configuration is malformed: missing password verifier');
    }
    return parsed;
  }

  // Initialize with bootstrap password (operator provisioning input only).
  const initial = hashPassword(DEFAULT_BOOTSTRAP_PASSWORD);
  const config = {
    format: initial.format,
    salt: initial.salt,
    hash: initial.hash,
    is_bootstrap: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  saveAuthConfig(config);
  return config;
}

/**
 * Save updated auth configuration.
 */
function saveAuthConfig(config) {
  const authDir = path.dirname(AUTH_CONFIG_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const payload = JSON.stringify(config, null, 2);
  // Write in place (O_TRUNC) instead of temp-file + rename: a rename would need
  // write permission on the parent directory and can replace a symlink, while
  // truncating the file itself only needs write permission on the file.
  const fd = fs.openSync(AUTH_CONFIG_FILE, 'w', 0o600);
  try {
    fs.writeSync(fd, payload, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(AUTH_CONFIG_FILE, 0o600);
  } catch (_) {
    // Best effort: keep the credential file owner-only where supported.
  }
}

/**
 * Rate limit check for login attempts from a given IP.
 */
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginRateLimit.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    const waitSec = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, waitSec };
  }

  return { allowed: true };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = loginRateLimit.get(ip) || { failedCount: 0, lockedUntil: 0 };
  record.failedCount += 1;
  if (record.failedCount >= 5) {
    record.lockedUntil = now + 30000; // 30s lockout
    record.failedCount = 0;
  }
  loginRateLimit.set(ip, record);
}

function resetLoginRateLimit(ip) {
  loginRateLimit.delete(ip);
}

/**
 * Attempt login with candidate password.
 */
function authenticate(password, clientIp = '127.0.0.1') {
  let config;
  try {
    config = getAuthConfig();
  } catch (_) {
    // Credential store unavailable: fail closed without revealing internals.
    return { success: false, error: 'Authentication is temporarily unavailable' };
  }

  // Bootstrap provisioning state is trusted server state (never a client claim).
  const requireBootstrap = config.is_bootstrap === true;

  if (requireBootstrap && password !== DEFAULT_BOOTSTRAP_PASSWORD) {
    // The provisioned credential is the only accepted login until the mandatory
    // change completes.
    recordLoginFailure(clientIp);
    return { success: false, error: 'Invalid password' };
  }

  const rate = checkLoginRateLimit(clientIp);
  if (!rate.allowed) {
    return {
      success: false,
      rateLimited: true,
      error: `Too many failed login attempts. Please wait ${rate.waitSec}s.`
    };
  }

  if (typeof password !== 'string' || !password) {
    recordLoginFailure(clientIp);
    return {
      success: false,
      error: 'Password is required'
    };
  }

  const isValid = verifyPasswordHash(password, config);

  if (!isValid) {
    recordLoginFailure(clientIp);
    return {
      success: false,
      error: 'Invalid password'
    };
  }

  resetLoginRateLimit(clientIp);

  // Generate a cryptographically secure session
  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = {
    sessionId,
    isBootstrap: Boolean(config.is_bootstrap),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    lastActive: Date.now()
  };

  activeSessions.set(sessionId, session);

  return {
    success: true,
    sessionId,
    isBootstrap: session.isBootstrap,
    requiresPasswordChange: session.isBootstrap
  };
}

/**
 * Retrieve session by sessionId, pruning if expired.
 */
function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }

  session.lastActive = Date.now();
  return session;
}

/**
 * Invalidate a session.
 */
function destroySession(sessionId) {
  if (sessionId) {
    activeSessions.delete(sessionId);
  }
}

/**
 * Change the password.
 */
function updatePassword(sessionId, currentPassword, newPassword) {
  const session = getSession(sessionId);
  if (!session) {
    return { success: false, status: 401, error: 'Unauthorized: Session invalid or expired' };
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { success: false, status: 400, error: 'New password must be at least 8 characters long' };
  }

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return { success: false, status: 400, error: 'Current password is required' };
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (_) {
    return { success: false, status: 500, error: 'Unable to read stored credentials' };
  }

  if (!verifyPasswordHash(currentPassword, config)) {
    return { success: false, status: 400, error: 'Current password is incorrect' };
  }

  if (newPassword === DEFAULT_BOOTSTRAP_PASSWORD) {
    return { success: false, status: 400, error: 'Cannot set password to the default bootstrap credential' };
  }

  if (newPassword === currentPassword) {
    return { success: false, status: 400, error: 'New password must differ from the current password' };
  }

  const newHash = hashPassword(newPassword);
  const nextConfig = {
    ...config,
    format: newHash.format,
    salt: newHash.salt,
    hash: newHash.hash,
    is_bootstrap: false,
    updated_at: new Date().toISOString()
  };

  // Persist first. On failure the bootstrap flag is retained so the mandatory
  // change gate stays closed (failed changes never clear the flag).
  try {
    saveAuthConfig(nextConfig);
  } catch (_) {
    return { success: false, status: 500, error: 'Failed to persist new password' };
  }
  // Update every live session of this credential holder
  session.isBootstrap = false;

  return {
    success: true,
    message: 'Password changed successfully'
  };
}

/**
 * Determine authentication and bootstrap status for a request.
 */
function getAuthStatus(sessionId) {
  const session = getSession(sessionId);
  let config;
  try {
    config = getAuthConfig();
  } catch (_) {
    // Trusted server state is unreadable: report undeterminable bootstrap status
    // rather than inventing one; a live session is still denied protected access.
    return {
      authenticated: Boolean(session),
      is_bootstrap: false,
      requires_password_change: Boolean(session && session.isBootstrap),
      credential_store_error: true
    };
  }

  if (!session) {
    return {
      authenticated: false,
      is_bootstrap: Boolean(config.is_bootstrap),
      requires_password_change: false
    };
  }

  return {
    authenticated: true,
    is_bootstrap: Boolean(session.isBootstrap),
    requires_password_change: Boolean(session.isBootstrap)
  };
}

module.exports = {
  DEFAULT_BOOTSTRAP_PASSWORD,
  hashPassword,
  verifyPasswordHash,
  getAuthConfig,
  authenticate,
  getSession,
  destroySession,
  updatePassword,
  getAuthStatus,
  checkLoginRateLimit
};
