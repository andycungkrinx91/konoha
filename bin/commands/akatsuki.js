'use strict';

/**
 * bin/commands/akatsuki.js — Akatsuki Security Controls & Red-Team Operator TUI.
 *
 * Commands:
 *   konoha akatsuki status           - Display Akatsuki security status, engine, and lab isolation
 *   konoha akatsuki redteam enable   - Enable Red-Team offensive execution in isolated sandbox
 *   konoha akatsuki redteam disable  - Disable Red-Team offensive execution (fails closed)
 *
 * Note: Feature enable/disable toggles are deliberately CLI/TUI exclusive and hidden from the Web UI.
 */

const {
  C,
  log,
  info,
  warn,
  error,
  success,
  header,
  drawTable,
  computeTableWidths,
  sectionTitle
} = require('../lib/format');

const {
  loadAkatsukiConfig,
  isRedTeamEnabled,
  setAkatsukiMode,
  getAkatsukiMode,
  setAkatsukiEnv,
  getAkatsukiEnv
} = require('../../src/workflow/akatsuki/config');

const {
  getLabStatus,
  getRequiredEngine,
  provisionLab,
  stopLab,
  DEFAULT_LAB_NAME
} = require('../../src/workflow/akatsuki/lab');

const {
  listSupportedTools
} = require('../../src/workflow/akatsuki/tool_registry');

/**
 * Display formatted Akatsuki Security and Red-Team status.
 */
async function cmdAkatsukiStatus() {
  log('');
  header('AKATSUKI SECURITY CONTROLS & RED-TEAM STATUS');

  const config = loadAkatsukiConfig();
  const enabled = isRedTeamEnabled();
  const mode = getAkatsukiMode();
  const env = getAkatsukiEnv();
  const engine = getRequiredEngine();
  const labStatus = getLabStatus(DEFAULT_LAB_NAME, engine);
  const tools = listSupportedTools();

  const modeBadge = mode === 'red'
    ? `${C.red}${C.bold}● RED (Offensive Pentest & Automated Sandbox)${C.reset}`
    : `${C.blue}${C.bold}● BLUE (Defensive Security & Skill Guardian — Default)${C.reset}`;

  const enabledBadge = enabled
    ? `${C.green}${C.bold}● ENABLED${C.reset}`
    : `${C.red}${C.bold}○ DISABLED (Fail-Closed)${C.reset}`;

  const isRunning = Boolean(labStatus.running || labStatus.lab_running);
  const isExists = Boolean(labStatus.exists || labStatus.container_exists);
  const labBadge = isRunning
    ? `${C.green}RUNNING${C.reset} (network_isolated: ${labStatus.network_isolated})`
    : (isExists ? `${C.yellow}STOPPED${C.reset}` : `${C.dim}NOT_CREATED${C.reset}`);

  log(`  ${C.bold}Specialist Agent:${C.reset}    @akatsuki (Red-Team, Blue-Team & Security Final Gate)`);
  log(`  ${C.bold}Akatsuki Mode:${C.reset}       ${modeBadge}`);
  log(`  ${C.bold}Execution Env:${C.reset}       ${C.cyan}${env.toUpperCase()}${C.reset} (${process.platform})`);
  log(`  ${C.bold}Blue-Team Defense:${C.reset}   ${C.green}● ACTIVE${C.reset} (Direct Host SAST, Secrets, CVEs & Skill Guardian)`);
  log(`  ${C.bold}Security Final Gate:${C.reset} ${C.green}● ACTIVE${C.reset} (Mandatory Pre-Delivery Gate before Kage Approval)`);
  log(`  ${C.bold}Red-Team Status:${C.reset}     ${enabledBadge}`);
  log(`  ${C.bold}Container Engine:${C.reset}    ${C.cyan}${engine.toUpperCase()}${C.reset}`);
  log(`  ${C.bold}Isolation Sandbox:${C.reset}   ${C.bold}${DEFAULT_LAB_NAME}${C.reset} [${labBadge}]`);
  log(`  ${C.bold}Direct Host Exec:${C.reset}    ${C.red}${C.bold}STRICTLY DENIED${C.reset} ${C.dim}(Red-Team Sandbox Confined)${C.reset}`);
  log(`  ${C.bold}Access Policy:${C.reset}       ${C.yellow}CLI / TUI Exclusive${C.reset} ${C.dim}(Hidden from Web UI)${C.reset}`);
  if (config.updated_at) {
    log(`  ${C.bold}Last Updated:${C.reset}        ${C.dim}${config.updated_at} by ${config.updated_by || 'operator'}${C.reset}`);
  }
  log('');

  // Curated tools table
  sectionTitle(`APPROVED SANDBOX TOOLS INVENTORY (${tools.length} Tools)`);

  const headers = ['Tool', 'Category', 'Safety Class', 'Allowed Operations', 'Timeout'];
  const rows = tools.map(t => [
    t.id,
    t.category,
    t.safety_class,
    (t.allowed_operations || []).slice(0, 3).join(', ') + ((t.allowed_operations || []).length > 3 ? '...' : ''),
    `${t.timeout_ms / 1000}s`
  ]);

  const widths = computeTableWidths(headers, rows);
  const aligns = ['left', 'left', 'left', 'left', 'right'];
  const rowColors = rows.map(() => [C.bold, C.cyan, C.yellow, C.reset, C.dim]);

  drawTable(headers, widths, aligns, rows, rowColors);
  log('');

  if (!enabled) {
    warn('Red-Team operations are currently DISABLED (Mode: BLUE). All offensive pentest tasks will be declined fail-closed.');
    info('To enable and automate lab setup: konoha akatsuki mode red');
  } else {
    success('Red-Team operations are ENABLED (Mode: RED). All probes execute strictly inside "akatsuki-lab".');
  }
  log('');
}

/**
 * Handle Red-Team enable / disable toggling with automated lab provisioning.
 *
 * @param {string} action 'enable' | 'disable'
 */
function cmdAkatsukiToggle(action) {
  return cmdAkatsukiMode(action === 'enable' ? 'red' : 'blue');
}

/**
 * Handle Akatsuki lab execution mode inspection and switching (blue / red).
 *
 * @param {string} [targetMode]
 */
function cmdAkatsukiMode(targetMode) {
  if (!targetMode) {
    const currentMode = getAkatsukiMode();
    const currentEnv = getAkatsukiEnv();
    log('');
    info(`Current Akatsuki Mode: ${C.bold}${currentMode === 'red' ? C.red : C.blue}${currentMode.toUpperCase()}${C.reset}`);
    log(`  Current Environment: ${C.bold}${C.cyan}${currentEnv.toUpperCase()}${C.reset}`);
    log(`  Supported modes: ${C.blue}blue${C.reset} (defensive default), ${C.red}red${C.reset} (offensive pentest + automated lab setup)`);
    log(`  To switch mode: ${C.cyan}konoha akatsuki mode blue${C.reset} or ${C.cyan}konoha akatsuki mode red${C.reset}\n`);
    return;
  }
  const normMode = String(targetMode).trim().toLowerCase();
  if (normMode === 'lxc' || normMode === 'docker') {
    info(`Note: To configure container environment, use "konoha akatsuki env ${normMode}".`);
    return cmdAkatsukiEnv(normMode);
  }
  if (normMode !== 'blue' && normMode !== 'red') {
    error(`Invalid mode "${targetMode}". Supported modes: blue, red`);
    log(`Usage: ${C.cyan}konoha akatsuki mode blue|red${C.reset}`);
    process.exitCode = 1;
    return;
  }
  setAkatsukiMode(normMode);
  log('');
  if (normMode === 'red') {
    success(`Akatsuki mode switched to ${C.bold}${C.red}RED${C.reset} (Offensive Pentest).`);
    const engine = getRequiredEngine();
    info(`Automating setup of ${engine.toUpperCase()} sandbox container "${DEFAULT_LAB_NAME}"...`);
    const provRes = provisionLab(DEFAULT_LAB_NAME, engine);
    if (provRes.ok) {
      success(`Sandbox container "${DEFAULT_LAB_NAME}" active and isolated in ${engine.toUpperCase()}.`);
    } else {
      warn(`Sandbox provisioning note: ${provRes.error || 'Container not yet started'}`);
      info(`Inspect ${engine} availability or run "konoha doctor" for diagnostics.`);
    }
    log(`  ${C.green}●${C.reset} Red-team offensive workflows and penetration testing are now active.`);
    log(`  ${C.green}●${C.reset} Probes execute exclusively inside sandbox container "${DEFAULT_LAB_NAME}".`);
    log(`  ${C.green}●${C.reset} Direct host execution remains strictly denied.`);
  } else {
    success(`Akatsuki mode switched to ${C.bold}${C.blue}BLUE${C.reset} (Defensive Security).`);
    const engine = getRequiredEngine();
    info(`Stopping sandbox container "${DEFAULT_LAB_NAME}" in ${engine.toUpperCase()}...`);
    stopLab(DEFAULT_LAB_NAME, engine);
    warn('Akatsuki Red-Team operations have been DISABLED.');
    log(`  ${C.red}○${C.reset} All red-team operations will fail closed with "Red-Team operations are currently disabled".`);
    log(`  ${C.red}○${C.reset} Blue-team defensive code audits and Skill Guardian remain active.`);
  }
  log('');
}

/**
 * Handle Akatsuki container execution environment inspection and switching (docker / lxc).
 *
 * @param {string} [targetEnv]
 */
function cmdAkatsukiEnv(targetEnv) {
  if (!targetEnv) {
    const currentEnv = getAkatsukiEnv();
    log('');
    info(`Current Akatsuki Environment: ${C.bold}${C.cyan}${currentEnv.toUpperCase()}${C.reset}`);
    log(`  Supported environments: ${C.cyan}docker${C.reset} (default), ${C.cyan}lxc${C.reset}`);
    log(`  To switch environment: ${C.cyan}konoha akatsuki env docker${C.reset} or ${C.cyan}konoha akatsuki env lxc${C.reset}\n`);
    return;
  }
  const normEnv = String(targetEnv).trim().toLowerCase();
  if (normEnv !== 'lxc' && normEnv !== 'docker') {
    error(`Invalid environment "${targetEnv}". Supported environments: docker, lxc`);
    log(`Usage: ${C.cyan}konoha akatsuki env docker|lxc${C.reset}`);
    process.exitCode = 1;
    return;
  }
  if (normEnv === 'lxc' && process.platform === 'win32') {
    warn('LXC requires a Linux or WSL2 kernel backend. On Windows, Docker is the recommended environment.');
  }
  setAkatsukiEnv(normEnv);
  log('');
  success(`Akatsuki container execution environment switched to ${C.bold}${C.cyan}${normEnv.toUpperCase()}${C.reset}.`);
  log(`  ${C.green}●${C.reset} Subsequent red-team automated provisioning and lab runs will use ${normEnv.toUpperCase()}.`);
  log('');
}

function printEngineDetails(engines) {
  for (const e of engines) {
    log(`  ${C.green}●${C.reset} ${C.bold}${e.engine.toUpperCase()}:${C.reset} status=${e.status} isolated=${e.network_isolated}`);
    if (e.tools_installed && e.tools_installed.length > 0) {
      log(`    ${C.dim}Tools ready: ${e.tools_installed.join(', ')}${C.reset}`);
    }
  }
}

/**
 * Initialize Akatsuki Red-Team Lab containers (LXC, Docker, or both).
 *
 * @param {string[]} args
 */
async function cmdAkatsukiInit(args = []) {
  log('');
  header('AKATSUKI RED-TEAM LAB INITIALIZATION');

  const { initLab } = require('../../src/workflow/akatsuki/init');

  let engines = 'auto';
  let profile = 'standard';
  let labName = DEFAULT_LAB_NAME;

  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if (a === '--engine' || a === '--engines' || a === '-e') {
      engines = (args[i + 1] || 'auto').toLowerCase();
      i++;
    } else if (a === '--profile' || a === '-p') {
      profile = (args[i + 1] || 'standard').toLowerCase();
      i++;
    } else if (a === '--name' || a === '-n') {
      labName = args[i + 1] || DEFAULT_LAB_NAME;
      i++;
    }
  }

  info(`Target Engines: ${C.cyan}${engines.toUpperCase()}${C.reset} | Profile: ${C.cyan}${profile.toUpperCase()}${C.reset} | Sandbox: ${C.bold}${labName}${C.reset}`);
  log(`  ${C.dim}Auto-detecting available hypervisors (Docker / LXC)...${C.reset}\n`);

  const res = initLab({ engines, profile, lab_name: labName });

  if (res.ok) {
    success(`✓ ${res.message}`);
    printEngineDetails(res.engines);
  } else {
    warn(`Initialization completed with warnings: ${res.message}`);
    for (const e of res.engines) {
      log(`  ${e.ok ? C.green : C.red}●${C.reset} ${C.bold}${e.engine.toUpperCase()}:${C.reset} ${e.error || e.status}`);
    }
  }
  log('');
}

/**
 * Manage and query Kali tools catalog and custom tools.
 *
 * @param {string[]} args
 */
async function cmdAkatsukiTools(args = []) {
  const { listKaliTools, listCustomTools } = require('../../src/workflow/akatsuki/init');
  const action = args[0] ? args[0].toLowerCase() : 'list';

  if (action === 'search' || action === 'list') {
    const query = args[1] || '';
    const tools = listKaliTools({ query });
    log('');
    header(`KALI LINUX TOOLS CATALOG (${tools.length} Tools Available)`);
    if (query) info(`Filter: "${query}"`);

    const headers = ['Tool Slug', 'Category', 'Package', 'Description'];
    const rows = tools.slice(0, 30).map(t => [
      t.slug,
      t.category || 'general',
      t.package || t.slug,
      (t.description || '').slice(0, 50)
    ]);

    const widths = computeTableWidths(headers, rows);
    const aligns = ['left', 'left', 'left', 'left'];
    const rowColors = rows.map(() => [C.bold, C.cyan, C.yellow, C.dim]);
    drawTable(headers, widths, aligns, rows, rowColors);

    if (tools.length > 30) {
      log(`\n  ${C.dim}... and ${tools.length - 30} more tools. Refine search: konoha akatsuki tools search <query>${C.reset}`);
    }
    log('');
    return;
  }

  if (action === 'custom') {
    const custom = listCustomTools();
    const count = Object.keys(custom).length;
    log('');
    header(`CUSTOM AKATSUKI TOOLS (${count} Registered)`);
    for (const [id, t] of Object.entries(custom)) {
      log(`  ${C.cyan}●${C.reset} ${C.bold}${id}${C.reset} [${t.category}] - ${t.display_name}`);
    }
    log('');
    return;
  }

  error(`Unknown tools command "${action}". Supported: list, search <query>, custom`);
}

/**
 * Print help for konoha akatsuki.
 */
function cmdAkatsukiHelp() {
  log(`
${C.bold}Usage:${C.reset}
  konoha akatsuki <subcommand>

${C.bold}Subcommands:${C.reset}
  ${C.cyan}status${C.reset}                          Show Akatsuki security controls, engine, mode, env, and lab status
  ${C.cyan}init [--engine auto|docker|lxc|both]${C.reset} Initialize sandbox containers across auto-detected engines
  ${C.cyan}tools [list|search <query>|custom]${C.reset}   Query Kali tool catalog (360+ tools) or custom profiles
  ${C.cyan}mode [blue|red]${C.reset}                 Switch between defensive Blue-Team and offensive Red-Team mode
  ${C.cyan}env [docker|lxc]${C.reset}                View or set container execution environment (docker / lxc)
  ${C.cyan}enable${C.reset}                          Alias for "mode red" (automated sandbox setup)
  ${C.cyan}disable${C.reset}                         Alias for "mode blue" (stop sandbox and fail-closed)
  ${C.cyan}redteam enable${C.reset}                  Alias for "mode red"
  ${C.cyan}redteam disable${C.reset}                 Alias for "mode blue"

${C.bold}Security Policy:${C.reset}
  Red-Team execution is strictly confined to the ${C.bold}akatsuki-lab${C.reset} container.
  Direct host execution is strictly denied.
  Toggles and modes are CLI/TUI exclusive and hidden from the Web UI.
`);
}

/**
 * Main dispatcher for konoha akatsuki CLI command.
 *
 * @param {string[]} args
 */
async function cmdAkatsuki(args = []) {
  const sub = args[0] ? args[0].toLowerCase() : 'status';
  const subArg = args[1] ? args[1].toLowerCase() : '';

  switch (sub) {
    case 'status':
      await cmdAkatsukiStatus();
      break;

    case 'init':
      await cmdAkatsukiInit(args.slice(1));
      break;

    case 'tools':
      await cmdAkatsukiTools(args.slice(1));
      break;

    case 'mode':
      cmdAkatsukiMode(subArg);
      break;

    case 'env':
      cmdAkatsukiEnv(subArg);
      break;

    case 'redteam':
    case 'red-team':
      if (subArg === 'enable') {
        cmdAkatsukiToggle('enable');
      } else if (subArg === 'disable') {
        cmdAkatsukiToggle('disable');
      } else {
        error(`Invalid redteam command: "${subArg}". Expected: enable | disable`);
        log(`Usage: ${C.cyan}konoha akatsuki redteam enable|disable${C.reset}`);
        process.exitCode = 1;
      }
      break;

    case 'enable':
      cmdAkatsukiToggle('enable');
      break;

    case 'disable':
      cmdAkatsukiToggle('disable');
      break;

    case 'help':
    case '--help':
    case '-h':
      cmdAkatsukiHelp();
      break;

    default:
      error(`Unknown akatsuki subcommand: "${sub}"`);
      cmdAkatsukiHelp();
      process.exitCode = 1;
      break;
  }
}

module.exports = {
  cmdAkatsuki,
  cmdAkatsukiStatus,
  cmdAkatsukiToggle,
  cmdAkatsukiMode,
  cmdAkatsukiEnv,
  cmdAkatsukiHelp
};
