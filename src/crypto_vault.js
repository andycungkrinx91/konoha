/**
 * Konoha Crypto Vault - AES-256-GCM Secret Encryption Layer
 * Provides authenticated symmetric encryption for sensitive credentials at rest (e.g. Telegram tokens, Cloudflare tunnel tokens).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT = 'konoha-vault-salt-v1';
const PREFIX = 'enc:v1:';

let cachedKey = null;

function getKeyFilePath() {
  const dbModule = require('./db');
  const dbDir = path.dirname(dbModule.DB_PATH || path.join(os.homedir(), '.konoha', 'konoha.db'));
  return path.join(dbDir, '.vault_key');
}

function getMachineSeed() {
  const parts = [];
  try {
    if (process.platform === 'linux') {
      if (fs.existsSync('/etc/machine-id')) {
        parts.push(fs.readFileSync('/etc/machine-id', 'utf8').trim());
      } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
        parts.push(fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim());
      }
    }
  } catch (_) {
    // Graceful fallback if filesystem machine-id access is restricted
  }
  try {
    parts.push(os.hostname());
    parts.push(os.userInfo().username);
    parts.push(os.homedir());
  } catch (_) {
    // Graceful fallback for non-standard environments
  }
  if (parts.length === 0) {
    parts.push('konoha-machine-seed-fallback');
  }
  return parts.join(':');
}

function getVaultKey() {
  if (cachedKey) {
    return cachedKey;
  }

  if (process.env.KONOHA_MASTER_KEY) {
    cachedKey = crypto.scryptSync(process.env.KONOHA_MASTER_KEY, SALT, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
    return cachedKey;
  }

  const keyFilePath = getKeyFilePath();
  try {
    if (fs.existsSync(keyFilePath)) {
      const raw = fs.readFileSync(keyFilePath, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        cachedKey = Buffer.from(raw, 'hex');
        return cachedKey;
      }
    }
    const dir = path.dirname(keyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const newKey = crypto.randomBytes(KEY_LENGTH);
    fs.writeFileSync(keyFilePath, newKey.toString('hex') + '\n', { mode: 0o600 });
    cachedKey = newKey;
    return cachedKey;
  } catch (_) {
    const seed = getMachineSeed();
    cachedKey = crypto.scryptSync(seed, SALT, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
    return cachedKey;
  }
}

function resetVaultKeyCache() {
  cachedKey = null;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') {
    return '';
  }
  const str = String(plainText);
  if (isEncrypted(str)) {
    return str;
  }

  const key = getVaultKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptSecret(cipherText) {
  if (cipherText === null || cipherText === undefined || cipherText === '') {
    return '';
  }
  const str = String(cipherText);
  if (!isEncrypted(str)) {
    return str;
  }

  const parts = str.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    return str;
  }

  try {
    const key = getVaultKey();
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const ciphertext = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[CryptoVault] Decryption failed (integrity verification error):', err.message);
    return '';
  }
}

function maskSecret(value, visibleCount = 8) {
  if (!value) return '';
  const plain = decryptSecret(value);
  if (!plain) return '';
  if (plain.length <= visibleCount) return '***';
  return `${plain.slice(0, visibleCount)}...`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  maskSecret,
  getVaultKey,
  resetVaultKeyCache
};
