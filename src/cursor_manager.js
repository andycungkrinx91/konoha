const fs = require('fs');
const path = require('path');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('./semble_manager');
const { spawnSync } = require('child_process');
const {
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const deployUtils = require('./deploy_utils');

const {
  HOME,
  CURSOR_DIR, CURSOR_MCP_GLOBAL, CURSOR_MCP_LEGACY, CURSOR_AGENTS_GLOBAL, CURSOR_SKILLS_GLOBAL, AGENTS_SKILLS,
  CURSOR_HOOKS_GLOBAL, CURSOR_CLI_CONFIG, SKILLS_DB_DIR,
  SERVER_PATH, CURSOR_BOOTSTRAP_PATH, SRC_DIR
} = require('../bin/lib/paths');

const PROJECT_CURSOR_DIR = '.cursor';

const CURSOR_FALLBACK_MODEL = 'inherit';

const CURSOR_RULES_GLOBAL = path.join(CURSOR_DIR, 'rules');
const CURSOR_RTK_RULE_SRC = path.join(__dirname, 'templates', 'rules', 'rtk.mdc');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const {
  buildSubagentContract,
  buildLightweightContract,
  buildManagedContract
} = require('./agent_contract');

// isRtkInstalled is imported from platform_utils

function deployCursorRtkRule(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const targetRulesDir = path.join(home, '.cursor', 'rules');

  const rtkCmd = getRtkCommand();
  if (!rtkCmd) return { ok: false, reason: 'rtk-not-installed' };
  try {
    spawnSync(rtkCmd, ['init', '-g', '--agent', 'cursor', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8', timeout: 10000, stdio: isSilent ? 'ignore' : 'inherit', shell: process.platform === 'win32', windowsHide: true
    });
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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

function adaptInstructionsForCursor(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file|replace_file_content/g, 'Write/StrReplace')
    .replace(/run_command/g, 'Shell')
    .trim();
}

function resolveCursorModel(agent = {}) {
  return agent.cursor_fallback_model || agent.cursorFallbackModel || CURSOR_FALLBACK_MODEL;
}

function generateCursorSubagent(agent) {
  const readonly = agent.name === 'genin';
  const description = `${agent.description} Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
  
  let instructions = agent.instructions || '';
  // Strip any existing Before work: find_skill(...) checklist calls
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const findSkillCalls = agent.skills.map(s => `find_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const getSkillCalls = agent.skills.map(s => `get_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const loadingInstruction = `After discovery, load the full skill content with ${getSkillCalls}`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions;
    }
  }

  instructions = `${instructions}\n\n${buildSubagentContract('cursor')}`;
  const body = adaptInstructionsForCursor(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
  ];
  if (agent.model) {
    frontmatter.push(`model: ${agent.model}`);
  }
  if (readonly) {
    frontmatter.push('readonly: true');
  }
  frontmatter.push('---', '');

  return frontmatter.join('\n') + body + '\n\n' + sembleLine + '\n' + fileToolsLine + '\n';
}

function generateCursorRule(agents, ruleContent = null) {
  if (ruleContent) {
    const managed = buildManagedContract(ruleContent, buildLightweightContract({ client: 'cursor' }));
    return `---\ndescription: Konoha rules\nalwaysApply: true\n---\n\n` + managed;
  }
  const roster = (agents || []).map(a => {
    const title = a.name === 'anbu' ? 'Backend, DevOps & Security' : (a.title || 'Specialist');
    return `- **@${a.name}**: ${title}`;
  }).join('\n');

  const contractText = buildLightweightContract({ client: 'cursor' });

  const body = `---
description: Konoha rules
alwaysApply: true
---

# Cursor — Agent Rules

## Team Roster
${roster}

## Safety Guardrails
NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset\`) or view secrets (\`.env*\`).\n\n`;

  return buildManagedContract(body, contractText);
}

function _resolveUvxAvailable(uvxCmd) {
  try {
    return spawnSync(uvxCmd, ['--version'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32', windowsHide: true }).status === 0;
  } catch { return false; }
}

function _resolveAislopMcpConfig(npxCmd) {
  const isWin = process.platform === 'win32';
  let cmd = npxCmd, args = ['-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  try {
    const whichRes = spawnSync(isWin ? 'where' : 'which', ['aislop-mcp'], { encoding: 'utf-8', shell: isWin, timeout: 3000, windowsHide: true });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      const binPath = whichRes.stdout.trim().split('\n')[0].trim();
      if (binPath && fileExists(binPath)) { cmd = binPath; args = []; }
    }
  } catch { /* best-effort */ }
  return {
    type: 'stdio', command: cmd, args,
    autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
    auto_approve: true
  };
}

function buildMcpServers(pythonCmd, serverPath, uvxCmd) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const uvxAvailable = _resolveUvxAvailable(uvxCmd);
  const servers = {
    ...(uvxAvailable ? {
      semble: {
        type: 'stdio',
        command: uvxCmd,
        args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
        autoApprove: ['search', 'find_related'],
        auto_approve: true
      }
    } : {}),
    aislop: _resolveAislopMcpConfig(npxCmd)
  };

  const konohaEntry = deployUtils.buildKonohaFilesMcpEntry('cursor');
  if (konohaEntry) {
    konohaEntry.autoApprove = deployUtils.KONOHA_CANONICAL_TOOLS
      ? [...deployUtils.KONOHA_CANONICAL_TOOLS]
      : [];
    konohaEntry.auto_approve = true;
    servers['konoha'] = konohaEntry;
  }
  return servers;
}

function registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  const targetMcp = options.configPath || (options.home ? path.join(options.home, '.cursor', 'mcp.json') : CURSOR_MCP_GLOBAL);
  const targetDir = path.dirname(targetMcp);

  if (!serverPath || !fileExists(serverPath)) {
    return false;
  }

  const { parseYaml } = require('../bin/lib/yaml_utils');
  ensureDir(targetDir);

  const backupPath = targetMcp + '.back';
  if (fileExists(targetMcp) && !fileExists(backupPath)) {
    try { fs.copyFileSync(targetMcp, backupPath); } catch (_) { /* ignore backup error */ }
  }

  let config = { mcpServers: {} };
  if (fileExists(targetMcp)) {
    try {
      config = JSON.parse(fs.readFileSync(targetMcp, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid JSON in ${targetMcp}; leaving it unchanged.`);
      return false;
    }
  } else if (fileExists(CURSOR_MCP_LEGACY) && targetMcp === CURSOR_MCP_GLOBAL) {
    try {
      config = parseYaml(fs.readFileSync(CURSOR_MCP_LEGACY, 'utf-8')) || {};
    } catch {
      return false;
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  const servers = buildMcpServers(pythonCmd, serverPath, uvxCmd || 'uvx');
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(targetMcp, JSON.stringify(config, null, 2) + '\n');
  if (!silent) process.stderr.write(`✓ Merged Konoha MCP servers into ${targetMcp}\n`);
  return true;
}

function registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, uvxCmd, silent = true) {
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

  const servers = buildMcpServers(
    pythonCmd,
    serverPath,
    uvxCmd || 'uvx'
  );

  // Project config — absolute node path so GUI-launched Cursor (no shell PATH,
  // nvm/volta installs) can still start the MCP server
  if (servers['konoha']) {
    servers['konoha'] = {
      type: 'stdio',
      command: process.execPath || 'node',
      args: ['${userHome}/.konoha/file_tools_launcher.js']
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
    'Mcp(semble)', 'Mcp(semble, search)', 'Mcp(semble, find_related)',
    'Mcp(aislop)', 'Mcp(aislop, aislop_scan)', 'Mcp(aislop, aislop_fix)',
    'Mcp(aislop, aislop_why)', 'Mcp(aislop, aislop_baseline)',
    'Shell(rtk)', 'Shell(konoha)'
  ];
}

function _updateSingleCursorSettingsPath(sPath, grants) {
  try {
    let sObj = {};
    if (fileExists(sPath)) {
      try { sObj = JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {}; } catch { /* best-effort */ }
    }
    const kTools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
    sObj['cursor.mcp.autoApprove'] = [
      ...kTools.map(t => 'konoha/' + t), ...kTools.map(t => 'konoha:' + t), ...kTools,
      'semble/search', 'semble/find_related', 'semble:search', 'semble:find_related', 'search', 'find_related',
      'aislop/aislop_scan', 'aislop/aislop_fix', 'aislop/aislop_why', 'aislop/aislop_baseline',
      'aislop:aislop_scan', 'aislop:aislop_fix', 'aislop:aislop_why', 'aislop:aislop_baseline',
      'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'
    ];
    sObj['cursor.terminal.autoApprove'] = ['rtk', 'rtk *', 'konoha', 'konoha *'];
    if (!sObj.permissions || typeof sObj.permissions !== 'object') sObj.permissions = {};
    const allowArr = Array.isArray(sObj.permissions.allow) ? sObj.permissions.allow : [];
    sObj.permissions.allow = allowArr.filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));
    for (const grant of grants) {
      if (!sObj.permissions.allow.includes(grant)) sObj.permissions.allow.push(grant);
    }
    fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
  } catch { /* best-effort */ }
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
    try { config = JSON.parse(fs.readFileSync(cursorCliConfig, 'utf-8')) || {}; } catch { config = {}; }
  }

  if (!config.permissions) config.permissions = {};
  const allowRaw = Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
  config.permissions.allow = allowRaw.filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));

  let updated = false;
  for (const grant of grants) {
    if (!config.permissions.allow.includes(grant)) {
      config.permissions.allow.push(grant);
      updated = true;
    }
  }

  const kTools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
  config.autoApprove = ['rtk', 'rtk *', 'konoha', 'konoha *',
    ...kTools.map(t => `konoha:${t}`), ...kTools.map(t => `konoha/${t}`), ...kTools,
    'semble:search', 'semble:find_related', 'search', 'find_related',
    'aislop:aislop_scan', 'aislop:aislop_fix', 'aislop:aislop_why', 'aislop:aislop_baseline'];

  try {
    fs.writeFileSync(cursorCliConfig, JSON.stringify(config, null, 2) + '\n');
    if (updated && !isSilent) process.stderr.write(`✓ Cursor CLI permissions updated: ${cursorCliConfig}\n`);
  } catch { /* best-effort */ }

  const cursorSettingsPaths = [
    fileExists(cursorDir) ? path.join(cursorDir, 'settings.json') : null,
    process.platform !== 'win32' ? path.join(home, '.config', 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json') : null
  ].filter(p => p && (fileExists(p) || fileExists(path.dirname(p))));

  for (const sPath of cursorSettingsPaths) {
    _updateSingleCursorSettingsPath(sPath, grants);
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
    config.hooks.sessionStart = [...existing, { command: bootstrapCmd }];
    fs.writeFileSync(cursorHooksGlobal, JSON.stringify(config, null, 2) + '\n');
    if (!isSilent) process.stderr.write(`✓ Registered Cursor sessionStart hook: ${cursorHooksGlobal}\n`);
  }
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
    const content = generateCursorRule(agents);
    if (!fileExists(rulePath) || fs.readFileSync(rulePath, 'utf8') !== content) {
      fs.writeFileSync(rulePath, content, 'utf8');
    }
    if (!isSilent) process.stderr.write(`✓ Deployed global Cursor rule: ${rulePath}\n`);
    return true;
  } catch {
    return false;
  }
}

function deployProjectCursor(projectRoot, agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const rulesDir = path.join(cursorDir, 'rules');
  ensureDir(rulesDir);

  // Deploy orchestrator rule
  const rulePath = path.join(rulesDir, 'konoha.mdc');
  fs.writeFileSync(rulePath, generateCursorRule(agents, ruleContent));

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

function ensureCursorSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    agents = [],
    projectRoot = null,
    deployProject = true,
    silent = true,
    allowHooks = true,
    ruleContent = null
  } = options;

  copyCursorHelperScripts(options.home);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent, options);
  registerCursorCliPermissions(silent, options);
  registerCursorHooks(silent, allowHooks, options);
  deployCursorRtkRule(silent, options);
  const effectiveAgents = (agents && agents.length > 0) ? agents : require('./agent_manager').loadAgents();
  deployCursorGlobalRule(effectiveAgents, silent, options);

  const root = projectRoot || process.cwd();
  if (deployProject) {
    try {
      registerCursorProjectMcp(root, pythonCmd, serverPath, uvxCmd, silent);
      deployProjectCursor(root, effectiveAgents, silent, ruleContent);
    } catch { /* intentional best-effort fallback */ } }

  deployUtils.syncCursorSkillsFromAgents({ projectRoot, deployProject, silent });

  return { ok: true };
}

const CURSOR_REMOVAL_GRANTS = new Set([
  'Mcp(semble)', 'Mcp(semble, search)', 'Mcp(semble, find_related)', 'Mcp(konoha)',
  'Mcp(konoha, find_skill)', 'Mcp(konoha, get_skill)', 'Mcp(konoha, list_skills)', 'Mcp(konoha, optimize_report)',
  'Mcp(konoha, read_file_head)', 'Mcp(konoha, read_file_range)', 'Mcp(konoha, file_info)', 'Mcp(konoha, token_efficient_grep)',
  'Mcp(konoha, get_file_structure)', 'Mcp(konoha, find_files_clean)', 'Mcp(konoha-files)', 'Mcp(konoha-files, read_file_head)',
  'Mcp(konoha-files, read_file_range)', 'Mcp(konoha-files, file_info)', 'Mcp(konoha-files, token_efficient_grep)',
  'Mcp(konoha-files, get_file_structure)', 'Mcp(konoha-files, find_files_clean)', 'Shell(konoha)',
  'Shell(node bin/cli.js)', 'Shell(node */.konoha/cursor_bootstrap.js)'
]);

function _removeCursorMcpServers(cursorMcp, silent) {
  if (!fileExists(cursorMcp)) return;
  try {
    const config = JSON.parse(fs.readFileSync(cursorMcp, 'utf-8'));
    if (!config?.mcpServers) return;
    let updated = false;
    for (const name of ['konoha', 'semble', 'aislop', 'skills-db']) {
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
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];
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
    mcpGlobal: fileExists(CURSOR_MCP_GLOBAL),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonoha: false,
    subagentsGlobal: 0,
    skillsGlobal: 0,
    skillsProject: 0,
    cliPermissions: false,
    hooks: false,
    projectMcp: false,
    projectRule: false,
    projectAgents: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc'))
  };

  if (status.mcpGlobal) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      status.mcpSkillsDb = !!(config.mcpServers?.konoha);
      status.mcpSemble = !!(config.mcpServers?.semble);
      status.mcpKonoha = !!(config.mcpServers?.konoha);
    } catch { /* best-effort */ }
  }

  if (fileExists(CURSOR_AGENTS_GLOBAL)) {
    try {
      status.subagentsGlobal = fs.readdirSync(CURSOR_AGENTS_GLOBAL).filter(f => f.endsWith('.md')).length;
    } catch { /* best-effort */ }
  }

  if (fileExists(AGENTS_SKILLS)) {
    try { status.skillsGlobal = deployUtils.listSkillEntries(AGENTS_SKILLS).length; } catch { /* best-effort */ }
  }

  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allows = Array.isArray(config.permissions?.allow) ? config.permissions.allow : [];
      status.cliPermissions = allows.some(a => a.includes('konoha')) && allows.some(a => a.includes('semble'));
    } catch { /* best-effort */ }
  }

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      const hooks = config.hooks?.sessionStart || [];
      status.hooks = hooks.some(h => h.command?.includes('cursor_bootstrap.js'));
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
  CURSOR_MCP_GLOBAL,
  CURSOR_AGENTS_GLOBAL,
  CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG,
  CURSOR_RULES_GLOBAL,
  CURSOR_FALLBACK_MODEL,
  resolveCursorModel,
  isCursorInstalled,
  isRtkInstalled,
  generateCursorSubagent,
  generateCursorRule,
  buildMcpServers,
  registerCursorMcp,
  registerCursorProjectMcp,
  registerCursorCliPermissions,
  registerCursorHooks,
  deployProjectCursor,
  deployCursorGlobalRule,
  deployCursorRtkRule,
  ensureCursorSetup,
  removeCursorConfig,
  getCursorStatus,
  copyCursorHelperScripts
};
