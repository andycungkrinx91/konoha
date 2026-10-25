'use strict';

/**
 * src/akatsuki_config.js
 *
 * Persistent configuration management for Akatsuki Security Agent.
 * Manages operator control over Red-Team offensive execution state (enabled/disabled).
 *
 * Storage: ~/.konoha/akatsuki_config.json
 * CLI/TUI Exclusive: Feature toggles are deliberately not exposed in the Web UI.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getAkatsukiConfigPath() {
  return path.join(os.homedir(), '.konoha', 'akatsuki_config.json');
}

/**
 * Load persistent Akatsuki configuration.
 *
 * @returns {{ redteam_enabled: boolean, updated_at?: string, updated_by?: string }}
 */
function loadAkatsukiConfig() {
  const configPath = getAkatsukiConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return {
          redteam_enabled: parsed.redteam_enabled !== false,
          updated_at: parsed.updated_at,
          updated_by: parsed.updated_by
        };
      }
    }
  } catch (_) {
    // Fall back to default
  }

  return {
    redteam_enabled: true
  };
}

/**
 * Save persistent Akatsuki configuration.
 *
 * @param {Object} config
 * @returns {boolean}
 */
function saveAkatsukiConfig(config = {}) {
  const configPath = getAkatsukiConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      redteam_enabled: config.redteam_enabled !== false,
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
 * Set Red-Team feature state (enable or disable).
 *
 * @param {boolean} enabled
 * @returns {{ redteam_enabled: boolean, updated_at: string }}
 */
function setRedTeamEnabled(enabled) {
  const current = loadAkatsukiConfig();
  current.redteam_enabled = Boolean(enabled);
  current.updated_at = new Date().toISOString();
  current.updated_by = 'cli';
  saveAkatsukiConfig(current);
  return current;
}

/**
 * Check whether Red-Team offensive operations are currently enabled.
 *
 * Precedence:
 * 1. Explicit option override (for test harnesses / programmatic contexts)
 * 2. Environment variable KONOHA_AKATSUKI_REDTEAM (1/true or 0/false)
 * 3. Persistent config file (~/.konoha/akatsuki_config.json)
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

  const config = loadAkatsukiConfig();
  return config.redteam_enabled !== false;
}

module.exports = {
  getAkatsukiConfigPath,
  loadAkatsukiConfig,
  saveAkatsukiConfig,
  setRedTeamEnabled,
  isRedTeamEnabled
};
