/**
 * Test Suite: Konoha Crypto Vault & At-Rest Encryption
 * Verifies AES-256-GCM authenticated encryption for sensitive secrets at rest.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate test database
const tmpDir = path.join(os.tmpdir(), `konoha-crypto-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, 'test.db');
process.env.KONOHA_DB_PATH = testDbPath;

const db = require('../src/db');
db.setupSchema(db.getConnection());

const vault = require('../src/crypto_vault');
const tgConfig = require('../src/telegram/config');
const tunnelConfig = require('../src/tunnel/config');

async function runTests() {
  console.log('Running test_crypto_vault.js...');

  // 1. Encryption format and roundtrip
  const testPlain = '123456789:AAExampleSecretTokenForTestingOnly_999';
  const cipher1 = vault.encryptSecret(testPlain);
  assert.ok(vault.isEncrypted(cipher1), 'Ciphertext must be recognized as encrypted');
  assert.ok(cipher1.startsWith('enc:v1:'), 'Ciphertext must start with enc:v1:');
  
  const parts = cipher1.split(':');
  assert.strictEqual(parts.length, 5, 'Envelope format must be enc:v1:<iv>:<tag>:<ciphertext>');
  assert.strictEqual(parts[2].length, 24, 'IV must be 12 bytes (24 hex characters)');
  assert.strictEqual(parts[3].length, 32, 'Tag must be 16 bytes (32 hex characters)');
  assert.ok(parts[4].length > 0, 'Ciphertext must not be empty');

  const decrypted1 = vault.decryptSecret(cipher1);
  assert.strictEqual(decrypted1, testPlain, 'Decrypted secret must match original plaintext');

  // 2. Semantic security (different IV on each encryption)
  const cipher2 = vault.encryptSecret(testPlain);
  assert.notStrictEqual(cipher1, cipher2, 'Subsequent encryptions of same text must have unique random IVs');
  assert.strictEqual(vault.decryptSecret(cipher2), testPlain, 'Both ciphertexts must decrypt to same plaintext');

  // 3. Idempotency (prevent double encryption)
  const doubleEnc = vault.encryptSecret(cipher1);
  assert.strictEqual(doubleEnc, cipher1, 'Encrypting an already encrypted payload must return it as-is');

  // 4. Backward compatibility with plaintext
  const legacyPlain = 'legacy_plaintext_api_token';
  assert.strictEqual(vault.decryptSecret(legacyPlain), legacyPlain, 'Plaintext without enc:v1: must pass through');

  // 5. Tamper resistance (GMAC authentication check)
  const tamperedParts = [...parts];
  tamperedParts[4] = '00' + tamperedParts[4].slice(2); // alter 1 byte of ciphertext
  const tampered = tamperedParts.join(':');
  const tamperedResult = vault.decryptSecret(tampered);
  assert.strictEqual(tamperedResult, '', 'Tampered ciphertext must fail authentication and return empty string');

  // 6. Null and empty handling
  assert.strictEqual(vault.encryptSecret(''), '', 'Empty string encryption must be empty string');
  assert.strictEqual(vault.encryptSecret(null), '', 'Null encryption must be empty string');
  assert.strictEqual(vault.decryptSecret(''), '', 'Empty string decryption must be empty string');
  assert.strictEqual(vault.decryptSecret(null), '', 'Null decryption must be empty string');

  // 7. Masking helper
  const masked = vault.maskSecret(cipher1, 10);
  assert.strictEqual(masked, '123456789:...', 'Secret must be unmasked then truncated for display');
  assert.strictEqual(vault.maskSecret(''), '', 'Empty secret masking must return empty');

  // 8. Telegram Bot Token At-Rest SQLite Encryption
  const rawBotToken = '987654321:AAFakeBotFatherGeneratedToken_XYZ';
  const rawSecret = 'webhook_auth_secret_token_123';
  tgConfig.saveTelegramConfig({
    bot_token: rawBotToken,
    webhook_secret: rawSecret,
    chat_id: '123456789',
    mode: 'two_way',
    enabled: true
  });

  const rawTgRow = db.getConnection().prepare('SELECT bot_token, webhook_secret FROM telegram_config WHERE id = 1').get();
  assert.ok(rawTgRow.bot_token.startsWith('enc:v1:'), 'Telegram bot_token in SQLite must be encrypted at rest');
  assert.ok(!rawTgRow.bot_token.includes(rawBotToken), 'Raw SQLite bot_token must NEVER contain plaintext');
  assert.ok(rawTgRow.webhook_secret.startsWith('enc:v1:'), 'Telegram webhook_secret in SQLite must be encrypted at rest');
  assert.ok(!rawTgRow.webhook_secret.includes(rawSecret), 'Raw SQLite webhook_secret must NEVER contain plaintext');

  const loadedTg = tgConfig.getTelegramConfig();
  assert.strictEqual(loadedTg.bot_token, rawBotToken, 'Telegram bot_token must be transparently decrypted on read');
  assert.strictEqual(loadedTg.webhook_secret, rawSecret, 'Telegram webhook_secret must be transparently decrypted on read');

  // 9. Cloudflare Tunnel Token At-Rest SQLite Encryption
  const rawTunnelToken = 'eyJhIjoiY2xvdWRmbGFyZS1hdXRoLXRva2VuLWV4YW1wbGUifQ';
  const rawPin = '849201';
  tunnelConfig.saveTunnelConfig({
    token: rawTunnelToken,
    auth_pin: rawPin,
    provider: 'cloudflare',
    mode: 'named',
    custom_domain: 'konoha.internal'
  });

  const rawTunnelRow = db.getConnection().prepare('SELECT token, auth_pin FROM tunnel_config WHERE id = 1').get();
  assert.ok(rawTunnelRow.token.startsWith('enc:v1:'), 'Tunnel token in SQLite must be encrypted at rest');
  assert.ok(!rawTunnelRow.token.includes(rawTunnelToken), 'Raw SQLite tunnel token must NEVER contain plaintext');
  assert.ok(rawTunnelRow.auth_pin.startsWith('enc:v1:'), 'Tunnel auth_pin in SQLite must be encrypted at rest');
  assert.ok(!rawTunnelRow.auth_pin.includes(rawPin), 'Raw SQLite tunnel auth_pin must NEVER contain plaintext');

  const loadedTunnel = tunnelConfig.getTunnelConfig();
  assert.strictEqual(loadedTunnel.token, rawTunnelToken, 'Tunnel token must be transparently decrypted on read');
  assert.strictEqual(loadedTunnel.auth_pin, rawPin, 'Tunnel auth_pin must be transparently decrypted on read');

  // Cleanup test database
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('✓ All Crypto Vault & At-Rest Encryption tests passed cleanly.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
