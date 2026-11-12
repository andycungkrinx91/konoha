'use strict';

const { getCanonicalAgentNames } = require('../canonical_agents');

const fs = require('fs');
const path = require('path');
const deployUtils = require('../deploy_utils');
const {
  fileExists,
  ensureDir,
  isRtkInstalled
} = require('../platform_utils');
const {
  buildCodeSearchPolicyCompact,
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
  buildSubagentToolGrants,
  assertNoWildcardGrants,
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
  // The rule template is static, so it deploys with or without `rtk` on PATH;
  // `rtk init` only enriches it and stays best-effort.
  const dest = path.join(home, '.claude', 'rules', 'rtk.md');
  const src = resolveRtkRuleTemplate();
  if (!src || src === dest) {
    return { ok: true };
  }
  try {
    ensureDir(path.dirname(dest));
    if (fileExists(dest)) {
      backupFile(dest, isSilent, { client: 'claude', scope: 'global', ...opts });
    }
    fs.copyFileSync(src, dest);
    if (!isSilent) process.stderr.write(`  ✓ Deployed RTK rule to ${dest}\n`);
    return { ok: true };
  } catch (e) {
    if (e && /backup/i.test(e.message)) throw e;
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function registerClaudeCodeGlobalMcp(pythonCmd, serverPath, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  const targetConfig = options.configPath || (options.home ? path.join(options.home, '.claude.json') : CLAUDE_JSON);
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ client: 'claudecode' });

  backupFile(targetConfig, silent, { client: 'claude', ...options });

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

function _applyClaudePermissionGrants(config, grants) {
  if (!config.permissions) config.permissions = {};
  const allowRaw = config.permissions.allow;
  config.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

  const invalidRules = [
    'mcp:konoha:*',
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
}

function registerClaudeCodePermissions(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const primarySettings = (opts && opts.settingsPath) ||
    (opts && opts.home ? path.join(opts.home, '.claude', 'settings.json') : CLAUDE_SETTINGS);
  const settingsTargets = [primarySettings];
  if (!opts.settingsPath && CLAUDE_SETTINGS && CLAUDE_SETTINGS !== primarySettings) {
    settingsTargets.push(CLAUDE_SETTINGS);
  }
  const grants = [
    ...buildClientToolGrants('mcp__'),
    'Bash(rtk)',
    'Bash(konoha)'
  ];

  let result = false;
  for (const targetSettings of settingsTargets) {
    result = mergeJsonFile(
      targetSettings,
      (config) => _applyClaudePermissionGrants(config, grants),
      isSilent,
      { client: 'claude', ...opts }
    );
  }
  return result;
}

function registerClaudeCodeProjectMcp(projectRoot, pythonCmd, serverPath, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  const targetMcp = path.join(projectRoot, '.mcp.json');
  return registerClaudeCodeGlobalMcp(pythonCmd, serverPath, silent, { configPath: targetMcp });
}

function _hasExistingClaudeProjectConfig(projectRoot) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  return (
    fileExists(path.join(projectRoot, '.mcp.json')) ||
    fileExists(path.join(projectRoot, '.claude', 'settings.json')) ||
    fileExists(path.join(projectRoot, 'CLAUDE.md'))
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
    .replace(/(?:skills-db|konoha)\.akatsuki/g, 'mcp__konoha__akatsuki')
    .replace(/(?<!mcp__konoha__)\boptimize_report\b/g, 'mcp__konoha__optimize_report')
    .replace(/(?<!mcp__konoha__)\bkage\b(?!-)/g, 'mcp__konoha__kage')
    .replace(/(?<!mcp__konoha__)\bjonin\b(?!-)/g, 'mcp__konoha__jonin')
    .replace(/(?<!mcp__konoha__)\banbu\b(?!-)/g, 'mcp__konoha__anbu')
    .replace(/(?<!mcp__konoha__)\bchunin\b(?!-)/g, 'mcp__konoha__chunin')
    .replace(/(?<!mcp__konoha__)\bgenin\b(?!-)/g, 'mcp__konoha__genin')
    .replace(/(?<!mcp__konoha__)\bakatsuki\b(?!-)/g, 'mcp__konoha__akatsuki')
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
    // Native Grep/Glob stay allowed for the main agent, so subagents get them
    // too — but the bare words are routed at the bounded Konoha tools so the
    // anti-grep invariant is not weakened.
    .replace(/(?<!mcp__konoha__)\bGrep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bGlob\b/g, 'mcp__konoha__find_files_clean')
    .trim();
}

function generateClaudeCodeSubagent(agent) {
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Backend, DevOps, and bug-fixing specialist for APIs, databases, and infrastructure deployment',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports',
    'akatsuki': 'Red-Team and Blue-Team security specialist for authorized penetration testing, defensive audits, and final security gate',
    'yamanaka': 'Generative 3D and spatial specialist for Three.js/Manifold synthesis, live Blender editing, and PBR asset delivery'
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
    const skillList = agent.skills.map(s => `"${s}"`).join(', ');
    const loadingInstruction = `MANDATORY FIRST ACTION before writing code: Call mcp__konoha__use_skills({ skills: [${skillList}] }) or mcp__konoha__get_skill to load your assigned domain guidelines into context. NEVER skip loading your assigned skills.`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `${loadingInstruction} ` + instructions;
    }
  }

  instructions = `${instructions}\n\n${buildSubagentContract('claude')}`;
  const codeSearchLine = buildCodeSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();
  const body = adaptInstructionsForClaudeCode(`${instructions}\n\n${codeSearchLine}\n${fileToolsLine}\n`);

  const toolGrants = buildSubagentToolGrants('claude');
  assertNoWildcardGrants(toolGrants, `claude code subagent ${agent.name} allowed-tools`);

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    // Ownership marker. `_deployClaudeCodeAgents` refuses to overwrite a file
    // without it and `_cleanMcpAgentFiles` refuses to delete one without it, so
    // a hand-written agent in ~/.claude/agents survives install and uninstall.
    'generated_by: konoha',
    'allowed-tools:',
    ...toolGrants.map(t => `  - ${t}`),
    '---',
    ''
  ];

  return frontmatter.join('\n') + body;
}

function deployClaudeCodeRules(ruleContent, silent = true, options = {}) {
  if (!ruleContent) return false;
  const opts = typeof silent === "object" && silent !== null ? silent : options;
  const CLAUDE_MD = (opts && opts.rulesPath) || (opts && opts.home ? path.join(opts.home, ".claude", "CLAUDE.md") : path.join(HOME, ".claude", "CLAUDE.md"));
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
    if (fileExists(CLAUDE_MD)) {
      backupFile(CLAUDE_MD, silent, { client: 'claude', scope: 'global', ...opts });
    }
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      process.stderr.write(`✓ Deployed Konoha instructions to ${CLAUDE_MD}\n`);
    }
    return true;
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
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
    if (fileExists(CLAUDE_MD)) {
      backupFile(CLAUDE_MD, silent, { client: 'claude', scope: 'project', projectRoot });
    }
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      process.stderr.write(`✓ Deployed Konoha instructions to ${CLAUDE_MD}\n`);
    }
    return true;
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
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

const AGENT_OWNERSHIP_MARKER = 'generated_by: konoha';

/** True when a file's YAML frontmatter carries the Konoha ownership marker. */
function isKonohaOwnedAgentFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return false;
    const end = content.indexOf('\n---', 3);
    const frontmatter = end === -1 ? content : content.slice(0, end);
    return frontmatter.split('\n').some((line) => line.trim() === AGENT_OWNERSHIP_MARKER);
  } catch (_) {
    return false;
  }
}

function _cleanMcpAgentFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.startsWith('mcp_') || !file.endsWith('.md')) continue;
      const full = path.join(dir, file);
      // Only remove what Konoha wrote. A user's own mcp_*.md is theirs.
      if (!isKonohaOwnedAgentFile(full)) continue;
      fs.unlinkSync(full);
    }
  } catch (_) { /* ignore */ }
}

/** True for a real agent whose name is safe to use as a file name here. */
function _isDeployableAgent(agent, agentsDir) {
  if (!agent || !agent.name) return false;
  if (!validateAgentName(agent.name, agentsDir)) return false;
  return !agent.name.startsWith('mcp_') && !agent.name.startsWith('cli-test-');
}

/** True when an existing file belongs to someone else and differs from ours. */
function _needsConflictParking(targetPath, mdContent) {
  if (!fileExists(targetPath) || isKonohaOwnedAgentFile(targetPath)) return false;
  return fs.readFileSync(targetPath, 'utf8') !== mdContent;
}

/**
 * Keeps a foreign agent definition in place, backs it up once, and leaves
 * Konoha's version beside it so the caller can report the conflict.
 */
function _parkConflictingAgent(targetPath, mdContent, agentName) {
  const backupPath = `${targetPath}.konoha-backup`;
  if (!fileExists(backupPath)) {
    try { fs.copyFileSync(targetPath, backupPath); } catch (_) { /* best effort */ }
  }
  const proposed = `${targetPath}.konoha-proposed`;
  fs.writeFileSync(proposed, mdContent);
  return { agent: agentName, path: targetPath, proposed };
}

function _reportAgentConflicts(conflicts) {
  for (const c of conflicts) {
    process.stderr.write(`! Kept existing ${c.path}; Konoha's version written to ${c.proposed}\n`);
  }
}

function _deployClaudeCodeAgents(agents, options = {}) {
  if (!agents || !agents.length) return;
  const claudeAgentsDir = (options && options.home ? path.join(options.home, ".claude", "agents") : path.join(HOME, ".claude", "agents"));
  ensureDir(claudeAgentsDir);
  const conflicts = [];
  for (const agent of agents) {
    if (!_isDeployableAgent(agent, claudeAgentsDir)) continue;
    const mdContent = generateClaudeCodeSubagent(agent);
    const targetPath = path.join(claudeAgentsDir, agent.name + ".md");
    if (_needsConflictParking(targetPath, mdContent)) {
      conflicts.push(_parkConflictingAgent(targetPath, mdContent, agent.name));
      continue;
    }
    fs.writeFileSync(targetPath, mdContent);
  }
  _cleanMcpAgentFiles(claudeAgentsDir);
  if (conflicts.length > 0 && options.silent !== true) _reportAgentConflicts(conflicts);
  return conflicts;
}

function ensureClaudeCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    ruleContent = null,
    silent = true,
    agents = [],
    projectRoot: _projectRoot = null,
    deployProject: _deployProject = false,
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

  registerClaudeCodeGlobalMcp(pythonCmd, serverPath, silent, options);
  registerClaudeCodePermissions(silent, options);
  registerClaudeCodeNativeBlocker(options);
  registerClaudeCodeBashGuard(silent, options);
  registerClaudeCodeWorkflowReminder(silent, options);
  deployClaudeCodeRtkRule(silent, options);
  initRtkHook(silent);

  const effectiveAgents = (agents && agents.length > 0) ? agents : require("../agent_manager").loadAgents();
  const effectiveRuleContent = ruleContent || require("../agent_manager").generateClaudeCodeMd(effectiveAgents);
  deployClaudeCodeRules(effectiveRuleContent, silent, options);

  _deployClaudeCodeAgents(effectiveAgents, { ...options, silent });

  const projectRoot = options.projectRoot || null;
  if (projectRoot && (options.appendProject || (options.deployProject && _hasExistingClaudeProjectConfig(projectRoot)))) {
    if (options.appendProject || fileExists(path.join(projectRoot, '.mcp.json'))) {
      registerClaudeCodeProjectMcp(projectRoot, pythonCmd, serverPath, silent);
    }
    if (options.appendProject || fileExists(path.join(projectRoot, '.claude', 'settings.json'))) {
      registerClaudeCodePermissions(silent, { settingsPath: path.join(projectRoot, '.claude', 'settings.json') });
    }
    if (options.appendProject || fileExists(path.join(projectRoot, 'CLAUDE.md'))) {
      deployProjectClaudeMd(projectRoot, effectiveAgents, silent, effectiveRuleContent);
    }
  }

  return { ok: true };
}

function getClaudeCodeStatus() {
  const status = {
    installed: isClaudeCodeInstalled(),
    globalConfig: fileExists(CLAUDE_JSON),
    mcpKonoha: false,
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
      const hasAislop = allowed.includes('mcp__aislop__*') || allowed.some(a => typeof a === 'string' && a.startsWith('mcp__aislop__'));
      status.permissionsAllowed = hasKonoha && hasAislop;
    } catch { /* ignore */ }
  }

  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const official = getCanonicalAgentNames();
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
  const official = getCanonicalAgentNames();
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
  isKonohaOwnedAgentFile,
  AGENT_OWNERSHIP_MARKER,
  _cleanMcpAgentFiles,
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
