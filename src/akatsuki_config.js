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
  return process.platform === 'linux' ? 'lxc' : 'docker';
}

/**
 * Load persistent Akatsuki configuration.
 *
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, mode: 'lxc'|'docker', updated_at?: string, updated_by?: string }}
 */
function loadAkatsukiConfig(options = {}) {
  const configPath = getAkatsukiConfigPath(options.config_path || options.configPath);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const mode = (parsed.mode === 'lxc' || parsed.mode === 'docker') ? parsed.mode : getDefaultMode();
        return {
          redteam_enabled: parsed.redteam_enabled !== false,
          mode,
          updated_at: parsed.updated_at,
          updated_by: parsed.updated_by
        };
      }
    }
  } catch (_) {
    // Fall back to default
  }

  return {
    redteam_enabled: true,
    mode: getDefaultMode()
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
    const mode = (config.mode === 'lxc' || config.mode === 'docker') ? config.mode : getDefaultMode();
    const data = {
      redteam_enabled: config.redteam_enabled !== false,
      mode,
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
 * Set Akatsuki container execution mode ('lxc' | 'docker').
 *
 * @param {'lxc'|'docker'} mode
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, mode: 'lxc'|'docker', updated_at: string }}
 */
function setAkatsukiMode(mode, options = {}) {
  const normMode = String(mode || '').trim().toLowerCase();
  if (normMode !== 'lxc' && normMode !== 'docker') {
    throw new Error(`Invalid Akatsuki mode "${mode}". Supported modes: lxc, docker`);
  }
  const current = loadAkatsukiConfig(options);
  current.mode = normMode;
  current.updated_at = new Date().toISOString();
  current.updated_by = 'cli';
  saveAkatsukiConfig(current, options);
  return current;
}

/**
 * Get current Akatsuki execution mode ('lxc' | 'docker').
 *
 * @param {Object} [options={}]
 * @returns {'lxc'|'docker'}
 */
function getAkatsukiMode(options = {}) {
  if (process.env.KONOHA_AKATSUKI_MODE) {
    const envMode = process.env.KONOHA_AKATSUKI_MODE.trim().toLowerCase();
    if (envMode === 'lxc' || envMode === 'docker') return envMode;
  }
  const config = loadAkatsukiConfig(options);
  return config.mode || getDefaultMode();
}

/**
 * Set Red-Team feature state (enable or disable).
 *
 * @param {boolean} enabled
 * @param {Object} [options={}]
 * @returns {{ redteam_enabled: boolean, updated_at: string }}
 */
function setRedTeamEnabled(enabled, options = {}) {
  const current = loadAkatsukiConfig(options);
  current.redteam_enabled = Boolean(enabled);
  current.updated_at = new Date().toISOString();
  current.updated_by = 'cli';
  saveAkatsukiConfig(current, options);
  return current;
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
    return envVal === '1' || envVal === 'true' || envVal === 'enabled';
  }

  const config = loadAkatsukiConfig(options);
  return config.redteam_enabled !== false;
}

module.exports = {
  getAkatsukiConfigPath,
  loadAkatsukiConfig,
  saveAkatsukiConfig,
  setRedTeamEnabled,
  isRedTeamEnabled,
  setAkatsukiMode,
  getAkatsukiMode
};
