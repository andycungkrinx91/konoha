'use strict';

/**
 * src/config_access.js — layout-tolerant access to bin/lib/config_defaults.js.
 *
 * Top-level src/*.js are mirrored FLAT into ~/.konoha/, where `../bin/lib/...`
 * escapes to ~/bin/lib/... and does not exist. Nested src files see a real
 * ../bin. Resolve both, same candidate list canonical_agents.js already uses.
 *
 * A mirror without bin/lib is a broken install, not a degraded mode: throwing
 * here surfaces it at startup instead of silently running on wrong tunables.
 */

const CANDIDATES = ['../bin/lib/config_defaults', './bin/lib/config_defaults', '../../bin/lib/config_defaults'];

function load() {
  for (const candidate of CANDIDATES) {
    try {
      return require(candidate);
    } catch (_) { /* candidate unavailable in this layout */ }
  }
  throw new Error(
    `config_defaults is unreachable (tried ${CANDIDATES.join(', ')}); ` +
    'the install is incomplete — re-run `konoha upgrade` or reinstall.'
  );
}

const configDefaults = load();

/**
 * `applyConfigEnv` for server processes: decrypts `enc:v1:` values through the
 * local vault so a `konoha config set openai_api_key` reaches code that reads
 * `process.env.OPENAI_API_KEY` directly. The vault require stays lazy — it
 * reaches `./db`, which requires this module's caller chain.
 */
function applyConfigEnv(options = {}) {
  let decrypt = options.decrypt;
  if (!decrypt) {
    try {
      decrypt = require('./crypto_vault').decryptSecret;
    } catch (err) {
      // Vault unavailable: encrypted values stay unseeded rather than failing
      // process startup. Surfaced so the cause is not silent.
      process.emitWarning(`konoha: config secrets not seeded (${err.message})`, 'KonohaConfigWarning');
    }
  }
  return configDefaults.applyConfigEnv({ ...options, decrypt });
}

/**
 * `getConfigValue` that transparently decrypts `enc:v1:` values, so a secret set
 * through `konoha config set` is usable without every caller knowing about the
 * vault. Non-encrypted values pass straight through.
 */
function getConfigValue(key, fallback = undefined) {
  const value = configDefaults.getConfigValue(key, fallback);
  if (typeof value !== 'string' || !configDefaults.isEncryptedValue(value)) return value;
  let decrypted;
  try {
    decrypted = require('./crypto_vault').decryptSecret(value);
  } catch (err) {
    // A ciphertext we cannot decrypt is a real fault; surface it, then use the
    // caller's declared fallback.
    process.emitWarning(`konoha: cannot decrypt config key "${key}" (${err.message})`, 'KonohaConfigWarning');
    decrypted = fallback;
  }
  return decrypted;
}

module.exports = {
  CONFIG_DEFAULTS: configDefaults.CONFIG_DEFAULTS,
  DEFAULT_KEYS: configDefaults.DEFAULT_KEYS,
  SECRET_KEYS: configDefaults.SECRET_KEYS,
  ENV_ALIASES: configDefaults.ENV_ALIASES,
  ALLOWED_KEYS: configDefaults.ALLOWED_KEYS,
  getConfigValue,
  getConfig: configDefaults.getConfig,
  readUserConfig: configDefaults.readUserConfig,
  applyConfigEnv,
  isEncryptedValue: configDefaults.isEncryptedValue
};