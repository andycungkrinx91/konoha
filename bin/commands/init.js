'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const agentManager = require('../../src/agent_manager');
const cursorManager = require('../../src/cursor_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const ompManager = require('../../src/omp_manager');
const antigravityManager = require('../../src/antigravity_manager');
const deployUtils = require('../../src/deploy_utils');
const { installFileTools } = require('../../src/deploy_installer');
const {
  HOME,
  SRC_DIR,
  SKILLS_DB_DIR,
  SERVER_PATH
} = require('../lib/paths');
const { fileExists, ensureDir } = require('../../src/platform_utils');
const {
  C,
  header,
  log,
  info,
  success,
  warn,
  error,
  drawLogo
} = require('../lib/format');
const { confirmPrompt, checkPython, startSpinner } = require('../lib/prompt');
const {
  ensureCoreDirectories,
  registerMcp,
  registerHooks
} = require('../lib/runtime_mcp');
const {
  hasCompleteDatabaseSchema,
  detectSkillsDirs,
  hasCanonicalGeninSkill,
  syncTemplateSkills
} = require('../lib/runtime_lifecycle');
const {
  installCliRuntime,
  copyIfDifferent
} = require('../lib/runtime_install');
const { purgePackageCaches } = require('../lib/runtime_mcp');
const {
  installUv,
  installAgentBrowser,
  refreshSemblePackage
} = require('../lib/extension');
const { checkPortActive, ensureUiDaemonAutoStart } = require('../lib/ui_commands');
const { cmdBridgeStart } = require('./bridge');
const { parseRequestedClients, setupClientIntegrations } = require('./init_clients');
const { executeInitMigration, renderInitSummary } = require('./init_migration');

function cmdInitHelp() {
  header('Konoha Installer Help');
  log(`
  Usage: konoha init [options]

  Initializes the Konoha environment:
  1. Checks requirements (Node.js >= 18, uv for Python tools).
  2. Creates ~/.konoha directory structure.
  3. Copies runtime and migration files.
  4. Discovers skills directories (~/.agents/skills).
  5. Seeds canonical subagent skills into SQLite (~/.konoha/konoha.db).
  6. Registers Konoha & Semble MCP tools with your AI coding assistants.
  7. Configures multi-agent team rules (Antigravity, Cursor, Claude Code, OpenCode, Codex, Pi, OMP).

  Options:
    -h, --help               Show this help message
    -y, --yes                Auto-approve all confirmation prompts (non-interactive)
    --force                  Reinstall and overwrite existing configuration
    --client=<name>          Configure specific client only (cursor, claude, opencode, commandcode, codex, pi, omp, all)
  `);
}

function recordAutoSetupState() {
  const marker = path.join(HOME, '.konoha', '.autosetup-done');
  try {
    ensureDir(path.dirname(marker));
    fs.writeFileSync(marker, `${Date.now()}\n`);
  } catch { /* best-effort */ }
}

function checkNodeAndToolchains(options, args) {
  if (options.onProgress) options.onProgress(1, 'Dependencies', 'Checking Node.js environment...');
  const spinner1 = startSpinner('Checking Node.js environment...');
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    spinner1.error(`Node.js >= 18 is required, found ${nodeVersion}`);
    log('  Install from: https://nodejs.org/');
    process.exit(1);
  }
  spinner1.success(`Node.js found: ${nodeVersion} (${process.execPath})`);

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

  const spinner1c = startSpinner('Checking agent-browser CLI...');
  let abInstalled = installAgentBrowser(true);
  if (!abInstalled) abInstalled = installAgentBrowser(false);
  if (abInstalled) spinner1c.success('agent-browser CLI is ready.');
  else spinner1c.warn('agent-browser not found — optional for browser automation.');

  if (args.includes('--force')) {
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }
}

async function autoStartUiDaemonIfRequested(options) {
  if (options.skipUiAutoStart) return;
  try {
    const uiAuto = await ensureUiDaemonAutoStart();
    if (uiAuto?.started) {
      info(`${C.bold}Konoha Web UI daemon auto-started:${C.reset} ${C.cyan}http://127.0.0.1:1404/${C.reset}`);
    }
  } catch { /* intentional fallback */ }
}

async function refreshExistingInstallation(flags, options) {
  const refreshFiles = ['server.js', 'vector_search.js', 'db.js', 'migrate.js', 'canonical_skills.js', 'db_stats.js', 'db_savings.js', 'db_bridges.js', 'agent_stats.js', 'tools_savings_logger.js', 'circuit_breaker.js', 'persona_memory.js', 'yaml_utils.js', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'hook-base.js', 'guardrails.js', 'antigravity_manager.js', 'agent_contract.js', 'cursor_bootstrap.js', 'ai_detector.js', 'docs_ai_detector.js', 'web_server.js', 'sdlc_manager.js', 'mcp_tool_manifest.json'];
  refreshFiles.forEach(f => {
    const src = path.join(SRC_DIR, f);
    const dest = path.join(SKILLS_DB_DIR, f);
    if (fileExists(src)) copyIfDifferent(src, dest);
  });
  copyIfDifferent(path.join(SRC_DIR, 'workflow', 'sannin-orchestrator', 'workflow_reminder.js'), path.join(SKILLS_DB_DIR, 'workflow_reminder.js'));
  installFileTools(true);
  installCliRuntime();

  try {
    const bridge1313Active = await checkPortActive(1313);
    const bridge19999Active = await checkPortActive(19999);
    if (!bridge1313Active || !bridge19999Active) await cmdBridgeStart();
  } catch { /* intentional fallback */ }

  registerMcp(flags.python, true, true);
  registerHooks(true, true);
  try {
    deployUtils.syncSoulAcrossClients({ silent: true });
  } catch (_) { /* intentional fallback */ }
  const setupAgents = agentManager.loadAgents();
  const currentCwd = path.resolve(process.cwd());

  setupClientIntegrations({
    ...flags,
    setupAgents,
    currentCwd,
    onProgress: options.onProgress
  });

  try {
    agentManager.deployProjectWorkspace(currentCwd, { silent: true, force: true });
  } catch (_) { /* intentional fallback */ }
  success('Integrations refreshed.');

  await autoStartUiDaemonIfRequested(options);
  recordAutoSetupState();
}

function cleanStaleFilesIfForced(args) {
  if (!args.includes('--force')) return;
  const cleanSpinner = startSpinner('Cleaning stale runtime files from ~/.konoha/...');
  const cleanResult = deployUtils.cleanKonohaRuntimeDir({ silent: true, vacuumDatabase: true });
  if (cleanResult.purgedFiles > 0) {
    const mb = (cleanResult.reclaimedBytes / (1024 * 1024)).toFixed(2);
    cleanSpinner.success(`Cleaned ${cleanResult.purgedFiles} stale files (${mb} MB reclaimed) from ~/.konoha/`);
  } else {
    cleanSpinner.success('~/.konoha/ runtime is clean.');
  }
}

function deployRtkRules(args) {
  const rtkSpinner = startSpinner('Checking RTK (Rust Token Killer)...');
  const _rtkInstall = args.includes('--force')
    ? antigravityManager.refreshRtk(false)
    : antigravityManager.ensureRtkInstalled(false);
  const rtkResult = antigravityManager.deployAntigravityRtkRule(true);
  if (rtkResult.ok) {
    rtkSpinner.success(`RTK rules deployed to ${rtkResult.deployed} Antigravity location(s).`);
  } else if (rtkResult.reason === 'rtk-not-installed') {
    rtkSpinner.warn('RTK could not be installed automatically (needs cargo, or network for the official install script).');
  } else {
    rtkSpinner.warn(`RTK rule deployment skipped: ${rtkResult.reason}`);
  }
}

function makeClientChecker(requestedClients) {
  if (!requestedClients) return (_name, installed) => installed;
  if (requestedClients.includes('all')) return () => true;
  return (name) => requestedClients.includes(name);
}

function detectAllClientFlags(args) {
  const requestedClients = parseRequestedClients(args);
  const shouldConfigure = makeClientChecker(requestedClients);
  const cursorInstalled = cursorManager.isCursorInstalled();
  const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
  const openCodeInstalled = opencodeManager.isOpenCodeInstalled();
  const commandCodeInstalled = mcpClientsManager.isCommandCodeInstalled();
  const codexInstalled = codexManager.isCodexInstalled();
  const piInstalled = piManager.isPiInstalled();
  const ompInstalled = ompManager.isOmpInstalled();

  return {
    cursorInstalled, claudeInstalled, openCodeInstalled, commandCodeInstalled, codexInstalled, piInstalled, ompInstalled,
    allowCursor: shouldConfigure('cursor', cursorInstalled),
    allowClaudeCode: shouldConfigure('claude', claudeInstalled),
    allowOpenCode: shouldConfigure('opencode', openCodeInstalled),
    allowCommandCode: shouldConfigure('commandcode', commandCodeInstalled),
    allowCodex: shouldConfigure('codex', codexInstalled),
    allowPi: shouldConfigure('pi', piInstalled),
    allowOmp: shouldConfigure('omp', ompInstalled)
  };
}

async function handleExistingInstallation(clientFlags, args, options) {
  if (!fileExists(SERVER_PATH) || !hasCompleteDatabaseSchema(clientFlags.python)) {
    return false;
  }
  warn('Konoha MCP already installed.');
  if (args.includes('--force')) {
    return false;
  }
  await refreshExistingInstallation(clientFlags, options);
  return true;
}

async function promptInitializationConsent(args) {
  const isNonInteractive = args.includes('--yes') || args.includes('-y') || process.env.CI === 'true';
  if (isNonInteractive) return true;
  return await confirmPrompt('Initialize Konoha and modify ~/.gemini configurations?', true);
}

async function cmdInit(args, options = {}) {
  if (args.includes('help') || args.includes('--help') || args.includes('-h')) {
    cmdInitHelp();
    return;
  }
  if (args.includes('--force')) {
    purgePackageCaches({ silent: true });
    try {
      const { cmdUiStop } = require('../lib/ui_commands');
      await cmdUiStop(['--port=1404']);
    } catch (_) { /* non-fatal best effort */ }
  }
  syncTemplateSkills();
  drawLogo();

  header('🚀 Konoha Installer');
  log(`${C.dim}MCP Tools Orchestrator for Antigravity, Cursor, Claude Code, OpenCode, Command Code, and Codex${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  const doInit = await promptInitializationConsent(args);
  if (!doInit) {
    warn('Initialization aborted.');
    return;
  }

  const clientFlags = detectAllClientFlags(args);
  ensureCoreDirectories();
  checkNodeAndToolchains(options, args);
  const python = checkPython() || 'node';
  clientFlags.python = python;

  if (await handleExistingInstallation(clientFlags, args, options)) return;

  const templateSkillsDir = path.resolve(__dirname, '..', '..', 'src', 'templates', 'skills');
  const pkgSkillsDir = fileExists(templateSkillsDir)
    ? templateSkillsDir
    : (fileExists(path.resolve(__dirname, '..', '..', '.agents', 'skills'))
        ? path.resolve(__dirname, '..', '..', '.agents', 'skills')
        : path.join(HOME, '.agents', 'skills'));
  if (!hasCanonicalGeninSkill(pkgSkillsDir)) {
    error(`Packaged canonical skill missing: ${path.join(pkgSkillsDir, 'genin-skill', 'SKILL.md')}`);
    process.exit(1);
  }

  cleanStaleFilesIfForced(args);
  installFileTools(true);
  installCliRuntime();

  header('🌱 Seeding Canonical Subagent Skills');
  const spinnerMigrate = startSpinner('Seeding canonical skills into ~/.konoha/konoha.db...');
  const skillsDirs = detectSkillsDirs();
  const skills = ['genin-skill', 'kage-skill', 'chunin-skill', 'jonin-skill', 'anbu-skill', 'tokubetsu-jonin-skill', 'akatsuki-skill'];
  const migrationArgs = ['--skills-dir', pkgSkillsDir, '--skills', ...skills, '--skip-embeddings'];

  executeInitMigration({
    skillsDirs,
    skills,
    migrationArgs,
    safeTimeoutMs: 180000,
    python,
    pkgSkillsDir,
    spinner: spinnerMigrate
  });

  registerMcp(python, true, true);
  registerHooks(false, true);
  agentManager.loadAgents();
  agentManager.regenerateAndDeploy({ force: true, silent: true });
  deployRtkRules(args);
  try {
    deployUtils.syncSoulAcrossClients({ silent: true });
  } catch (_) { /* intentional fallback */ }

  const setupAgents = agentManager.loadAgents();
  const currentCwd = path.resolve(process.cwd());
  setupClientIntegrations({
    ...clientFlags,
    setupAgents,
    currentCwd,
    onProgress: options.onProgress
  });

  try {
    agentManager.deployProjectWorkspace(currentCwd, { silent: true, force: true });
  } catch (_) { /* intentional fallback */ }

  renderInitSummary(clientFlags);
  recordAutoSetupState();
}

module.exports = {
  cmdInit,
  cmdInitHelp
};
