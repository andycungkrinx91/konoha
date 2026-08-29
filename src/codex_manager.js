/**
 * src/codex_manager.js — Codex IDE/CLI integration module.
 *
 * Handles auto-injection of Konoha MCP servers and runtime contracts into Codex.
 *
 * Codex config location: ~/.codex/config.toml
 * Codex instructions location: ~/.codex/AGENTS.md
 * Codex rules location: ~/.codex/rules/rtk.md
 * Config format: TOML with [mcp_servers.<name>] tables
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  HOME,
  CODEX_DIR,
  CODEX_CONFIG,
  CODEX_AGENTS_MD,
  CODEX_RULES_DIR,
  CODEX_RTK_RULE,
  FILE_TOOLS_LAUNCHER_PATH,
  KONOHA,
  SERVER_PATH
} = require('../bin/lib/paths');

const {
  fileExists,
  ensureDir,
  isCommandAvailable,
  fileExistsCached,
  getRtkCommand,
  isRtkInstalled
} = require('./platform_utils');

const {
  buildMainAgentContract,
  buildManagedContract
} = require('./agent_contract');

// ─── Codex Detection ─────────────────────────────────────────────────────────

function isCodexInstalled() {
  return (
    isCommandAvailable('codex') ||
    fileExistsCached(CODEX_DIR) ||
    fileExistsCached(CODEX_CONFIG) ||
    fileExistsCached(CODEX_AGENTS_MD)
  );
}

// ─── Config Helpers ─────────────────────────────────────────────────────────

function getCodexConfigPath() {
  return CODEX_CONFIG;
}

/**
 * Parses basic TOML for MCP server detection.
 * Returns an object with mcp_servers map.
 */
function parseCodexToml(content) {
  const result = { mcp_servers: {} };
  if (!content || typeof content !== 'string') return result;

  const lines = content.split('\n');
  let currentServer = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) continue;

    const serverMatch = rawLine.match(/^\[mcp_servers\.([a-zA-Z0-9_-]+)\]$/i) ||
                        rawLine.match(/^\[mcp\.([a-zA-Z0-9_-]+)\]$/i);
    if (serverMatch) {
      currentServer = serverMatch[1];
      if (!result.mcp_servers[currentServer]) {
        result.mcp_servers[currentServer] = { command: '', args: [] };
      }
      continue;
    }

    if (rawLine.startsWith('[') && !rawLine.startsWith('[mcp_servers.') && !rawLine.startsWith('[mcp.')) {
      currentServer = null;
      continue;
    }

    if (currentServer) {
      const cmdMatch = rawLine.match(/^command\s*=\s*["']([^"']+)["']/i);
      if (cmdMatch) {
        result.mcp_servers[currentServer].command = cmdMatch[1];
      }

      const argsMatch = rawLine.match(/^args\s*=\s*\[(.*)\]/i);
      if (argsMatch) {
        const rawArgs = argsMatch[1];
        const parsedArgs = [];
        const argItemRegex = /["']([^"']+)["']/g;
        let m;
        while ((m = argItemRegex.exec(rawArgs)) !== null) {
          parsedArgs.push(m[1]);
        }
        result.mcp_servers[currentServer].args = parsedArgs;
      }
    }
  }

  return result;
}

function readCodexConfig() {
  const configPath = getCodexConfigPath();
  if (!fileExists(configPath)) return '';
  return fs.readFileSync(configPath, 'utf-8');
}

function writeCodexConfig(content) {
  const configPath = getCodexConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, content, 'utf-8');
}

function readCodexInstructions() {
  if (!fileExists(CODEX_AGENTS_MD)) return '';
  return fs.readFileSync(CODEX_AGENTS_MD, 'utf-8');
}

function writeCodexInstructions(content) {
  ensureDir(path.dirname(CODEX_AGENTS_MD));
  fs.writeFileSync(CODEX_AGENTS_MD, content, 'utf-8');
}

/**
 * Injects or replaces [mcp_servers.konoha] and [mcp_servers.semble] in TOML content.
 */
function updateCodexTomlMcp(existingToml, pythonCmd, serverPath, uvxCmd) {
  const pythonExecutable = pythonCmd || 'python3';
  const serverEntryPoint = serverPath || SERVER_PATH;
  const uvxExecutable = uvxCmd || 'uvx';

  // Remove existing [mcp_servers.konoha] and [mcp_servers.semble] blocks
  const lines = (existingToml || '').split('\n');
  const filteredLines = [];
  let skippingBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (
      /^\[mcp_servers\.(konoha|semble)\]/i.test(rawLine) ||
      /^\[mcp\.(konoha|semble)\]/i.test(rawLine)
    ) {
      skippingBlock = true;
      continue;
    }

    if (skippingBlock) {
      if (rawLine.startsWith('[')) {
        skippingBlock = false;
      } else {
        continue;
      }
    }

    filteredLines.push(lines[i]);
  }

  let cleaned = filteredLines.join('\n').trim();

  const konohaBlock = [
    '[mcp_servers.konoha]',
    `command = "${pythonExecutable}"`,
    `args = ["${serverEntryPoint}"]`
  ].join('\n');

  const sembleBlock = [
    '[mcp_servers.semble]',
    `command = "${uvxExecutable}"`,
    'args = ["--from", "semble[mcp]@latest", "semble", "--content", "all"]'
  ].join('\n');

  const mcpSection = `${konohaBlock}\n\n${sembleBlock}`;

  if (cleaned.length === 0) {
    return `${mcpSection}\n`;
  }

  return `${cleaned}\n\n${mcpSection}\n`;
}

// ─── MCP Server Registration ─────────────────────────────────────────────────

function registerCodexMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  try {
    const existing = readCodexConfig();
    const updated = updateCodexTomlMcp(existing, pythonCmd, serverPath, uvxCmd);
    writeCodexConfig(updated);

    if (!silent) {
      console.log('  ✓ Codex MCP servers configured (konoha, semble) in config.toml');
    }

    return { ok: true };
  } catch (error) {
    if (!silent) {
      console.warn(`Failed to update Codex configuration: ${error.message}`);
    }
    return { ok: false, reason: error.message };
  }
}

function deployCodexRules(silent = true) {
  try {
    ensureDir(CODEX_DIR);
    const contract = buildMainAgentContract('codex');
    const existing = readCodexInstructions();
    const content = buildManagedContract(existing, contract).trim() + '\n';
    if (existing !== content) {
      writeCodexInstructions(content);
    }
    if (!silent) console.log(`  ✓ Deployed Konoha contract to ${CODEX_AGENTS_MD}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'copy-failed', error: error.message };
  }
}

function deployCodexRtkRule(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }

  // Attempt RTK init if codex support exists
  try {
    spawnSync(rtkCmd, ['init', '-g', '--agent', 'codex', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit'
    });
  } catch {}

  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  try {
    ensureDir(CODEX_RULES_DIR);
    fs.copyFileSync(src, CODEX_RTK_RULE);
    if (!silent) console.log(`  ✓ Deployed RTK rule to ${CODEX_RTK_RULE}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

// ─── Status Checking ──────────────────────────────────────────────────────────

function getCodexStatus() {
  const status = {
    installed: isCodexInstalled(),
    configExists: fileExists(CODEX_CONFIG),
    configPath: CODEX_CONFIG,
    mcpKonoha: false,
    mcpSemble: false,
    rtkRuleDeployed: fileExists(CODEX_RTK_RULE)
  };

  if (status.configExists) {
    try {
      const content = readCodexConfig();
      const parsed = parseCodexToml(content);
      status.mcpKonoha = !!(parsed.mcp_servers && parsed.mcp_servers['konoha']);
      status.mcpSemble = !!(parsed.mcp_servers && parsed.mcp_servers['semble']);
    } catch {}
  }

  return status;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function removeCodexConfig(silent = true) {
  if (!fileExists(CODEX_CONFIG)) return;

  try {
    const existing = readCodexConfig();
    const lines = existing.split('\n');
    const filteredLines = [];
    let skippingBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      if (
        /^\[mcp_servers\.(konoha|semble)\]/i.test(rawLine) ||
        /^\[mcp\.(konoha|semble)\]/i.test(rawLine)
      ) {
        skippingBlock = true;
        continue;
      }

      if (skippingBlock) {
        if (rawLine.startsWith('[')) {
          skippingBlock = false;
        } else {
          continue;
        }
      }

      filteredLines.push(lines[i]);
    }

    const cleaned = filteredLines.join('\n').trim();
    writeCodexConfig(cleaned ? cleaned + '\n' : '');

    if (!silent) {
      console.log('  ✓ Removed Konoha MCP servers from Codex config.toml');
    }
  } catch {}
}

// ─── Main Setup Function ──────────────────────────────────────────────────────

function ensureCodexSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true
  } = options;

  if (!isCodexInstalled()) {
    return { ok: false, reason: 'codex-not-installed' };
  }

  const deployUtils = require('./deploy_utils');
  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha-server-not-installed' };
  }

  const mcpResult = registerCodexMcp(pythonCmd, serverPath, uvxCmd, silent);
  if (!mcpResult.ok) {
    return { ok: false, reason: mcpResult.reason || 'codex-mcp-registration-failed' };
  }

  const contractRule = deployCodexRules(silent);
  const rtkRule = deployCodexRtkRule(silent);

  return { ok: true, contractRule, rtkRule };
}

module.exports = {
  isCodexInstalled,
  isRtkInstalled,
  getCodexConfigPath,
  parseCodexToml,
  updateCodexTomlMcp,
  readCodexConfig,
  writeCodexConfig,
  readCodexInstructions,
  writeCodexInstructions,
  getCodexStatus,
  registerCodexMcp,
  ensureCodexSetup,
  removeCodexConfig,
  deployCodexRules,
  deployCodexRtkRule
};
