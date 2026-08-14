/**
 * src/opencode_manager.js — OpenCode IDE integration module.
 *
 * Handles auto-injection of Konoha MCP servers into OpenCode's settings.json.
 *
 * OpenCode config location: ~/.opencode/config.json
 * Config format: JSON with "mcp" key for MCP servers
 *
 * NOTE: OpenCode is NOT a supported RTK hook provider. `rtk hook opencode`
 * returns "is not a valid RTK subcommand". RTK only supports: claude, cursor,
 * gemini, copilot, droid. OpenCode users rely on rule-based filtering via
 * the RTK rule file instead.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  OPENCODE_CONFIG,
  FILE_TOOLS_LAUNCHER_PATH,
  KONOHA,
  SERVER_PATH
} = require('../bin/lib/paths');

const { fileExists, ensureDir, isCommandAvailable } = require('./platform_utils');

/**
 * Auto-install oh-my-opencode-slim if available and not yet installed.
 */
function installOhMyOpenCodeSlim(silent = true) {
  // Check if oh-my-opencode-slim is available
  const hasSlim = isCommandAvailable('oh-my-opencode-slim');
  if (hasSlim) {
    if (!silent) {
      console.log('  ✓ oh-my-opencode-slim is available, using existing installation');
    }
    return { ok: true, reason: 'already-installed' };
  }

  // Try to install via pip if pip is available
  try {
    const res = spawnSync('pip', ['install', '--user', 'oh-my-opencode-slim'], {
      encoding: 'utf-8',
      timeout: 30000
    });
    if (res.status === 0) {
      if (!silent) {
        console.log('  ✓ oh-my-opencode-slim installed successfully');
      }
      return { ok: true, reason: 'installed' };
    }
  } catch (e) {
    if (!silent) {
      console.log('  ⚠ Failed to install oh-my-opencode-slim:', e.message);
    }
  }

  // Try pip3
  try {
    const res = spawnSync('pip3', ['install', '--user', 'oh-my-opencode-slim'], {
      encoding: 'utf-8',
      timeout: 30000
    });
    if (res.status === 0) {
      if (!silent) {
        console.log('  ✓ oh-my-opencode-slim installed successfully');
      }
      return { ok: true, reason: 'installed' };
    }
  } catch (e) {
    if (!silent) {
      console.log('  ⚠ Failed to install oh-my-opencode-slim:', e.message);
    }
  }

  return { ok: false, reason: 'not-available' };
}

// ─── OpenCode Detection ───────────────────────────────────────────────────────

function isOpenCodeInstalled() {
  // Check for opencode binary in PATH
  return isCommandAvailable('opencode');
}

function isRtkInstalled() {
  // Check if RTK is installed and available
  return isCommandAvailable('rtk');
}

// ─── Config Helpers ───────────────────────────────────────────────────────────

function readOpenCodeConfig() {
  if (!fileExists(OPENCODE_CONFIG)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf-8'));
  } catch (err) {
    return {};
  }
}

function writeOpenCodeConfig(config) {
  ensureDir(path.dirname(OPENCODE_CONFIG));
  fs.writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2) + '\n');
}

// ─── MCP Server Registration ─────────────────────────────────────────────────

function registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  const config = readOpenCodeConfig();

  // Ensure mcp namespace exists
  if (!config.mcp) {
    config.mcp = {};
  }

  // Add konoha MCP server
  config.mcp['konoha'] = {
    type: 'local',
    command: ['node', FILE_TOOLS_LAUNCHER_PATH || path.join(KONOHA, 'file_tools_launcher.js')]
  };

  // Add semble MCP server (if not already present)
  if (!config.mcp['semble']) {
    config.mcp['semble'] = {
      type: 'local',
      command: [uvxCmd, '--from', 'semble[mcp]', 'semble']
    };
  }

  writeOpenCodeConfig(config);

  if (!silent) {
    console.log('  ✓ OpenCode MCP servers configured (konoha, semble)');
  }

  return { ok: true };
}

function deployOpenCodeRtkRule(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }
  const dest = path.join(process.env.HOME || process.env.USERPROFILE, '.opencode', 'rules', 'rtk.md');
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (!silent) console.log(`  ✓ Deployed RTK rule to ${dest}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

// ─── Status Checking ──────────────────────────────────────────────────────────

function getOpenCodeStatus() {
  const status = {
    installed: isOpenCodeInstalled(),
    configExists: fileExists(OPENCODE_CONFIG),
    mcpKonoha: false,
    mcpSemble: false,
    rtkRuleDeployed: fileExists(path.join(process.env.HOME || process.env.USERPROFILE, '.opencode', 'rules', 'rtk.md'))
  };

  if (status.configExists) {
    try {
      const config = readOpenCodeConfig();
      status.mcpKonoha = !!(config.mcp && config.mcp['konoha']);
      status.mcpSemble = !!(config.mcp && config.mcp['semble']);
    } catch {}
  }

  return status;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function removeOpenCodeConfig(silent = true) {
  if (!fileExists(OPENCODE_CONFIG)) {
    return;
  }

  try {
    const config = readOpenCodeConfig();

    // Remove MCP servers
    if (config.mcp) {
      delete config.mcp['konoha'];
      delete config.mcp['semble'];
    }

    // OpenCode has no RTK hook integration — nothing to remove there

    writeOpenCodeConfig(config);

    if (!silent) {
      console.log('  ✓ Removed Konoha config from OpenCode');
    }
  } catch {}
}

// ─── Main Setup Function ──────────────────────────────────────────────────────

function ensureOpenCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true
  } = options;

  // Skip if OpenCode is not installed
  if (!isOpenCodeInstalled()) {
    return { ok: false, reason: 'opencode-not-installed' };
  }

  // Install oh-my-opencode-slim if available
  installOhMyOpenCodeSlim(silent);

  // Install file tools
  const deployUtils = require('./deploy_utils');
  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha-server-not-installed' };
  }

  // Register MCP servers
  registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent);

  // Deploy RTK Rule
  deployOpenCodeRtkRule(silent);

  return { ok: true };
}

module.exports = {
  isOpenCodeInstalled,
  isRtkInstalled,
  getOpenCodeStatus,
  registerOpenCodeMcp,
  ensureOpenCodeSetup,
  removeOpenCodeConfig,
  deployOpenCodeRtkRule
};
