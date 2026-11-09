'use strict';

/**
 * bin/lib/config_defaults.js — dependency-free source of every tunable default.
 *
 * Deliberately does NOT require `bin/lib/paths.js`: `paths.js` needs these
 * values at load time, so importing it here would create a cycle. The config
 * file location is therefore derived from the home directory directly.
 *
 * No caching: `konoha config set` followed by `konoha config get` must observe
 * the new value, and a stale in-memory copy would break that. Resolving a key
 * costs one small file read and the file is usually absent.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const CONFIG_FILE = path.join(HOME, '.konoha', 'config.json');

/**
 * Effective defaults, expressed in code so `konoha upgrade` never has to merge a
 * shipped file into the user's `~/.konoha/config.json`. A user override wins; an
 * unset key reads straight from here.
 */
const CONFIG_DEFAULTS = Object.freeze({
  // install / upgrade / migrate
  migrate_time_budget_seconds: 900,
  install_build_migrate_timeout_ms: 900000,
  git_timeout_ms: 30000,
  sqlite_busy_timeout_ms: 5000,
  inference_timeout_ms: 900000,
  stream_timeout_ms: 300000,
  url_timeout_ms: 20000,
  probe_timeout_ms: 1500,
  aislop_gate_timeout_ms: 180000,
  live_glb_poll_timeout_ms: 15000,
  ui_ready_timeout_ms: 180000,
  notify_dedupe_ttl_ms: 180000,
  // budgets / thresholds
  minimum_confidence: 98,
  skill_top_k: 5,
  skill_candidate_k: 25,
  semantic_top_k: 10,
  // ports
  ui_port: 1404,
  gateway_port: 19999,
  bridge_port: 1313,
  nine_router_port: 20128
});

const DEFAULT_KEYS = Object.keys(CONFIG_DEFAULTS);

function readUserConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Effective value of one configuration key.
 *
 * @param {string} key
 * @param {{config?: object}} [options] pre-read config, to avoid re-reading the file
 * @returns {{key: string, value: *, source: 'default'|'user'}}
 */
function getConfig(key, options = {}) {
  const config = options.config || readUserConfig();
  if (Object.prototype.hasOwnProperty.call(config, key)) {
    return { key, value: config[key], source: 'user' };
  }
  if (Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key)) {
    return { key, value: CONFIG_DEFAULTS[key], source: 'default' };
  }
  return { key, value: null, source: 'default' };
}

/** Effective value only. `fallback` covers keys that have no default. */
function getConfigValue(key, fallback = undefined) {
  const resolved = getConfig(key);
  return resolved.value === null ? fallback : resolved.value;
}

module.exports = {
  CONFIG_FILE,
  CONFIG_DEFAULTS,
  DEFAULT_KEYS,
  readUserConfig,
  getConfig,
  getConfigValue
};