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
const CURSOR_RTK_RULE_SRC = path.join(__dirname, '..', '.cursor', 'rules', 'rtk.mdc');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const {
  buildSubagentContract,
  buildLightweightContract,
  buildManagedContract
} = require('./agent_contract');

// isRtkInstalled is imported from platform_utils

function deployCursorRtkRule(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    spawnSync(rtkCmd, ['init', '-g', '--agent', 'cursor', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true
    });
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  if (!fileExists(CURSOR_RTK_RULE_SRC)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  ensureDir(CURSOR_RULES_GLOBAL);
  const dest = path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc');
  try {
    fs.copyFileSync(CURSOR_RTK_RULE_SRC, dest);
    if (!silent) process.stderr.write(`  ✓ Deployed RTK rule to ${dest}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function isCursorInstalled() {
  return (
    isCommandAvailable('cursor') ||
    isCommandAvailable('agent') ||
    fileExistsCached(CURSOR_DIR) ||
    fileExistsCached(CURSOR_MCP_GLOBAL) ||
    fileExistsCached(CURSOR_MCP_LEGACY)
  );
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
    return `---\ndescription: Konoha multi-agent orchestration\nalwaysApply: true\n---\n\n` + managed;
  }
  const roster = (agents || []).map(a => {
    const skillList = (a.skills && a.skills.length > 0) ? ` [Skills: ${a.skills[0]}]` : '';
    let purpose = (a.purpose || a.title || 'Specialized agent').split('.')[0].trim();
    if (purpose.length > 50) purpose = purpose.slice(0, 47) + '...';
    return `- **@${a.name}**: ${purpose}.${skillList}`;
  }).join('\n');

  const contractText = buildLightweightContract({ client: 'cursor' });

  const body = `---
description: Konoha multi-agent orchestration
alwaysApply: true
---

# Konoha — Cursor Agent Configuration

## Team Roster & Delegation
Delegate non-trivial tasks via structured MCP tool arguments:
${roster}

## Safety Guardrails
NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset --hard\`) or view secrets (\`.env*\`, \`secrets.yaml\`).\n\n`;

  return buildManagedContract(body, contractText);
}



function buildMcpServers(pythonCmd, serverPath, uvxCmd) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Only register semble when uvx is actually usable
  const uvxAvailable = (() => {
    try {
      const res = spawnSync(uvxCmd, ['--version'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32', windowsHide: true });
      return res.status === 0;
    } catch { return false; }
  })();
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
    aislop: (() => {
      const isWin = process.platform === 'win32';
      let cmd = npxCmd;
      let args = ['-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
      try {
        const whichCmd = isWin ? 'where' : 'which';
        const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', shell: isWin, timeout: 3000, windowsHide: true });
        if (whichRes.status === 0 && whichRes.stdout.trim()) {
          const binPath = whichRes.stdout.trim().split('\n')[0].trim();
          if (binPath && fileExists(binPath)) {
            cmd = binPath;
            args = [];
          }
        }
      } catch { /* intentional best-effort fallback */ }
      return {
        type: 'stdio',
        command: cmd,
        args,
        autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
        auto_approve: true
      };
    })()
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

function registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!serverPath || !fileExists(serverPath)) {
    return false;
  }

  const { parseYaml } = require('../bin/lib/yaml_utils');
  ensureDir(CURSOR_DIR);

  const backupPath = CURSOR_MCP_GLOBAL + '.back';
  if (fileExists(CURSOR_MCP_GLOBAL) && !fileExists(backupPath)) {
    fs.copyFileSync(CURSOR_MCP_GLOBAL, backupPath);
    if (!silent) process.stderr.write(`  \u2713 Backed up ${path.basename(CURSOR_MCP_GLOBAL)} \u2192 ${path.basename(backupPath)}\n`);
  }

  let config = { mcpServers: {} };
  if (fileExists(CURSOR_MCP_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid JSON in ${CURSOR_MCP_GLOBAL}; leaving it unchanged.`);
      return false;
    }
  } else if (fileExists(CURSOR_MCP_LEGACY)) {
    try {
      config = parseYaml(fs.readFileSync(CURSOR_MCP_LEGACY, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid legacy YAML in ${CURSOR_MCP_LEGACY}; leaving it unchanged.`);
      return false;
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  const servers = buildMcpServers(pythonCmd, serverPath, uvxCmd || 'uvx');
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(CURSOR_MCP_GLOBAL, JSON.stringify(config, null, 2) + '\n');
  if (!silent) process.stderr.write(`\u2713 Merged Konoha MCP servers into ${CURSOR_MCP_GLOBAL}\n`);
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

function registerCursorCliPermissions(silent = true) {
  const konohaGrants = (deployUtils.KONOHA_CANONICAL_TOOLS || []).map(t => `Mcp(konoha, ${t})`);
  const grants = [
    'Mcp(konoha)',
    ...konohaGrants,
    'Mcp(semble)',
    'Mcp(semble, search)',
    'Mcp(semble, find_related)',
    'Mcp(aislop)',
    'Mcp(aislop, aislop_scan)',
    'Mcp(aislop, aislop_fix)',
    'Mcp(aislop, aislop_why)',
    'Mcp(aislop, aislop_baseline)',
    'Shell(rtk)',
    'Shell(konoha)'
  ];

  ensureDir(CURSOR_DIR);

  let config = {};
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8')) || {};
    } catch {
      config = {};
    }
  }

  if (!config.permissions) config.permissions = {};
  const allowRaw = config.permissions.allow;
  config.permissions.allow = (Array.isArray(allowRaw) ? allowRaw : [])
    .filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));

  let updated = false;
  for (const grant of grants) {
    if (!config.permissions.allow.includes(grant)) {
      config.permissions.allow.push(grant);
      updated = true;
    }
  }

  const allKonohaAutoApprove = (deployUtils.KONOHA_CANONICAL_TOOLS || []).map(t => `konoha:${t}`);
  config.autoApprove = [
    'rtk', 'konoha',
    ...allKonohaAutoApprove,
    'semble:search', 'semble:find_related',
    'aislop:aislop_scan', 'aislop:aislop_fix', 'aislop:aislop_why', 'aislop:aislop_baseline'
  ];
  updated = true;

  try {
    fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
    if (updated && !silent) {
      process.stderr.write(`✓ Cursor CLI permissions updated: ${CURSOR_CLI_CONFIG}\n`);
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Only update Cursor settings.json if Cursor is installed or the directory/file exists.
  // Never modify VS Code ('Code') settings paths.
  const cursorSettingsPaths = [
    fileExists(CURSOR_DIR) ? path.join(CURSOR_DIR, 'settings.json') : null,
    process.platform !== 'win32' ? path.join(HOME, '.config', 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json') : null
  ].filter(p => p && (fileExists(p) || fileExists(path.dirname(p))));

  for (const sPath of cursorSettingsPaths) {
    try {
      let sObj = {};
      if (fileExists(sPath)) {
        try { sObj = JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {}; } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
      const konohaToolsPrefixed = (deployUtils.KONOHA_CANONICAL_TOOLS || []).map(t => 'konoha/' + t);
      sObj['cursor.mcp.autoApprove'] = [
        ...konohaToolsPrefixed,
        'semble/search', 'semble/find_related',
        'aislop/aislop_scan', 'aislop/aislop_fix', 'aislop/aislop_why', 'aislop/aislop_baseline'
      ];
      sObj['cursor.terminal.autoApprove'] = ['rtk', 'konoha'];
      if (!sObj.permissions || typeof sObj.permissions !== 'object') sObj.permissions = {};
      // Merge Konoha grants into the user's existing allow list — never replace it
      if (!Array.isArray(sObj.permissions.allow)) sObj.permissions.allow = [];
      sObj.permissions.allow = sObj.permissions.allow.filter(g => g !== '*' && g !== 'Shell(rtk *)' && g !== 'Shell(konoha *)' && !g.includes('(*)'));
      for (const grant of grants) {
        if (!sObj.permissions.allow.includes(grant)) sObj.permissions.allow.push(grant);
      }
      fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  return true;
}

function registerCursorHooks(silent = true, allowHooks = false) {
  if (!allowHooks) {
    if (!fileExists(CURSOR_HOOKS_GLOBAL)) return false;
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (config.hooks && config.hooks.sessionStart) {
        config.hooks.sessionStart = config.hooks.sessionStart.filter(
          h => !(h.command && h.command.includes('cursor_bootstrap.js'))
        );
        if (config.hooks.sessionStart.length === 0) {
          delete config.hooks.sessionStart;
        }
        fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    return false;
  }

  ensureDir(CURSOR_DIR);
  let config = { version: 1, hooks: {} };

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (!config.hooks) config.hooks = {};
      if (!config.version) config.version = 1;
    } catch {
      // Corrupt file: back it up so the user's other hooks are recoverable
      try {
        fs.copyFileSync(CURSOR_HOOKS_GLOBAL, CURSOR_HOOKS_GLOBAL + '.corrupt-' + Date.now());
        console.warn(`⚠ Existing Cursor hooks.json was invalid JSON — backed up to ${CURSOR_HOOKS_GLOBAL}.corrupt-*`);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      config = { version: 1, hooks: {} };
    }
  }

  // Absolute node path: GUI-launched Cursor may not inherit a shell PATH
  const bootstrapCmd = `"${process.execPath}" "${CURSOR_BOOTSTRAP_PATH}"`;
  const existing = config.hooks.sessionStart || [];
  const hasBootstrap = existing.some(h => h.command && h.command.includes('cursor_bootstrap.js'));

  if (!hasBootstrap) {
    config.hooks.sessionStart = [
      ...existing,
      { command: bootstrapCmd }
    ];
    fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      process.stderr.write(`✓ Registered Cursor sessionStart hook: ${CURSOR_HOOKS_GLOBAL}\n`);
    }
  }
  return true;
}

function deployCursorGlobalRule(agents, silent = true) {
  if (!agents || agents.length === 0) return false;
  try {
    ensureDir(CURSOR_RULES_GLOBAL);
    const rulePath = path.join(CURSOR_RULES_GLOBAL, 'konoha.mdc');
    const content = generateCursorRule(agents);
    if (!fileExists(rulePath) || fs.readFileSync(rulePath, 'utf8') !== content) {
      fs.writeFileSync(rulePath, content, 'utf8');
    }
    if (!silent) process.stderr.write(`✓ Deployed global Cursor rule: ${rulePath}\n`);
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

function copyCursorHelperScripts(_ = true) {
  const scripts = ['cursor_bootstrap.js'];
  ensureDir(SKILLS_DB_DIR);
  let copied = 0;

  for (const script of scripts) {
    const src = path.join(SRC_DIR, script);
    const dest = path.join(SKILLS_DB_DIR, script);
    if (fileExists(src)) {
      try {
        const srcContent = fs.readFileSync(src);
        if (!fileExists(dest) || !srcContent.equals(fs.readFileSync(dest))) {
          fs.writeFileSync(dest, srcContent);
          copied++;
        }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return copied > 0;
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
    allowHooks = false,
    ruleContent = null
  } = options;

  copyCursorHelperScripts(silent);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent);
  registerCursorCliPermissions(silent);
  registerCursorHooks(silent, allowHooks);
  deployCursorRtkRule(silent);
  if (agents.length > 0) deployCursorGlobalRule(agents, silent);

  if (deployProject) {
    const root = projectRoot || process.cwd();
    try {
      registerCursorProjectMcp(root, pythonCmd, serverPath, uvxCmd, silent);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  deployUtils.syncCursorSkillsFromAgents({ projectRoot, deployProject, silent });

  if (agents.length > 0) {
    if (deployProject) {
      const root = projectRoot || process.cwd();
      try {
        deployProjectCursor(root, agents, silent, ruleContent);
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  return { ok: true };
}

function removeCursorConfig(silent = true, options = {}) {
  const home = options.home || process.env.HOME || HOME;
  const cursorMcp = options.configPath || (home === HOME ? CURSOR_MCP_GLOBAL : path.join(home, '.cursor', 'mcp.json'));
  // Remove only Konoha-managed MCP entries
  if (fileExists(cursorMcp)) {
    try {
      const config = JSON.parse(fs.readFileSync(cursorMcp, 'utf-8'));
      let updated = false;
      if (config.mcpServers) {
        for (const name of ['konoha', 'semble', 'aislop', 'skills-db']) {
          if (config.mcpServers[name]) {
            delete config.mcpServers[name];
            updated = true;
          }
        }
      }
      if (updated) {
        fs.writeFileSync(cursorMcp, JSON.stringify(config, null, 2) + '\n');
        if (!silent) process.stderr.write('✓ Removed Konoha MCP servers from ~/.cursor/mcp.json\n');
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove accidental konoha-bridge extension if present in Cursor extensions
  const cursorExtDir = options.extensionsDir || path.join(home, '.cursor', 'extensions');
  if (fileExists(cursorExtDir)) {
    try {
      for (const entry of fs.readdirSync(cursorExtDir)) {
        if (entry.toLowerCase().startsWith('andycungkrinx91.konoha-bridge')) {
          fs.rmSync(path.join(cursorExtDir, entry), { recursive: true, force: true });
          if (!silent) process.stderr.write('✓ Removed konoha-bridge extension from ~/.cursor/extensions\n');
        }
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove global subagents
  const agentsGlobal = path.join(home, '.cursor', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  for (const name of official) {
    const p = path.join(agentsGlobal, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  // Remove Cursor CLI permissions
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
      if (allowArr.length > 0) {
        const grants = [
          'Mcp(semble)',
          'Mcp(semble, search)',
          'Mcp(semble, find_related)',
          'Mcp(konoha)',
          'Mcp(konoha, find_skill)',
          'Mcp(konoha, get_skill)',
          'Mcp(konoha, list_skills)',
          'Mcp(konoha, optimize_report)',
          'Mcp(konoha, read_file_head)',
          'Mcp(konoha, read_file_range)',
          'Mcp(konoha, file_info)',
          'Mcp(konoha, token_efficient_grep)',
          'Mcp(konoha, get_file_structure)',
          'Mcp(konoha, find_files_clean)',
          'Mcp(konoha-files)',
          'Mcp(konoha-files, read_file_head)',
          'Mcp(konoha-files, read_file_range)',
          'Mcp(konoha-files, file_info)',
          'Mcp(konoha-files, token_efficient_grep)',
          'Mcp(konoha-files, get_file_structure)',
          'Mcp(konoha-files, find_files_clean)',
          'Shell(konoha)',
          'Shell(node bin/cli.js)',
          'Shell(node */.konoha/cursor_bootstrap.js)'
        ];
        const initialLength = allowArr.length;
        const filtered = allowArr.filter(p => !grants.includes(p));
        if (filtered.length !== initialLength) {
          config.permissions.allow = filtered;
          fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
          if (!silent) process.stderr.write('✓ Removed Konoha permissions from ~/.cursor/cli-config.json\n');
        }
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove sessionStart bootstrap hook
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
      status.mcpSkillsDb = !!(config.mcpServers && config.mcpServers['konoha']);
      status.mcpSemble = !!(config.mcpServers && config.mcpServers['semble']);
      status.mcpKonoha = !!(config.mcpServers && config.mcpServers['konoha']);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_AGENTS_GLOBAL)) {
    try {
      status.subagentsGlobal = fs.readdirSync(CURSOR_AGENTS_GLOBAL).filter(f => f.endsWith('.md')).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(AGENTS_SKILLS)) {
    try {
      status.skillsGlobal = deployUtils.listSkillEntries(AGENTS_SKILLS).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allows = (config.permissions && Array.isArray(config.permissions.allow)) ? config.permissions.allow : [];
      status.cliPermissions = allows.some(a => a.includes('konoha')) && allows.some(a => a.includes('semble'));
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      const hooks = (config.hooks && config.hooks.sessionStart) || [];
      status.hooks = hooks.some(h => h.command && h.command.includes('cursor_bootstrap.js'));
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const cwd = process.cwd();
  const projectMcp = path.join(cwd, PROJECT_CURSOR_DIR, 'mcp.json');
  const projectRule = path.join(cwd, PROJECT_CURSOR_DIR, 'rules', 'konoha.mdc');
  const projectAgents = path.join(cwd, PROJECT_CURSOR_DIR, 'agents');

  status.projectMcp = fileExists(projectMcp);
  status.projectRule = fileExists(projectRule);
  if (fileExists(projectAgents)) {
    try {
      status.projectAgents = fs.readdirSync(projectAgents).filter(f => f.endsWith('.md')).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  // No-op: filesystem mirroring is disabled. Skills are loaded from SQLite DB at runtime.
  status.skillsProject = 0;

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
