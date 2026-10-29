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
const os = require('os');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('./semble_manager');
const { spawnSync } = require('child_process');

const {
  
  HOME,
  OPENCODE_DIR,
  OPENCODE_CONFIG,
  OPENCODE_LEGACY_DIR,
  OPENCODE_LEGACY_CONFIG,
  
  FILE_TOOLS_MCP_PATH,
  SKILLS_DB_DIR,
  
  SERVER_PATH
} = require('../bin/lib/paths');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { buildMainAgentContract, generateGenericSubagentMd } = require('./agent_contract');
const { loadAgents, generateAgentsMd } = require('./agent_manager');

/**
 * Auto-install oh-my-opencode-slim if available and not yet installed.
 */
function installOhMyOpenCodeSlim(silent = true) {
  // Check if oh-my-opencode-slim is available
  const hasSlim = isCommandAvailable('oh-my-opencode-slim');
  if (hasSlim) {
    if (!silent) {
      process.stderr.write('  ✓ oh-my-opencode-slim is available, using existing installation\n');
    }
    return { ok: true, reason: 'already-installed' };
  }

  if (!silent) {
    process.stderr.write('  ⚠ oh-my-opencode-slim is not installed; continuing without optional integration\n');
  }
  return { ok: false, reason: 'not-available' };
}

// OpenCode Detection

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

// Config Helpers

function getOpenCodeConfigPath(options = {}) {
  if (options.configPath) return options.configPath;
  if (options.home) return path.join(options.home, '.config', 'opencode', 'opencode.json');
  if (fileExists(OPENCODE_CONFIG)) return OPENCODE_CONFIG;
  if (fileExists(OPENCODE_LEGACY_CONFIG) && !fileExists(OPENCODE_DIR)) return OPENCODE_LEGACY_CONFIG;
  return OPENCODE_CONFIG;
}

function readOpenCodeConfig(options = {}) {
  const configPath = getOpenCodeConfigPath(options);
  if (!fileExists(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeOpenCodeConfig(config, options = {}) {
  const configPath = getOpenCodeConfigPath(options);
  ensureDir(path.dirname(configPath));
  const bakPath = `${configPath}.bak`;
  if (fileExists(configPath) && !fileExists(bakPath)) {
    try {
      fs.copyFileSync(configPath, bakPath);
    } catch (_) { /* intentional best-effort backup */ }
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}



function _configureKonohaMcpServer(config, pythonCmd, serverPath) {
  const launcherJs = fileExists(path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_launcher.js')
    : (fileExists(FILE_TOOLS_MCP_PATH) ? FILE_TOOLS_MCP_PATH : (serverPath || SERVER_PATH));

  const isJsLauncher = launcherJs.endsWith('.js');
  config.mcp['konoha'] = {
    type: 'local',
    command: isJsLauncher
      ? [process.execPath || 'node', launcherJs]
      : [pythonCmd || 'python3', launcherJs],
    environment: {
      ACTIVE_CLIENT: 'opencode',
      OPENCODE_CLIENT: '1',
      KONOHA_CLIENT: 'opencode',
      KONOHA_SEMANTIC_SEARCH: '1'
    },
    enabled: true
  };
}

function _configureSembleMcpServer(config, uvxCmd) {
  const isWin = process.platform === 'win32';
  const resolvedCmd = uvxCmd || (isWin ? 'uvx.cmd' : 'uvx');

  config.mcp['semble'] = {
    type: 'local',
    command: [resolvedCmd, '--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
    environment: {
      ACTIVE_CLIENT: 'opencode',
      OPENCODE_CLIENT: '1',
      KONOHA_CLIENT: 'opencode'
    },
    enabled: true
  };
}

function _configureAislopMcpServer(config) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  let aislopCommand = [npxCmd, '-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', shell: process.platform === 'win32', timeout: 3000 });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      const binPath = whichRes.stdout.trim().split('\n')[0].trim();
      if (binPath && fileExists(binPath)) {
        aislopCommand = [binPath];
      }
    }
  } catch { /* intentional best-effort fallback */ }

  config.mcp['aislop'] = {
    type: 'local',
    command: aislopCommand,
    environment: {
      ACTIVE_CLIENT: 'opencode',
      OPENCODE_CLIENT: '1',
      KONOHA_CLIENT: 'opencode'
    },
    enabled: true
  };
}

function _configureOpenCodePermissions(config) {
  delete config.permissions;
  delete config.autoApprove;
  delete config.autoApproval;
  delete config.permissionMode;
  if (!config.permission || typeof config.permission !== 'object') {
    config.permission = {
      read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow',
      list: 'allow', bash: 'allow', task: 'allow', todowrite: 'allow',
      question: 'allow', webfetch: 'allow', websearch: 'allow',
      lsp: 'allow', skill: 'allow', mcp: 'allow'
    };
  }
}

function _registerNinjaAgents(config) {
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Black Ops for backend dev, bug fixing, DevOps, infrastructure deployment, cyber defense, and dev/local penetration testing',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports'
  };

  try {
    const agents = loadAgents();
    const agentMap = (config.agent && typeof config.agent === 'object') ? config.agent : {};

    for (const agent of agents) {
      if (!agent?.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const desc = DEFAULT_ROLE_DESCRIPTIONS[agent.name] || agent.description || agent.purpose || agent.role || `${agent.name} ninja agent`;
      agentMap[agent.name] = {
        description: desc,
        prompt: agent.instructions || `Execute ${agent.name} workflow using konoha and semble MCP tools.`,
        mode: 'subagent'
      };
    }
    config.agent = agentMap;
    const konohaInstructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
    const existingInstructions = Array.isArray(config.instructions) ? config.instructions : [];
    config.instructions = [...new Set([...konohaInstructions, ...existingInstructions])];
  } catch { /* intentional best-effort fallback */ }
}

function _syncSingleSettingsFile(sPath) {
  try {
    ensureDir(path.dirname(sPath));
    let sObj = {};
    if (fileExists(sPath)) {
      try { sObj = JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {}; } catch { /* ignore */ }
    }
    delete sObj.permissions;
    delete sObj.autoApprove;
    delete sObj.autoApproval;
    delete sObj.permissionMode;
    const konohaInstructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
    const existingInstructions = Array.isArray(sObj.instructions) ? sObj.instructions : [];
    sObj.instructions = [...new Set([...konohaInstructions, ...existingInstructions])];
    if (!sObj.permission || typeof sObj.permission !== 'object') {
      sObj.permission = {
        read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow',
        list: 'allow', bash: 'allow', task: 'allow', todowrite: 'allow',
        question: 'allow', webfetch: 'allow', websearch: 'allow',
        lsp: 'allow', skill: 'allow', mcp: 'allow'
      };
    }
    fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
  } catch { /* ignore */ }
}

function _syncOpenCodeSettingsFiles(config) {
  const openCodeSettingsPaths = [
    path.join(OPENCODE_DIR, 'settings.json'),
    path.join(OPENCODE_LEGACY_DIR, 'settings.json')
  ];
  for (const sPath of openCodeSettingsPaths) {
    _syncSingleSettingsFile(sPath);
  }

  if (fileExists(OPENCODE_LEGACY_DIR) || fileExists(OPENCODE_LEGACY_CONFIG)) {
    try {
      ensureDir(OPENCODE_LEGACY_DIR);
      fs.writeFileSync(OPENCODE_LEGACY_CONFIG, JSON.stringify(config, null, 2) + '\n');
    } catch { /* ignore */ }
  }
}

// MCP Server Registration

function registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  let config;
  try {
    config = readOpenCodeConfig(options);
  } catch (error) {
    if (!silent) console.warn(`Invalid OpenCode JSON; leaving it unchanged: ${error.message}`);
    return { ok: false, reason: 'invalid-config' };
  }

  if (!config.mcp) config.mcp = {};

  _configureKonohaMcpServer(config, pythonCmd, serverPath);
  _configureSembleMcpServer(config, uvxCmd);
  _configureAislopMcpServer(config);
  _configureOpenCodePermissions(config);
  _registerNinjaAgents(config);

  writeOpenCodeConfig(config, options);
  _syncOpenCodeSettingsFiles(config);

  if (!silent) {
    process.stderr.write('  ✓ OpenCode MCP servers configured (konoha, semble, aislop)\n');
  }

  return { ok: true };
}

function _writeOpenCodeAgentsDir(aDir, agents) {
  try {
    ensureDir(aDir);
    for (const agent of agents) {
      if (!agent || !agent.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const subagentMd = generateGenericSubagentMd(agent, 'opencode');
      fs.writeFileSync(path.join(aDir, `${agent.name}.md`), subagentMd, 'utf8');
    }
  } catch { /* intentional best-effort fallback */ }
}

function deployOpenCodeRules(silent = true, options = {}) {
  const opts = typeof silent === "object" && silent !== null ? silent : options;
  const isSilent = typeof silent === "boolean" ? silent : (opts.silent !== false);
  const home = (opts && opts.home) || HOME;
  const openCodeDir = (opts && opts.home) ? path.join(home, ".config", "opencode") : OPENCODE_DIR;
  const legacyDir = (opts && opts.home) ? path.join(home, ".opencode") : OPENCODE_LEGACY_DIR;

  let agents = [];
  try {
    agents = loadAgents();
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  const fullInstructions = generateAgentsMd(agents, "opencode");

  const targets = [
    path.join(openCodeDir, "AGENTS.md"),
    path.join(legacyDir, "AGENTS.md")
  ];

  let deployed = 0;
  for (const dest of targets) {
    try {
      ensureDir(path.dirname(dest));
      const agentMgr = require('./agent_manager');
      const finalDest = agentMgr.injectManagedConfig(dest, fullInstructions, 'KONOHA');
      fs.writeFileSync(dest, finalDest, 'utf-8');
      deployed++;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Deploy rules/konoha.md
  const ruleTargets = [
    path.join(openCodeDir, "rules", "konoha.md"),
    path.join(legacyDir, "rules", "konoha.md")
  ];
  for (const rDest of ruleTargets) {
    try {
      ensureDir(path.dirname(rDest));
      fs.writeFileSync(rDest, buildMainAgentContract("opencode") + "\n", "utf8");
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const agentDirs = [
    path.join(openCodeDir, "agents"),
    path.join(legacyDir, "agents")
  ];
  for (const aDir of agentDirs) {
    _writeOpenCodeAgentsDir(aDir, agents);
  }

  if (!isSilent && deployed > 0) process.stderr.write(`  ✓ Deployed Konoha instructions & agents to OpenCode\n`);
  return { ok: deployed > 0 };
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
      stdio: silent ? 'ignore' : 'inherit',
      shell: process.platform === 'win32'
    });
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  const { resolveRtkRuleTemplate } = require('./mcp_clients/common');
  let src = resolveRtkRuleTemplate();
  if (!src || !fileExists(src)) {
    const fallback = path.join(os.homedir(), '.claude', 'rules', 'rtk.md');
    if (fileExists(fallback)) src = fallback;
  }
  if (!src || !fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  const targets = [
    path.join(OPENCODE_DIR, 'rules', 'rtk.md'),
    path.join(OPENCODE_LEGACY_DIR, 'rules', 'rtk.md')
  ];

  let deployed = 0;
  for (const dest of targets) {
    try {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      deployed++;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (!silent && deployed > 0) process.stderr.write(`  ✓ Deployed RTK rule to OpenCode\n`);
  return { ok: deployed > 0 };
}

// Status Checking

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
      status.mcpAislop = !!(config.mcp && config.mcp['aislop']);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  return status;
}

// Cleanup

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
      delete config.mcp['aislop'];
    }

    // OpenCode has no RTK hook integration — nothing to remove there

    writeOpenCodeConfig(config);

    if (!silent) {
      process.stderr.write('  ✓ Removed Konoha config from OpenCode\n');
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

// Main Setup Function

function ensureOpenCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true,
    force = false,
    skipDetection = false
  } = options;

  // Skip if OpenCode is not installed
  if (!force && !skipDetection && !isOpenCodeInstalled()) {
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
  const mcpResult = registerOpenCodeMcp(pythonCmd, serverPath, uvxCmd, silent, options);
  if (!mcpResult.ok) {
    return { ok: false, reason: mcpResult.reason || 'opencode-mcp-registration-failed' };
  }

  // Deploy the shared contract and RTK rule (OpenCode has no RTK hook).
  const contractRule = deployOpenCodeRules(silent, options);
  const rtkRule = deployOpenCodeRtkRule(silent, options);

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
