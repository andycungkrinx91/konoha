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
  FILE_TOOLS_MCP_PATH,
  SKILLS_DB_DIR,
  KONOHA,
  SERVER_PATH
} = require('../bin/lib/paths');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { buildMainAgentContract, buildManagedContract, generateGenericSubagentMd } = require('./agent_contract');
const { loadAgents, generateAgentsMd } = require('./agent_manager');

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

  const launcherJs = fileExists(path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_launcher.js')
    : (fileExists(FILE_TOOLS_MCP_PATH) ? FILE_TOOLS_MCP_PATH : (serverPath || SERVER_PATH));

  const isJsLauncher = launcherJs.endsWith('.js');

  // Add konoha MCP server with auto-approve
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

  // Semble MCP registration
  config.mcp['semble'] = {
    type: 'local',
    command: [uvxCmd || 'uvx', '--from', 'semble[mcp]@latest', 'semble', '--content', 'all'],
    environment: {
      ACTIVE_CLIENT: 'opencode',
      OPENCODE_CLIENT: '1',
      KONOHA_CLIENT: 'opencode'
    },
    enabled: true
  };

  // Aislop MCP registration
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  config.mcp['aislop'] = {
    type: 'local',
    command: [npxCmd, '-y', '-p', 'aislop', 'aislop-mcp'],
    environment: {
      ACTIVE_CLIENT: 'opencode',
      OPENCODE_CLIENT: '1',
      KONOHA_CLIENT: 'opencode'
    },
    enabled: true
  };

  // V1 permission configuration (OpenCode V1 strictly requires singular 'permission')
  delete config.permissions;
  delete config.autoApprove;
  config.permission = {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'allow',
    task: 'allow',
    external_directory: 'allow',
    todowrite: 'allow',
    question: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    lsp: 'allow',
    doom_loop: 'allow',
    skill: 'allow'
  };

  // Register ninja agents in opencode.json
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Black Ops for backend dev, bug fixing, DevOps, and infrastructure deployment',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports'
  };

  try {
    const agents = loadAgents();
    const newAgentMap = {};

    // Keep disabled entries with valid descriptions
    if (config.agent && typeof config.agent === 'object') {
      for (const [k, v] of Object.entries(config.agent)) {
        if (k.startsWith('cli-test-') || k.startsWith('mcp_')) continue;
        if (v && v.disable) {
          newAgentMap[k] = {
            description: v.description || `Built-in ${k} agent (disabled)`,
            disable: true
          };
        }
      }
    }

    for (const agent of agents) {
      if (!agent || !agent.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const desc = DEFAULT_ROLE_DESCRIPTIONS[agent.name] || agent.description || agent.purpose || agent.role || `${agent.name} ninja agent`;
      newAgentMap[agent.name] = {
        description: desc,
        prompt: agent.instructions || `Execute ${agent.name} workflow using konoha and semble MCP tools.`,
        mode: 'subagent'
      };
    }
    config.agent = newAgentMap;
    config.instructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
  } catch {}

  writeOpenCodeConfig(config);

  // Write settings.json in both OpenCode config locations
  const openCodeSettingsPaths = [
    path.join(OPENCODE_DIR, 'settings.json'),
    path.join(OPENCODE_LEGACY_DIR, 'settings.json')
  ];
  for (const sPath of openCodeSettingsPaths) {
    try {
      ensureDir(path.dirname(sPath));
      let sObj = {};
      if (fileExists(sPath)) {
        try { sObj = JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {}; } catch {}
      }
      delete sObj.permissions;
      delete sObj.autoApprove;
      sObj.autoApproval = true;
      sObj.permissionMode = 'allowAll';
      sObj.instructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
      sObj.permission = {
        read: 'allow',
        edit: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        bash: 'allow',
        task: 'allow',
        external_directory: 'allow',
        todowrite: 'allow',
        question: 'allow',
        webfetch: 'allow',
        websearch: 'allow',
        lsp: 'allow',
        doom_loop: 'allow',
        skill: 'allow'
      };
      fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
    } catch {}
  }

  // If legacy config exists or legacy directory exists, sync it too
  if (fileExists(OPENCODE_LEGACY_DIR) || fileExists(OPENCODE_LEGACY_CONFIG)) {
    try {
      ensureDir(OPENCODE_LEGACY_DIR);
      fs.writeFileSync(OPENCODE_LEGACY_CONFIG, JSON.stringify(config, null, 2) + '\n');
    } catch {}
  }

  if (!silent) {
    console.log('  ✓ OpenCode MCP servers configured (konoha, semble, aislop)');
  }

  return { ok: true };
}

function deployOpenCodeRules(silent = true) {
  let agents = [];
  try {
    agents = loadAgents();
  } catch {}

  const fullInstructions = generateAgentsMd(agents, 'opencode');

  const targets = [
    path.join(OPENCODE_DIR, 'AGENTS.md'),
    path.join(OPENCODE_LEGACY_DIR, 'AGENTS.md')
  ];

  let deployed = 0;
  for (const dest of targets) {
    try {
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, fullInstructions, 'utf-8');
      deployed++;
    } catch {}
  }

  // Deploy rules/konoha.md
  const ruleTargets = [
    path.join(OPENCODE_DIR, 'rules', 'konoha.md'),
    path.join(OPENCODE_LEGACY_DIR, 'rules', 'konoha.md')
  ];
  for (const rDest of ruleTargets) {
    try {
      ensureDir(path.dirname(rDest));
      fs.writeFileSync(rDest, buildMainAgentContract('opencode') + '\n', 'utf8');
    } catch {}
  }

  // Deploy subagents to ~/.config/opencode/agents/ and ~/.opencode/agents/
  const agentDirs = [
    path.join(OPENCODE_DIR, 'agents'),
    path.join(OPENCODE_LEGACY_DIR, 'agents')
  ];
  for (const aDir of agentDirs) {
    try {
      ensureDir(aDir);
      for (const agent of agents) {
        if (!agent || !agent.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
        const subagentMd = generateGenericSubagentMd(agent, 'opencode');
        fs.writeFileSync(path.join(aDir, `${agent.name}.md`), subagentMd, 'utf8');
      }
    } catch {}
  }

  if (!silent && deployed > 0) console.log(`  ✓ Deployed Konoha instructions & agents to OpenCode`);
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
      stdio: silent ? 'ignore' : 'inherit'
    });
  } catch {}
  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
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
    } catch {}
  }

  if (!silent && deployed > 0) console.log(`  ✓ Deployed RTK rule to OpenCode`);
  return { ok: deployed > 0 };
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
      status.mcpAislop = !!(config.mcp && config.mcp['aislop']);
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
      delete config.mcp['aislop'];
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
