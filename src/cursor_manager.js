
const { getCanonicalAgentNames } = require('./canonical_agents');
const {
  generateCursorSubagent,
  generateCursorRule,
  resolveCursorModel
} = require('./cursor_rules');
const fs = require('fs');
const path = require('path');
const { AISLOP_PACKAGE } = require('./uvx_runtime');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');
const { resolveCompatibleNode } = require('./runtime_resolver');

const {
  HOME,
  CURSOR_DIR, CURSOR_MCP_GLOBAL, CURSOR_MCP_LEGACY, CURSOR_AGENTS_GLOBAL, CURSOR_SKILLS_GLOBAL, AGENTS_SKILLS,
  CURSOR_HOOKS_GLOBAL, CURSOR_CLI_CONFIG, SKILLS_DB_DIR,
  SERVER_PATH, CURSOR_BOOTSTRAP_PATH, SRC_DIR, FILE_TOOLS_LAUNCHER_JS
} = require('../bin/lib/paths');

const PROJECT_CURSOR_DIR = '.cursor';

const CURSOR_FALLBACK_MODEL = 'inherit';

const CURSOR_RULES_GLOBAL = path.join(CURSOR_DIR, 'rules');
const CURSOR_RTK_RULE_SRC = path.join(__dirname, 'templates', 'rules', 'rtk.mdc');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');

function deployCursorRtkRule(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const targetRulesDir = path.join(home, '.cursor', 'rules');

  // The rule template is static, so it deploys with or without `rtk` on PATH;
  // `rtk init` only enriches it and stays best-effort.
  const rtkCmd = getRtkCommand();
  if (rtkCmd) {
    try {
      spawnSync(rtkCmd, ['init', '-g', '--agent', 'cursor', '--auto-patch', '--trust-filters'], {
        encoding: 'utf-8', timeout: 10000, stdio: isSilent ? 'ignore' : 'inherit', windowsHide: true
      });
    } catch { /* best-effort enrichment: never crash the CLI/MCP runtime */ }
  }
  if (!fileExists(CURSOR_RTK_RULE_SRC)) return { ok: false, reason: 'rtk-rule-template-missing' };
  ensureDir(targetRulesDir);
  const dest = path.join(targetRulesDir, 'rtk.mdc');
  try {
    fs.copyFileSync(CURSOR_RTK_RULE_SRC, dest);
    if (!isSilent) process.stderr.write(`  ✓ Deployed RTK rule to ${dest}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function isCursorInstalled() {
  return isCommandAvailable('cursor') || isCommandAvailable('agent') || fileExistsCached(CURSOR_DIR) || fileExistsCached(CURSOR_MCP_GLOBAL) || fileExistsCached(CURSOR_MCP_LEGACY);
}

function _buildClientPathEnv(nodeCmd) {
  const localBin = path.join(HOME, '.local', 'bin');
  const cargoBin = path.join(HOME, '.cargo', 'bin');
  const nodeDir = nodeCmd ? path.dirname(nodeCmd) : '';
  return [nodeDir, localBin, cargoBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
}

function _resolveAislopMcpConfig(npxCmd) {
  const isWin = process.platform === 'win32';
  let cmd = npxCmd, args = ['-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  try {
    const whichRes = spawnSync(isWin ? 'where.exe' : 'which', ['aislop-mcp'], { encoding: 'utf-8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      const binPath = whichRes.stdout.trim().split('\n')[0].trim();
      if (binPath && fileExists(binPath)) { cmd = binPath; args = []; }
    }
  } catch { /* best-effort */ }
  return {
    type: 'stdio', command: cmd, args,
    env: { PATH: _buildClientPathEnv(null) },
    autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
    auto_approve: true
  };
}

function buildMcpServers() {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const servers = {
    aislop: _resolveAislopMcpConfig(npxCmd)
  };

  const konohaEntry = deployUtils.buildKonohaFilesMcpEntry('cursor');
  if (konohaEntry) {
    konohaEntry.autoApprove = deployUtils.KONOHA_CANONICAL_TOOLS ? [...deployUtils.KONOHA_CANONICAL_TOOLS] : [];
    konohaEntry.auto_approve = true;
    servers['konoha'] = konohaEntry;
  }
  return servers;
}

function _backupCursorMcpSafe(targetMcp, backupPath, konohaHome, options = {}) {
  if (!fileExists(targetMcp)) return;
  const backupMgr = require('./config_backup_manager');
  backupMgr.ensureBackupBeforeModify(targetMcp, { client: 'cursor', scope: 'global', konohaHome, ...options });
  if (!fileExists(backupPath)) {
    try { fs.copyFileSync(targetMcp, backupPath); } catch (_) { /* ignore legacy .bak copy error */ }
  }
}

function registerCursorMcp(pythonCmd, serverPath, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  const targetMcp = options.configPath || (options.home ? path.join(options.home, '.cursor', 'mcp.json') : CURSOR_MCP_GLOBAL);
  const targetDir = path.dirname(targetMcp);

  if (!serverPath || !fileExists(serverPath)) return false;

  const { parseYaml } = require('../bin/lib/yaml_utils');
  ensureDir(targetDir);

  const backupPath = targetMcp + '.back';
  _backupCursorMcpSafe(targetMcp, backupPath, options.konohaHome, options);

  let config = { mcpServers: {} };
  if (fileExists(targetMcp)) {
    try { config = JSON.parse(fs.readFileSync(targetMcp, 'utf-8')) || {}; } catch (err) {
      if (!silent) console.warn(`Invalid JSON in ${targetMcp}; leaving it unchanged: ${err.message}`);
      return false;
    }
  } else if (fileExists(CURSOR_MCP_LEGACY) && targetMcp === CURSOR_MCP_GLOBAL) {
    try {
      config = parseYaml(fs.readFileSync(CURSOR_MCP_LEGACY, 'utf-8')) || {};
    } catch (err) {
      if (!silent) console.warn(`Failed to parse legacy YAML config in ${CURSOR_MCP_LEGACY}: ${err.message}`);
      return false;
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  const servers = buildMcpServers();
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(targetMcp, JSON.stringify(config, null, 2) + '\n');
  try {
    const backupMgr = require('./config_backup_manager');
    backupMgr.recordOwnership(targetMcp, {
      client: 'cursor',
      scope: 'global',
      format: 'json',
      ownedKeys: Object.keys(servers).map(k => `mcpServers.${k}`)
    }, options.konohaHome);
  } catch (_) { /* best-effort */ }
  if (!silent) process.stderr.write(`✓ Merged Konoha MCP servers into ${targetMcp}\n`);
  return true;
}

function registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const { parseYaml } = require('../bin/lib/yaml_utils');
  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const mcpPath = path.join(cursorDir, 'mcp.json');
  const legacyMcpPath = path.join(cursorDir, 'mcp.yaml');
  ensureDir(cursorDir);

  let config = { mcpServers: {} };
  if (fileExists(mcpPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Skipped project MCP update: invalid JSON in ${mcpPath}`);
      return false;
    }
  } else if (fileExists(legacyMcpPath)) {
    try {
      config = parseYaml(fs.readFileSync(legacyMcpPath, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Skipped project MCP update: invalid legacy YAML in ${legacyMcpPath}`);
      return false;
    }
  }
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }

  const servers = buildMcpServers();

  const launcherPath = fileExists(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : serverPath;
  if (servers['konoha']) {
    const nodeCmd = resolveCompatibleNode() || process.execPath || 'node';
    servers['konoha'] = {
      type: 'stdio',
      command: nodeCmd,
      args: [launcherPath],
      env: {
        ACTIVE_CLIENT: 'cursor',
        KONOHA_CLIENT: 'cursor',
        KONOHA_SEMANTIC_SEARCH: '1',
        PATH: _buildClientPathEnv(nodeCmd)
      },
      autoApprove: deployUtils.KONOHA_CANONICAL_TOOLS ? [...deployUtils.KONOHA_CANONICAL_TOOLS] : [],
      auto_approve: true
    };
  }

  let updated = false;
  for (const [name, entry] of Object.entries(servers)) {
    const existing = config.mcpServers[name];
    if (
      !existing ||
      existing.command !== entry.command ||
      JSON.stringify(existing.args || []) !== JSON.stringify(entry.args || [])
    ) {
      config.mcpServers[name] = entry;
      updated = true;
    }
  }

  if (updated || !fileExists(mcpPath)) {
    const backupMgr = require('./config_backup_manager');
    if (fileExists(mcpPath)) {
      backupMgr.ensureBackupBeforeModify(mcpPath, { client: 'cursor', scope: 'project', projectRoot });
    }
    try {
      backupMgr.recordOwnership(mcpPath, {
        client: 'cursor',
        scope: 'project',
        format: 'json',
        ownedKeys: Object.keys(servers).map(k => `mcpServers.${k}`)
      });
    } catch (_) { /* best-effort */ }
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      process.stderr.write(`✓ Registered project MCP config: ${mcpPath}\n`);
    }
  }
  return true;
}

function _getCursorGrants() {
  const konohaGrants = (deployUtils.KONOHA_CANONICAL_TOOLS || []).map(t => `Mcp(konoha, ${t})`);
  return [
    'Mcp(konoha)', ...konohaGrants,
    'Mcp(aislop)', 'Mcp(aislop, aislop_scan)', 'Mcp(aislop, aislop_fix)',
    'Mcp(aislop, aislop_why)', 'Mcp(aislop, aislop_baseline)',
    'Shell(rtk)', 'Shell(konoha)'
  ];
}

function _loadCursorSettingsObject(sPath, options) {
  if (!fileExists(sPath)) return {};
  const backupMgr = require('./config_backup_manager');
  backupMgr.ensureBackupBeforeModify(sPath, { client: 'cursor', scope: 'global', ...options });
  try {
    return JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {};
  } catch (err) {
    if (!options.silent) console.warn(`Invalid JSON in ${sPath}: ${err.message}`);
    return null;
  }
}

function _updateSingleCursorSettingsPath(sPath, grants, options = {}) {
  try {
    const sObj = _loadCursorSettingsObject(sPath, options);
    if (!sObj) return;
    const kTools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
    const konohaMcpApprovals = [
      ...kTools.map(t => 'konoha/' + t), ...kTools.map(t => 'konoha:' + t), ...kTools,
      'aislop/aislop_scan', 'aislop/aislop_fix', 'aislop/aislop_why', 'aislop/aislop_baseline',
      'aislop:aislop_scan', 'aislop:aislop_fix', 'aislop:aislop_why', 'aislop:aislop_baseline',
      'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'
    ];
    sObj['cursor.mcp.autoApprove'] = Array.isArray(sObj['cursor.mcp.autoApprove'])
      ? [...new Set([...sObj['cursor.mcp.autoApprove'], ...konohaMcpApprovals])]
      : (sObj['cursor.mcp.autoApprove'] ?? konohaMcpApprovals);
    const konohaTermApprovals = ['rtk', 'rtk *', 'konoha', 'konoha *'];
    sObj['cursor.terminal.autoApprove'] = Array.isArray(sObj['cursor.terminal.autoApprove'])
      ? [...new Set([...sObj['cursor.terminal.autoApprove'], ...konohaTermApprovals])]
      : (sObj['cursor.terminal.autoApprove'] ?? konohaTermApprovals);
    if (!sObj.permissions || typeof sObj.permissions !== 'object') sObj.permissions = {};
    const allowArr = Array.isArray(sObj.permissions.allow) ? sObj.permissions.allow : [];
    sObj.permissions.allow = allowArr.filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));
    for (const grant of grants) {
      if (!sObj.permissions.allow.includes(grant)) sObj.permissions.allow.push(grant);
    }
    fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }
}

function registerCursorCliPermissions(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const cursorDir = path.join(home, '.cursor');
  const cursorCliConfig = path.join(cursorDir, 'cli-config.json');

  const grants = _getCursorGrants();
  ensureDir(cursorDir);

  let config = {};
  if (fileExists(cursorCliConfig)) {
    const backupMgr = require('./config_backup_manager');
    backupMgr.ensureBackupBeforeModify(cursorCliConfig, { client: 'cursor', scope: 'global', ...opts });
    try { config = JSON.parse(fs.readFileSync(cursorCliConfig, 'utf-8')) || {}; } catch { return false; }
  }

  if (!config.permissions) config.permissions = {};
  const allowRaw = Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
  config.permissions.allow = allowRaw.filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));

  const beforeLen = config.permissions.allow.length;
  config.permissions.allow = [...new Set([...config.permissions.allow, ...grants])];
  const updated = config.permissions.allow.length !== beforeLen;

  const kTools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
  const konohaAutoApprove = ['rtk', 'rtk *', 'konoha', 'konoha *',
    ...kTools.map(t => `konoha:${t}`), ...kTools.map(t => `konoha/${t}`), ...kTools,
    'aislop:aislop_scan', 'aislop:aislop_fix', 'aislop:aislop_why', 'aislop:aislop_baseline'];
  config.autoApprove = Array.isArray(config.autoApprove)
    ? [...new Set([...config.autoApprove, ...konohaAutoApprove])]
    : konohaAutoApprove;

  try {
    fs.writeFileSync(cursorCliConfig, JSON.stringify(config, null, 2) + '\n');
    const backupMgr = require('./config_backup_manager');
    backupMgr.recordOwnership(cursorCliConfig, {
      client: 'cursor',
      scope: 'global',
      format: 'json',
      ownedArrayItems: { 'permissions.allow': grants, autoApprove: konohaAutoApprove }
    }, opts.konohaHome);
    if (updated && !isSilent) process.stderr.write(`✓ Cursor CLI permissions updated: ${cursorCliConfig}\n`);
  } catch { /* best-effort */ }

  const cursorSettingsPaths = [
    fileExists(cursorDir) ? path.join(cursorDir, 'settings.json') : null,
    path.join(home, '.config', 'Cursor', 'User', 'settings.json'),
    (opts.appdata || process.env.APPDATA) ? path.join(opts.appdata || process.env.APPDATA, 'Cursor', 'User', 'settings.json') : null,
    path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'settings.json'),
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json')
  ].filter(p => p && (fileExists(p) || fileExists(path.dirname(p))));

  for (const sPath of Array.from(new Set(cursorSettingsPaths))) {
    _updateSingleCursorSettingsPath(sPath, grants, opts);
  }
  return true;
}

function _cleanupCursorSessionStartHook(hooksFilePath) {
  if (!fileExists(hooksFilePath)) return;
  try {
    const config = JSON.parse(fs.readFileSync(hooksFilePath, 'utf-8'));
    if (!config?.hooks?.sessionStart) return;
    config.hooks.sessionStart = config.hooks.sessionStart.filter(h => !(h.command?.includes('cursor_bootstrap.js')));
    if (config.hooks.sessionStart.length === 0) delete config.hooks.sessionStart;
    fs.writeFileSync(hooksFilePath, JSON.stringify(config, null, 2) + '\n');
  } catch { /* best-effort */ }
}

function _loadCursorHooksConfig(hooksFilePath) {
  if (!fileExists(hooksFilePath)) return { version: 1, hooks: {} };
  try {
    const config = JSON.parse(fs.readFileSync(hooksFilePath, 'utf-8'));
    return { version: 1, ...config, hooks: config?.hooks || {} };
  } catch {
    return { version: 1, hooks: {} };
  }
}

function registerCursorHooks(silent = true, allowHooks = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const cursorDir = path.join(home, '.cursor');
  const cursorHooksGlobal = path.join(cursorDir, 'hooks.json');

  if (!allowHooks) {
    _cleanupCursorSessionStartHook(cursorHooksGlobal);
    return false;
  }

  ensureDir(cursorDir);
  const config = _loadCursorHooksConfig(cursorHooksGlobal);
  const bootstrapCmd = `"${process.execPath}" "${CURSOR_BOOTSTRAP_PATH}"`;
  const existing = config.hooks.sessionStart || [];
  if (!existing.some(h => h.command?.includes('cursor_bootstrap.js'))) {
    if (fileExists(cursorHooksGlobal)) {
      const backupMgr = require('./config_backup_manager');
      backupMgr.ensureBackupBeforeModify(cursorHooksGlobal, { client: 'cursor', scope: 'global', ...opts });
    }
    config.hooks.sessionStart = [...existing, { command: bootstrapCmd }];
    fs.writeFileSync(cursorHooksGlobal, JSON.stringify(config, null, 2) + '\n');
    if (!isSilent) process.stderr.write(`✓ Registered Cursor sessionStart hook: ${cursorHooksGlobal}\n`);
  }
  return true;
}

function _writeCursorRuleIfChanged(rulePath, content, opts) {
  if (fileExists(rulePath) && fs.readFileSync(rulePath, 'utf8') === content) {
    return false;
  }
  if (fileExists(rulePath)) {
    const backupMgr = require('./config_backup_manager');
    backupMgr.ensureBackupBeforeModify(rulePath, { client: 'cursor', scope: 'global', ...opts });
  }
  fs.writeFileSync(rulePath, content, 'utf8');
  return true;
}

function deployCursorGlobalRule(agents, silent = true, options = {}) {
  if (!agents || agents.length === 0) return false;
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const cursorRulesGlobal = path.join(home, '.cursor', 'rules');

  try {
    ensureDir(cursorRulesGlobal);
    const rulePath = path.join(cursorRulesGlobal, 'konoha.mdc');
    _writeCursorRuleIfChanged(rulePath, generateCursorRule(agents), opts);
    if (!isSilent) process.stderr.write(`✓ Deployed global Cursor rule: ${rulePath}\n`);
    return true;
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    return false;
  }
}

function _writeCursorAgentIfChanged(cursorAgentsGlobal, agent, official) {
  if (!agent || !agent.name || !official.has(agent.name)) return;
  const agentPath = path.join(cursorAgentsGlobal, `${agent.name}.md`);
  const content = generateCursorSubagent(agent);
  if (!fileExists(agentPath) || fs.readFileSync(agentPath, 'utf8') !== content) {
    fs.writeFileSync(agentPath, content, 'utf8');
  }
}

function deployCursorGlobalAgents(agents, silent = true, options = {}) {
  if (!agents || agents.length === 0) return false;
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const cursorAgentsGlobal = path.join(home, '.cursor', 'agents');

  try {
    ensureDir(cursorAgentsGlobal);
    const official = new Set(getCanonicalAgentNames());
    for (const agent of agents) {
      _writeCursorAgentIfChanged(cursorAgentsGlobal, agent, official);
    }
    if (!isSilent) process.stderr.write(`✓ Deployed global Cursor subagents: ${cursorAgentsGlobal}\n`);
    return true;
  } catch {
    return false;
  }
}

function deployProjectCursor(projectRoot, agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const rulesDir = path.join(cursorDir, 'rules');
  const agentsDir = path.join(cursorDir, 'agents');
  ensureDir(rulesDir);
  ensureDir(agentsDir);

  // Deploy orchestrator rule
  const rulePath = path.join(rulesDir, 'konoha.mdc');
  fs.writeFileSync(rulePath, generateCursorRule(agents, ruleContent));

  const official = new Set(getCanonicalAgentNames());
  for (const agent of (agents || [])) {
    if (!agent || !agent.name || !official.has(agent.name)) continue;
    fs.writeFileSync(path.join(agentsDir, `${agent.name}.md`), generateCursorSubagent(agent), 'utf8');
  }

  if (!silent) {
    process.stderr.write(`✓ Deployed project Cursor config to ${cursorDir}\n`);
  }
  return true;
}

function copyCursorHelperScripts(home = null) {
  const src = path.join(SRC_DIR, 'cursor_bootstrap.js');
  const targetDir = home ? path.join(home, ".konoha") : SKILLS_DB_DIR;
  const dest = path.join(targetDir, 'cursor_bootstrap.js');
  if (!fileExists(src)) return false;
  try {
    ensureDir(SKILLS_DB_DIR);
    const srcContent = fs.readFileSync(src);
    if (!fileExists(dest) || !srcContent.equals(fs.readFileSync(dest))) {
      fs.writeFileSync(dest, srcContent);
      return true;
    }
  } catch { /* intentional best-effort fallback */ }
  return false;
}

function _hasExistingCursorProjectConfig(projectRoot) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  return (
    fileExists(path.join(projectRoot, '.cursor', 'mcp.json')) ||
    fileExists(path.join(projectRoot, '.cursor', 'rules', 'konoha.mdc'))
  );
}

function ensureCursorSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    agents = [],
    projectRoot = null,
    deployProject = false,
    appendProject = false,
    silent = true,
    allowHooks = true
  } = options;

  copyCursorHelperScripts(options.home);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, silent, options);
  registerCursorCliPermissions(silent, options);
  registerCursorHooks(silent, allowHooks, options);
  deployCursorRtkRule(silent, options);
  const effectiveAgents = (agents && agents.length > 0) ? agents : require('./agent_manager').loadAgents();
  deployCursorGlobalRule(effectiveAgents, silent, options);
  deployCursorGlobalAgents(effectiveAgents, silent, options);

  if (projectRoot && (appendProject || (deployProject && _hasExistingCursorProjectConfig(projectRoot)))) {
    registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, silent);
    deployProjectCursor(projectRoot, effectiveAgents, silent, options.ruleContent || null);
  }

  return { ok: true };
}

const CURSOR_REMOVAL_GRANTS = new Set([
  'Mcp(semble)', 'Mcp(semble, search)', 'Mcp(semble, find_related)', 'Mcp(konoha)',
  'Mcp(konoha, find_skill)', 'Mcp(konoha, get_skill)', 'Mcp(konoha, list_skills)', 'Mcp(konoha, optimize_report)',
  'Mcp(konoha, read_file_head)', 'Mcp(konoha, read_file_range)', 'Mcp(konoha, file_info)', 'Mcp(konoha, token_efficient_grep)',
  'Mcp(konoha, get_file_structure)', 'Mcp(konoha, find_files_clean)', 'Mcp(konoha-files)', 'Mcp(konoha-files, read_file_head)',
  'Mcp(konoha-files, read_file_range)', 'Mcp(konoha-files, file_info)', 'Mcp(konoha-files, token_efficient_grep)',
  'Mcp(konoha-files, get_file_structure)', 'Mcp(konoha-files, find_files_clean)', 'Shell(konoha)', 'Shell(node bin/cli.js)', 'Shell(node */.konoha/cursor_bootstrap.js)'
]);

function _removeCursorMcpServers(cursorMcp, silent) {
  if (!fileExists(cursorMcp)) return;
  try {
    const config = JSON.parse(fs.readFileSync(cursorMcp, 'utf-8'));
    if (!config?.mcpServers) return;
    let updated = false;
    for (const name of ['konoha', 'aislop', 'skills-db', 'semble']) {
      if (config.mcpServers[name]) { delete config.mcpServers[name]; updated = true; }
    }
    if (updated) {
      fs.writeFileSync(cursorMcp, JSON.stringify(config, null, 2) + '\n');
      if (!silent) process.stderr.write('✓ Removed Konoha MCP servers from ~/.cursor/mcp.json\n');
    }
  } catch { /* best-effort */ }
}

function _removeCursorBridgeExtension(cursorExtDir, silent) {
  if (!fileExists(cursorExtDir)) return;
  try {
    for (const entry of fs.readdirSync(cursorExtDir)) {
      if (entry.toLowerCase().startsWith('andycungkrinx91.konoha-bridge')) {
        fs.rmSync(path.join(cursorExtDir, entry), { recursive: true, force: true });
        if (!silent) process.stderr.write('✓ Removed konoha-bridge extension from ~/.cursor/extensions\n');
      }
    }
  } catch { /* best-effort */ }
}

function _cleanCursorCliPermissions(silent) {
  if (!fileExists(CURSOR_CLI_CONFIG)) return;
  try {
    const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
    const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
    if (allowArr.length === 0) return;
    const filtered = allowArr.filter(p => !CURSOR_REMOVAL_GRANTS.has(p));
    if (filtered.length !== allowArr.length) {
      config.permissions.allow = filtered;
      fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
      if (!silent) process.stderr.write('✓ Removed Konoha permissions from ~/.cursor/cli-config.json\n');
    }
  } catch { /* best-effort */ }
}

function _removeGlobalCursorAgents(agentsGlobal) {
  const official = getCanonicalAgentNames();
  for (const name of official) {
    const p = path.join(agentsGlobal, `${name}.md`);
    if (fileExists(p)) { try { fs.unlinkSync(p); } catch { /* best-effort */ } }
  }
}

function removeCursorConfig(silent = true, options = {}) {
  const home = options.home || process.env.HOME || HOME;
  const cursorMcp = options.configPath || (home === HOME ? CURSOR_MCP_GLOBAL : path.join(home, '.cursor', 'mcp.json'));

  _removeCursorMcpServers(cursorMcp, silent);
  _removeCursorBridgeExtension(options.extensionsDir || path.join(home, '.cursor', 'extensions'), silent);
  _removeGlobalCursorAgents(path.join(home, '.cursor', 'agents'));
  _cleanCursorCliPermissions(silent);
  registerCursorHooks(silent, false);
}

function getCursorStatus() {
  const status = {
    mcpGlobal: fileExists(CURSOR_MCP_GLOBAL), mcpSkillsDb: false, mcpKonoha: false,
    subagentsGlobal: 0, skillsGlobal: 0, skillsProject: 0, cliPermissions: false, hooks: false,
    projectMcp: false, projectRule: false, projectAgents: 0, rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc'))
  };

  if (status.mcpGlobal) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      status.mcpSkillsDb = !!(cfg.mcpServers?.konoha);
      status.mcpKonoha = !!(cfg.mcpServers?.konoha);
    } catch { /* best-effort */ }
  }
  if (fileExists(CURSOR_AGENTS_GLOBAL)) {
    try { status.subagentsGlobal = fs.readdirSync(CURSOR_AGENTS_GLOBAL).filter(f => f.endsWith('.md')).length; } catch { /* best-effort */ }
  }
  if (fileExists(AGENTS_SKILLS)) {
    try { status.skillsGlobal = deployUtils.listSkillEntries(AGENTS_SKILLS).length; } catch { /* best-effort */ }
  }
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allows = Array.isArray(cfg.permissions?.allow) ? cfg.permissions.allow : [];
      status.cliPermissions = allows.some(a => a.includes('konoha'));
    } catch { /* best-effort */ }
  }
  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      status.hooks = (cfg.hooks?.sessionStart || []).some(h => h.command?.includes('cursor_bootstrap.js'));
    } catch { /* best-effort */ }
  }
  const cwd = process.cwd();
  const projectAgents = path.join(cwd, PROJECT_CURSOR_DIR, 'agents');
  status.projectMcp = fileExists(path.join(cwd, PROJECT_CURSOR_DIR, 'mcp.json'));
  status.projectRule = fileExists(path.join(cwd, PROJECT_CURSOR_DIR, 'rules', 'konoha.mdc'));
  if (fileExists(projectAgents)) {
    try { status.projectAgents = fs.readdirSync(projectAgents).filter(f => f.endsWith('.md')).length; } catch { /* best-effort */ }
  }
  return status;
}

module.exports = {
  CURSOR_MCP_GLOBAL, CURSOR_AGENTS_GLOBAL, CURSOR_SKILLS_GLOBAL, CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG, CURSOR_RULES_GLOBAL, CURSOR_FALLBACK_MODEL, resolveCursorModel,
  isCursorInstalled, isRtkInstalled, generateCursorSubagent, generateCursorRule,
  buildMcpServers, registerCursorMcp, registerCursorProjectMcp, registerCursorCliPermissions,
  registerCursorHooks, deployProjectCursor, deployCursorGlobalRule, deployCursorGlobalAgents,
  deployCursorRtkRule, ensureCursorSetup, removeCursorConfig, getCursorStatus, copyCursorHelperScripts
};
