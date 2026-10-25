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
  setRedTeamEnabled,
  isRedTeamEnabled,
  setAkatsukiMode,
  getAkatsukiMode
} = require('../../src/akatsuki_config');

const {
  getLabStatus,
  getRequiredEngine,
  provisionLab,
  stopLab,
  DEFAULT_LAB_NAME
} = require('../../src/akatsuki_lab');

const {
  listSupportedTools
} = require('../../src/akatsuki_tool_registry');

/**
 * Display formatted Akatsuki Security and Red-Team status.
 */
async function cmdAkatsukiStatus() {
  log('');
  header('AKATSUKI SECURITY CONTROLS & RED-TEAM STATUS');

  const config = loadAkatsukiConfig();
  const enabled = isRedTeamEnabled();
  const engine = getRequiredEngine();
  const labStatus = getLabStatus(DEFAULT_LAB_NAME, engine);
  const tools = listSupportedTools();

  const enabledBadge = enabled
    ? `${C.green}${C.bold}● ENABLED${C.reset}`
    : `${C.red}${C.bold}○ DISABLED (Fail-Closed)${C.reset}`;

  const isRunning = Boolean(labStatus.running || labStatus.lab_running);
  const isExists = Boolean(labStatus.exists || labStatus.container_exists);
  const labBadge = isRunning
    ? `${C.green}RUNNING${C.reset} (network_isolated: ${labStatus.network_isolated})`
    : (isExists ? `${C.yellow}STOPPED${C.reset}` : `${C.dim}NOT_CREATED${C.reset}`);

  log(`  ${C.bold}Specialist Agent:${C.reset}    @akatsuki (Red-Team, Blue-Team & Security Final Gate)`);
  log(`  ${C.bold}Blue-Team Defense:${C.reset}   ${C.green}● ACTIVE${C.reset} (Direct Host SAST, Secrets, CVEs & Skill Guardian)`);
  log(`  ${C.bold}Security Final Gate:${C.reset} ${C.green}● ACTIVE${C.reset} (Mandatory Pre-Delivery Gate before Kage Approval)`);
  log(`  ${C.bold}Red-Team Status:${C.reset}     ${enabledBadge}`);
  log(`  ${C.bold}Container Engine:${C.reset}    ${C.cyan}${engine.toUpperCase()}${C.reset} (${process.platform})`);
  log(`  ${C.bold}Isolation Sandbox:${C.reset}   ${C.bold}${DEFAULT_LAB_NAME}${C.reset} [${labBadge}]`);
  log(`  ${C.bold}Direct Host Exec:${C.reset}    ${C.red}${C.bold}STRICTLY DENIED${C.reset} ${C.dim}(Red-Team Sandbox Confined)${C.reset}`);
  log(`  ${C.bold}Access Policy:${C.reset}       ${C.yellow}CLI / TUI Exclusive${C.reset} ${C.dim}(Hidden from Web UI)${C.reset}`);
  if (config.updated_at) {
    log(`  ${C.bold}Last Updated:${C.reset}        ${C.dim}${config.updated_at} by ${config.updated_by || 'operator'}${C.reset}`);
  }
  log('');

  // Curated tools table
  sectionTitle('APPROVED SANDBOX TOOLS INVENTORY (10 Tools)');

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
    warn('Red-Team operations are currently DISABLED. All offensive pentest tasks will be declined fail-closed.');
    info('To enable: konoha akatsuki redteam enable');
  } else {
    success('Red-Team operations are ENABLED. All probes execute strictly inside "akatsuki-lab".');
  }
  log('');
}

/**
 * Handle Red-Team enable / disable toggling with automated lab provisioning.
 *
 * @param {string} action 'enable' | 'disable'
 */
function cmdAkatsukiToggle(action) {
  const isEnable = action === 'enable';
  setRedTeamEnabled(isEnable);

  log('');
  if (isEnable) {
    success('Akatsuki Red-Team operations have been ENABLED.');
    const engine = getRequiredEngine();
    info(`Idempotently provisioning ${engine.toUpperCase()} sandbox container "${DEFAULT_LAB_NAME}"...`);
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
 * Handle Akatsuki lab execution mode inspection and switching (lxc / docker).
 *
 * @param {string} [targetMode]
 */
function cmdAkatsukiMode(targetMode) {
  if (!targetMode) {
    const currentMode = getAkatsukiMode();
    log('');
    info(`Current Akatsuki Lab Mode: ${C.bold}${C.cyan}${currentMode.toUpperCase()}${C.reset}`);
    log(`  Supported modes: ${C.cyan}lxc${C.reset} (Linux default), ${C.cyan}docker${C.reset} (Windows/macOS default)`);
    log(`  To switch mode: ${C.cyan}konoha akatsuki mode lxc${C.reset} or ${C.cyan}konoha akatsuki mode docker${C.reset}\n`);
    return;
  }
  const normMode = String(targetMode).trim().toLowerCase();
  if (normMode !== 'lxc' && normMode !== 'docker') {
    error(`Invalid mode "${targetMode}". Supported modes: lxc, docker`);
    log(`Usage: ${C.cyan}konoha akatsuki mode lxc|docker${C.reset}`);
    process.exitCode = 1;
    return;
  }
  setAkatsukiMode(normMode);
  log('');
  success(`Akatsuki Lab execution mode switched to ${C.bold}${C.cyan}${normMode.toUpperCase()}${C.reset}.`);
  log(`  ${C.green}●${C.reset} Subsequent red-team operations and auto-provisioning will use ${normMode.toUpperCase()}.`);
  log('');
}

/**
 * Print help for konoha akatsuki.
 */
function cmdAkatsukiHelp() {
  log(`
${C.bold}Usage:${C.reset}
  konoha akatsuki <subcommand>

${C.bold}Subcommands:${C.reset}
  ${C.cyan}status${C.reset}             Show Akatsuki security controls, engine, mode, and lab status
  ${C.cyan}enable${C.reset}             Enable Red-Team execution and provision isolated lab container
  ${C.cyan}disable${C.reset}            Disable Red-Team execution and stop lab container (fail-closed)
  ${C.cyan}mode [lxc|docker]${C.reset}  View or set container execution engine mode (lxc / docker)
  ${C.cyan}redteam enable${C.reset}     Alias for enable
  ${C.cyan}redteam disable${C.reset}    Alias for disable

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

    case 'mode':
      cmdAkatsukiMode(subArg);
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
  cmdAkatsukiHelp
};
