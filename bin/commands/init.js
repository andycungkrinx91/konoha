'use strict';

/**
 * bin/commands/init.js — Konoha MCP Servers & Subagent Initialization.
 *
 * Configures:
 * - Local SQLite vector/FTS database (~/.konoha/konoha.db)
 * - Auto-detects and configures:
 *   - Antigravity IDE & CLI
 *   - Cursor IDE
 *   - Claude Code
 *   - Command Code
 *   - OpenCode
 *   - Codex
 * - Global command reconciliation and PATH shims
 * - Konoha Bridge extension for Antigravity IDE
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  SERVER_PATH,
  DB_PATH,
  MIGRATE_PATH,
  MIGRATION_TIMEOUT_MS,
  MCP_CONFIG_PATH,
  DEFAULT_SKILLS_DIRS,
  SRC_DIR,
  FILE_TOOLS_LAUNCHER_JS
} = require('../lib/paths');

const {
  C,
  log,
  info,
  warn,
  error,
  success,
  header,
  drawLogo,
  LEAF_THEME,
  drawBox,
  getCliVersion
} = require('../lib/format');

const {
  confirmPrompt,
  startSpinner,
  fileExists,
  ensureDir,
  copyFile,
  checkPython
} = require('../lib/prompt');

const {
  purgePackageCaches,
  ensureCoreDirectories,
  syncTemplateSkills,
  registerMcp,
  registerHooks,
  reconcileGlobalCommand,
  installFileTools,
  detectSkillsDirs,
  detectCustomSkills,
  verifySkillDatabaseContract,
  copyIfDifferent,
  copyRecursive,
  hasCanonicalGeninSkill,
  hasCompleteDatabaseSchema,
  installCliRuntime
} = require('../lib/runtime');

const {
  installUv,
  getUvxCommand,
  installAgentBrowser,
  refreshSemblePackage
} = require('../lib/extension');

const agentManager = require('../../src/agent_manager');
const cursorManager = require('../../src/cursor_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const ompManager = require('../../src/omp_manager');
const antigravityManager = require('../../src/antigravity_manager');
const deployUtils = require('../../src/deploy_utils');
const { cmdBridgeStart, checkPortActive } = require('./bridge');
const { ensureUiDaemonAutoStart } = require('../lib/ui_commands');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (_) {
  if (process.env.PWD) {
    try {
      if (fs.existsSync(process.env.PWD)) currentCwd = process.env.PWD;
    } catch (_) { /* intentional best-effort fallback */ }
  }
}

function cmdInitHelp() {
  log(`
${C.cyan}konoha init${C.reset} — Initialize Konoha MCP servers, register subagents, and configure detected coding clients

${C.bold}USAGE${C.reset}
  konoha init [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--yes, -y${C.reset}       Automatic affirmative response to confirmation prompts (non-interactive).
  ${C.cyan}--force${C.reset}         Force clean re-installation and replace existing configuration.
  ${C.cyan}--python <path>${C.reset} Specify custom Python executable path.
  ${C.cyan}--silent${C.reset}        Run quietly with minimal output.

${C.bold}SUPPORTED CLIENTS AUTO-CONFIGURED${C.reset}
  - Antigravity IDE & CLI (~/.gemini/antigravity-cli/ & ~/.gemini/antigravity-ide/)
  - Cursor IDE (~/.cursor/mcp.json & .cursor/)
  - Claude Code (~/.claude.json & ~/.claude/agents/)
  - Command Code (~/.commandcode/mcp.json & ~/.commandcode/rules/)
  - OpenCode (~/.config/opencode/opencode.json)
  - Codex (~/.codex/config.toml)
  - Pi (~/.pi/agent/mcp.json)
  - OMP (~/.omp/agent/mcp.json & ~/.omp/agent/AGENTS.md)

${C.bold}EXAMPLES${C.reset}
  konoha init
  konoha init --yes
  konoha init --force
  konoha reinstall  # (implies --force)
`);
}


async function cmdInit(args, options = {}) {
  if (args.includes('help') || args.includes('--help') || args.includes('-h')) {
    cmdInitHelp();
    return;
  }
  if (args.includes('--force')) {
    purgePackageCaches({ silent: true });
  }
  syncTemplateSkills();
  drawLogo();

  header('🚀 Konoha Installer');
  log(`${C.dim}MCP Tools Orchestrator for Antigravity, Cursor, Claude Code, OpenCode, Command Code, and Codex${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  const isNonInteractive = args.includes('--yes') || args.includes('-y') || process.env.CI === 'true';
  const doInit = isNonInteractive ? true : await confirmPrompt('Initialize Konoha and modify ~/.gemini configurations?', true);
  if (!doInit) {
    warn('Initialization aborted.');
    return;
  }

  // Auto-configure all detected MCP clients without prompting.
  // Only the "Initialize Konoha?" consent prompt above is asked.
  // Skipped silently when the client is not detected.
  const allowAutoApprove = true;
  const allowHooks = true;
  const cursorInstalled = cursorManager.isCursorInstalled();
  const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
  const openCodeInstalled = opencodeManager.isOpenCodeInstalled();
  const commandCodeInstalled = mcpClientsManager.isCommandCodeInstalled();
  const codexInstalled = codexManager.isCodexInstalled();
  const piInstalled = piManager.isPiInstalled();
  const ompInstalled = ompManager.isOmpInstalled();
  const allowCursor = cursorInstalled;
  const allowClaudeCode = claudeInstalled;
  // 1. Ensure the directories exist
  ensureCoreDirectories();

  if (options.onProgress) options.onProgress(1, 'Dependencies', 'Checking Node.js environment...');
  // 2. Check Node.js
  const spinner1 = startSpinner('Checking Node.js environment...');
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    spinner1.error(`Node.js >= 18 is required, found ${nodeVersion}`);
    log('  Install from: https://nodejs.org/');
    process.exit(1);
  }
  spinner1.success(`Node.js found: ${nodeVersion} (${process.execPath})`);

  // 2b. Ensure uv is installed (dependency for semble and uvx-based MCP tools)
  const spinner1b = startSpinner('Checking uv (Python package manager)...');
  let uvInstalled = installUv(false);
  if (!uvInstalled) {
    try {
      execSync('uv --version', { stdio: 'ignore' });
      uvInstalled = true;
      spinner1b.success('uv is available on PATH.');
    } catch (err) {
      spinner1b.warn(`uv not found (${err.message || 'not on PATH'}) — semble MCP will install lazily on first use.`);
    }
  } else {
    spinner1b.success('uv installed successfully.');
  }

  // 2c. Ensure agent-browser is available (for web inspection & design match comparison)
  const spinner1c = startSpinner('Checking agent-browser CLI...');
  let abInstalled = installAgentBrowser(true);
  if (!abInstalled) {
    abInstalled = installAgentBrowser(false);
  }
  if (abInstalled) {
    spinner1c.success('agent-browser CLI is ready.');
  } else {
    spinner1c.warn('agent-browser not found — optional for browser automation.');
  }

  if (args.includes('--force')) {
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }

  const python = checkPython() || 'node';

  // 3. Check for existing installation
  if (fileExists(SERVER_PATH) && hasCompleteDatabaseSchema(python)) {
    warn('Konoha MCP already installed.');
    info(`Database: ${DB_PATH}`);
    info(`Server:   ${SERVER_PATH}`);
    log('');
    info('Use "konoha migrate" to re-index skills.');
    info('Use "konoha status" to check status.');

    if (!args.includes('--force')) {
      log(`\n${C.dim}Run with --force to reinstall.${C.reset}`);
      const refreshFiles = ['server.js', 'vector_search.js', 'db.js', 'migrate.js', 'canonical_skills.js', 'db_stats.js', 'db_savings.js', 'db_bridges.js', 'agent_stats.js', 'tools_savings_logger.js', 'circuit_breaker.js', 'persona_memory.js', 'yaml_utils.js', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'hook-base.js', 'guardrails.js', 'antigravity_manager.js', 'agent_contract.js', 'cursor_bootstrap.js', 'ai_detector.js', 'docs_ai_detector.js', 'web_server.js', 'sdlc_manager.js', 'mcp_tool_manifest.json'];
      refreshFiles.forEach(f => {
        const src = path.join(SRC_DIR, f);
        const dest = path.join(SKILLS_DB_DIR, f);
        if (fileExists(src)) copyIfDifferent(src, dest);
      });
      installFileTools(true);
      installCliRuntime();
      try {
        const bridge1313Active = await checkPortActive(1313);
        const bridge19999Active = await checkPortActive(19999);
        if (!bridge1313Active || !bridge19999Active) {
          await cmdBridgeStart();
        }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      registerMcp(python, true, allowAutoApprove);
      registerHooks(true, allowHooks);
      const agentsForSetup = agentManager.loadAgents();
      if (allowCursor) {
        cursorManager.ensureCursorSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          agents: agentsForSetup,
          projectRoot: currentCwd,
          deployProject: true,
          silent: true,
          allowHooks: false,
          ruleContent: null
        });
        cursorManager.registerCursorProjectMcp(currentCwd, python, SERVER_PATH, getUvxCommand(), true);
      }
      if (allowClaudeCode) {
        mcpClientsManager.ensureClaudeCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          ruleContent: agentManager.generateClaudeCodeMd(agentsForSetup),
          silent: true,
          agents: agentsForSetup,
          projectRoot: currentCwd,
          deployProject: true
        });
      }
      if (openCodeInstalled) {
        opencodeManager.ensureOpenCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      if (commandCodeInstalled) {
        mcpClientsManager.ensureCommandCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      if (codexInstalled) {
        codexManager.ensureCodexSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      if (piInstalled) {
        piManager.ensurePiSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      if (ompInstalled) {
        ompManager.ensureOmpSetup({
          nodeCmd: process.execPath,
          launcherPath: FILE_TOOLS_LAUNCHER_JS,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      success('Integrations refreshed.');
      // Auto-start the Web UI daemon on the refresh path too: on a real fresh
      // install, ensureAutoSetup has already deployed the runtime before
      // cmdInit runs, so THIS path (not the full-install summary below) is
      // the one a first `konoha init` actually takes.
      if (!options.skipUiAutoStart) {
        try {
          const uiAuto = await ensureUiDaemonAutoStart();
          if (uiAuto && uiAuto.started) {
            info(`${C.bold}Konoha Web UI daemon auto-started:${C.reset} ${C.cyan}http://127.0.0.1:1404/${C.reset} ${C.dim}(KONOHA_UI_AUTOSTART=0 disables)${C.reset}`);
          }
        } catch { /* intentional best-effort fallback: failure here must never crash the installer */ }
      }
      return;
    }
    warn('Reinstalling (--force)...');
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }

  // 3. Detect skills directories
  const pkgSkillsDir = path.resolve(__dirname, '..', '..', '.agents', 'skills');
  if (!hasCanonicalGeninSkill(pkgSkillsDir)) {
    error(`Packaged canonical skill missing: ${path.join(pkgSkillsDir, 'genin-skill', 'SKILL.md')}`);
    process.exit(1);
  }
  const spinner2 = startSpinner('Detecting skills directories...');
  const skillsDirs = detectSkillsDirs();

  if (skillsDirs.length === 0) {
    spinner2.warn('No skills directories found with SKILL.md files.');
    info('Expected locations:');
    DEFAULT_SKILLS_DIRS.forEach(d => info(`  ${d}`));
    log('');
    info('You can still install the server and migrate manually later.');
    info('Use: konoha migrate --skills-dir /path/to/skills');
  } else {
    spinner2.success(`Detected ${skillsDirs.length} skills directories.`);
    skillsDirs.forEach(s => {
      success(`Found: ${s.path} (${s.count} skills)`);
    });
  }

  // 4. Install server files
  if (options.onProgress) options.onProgress(2, 'MCP Runtime', 'Installing MCP Server files to ~/.konoha/');
  header('📦 Installing MCP Server');

  if (args.includes('--force')) {
    const cleanSpinner = startSpinner('Cleaning stale runtime files from ~/.konoha/...');
    const cleanResult = deployUtils.cleanKonohaRuntimeDir({
      silent: true,
      vacuumDatabase: true,
    });
    if (cleanResult.purgedFiles > 0) {
      const mb = (cleanResult.reclaimedBytes / (1024 * 1024)).toFixed(2);
      cleanSpinner.success(`Cleaned ${cleanResult.purgedFiles} stale files (${mb} MB reclaimed) from ~/.konoha/`);
    } else {
      cleanSpinner.success('~/.konoha/ runtime is clean.');
    }
  }

  const spinner3 = startSpinner('Installing MCP Server files...');
  ensureDir(SKILLS_DB_DIR);

  // Copy basic subagent skills to global directory
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir)) {
    ensureDir(globalSkillsDir);
    try {
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        if (name === '.' || name === '..') return;
        const srcPath = path.join(pkgSkillsDir, name);
        const destPath = path.join(globalSkillsDir, name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
          copyFile(srcPath, destPath);
        }
      });
    } catch (_) {
      // ignore
    }
  }

  for (const jsFile of [
    'db.js', 'vector_search.js', 'server.js', 'migrate.js', 'canonical_skills.js',
    'db_stats.js', 'db_savings.js', 'db_bridges.js', 'agent_stats.js',
    'tools_savings_logger.js', 'circuit_breaker.js', 'persona_memory.js', 'yaml_utils.js'
  ]) {
    const s = path.join(SRC_DIR, jsFile);
    if (fileExists(s)) copyFile(s, path.join(SKILLS_DB_DIR, jsFile));
  }

  const pkgSrc = path.resolve(__dirname, '..', '..', 'package.json');
  const pkgDest = path.join(SKILLS_DB_DIR, 'package.json');
  if (fileExists(pkgSrc)) {
    copyFile(pkgSrc, pkgDest);
  }

  const promptHookSrc = path.join(SRC_DIR, 'prompt_hook.js');
  const promptHookDest = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  if (fileExists(promptHookSrc)) {
    copyFile(promptHookSrc, promptHookDest);
  }

  const reminderSrc = path.join(SRC_DIR, 'workflow_reminder.js');
  const reminderDest = path.join(SKILLS_DB_DIR, 'workflow_reminder.js');
  if (fileExists(reminderSrc)) {
    copyFile(reminderSrc, reminderDest);
  }

  const subagentHookSrc = path.join(SRC_DIR, 'antigravity_subagent_hook.js');
  const subagentHookDest = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  if (fileExists(subagentHookSrc)) {
    copyFile(subagentHookSrc, subagentHookDest);
  }

  const antigravityManagerSrc = path.join(SRC_DIR, 'antigravity_manager.js');
  const antigravityManagerDest = path.join(SKILLS_DB_DIR, 'antigravity_manager.js');
  if (fileExists(antigravityManagerSrc)) {
    copyFile(antigravityManagerSrc, antigravityManagerDest);
  }
  const agentContractSrc = path.join(SRC_DIR, 'agent_contract.js');
  const agentContractDest = path.join(SKILLS_DB_DIR, 'agent_contract.js');
  if (fileExists(agentContractSrc)) {
    copyFile(agentContractSrc, agentContractDest);
  }

  const sanitizeHookSrc = path.join(SRC_DIR, 'antigravity_tool_sanitize_hook.js');
  const sanitizeHookDest = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  if (fileExists(sanitizeHookSrc)) {
    copyFile(sanitizeHookSrc, sanitizeHookDest);
  }

  const hookBaseSrc = path.join(SRC_DIR, 'hook-base.js');
  const hookBaseDest = path.join(SKILLS_DB_DIR, 'hook-base.js');
  if (fileExists(hookBaseSrc)) {
    copyFile(hookBaseSrc, hookBaseDest);
  }

  const guardrailsSrc = path.join(SRC_DIR, 'guardrails.js');
  const guardrailsDest = path.join(SKILLS_DB_DIR, 'guardrails.js');
  if (fileExists(guardrailsSrc)) {
    copyFile(guardrailsSrc, guardrailsDest);
  }

  const cursorBootstrapSrc = path.join(SRC_DIR, 'cursor_bootstrap.js');
  const cursorBootstrapDest = path.join(SKILLS_DB_DIR, 'cursor_bootstrap.js');
  if (fileExists(cursorBootstrapSrc)) {
    copyFile(cursorBootstrapSrc, cursorBootstrapDest);
  }
  installFileTools(true);

  // Install the self-contained CLI runtime, then make the global `konoha`
  // command always resolve to ~/.konoha/bin/cli.js (all platforms, all
  // package managers — repairs stale npm/pnpm/yarn shims in place)
  installCliRuntime();
  const shimReport = reconcileGlobalCommand();
  const shimsTouched = [...new Set([...shimReport.updated, ...shimReport.created])];
  if (shimsTouched.length > 0) {
    success(`Global command 'konoha' → ${shimReport.sourceCli}`);
    shimsTouched.forEach(s => log(`    ↳ shim: ${s}`));
  } else if (shimReport.ok.length > 0) {
    info(`Global command 'konoha' already points to ${shimReport.sourceCli}`);
  }
  for (const failure of shimReport.failed) {
    warn(`Could not update shim ${failure.path}: ${failure.error}`);
  }

  spinner3.success('All files installed to ~/.konoha/');

  // 5. Run migration and always initialize the complete SQLite schema.
  if (options.onProgress) options.onProgress(3, 'Skills Index', 'Seeding subagent skills into SQLite FTS5 database');
  header('📊 Seeding Default Subagent Skills to SQLite FTS5');
  const skills = fileExists(pkgSkillsDir) ? detectCustomSkills(pkgSkillsDir) : [];
  const spinnerMigrate = startSpinner(skills.length > 0 ? `Seeding skills & pre-caching neural models from: ${pkgSkillsDir}...` : 'Initializing skills database schema...');
  const isClean = args.includes('--clean');
  const migrationArgs = skills.length > 0
    ? ['--skills-dir', pkgSkillsDir, '--skills', ...skills, '--require-skill', 'genin-skill']
    : ['--require-skill', 'genin-skill'];
  if (isClean) {
    migrationArgs.unshift('--clean');
  }
  process.env.KONOHA_SEMANTIC_SEARCH = process.env.KONOHA_SEMANTIC_SEARCH || '1';
  if (args.includes('--skip-embeddings')) {
    migrationArgs.push('--skip-embeddings');
  }
  if (args.includes('--rebuild-embeddings')) {
    migrationArgs.push('--rebuild-embeddings');
  }
  const safeTimeoutMs = Number.isFinite(Number(MIGRATION_TIMEOUT_MS)) && Number(MIGRATION_TIMEOUT_MS) > 0
    ? Number(MIGRATION_TIMEOUT_MS)
    : 180000;
  const runMigrate = (extraArgs, timeoutMs) => spawnSync(process.execPath, [MIGRATE_PATH, ...migrationArgs, ...extraArgs], {
    encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : safeTimeoutMs
  });
  let run = runMigrate([], safeTimeoutMs);
  if (run.status !== 0) {
    // Retry without neural embedding generation
    run = runMigrate(['--skip-embeddings'], safeTimeoutMs);
  }
  if (run.status !== 0) {
    // Final fallback: seed skills only, defer references to a later `konoha migrate`
    const skillsOnlyArgs = migrationArgs.filter(a => a !== '--skip-embeddings');
    run = spawnSync(process.execPath, [MIGRATE_PATH, ...skillsOnlyArgs, '--skills-only', '--skip-embeddings'], {
      encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 120000
    });
    if (run.status === 0) {
      warn('Reference indexing deferred — run "konoha migrate" to complete remaining references.');
    }
  }
  if (run.status !== 0) {
    const detail = run.error ? run.error.message : (run.stderr || run.stdout || 'Migration failed');
    spinnerMigrate.error(`Failed to initialize skills database: ${detail}`);
    process.exit(1);
  }
  const skillContract = verifySkillDatabaseContract(python);
  if (!skillContract.ok) {
    spinnerMigrate.error(`Skill database contract failed: ${skillContract.reason}`);
    process.exit(1);
  }
  spinnerMigrate.success(skills.length > 0 ? 'Default subagent skills seeded successfully.' : 'Empty skills database schema initialized.');
  // Index pre-existing user skills from detected directories so old skills are preserved in SQLite
  if (Array.isArray(skillsDirs)) {
    for (const sDir of skillsDirs) {
      if (sDir.path && sDir.path !== pkgSkillsDir && fileExists(sDir.path)) {
        try {
          spawnSync(process.execPath, [MIGRATE_PATH, '--skills-dir', sDir.path, '--skip-embeddings'], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 60000
          });
        } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  }
  try {
    if (!hasCompleteDatabaseSchema()) throw new Error('required SQLite schema is incomplete');
  } catch (schemaError) {
    error(`SQLite schema verification failed: ${schemaError.message}`);
    process.exit(1);
  }

  // 6. Register MCP config
  header('⚙️  Registering MCP Server');
  const spinner4 = startSpinner('Registering in ~/.gemini/config/mcp_config.json...');
  registerMcp(python, true, allowAutoApprove);
  spinner4.success('konoha registered in MCP config.');

  // Register Hooks config
  header('🔗 Registering Hooks');
  const spinnerHook = startSpinner(allowHooks ? 'Registering prompt hook in ~/.gemini/config/hooks.json...' : 'Removing prompt hook from ~/.gemini/config/hooks.json...');
  registerHooks(false, allowHooks);
  spinnerHook.success(allowHooks ? 'prompt_hook registered in hooks.json.' : 'prompt_hook removed/unregistered from hooks.json.');

  // 7. Update agents.yaml
  header('👥 Updating agents.yaml');
  const spinner5 = startSpinner('Adding on-demand skills usage rules...');
  agentManager.loadAgents(); // Silently updates YAML/DB
  agentManager.regenerateAndDeploy({ force: true, silent: true });
  spinner5.success('agents.yaml updated.');

  // 8. Install and deploy RTK rules when the toolchain is available
  const rtkSpinner = startSpinner('Checking RTK (Rust Token Killer)...');
  const _rtkInstall = args.includes('--force')
    ? antigravityManager.refreshRtk(false)
    : antigravityManager.ensureRtkInstalled(false);
  const rtkResult = antigravityManager.deployAntigravityRtkRule(true);
  if (rtkResult.ok) {
    rtkSpinner.success(`RTK rules deployed to ${rtkResult.deployed} Antigravity location(s).`);
  } else if (rtkResult.reason === 'rtk-not-installed') {
    rtkSpinner.warn('RTK could not be installed automatically (needs cargo, or network for the official install script). Manual: cargo install --git https://github.com/rtk-ai/rtk');
  } else {
    rtkSpinner.warn(`RTK rule deployment skipped: ${rtkResult.reason}`);
  }

  // 10. Configure Cursor IDE/CLI
  const setupAgents = agentManager.loadAgents();
  if (options.onProgress) options.onProgress(4, 'MCP Clients', 'Configuring Cursor, Claude Code, OpenCode, Command Code, Codex');
  if (allowCursor) {
    header('🖱️  Configuring Cursor IDE/CLI');
    const spinner7 = startSpinner('Registering Cursor MCP, subagents, and permissions...');
    const uvxCmd = getUvxCommand();
    const cursorSetup = cursorManager.ensureCursorSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      agents: setupAgents,
      projectRoot: currentCwd,
      deployProject: true,
      silent: true,
      allowHooks: false,
      ruleContent: null
    });
    cursorManager.registerCursorProjectMcp(currentCwd, python, SERVER_PATH, uvxCmd, true);
    if (cursorSetup.ok) spinner7.success('Cursor IDE/CLI configured.');
    else spinner7.warn(`Cursor setup skipped: ${cursorSetup.reason || 'unknown error'}`);
  }

  // 10b. Configure Claude Code (when CLI detected)
  if (allowClaudeCode) {
    header('🤖 Configuring Claude Code');
    const spinnerClaude = startSpinner('Registering Claude Code MCP servers...');
    const uvxCmd = getUvxCommand();
    const claudeSetup = mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      ruleContent: agentManager.generateClaudeCodeMd(setupAgents),
      silent: true,
      agents: setupAgents,
      projectRoot: currentCwd,
      deployProject: true
    });
    if (claudeSetup.ok) spinnerClaude.success('Claude Code MCP configured.');
    else spinnerClaude.warn(`Claude Code setup skipped: ${claudeSetup.reason || 'unknown error'}`);
  } else if (!claudeInstalled) {
    info('Claude Code not detected — skip auto-setup (see docs/templates/claude-code.mcp.json if you install later).');
  }

  if (openCodeInstalled) {
    header('🟢 Configuring OpenCode');
    const spinnerOpenCode = startSpinner('Registering OpenCode MCP servers and RTK rules...');
    const openCodeSetup = opencodeManager.ensureOpenCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (openCodeSetup.ok) spinnerOpenCode.success('OpenCode MCP and RTK configured.');
    else spinnerOpenCode.warn(`OpenCode setup skipped: ${openCodeSetup.reason || 'unknown error'}`);
  }

  if (commandCodeInstalled) {
    header('⚡ Configuring Command Code');
    const spinnerCommandCode = startSpinner('Registering Command Code MCP servers and RTK rules...');
    const commandCodeSetup = mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (commandCodeSetup.ok) spinnerCommandCode.success('Command Code MCP and RTK configured.');
    else spinnerCommandCode.warn(`Command Code setup skipped: ${commandCodeSetup.reason || 'unknown error'}`);
  }

  if (codexInstalled) {
    header('🤖 Configuring Codex');
    const spinnerCodex = startSpinner('Registering Codex MCP servers and RTK rules...');
    const codexSetup = codexManager.ensureCodexSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (codexSetup.ok) spinnerCodex.success('Codex MCP and RTK configured.');
    else spinnerCodex.warn(`Codex setup skipped: ${codexSetup.reason || 'unknown error'}`);
  }

  if (piInstalled) {
    header('🥧 Configuring Pi (pi.dev)');
    const spinnerPi = startSpinner('Registering Pi MCP servers via pi-mcp-adapter...');
    const piSetup = piManager.ensurePiSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (piSetup.ok) spinnerPi.success('Pi (pi.dev) MCP configured.');
    else spinnerPi.warn(`Pi setup skipped: ${piSetup.reason || 'unknown error'}`);
  }

  if (ompInstalled) {
    header('⚡ Configuring OMP');
    const spinnerOmp = startSpinner('Registering OMP MCP servers and workflow contract...');
    const ompSetup = ompManager.ensureOmpSetup({
      nodeCmd: process.execPath,
      launcherPath: FILE_TOOLS_LAUNCHER_JS,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (ompSetup.ok) spinnerOmp.success('OMP MCP and contract configured.');
    else spinnerOmp.warn(`OMP setup skipped: ${ompSetup.reason || 'unknown error'}`);
  }

  // 11. Summary
  header('✅ Installation Complete!');

  // Per-client auto-config summary
  const ok = `${C.green}✓${C.reset}`;
  const skip = `${C.dim}✗${C.reset}`;
  const summaryLines = [
    `Auto-configured clients:`,
    `${ok} Antigravity   ${C.dim}~/.gemini/config/mcp_config.json + hooks${C.reset}`,
    allowCursor
       ? `${ok} Cursor        ${C.dim}~/.cursor/mcp.json + subagents${C.reset}`
      : `${skip} Cursor        ${C.dim}(not installed)${C.reset}`,
    claudeInstalled
      ? `${ok} Claude Code   ${C.dim}~/.claude.json + RTK${C.reset}`
      : `${skip} Claude Code   ${C.dim}(not installed)${C.reset}`,
    openCodeInstalled
       ? `${ok} OpenCode     ${C.dim}~/.config/opencode/opencode.json + RTK rule${C.reset}`
      : `${skip} OpenCode     ${C.dim}(not installed)${C.reset}`,
    commandCodeInstalled
      ? `${ok} Command Code ${C.dim}~/.commandcode/mcp.json + RTK${C.reset}`
      : `${skip} Command Code ${C.dim}(not installed)${C.reset}`,
    codexInstalled
      ? `${ok} Codex        ${C.dim}~/.codex/config.toml + RTK${C.reset}`
      : `${skip} Codex        ${C.dim}(not installed)${C.reset}`,
    piInstalled
      ? `${ok} Pi (pi.dev)  ${C.dim}~/.pi/agent/mcp.json + pi-mcp-adapter${C.reset}`
      : `${skip} Pi (pi.dev)  ${C.dim}(not installed)${C.reset}`,
    ompInstalled
      ? `${ok} OMP          ${C.dim}~/.omp/agent/mcp.json + contract${C.reset}`
      : `${skip} OMP          ${C.dim}(not installed)${C.reset}`,
    '─',
    `Installed files:`,
    `Version:     ${C.green}v${getCliVersion()}${C.reset}`,
    `Server:     ${C.dim}${SERVER_PATH}${C.reset}`,
    `Migration:  ${C.dim}${MIGRATE_PATH}${C.reset}`,
    `Database:   ${C.dim}${DB_PATH}${C.reset}`,
    `MCP Config: ${C.dim}${MCP_CONFIG_PATH}${C.reset}`,
    `Agents YAML: ${C.dim}${path.join(HOME, '.agents', 'agents.yaml')}${C.reset}`,
    `Cursor MCP: ${C.dim}${cursorManager.CURSOR_MCP_GLOBAL}${C.reset}`,
    `Cursor Agents: ${C.dim}${cursorManager.CURSOR_AGENTS_GLOBAL}${C.reset}`,
  ];
  drawBox('Installed Files', summaryLines, LEAF_THEME);
  log('');

  // Auto-run Konoha Bridge service in background so http://localhost:1313/v1/models is immediately live
  try {
    const bridge1313Active = await checkPortActive(1313);
    const bridge19999Active = await checkPortActive(19999);
    if (!bridge1313Active || !bridge19999Active) {
      await cmdBridgeStart();
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Auto-start the Konoha Web UI daemon in the background so
  // http://127.0.0.1:1404/ is live immediately after install/upgrade.
  // Cross-platform (detached spawn via process.execPath, no shell needed).
  // Opt out with KONOHA_UI_AUTOSTART=0. Skipped when the caller (e.g.
  // cmdUpgrade) manages the daemon lifecycle itself.
  if (!options.skipUiAutoStart) {
    try {
      const uiAuto = await ensureUiDaemonAutoStart();
      if (uiAuto && uiAuto.started) {
        info(`${C.bold}Konoha Web UI daemon auto-started:${C.reset} ${C.cyan}http://127.0.0.1:1404/${C.reset} ${C.dim}(KONOHA_UI_AUTOSTART=0 disables)${C.reset}`);
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the installer */ }
  }

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Re-index & embed: ${C.cyan}konoha embed${C.reset} ${C.dim}(or: konoha migrate --clean --rebuild-embeddings)${C.reset}`);
  log(`  2. Restart IDE/CLI:  Restart Antigravity, Cursor${claudeInstalled ? ', Claude Code' : ''}${openCodeInstalled ? ', OpenCode' : ''}${commandCodeInstalled ? ', Command Code' : ''}${codexInstalled ? ', Codex' : ''} to load MCP servers`);
  log(`  3. Test execution:   ${C.cyan}konoha test${C.reset}`);
  log(`  4. Check status:     ${C.cyan}konoha status${C.reset}`);
  log(`  5. Web UI:           ${C.cyan}http://127.0.0.1:1404/${C.reset} ${C.dim}(auto-started; konoha ui stop|restart)${C.reset}`);
  log('');
}


module.exports = {
  cmdInit,
  cmdInitHelp,
};
