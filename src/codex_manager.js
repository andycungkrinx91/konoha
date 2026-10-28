const fs = require('fs');
const path = require('path');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('./semble_manager');
const { spawnSync } = require('child_process');

const {
  HOME,
  CODEX_DIR,
  CODEX_CONFIG,
  CODEX_AGENTS_MD,
  CODEX_RULES_DIR,
  CODEX_RTK_RULE,
  
  FILE_TOOLS_MCP_PATH,
  SKILLS_DB_DIR,
  
  SERVER_PATH
} = require('../bin/lib/paths');

const {
  fileExists,
  ensureDir,
  isCommandAvailable,
  fileExistsCached,
  getRtkCommand,
  isRtkInstalled,
  normalizeCommand
} = require('./platform_utils');

const {
  buildMainAgentContract,
} = require('./agent_contract');

const VALID_AGENT_NAME = /^[a-zA-Z0-9_-]+$/;

// Codex Detection

function isCodexInstalled() {
  return (
    isCommandAvailable('codex') ||
    fileExistsCached(CODEX_DIR) ||
    fileExistsCached(CODEX_CONFIG) ||
    fileExistsCached(CODEX_AGENTS_MD)
  );
}

// Config Helpers

function getCodexConfigPath(options = {}) {
  if (options.configPath) return options.configPath;
  if (options.home) return path.join(options.home, '.codex', 'config.toml');
  return CODEX_CONFIG;
}

/**
 * Parses basic TOML for MCP server detection.
 * Returns an object with mcp_servers map.
 */
function parseTomlStringArray(rawArgs) {
  const parsed = [];
  const argItemRegex = /["']([^"']+)["']/g;
  let m;
  while ((m = argItemRegex.exec(rawArgs)) !== null) {
    parsed.push(m[1]);
  }
  return parsed;
}

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

    if (!currentServer) continue;

    const cmdMatch = rawLine.match(/^command\s*=\s*["']([^"']+)["']/i);
    if (cmdMatch) result.mcp_servers[currentServer].command = cmdMatch[1];

    const argsMatch = rawLine.match(/^args\s*=\s*\[(.*)\]/i);
    if (argsMatch) result.mcp_servers[currentServer].args = parseTomlStringArray(argsMatch[1]);
  }

  return result;
}

function readCodexConfig(options = {}) {
  const configPath = getCodexConfigPath(options);
  if (!fileExists(configPath)) return '';
  return fs.readFileSync(configPath, 'utf-8');
}

function writeCodexConfig(content, options = {}) {
  const configPath = getCodexConfigPath(options);
  ensureDir(path.dirname(configPath));
  const bakPath = `${configPath}.bak`;
  if (fileExists(configPath) && !fileExists(bakPath)) {
    try {
      fs.copyFileSync(configPath, bakPath);
    } catch (_) { /* intentional best-effort backup */ }
  }
  fs.writeFileSync(configPath, content, 'utf-8');
}

function readCodexInstructions() {
  if (!fileExists(CODEX_AGENTS_MD)) return '';
  return fs.readFileSync(CODEX_AGENTS_MD, 'utf-8');
}

function writeCodexInstructions(content) {
  ensureDir(path.dirname(CODEX_AGENTS_MD));
  const agentMgr = require('./agent_manager');
  const finalContent = agentMgr.injectManagedConfig(CODEX_AGENTS_MD, content, 'KONOHA');
  fs.writeFileSync(CODEX_AGENTS_MD, finalContent, 'utf-8');
}

function getKonohaToolNames() {
  try {
    const manifest = require('./mcp_tool_manifest.json');
    if (manifest && Array.isArray(manifest.tools)) {
      return manifest.tools.map(t => t.name);
    }
  } catch (_) { /* intentional best-effort manifest resolution */ }
  try {
    const { KONOHA_CANONICAL_TOOLS } = require('./deploy_utils');
    if (KONOHA_CANONICAL_TOOLS) return [...KONOHA_CANONICAL_TOOLS];
  } catch (_) { /* intentional fallback to empty array */ }
  return [];
}

const KONOHA_TOOLS = getKonohaToolNames();

const SEMBLE_TOOLS = ['search', 'find_related'];
const AISLOP_TOOLS = ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'];

function _filterExistingCodexToml(existingToml) {
  const lines = (existingToml || '').split('\n');
  const preservedLines = [];
  const userOwnedAgentNames = new Set();
  const userFeatureLines = [];
  let skippingManagedSection = false;
  let hasSeenSection = false;
  let inFeaturesTable = false;

  const MANAGED_SECTION_PATTERNS = [
    /^\[mcp_servers\.(konoha|semble|aislop)(\..*)?\]/i,
    /^\[mcp\.(konoha|semble|aislop)(\..*)?\]/i,
    /^\[agents\.(sannin|genin|kage|chunin|jonin|anbu|tokubetsu-jonin)(\..*)?\]/i
  ];

  const TOP_LEVEL_MANAGED_KEYS = [
    /^suppress_unstable_features_warning\s*=/i,
    /^sandbox_mode\s*=/i,
    /^approval_mode\s*=/i,
    /^ask_for_approval\s*=/i,
    /^approve_for_me\s*=/i,
    /^sandbox\s*=/i,
    /^sandbox_permissions\s*=/i,
    /^auto_approve\s*=/i,
    /^auto_approve_tools\s*=/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (rawLine === '# Official Konoha Ninja Agents' || rawLine.includes('A user prompt or conversation resume action')) {
      continue;
    }

    if (rawLine.startsWith('[')) {
      hasSeenSection = true;
      if (/^\[features\]/i.test(rawLine)) {
        inFeaturesTable = true;
        skippingManagedSection = false;
        continue;
      }
      inFeaturesTable = false;
      if (MANAGED_SECTION_PATTERNS.some(p => p.test(rawLine))) {
        skippingManagedSection = true;
        continue;
      }
      skippingManagedSection = false;
      const userAgentMatch = rawLine.match(/^\[agents\.([a-zA-Z0-9_-]+)(?:\..*)?\]/i);
      if (userAgentMatch) userOwnedAgentNames.add(userAgentMatch[1]);
      preservedLines.push(lines[i]);
      continue;
    }

    if (inFeaturesTable) {
      if (!(/^skip_host_skill_discovery\s*=/i.test(rawLine) || /^skill_search\s*=/i.test(rawLine))) {
        userFeatureLines.push(lines[i]);
      }
      continue;
    }

    if (skippingManagedSection) continue;
    if (!hasSeenSection && TOP_LEVEL_MANAGED_KEYS.some(k => k.test(rawLine))) continue;
    preservedLines.push(lines[i]);
  }

  return { cleaned: preservedLines.join('\n').trim(), userOwnedAgentNames, userFeatureLines };
}

function _resolveAislopCommand(npxExecutable) {
  let cmd = npxExecutable;
  let args = ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', shell: process.platform === 'win32', windowsHide: true });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      cmd = whichRes.stdout.trim().split('\n')[0].trim();
      args = [];
    }
  } catch { /* best-effort */ }
  return { cmd, args };
}

function _buildCodexMcpSection(cfg) {
  const { pythonExecutable, serverEntryPoint, uvxExecutable, npxExecutable, userFeatureLines } = cfg;
  const tomlStr = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const normPython = normalizeCommand(pythonExecutable);
  const konohaArgs = [...normPython.prefixArgs, serverEntryPoint];

  const konohaBlock = [
    '[mcp_servers.konoha]',
    `command = ${tomlStr(normPython.executable)}`,
    `args = [${konohaArgs.map(tomlStr).join(', ')}]`,
    'startup_timeout_sec = 30', 'tool_timeout_sec = 60', 'default_tools_approval_mode = "auto"',
    '', '[mcp_servers.konoha.env]',
    'ACTIVE_CLIENT = "codex"', 'KONOHA_CLIENT = "codex"', 'KONOHA_SEMANTIC_SEARCH = "1"'
  ].join('\n');

  const { cmd: aislopCmd, args: aislopArgs } = _resolveAislopCommand(npxExecutable);
  const aislopBlock = [
    '[mcp_servers.aislop]',
    `command = ${tomlStr(aislopCmd)}`,
    `args = [${aislopArgs.map(tomlStr).join(', ')}]`,
    'startup_timeout_sec = 30', 'tool_timeout_sec = 60', 'default_tools_approval_mode = "auto"'
  ].join('\n');

  const featuresBlock = ['[features]', 'skip_host_skill_discovery = true', 'skill_search = false', ...userFeatureLines].join('\n');
  const konohaToolBlocks = KONOHA_TOOLS.map(t => `[mcp_servers.konoha.tools.${t}]\napproval_mode = "auto"`).join('\n\n');
  const aislopToolBlocks = AISLOP_TOOLS.map(t => `[mcp_servers.aislop.tools.${t}]\napproval_mode = "auto"`).join('\n\n');

  const sembleBlock = [
    '[mcp_servers.semble]',
    `command = ${tomlStr(uvxExecutable)}`,
    `args = ["--from", "${SEMBLE_PACKAGE}", "semble", "--content", "all"]`,
    'startup_timeout_sec = 30', 'tool_timeout_sec = 60', 'default_tools_approval_mode = "auto"'
  ].join('\n');
  const sembleToolBlocks = SEMBLE_TOOLS.map(t => `[mcp_servers.semble.tools.${t}]\napproval_mode = "auto"`).join('\n\n');

  return [
    konohaBlock, '', konohaToolBlocks,
    '', sembleBlock, '', sembleToolBlocks,
    '', aislopBlock, '', aislopToolBlocks, '', featuresBlock
  ].join('\n');
}

function _buildCodexAgentBlocks(userOwnedAgentNames) {
  let agents = [];
  try {
    const { loadAgents } = require('./agent_manager');
    agents = loadAgents();
  } catch {
    agents = [];
  }

  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Black Ops for backend dev, bug fixing, DevOps, infrastructure deployment, cyber defense, and dev/local penetration testing',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports'
  };

  const emittedAgentNames = new Set();
  return agents
    .filter(a => {
      if (!a?.name || !VALID_AGENT_NAME.test(a.name)) return false;
      if (a.name.startsWith('mcp_') || a.name.startsWith('cli-test-')) return false;
      if (userOwnedAgentNames.has(a.name)) return false;
      if (emittedAgentNames.has(a.name)) return false;
      emittedAgentNames.add(a.name);
      return true;
    })
    .map(a => {
      const desc = (DEFAULT_ROLE_DESCRIPTIONS[a.name] || a.description || a.purpose || a.role || `${a.name} ninja agent`).replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
      return `[agents.${a.name}]\ndescription = "${desc}"\nprompt = "file:~/.codex/agents/${a.name}.md"`;
    })
    .join('\n\n');
}

/**
 * Injects or replaces [mcp_servers.konoha], [mcp_servers.semble], and [mcp_servers.aislop] in TOML content.
 */
function updateCodexTomlMcp(existingToml, pythonCmd, serverPath, uvxCmd) {
  const pythonExecutable = pythonCmd || 'python3';
  const serverEntryPoint = serverPath || SERVER_PATH;
  const uvxExecutable = uvxCmd || 'uvx';
  const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const { cleaned, userOwnedAgentNames, userFeatureLines } = _filterExistingCodexToml(existingToml);
  const mcpSection = _buildCodexMcpSection({
    pythonExecutable, serverEntryPoint, uvxExecutable, npxExecutable, userFeatureLines
  });
  const agentBlocks = _buildCodexAgentBlocks(userOwnedAgentNames);

  const topFlags = 'suppress_unstable_features_warning = true';
  const extraSections = [
    mcpSection,
    agentBlocks ? `# Official Konoha Ninja Agents\n${agentBlocks}` : ''
  ].filter(Boolean).join('\n\n');

  if (cleaned.length === 0) return `${topFlags}\n\n${extraSections}\n`;
  return `${topFlags}\n\n${cleaned}\n\n${extraSections}\n`;
}

// MCP Server Registration

function _resolveUvxPath(uvxCmd) {
  let resolvedUvx = uvxCmd || 'uvx';
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const whichUvx = spawnSync(whichCmd, [resolvedUvx], { encoding: 'utf-8', shell: process.platform === 'win32', windowsHide: true });
    if (whichUvx.status === 0 && whichUvx.stdout.trim()) {
      return whichUvx.stdout.trim().split('\n')[0].trim();
    }
  } catch { /* best-effort */ }
  return resolvedUvx;
}

function registerCodexMcp(pythonCmd, serverPath, uvxCmd, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  try {
    const existing = readCodexConfig(options);
    const resolvedUvx = _resolveUvxPath(uvxCmd);
    const updated = updateCodexTomlMcp(existing, pythonCmd, serverPath, resolvedUvx);
    writeCodexConfig(updated, options);

    if (!silent) {
      process.stderr.write('  ✓ Codex MCP servers configured (konoha, semble, aislop) in config.toml\n');
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
  const { loadAgents, generateAgentsMd } = require('./agent_manager');
  const { generateGenericSubagentMd } = require('./agent_contract');

  let agents = [];
  try {
    agents = loadAgents();
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  try {
    ensureDir(CODEX_DIR);
    ensureDir(CODEX_RULES_DIR);
    const agentsDir = path.join(CODEX_DIR, 'agents');
    ensureDir(agentsDir);

    const fullInstructions = generateAgentsMd(agents, 'codex');
    writeCodexInstructions(fullInstructions);

    // Also write ~/.codex/CODEX.md and ~/.codex/instructions.md
    const codexMdPath = path.join(CODEX_DIR, 'CODEX.md');
    const instructionsMdPath = path.join(CODEX_DIR, 'instructions.md');
    const agentMgr = require('./agent_manager');
    fs.writeFileSync(codexMdPath, agentMgr.injectManagedConfig(codexMdPath, fullInstructions, 'KONOHA'), 'utf8');
    fs.writeFileSync(instructionsMdPath, agentMgr.injectManagedConfig(instructionsMdPath, fullInstructions, 'KONOHA'), 'utf8');

    // Deploy rules/konoha.md
    fs.writeFileSync(path.join(CODEX_RULES_DIR, 'konoha.md'), buildMainAgentContract('codex') + '\n', 'utf8');

    // Deploy subagents (skip test/internal agents and validate names)
    for (const agent of agents) {
      if (!agent || !agent.name || !VALID_AGENT_NAME.test(agent.name) || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const subagentMd = generateGenericSubagentMd(agent, 'codex');
      const targetPath = path.resolve(path.join(agentsDir, `${agent.name}.md`));
      if (!targetPath.startsWith(path.resolve(agentsDir))) continue;
      fs.writeFileSync(targetPath, subagentMd, 'utf8');
    }

    if (!silent) process.stderr.write(`  ✓ Deployed Konoha instructions, rules & agents to Codex\n`);
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

  // Note: rtk init has no codex agent support; the rule is deployed via
  // copyFileSync below instead of `rtk init`.

  let src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  const fallback = path.join(HOME, '.claude', 'rules', 'rtk.md');
  if (!fileExists(src) && fileExists(fallback)) {
    src = fallback;
  }
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  try {
    ensureDir(CODEX_RULES_DIR);
    fs.copyFileSync(src, CODEX_RTK_RULE);
    if (!silent) process.stderr.write(`  ✓ Deployed RTK rule to ${CODEX_RTK_RULE}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

// Status Checking

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
      status.mcpAislop = !!(parsed.mcp_servers && parsed.mcp_servers['aislop']);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  return status;
}

// Cleanup

function removeCodexConfig(silent = true) {
  if (!fileExists(CODEX_CONFIG)) return;

  try {
    const existing = readCodexConfig();
    const lines = existing.split('\n');
    const filteredLines = [];
    let skippingBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      const isBlockStart = /^\[mcp_servers\.(konoha|semble|aislop)(\..*)?\]/i.test(rawLine) ||
                           /^\[mcp\.(konoha|semble|aislop)(\..*)?\]/i.test(rawLine);
      if (isBlockStart) {
        skippingBlock = true;
        continue;
      }

      if (skippingBlock && rawLine.startsWith('[')) {
        skippingBlock = false;
      }

      if (!skippingBlock) filteredLines.push(lines[i]);
    }

    const cleaned = filteredLines.join('\n').trim();
    writeCodexConfig(cleaned ? cleaned + '\n' : '');

    if (!silent) {
      process.stderr.write('  ✓ Removed Konoha MCP servers from Codex config.toml\n');
    }
  } catch { /* best-effort */ }
}

// Main Setup Function

function ensureCodexSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true,
    force = false,
    skipDetection = false
  } = options;

  if (!force && !skipDetection && !isCodexInstalled()) {
    return { ok: false, reason: 'codex-not-installed' };
  }

  const deployUtils = require('./deploy_utils');
  deployUtils.installFileTools(silent);

  const launcherJs = fileExists(path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_launcher.js')
    : (fileExists(FILE_TOOLS_MCP_PATH) ? FILE_TOOLS_MCP_PATH : serverPath);

  const isJs = launcherJs.endsWith('.js');
  const targetCmd = isJs ? (process.execPath || 'node') : pythonCmd;

  if (!fileExists(launcherJs) && !fileExists(serverPath)) {
    return { ok: false, reason: 'konoha-server-not-installed' };
  }

  const mcpResult = registerCodexMcp(targetCmd, launcherJs, uvxCmd, silent, options);
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
