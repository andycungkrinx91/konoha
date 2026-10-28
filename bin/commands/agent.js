'use strict';

const agentManager = require('../../src/agent_manager');
const { DB_PATH } = require('../lib/paths');
const { fileExists } = require('../../src/platform_utils');
const {
  C,
  header,
  log,
  info,
  success,
  warn,
  error,
  drawTable,
  getVisualLength
} = require('../lib/format');

const { startAgentTui, startAgentModelTui } = require('./agent_tui');
const { AVAILABLE_MODELS, loadBridges, getActiveModels, cmdAgentModels } = require('./agent_models');
const { cmdAgentStatus } = require('./agent_status');
const { handleAgentSkillCommand } = require('./agent_skill_cmd');

function cmdAgentHelp() {
  log(`
  ${C.bold}👤 Konoha Subagent (Ninja) Management Help 👤${C.reset}
  ${C.dim}========================================================================
  An "Agent" (or Ninja) is a specialized AI assistant that handles specific tasks.
  By splitting work among multiple subagents, we get better results at lower cost.
  - @sannin: Village Router & Planner for task triage, subagent selection & orchestration.
  - @genin: Scout for read-only codebase reconnaissance & tracing code dependencies.
  - @kage: Village Leader for high-level architecture decisions, security audits & quality gate reviews.
  - @chunin: Intelligence researcher for documentation lookup, web search & citations.
  - @jonin: Elite Builder for frontend, Taste-Skill design engine & UI components (Next.js, Svelte, Nuxt, Angular).
  - @anbu: Black Ops backend developer for bug fixes, API logic, and DevOps/CI-CD.
  - @tokubetsu-jonin: Scribe for writing READMEs, API specs, PDF reports, and runbooks.
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha agent <subcommand> [args]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                        List all active agents and their skills.
  ${C.cyan}create <agent-name> [options]${C.reset} Create a custom subagent manually.
                              Options: --title, --purpose, --instructions, --keywords.
  ${C.cyan}skill [agent-name]${C.reset}          Interactively toggle (embed or remove) a skill for an agent.
  ${C.cyan}models [config] [agent-name]${C.reset} Interactively pick a bridge-served model for a subagent.
                              Non-interactive: --model <model-id> (or --model inherit to clear).
  ${C.cyan}delete <agent-name>${C.reset}         Permanently delete/prune an agent and prune its historical statistics.
  ${C.cyan}status${C.reset}                      View detailed call statistics (today, 7 days, all time) for subagents.

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. View all configured agents in your village:${C.reset}
     konoha agent list

  ${C.dim}2. Interactively teach @genin a new skill (toggle from list):${C.reset}
     konoha agent skill genin

  ${C.dim}3. Interactively pick a bridge-served model for @genin:${C.reset}
     konoha agent models config genin

  ${C.dim}4. View subagent call frequency statistics:${C.reset}
     konoha agent status

  ${C.dim}5. Permanently delete/prune an agent and clean up its database stats:${C.reset}
     konoha agent delete name

  ${C.dim}6. Create a custom subagent manually:${C.reset}
     konoha agent create my-agent --title "Special Agent" --purpose "Custom tasks" --instructions "Custom instructions" --keywords "my-agent"
`);
}

function renderPlainAgentList(agents) {
  header('Subagents List');
  const headers = ['Subagent', 'Title', 'Active Skills'];
  const aligns = ['left', 'left', 'left'];

  const rows = agents.map(a => {
    const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
    return [
      `${a.icon || '👤'} @${a.name}`,
      a.title || 'Ninja',
      skillsList
    ];
  });

  const widths = headers.map((h, colIdx) => {
    let maxLen = getVisualLength(h);
    rows.forEach(row => {
      const cellLen = getVisualLength(row[colIdx]);
      if (cellLen > maxLen) maxLen = cellLen;
    });
    return maxLen;
  });

  const rowColors = agents.map(() => [C.cyan, C.reset, C.green, C.dim]);
  drawTable(headers, widths, aligns, rows, rowColors);
  log('');
}

async function handleAgentList(subArgs) {
  const agents = agentManager.loadAgents(false, true);
  if (agents.length === 0) {
    warn('No subagents found.');
    return;
  }

  const wantsTui = (subArgs.includes('--tui') || subArgs.includes('--interactive') || subArgs.includes('-i')) &&
    process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function';

  if (!wantsTui) {
    renderPlainAgentList(agents);
    return;
  }

  await startAgentTui(agents);
}

function parseAgentCreateOptions(subArgs) {
  const options = {};
  const titleIdx = subArgs.indexOf('--title');
  if (titleIdx >= 0 && subArgs[titleIdx + 1]) options.title = subArgs[titleIdx + 1];

  const purposeIdx = subArgs.indexOf('--purpose');
  if (purposeIdx >= 0 && subArgs[purposeIdx + 1]) options.purpose = subArgs[purposeIdx + 1];

  const instrIdx = subArgs.indexOf('--instructions');
  if (instrIdx >= 0 && subArgs[instrIdx + 1]) options.instructions = subArgs[instrIdx + 1];

  const keywordsIdx = subArgs.indexOf('--keywords');
  if (keywordsIdx >= 0 && subArgs[keywordsIdx + 1]) options.delegationKeywords = subArgs[keywordsIdx + 1];

  if (subArgs.includes('--manual')) options.manual = true;
  return options;
}

function handleAgentCreate(subArgs) {
  const name = subArgs[0];
  if (!name) {
    error('Usage: konoha agent create <agent-name> [options]');
    process.exit(1);
  }

  const options = parseAgentCreateOptions(subArgs);
  try {
    const newAgent = agentManager.createSubagent(name, options);
    success(`Successfully created subagent: @${newAgent.name}`);
    info('Updated configurations and deployed to ~/.agents/agents.yaml');
  } catch (err) {
    error(`Failed to create subagent: ${err.message}`);
    process.exit(1);
  }
}

function tryPruneAgentDb(name) {
  if (!fileExists(DB_PATH)) return false;
  try {
    const { pruneAgentStats } = require('../../src/agent_stats');
    const res = pruneAgentStats(name, DB_PATH);
    return Boolean(res && res.success && res.deleted_count > 0);
  } catch (e) {
    warn(`Failed to prune database statistics: ${e.message}`);
    return false;
  }
}

function handleAgentDelete(subArgs) {
  const name = subArgs[0];
  if (!name) {
    error('Usage: konoha agent delete <agent-name>');
    process.exit(1);
  }

  try {
    let deletedFromJson = false;
    try {
      agentManager.deleteAgent(name);
      deletedFromJson = true;
    } catch (err) {
      if (!err.message.includes('not found')) throw err;
    }

    const deletedFromDb = tryPruneAgentDb(name);
    if (!deletedFromJson && !deletedFromDb) {
      error(`Failed to delete subagent: Subagent "${name}" not found in configuration or statistics.`);
      process.exit(1);
    }

    success(`Successfully deleted/pruned subagent: @${name}`);
    if (deletedFromJson) info('Updated and redeployed configurations.');
    if (deletedFromDb) info('Pruned historical call statistics from database.');
  } catch (err) {
    error(`Failed to delete subagent: ${err.message}`);
    process.exit(1);
  }
}

async function cmdAgent(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdAgentHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'list':
      await handleAgentList(subArgs);
      break;
    case 'models':
      await cmdAgentModels(subArgs);
      break;
    case 'create':
      handleAgentCreate(subArgs);
      break;
    case 'skill':
      await handleAgentSkillCommand(subArgs);
      break;
    case 'delete':
      handleAgentDelete(subArgs);
      break;
    case 'status':
      await cmdAgentStatus();
      break;
    default:
      error(`Unknown agent subcommand: ${subcommand}`);
      log('Available subcommands: list, create, skill, delete, status');
      process.exit(1);
  }
}

module.exports = {
  cmdAgent,
  cmdAgentHelp,
  cmdAgentStatus,
  cmdAgentModels,
  startAgentTui,
  startAgentModelTui,
  getActiveModels,
  loadBridges,
  AVAILABLE_MODELS
};
