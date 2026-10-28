'use strict';

const path = require('path');
const agentManager = require('../../src/agent_manager');
const {
  header,
  log,
  info,
  error,
  drawTable,
  drawBox,
  computeTableWidths,
  applyGradient,
  gradientStatusCell,
  drawLogo,
  NINJA_THEME,
  CHIDORI_THEME,
  LEAF_THEME,
  FIRE_THEME
} = require('../lib/format');
const { startSpinner, checkPython } = require('../lib/prompt');
const { getUvxCommand } = require('../lib/extension');
const { SERVER_PATH } = require('../lib/paths');
const { cmdTest } = require('./test');
const { checkAndRepairRuntimeFiles } = require('./doctor_runtime');
const { checkAndRepairClientConfigs } = require('./doctor_clients');
const {
  checkDatabaseAndMigrations,
  checkGeminiAndAgentsConfig,
  checkPromptHookConfig,
  checkGovernanceAndServices
} = require('./doctor_services');

function cmdDoctorHelp() {
  header('Konoha Doctor Help');
  log(`
  Usage: konoha doctor [options]

  Diagnoses and auto-repairs your Konoha MCP environment, ensuring
  all runtime scripts, configurations, and AI client bridges are healthy.

  Options:
    -h, --help       Show this help message
    -y, --yes        Auto-approve all repair prompts (non-interactive)

  Run this command whenever you encounter issues with AI agents or tools.
  `);
}

function checkNodeEnvironment(context) {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    context.markError();
    context.record('Node.js Environment', 'FAILED', `Node.js >= 18 is required, found ${nodeVersion}`);
  } else {
    context.record('Node.js Environment', 'ACTIVE', `${nodeVersion} (${process.execPath})`);
  }
}

function renderDoctorResultsTable(results) {
  const doctorHeaders = ['Requirement / Component', 'Status', 'Diagnostic Details'];
  const doctorRows = results.map(res => [res.component, res.status, res.details]);
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
}

async function renderDoctorSummary(hasErrors, repairsDone) {
  if (hasErrors) {
    const summaryLines = [
      `${applyGradient('✗ Diagnostic complete with errors.', [[239, 68, 68], [185, 28, 28]])}`,
      `${applyGradient('Please check the warnings and install instructions above.', FIRE_THEME, 0.85)}`,
      `${applyGradient('Repairs successfully performed: ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}`
    ];
    drawBox('🩺 Doctor Summary', summaryLines, [[239, 68, 68], [185, 28, 28]]);
    process.exit(1);
  }

  const summaryLines = [
    `${applyGradient('✓ All diagnostic checks passed successfully!', LEAF_THEME)}`,
    `${applyGradient('Your Konoha environment is fully operational.', LEAF_THEME, 0.9)}`,
    repairsDone > 0
      ? `${applyGradient('Auto-repaired ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}${applyGradient(' component(s) successfully.', CHIDORI_THEME, 0.85)}`
      : `${applyGradient('No repairs were required.', CHIDORI_THEME, 0.8)}`
  ];
  drawBox('🩺 Doctor Summary', summaryLines, LEAF_THEME);
  log('');

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

  const context = {
    record: (component, status, details) => results.push({ component, status, details }),
    incrementRepairs: () => { repairsDone++; },
    markError: () => { hasErrors = true; }
  };

  checkNodeEnvironment(context);
  checkAndRepairRuntimeFiles(context);
  checkDatabaseAndMigrations(context);
  checkGeminiAndAgentsConfig(context);
  await checkPromptHookConfig(context, globalSpinner);

  const clientRepairOptions = {
    pythonCmd: checkPython() || 'python3',
    serverPath: SERVER_PATH,
    uvxCmd: getUvxCommand(),
    agents: agentManager.loadAgents(),
    projectRoot: path.resolve(process.cwd()),
    deployProject: false,
    silent: true,
    allowHooks: true,
    ruleContent: null
  };

  checkAndRepairClientConfigs(clientRepairOptions, context);
  await checkGovernanceAndServices(context);

  globalSpinner.success('Diagnostic checks complete.');
  renderDoctorResultsTable(results);
  await renderDoctorSummary(hasErrors, repairsDone);
}

module.exports = {
  cmdDoctor,
  cmdDoctorHelp
};
