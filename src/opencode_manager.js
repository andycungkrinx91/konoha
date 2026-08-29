/**
 * src/opencode_manager.js — OpenCode IDE integration module.
 *
 * Handles auto-injection of Konoha MCP servers into OpenCode's settings.json.
 *
 * OpenCode config location: ~/.config/opencode/opencode.json
 * Legacy config location: ~/.opencode/config.json (read for compatibility)
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
  HOME,
  OPENCODE_DIR,
  OPENCODE_CONFIG,
  OPENCODE_LEGACY_DIR,
  OPENCODE_LEGACY_CONFIG,
  FILE_TOOLS_LAUNCHER_PATH,
  KONOHA,
  SERVER_PATH
} = require('../bin/lib/paths');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { buildMainAgentContract, buildManagedContract } = require('./agent_contract');

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

  if (!silent) {
    console.log('  ⚠ oh-my-opencode-slim is not installed; continuing without optional integration');
  }
  return { ok: false, reason: 'not-available' };
}

// ─── OpenCode Detection ───────────────────────────────────────────────────────

function isOpenCodeInstalled() {
  return (
    isCommandAvailable('opencode') ||
    fileExistsCached(OPENCODE_DIR) ||
    fileExistsCached(OPENCODE_CONFIG) ||
    fileExistsCached(OPENCODE_LEGACY_DIR) ||
    fileExistsCached(OPENCODE_LEGACY_CONFIG)
  );
}

// isRtkInstalled is imported from platform_utils

// ─── Config Helpers ───────────────────────────────────────────────────────────

function getOpenCodeConfigPath() {
  if (fileExists(OPENCODE_CONFIG)) return OPENCODE_CONFIG;
  if (fileExists(OPENCODE_LEGACY_CONFIG) && !fileExists(OPENCODE_DIR)) return OPENCODE_LEGACY_CONFIG;
  return OPENCODE_CONFIG;
}

function readOpenCodeConfig() {
  const configPath = getOpenCodeConfigPath();
  if (!fileExists(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function writeOpenCodeConfig(config) {
  const configPath = getOpenCodeConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function readOpenCodeInstructions() {
  const instructionPath = path.join(OPENCODE_DIR, 'AGENTS.md');
  if (!fileExists(instructionPath)) return '';
  return fs.readFileSync(instructionPath, 'utf-8');
}

function writeOpenCodeInstructions(content) {
  const instructionPath = path.join(OPENCODE_DIR, 'AGENTS.md');
  ensureDir(path.dirname(instructionPath));
  fs.writeFileSync(instructionPath, content, 'utf-8');
}

// ─── MCP Server Registration ─────────────────────────────────────────────────

function registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  let config;
  try {
    config = readOpenCodeConfig();
  } catch (error) {
    if (!silent) console.warn(`Invalid OpenCode JSON; leaving it unchanged: ${error.message}`);
    return { ok: false, reason: 'invalid-config' };
  }

  // Ensure mcp namespace exists
  if (!config.mcp) {
    config.mcp = {};
  }

  // Add konoha MCP server
  config.mcp['konoha'] = {
    type: 'local',
    command: [pythonCmd || 'python3', serverPath || SERVER_PATH]
  };

  // Repair Semble MCP registration on every setup.
  config.mcp['semble'] = {
    type: 'local',
    command: [uvxCmd || 'uvx', '--from', 'semble[mcp]@latest', 'semble', '--content', 'all'],
    enabled: true
  };

  writeOpenCodeConfig(config);

  if (!silent) {
    console.log('  ✓ OpenCode MCP servers configured (konoha, semble)');
  }

  return { ok: true };
}

function deployOpenCodeRules(silent = true) {
  const dest = path.join(OPENCODE_DIR, 'AGENTS.md');
  try {
    ensureDir(path.dirname(dest));
    const contract = buildMainAgentContract('opencode');
    const existing = readOpenCodeInstructions();
    const content = buildManagedContract(existing, contract).trim() + '\n';
    if (existing !== content) {
      writeOpenCodeInstructions(content);
    }
    if (!silent) console.log(`  ✓ Deployed Konoha contract to ${dest}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'copy-failed', error: error.message };
  }
}

function deployOpenCodeRtkRule(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    spawnSync(rtkCmd, ['init', '-g', '--opencode', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit'
    });
  } catch {}
  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }
  const dest = path.join(OPENCODE_DIR, 'rules', 'rtk.md');
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
    configExists: fileExists(OPENCODE_CONFIG) || fileExists(OPENCODE_LEGACY_CONFIG),
    configPath: getOpenCodeConfigPath(),
    mcpKonoha: false,
    mcpSemble: false,
    rtkRuleDeployed: fileExists(path.join(OPENCODE_DIR, 'rules', 'rtk.md'))
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
  if (!fileExists(OPENCODE_CONFIG) && !fileExists(OPENCODE_LEGACY_CONFIG)) {
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
  const mcpResult = registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent);
  if (!mcpResult.ok) {
    return { ok: false, reason: mcpResult.reason || 'opencode-mcp-registration-failed' };
  }

  // Deploy the shared contract and RTK rule (OpenCode has no RTK hook).
  const contractRule = deployOpenCodeRules(silent);
  const rtkRule = deployOpenCodeRtkRule(silent);

  return { ok: true, contractRule, rtkRule };
}

module.exports = {
  isOpenCodeInstalled,
  isRtkInstalled,
  getOpenCodeStatus,
  registerOpenCodeMcp,
  ensureOpenCodeSetup,
  removeOpenCodeConfig,
  deployOpenCodeRules,
  deployOpenCodeRtkRule
};
