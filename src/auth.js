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
const DEFAULT_BOOTSTRAP_PASSWORD = 'konohagakure';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
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

/**
 * Load or initialize the web auth configuration.
 */
function getAuthConfig() {
  try {
    if (fs.existsSync(AUTH_CONFIG_FILE)) {
      const content = fs.readFileSync(AUTH_CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.hash && parsed.salt) {
        return parsed;
      }
    }
  } catch (_) {
    // Fall back to initializing default bootstrap config
  }

  // Initialize with bootstrap password
  const initial = hashPassword(DEFAULT_BOOTSTRAP_PASSWORD);
  const config = {
    format: initial.format,
    salt: initial.salt,
    hash: initial.hash,
    is_bootstrap: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    const authDir = path.dirname(AUTH_CONFIG_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(AUTH_CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (_) {
    // Best effort persistence
  }

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
  fs.writeFileSync(AUTH_CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
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

  const config = getAuthConfig();
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

  const config = getAuthConfig();
  if (currentPassword !== undefined) {
    const isValid = verifyPasswordHash(currentPassword, config);
    if (!isValid) {
      return { success: false, status: 400, error: 'Current password is incorrect' };
    }
  }

  if (newPassword === DEFAULT_BOOTSTRAP_PASSWORD) {
    return { success: false, status: 400, error: 'Cannot set password to the default bootstrap credential' };
  }

  const newHash = hashPassword(newPassword);
  config.format = newHash.format;
  config.salt = newHash.salt;
  config.hash = newHash.hash;
  config.is_bootstrap = false;
  config.updated_at = new Date().toISOString();

  saveAuthConfig(config);

  // Update session state
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
  const config = getAuthConfig();

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
