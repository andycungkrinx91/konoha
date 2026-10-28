'use strict';

const fs = require('fs');
const path = require('path');
const deployUtils = require('../deploy_utils');
const {
  fileExists,
  ensureDir,
  isRtkInstalled
} = require('../platform_utils');
const {
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicyCompact
} = require('../search_policy');
const { buildSubagentContract } = require('../agent_contract');
const {
  SERVER_PATH,
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  HOME,
  isClaudeCodeInstalled,
  validateAgentName,
  resolveRtkRuleTemplate,
  initRtkHook,
  resolveAislopMcpConfig,
  buildStdioMcpServers,
  mergeJsonFile,
  mergeMcpServersBlock,
  backupFile,
  buildClientToolGrants,
  buildBareToolGrants,
  readMcpHealth,
  removeKonohaFromMcpBlock
} = require('./common');

const {
  registerClaudeCodeNativeBlocker,
  buildClaudeCodeBashGuardSource,
  registerClaudeCodeBashGuard,
  registerClaudeCodeWorkflowReminder
} = require('./claude_code_hooks');

function deployClaudeCodeRtkRule(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  const dest = path.join(home, '.claude', 'rules', 'rtk.md');
  const src = resolveRtkRuleTemplate();
  if (!src || src === dest) {
    return { ok: true };
  }
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (!isSilent) process.stderr.write(`  ✓ Deployed RTK rule to ${dest}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  const targetConfig = options.configPath || (options.home ? path.join(options.home, '.claude.json') : CLAUDE_JSON);
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd, client: 'claudecode' });

  backupFile(targetConfig, silent);

  let existingConfig = {};
  if (fileExists(targetConfig)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(targetConfig, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid JSON in ${targetConfig}; leaving it unchanged.`);
      return false;
    }
  }

  if (!existingConfig.mcpServers || typeof existingConfig.mcpServers !== 'object' || Array.isArray(existingConfig.mcpServers)) {
    existingConfig.mcpServers = {};
  }
  mergeMcpServersBlock(existingConfig.mcpServers, servers);
  ensureDir(path.dirname(targetConfig));
  const tempFile = targetConfig + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(existingConfig, null, 2) + '\n');
  fs.renameSync(tempFile, targetConfig);
  if (!silent) process.stderr.write(`  ✓ ${path.basename(targetConfig)} merged with Konoha MCP servers\n`);
  return true;
}

function _cleanInvalidRules(allowList, invalidRules) {
  const invalidSet = new Set(invalidRules);
  const beforeLen = allowList.length;
  const filtered = allowList.filter(item => !invalidSet.has(item));
  if (filtered.length !== beforeLen) {
    allowList.length = 0;
    allowList.push(...filtered);
    return true;
  }
  return false;
}

function _appendMissing(list, items) {
  let updated = false;
  for (const item of items) {
    if (!list.includes(item)) {
      list.push(item);
      updated = true;
    }
  }
  return updated;
}

function _ensureAislopMcpServer(config) {
  if (!config.mcpServers || typeof config.mcpServers !== 'object') return false;
  if (!config.mcpServers.aislop) {
    config.mcpServers.aislop = resolveAislopMcpConfig();
    return true;
  }
  return false;
}

function registerClaudeCodePermissions(silent = true) {
  const grants = [
    ...buildClientToolGrants('mcp__'),
    'Bash(rtk)',
    'Bash(konoha)'
  ];

  return mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.permissions) config.permissions = {};
      const allowRaw = config.permissions.allow;
      config.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

      const invalidRules = [
        'mcp:konoha:*',
        'mcp:semble:*',
        'rtk',
        'rtk *',
        'rtk*',
        'command(rtk *)',
        'command(rtk)',
        'command(*)',
        'mcp(*)',
        'Bash(*)',
        'Bash(rtk *)',
        'Bash(rtk:*)',
        'Bash(konoha *)',
        '*'
      ];
      let updated = _cleanInvalidRules(config.permissions.allow, invalidRules);
      if (_appendMissing(config.permissions.allow, grants)) updated = true;

      const autoApproveGrants = [
        ...buildClientToolGrants('mcp__'),
        ...buildClientToolGrants(''),
        ...buildBareToolGrants(),
        'Bash(rtk)',
        'Bash(rtk:*)',
        'Bash(rtk *)',
        'Bash(konoha)',
        'Bash(konoha *)',
        'rtk',
        'rtk *',
        'konoha',
        'konoha *'
      ];
      if (!config.autoApprove || !Array.isArray(config.autoApprove)) {
        config.autoApprove = autoApproveGrants;
        updated = true;
      } else if (_appendMissing(config.autoApprove, autoApproveGrants)) {
        updated = true;
      }

      const defaultAllowedTools = [
        ...buildClientToolGrants('mcp__'),
        'Bash'
      ];
      if (!config.allowedTools || !Array.isArray(config.allowedTools)) {
        config.allowedTools = defaultAllowedTools;
        updated = true;
      }

      if (_ensureAislopMcpServer(config)) updated = true;

      return updated;
    },
    silent
  );
}

function adaptInstructionsForClaudeCode(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file/g, 'Write')
    .replace(/replace_file_content/g, 'Edit')
    .replace(/run_command/g, 'Bash')
    .replace(/(?:skills-db|konoha)\.find_skill/g, 'mcp__konoha__find_skill')
    .replace(/(?:skills-db|konoha)\.get_skill/g, 'mcp__konoha__get_skill')
    .replace(/(?:skills-db|konoha)\.list_skills/g, 'mcp__konoha__list_skills')
    .replace(/(?:skills-db|konoha)\.optimize_report/g, 'mcp__konoha__optimize_report')
    .replace(/(?:skills-db|konoha)\.build_from_source/g, 'mcp__konoha__build_from_source')
    .replace(/(?:skills-db|konoha)\.build_from_text/g, 'mcp__konoha__build_from_text')
    .replace(/(?:skills-db|konoha)\.get_resolved_task_dir/g, 'mcp__konoha__get_resolved_task_dir')
    .replace(/(?:skills-db|konoha)\.migrate_skills/g, 'mcp__konoha__migrate_skills')
    .replace(/(?:skills-db|konoha)\.web_search/g, 'mcp__konoha__web_search')
    .replace(/(?:skills-db|konoha)\.sannin/g, 'mcp__konoha__sannin')
    .replace(/(?:skills-db|konoha)\.kage/g, 'mcp__konoha__kage')
    .replace(/(?:skills-db|konoha)\.jonin/g, 'mcp__konoha__jonin')
    .replace(/(?:skills-db|konoha)\.anbu/g, 'mcp__konoha__anbu')
    .replace(/(?:skills-db|konoha)\.chunin/g, 'mcp__konoha__chunin')
    .replace(/(?:skills-db|konoha)\.tokubetsu_jonin/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?:skills-db|konoha)\.genin/g, 'mcp__konoha__genin')
    .replace(/semble\.search/g, 'mcp__semble__search')
    .replace(/semble\.find_related/g, 'mcp__semble__find_related')
    .replace(/(?<!mcp__konoha__)\boptimize_report\b/g, 'mcp__konoha__optimize_report')
    .replace(/(?<!mcp__konoha__)\bkage\b(?!-)/g, 'mcp__konoha__kage')
    .replace(/(?<!mcp__konoha__)\bjonin\b(?!-)/g, 'mcp__konoha__jonin')
    .replace(/(?<!mcp__konoha__)\banbu\b(?!-)/g, 'mcp__konoha__anbu')
    .replace(/(?<!mcp__konoha__)\bchunin\b(?!-)/g, 'mcp__konoha__chunin')
    .replace(/(?<!mcp__konoha__)\bgenin\b(?!-)/g, 'mcp__konoha__genin')
    .replace(/(?<!mcp__konoha__)\btokubetsu_jonin\b(?!-)/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?<!mcp__konoha__)\bsannin\b(?!-)/g, 'mcp__konoha__sannin')
    .replace(/(?<!mcp__konoha__)\bfind_skill\b/g, 'mcp__konoha__find_skill')
    .replace(/(?<!mcp__konoha__)\bget_skill\b/g, 'mcp__konoha__get_skill')
    .replace(/(?<!mcp__konoha__)\blist_skills\b/g, 'mcp__konoha__list_skills')
    .replace(/(?<!mcp__konoha__)\bread_file_head\b/g, 'mcp__konoha__read_file_head')
    .replace(/(?<!mcp__konoha__)\bread_file_range\b/g, 'mcp__konoha__read_file_range')
    .replace(/(?<!mcp__konoha__)\bfile_info\b/g, 'mcp__konoha__file_info')
    .replace(/(?<!mcp__konoha__)\btoken_efficient_grep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bget_file_structure\b/g, 'mcp__konoha__get_file_structure')
    .replace(/(?<!mcp__konoha__)\bfind_files_clean\b/g, 'mcp__konoha__find_files_clean')
    .trim();
}

function generateClaudeCodeSubagent(agent) {
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Black Ops for backend dev, bug fixing, DevOps, and infrastructure deployment',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports'
  };
  const rawDesc = DEFAULT_ROLE_DESCRIPTIONS[agent.name] || agent.description || agent.purpose || agent.role || `${agent.name} ninja agent`;
  const description = `${rawDesc}. Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;

  let instructions = agent.instructions || '';
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
  instructions = instructions.replace(/If delegate\.md specifies exact reference names,\s*load\s+them\s+via\s+the\s+skills-db\.get_skill\s+tool\.?/gi, '');
  instructions = instructions.replace(/Follow\s+full\s+protocol\s+in\s+~\/\.agents\/AGENTS\.md\.?/gi, '');
  instructions = instructions.trim();
  if (instructions && !instructions.endsWith('.')) {
    instructions += '.';
  }

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

  instructions = `${instructions}\n\n${buildSubagentContract('claude')}`;
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();
  const body = adaptInstructionsForClaudeCode(`${instructions}\n\n${sembleLine}\n${fileToolsLine}\n`);

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    'allowed-tools:',
    '  - Write',
    '  - Edit',
    '  - Bash',
    '  - TodoRead',
    '  - TodoWrite',
    '  - WebSearch',
    '  - mcp__semble__*',
    '  - mcp__konoha__*',
    '---',
    ''
  ];

  return frontmatter.join('\n') + body;
}

function deployClaudeCodeRules(ruleContent, silent = true) {
  if (!ruleContent) return false;
  const CLAUDE_MD = path.join(HOME, '.claude', 'CLAUDE.md');
  ensureDir(path.dirname(CLAUDE_MD));

  const startMarker = '\n<!-- KONOHA-START -->\n';
  const endMarker = '\n<!-- KONOHA-END -->\n';
  const wrapper = startMarker + ruleContent + endMarker;

  let existing = '';
  if (fileExists(CLAUDE_MD)) {
    try {
      existing = fs.readFileSync(CLAUDE_MD, 'utf-8');
    } catch { /* ignore */ }
  }

  const cleanContent = existing.replace(/\n?<!-- KONOHA-START -->[\s\S]*?<!-- KONOHA-END -->\n?/g, '\n');
  const finalContent = cleanContent.trim() + '\n' + wrapper;

  try {
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      process.stderr.write(`✓ Deployed Konoha instructions to ${CLAUDE_MD}\n`);
    }
    return true;
  } catch {
    return false;
  }
}

function deployProjectClaudeMd(projectRoot, _agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  if (!ruleContent) return false;

  const CLAUDE_MD = path.join(projectRoot, 'CLAUDE.md');
  ensureDir(path.dirname(CLAUDE_MD));

  const startMarker = '\n<!-- KONOHA-START -->\n';
  const endMarker = '\n<!-- KONOHA-END -->\n';
  const wrapper = startMarker + ruleContent + endMarker;

  let existing = '';
  if (fileExists(CLAUDE_MD)) {
    try {
      existing = fs.readFileSync(CLAUDE_MD, 'utf-8');
    } catch { /* ignore */ }
  }

  const cleanContent = existing.replace(/\n?<!-- KONOHA-START -->[\s\S]*?<!-- KONOHA-END -->\n?/g, '\n');
  const finalContent = cleanContent.trim() + '\n' + wrapper;

  const hadExistingBlock = /<!-- KONOHA-START -->/.test(existing);
  if (!hadExistingBlock && fileExists(CLAUDE_MD)) {
    try {
      const currentFile = fs.readFileSync(CLAUDE_MD, 'utf-8');
      if (currentFile === finalContent) {
        return false;
      }
    } catch { /* ignore */ }
  }

  try {
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      process.stderr.write(`✓ Deployed Konoha instructions to ${CLAUDE_MD}\n`);
    }
    return true;
  } catch {
    return false;
  }
}

function removeProjectClaudeMd(projectRoot, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  const CLAUDE_MD = path.join(projectRoot, 'CLAUDE.md');
  if (!fileExists(CLAUDE_MD)) return false;

  try {
    const content = fs.readFileSync(CLAUDE_MD, 'utf-8');
    if (/<!-- KONOHA-START -->/.test(content)) {
      const cleanContent = content.replace(/\n?<!-- KONOHA-START -->[\s\S]*?<!-- KONOHA-END -->\n?/g, '\n');
      fs.writeFileSync(CLAUDE_MD, cleanContent.trim() + '\n', 'utf-8');
      if (!silent) {
        process.stderr.write(`✓ Removed Konoha instructions from ${CLAUDE_MD}\n`);
      }
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function _deployClaudeCodeAgents(agents) {
  if (!agents || !agents.length) return;
  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  ensureDir(claudeAgentsDir);
  for (const agent of agents) {
    if (!agent || !agent.name || !validateAgentName(agent.name, claudeAgentsDir) || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
    const mdContent = generateClaudeCodeSubagent(agent);
    const targetPath = path.join(claudeAgentsDir, agent.name + '.md');
    fs.writeFileSync(targetPath, mdContent);
  }
  try {
    const files = fs.readdirSync(claudeAgentsDir);
    for (const file of files) {
      if (file.startsWith('mcp_') && file.endsWith('.md')) {
        fs.unlinkSync(path.join(claudeAgentsDir, file));
      }
    }
  } catch (_) { /* ignore */ }
}

function ensureClaudeCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    ruleContent = null,
    silent = true,
    agents = [],
    projectRoot = null,
    deployProject = false,
    force = false,
    skipDetection = false
  } = options;

  if (!force && !skipDetection && !isClaudeCodeInstalled()) {
    return { ok: false, reason: 'claude CLI not detected' };
  }

  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent, options);
  registerClaudeCodePermissions(silent);
  registerClaudeCodeNativeBlocker();
  registerClaudeCodeBashGuard(silent);
  registerClaudeCodeWorkflowReminder(silent);
  deployClaudeCodeRtkRule(silent);
  initRtkHook(silent);

  if (ruleContent) {
    deployClaudeCodeRules(ruleContent, silent);
  }

  _deployClaudeCodeAgents(agents);

  if (deployProject && projectRoot) {
    try {
      deployProjectClaudeMd(projectRoot, agents, silent, ruleContent);
    } catch { /* ignore */ }
  }

  return { ok: true };
}

function getClaudeCodeStatus() {
  const status = {
    installed: isClaudeCodeInstalled(),
    globalConfig: fileExists(CLAUDE_JSON),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    permissionsAllowed: false,
    agentsCount: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(HOME, '.claude', 'rules', 'rtk.md'))
  };

  if (status.globalConfig) {
    try {
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      } catch (_) {
        const { parseYaml } = require('../agent_manager');
        config = parseYaml(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      }
      const health = readMcpHealth(config, 'mcpServers');
      status.mcpKonoha = health.konoha;
      status.mcpSemble = health.semble;
      status.mcpAislop = health.aislop;
      status.mcpSkillsDb = health.skillsDb;
    } catch { /* ignore */ }
  }

  if (fileExists(CLAUDE_SETTINGS)) {
    try {
      let settings = {};
      try {
        settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      } catch (_) {
        const { parseYaml } = require('../agent_manager');
        settings = parseYaml(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      }
      const allowRaw = settings?.permissions?.allow;
      const allowed = Array.isArray(allowRaw) ? allowRaw : [];
      const hasKonoha = allowed.includes('mcp__konoha__*') || allowed.some(a => typeof a === 'string' && a.startsWith('mcp__konoha__'));
      const hasSemble = allowed.includes('mcp__semble__*') || allowed.some(a => typeof a === 'string' && a.startsWith('mcp__semble__'));
      const hasAislop = allowed.includes('mcp__aislop__*') || allowed.some(a => typeof a === 'string' && a.startsWith('mcp__aislop__'));
      status.permissionsAllowed = hasKonoha && hasSemble && hasAislop;
    } catch { /* ignore */ }
  }

  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];
  for (const name of official) {
    if (fileExists(path.join(claudeAgentsDir, `${name}.md`))) {
      status.agentsCount++;
    }
  }

  return status;
}

function _filterClaudePermissions(config) {
  const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
  if (!allowArr.length) return false;
  const initialLength = allowArr.length;
  const filtered = allowArr.filter(
    (p) => p !== 'mcp__skills-db__*' && p !== 'mcp__konoha-files__*' && p !== 'mcp__konoha__*' && p !== 'mcp__semble__*' && p !== 'mcp__aislop__*'
  );
  config.permissions.allow = filtered;
  return filtered.length !== initialLength;
}

function _cleanClaudeSettingsPermissions(silent) {
  if (!fileExists(CLAUDE_SETTINGS)) return;
  try {
    mergeJsonFile(CLAUDE_SETTINGS, _filterClaudePermissions, silent);
  } catch { /* ignore */ }
}

function _removeClaudeInstructions(silent) {
  const CLAUDE_MD = path.join(HOME, '.claude', 'CLAUDE.md');
  if (!fileExists(CLAUDE_MD)) return;
  try {
    const content = fs.readFileSync(CLAUDE_MD, 'utf-8');
    const startMarker = '\n<!-- KONOHA-START -->\n';
    const endMarker = '\n<!-- KONOHA-END -->\n';
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1) {
      const cleanContent = content.slice(0, startIndex) + content.slice(endIndex + endMarker.length);
      fs.writeFileSync(CLAUDE_MD, cleanContent.trim() + '\n', 'utf-8');
      if (!silent) process.stderr.write(`✓ Removed Konoha instructions from ${CLAUDE_MD}\n`);
    }
  } catch { /* ignore */ }
}

function _restoreClaudeAgents(silent) {
  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const backupDir = path.join(HOME, '.claude', 'agents_backup');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];
  for (const name of official) {
    const p = path.join(claudeAgentsDir, `${name}.md`);
    if (fileExists(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }

  if (!fileExists(backupDir)) return;
  try {
    const files = fs.readdirSync(backupDir);
    files.forEach((file) => {
      if (file.endsWith('.md')) {
        const srcPath = path.join(backupDir, file);
        const destPath = path.join(claudeAgentsDir, file);
        fs.copyFileSync(srcPath, destPath);
        fs.unlinkSync(srcPath);
        if (!silent) process.stderr.write(`✓ Restored original agent: ${file}\n`);
      }
    });
    fs.rmdirSync(backupDir);
  } catch { /* ignore */ }
}

function removeClaudeCodeConfig(silent = true, options = {}) {
  const { projectRoot = null, removeProject = false } = options;

  if (fileExists(CLAUDE_JSON)) {
    try {
      mergeJsonFile(
        CLAUDE_JSON,
        (config) => removeKonohaFromMcpBlock(config.mcpServers),
        silent
      );
    } catch { /* ignore */ }
  }

  _cleanClaudeSettingsPermissions(silent);

  if (removeProject && projectRoot) {
    try {
      removeProjectClaudeMd(projectRoot, silent);
    } catch { /* ignore */ }
  }

  _removeClaudeInstructions(silent);
  _restoreClaudeAgents(silent);

  return true;
}

module.exports = {
  deployClaudeCodeRtkRule,
  registerClaudeCodeGlobalMcp,
  registerClaudeCodePermissions,
  adaptInstructionsForClaudeCode,
  generateClaudeCodeSubagent,
  registerClaudeCodeNativeBlocker,
  buildClaudeCodeBashGuardSource,
  registerClaudeCodeBashGuard,
  registerClaudeCodeWorkflowReminder,
  deployClaudeCodeRules,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  ensureClaudeCodeSetup,
  getClaudeCodeStatus,
  removeClaudeCodeConfig
};
