'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function getAkatsukiConfigPath(customPath = null) {
  if (customPath && typeof customPath === 'string') {
    return path.resolve(customPath);
  }
  if (process.env.KONOHA_AKATSUKI_CONFIG) {
    return path.resolve(process.env.KONOHA_AKATSUKI_CONFIG);
  }
  return path.join(os.homedir(), '.konoha', 'akatsuki_config.json');
}

function getDefaultMode() {
  return 'blue';
}

function getDefaultEnv() {
  return 'docker';
}

/**
 * Load persistent Akatsuki configuration.
 *
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, mode: 'blue'|'red', env: 'docker'|'lxc', updated_at?: string, updated_by?: string }}
 */
function loadAkatsukiConfig(options = {}) {
  const configPath = getAkatsukiConfigPath(options.config_path || options.configPath);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        let mode = getDefaultMode();
        let env = getDefaultEnv();

        if (parsed.mode === 'blue' || parsed.mode === 'red') {
          mode = parsed.mode;
        } else if (parsed.mode === 'lxc' || parsed.mode === 'docker') {
          env = parsed.mode;
          mode = parsed.redteam_enabled ? 'red' : 'blue';
        }

        if (parsed.env === 'lxc' || parsed.env === 'docker') {
          env = parsed.env;
        }

        if (parsed.redteam_enabled !== undefined && !parsed.mode) {
          mode = parsed.redteam_enabled ? 'red' : 'blue';
        }

        return {
          redteam_enabled: mode === 'red',
          mode,
          env,
          updated_at: parsed.updated_at,
          updated_by: parsed.updated_by
        };
      }
    }
  } catch (_) {
    // Fall back to default
  }

  return {
    redteam_enabled: false,
    mode: getDefaultMode(),
    env: getDefaultEnv()
  };
}

/**
 * Save persistent Akatsuki configuration.
 *
 * @param {Object} config
 * @param {Object} [options={}]
 * @returns {boolean}
 */
function saveAkatsukiConfig(config = {}, options = {}) {
  const configPath = getAkatsukiConfigPath(options.config_path || options.configPath);
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const mode = (config.mode === 'blue' || config.mode === 'red') ? config.mode : getDefaultMode();
    const env = (config.env === 'lxc' || config.env === 'docker') ? config.env : getDefaultEnv();
    const data = {
      redteam_enabled: mode === 'red',
      mode,
      env,
      updated_at: config.updated_at || new Date().toISOString(),
      updated_by: config.updated_by || 'cli'
    };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Set Akatsuki mode ('blue' | 'red') or environment ('lxc' | 'docker').
 *
 * @param {'blue'|'red'|'lxc'|'docker'} mode
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, mode: 'blue'|'red', env: 'docker'|'lxc', updated_at: string }}
 */
function setAkatsukiMode(mode, options = {}) {
  const normMode = String(mode || '').trim().toLowerCase();
  if (normMode === 'lxc' || normMode === 'docker') {
    return setAkatsukiEnv(normMode, options);
  }
  if (normMode !== 'blue' && normMode !== 'red') {
    throw new Error(`Invalid Akatsuki mode "${mode}". Supported modes: blue, red`);
  }
  const current = loadAkatsukiConfig(options);
  current.mode = normMode;
  current.redteam_enabled = normMode === 'red';
  current.updated_at = new Date().toISOString();
  current.updated_by = 'cli';
  saveAkatsukiConfig(current, options);
  return current;
}

/**
 * Set Akatsuki container execution environment ('lxc' | 'docker').
 *
 * @param {'lxc'|'docker'} env
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, mode: 'blue'|'red', env: 'docker'|'lxc', updated_at: string }}
 */
function setAkatsukiEnv(env, options = {}) {
  const normEnv = String(env || '').trim().toLowerCase();
  if (normEnv !== 'lxc' && normEnv !== 'docker') {
    throw new Error(`Invalid Akatsuki env "${env}". Supported envs: lxc, docker`);
  }
  const current = loadAkatsukiConfig(options);
  current.env = normEnv;
  current.updated_at = new Date().toISOString();
  current.updated_by = 'cli';
  saveAkatsukiConfig(current, options);
  return current;
}

/**
 * Get current Akatsuki execution mode ('blue' | 'red').
 *
 * @param {Object} [options={}]
 * @returns {'blue'|'red'}
 */
function getAkatsukiMode(options = {}) {
  if (process.env.KONOHA_AKATSUKI_MODE) {
    const envVal = process.env.KONOHA_AKATSUKI_MODE.trim().toLowerCase();
    if (envVal === 'blue' || envVal === 'red') return envVal;
    if (envVal === 'lxc' || envVal === 'docker') return envVal;
  }
  const config = loadAkatsukiConfig(options);
  return config.mode || getDefaultMode();
}

/**
 * Get current Akatsuki container environment ('docker' | 'lxc').
 *
 * @param {Object} [options={}]
 * @returns {'docker'|'lxc'}
 */
function getAkatsukiEnv(options = {}) {
  if (process.env.KONOHA_AKATSUKI_ENV) {
    const envVal = process.env.KONOHA_AKATSUKI_ENV.trim().toLowerCase();
    if (envVal === 'lxc' || envVal === 'docker') return envVal;
  }
  if (process.env.KONOHA_AKATSUKI_MODE) {
    const envMode = process.env.KONOHA_AKATSUKI_MODE.trim().toLowerCase();
    if (envMode === 'lxc' || envMode === 'docker') return envMode;
  }
  const config = loadAkatsukiConfig(options);
  return config.env || getDefaultEnv();
}

/**
 * Set Red-Team feature state (enable or disable).
 *
 * @param {boolean} enabled
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, updated_at: string }}
 */
function setRedTeamEnabled(enabled, options = {}) {
  return setAkatsukiMode(enabled ? 'red' : 'blue', options);
}

/**
 * Check whether Red-Team offensive operations are currently enabled.
 *
 * Precedence:
 * 1. Explicit option override (for test harnesses / programmatic contexts)
 * 2. Environment variable KONOHA_AKATSUKI_REDTEAM (1/true or 0/false)
 * 3. Persistent config file (~/.konoha/akatsuki_config.json or KONOHA_AKATSUKI_CONFIG)
 *
 * @param {Object} [options={}]
 * @returns {boolean}
 */
function isRedTeamEnabled(options = {}) {
  if (options.redteam_enabled !== undefined) {
    return Boolean(options.redteam_enabled);
  }

  if (process.env.KONOHA_AKATSUKI_REDTEAM !== undefined) {
    const envVal = String(process.env.KONOHA_AKATSUKI_REDTEAM).trim().toLowerCase();
    return envVal === '1' || envVal === 'true' || envVal === 'enabled' || envVal === 'red';
  }

  const config = loadAkatsukiConfig(options);
  return config.mode === 'red';
}

module.exports = {
  getAkatsukiConfigPath,
  loadAkatsukiConfig,
  saveAkatsukiConfig,
  setRedTeamEnabled,
  isRedTeamEnabled,
  setAkatsukiMode,
  getAkatsukiMode,
  setAkatsukiEnv,
  getAkatsukiEnv
};
