'use strict';

const fs = require('fs');
const path = require('path');
const {
  fileExists,
  ensureDir,
  isRtkInstalled
} = require('../platform_utils');
const {
  buildMainAgentContract,
  generateGenericSubagentMd
} = require('../agent_contract');
const { buildGuardrailCheckerSource } = require('../guardrails');
const {
  SERVER_PATH,
  COMMANDCODE_JSON,
  HOME,
  isCommandCodeInstalled,
  validateAgentName,
  resolveRtkRuleTemplate,
  buildStdioMcpServers,
  mergeJsonFile,
  mergeMcpServersBlock,
  backupFile,
  buildClientToolGrants,
  buildBareToolGrants,
  readMcpHealth,
  removeKonohaFromMcpBlock
} = require('./common');

function deployCommandCodeRtkRule(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  const src = resolveRtkRuleTemplate();
  if (!src) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }
  const dest = path.join(HOME, '.commandcode', 'rules', 'rtk.md');
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (!silent) process.stderr.write(String('  ✓ Deployed RTK rule to ' + dest) + '\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function registerCommandCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true, options = {}) {
  if (typeof silent === 'object' && silent !== null) {
    options = silent;
    silent = options.silent !== false;
  }
  const targetConfig = options.configPath || (options.home ? path.join(options.home, '.commandcode', 'mcp.json') : COMMANDCODE_JSON);
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd, client: 'commandcode' });

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
  if (!silent) process.stderr.write(`  ✓ ${path.basename(targetConfig)} updated with Konoha MCP servers\n`);
  return true;
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

function registerCommandCodePermissions(silent = true) {
  const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
  return mergeJsonFile(
    settingsPath,
    (config) => {
      if (!config.permissions) config.permissions = {};
      const allowRaw = Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
      let updated = false;

      const invalidRules = [
        '*',
        'rtk *',
        'Shell(rtk *)',
        'Bash(rtk *)',
        'Shell(konoha *)',
        'command(rtk *)',
        'Shell(*)',
        'Bash(*)'
      ];
      const allow = allowRaw.filter(rule => !invalidRules.includes(rule));
      if (allow.length !== allowRaw.length) updated = true;

      const grants = [
        ...buildClientToolGrants('mcp__'),
        ...buildClientToolGrants('mcp:'),
        'Shell(rtk)',
        'Bash(rtk)',
        'Shell(konoha)',
        'Bash(konoha)',
        'rtk',
        'command(rtk)'
      ];
      if (_appendMissing(allow, grants)) updated = true;
      config.permissions.allow = allow;

      const _autoApproveGrants = [
        ...buildClientToolGrants('mcp__'),
        ...buildClientToolGrants('mcp:'),
        ...buildClientToolGrants(''),
        ...buildBareToolGrants(),
        'Shell(rtk)',
        'Shell(rtk:*)',
        'Shell(rtk *)',
        'Bash(rtk)',
        'Bash(rtk:*)',
        'Bash(rtk *)',
        'rtk',
        'rtk *',
        'konoha',
        'konoha *'
      ];
      if (!config.autoApprove || !Array.isArray(config.autoApprove)) {
        config.autoApprove = _autoApproveGrants;
        updated = true;
      } else {
        config.autoApprove = config.autoApprove.filter(rule => !invalidRules.includes(rule));
        if (_appendMissing(config.autoApprove, _autoApproveGrants)) updated = true;
      }

      const defaultAllowedTools = [
        ...buildClientToolGrants('mcp__')
      ];
      if (!config.allowedTools || !Array.isArray(config.allowedTools)) {
        config.allowedTools = defaultAllowedTools;
        updated = true;
      } else {
        config.allowedTools = config.allowedTools.filter(t => t !== 'Bash' && t !== 'Shell' && t !== '*');
        if (_appendMissing(config.allowedTools, defaultAllowedTools)) updated = true;
      }

      return updated;
    },
    silent
  );
}

function buildCommandCodeBlockerSource() {
  const checkerLiteral = JSON.stringify(buildGuardrailCheckerSource());
  return `#!/usr/bin/env node
const fs = require('fs');
const GUARDRAIL_CHECKER_SOURCE = ${checkerLiteral};
const checkCommandGuardrails = new Function(GUARDRAIL_CHECKER_SOURCE + "\\nreturn checkCommandGuardrails;")();
let raw = '';
try { raw = fs.readFileSync(0, 'utf-8'); } catch (e) { process.exit(0); }
let input = null;
try { input = JSON.parse(raw); } catch (e) { process.exit(0); }
const toolName = input && (input.tool_name || input.tool_display_name);
if (toolName === 'read_file' || toolName === 'READ') {
  const reason = "⚠️ MANDATORY RULE VIOLATION: Using built-in/native file tools (read_file, Read, cat, etc.) is STRICTLY FORBIDDEN! You MUST use the konoha MCP bounded file tools (read_file_head, read_file_range, file_info, get_file_structure, find_files_clean, token_efficient_grep) or semble MCP for codebase search! Retry using ONLY konoha or semble MCP tools.";
  process.stdout.write(JSON.stringify({
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }) + '\\n');
  process.exit(0);
}
const SHELL_TOOL_NAMES = ['shell_command', 'ShellCommand', 'bash', 'Bash', 'shell', 'Shell'];
if (SHELL_TOOL_NAMES.indexOf(toolName) !== -1) {
  const ti = (input && (input.tool_input || input.input)) || {};
  const command = [ti.command, ti.cmd, input.command, input.cmd]
    .find(function (v) { return typeof v === 'string' && v.length > 0; }) || '';
  if (command) {
    const violation = checkCommandGuardrails(command);
    if (violation) {
      process.stdout.write(JSON.stringify({
        suppressOutput: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: violation.reason
        }
      }) + '\\n');
    }
  }
}
`;
}

function registerCommandCodeNativeBlocker(silent = true) {
  const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
  if (!fileExists(settingsPath)) {
    return { ok: false, reason: 'commandcode-settings-missing' };
  }
  const binDir = path.join(HOME, '.local', 'bin');
  const blockerJs = path.join(binDir, 'konoha-native-blocker-cc.js');
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const payload = buildCommandCodeBlockerSource();
    fs.writeFileSync(blockerJs, payload, { mode: 0o755 });
  } catch (e) {
    return { ok: false, reason: 'blocker-write-failed', error: e.message };
  }

  const blockerCommand = `"${process.execPath}" "${blockerJs}"`;
  mergeJsonFile(
    settingsPath,
    (config) => {
      if (!config.hooks) config.hooks = {};
      if (!Array.isArray(config.hooks.PreToolUse)) config.hooks.PreToolUse = [];
      const existing = config.hooks.PreToolUse.find(
        (h) => h.hooks && h.hooks.some((e) => e.command && e.command.includes('konoha-native-blocker-cc'))
      );
      if (existing) {
        const entry = existing.hooks.find((e) => e.command && e.command.includes('konoha-native-blocker-cc'));
        if (entry.command !== blockerCommand) {
          entry.command = blockerCommand;
          return true;
        }
        return false;
      }
      config.hooks.PreToolUse.push({
        hooks: [
          {
            type: 'command',
            command: blockerCommand
          }
        ]
      });
      return true;
    },
    silent
  );
  return { ok: true, blocker: blockerJs };
}

function _loadCommandCodeSettingsSafe(settingsPath, silent) {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) || {};
  } catch (_) {
    try {
      fs.copyFileSync(settingsPath, settingsPath + '.corrupt-' + Date.now());
      if (!silent) console.warn(`⚠ ${settingsPath} was invalid JSON — backed up`);
    } catch (_) { /* ignore */ }
    return {};
  }
}

function registerCommandCodeWorkflowReminder(silent = true) {
  const reminderPath = path.join(HOME, '.konoha', 'workflow_reminder.js');
  if (!fileExists(reminderPath)) return;
  const reminderCommand = `"${process.execPath}" "${reminderPath}"`;
  const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
  try {
    if (!fs.existsSync(path.dirname(settingsPath))) {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    }
    const settings = _loadCommandCodeSettingsSafe(settingsPath, silent);
    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
    const already = settings.hooks.SessionStart.some(
      (h) => h.hooks && h.hooks.some((e) => e.command && e.command.includes('workflow_reminder'))
    );
    if (already) return;
    settings.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: reminderCommand }]
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    if (!silent) process.stderr.write('✓ Konoha workflow reminder registered (Command Code SessionStart: startup/resume/clear)\n');
  } catch (err) {
    if (!silent) console.warn(`⚠ Command Code workflow reminder registration failed: ${err.message}`);
  }
}

function deployCommandCodeRules(silent = true) {
  const { loadAgents, generateAgentsMd } = require('../agent_manager');

  let agents = [];
  try {
    agents = loadAgents();
  } catch { /* ignore */ }

  const agentsMd = path.join(HOME, '.commandcode', 'AGENTS.md');
  const ruleDest = path.join(HOME, '.commandcode', 'rules', 'konoha.md');
  const agentsDir = path.join(HOME, '.commandcode', 'agents');

  try {
    ensureDir(path.dirname(agentsMd));
    ensureDir(path.dirname(ruleDest));
    ensureDir(agentsDir);

    const fullInstructions = generateAgentsMd(agents, 'commandcode');
    const agentManager = require('../agent_manager');
    const finalAgentsMd = agentManager.injectManagedConfig(agentsMd, fullInstructions, 'KONOHA');
    fs.writeFileSync(agentsMd, finalAgentsMd, 'utf8');

    const contractContent = buildMainAgentContract('commandcode') + '\n';
    fs.writeFileSync(ruleDest, contractContent, 'utf8');

    for (const agent of agents) {
      if (!agent || !agent.name || !validateAgentName(agent.name, agentsDir) || agent.name.startsWith('mcp_') || agent.name.startsWith('cli-test-')) continue;
      const subagentMd = generateGenericSubagentMd(agent, 'commandcode');
      fs.writeFileSync(path.join(agentsDir, `${agent.name}.md`), subagentMd, 'utf8');
    }

    if (!silent) process.stderr.write(`  ✓ Deployed Konoha instructions, rules & agents to Command Code\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'copy-failed', error: error.message };
  }
}

function ensureCommandCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = false,
    force = false,
    skipDetection = false
  } = options;

  if (!force && !skipDetection && !isCommandCodeInstalled()) {
    return { ok: false, reason: 'Command Code not detected' };
  }

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  if (!registerCommandCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent, options)) {
    return { ok: false, reason: 'commandcode-mcp-registration-failed' };
  }
  registerCommandCodePermissions(silent);
  registerCommandCodeWorkflowReminder(silent);
  const nativeBlocker = registerCommandCodeNativeBlocker(silent);
  const rtkRule = deployCommandCodeRtkRule(silent);
  const contractRule = deployCommandCodeRules(silent);
  const status = getCommandCodeStatus(options);
  if (!status.mcpKonoha || !status.mcpSemble) {
    return { ok: false, reason: 'commandcode-mcp-verification-failed' };
  }
  return {
    ok: true,
    rtk: status.rtkInstalled ? 'already-installed' : 'rtk-not-installed',
    rtkRule: rtkRule.ok ? 'deployed' : rtkRule.reason,
    contractRule: contractRule.ok ? 'deployed' : contractRule.reason,
    nativeBlocker: nativeBlocker.ok ? 'deployed' : nativeBlocker.reason
  };
}

function _cleanCommandCodeSettings(config) {
  let updated = false;
  if (config.permissions && Array.isArray(config.permissions.allow)) {
    const initial = config.permissions.allow.length;
    config.permissions.allow = config.permissions.allow.filter(
      (p) => !p.startsWith('mcp__konoha') && !p.startsWith('mcp__semble') && !p.startsWith('mcp__aislop') && !p.startsWith('mcp__skills-db')
    );
    if (config.permissions.allow.length !== initial) updated = true;
  }
  if (config.hooks && Array.isArray(config.hooks.PreToolUse)) {
    const initial = config.hooks.PreToolUse.length;
    config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
      (h) => !(h.hooks && h.hooks.some((e) => e.command && e.command.includes('konoha-native-blocker-cc')))
    );
    if (config.hooks.PreToolUse.length !== initial) updated = true;
  }
  return updated;
}

function removeCommandCodeConfig(silent = true, options = {}) {
  const home = options.home || process.env.HOME || HOME;
  const commandCodeJson = options.configPath || (home === HOME ? COMMANDCODE_JSON : path.join(home, '.commandcode', 'mcp.json'));
  if (fileExists(commandCodeJson)) {
    try {
      mergeJsonFile(
        commandCodeJson,
        (config) => removeKonohaFromMcpBlock(config.mcpServers),
        silent
      );
    } catch { /* ignore */ }
  }
  const settingsPath = path.join(home, '.commandcode', 'settings.json');
  if (fileExists(settingsPath)) {
    try {
      mergeJsonFile(settingsPath, _cleanCommandCodeSettings, silent);
    } catch { /* ignore */ }
  }
  const rtkRule = path.join(home, '.commandcode', 'rules', 'rtk.md');
  if (fileExists(rtkRule)) {
    try { fs.unlinkSync(rtkRule); } catch { /* ignore */ }
  }
  return { ok: true };
}

function _readCommandCodeConfig() {
  if (!fileExists(COMMANDCODE_JSON)) return null;
  try {
    const raw = fs.readFileSync(COMMANDCODE_JSON, 'utf-8');
    try {
      return JSON.parse(raw);
    } catch (_) {
      const { parseYaml } = require('../agent_manager');
      return parseYaml(raw);
    }
  } catch (_) {
    return null;
  }
}

function _readCommandCodeSettingsStatus(status) {
  const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
  if (!fileExists(settingsPath)) return;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const allow = settings.permissions && Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    status.permissionsAllowed = allow.includes('mcp__konoha__*') && allow.includes('mcp__semble__*') && allow.includes('mcp__aislop__*');
    const ccHooks = settings.hooks || {};
    status.nativeBlockerDeployed = Array.isArray(ccHooks.PreToolUse) && ccHooks.PreToolUse.some(
      (h) => h.hooks && h.hooks.some((e) => e.command && e.command.includes('konoha-native-blocker-cc'))
    );
  } catch { /* ignore */ }
}

function getCommandCodeStatus(options = {}) {
  const home = options.home || process.env.HOME || HOME;
  const targetConfig = options.configPath || (options.home ? path.join(home, '.commandcode', 'mcp.json') : COMMANDCODE_JSON);
  const status = {
    installed: options.force || options.skipDetection ? true : isCommandCodeInstalled(),
    globalConfig: fileExists(targetConfig),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    path: targetConfig,
    status: 'missing',
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(home, '.commandcode', 'rules', 'rtk.md')),
    nativeBlockerDeployed: false,
    permissionsAllowed: false
  };

  if (!status.installed) {
    status.status = 'missing';
    return status;
  }

  let config = null;
  if (fileExists(targetConfig)) {
    try { config = JSON.parse(fs.readFileSync(targetConfig, 'utf-8')); } catch { config = null; }
  } else {
    config = _readCommandCodeConfig();
  }
  if (config) {
    const health = readMcpHealth(config, 'mcpServers');
    status.mcpKonoha = health.konoha;
    status.mcpSemble = health.semble;
    status.mcpAislop = health.aislop;
    status.mcpSkillsDb = health.skillsDb;
    status.mcpServers = config.mcpServers || {};

    _readCommandCodeSettingsStatus(status);

    if (health.konoha && health.semble && health.aislop) {
      status.status = 'ok';
    }
  }

  return status;
}

module.exports = {
  deployCommandCodeRtkRule,
  registerCommandCodeGlobalMcp,
  registerCommandCodePermissions,
  ensureCommandCodeSetup,
  buildCommandCodeBlockerSource,
  registerCommandCodeNativeBlocker,
  registerCommandCodeWorkflowReminder,
  deployCommandCodeRules,
  getCommandCodeStatus,
  removeCommandCodeConfig
};
