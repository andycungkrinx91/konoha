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
 *
 * `~/.konoha/config.json` is the single place a user configures Konoha. Two
 * mechanisms read it:
 *   - `getConfigValue(key)` at the consumer, for code we own end to end;
 *   - `applyConfigEnv()`, which seeds `process.env` once at startup so the
 *     existing `process.env.X` reads (and third-party-shaped code paths) honour
 *     config.json without a rewrite.
 * Precedence in both cases: explicit environment > config.json > default.
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
 *
 * Every default here must equal what the consumer already falls back to, so an
 * absent config.json changes no behaviour.
 */
const CONFIG_DEFAULTS = Object.freeze({
  // install / upgrade / migrate
  migrate_time_budget_seconds: 900,
  advisor_mode: null,
  spinners: true,
  offline_search: false,
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
  // mcp server orphan guard (src/mcp_orphan_guard.js)
  mcp_orphan_parent_poll_ms: 30000,
  mcp_stdio_idle_timeout_ms: 14400000,
  mcp_daemon_superseded_poll_ms: 30000,
  // budgets / thresholds
  minimum_confidence: 98,
  skill_top_k: 5,
  skill_candidate_k: 25,
  semantic_top_k: 10,
  doc_gate_max_attempts: 3,
  bridge_max_tool_output_chars: 24000,
  qa_retention_count: 20,
  // sessions / web auth
  session_ttl_ms: 43200000,
  web_token_ttl_ms: 43200000,
  web_token_grace_ms: 300000,
  disable_rate_limit: false,
  // ports
  ui_port: 1404,
  gateway_port: 19999,
  bridge_port: 1313,
  nine_router_port: 20128,
  ollama_port: 11434,
  llamacpp_port: 8080,
  lmstudio_port: 1234,
  vllm_port: 8000,
  // search / integrations
  searxng_url: null,
  searxng_instances_url: 'https://searx.space/data/instances.json',
  duckduckgo_url: 'https://html.duckduckgo.com/html/',
  duckduckgo_site_url: 'https://duckduckgo.com/',
  startpage_url: 'https://www.startpage.com/sp/search',
  wikipedia_url: 'https://en.wikipedia.org/w/api.php',
  skills_registry_url: 'https://skills.sh/api/search',
  taste_skill_docs_url: 'https://www.tasteskill.dev/guide',
  nine_router_url: null,
  nine_router_api_key: null,
  openai_base_url: 'https://api.openai.com/v1',
  anthropic_base_url: 'https://api.anthropic.com/v1',
  // 3D pipeline
  blender_release_index: 'https://download.blender.org/release/',
  blender_bin: null,
  dcc_mcp_version: null,
  dcc_mcp_pypi_url: 'https://pypi.org/pypi/dcc-mcp-blender/json',
  telegram_api_url: 'https://api.telegram.org',
  uv_install_url: 'https://astral.sh/uv',
  npm_registry_url: 'https://registry.npmjs.org',
  github_url: 'https://github.com',
  github_api_url: 'https://api.github.com',
  konoha_release_base_url: 'https://github.com/andycungkrinx91/konoha/releases/download',
  rtk_install_url: 'https://github.com/rtk-ai/rtk',
  rtk_install_script_url: 'https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh',
  framer_marketplace_url: 'https://www.framer.com/marketplace/components/',
  three_d_model: null,
  three_d_output_dir: null,
  cycles_samples: 64,
  // local toolchain
  onnx_threads: 1,
  embed_pace_ms: 0,
  chrome_path: null,
  toolchain_dir: null,
  sqlite_vec_dir: null,
  custom_tools_path: null
});

/**
 * Keys whose value is a credential. `konoha config set` stores them through
 * `enc:v1:` (src/crypto_vault.js) and non-JSON `config get`/`list` mask them.
 * `--json` output stays raw so scripts keep working.
 */
const SECRET_KEYS = Object.freeze([
  'master_key',
  'web_token',
  'bootstrap_password',
  'nine_router_api_key',
  'openai_api_key',
  'anthropic_api_key'
]);

/**
 * config.json key -> environment names that already read it. `applyConfigEnv`
 * seeds the FIRST name; every name is listed so a shell-set variable (any of
 * them) still wins.
 *
 * `turn_budget` and `hitl_mode` have no entry in CONFIG_DEFAULTS on purpose:
 * their consumers own the default (8192 tokens, 'enabled'), and an unset key
 * must keep reporting `(unset)` rather than inventing a value.
 */
const ENV_ALIASES = Object.freeze({
  // budgets
  turn_budget: ['KONOHA_TURN_BUDGET'],
  hitl_mode: ['KONOHA_HITL_MODE'],
  advisor_mode: ['KONOHA_ADVISOR_MODE'],
  spinners: ['KONOHA_SPINNERS'],
  offline_search: ['KONOHA_OFFLINE_SEARCH'],
  migrate_time_budget_seconds: ['KONOHA_MIGRATE_TIME_BUDGET'],
  // sessions / web auth
  session_ttl_ms: ['KONOHA_SESSION_TTL_MS'],
  web_token_ttl_ms: ['KONOHA_WEB_TOKEN_TTL_MS'],
  web_token_grace_ms: ['KONOHA_WEB_TOKEN_GRACE_MS'],
  disable_rate_limit: ['KONOHA_DISABLE_RATE_LIMIT'],
  // secrets
  master_key: ['KONOHA_MASTER_KEY'],
  web_token: ['KONOHA_WEB_TOKEN'],
  bootstrap_password: ['KONOHA_BOOTSTRAP_PASSWORD'],
  nine_router_api_key: ['KONOHA_9ROUTER_API_KEY'],
  openai_api_key: ['OPENAI_API_KEY'],
  anthropic_api_key: ['ANTHROPIC_API_KEY'],
  // integrations
  nine_router_port: ['KONOHA_9ROUTER_PORT'],
  nine_router_url: ['KONOHA_9ROUTER_URL'],
  openai_base_url: ['OPENAI_BASE_URL'],
  anthropic_base_url: ['ANTHROPIC_BASE_URL'],
  searxng_url: ['KONOHA_SEARXNG_URL', 'SEARXNG_URL'],
  searxng_instances_url: ['KONOHA_SEARXNG_INSTANCES_URL'],
  duckduckgo_url: ['KONOHA_DUCKDUCKGO_URL'],
  duckduckgo_site_url: ['KONOHA_DUCKDUCKGO_SITE_URL'],
  startpage_url: ['KONOHA_STARTPAGE_URL'],
  wikipedia_url: ['KONOHA_WIKIPEDIA_URL'],
  skills_registry_url: ['KONOHA_SKILLS_REGISTRY_URL'],
  taste_skill_docs_url: ['KONOHA_TASTE_SKILL_DOCS'],
  blender_release_index: ['KONOHA_BLENDER_RELEASE_INDEX'],
  // local toolchain
  blender_bin: ['KONOHA_BLENDER_BIN'],
  dcc_mcp_version: ['KONOHA_DCC_MCP_VERSION'],
  dcc_mcp_pypi_url: ['KONOHA_DCC_MCP_PYPI_URL'],
  telegram_api_url: ['KONOHA_TELEGRAM_API_URL'],
  uv_install_url: ['KONOHA_UV_INSTALL_URL'],
  npm_registry_url: ['KONOHA_NPM_REGISTRY_URL'],
  github_url: ['KONOHA_GITHUB_URL'],
  github_api_url: ['KONOHA_GITHUB_API_URL'],
  konoha_release_base_url: ['KONOHA_RELEASE_BASE_URL'],
  rtk_install_url: ['KONOHA_RTK_INSTALL_URL'],
  rtk_install_script_url: ['KONOHA_RTK_INSTALL_SCRIPT_URL'],
  framer_marketplace_url: ['KONOHA_FRAMER_MARKETPLACE_URL'],
  three_d_model: ['KONOHA_3D_MODEL'],
  three_d_output_dir: ['KONOHA_3D_OUTPUT_DIR'],
  cycles_samples: ['KONOHA_CYCLES_SAMPLES'],
  onnx_threads: ['KONOHA_ONNX_THREADS'],
  embed_pace_ms: ['KONOHA_EMBED_PACE_MS'],
  qa_retention_count: ['KONOHA_QA_RETENTION_COUNT'],
  doc_gate_max_attempts: ['KONOHA_DOC_GATE_MAX_ATTEMPTS'],
  bridge_max_tool_output_chars: ['KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS'],
  chrome_path: ['KONOHA_CHROME_PATH'],
  toolchain_dir: ['KONOHA_TOOLCHAIN_DIR'],
  sqlite_vec_dir: ['KONOHA_SQLITE_VEC_DIR'],
  custom_tools_path: ['KONOHA_CUSTOM_TOOLS_PATH']
});

const DEFAULT_KEYS = Object.keys(CONFIG_DEFAULTS);

/** Every key `konoha config set` accepts: declared defaults plus aliased keys. */
const ALLOWED_KEYS = Object.freeze(
  Array.from(new Set([...DEFAULT_KEYS, ...Object.keys(ENV_ALIASES)]))
);

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

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/** Environment strings are consumed as `'1'`/`'0'` for booleans, decimal for numbers. */
function toEnvString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

/**
 * Seed `process.env` from `~/.konoha/config.json` so code that reads
 * `process.env.X` directly honours the single config file.
 *
 * Only user-set keys are seeded: a key that falls back to CONFIG_DEFAULTS is
 * left alone, because its consumer already owns that default and seeding would
 * shadow DB-stored settings with a value the user never chose.
 *
 * @param {{env?: object, config?: object, decrypt?: (v: string) => string}} [options]
 * @returns {string[]} environment names that were seeded
 */
function applyConfigEnv(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readUserConfig();
  const seeded = [];
  for (const [key, names] of Object.entries(ENV_ALIASES)) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
    let value = config[key];
    if (isEncryptedValue(value)) {
      // Without the vault key the ciphertext is useless; the caller opts in.
      if (typeof options.decrypt !== 'function') continue;
      value = options.decrypt(value);
    }
    const str = toEnvString(value);
    if (str === null) continue;
    for (const name of names) {
      if (env[name] !== undefined) continue;
      env[name] = str;
      seeded.push(name);
    }
  }
  return seeded;
}

module.exports = {
  CONFIG_FILE,
  CONFIG_DEFAULTS,
  DEFAULT_KEYS,
  SECRET_KEYS,
  ENV_ALIASES,
  ALLOWED_KEYS,
  readUserConfig,
  getConfig,
  getConfigValue,
  applyConfigEnv,
  isEncryptedValue
};
