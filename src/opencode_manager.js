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
const { AISLOP_PACKAGE } = require('./uvx_runtime');
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
} = require('./config_access').loadBinLib('paths');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { buildMainAgentContract } = require('./agent_contract');
const { loadAgents, generateAgentsMd } = require('./agent_manager');
const { buildSubagentToolGrants, assertNoWildcardGrants } = require('./mcp_clients/common');
const {
  writeManagedFileSafe,
  snapshotNonKonohaRuleFiles,
  restoreNonKonohaRuleFiles
} = require('./agent_file_safety');

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

function _copyOpenCodeBakSafe(configPath, bakPath) {
  if (fileExists(bakPath)) return;
  try {
    fs.copyFileSync(configPath, bakPath);
  } catch (_) { /* intentional best-effort backup */ }
}

function writeOpenCodeConfig(config, options = {}) {
  const configPath = getOpenCodeConfigPath(options);
  ensureDir(path.dirname(configPath));
  const backupMgr = require('./config_backup_manager');
  if (fileExists(configPath)) {
    backupMgr.ensureBackupBeforeModify(configPath, { client: 'opencode', scope: 'global', ...options });
    _copyOpenCodeBakSafe(configPath, `${configPath}.bak`);
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  try {
    backupMgr.recordOwnership(configPath, {
      client: 'opencode',
      scope: 'global',
      format: 'json',
      ownedKeys: ['mcp.konoha', 'mcp.aislop'],
      ownedArrayItems: { instructions: ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'] }
    }, options);
  } catch (_) { /* best-effort */ }
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

function _configureAislopMcpServer(config) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  let aislopCommand = [npxCmd, '-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  try {
    const whichCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (!config.permission || typeof config.permission !== 'object') {
    config.permission = {};
  }
  const defaultPerm = {
    read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow',
    list: 'allow', bash: 'allow', task: 'allow', todowrite: 'allow',
    question: 'allow', webfetch: 'allow', websearch: 'allow',
    lsp: 'allow', skill: 'allow', mcp: 'allow'
  };
  for (const [k, v] of Object.entries(defaultPerm)) {
    if (config.permission[k] === undefined) {
      config.permission[k] = v;
    }
  }
}

function _buildOpenCodeAgentPermission(agent = null) {
  const { isReadOnlyAgent, isRouterAgent } = require('./agent_file_safety');
  const readOnly = isReadOnlyAgent(agent);
  const router = isRouterAgent(agent);
  // OpenCode gates tools through `permission` categories.
  // Read-only agents (genin) explicitly deny edit, bash, todowrite, and nested task delegation.
  const permission = {
    read: 'allow',
    edit: readOnly ? 'deny' : 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: readOnly ? 'deny' : 'allow',
    task: router ? 'allow' : 'deny',
    todowrite: readOnly ? 'deny' : 'allow',
    question: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    lsp: 'allow',
    skill: 'allow',
    mcp: 'allow'
  };
  assertNoWildcardGrants(Object.values(permission), 'opencode agent permission');
  const toolGrants = buildSubagentToolGrants('opencode', agent);
  assertNoWildcardGrants(toolGrants, 'opencode subagent tools');
  return permission;
}

function _registerNinjaAgents(config) {
  const { getRoleDescription } = require('./agent_file_safety');
  const { getDeployableAgents } = require('./canonical_agents');

  try {
    const agents = getDeployableAgents(loadAgents());
    const agentMap = (config.agent && typeof config.agent === 'object') ? config.agent : {};

    for (const agent of agents) {
      if (!agent?.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const desc = getRoleDescription(agent);
      agentMap[agent.name] = {
        description: desc,
        prompt: agent.instructions || `Execute ${agent.name} workflow using konoha MCP tools.`,
        mode: 'subagent',
        permission: _buildOpenCodeAgentPermission(agent)
      };
    }
    config.agent = agentMap;
    const konohaInstructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
    const existingInstructions = Array.isArray(config.instructions) ? config.instructions : [];
    config.instructions = [...new Set([...konohaInstructions, ...existingInstructions])];
  } catch { /* intentional best-effort fallback */ }
}

function _loadOpenCodeSettingsSafe(sPath, options) {
  if (!fileExists(sPath)) return {};
  const backupMgr = require('./config_backup_manager');
  backupMgr.ensureBackupBeforeModify(sPath, { client: 'opencode', scope: 'global', ...options });
  try {
    return JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {};
  } catch (err) {
    if (!options.silent) console.warn(`Invalid JSON in ${sPath}: ${err.message}`);
    return null;
  }
}

const DEFAULT_OPENCODE_PERMISSIONS = {
  read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow',
  list: 'allow', bash: 'allow', task: 'allow', todowrite: 'allow',
  question: 'allow', webfetch: 'allow', websearch: 'allow',
  lsp: 'allow', skill: 'allow', mcp: 'allow'
};

function _applyDefaultOpenCodePermissions(permissionObj) {
  const perm = permissionObj && typeof permissionObj === 'object' ? permissionObj : {};
  for (const [k, v] of Object.entries(DEFAULT_OPENCODE_PERMISSIONS)) {
    if (perm[k] === undefined) perm[k] = v;
  }
  return perm;
}

function _syncSingleSettingsFile(sPath, options = {}) {
  try {
    ensureDir(path.dirname(sPath));
    const sObj = _loadOpenCodeSettingsSafe(sPath, options);
    if (!sObj) return;

    const konohaInstructions = ['AGENTS.md', 'rules/konoha.md', 'rules/rtk.md'];
    const existingInstructions = Array.isArray(sObj.instructions) ? sObj.instructions : [];
    sObj.instructions = [...new Set([...existingInstructions, ...konohaInstructions])];
    sObj.permission = _applyDefaultOpenCodePermissions(sObj.permission);
    fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }
}

function _syncLegacyOpenCodeConfig(legacyDir, legacyConfig, config, options) {
  if (!fileExists(legacyDir) && !fileExists(legacyConfig)) return;
  try {
    ensureDir(legacyDir);
    if (fileExists(legacyConfig)) {
      const backupMgr = require('./config_backup_manager');
      backupMgr.ensureBackupBeforeModify(legacyConfig, { client: 'opencode', scope: 'global', ...options });
    }
    fs.writeFileSync(legacyConfig, JSON.stringify(config, null, 2) + '\n');
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }
}

function _syncOpenCodeSettingsFiles(config, options = {}) {
  const home = options.home || HOME;
  const openCodeDir = options.home ? path.join(home, '.config', 'opencode') : OPENCODE_DIR;
  const legacyDir = options.home ? path.join(home, '.opencode') : OPENCODE_LEGACY_DIR;
  const legacyConfig = options.home ? path.join(legacyDir, 'opencode.json') : OPENCODE_LEGACY_CONFIG;
  const openCodeSettingsPaths = [
    path.join(openCodeDir, 'settings.json'),
    path.join(legacyDir, 'settings.json')
  ];
  for (const sPath of openCodeSettingsPaths) {
    _syncSingleSettingsFile(sPath, options);
  }
  _syncLegacyOpenCodeConfig(legacyDir, legacyConfig, config, options);
}

function _appendOpenCodeProjectConfig(projectRoot, pythonCmd, serverPath) {
  if (!projectRoot || !fileExists(projectRoot)) return;
  const targetPath = fileExists(path.join(projectRoot, '.opencode', 'opencode.json'))
    ? path.join(projectRoot, '.opencode', 'opencode.json')
    : path.join(projectRoot, 'opencode.json');
  registerOpenCodeMcp(pythonCmd, serverPath, true, { configPath: targetPath });
}

// MCP Server Registration

function registerOpenCodeMcp(pythonCmd, serverPath, silent = true, options = {}) {
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
  delete config.mcp['semble'];
  _configureAislopMcpServer(config);
  _configureOpenCodePermissions(config);
  _registerNinjaAgents(config);

  writeOpenCodeConfig(config, options);
  if (!options.configPath) {
    _syncOpenCodeSettingsFiles(config, options);
  }

  if (!silent) {
    process.stderr.write('  ✓ OpenCode MCP servers configured (konoha, aislop)\n');
  }

  return { ok: true };
}

function generateOpenCodeSubagentMd(agent) {
  const { AGENT_OWNERSHIP_MARKER, getRoleDescription, isReadOnlyAgent } = require('./agent_file_safety');
  const { buildSubagentContract } = require('./agent_contract');
  const desc = getRoleDescription(agent).replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim();
  const perm = _buildOpenCodeAgentPermission(agent);
  const permLines = Object.entries(perm).map(([k, v]) => `  ${k}: ${v}`);

  let instructions = String(agent.instructions || '').trim();
  if (instructions && !instructions.endsWith('.')) instructions += '.';
  if (Array.isArray(agent.skills) && agent.skills.length > 0) {
    const skillList = agent.skills.map((s) => `"${s}"`).join(', ');
    instructions = `MANDATORY FIRST ACTION before writing code: Call konoha.use_skills({ skills: [${skillList}] }) or konoha.get_skill to load your assigned domain guidelines into context. ${instructions}`;
  }
  const readOnlyNote = isReadOnlyAgent(agent)
    ? '\nRead-only enforcement: Never modify files or execute mutating commands.'
    : '';

  const frontmatter = [
    '---',
    `description: "${desc}"`,
    'mode: subagent',
    AGENT_OWNERSHIP_MARKER,
    'permission:',
    ...permLines,
    '---',
    ''
  ];

  return frontmatter.join('\n') + instructions + readOnlyNote + `\n\n${buildSubagentContract('opencode')}\n`;
}

function _writeOpenCodeAgentsDir(aDir, agents, options = {}) {
  try {
    const { writeAgentFileSafe } = require('./agent_file_safety');
    const { getDeployableAgents } = require('./canonical_agents');
    ensureDir(aDir);
    for (const agent of getDeployableAgents(agents)) {
      if (!agent || !agent.name || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const subagentMd = generateOpenCodeSubagentMd(agent);
      writeAgentFileSafe(path.join(aDir, `${agent.name}.md`), subagentMd, agent.name, options);
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
      const finalDest = agentMgr.injectManagedConfig(dest, fullInstructions, 'KONOHA', { client: 'opencode', scope: 'global', ...opts });
      fs.writeFileSync(dest, finalDest, 'utf-8');
      deployed++;
    } catch (err) {
      if (err && /backup/i.test(err.message)) throw err;
    }
  }

  // Deploy rules/konoha.md without overwriting user-authored rules
  const ruleTargets = [
    path.join(openCodeDir, "rules", "konoha.md"),
    path.join(legacyDir, "rules", "konoha.md")
  ];
  const ruleContent = buildMainAgentContract("opencode") + "\n";
  for (const rDest of ruleTargets) {
    try {
      writeManagedFileSafe(rDest, ruleContent, { silent: isSilent });
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

function _runBestEffortOpenCodeRtkInit(rtkCmd, isSilent) {
  if (!rtkCmd) return;
  try {
    spawnSync(rtkCmd, ['init', '-g', '--opencode', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: isSilent ? 'ignore' : 'inherit',
      windowsHide: true
    });
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

function _resolveOpenCodeRtkSource() {
  const { resolveRtkRuleTemplate } = require('./mcp_clients/common');
  const primary = resolveRtkRuleTemplate();
  if (primary && fileExists(primary)) return primary;
  const fallback = path.join(os.homedir(), '.claude', 'rules', 'rtk.md');
  return fileExists(fallback) ? fallback : null;
}

function _writeRtkRuleTargets(targets, content, isSilent) {
  let deployed = 0;
  for (const dest of targets) {
    try {
      writeManagedFileSafe(dest, content, { silent: isSilent });
      deployed++;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  return deployed;
}

function deployOpenCodeRtkRule(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE;
  const openCodeDir = opts.home ? path.join(opts.home, '.config', 'opencode') : (home && home !== HOME ? path.join(home, '.config', 'opencode') : OPENCODE_DIR);
  const legacyDir = opts.home ? path.join(opts.home, '.opencode') : (home && home !== HOME ? path.join(home, '.opencode') : OPENCODE_LEGACY_DIR);
  const targets = [
    path.join(openCodeDir, 'rules', 'rtk.md'),
    path.join(legacyDir, 'rules', 'rtk.md')
  ];
  const protectedSnaps = snapshotNonKonohaRuleFiles(targets);

  // The rule template is static; `rtk init` only enriches it and stays best-effort.
  _runBestEffortOpenCodeRtkInit(getRtkCommand(), isSilent);
  restoreNonKonohaRuleFiles(protectedSnaps);

  const src = _resolveOpenCodeRtkSource();
  if (!src) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  let deployed = 0;
  try {
    deployed = _writeRtkRuleTargets(targets, fs.readFileSync(src, 'utf8'), isSilent);
  } catch { /* intentional best-effort fallback */ }

  if (!isSilent && deployed > 0) process.stderr.write(`  ✓ Deployed RTK rule to OpenCode\n`);
  return { ok: deployed > 0 };
}

// Status Checking

function getOpenCodeStatus() {
  const status = {
    installed: isOpenCodeInstalled(),
    configExists: fileExists(OPENCODE_CONFIG) || fileExists(OPENCODE_LEGACY_CONFIG),
    configPath: getOpenCodeConfigPath(),
    mcpKonoha: false,
    rtkRuleDeployed: fileExists(path.join(OPENCODE_DIR, 'rules', 'rtk.md'))
  };

  if (status.configExists) {
    try {
      const config = readOpenCodeConfig();
      status.mcpKonoha = !!(config.mcp && config.mcp['konoha']);
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
  const mcpResult = registerOpenCodeMcp(pythonCmd, serverPath, silent, options);
  if (!mcpResult.ok) {
    return { ok: false, reason: mcpResult.reason || 'opencode-mcp-registration-failed' };
  }

  // Deploy the shared contract and RTK rule (OpenCode has no RTK hook).
  const contractRule = deployOpenCodeRules(silent, options);
  const rtkRule = deployOpenCodeRtkRule(silent, options);

  const projectRoot = options.projectRoot || null;
  const hasExistingProj = projectRoot && (
    fileExists(path.join(projectRoot, 'opencode.json')) ||
    fileExists(path.join(projectRoot, '.opencode', 'opencode.json'))
  );
  if (projectRoot && (options.appendProject || (options.deployProject && hasExistingProj))) {
    _appendOpenCodeProjectConfig(projectRoot, pythonCmd, serverPath);
  }

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
  deployOpenCodeRtkRule,
  generateOpenCodeSubagentMd
};
