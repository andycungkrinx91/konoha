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
  SERVER_PATH,
  INSTALL_BUILD_MIGRATE_TIMEOUT_MS,
  UI_PORT
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
  ensureCoreDirectories
} = require('../lib/runtime_mcp');
const {
  hasCompleteDatabaseSchema,
  detectSkillsDirs,
  hasCanonicalGeninSkill
} = require('../lib/runtime_lifecycle');
const {
  installCliRuntime,
  copyIfDifferent
} = require('../lib/runtime_install');
const { purgePackageCaches } = require('../lib/runtime_mcp');
const {
  installUv,
  installAgentBrowserDetailed,
  refreshSemblePackage,
  PINNED_AB_PACKAGE
} = require('../lib/extension');
const { checkPortActive, ensureUiDaemonAutoStart } = require('../lib/ui_commands');
const { cmdBridgeStart } = require('./bridge');
const { parseRequestedClients, setupClientIntegrations } = require('./init_clients');
const { executeInitMigration, renderInitSummary, measureEmbeddingCoverage } = require('./init_migration');
const {
  executePreInstallBackup,
  runTransactionalDatabaseMigration
} = require('../lib/install_lifecycle');

function cmdInitHelp() {
  header('Konoha Installer Help');
  log(`
  Usage: konoha init [options]

  Initializes the Konoha environment:
  1. Checks requirements (Node.js >= 24, uv for Python tools).
  2. Creates ~/.konoha directory structure.
  3. Copies runtime and migration files.
  4. Discovers skills directories (~/.agents/skills).
  5. Seeds canonical subagent skills and builds their vector embeddings (~/.konoha/konoha.db).
  6. Registers Konoha & Semble MCP tools with your AI coding assistants.
  7. Configures multi-agent team rules (Antigravity, Cursor, Claude Code, OpenCode, Codex, Pi, OMP).

  Options:
    -h, --help               Show this help message
    -y, --yes                Auto-approve all confirmation prompts (non-interactive)
    --force                  Reinstall and refresh runtime files
    --client=<name>          Append Konoha config into specific client (cursor, claude, opencode, omp, codex, pi, antigravity, commandcode, all)
    --project                Also create/append project-level client configuration in current directory
    --no-project             Skip project-level configuration updates
    --with-red-team          Opt in to the cyber pack (offensive/dual-use reference
                             material; fetched from a release asset, sha256-verified)
    --no-embed               Skip vector embedding of skills (search stays keyword-only
                             until you run "konoha migrate")
  `);
}

function recordAutoSetupState() {
  const marker = path.join(SKILLS_DB_DIR, '.autosetup-done');
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
  if (majorVersion < 24) {
    spinner1.error(`Node.js >= 24 is required, found ${nodeVersion}`);
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
  let ab = installAgentBrowserDetailed(true);
  if (!ab.ok) ab = installAgentBrowserDetailed(false);
  if (ab.ok) {
    spinner1c.success(`agent-browser CLI ready (${ab.via}).`);
  } else {
    spinner1c.warn(`QA blocked: agent-browser unavailable (${ab.reason}). Install with: npm i -g ${PINNED_AB_PACKAGE}`);
  }

  if (args.includes('--force')) {
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }
}

async function autoStartUiDaemonIfRequested(options) {
  if (!options.skipUiAutoStart) {
    try {
      const uiAuto = await ensureUiDaemonAutoStart();
      if (uiAuto?.started) {
        info(`${C.bold}Konoha Web UI daemon auto-started:${C.reset} ${C.cyan}http://127.0.0.1:${UI_PORT}/${C.reset} (set KONOHA_UI_AUTOSTART=0 to disable)`);
      }
    } catch { /* intentional fallback */ }
  }
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

  try {
    deployUtils.ensureGlobalGitExcludes();
    deployUtils.sanitizePollutedProjectGitignore(process.cwd());
    const { syncAllGlobalClientSkills } = require('../../src/global_skill_sync');
    syncAllGlobalClientSkills({ clients: flags.requestedClients || ['all'] });
  } catch (_) { /* intentional fallback */ }

  const hasClientsToSetup = flags.explicitSelection || (
    flags.allowAntigravity || flags.allowCursor || flags.allowClaudeCode ||
    flags.allowOpenCode || flags.allowCommandCode || flags.allowCodex ||
    flags.allowPi || flags.allowOmp
  );

  if (hasClientsToSetup) {
    const setupAgents = agentManager.loadAgents();
    const currentCwd = path.resolve(process.cwd());
    setupClientIntegrations({
      ...flags,
      setupAgents,
      currentCwd,
      onProgress: options.onProgress
    });
    if (flags.allowAntigravity) {
      deployRtkRules([]);
    }
  }

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
  if (!requestedClients) return (_name, installed) => Boolean(installed);
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
  const deployProject = Boolean(args.includes('--project'));
  const appendProject = Boolean(args.includes('--project'));

  return {
    explicitSelection: Array.isArray(requestedClients) && requestedClients.length > 0,
    requestedClients,
    deployProject,
    appendProject,
    cursorInstalled, claudeInstalled, openCodeInstalled, commandCodeInstalled, codexInstalled, piInstalled, ompInstalled,
    allowAntigravity: shouldConfigure('antigravity', true),
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
  const hasExplicitClient = Boolean(parseRequestedClients(args));
  const isNonInteractive = hasExplicitClient || args.includes('--yes') || args.includes('-y') || process.env.CI === 'true';
  if (isNonInteractive) return true;
  return await confirmPrompt('Initialize Konoha runtime and SQLite database (~/.konoha/)?', true);
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
      await cmdUiStop([`--port=${UI_PORT}`]);
    } catch (_) { /* non-fatal best effort */ }
  }
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
  try {
    const backupSummary = executePreInstallBackup({
      projectRoot: process.cwd(),
      clients: clientFlags.requestedClients
    });
    for (const line of (backupSummary.summaryLines || [])) {
      log(`${C.dim}${line}${C.reset}`);
    }
    runTransactionalDatabaseMigration();
  } catch (backupErr) {
    error(`Configuration backup verification failed: ${backupErr.message}`);
    process.exit(1);
  }
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
  const { CANONICAL_SKILL_NAMES } = require('../../src/canonical_skills');
  const skills = Array.from(CANONICAL_SKILL_NAMES);
  const skipEmbed = args.includes('--no-embed');
  const migrationArgs = buildInitMigrationArgs({ pkgSkillsDir, skills, skipEmbed });

  await executeInitMigration({
    skillsDirs,
    skills,
    migrationArgs,
    safeTimeoutMs: INSTALL_BUILD_MIGRATE_TIMEOUT_MS,
    python,
    pkgSkillsDir,
    spinner: spinnerMigrate
  });

  agentManager.loadAgents();
  try {
    deployUtils.ensureGlobalGitExcludes();
    deployUtils.sanitizePollutedProjectGitignore(process.cwd());
    const { syncAllGlobalClientSkills } = require('../../src/global_skill_sync');
    syncAllGlobalClientSkills({ clients: clientFlags.requestedClients || ['all'] });
  } catch (_) { /* intentional fallback */ }

  const hasClientsToSetup = clientFlags.explicitSelection || (
    clientFlags.allowAntigravity || clientFlags.allowCursor || clientFlags.allowClaudeCode ||
    clientFlags.allowOpenCode || clientFlags.allowCommandCode || clientFlags.allowCodex ||
    clientFlags.allowPi || clientFlags.allowOmp
  );

  if (hasClientsToSetup) {
    const setupAgents = agentManager.loadAgents();
    const currentCwd = path.resolve(process.cwd());
    setupClientIntegrations({
      ...clientFlags,
      setupAgents,
      currentCwd,
      onProgress: options.onProgress
    });
    if (clientFlags.allowAntigravity) {
      deployRtkRules(args);
    }
  }

  const embedCoverage = skipEmbed ? null : measureEmbeddingCoverage();
  renderInitSummary({ ...clientFlags, skipEmbed, embedCoverage });
  if (args.includes('--with-red-team')) {
    await installCyberPackAfterInit();
  }
  if (!options.skipUiAutoStart) {
    await autoStartUiDaemonIfRequested(options);
  }
  recordAutoSetupState();
}

/**
 * `konoha init --with-red-team`: the only init path that touches the pack.
 * Consent is explicit on the command line, so `--confirm` is implied.
 */
async function installCyberPackAfterInit() {
  const cyberPack = require('../../src/cyber_pack');
  const db = require('../../src/db');
  header('🔴 Opting In To The Cyber Pack');
  log(`  ${C.yellow}${cyberPack.CONSENT_TEXT}${C.reset}\n`);
  let conn = null;
  try {
    conn = db.getConnection(null, false);
    const result = await cyberPack.install({ confirm: true, conn, log: (m) => log(`  ${C.green}✓${C.reset} ${m}`) });
    success(`Cyber pack ${result.version} installed. Run "konoha migrate" to index it.`);
  } catch (e) {
    error(`Cyber pack install failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* ignore */ }
  }
}

/**
 * Migration flags used to seed canonical skills during init.
 *
 * Embeddings are ON by default so skill search is semantic on first use.
 * `--no-embed` opts out for CI/containers; runMigrationAttempts still degrades
 * to --skip-embeddings on its own if the model cannot load.
 */
function buildInitMigrationArgs({ pkgSkillsDir, skills, skipEmbed = false }) {
  const out = ['--skills-dir', pkgSkillsDir, '--skills', ...skills];
  if (skipEmbed) out.push('--skip-embeddings');
  return out;
}

module.exports = {
  cmdInit,
  cmdInitHelp,
  detectAllClientFlags,
  buildInitMigrationArgs
};
