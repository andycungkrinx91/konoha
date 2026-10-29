'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const agentManager = require('../../src/agent_manager');
const { fileExists } = require('../../src/platform_utils');
const {
  HOME,
  DB_PATH,
  SKILLS_DB_DIR,
  MIGRATE_PATH,
  MCP_CONFIG_PATH,
  GEMINI_MD_PATH,
  FILE_TOOLS_MCP_PATH,
  MIGRATION_TIMEOUT_MS
} = require('../lib/paths');
const { updateGeminiMd, detectSkillsDirs, detectCustomSkills } = require('../lib/runtime_lifecycle');
const { registerHooks, registerMcp } = require('../lib/runtime_mcp');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('../../src/semble_manager');
const { confirmPrompt } = require('../lib/prompt');
const { checkPortActive, getServiceStatus } = require('../lib/ui_commands');

function runMigrateForDir(s, runMigrate) {
  const skills = detectCustomSkills(s.path);
  if (skills.length === 0) return false;
  try {
    const run = runMigrate(['--skills-dir', s.path, '--skills', ...skills]);
    return run.status === 0;
  } catch {
    return false;
  }
}

function executeMigrationRun(skillsDirs) {
  const safeTimeout = Number.isFinite(Number(MIGRATION_TIMEOUT_MS)) && Number(MIGRATION_TIMEOUT_MS) > 0
    ? Number(MIGRATION_TIMEOUT_MS)
    : 180000;

  const runMigrate = (args = []) => spawnSync(process.execPath, [MIGRATE_PATH, ...args], {
    encoding: 'utf-8',
    cwd: SKILLS_DB_DIR,
    timeout: safeTimeout,
    stdio: 'pipe'
  });

  for (const s of skillsDirs) {
    if (runMigrateForDir(s, runMigrate)) return true;
  }

  try {
    const runFallback = runMigrate([]);
    return runFallback.status === 0;
  } catch {
    return false;
  }
}

function checkDatabaseAndMigrations(context) {
  if (fileExists(DB_PATH)) {
    context.record('Database File (konoha.db)', 'HEALTHY', 'Database file is present');
    return;
  }

  const skillsDirs = detectSkillsDirs();
  const migrationSuccess = executeMigrationRun(skillsDirs);

  if (migrationSuccess && fileExists(DB_PATH)) {
    context.record('Database File (konoha.db)', 'REPAIRED', 'Re-created and indexed skills');
    context.incrementRepairs();
  } else {
    context.record('Database File (konoha.db)', 'FAILED', 'Failed to create database via migration script');
    context.markError();
  }
}

function verifyMcpConfigContent(config, nodeCmd) {
  const expectedSembleArgs = ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'];
  const expectedAislopArgs = ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  const servers = config.mcpServers || {};
  const sembleOk = servers['semble'] && JSON.stringify(servers['semble'].args || []) === JSON.stringify(expectedSembleArgs);
  const aislopOk = servers['aislop'] && JSON.stringify(servers['aislop'].args || []) === JSON.stringify(expectedAislopArgs);
  const konohaServer = servers['konoha'];
  const konohaOk = konohaServer &&
    konohaServer.args &&
    (konohaServer.args[0] === FILE_TOOLS_MCP_PATH || konohaServer.args[0] === path.join(HOME, '.konoha', 'file_tools_launcher.js')) &&
    (konohaServer.command === nodeCmd || konohaServer.command === 'node');
  return Boolean(sembleOk && konohaOk && aislopOk);
}

function checkMcpConfiguration(context) {
  let mcpHealthy = false;
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      mcpHealthy = verifyMcpConfigContent(config, process.execPath);
    } catch { /* intentional fallback */ }
  }

  if (mcpHealthy) {
    context.record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha, semble, and aislop are active');
    return;
  }

  try {
    registerMcp();
    context.record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha, semble, and aislop in config');
    context.incrementRepairs();
  } catch (e) {
    context.record('MCP Config (mcp_config.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkGeminiAndAgentsConfig(context) {
  checkMcpConfiguration(context);

  let geminiHealthy = false;
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      if (content.includes('find_skill')) geminiHealthy = true;
    } catch { /* intentional fallback */ }
  }

  if (geminiHealthy) {
    context.record('GEMINI Instructions (GEMINI.md)', 'HEALTHY', 'Instructions are active');
  } else {
    try {
      updateGeminiMd();
      context.record('GEMINI Instructions (GEMINI.md)', 'REPAIRED', 'GEMINI.md instructions restored');
      context.incrementRepairs();
    } catch (e) {
      context.record('GEMINI Instructions (GEMINI.md)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  }

  const USER_AGENTS_YAML_PATH = path.join(HOME, '.agents', 'agents.yaml');
  let agentsHealthy = false;
  if (fileExists(USER_AGENTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8');
      if (content.includes('name:') || content.includes('genin')) agentsHealthy = true;
    } catch { /* intentional fallback */ }
  }

  if (agentsHealthy) {
    context.record('AGENTS Definition (agents.yaml)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    try {
      agentManager.loadAgents();
      context.record('AGENTS Definition (agents.yaml)', 'REPAIRED', 'agents.yaml configurations restored');
      context.incrementRepairs();
    } catch (e) {
      context.record('AGENTS Definition (agents.yaml)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  }
}

function inspectPromptHooksStatus() {
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  if (!fileExists(HOOKS_CONFIG_PATH)) return { promptOk: false, sanitizeOk: false };
  try {
    const config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
    let promptOk = false;
    let sanitizeOk = false;
    if (config['konoha-prompt-hook']?.PreInvocation) {
      const hooks = config['konoha-prompt-hook'].PreInvocation;
      const hasPrompt = hooks.some(h => h.command && h.command.includes('prompt_hook.js'));
      const hasSubagent = hooks.some(h => h.command && h.command.includes('antigravity_subagent_hook.js'));
      if (hasPrompt && hasSubagent) promptOk = true;
    }
    if (config['konoha-tool-sanitize']?.PreToolUse) {
      sanitizeOk = config['konoha-tool-sanitize'].PreToolUse.some(
        entry => entry.hooks && entry.hooks.some(h => h.command && h.command.includes('antigravity_tool_sanitize_hook.js'))
      );
    }
    return { promptOk, sanitizeOk };
  } catch {
    return { promptOk: false, sanitizeOk: false };
  }
}

async function promptForHookRegistration(globalSpinner) {
  const isNonInteractive = process.argv.includes('--yes') || process.argv.includes('-y') || process.env.CI === 'true';
  if (isNonInteractive) return true;
  globalSpinner.stop();
  try {
    const allow = await confirmPrompt('Allow registering prompt-saver hook in ~/.gemini/config/hooks.json?', true);
    globalSpinner.start('Running environment diagnostics...');
    return allow;
  } catch {
    globalSpinner.start('Running environment diagnostics...');
    return false;
  }
}

async function checkPromptHookConfig(context, globalSpinner) {
  const { promptOk, sanitizeOk } = inspectPromptHooksStatus();
  if (promptOk && sanitizeOk) {
    context.record('Prompt Hook Config (hooks.json)', 'HEALTHY', 'subagent + prompt + sanitize hooks registered');
    return;
  }

  const allowHooks = await promptForHookRegistration(globalSpinner);
  if (allowHooks) {
    try {
      registerHooks(true, true);
      context.record('Prompt Hook Config (hooks.json)', 'REPAIRED', 'Registered subagent + prompt hooks in hooks.json');
      context.incrementRepairs();
    } catch (e) {
      context.record('Prompt Hook Config (hooks.json)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  } else {
    context.record('Prompt Hook Config (hooks.json)', 'WARNING', 'Prompt hook is not registered (user declined)');
  }
}

function restoreKageAntislopSkill(context) {
  try {
    const agents = agentManager.loadAgents(true, true);
    const kage = agents.find(a => a.name === 'kage');
    if (!kage) return false;
    if (!Array.isArray(kage.skills)) kage.skills = [];
    if (!kage.skills.includes('antislop')) kage.skills.push('antislop');
    agentManager.saveAgents(agents);
    const dbAgents = require('../../src/db_agents');
    dbAgents.bulkImportAgents(agents, DB_PATH);
    context.incrementRepairs();
    context.record('Anti-Slop Gate (Kage)', 'REPAIRED', 'Restored and registered anti-slop skill for Kage reviewer');
    return true;
  } catch {
    return false;
  }
}

function checkAntiSlopGate(conn, context) {
  let hasAntislopInDb = false;
  try {
    const row = conn.prepare("SELECT 1 FROM skills WHERE name = 'antislop' OR name = 'kage-skill/antislop' OR name LIKE '%antislop%' LIMIT 1").get();
    hasAntislopInDb = Boolean(row);
  } catch { /* intentional fallback */ }

  let kageSkills = '';
  try {
    const kageRow = conn.prepare("SELECT skills FROM agents WHERE name = 'kage'").get();
    kageSkills = (kageRow && kageRow.skills) ? kageRow.skills.toLowerCase() : '';
  } catch { /* intentional fallback */ }

  let hasAntislopSkill = kageSkills.includes('antislop') || kageSkills.includes('anti-slop') || kageSkills.includes('aislop') || (kageSkills.includes('kage-skill') && hasAntislopInDb);

  if (!hasAntislopSkill) {
    hasAntislopSkill = restoreKageAntislopSkill(context);
  }

  if (hasAntislopSkill) {
    context.record('Anti-Slop Gate (Kage)', 'HEALTHY', 'Anti-slop skill loaded for Kage reviewer');
    return;
  }
  context.record('Anti-Slop Gate (Kage)', 'WARNING', 'anti-slop skill not installed for kage (falls back to core zero-slop checks)');
}

function checkCrossProviderReview(conn, context) {
  const enabledBridges = conn.prepare('SELECT count(*) as count FROM bridges WHERE enabled = 1').get();
  const bridgeCount = enabledBridges ? enabledBridges.count : 0;
  if (bridgeCount < 2) {
    context.record('Cross-Provider Review Setup', 'INFO', `${bridgeCount} bridge(s) enabled. Cross-provider review falls back to same-provider if configured.`);
  } else {
    context.record('Cross-Provider Review Setup', 'HEALTHY', `${bridgeCount} bridges enabled for independent second-opinion reviews`);
  }
}

function inspectGovernanceConn(conn, context) {
  try {
    const dbModule = require('../../src/db');
    dbModule.setupSchema(conn);
    checkCrossProviderReview(conn, context);
    checkAntiSlopGate(conn, context);
  } finally {
    try { conn.close(); } catch (_) { /* intentional fallback */ }
  }
}

function checkDatabaseGovernance(context) {
  try {
    const dbModule = require('../../src/db');
    const conn = dbModule.getConnection(DB_PATH);
    inspectGovernanceConn(conn, context);
  } catch (_) { /* intentional fallback */ }
}

async function checkWebUiDaemon(context) {
  try {
    const uiActive = await checkPortActive(1404);
    const svc = await getServiceStatus();
    if (uiActive) {
      context.record('Konoha Web UI (http://127.0.0.1:1404/)', 'HEALTHY', `Daemon is active${svc.installed ? ` (${svc.type} service ${svc.active ? 'active' : 'inactive'})` : ''}`);
    } else {
      context.record('Konoha Web UI (http://127.0.0.1:1404/)', 'WARNING', 'UI daemon not running (run: konoha ui start or konoha ui service install)');
    }
  } catch (_) { /* intentional fallback */ }
}

async function checkGovernanceAndServices(context) {
  checkDatabaseGovernance(context);
  await checkWebUiDaemon(context);
}

module.exports = {
  checkDatabaseAndMigrations,
  checkGeminiAndAgentsConfig,
  checkPromptHookConfig,
  checkGovernanceAndServices
};
