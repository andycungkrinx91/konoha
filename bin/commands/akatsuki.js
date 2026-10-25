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
  isRedTeamEnabled
} = require('../../src/akatsuki_config');

const {
  getLabStatus,
  getRequiredEngine,
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
  const engine = getRequiredEngine(process.platform);
  const labStatus = getLabStatus(DEFAULT_LAB_NAME, engine);
  const tools = listSupportedTools();

  const enabledBadge = enabled
    ? `${C.green}${C.bold}● ENABLED${C.reset}`
    : `${C.red}${C.bold}○ DISABLED (Fail-Closed)${C.reset}`;

  const labBadge = labStatus.lab_running
    ? `${C.green}RUNNING${C.reset} (network_isolated: ${labStatus.network_isolated})`
    : (labStatus.container_exists ? `${C.yellow}STOPPED${C.reset}` : `${C.dim}NOT_CREATED${C.reset}`);

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
 * Handle Red-Team enable / disable toggling.
 *
 * @param {string} action 'enable' | 'disable'
 */
function cmdAkatsukiToggle(action) {
  const isEnable = action === 'enable';
  setRedTeamEnabled(isEnable);

  log('');
  if (isEnable) {
    success('Akatsuki Red-Team operations have been ENABLED.');
    log(`  ${C.green}●${C.reset} Red-team offensive workflows and penetration testing are now active.`);
    log(`  ${C.green}●${C.reset} Probes execute exclusively inside sandbox container "${DEFAULT_LAB_NAME}".`);
    log(`  ${C.green}●${C.reset} Direct host execution remains strictly denied.`);
  } else {
    warn('Akatsuki Red-Team operations have been DISABLED.');
    log(`  ${C.red}○${C.reset} All red-team operations will fail closed with "Red-Team operations are currently disabled".`);
    log(`  ${C.red}○${C.reset} Blue-team defensive code audits and Skill Guardian remain active.`);
  }
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
  ${C.cyan}status${C.reset}             Show Akatsuki security controls, engine, and lab status
  ${C.cyan}redteam enable${C.reset}     Enable Red-Team offensive execution in isolated sandbox
  ${C.cyan}redteam disable${C.reset}    Disable Red-Team offensive execution (fail-closed)
  ${C.cyan}enable${C.reset}             Alias for redteam enable
  ${C.cyan}disable${C.reset}            Alias for redteam disable

${C.bold}Security Policy:${C.reset}
  Red-Team execution is strictly confined to the ${C.bold}akatsuki-lab${C.reset} container.
  Direct host execution is strictly denied.
  Toggles are CLI/TUI exclusive and hidden from the Web UI.
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
  cmdAkatsukiHelp
};
