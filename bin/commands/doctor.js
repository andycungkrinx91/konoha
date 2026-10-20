'use strict';

/**
 * bin/commands/doctor.js — Environment Diagnostics and Auto-Repair.
 *
 * Diagnoses:
 * - Node.js version and environment
 * - Python and SQLite availability
 * - MCP configuration and server registrations
 * - File integrity and tools_savings_logger.js repairs
 * - Subagent configurations and client sync (Antigravity, Cursor, Claude, etc.)
 * - File tools MCP server and smoke tests
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  DB_PATH,
  SERVER_PATH,
  MCP_CONFIG_PATH,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_PY_DIR,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_ROUTER_PATH,
  GEMINI_MD_PATH,
  MIGRATION_TIMEOUT_MS,
  MIGRATE_PATH,
  SRC_DIR
} = require('../lib/paths');

const {
  C,
  log,
  info,
  error,
  header,
  drawLogo,
  applyGradient,
  CHIDORI_THEME,
  LEAF_THEME,
  FIRE_THEME,
  NINJA_THEME,
  gradientStatusCell,
  drawTable,
  drawBox,
  computeTableWidths
} = require('../lib/format');

const { fileExists, ensureDir, copyFile, checkPython, confirmPrompt, startSpinner } = require('../lib/prompt');
const { registerMcp, registerHooks, installFileTools, smokeTestKonohaFilesMcp, detectSkillsDirs, detectCustomSkills, updateGeminiMd } = require('../lib/runtime');
const { getAgentBrowserCommand, installAgentBrowser, getUvxCommand } = require('../lib/extension');
const { cmdTest } = require('./test');
const { checkPortActive } = require('./bridge');
const { getServiceStatus } = require('../lib/ui_commands');

const agentManager = require('../../src/agent_manager');
const cursorManager = require('../../src/cursor_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const deployUtils = require('../../src/deploy_utils');

const DB_PY_PATH = path.join(SKILLS_DB_DIR, 'db.js');
const VECTOR_SEARCH_PY_PATH = path.join(SKILLS_DB_DIR, 'vector_search.js');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (_) {
  /* intentional best-effort fallback */
}

function cmdDoctorHelp() {
  log(`
${C.cyan}konoha doctor${C.reset} — Run environment diagnostics and auto-repair missing components

${C.bold}USAGE${C.reset}
  konoha doctor [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--yes, -y${C.reset}  Auto-apply recommended repairs non-interactively.

${C.bold}EXAMPLES${C.reset}
  konoha doctor
  konoha doctor --yes
`);
}

async function cmdDoctor(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdDoctorHelp();
    return;
  }
  drawLogo();
  header('🩺 Konoha Doctor');
  log(`${applyGradient('Diagnosing environment requirements and auto-repairing missing components...', CHIDORI_THEME, 0.75)}\n`);

  const globalSpinner = startSpinner('Running environment diagnostics...');

  let repairsDone = 0;
  let hasErrors = false;
  
  const results = [];

  // Helper to record result
  const record = (component, status, details) => {
    results.push({ component, status, details });
  };

  // 1. Node.js Environment
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    hasErrors = true;
    record('Node.js Environment', 'FAILED', `Node.js >= 18 is required, found ${nodeVersion}`);
  } else {
    record('Node.js Environment', 'ACTIVE', `${nodeVersion} (${process.execPath})`);
  }

  // Helper to check and repair local package files
  const checkAndRepairFile = (srcName, destPath, label) => {
    const srcPath = path.join(SRC_DIR, srcName);
    const srcExists = fileExists(srcPath);
    
    if (fileExists(destPath)) {
      if (srcExists) {
        try {
          const srcContent = fs.readFileSync(srcPath, 'utf-8');
          const destContent = fs.readFileSync(destPath, 'utf-8');
          if (srcContent !== destContent) {
            copyFile(srcPath, destPath);
            record(label, 'REPAIRED', 'Updated outdated file from package templates');
            repairsDone++;
            return;
          }
        } catch (e) {
          record(label, 'FAILED', `Error checking content: ${e.message}`);
          hasErrors = true;
          return;
        }
      }
      record(label, 'HEALTHY', 'File is present and healthy');
      return;
    }
    
    // Repair
    try {
      ensureDir(path.dirname(destPath));
      if (srcExists) {
        copyFile(srcPath, destPath);
        record(label, 'REPAIRED', 'Restored missing file from package templates');
        repairsDone++;
      } else {
        record(label, 'FAILED', `Source file ${srcName} not found in package`);
        hasErrors = true;
      }
    } catch (e) {
      record(label, 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  };

  // 1b. DB Module
  checkAndRepairFile('db.js', DB_PY_PATH, 'DB Module (db.js)');

  // 1c. Vector Search Module
  checkAndRepairFile('vector_search.js', VECTOR_SEARCH_PY_PATH, 'Vector Search Module (vector_search.js)');

  // 2. Server File
  checkAndRepairFile('server.js', SERVER_PATH, 'Server File (server.js)');

  // 3. Migration Script
  checkAndRepairFile('migrate.js', MIGRATE_PATH, 'Migration Script (migrate.js)');
  checkAndRepairFile('canonical_skills.js', path.join(SKILLS_DB_DIR, 'canonical_skills.js'), 'Canonical Skills (canonical_skills.js)');

  // 4. Stats Helper
  const statsScriptDest = path.join(SKILLS_DB_DIR, 'db_stats.js');
  checkAndRepairFile('db_stats.js', statsScriptDest, 'Stats Helper Script (db_stats.js)');

  // 5. Savings Helper
  const savingsScriptDest = path.join(SKILLS_DB_DIR, 'db_savings.js');
  checkAndRepairFile('db_savings.js', savingsScriptDest, 'Savings Helper Script (db_savings.js)');

  // 5b. Agent Stats Helper
  const agentStatsScriptDest = path.join(SKILLS_DB_DIR, 'agent_stats.js');
  checkAndRepairFile('agent_stats.js', agentStatsScriptDest, 'Agent Stats Helper Script (agent_stats.js)');

  // 5c. Prompt Hook Script
  const promptHookScriptDest = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  checkAndRepairFile('prompt_hook.js', promptHookScriptDest, 'Prompt Hook Script (prompt_hook.js)');

  const subagentHookScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  checkAndRepairFile('antigravity_subagent_hook.js', subagentHookScriptDest, 'Subagent Hook Script (antigravity_subagent_hook.js)');

  const antigravityManagerScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_manager.js');
  checkAndRepairFile('antigravity_manager.js', antigravityManagerScriptDest, 'Antigravity Manager Script (antigravity_manager.js)');

  const sanitizeHookScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  checkAndRepairFile('antigravity_tool_sanitize_hook.js', sanitizeHookScriptDest, 'Tool Sanitize Hook (antigravity_tool_sanitize_hook.js)');

  const guardrailsScriptDest = path.join(SKILLS_DB_DIR, 'guardrails.js');
  checkAndRepairFile('guardrails.js', guardrailsScriptDest, 'Shared Guardrails (guardrails.js)');

  // 5d. Token-efficient file tools (konoha-files MCP)
  checkAndRepairFile('file_tools_mcp.js', FILE_TOOLS_MCP_PATH, 'File Tools MCP (file_tools_mcp.js)');
  checkAndRepairFile('file_tools_router.js', FILE_TOOLS_ROUTER_PATH, 'File Tools Router (file_tools_router.js)');
  checkAndRepairFile('file_tools_launcher.js', path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'), 'File Tools Launcher (file_tools_launcher.js)');
  checkAndRepairFile('platform_utils.js', path.join(SKILLS_DB_DIR, 'platform_utils.js'), 'Platform Utils (platform_utils.js)');
  checkAndRepairFile('tools_savings_logger.js', path.join(SKILLS_DB_DIR, 'tools_savings_logger.js'), 'Tools Savings Logger (tools_savings_logger.js)');
  checkAndRepairFile('file_tools_launcher.sh', FILE_TOOLS_LAUNCHER_PATH, 'File Tools Launcher (file_tools_launcher.sh)');
  if (fileExists(FILE_TOOLS_LAUNCHER_PATH) && process.platform !== 'win32') {
    try {
      fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  deployUtils.writeNodeExecPathRecord();
  deployUtils.writePythonCmdRecord(checkPython());
  const srcJsDir = path.join(SRC_DIR, 'file_tools');
  if (fileExists(srcJsDir)) {
    try {
      ensureDir(FILE_TOOLS_PY_DIR);
      for (const entry of fs.readdirSync(srcJsDir)) {
        if (entry === '__pycache__' || !entry.endsWith('.js')) continue;
        const srcEntry = path.join(srcJsDir, entry);
        if (!fs.statSync(srcEntry).isFile()) continue;
        checkAndRepairFile(
          path.join('file_tools', entry),
          path.join(FILE_TOOLS_PY_DIR, entry),
          `File Tools JS (${entry})`
        );
      }
    } catch (e) {
      record('File Tools JS helpers', 'FAILED', e.message);
      hasErrors = true;
    }
  }
  const srcMcpDir = path.join(SRC_DIR, 'mcp');
  if (fileExists(srcMcpDir)) {
    try {
      const destMcpDir = path.join(SKILLS_DB_DIR, 'mcp');
      ensureDir(destMcpDir);
      for (const entry of fs.readdirSync(srcMcpDir)) {
        if (!entry.endsWith('.js')) continue;
        const srcEntry = path.join(srcMcpDir, entry);
        if (!fs.statSync(srcEntry).isFile()) continue;
        checkAndRepairFile(
          path.join('mcp', entry),
          path.join(destMcpDir, entry),
          `MCP Subsystem (${entry})`
        );
      }
    } catch (e) {
      record('MCP Subsystem files', 'FAILED', e.message);
      hasErrors = true;
    }
  }
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    try {
      installFileTools(true);
      if (fileExists(FILE_TOOLS_MCP_PATH)) {
        record('File Tools MCP (konoha)', 'REPAIRED', 'Installed konoha MCP server and Python helpers');
        repairsDone++;
      } else {
        record('File Tools MCP (konoha)', 'FAILED', 'file_tools_mcp.js missing after install');
        hasErrors = true;
      }
    } catch (e) {
      record('File Tools MCP (konoha)', 'FAILED', e.message);
      hasErrors = true;
    }
  }

  const fileToolsSmoke = smokeTestKonohaFilesMcp(true);
  if (fileToolsSmoke.ok) {
    record('konoha MCP smoke test', 'HEALTHY', `${fileToolsSmoke.toolCount} tools via launcher`);
  } else {
    const directSmoke = smokeTestKonohaFilesMcp(false);
    if (directSmoke.ok) {
      record('konoha MCP smoke test', 'WARNING', `Launcher failed (${fileToolsSmoke.error}); direct node OK (${directSmoke.toolCount} tools)`);
      try {
        installFileTools(true);
        const retry = smokeTestKonohaFilesMcp(true);
        if (retry.ok) {
          record('konoha launcher', 'REPAIRED', 'Launcher script refreshed');
          repairsDone++;
        }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    } else {
      record('konoha MCP smoke test', 'FAILED', directSmoke.error || fileToolsSmoke.error);
      hasErrors = true;
    }
  }

  // 6. Database File
  if (fileExists(DB_PATH)) {
    record('Database File (konoha.db)', 'HEALTHY', 'Database file is present');
  } else {
    // Try to run migration
    const safeTimeout = Number.isFinite(Number(MIGRATION_TIMEOUT_MS)) && Number(MIGRATION_TIMEOUT_MS) > 0
      ? Number(MIGRATION_TIMEOUT_MS)
      : 180000;
    const runMigrate = (args = [], silent = false) => {
      return spawnSync(process.execPath, [MIGRATE_PATH, ...args], {
        encoding: 'utf-8',
        cwd: SKILLS_DB_DIR,
        timeout: safeTimeout,
        stdio: silent ? 'pipe' : 'inherit'
      });
    };
    const skillsDirs = detectSkillsDirs();
    let migrationSuccess = false;

    if (skillsDirs.length > 0) {
      for (const s of skillsDirs) {
        const skills = detectCustomSkills(s.path);
        if (skills.length === 0) continue;

        try {
          const run = runMigrate(['--skills-dir', s.path, '--skills', ...skills], true);
          if (run.status === 0) migrationSuccess = true;
        } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }

    if (!migrationSuccess) {
      try {
        const runFallback = runMigrate([], true);
        if (runFallback.status === 0) migrationSuccess = true;
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }

    if (migrationSuccess && fileExists(DB_PATH)) {
      record('Database File (konoha.db)', 'REPAIRED', 'Re-created and indexed skills');
      repairsDone++;
    } else {
      record('Database File (konoha.db)', 'FAILED', 'Failed to create database via migration script');
      hasErrors = true;
    }
  }

  // 7. MCP Configuration
  const nodeCmd = process.execPath;
  const expectedSembleArgs = ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'];
  const expectedAislopArgs = ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  let mcpHealthy = false;
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      const servers = config.mcpServers || {};
      const sembleOk = servers['semble'] &&
        JSON.stringify(servers['semble'].args || []) === JSON.stringify(expectedSembleArgs);
      const aislopOk = servers['aislop'] &&
        JSON.stringify(servers['aislop'].args || []) === JSON.stringify(expectedAislopArgs);
      const konohaOk = servers['konoha'] &&
        servers['konoha'].args &&
        (servers['konoha'].args[0] === FILE_TOOLS_MCP_PATH || servers['konoha'].args[0] === path.join(HOME, '.konoha', 'file_tools_launcher.js')) &&
        (servers['konoha'].command === nodeCmd || servers['konoha'].command === 'node');
      mcpHealthy = sembleOk && konohaOk && aislopOk;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (mcpHealthy) {
    record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha, semble, and aislop are active');
  } else {
    try {
      registerMcp();
      record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha, semble, and aislop in config');
      repairsDone++;
    } catch (e) {
      record('MCP Config (mcp_config.json)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // 8. GEMINI Instructions
  let geminiHealthy = false;
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      if (content.includes('find_skill')) {
        geminiHealthy = true;
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  
  if (geminiHealthy) {
    record('GEMINI Instructions (GEMINI.md)', 'HEALTHY', 'Instructions are active');
  } else {
    try {
      updateGeminiMd();
      record('GEMINI Instructions (GEMINI.md)', 'REPAIRED', 'GEMINI.md instructions restored');
      repairsDone++;
    } catch (e) {
      record('GEMINI Instructions (GEMINI.md)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // 9. AGENTS Definition (agents.yaml)
  const USER_AGENTS_YAML_PATH = path.join(HOME, '.agents', 'agents.yaml');
  let agentsHealthy = false;
  if (fileExists(USER_AGENTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8');
      if (content.includes('name:') || content.includes('genin')) {
        agentsHealthy = true;
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  
  if (agentsHealthy) {
    record('AGENTS Definition (agents.yaml)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    try {
      agentManager.loadAgents();
      record('AGENTS Definition (agents.yaml)', 'REPAIRED', 'agents.yaml configurations restored');
      repairsDone++;
    } catch (e) {
      record('AGENTS Definition (agents.yaml)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // 9b. Prompt Hook Configuration (hooks.json)
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  let promptHookRegistered = false;
  let sanitizeHookRegistered = false;
  if (fileExists(HOOKS_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
      if (config['konoha-prompt-hook'] && config['konoha-prompt-hook'].PreInvocation) {
        const hooks = config['konoha-prompt-hook'].PreInvocation;
        const hasPrompt = hooks.some(hook => hook.command && hook.command.includes('prompt_hook.js'));
        const hasSubagent = hooks.some(hook => hook.command && hook.command.includes('antigravity_subagent_hook.js'));
        if (hasPrompt && hasSubagent) promptHookRegistered = true;
      }
      if (config['konoha-tool-sanitize'] && config['konoha-tool-sanitize'].PreToolUse) {
        const hasSanitize = config['konoha-tool-sanitize'].PreToolUse.some(
          (entry) => entry.hooks && entry.hooks.some((h) => h.command && h.command.includes('antigravity_tool_sanitize_hook.js'))
        );
        if (hasSanitize) sanitizeHookRegistered = true;
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (promptHookRegistered && sanitizeHookRegistered) {
    record('Prompt Hook Config (hooks.json)', 'HEALTHY', 'subagent + prompt + sanitize hooks registered');
  } else {
    let allowHooks = false;
    let loadFailed = false;
    const isNonInteractive = process.argv.includes('--yes') || process.argv.includes('-y') || process.env.CI === 'true';
    if (isNonInteractive) {
      allowHooks = true;
    } else {
      globalSpinner.stop();
      try {
        allowHooks = await confirmPrompt('Allow registering prompt-saver hook in ~/.gemini/config/hooks.json?', true);
      } catch (err) {
        loadFailed = true;
        record('Prompt Hook Config (hooks.json)', 'FAILED', `Prompt error: ${err.message}`);
        hasErrors = true;
      }
      globalSpinner.start('Running environment diagnostics...');
    }

    if (allowHooks) {
      try {
        registerHooks(true, true);
        record('Prompt Hook Config (hooks.json)', 'REPAIRED', 'Registered subagent + prompt hooks in hooks.json');
        repairsDone++;
      } catch (e) {
        record('Prompt Hook Config (hooks.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    } else if (!loadFailed) {
      record('Prompt Hook Config (hooks.json)', 'WARNING', 'Prompt hook is not registered (user declined)');
    }
  }

  const getClientRepairOptions = () => ({
    pythonCmd: checkPython() || 'python3',
    serverPath: SERVER_PATH,
    uvxCmd: getUvxCommand(),
    agents: agentManager.loadAgents(),
    projectRoot: currentCwd,
    deployProject: false,
    silent: true,
    allowHooks: true,
    ruleContent: null
  });

  // 9c. Cursor IDE/CLI Configuration (only when Cursor is installed)
  if (cursorManager.isCursorInstalled()) {
    const cursorStatus = cursorManager.getCursorStatus();
    const cursorHealthy = cursorStatus.mcpSkillsDb &&
      cursorStatus.mcpSemble &&
      cursorStatus.mcpKonoha;
    if (cursorHealthy) {
    record('Cursor IDE/CLI (~/.cursor/)', 'HEALTHY', 'MCP and hooks configured');
  } else {
    try {
      cursorManager.ensureCursorSetup(getClientRepairOptions());
      const repaired = cursorManager.getCursorStatus();
      if (repaired.mcpKonoha && repaired.mcpSemble) {
        record('Cursor IDE/CLI (~/.cursor/)', 'REPAIRED', 'Registered MCP and session hook');
        repairsDone++;
      } else {
        record('Cursor IDE/CLI (~/.cursor/)', 'WARNING', 'Partial Cursor setup — run konoha init');
      }
    } catch (e) {
      record('Cursor IDE/CLI (~/.cursor/)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }
  }

  // 9d. Claude Code Configuration (only when CLI installed)
  if (mcpClientsManager.isClaudeCodeInstalled()) {
    const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
    const claudeHealthy =
      claudeStatus.mcpKonoha &&
      claudeStatus.mcpSemble &&
      claudeStatus.mcpAislop &&
      claudeStatus.permissionsAllowed;
    if (claudeHealthy) {
      record('Claude Code (~/.claude.json)', 'HEALTHY', 'konoha, semble, and aislop active & allowed');
    } else {
      try {
        const python = checkPython() || 'python3';
        const agents = agentManager.loadAgents();
        const ruleContent = agentManager.generateClaudeCodeMd(agents);
        mcpClientsManager.ensureClaudeCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          ruleContent,
          silent: true
        });
        const repaired = mcpClientsManager.getClaudeCodeStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble && repaired.permissionsAllowed) {
          record('Claude Code (~/.claude.json)', 'REPAIRED', 'Registered Konoha MCP servers & allowed tools');
          repairsDone++;
        } else {
          record('Claude Code (~/.claude.json)', 'WARNING', 'Partial Claude Code setup — run konoha init');
        }
      } catch (e) {
        record('Claude Code (~/.claude.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9e. OpenCode Configuration
  if (opencodeManager.isOpenCodeInstalled()) {
    const openCodeStatus = opencodeManager.getOpenCodeStatus();
    const openCodeHealthy =
      openCodeStatus.mcpKonoha &&
      openCodeStatus.mcpSemble &&
      openCodeStatus.mcpAislop;
    if (openCodeHealthy) {
      record('OpenCode (~/.opencode/config.json)', 'HEALTHY', 'konoha, semble, and aislop active');
    } else {
      try {
        opencodeManager.ensureOpenCodeSetup(getClientRepairOptions());
        const repaired = opencodeManager.getOpenCodeStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble) {
          record('OpenCode (~/.opencode/config.json)', 'REPAIRED', 'Registered MCP and session hook');
          repairsDone++;
        } else {
          record('OpenCode (~/.opencode/config.json)', 'WARNING', 'Partial OpenCode setup — run konoha init');
        }
      } catch (e) {
        record('OpenCode (~/.opencode/config.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9f. Command Code Configuration
  if (mcpClientsManager.isCommandCodeInstalled()) {
    const cmdStatus = mcpClientsManager.getCommandCodeStatus();
    const cmdHealthy = cmdStatus.mcpKonoha && cmdStatus.mcpSemble && cmdStatus.mcpAislop;
    if (cmdHealthy) {
      record('Command Code (~/.commandcode/mcp.json)', 'HEALTHY', 'konoha, semble, and aislop active');
    } else {
      try {
        const python = checkPython() || 'python3';
        mcpClientsManager.ensureCommandCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
        const repaired = mcpClientsManager.getCommandCodeStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble) {
          record('Command Code (~/.commandcode/mcp.json)', 'REPAIRED', 'Registered Konoha MCP servers');
          repairsDone++;
        } else {
          record('Command Code (~/.commandcode/mcp.json)', 'WARNING', 'Partial Command Code setup — run konoha init');
        }
      } catch (e) {
        record('Command Code (~/.commandcode/mcp.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9g. Codex Configuration
  if (codexManager.isCodexInstalled()) {
    const codexStatus = codexManager.getCodexStatus();
    const codexHealthy = codexStatus.mcpKonoha && codexStatus.mcpSemble && codexStatus.mcpAislop;
    if (codexHealthy) {
      record('Codex (~/.codex/config.toml)', 'HEALTHY', 'konoha, semble, and aislop active');
    } else {
      try {
        const python = checkPython() || 'python3';
        codexManager.ensureCodexSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
        const repaired = codexManager.getCodexStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble) {
          record('Codex (~/.codex/config.toml)', 'REPAIRED', 'Registered Konoha MCP servers');
          repairsDone++;
        } else {
          record('Codex (~/.codex/config.toml)', 'WARNING', 'Partial Codex setup — run konoha init');
        }
      } catch (e) {
        record('Codex (~/.codex/config.toml)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9h. Pi (pi.dev) Configuration
  if (piManager.isPiInstalled()) {
    const piStatus = piManager.getPiStatus();
    const piHealthy = piStatus.mcpKonoha && piStatus.adapterInstalled && piStatus.contractDeployed && piStatus.blockerDeployed;
    if (piHealthy) {
      record('Pi pi.dev (~/.pi/agent/mcp.json)', 'HEALTHY', 'pi-mcp-adapter + konoha contract deployed; workflow routing active');
    } else {
      try {
        const python = checkPython() || 'python3';
        piManager.ensurePiSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
        const repaired = piManager.getPiStatus();
        if (repaired.mcpKonoha && repaired.adapterInstalled) {
          record('Pi pi.dev (~/.pi/agent/mcp.json)', 'REPAIRED', repaired.contractDeployed
            ? 'Registered Konoha MCP servers via pi-mcp-adapter; runtime contract deployed'
            : 'Registered Konoha MCP servers via pi-mcp-adapter');
          repairsDone++;
        } else {
          record('Pi pi.dev (~/.pi/agent/mcp.json)', 'WARNING', 'Partial Pi setup — run konoha init');
        }
      } catch (e) {
        record('Pi pi.dev (~/.pi/agent/mcp.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 10. agent-browser CLI check & auto-repair
  let agentBrowserCmd = getAgentBrowserCommand();
  let agentBrowserInstalled = !!agentBrowserCmd;
  let agentBrowserVersion = '';
  if (agentBrowserCmd) {
    try {
      const abVerRes = spawnSync(agentBrowserCmd, ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
      if (abVerRes.status === 0) {
        agentBrowserVersion = abVerRes.stdout.trim();
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (!agentBrowserInstalled) {
    try {
      const repaired = installAgentBrowser(true);
      agentBrowserCmd = getAgentBrowserCommand();
      if (repaired && agentBrowserCmd) {
        const abVerRes = spawnSync(agentBrowserCmd, ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
        const ver = abVerRes.status === 0 ? abVerRes.stdout.trim() : 'Installed';
        record('agent-browser CLI', 'REPAIRED', `Auto-installed ${ver}`);
        repairsDone++;
      } else {
        record('agent-browser CLI', 'WARNING', 'Missing agent-browser (run: pnpm add -g agent-browser && agent-browser install; on Linux add --with-deps; QA features unavailable)');
      }
    } catch {
      record('agent-browser CLI', 'WARNING', 'Missing agent-browser (run: pnpm add -g agent-browser && agent-browser install; QA features unavailable)');
    }
  } else {
    let chromeDetail = '';
    try {
      const docRes = spawnSync(agentBrowserCmd, ['doctor', '--offline', '--quick'], { encoding: 'utf-8', shell: process.platform === 'win32' });
      if (docRes.status === 0 && (docRes.stdout.includes('Google Chrome') || docRes.stdout.includes('Chromium'))) {
        chromeDetail = ' (Chrome ready)';
      }
    } catch { /* intentional best-effort fallback */ }
    record('agent-browser CLI', 'ACTIVE', `${agentBrowserVersion || 'Installed'}${chromeDetail}`);
  }

  // 11. SDLC Governance Layer Advisory Checks
  try {
    const dbModule = require('../../src/db');
    const conn = dbModule.getConnection(DB_PATH);
    try {
      dbModule.setupSchema(conn);
      // Check 1: Cross-provider review setup
      const enabledBridges = conn.prepare('SELECT count(*) as count FROM bridges WHERE enabled = 1').get();
      const bridgeCount = enabledBridges ? enabledBridges.count : 0;
      if (bridgeCount < 2) {
        record('Cross-Provider Review Setup', 'INFO', `${bridgeCount} bridge(s) enabled. Cross-provider review falls back to same-provider if configured.`);
      } else {
        record('Cross-Provider Review Setup', 'HEALTHY', `${bridgeCount} bridges enabled for independent second-opinion reviews`);
      }

      // Check 2: Anti-slop skill for Kage
      let hasAntislopInDb = false;
      try {
        const row = conn.prepare("SELECT 1 FROM skills WHERE name = 'antislop' OR name = 'kage-skill/antislop' OR name LIKE '%antislop%' LIMIT 1").get();
        hasAntislopInDb = !!row;
      } catch { /* intentional best-effort fallback */ }

      let kageSkills = '';
      try {
        const kageRow = conn.prepare("SELECT skills FROM agents WHERE name = 'kage'").get();
        kageSkills = (kageRow && kageRow.skills) ? kageRow.skills.toLowerCase() : '';
      } catch { /* intentional best-effort fallback */ }

      let hasAntislopSkill = kageSkills.includes('antislop') || kageSkills.includes('anti-slop') || kageSkills.includes('aislop') || (kageSkills.includes('kage-skill') && hasAntislopInDb);

      if (!hasAntislopSkill) {
        try {
          const agents = agentManager.loadAgents(true, true);
          const kage = agents.find(a => a.name === 'kage');
          if (kage) {
            if (!Array.isArray(kage.skills)) kage.skills = [];
            if (!kage.skills.includes('antislop')) kage.skills.push('antislop');
            agentManager.saveAgents(agents);
            const dbAgents = require('../../src/db_agents');
            dbAgents.bulkImportAgents(agents, DB_PATH);
            hasAntislopSkill = true;
            repairsDone++;
            record('Anti-Slop Gate (Kage)', 'REPAIRED', 'Restored and registered anti-slop skill for Kage reviewer');
          }
        } catch { /* intentional best-effort fallback */ }
      }

      if (hasAntislopSkill) {
        record('Anti-Slop Gate (Kage)', 'HEALTHY', 'Anti-slop skill loaded for Kage reviewer');
      } else {
        record('Anti-Slop Gate (Kage)', 'WARNING', 'anti-slop skill not installed for kage (falls back to core zero-slop checks)');
      }
    } finally {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  } catch (_) { /* intentional best-effort fallback */ }

  // 12. Konoha Web UI Daemon & Service Check
  try {
    const uiActive = await checkPortActive(1404);
    const svc = await getServiceStatus();
    if (uiActive) {
      record('Konoha Web UI (http://127.0.0.1:1404/)', 'HEALTHY', `Daemon is active${svc.installed ? ` (${svc.type} service ${svc.active ? 'active' : 'inactive'})` : ''}`);
    } else {
      record('Konoha Web UI (http://127.0.0.1:1404/)', 'WARNING', 'UI daemon not running (run: konoha ui start or konoha ui service install)');
    }
  } catch (_) { /* intentional best-effort fallback */ }

  // Complete diagnostic spinner
  globalSpinner.success('Diagnostic checks complete.');

  // Print results table
  const doctorHeaders = ['Requirement / Component', 'Status', 'Diagnostic Details'];
  const doctorRows = results.map((res) => [res.component, res.status, res.details]);
  const doctorWidths = computeTableWidths(doctorHeaders, doctorRows, {
    minWidths: [30, 10, 36],
    maxWidths: [50, 12, 64]
  });
  drawTable(doctorHeaders, doctorWidths, ['left', 'left', 'left'], doctorRows, [], CHIDORI_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.72)
    ]
  });
  log('');

  // Diagnostic Report Summary
  if (hasErrors) {
    const summaryLines = [
      `${applyGradient('✗ Diagnostic complete with errors.', [[239, 68, 68], [185, 28, 28]])}`,
      `${applyGradient('Please check the warnings and install instructions above.', FIRE_THEME, 0.85)}`,
      `${applyGradient('Repairs successfully performed: ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}`,
    ];
    drawBox('🩺 Doctor Summary', summaryLines, [[239, 68, 68], [185, 28, 28]]);
    process.exit(1);
  } else {
    const summaryLines = [
      `${applyGradient('✓ All diagnostic checks passed successfully!', LEAF_THEME)}`,
      `${applyGradient('Your Konoha environment is fully operational.', LEAF_THEME, 0.9)}`,
      repairsDone > 0
        ? `${applyGradient('Auto-repaired ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}${applyGradient(' component(s) successfully.', CHIDORI_THEME, 0.85)}`
        : `${applyGradient('No repairs were required.', CHIDORI_THEME, 0.8)}`
    ];
    drawBox('🩺 Doctor Summary', summaryLines, LEAF_THEME);
    log('');
    
    // If we repaired anything, trigger a self-test to confirm health
    if (repairsDone > 0) {
      info('Running self-test to verify repairs...');
      try {
        await cmdTest();
      } catch (testErr) {
        error(`Self-test failed after repairs: ${testErr.message}`);
        process.exit(1);
      }
    }
  }
}
module.exports = {
  cmdDoctor,
  cmdDoctorHelp,
};
