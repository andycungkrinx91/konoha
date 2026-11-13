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
  SERVER_PATH,
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  HOME,
  isClaudeCodeInstalled,
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

const {
  adaptInstructionsForClaudeCode,
  generateClaudeCodeSubagent,
  AGENT_OWNERSHIP_MARKER,
  isKonohaOwnedAgentFile,
  _cleanMcpAgentFiles,
  _deployClaudeCodeAgents
} = require('./claude_agent_files');

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
