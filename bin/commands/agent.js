"use strict";

/**
 * bin/commands/agent.js — Ninja Subagent Management, TUI Explorer & Model Assignment.
 */

const { DB_PATH } = require("../lib/paths");
const {
  C,
  log,
  info,
  warn,
  error,
  success,
  header,
  drawLogo,
  applyGradient,
  CHIDORI_THEME,
  LEAF_THEME,
  NINJA_THEME,
  FIRE_THEME,
  drawTable,
  computeTableWidths,
  getVisualLength,
  padEndVisual,
  sectionTitle,
  RASENGAN_THEME
} = require("../lib/format");

const {
  askQuestion,
  isCancel,
  fileExists
} = require("../lib/prompt");

const agentManager = require("../../src/agent_manager");
const skillManager = require("../../src/skill_manager");

function loadBridges() {
  if (!fileExists(DB_PATH)) return [];
  try {
    const Database = require("../../src/sqlite_driver");
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT * FROM bridges ORDER BY name ASC").all();
    db.close();
    return rows;
  } catch {
    return [];
  }
}


function startAgentTui(agents) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let viewMode = 'list'; // 'list' or 'detail'
    
    // Hide cursor
    process.stdout.write('\x1b[?25l');
    
    function render() {
      // Clear console and cursor to home
      console.clear();
      
      if (viewMode === 'list') {
        header('🥷 Subagents Interactive Explorer');
        log(`  ${C.dim}Use ↑/↓ keys to navigate, Press Enter to view details, ESC to exit${C.reset}\n`);
        
        const headers = [' ', 'Subagent', 'Title', 'Active Skills'];
        const aligns = ['left', 'left', 'left', 'left'];

        const rows = agents.map((a, idx) => {
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          const indicator = idx === selectedIndex ? '➔' : ' ';
          return [
            indicator,
            `${a.icon || '👤'} @${a.name}`,
            a.title || 'Ninja',
            skillsList
          ];
        });

        const widths = headers.map((h, colIdx) => {
          if (colIdx === 0) return 2;
          let maxLen = getVisualLength(h);
          rows.forEach(row => {
            const cellLen = getVisualLength(row[colIdx]);
            if (cellLen > maxLen) {
              maxLen = cellLen;
            }
          });
          return maxLen;
        });
        
        const rowColors = agents.map((agent, idx) => {
          if (idx === selectedIndex) {
            return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.magenta];
          }
          return [C.dim, C.cyan, C.reset, C.bold + C.magenta];
        });
        
        drawTable(headers, widths, aligns, rows, rowColors, NINJA_THEME);
        log('');
      } else {
        // Detail View
        const agent = agents[selectedIndex];
        header(`🥷 Subagent Details: ${agent.icon || '👤'} @${agent.name}`);
        log(`  ${C.dim}Press ESC or Backspace to return to list${C.reset}\n`);
        
        const boxWidth = 80;
        const d = C.dim;
        const r = C.reset;
        
        log(`    ${d}┌${'─'.repeat(boxWidth)}┐${r}`);
        
        const printDetailLine = (label, val, color = C.reset) => {
          const contentWidth = boxWidth - 17; // 80 - 17 = 63
          let text = String(val);
          let lines = [];
          while (getVisualLength(text) > contentWidth) {
            let splitIdx = 0;
            let currentVisualLen = 0;
            for (let i = 0; i < text.length; i++) {
              const code = text.charCodeAt(i);
              const charLen = (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
              if (currentVisualLen + charLen > contentWidth) {
                splitIdx = i;
                break;
              }
              currentVisualLen += charLen;
              if (charLen === 2) i++; // skip low surrogate
            }
            lines.push(text.substring(0, splitIdx));
            text = text.substring(splitIdx);
          }
          lines.push(text);
          
          lines.forEach((line, idx) => {
            const lbl = idx === 0 ? padEndVisual(label, 12) : ' '.repeat(12);
            const formatted = `${d}│${r} ${C.bold}${lbl}${C.reset} ${d}➔${r} ${color}${padEndVisual(line, contentWidth)}${r} ${d}│${r}`;
            log(`    ${formatted}`);
          });
        };
        
        printDetailLine('Icon', agent.icon || '👤', C.yellow);
        printDetailLine('Name', `@${agent.name}`, C.cyan);
        printDetailLine('Title', agent.title || 'Ninja', C.white);
        printDetailLine('Purpose', agent.purpose || 'General assistant', C.reset);
        printDetailLine('Skills', agent.skills && agent.skills.length > 0 ? agent.skills.join(', ') : 'None', C.magenta);
        printDetailLine('Model', agent.model || 'inherit', C.green);
        printDetailLine('Keywords', agent.delegationKeywords || agent.name, C.yellow);
        
        // Instructions & Constraints with border lines
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        
        const printMultiLineSection = (title, text) => {
          log(`    ${d}│${r} ${C.bold}${padEndVisual(title, boxWidth - 2)}${r} ${d}│${r}`);
          const contentWidth = boxWidth - 2;
          
          const paragraphs = text.split('\n');
          paragraphs.forEach(p => {
            if (!p.trim()) return;
            const words = p.split(' ');
            let line = '';
            words.forEach(word => {
              if (getVisualLength(line + word) > contentWidth) {
                log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
                line = word + ' ';
              } else {
                line += word + ' ';
              }
            });
            if (line.trim()) {
              log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
            }
          });
        };
        
        printMultiLineSection('Description/Purpose:', agent.description || agent.purpose || 'Custom subagent.');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Constraints:', agent.constraints || 'None');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Workflow:', agent.workflow || 'Process input and report findings.');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Instructions:', agent.instructions || 'General instructions.');
        
        log(`    ${d}└${'─'.repeat(boxWidth)}┘${r}\n`);
      }
    }

    render();

    // Start key listener
    if (process.stdin && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    if (process.stdin) {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }

    function onKey(key) {
      // ctrl+c (SIGINT)
      if (key === '\u0003') {
        cleanup();
        process.exit(0);
      }

      if (viewMode === 'list') {
        if (key === '\u001b[A' || key === 'k') { // Up arrow or 'k'
          selectedIndex = (selectedIndex - 1 + agents.length) % agents.length;
          render();
        } else if (key === '\u001b[B' || key === 'j') { // Down arrow or 'j'
          selectedIndex = (selectedIndex + 1) % agents.length;
          render();
        } else if (key === '\r' || key === '\n') { // Enter
          viewMode = 'detail';
          render();
        } else if (key === '\u001b') { // ESC
          cleanup();
          resolve();
        }
      } else { // Detail Mode
        if (key === '\u001b' || key === '\u007f' || key === 'q' || key === '\b') { // ESC or Backspace or 'q'
          viewMode = 'list';
          render();
        }
      }
    }

    if (process.stdin) {
      process.stdin.on('data', onKey);
    }

    function cleanup() {
      if (process.stdin) {
        process.stdin.removeListener('data', onKey);
        if (typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      }
      // Show cursor
      process.stdout.write('\x1b[?25h');
    }
  });
}


// Interactive two-step TUI for `konoha agent models config`:
// Step 1 selects a subagent, step 2 selects a bridge-served model (or inherit).
function startAgentModelTui(agents, models) {
  return new Promise((resolve) => {
    let step = 'SELECT_AGENT';
    let agentIndex = 0;
    let modelIndex = 0; // 0 = inherit, 1..n = models[n-1]

    const inheritRow = { name: '⤺ Inherit (clear assignment)', tag: 'Host default' };
    const modelRows = [inheritRow, ...models];

    process.stdout.write('\x1b[?25l');

    function render() {
      console.clear();

      if (step === 'SELECT_AGENT') {
        header('🤖 Agent Model Config — Select Subagent');
        log(`  ${C.dim}Use ↑/↓ keys to navigate, Enter to select, ESC to exit${C.reset}\n`);

        const headers = [' ', 'Subagent', 'Title', 'Current Model'];
        const aligns = ['left', 'left', 'left', 'left'];
        const rows = agents.map((a, idx) => [
          idx === agentIndex ? '➔' : ' ',
          `${a.icon || '👤'} @${a.name}`,
          a.title || 'Ninja',
          a.model || 'inherit'
        ]);

        const widths = headers.map((h, colIdx) => {
          if (colIdx === 0) return 2;
          let maxLen = getVisualLength(h);
          rows.forEach(row => {
            const cellLen = getVisualLength(row[colIdx]);
            if (cellLen > maxLen) maxLen = cellLen;
          });
          return maxLen;
        });

        const rowColors = agents.map((agent, idx) => {
          if (idx === agentIndex) {
            return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.green];
          }
          return [C.dim, C.cyan, C.reset, C.green];
        });

        drawTable(headers, widths, aligns, rows, rowColors, NINJA_THEME);
        log('');
      } else {
        const agent = agents[agentIndex];
        header(`🤖 Agent Model Config — Model for ${agent.icon || '👤'} @${agent.name}`);
        log(`  ${C.dim}Use ↑/↓ keys to navigate, Enter to assign, ESC to go back${C.reset}\n`);

        const headers = [' ', 'Model', 'Tag'];
        const aligns = ['left', 'left', 'left'];
        const rows = modelRows.map((m, idx) => [
          idx === modelIndex ? '➔' : ' ',
          m.name,
          m.tag || '-'
        ]);

        const widths = headers.map((h, colIdx) => {
          if (colIdx === 0) return 2;
          let maxLen = getVisualLength(h);
          rows.forEach(row => {
            const cellLen = getVisualLength(row[colIdx]);
            if (cellLen > maxLen) maxLen = cellLen;
          });
          return maxLen;
        });

        const rowColors = modelRows.map((row, idx) => {
          if (idx === modelIndex) {
            return [C.bold + C.yellow, C.bold + C.white, C.bold + C.cyan];
          }
          return [C.dim, C.reset, C.cyan];
        });

        drawTable(headers, widths, aligns, rows, rowColors, RASENGAN_THEME);
        log(`  ${C.dim}Current: ${C.reset}${C.green}${agent.model || 'inherit'}${C.reset}\n`);
      }
    }

    render();

    if (process.stdin && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    if (process.stdin) {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }

    function onKey(key) {
      if (key === '\u0003') { // ctrl+c
        cleanup();
        process.exit(0);
      }

      if (step === 'SELECT_AGENT') {
        if (key === '\u001b[A' || key === 'k') {
          agentIndex = (agentIndex - 1 + agents.length) % agents.length;
          render();
        } else if (key === '\u001b[B' || key === 'j') {
          agentIndex = (agentIndex + 1) % agents.length;
          render();
        } else if (key === '\r' || key === '\n') {
          step = 'SELECT_MODEL';
          modelIndex = 0;
          render();
        } else if (key === '\u001b') { // ESC
          cleanup();
          resolve(null);
        }
      } else { // SELECT_MODEL
        if (key === '\u001b[A' || key === 'k') {
          modelIndex = (modelIndex - 1 + modelRows.length) % modelRows.length;
          render();
        } else if (key === '\u001b[B' || key === 'j') {
          modelIndex = (modelIndex + 1) % modelRows.length;
          render();
        } else if (key === '\r' || key === '\n') {
          cleanup();
          if (modelIndex === 0) {
            resolve({ agent: agents[agentIndex], model: null });
          } else {
            resolve({ agent: agents[agentIndex], model: models[modelIndex - 1] });
          }
        } else if (key === '\u001b' || key === '\u007f' || key === 'q' || key === '\b') {
          step = 'SELECT_AGENT';
          render();
        }
      }
    }

    if (process.stdin) {
      process.stdin.on('data', onKey);
    }

    function cleanup() {
      if (process.stdin) {
        process.stdin.removeListener('data', onKey);
        if (typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      }
      process.stdout.write('\x1b[?25h');
    }
  });
}

// `konoha agent models [config] [agent-name] [--model <id>|inherit]`
async function cmdAgentModels(subArgs) {
  const cleaned = [];
  let directModel;
  for (let i = 0; i < subArgs.length; i++) {
    if (subArgs[i] === '--model' && subArgs[i + 1]) {
      directModel = subArgs[++i];
      continue;
    }
    if (subArgs[i] === 'config') continue; // optional keyword
    cleaned.push(subArgs[i]);
  }
  const agentNameArg = cleaned[0];

  const agents = agentManager.loadAgents(false, true);
  if (agents.length === 0) {
    warn('No subagents found.');
    return;
  }

  let targetAgent = null;
  if (agentNameArg) {
    targetAgent = agents.find(a => a.name.toLowerCase() === agentNameArg.toLowerCase());
    if (!targetAgent) {
      error(`Subagent "@${agentNameArg}" not found.`);
      process.exit(1);
    }
  }

  const models = await getActiveModels();
  if (models.length === 0) {
    warn('No bridge-served models found. Run "konoha bridge models" or start/configure bridges first.');
    return;
  }

  // Non-interactive direct assignment: konoha agent models config <agent> --model <id>
  if (directModel !== undefined) {
    if (!targetAgent) {
      error('Usage: konoha agent models config <agent-name> --model <model-id>');
      process.exit(1);
    }
    const modelId = directModel === 'inherit' || directModel === 'none'
      ? null
      : (models.find(m => m.name === directModel || (m.aliases || []).includes(directModel.toLowerCase()))?.name || directModel);
    try {
      agentManager.updateAgentModel(targetAgent.name, modelId);
      success(modelId
        ? `Model "${modelId}" assigned to @${targetAgent.name}. Configurations re-deployed.`
        : `Model assignment cleared for @${targetAgent.name} (inherit). Configurations re-deployed.`);
    } catch (err) {
      error(`Failed to set model: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Non-TTY / Non-interactive: print current assignments + guidance
  const isPlainModels = subArgs.includes('--plain') || subArgs.includes('--table') || subArgs.includes('--no-tui');
  const isInteractiveModels = Boolean(
    process.stdin &&
    process.stdin.isTTY &&
    process.stdout &&
    process.stdout.isTTY &&
    typeof process.stdin.setRawMode === 'function' &&
    !isPlainModels &&
    !process.env.CI &&
    !process.env.NON_INTERACTIVE
  );

  if (!isInteractiveModels) {
    header('Subagent Model Assignments');
    const headers = ['Subagent', 'Title', 'Current Model'];
    const rows = (targetAgent ? [targetAgent] : agents).map(a => [
      `${a.icon || '👤'} @${a.name}`,
      a.title || 'Ninja',
      a.model || 'inherit'
    ]);
    const widths = computeTableWidths(headers, rows, { minWidths: [15, 12, 12] });
    drawTable(headers, widths, ['left', 'left', 'left'], rows, [], RASENGAN_THEME, {
      columnFormatters: [
        (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
        (cell) => cell,
        (cell) => `${C.green}${cell}${C.reset}`
      ]
    });
    info('Tip: Run interactively in a TTY (konoha agent models config) or use: konoha agent models config <agent> --model <model-id>');
    return;
  }

  // Interactive TUI
  const selection = await startAgentModelTui(targetAgent ? [targetAgent] : agents, models);
  if (!selection) {
    log('  Model config cancelled.');
    return;
  }

  try {
    agentManager.updateAgentModel(selection.agent.name, selection.model ? selection.model.name : null);
    success(selection.model
      ? `Model "${selection.model.name}" assigned to @${selection.agent.name}. Configurations re-deployed.`
      : `Model assignment cleared for @${selection.agent.name} (inherit). Configurations re-deployed.`);
  } catch (err) {
    error(`Failed to set model: ${err.message}`);
    process.exit(1);
  }
}


async function cmdAgentStatus() {
  drawLogo();
  header('🥷 Agent Call Statistics');
  
  // Load registered subagents (silent: true so we don't trigger regenerateAndDeploy and reprint the deploy banner)
  const agents = agentManager.loadAgents(false, true);

  let stats = {};
  if (fileExists(DB_PATH)) {
    try {
      const agentStatsModule = require('../../src/agent_stats');
      stats = agentStatsModule.getAgentStats(DB_PATH);
      if (stats.error) stats = {};
    } catch (e) {
      warn(`Failed to retrieve stats: ${e.message}`);
    }
  }

  // Build a map/list of all agents to show
  const displayAgents = [];
  const registeredNames = new Set();

  agents.forEach(a => {
    const name = a.name.toLowerCase();
    const bareName = name.replace(/^mcp_/, '').replace(/^mcp-/, '');
    registeredNames.add(name);
    registeredNames.add(bareName);

    const agentStats = stats[name] || stats[bareName] || { today: 0, last7days: 0, alltime: 0 };
    displayAgents.push({
      name: `@${a.name}`,
      icon: a.icon || '👤',
      title: a.title,
      today: agentStats.today,
      last7days: agentStats.last7days,
      alltime: agentStats.alltime,
      isRegistered: true
    });
  });

  // Aggregate all unregistered/direct tool calls (including orchestrator, tests, and direct usage)
  const directStats = { today: 0, last7days: 0, alltime: 0 };
  Object.keys(stats).forEach(name => {
    const lowerName = name.toLowerCase();
    const bareName = lowerName.replace(/^mcp_/, '').replace(/^mcp-/, '');
    if (!registeredNames.has(lowerName) && !registeredNames.has(bareName)) {
      const agentStats = stats[name];
      directStats.today += agentStats.today;
      directStats.last7days += agentStats.last7days;
      directStats.alltime += agentStats.alltime;
    }
  });

  displayAgents.push({
    name: 'Direct Tool Calls',
    icon: '⚡',
    title: 'Non-agent / direct MCP tools usage',
    today: directStats.today,
    last7days: directStats.last7days,
    alltime: directStats.alltime,
    isRegistered: false
  });

  // Display Table
  sectionTitle('Call Frequency Summary:', NINJA_THEME);

  const headers = ['Subagent', 'Today', '7 Days', 'All Time'];
  const aligns = ['left', 'right', 'right', 'right'];

  const rows = displayAgents.map(da => [
    `${da.icon} ${da.name}`,
    da.today,
    da.last7days,
    da.alltime
  ]);

  const widths = computeTableWidths(headers, rows, {
    minWidths: [18, 6, 8, 10],
    maxWidths: [22, 8, 10, 12]
  });

  drawTable(headers, widths, aligns, rows, [], NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.85),
      (cell) => applyGradient(cell, LEAF_THEME, 0.9),
      (cell) => applyGradient(cell, FIRE_THEME, 0.9)
    ]
  });
  log('');
}


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


async function cmdAgent(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdAgentHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'list': {
      const agents = agentManager.loadAgents(false, true);
      if (agents.length === 0) {
        warn('No subagents found.');
        break;
      }

      const wantsTui = (subArgs.includes('--tui') || subArgs.includes('--interactive') || subArgs.includes('-i')) &&
        process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function';

      if (!wantsTui) {
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
            if (cellLen > maxLen) {
              maxLen = cellLen;
            }
          });
          return maxLen;
        });

        const rowColors = agents.map(() => [
          C.cyan,
          C.reset,
          C.green,
          C.dim
        ]);

        drawTable(headers, widths, aligns, rows, rowColors);
        log('');
        break;
      }

      await startAgentTui(agents);
      break;
    }
    case 'models': {
      await cmdAgentModels(subArgs);
      break;
    }
    case 'create': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent create <agent-name> [options]');
        process.exit(1);
      }
      
      const options = {};
      const titleIdx = subArgs.indexOf('--title');
      if (titleIdx >= 0 && subArgs[titleIdx + 1]) options.title = subArgs[titleIdx + 1];
      
      const purposeIdx = subArgs.indexOf('--purpose');
      if (purposeIdx >= 0 && subArgs[purposeIdx + 1]) options.purpose = subArgs[purposeIdx + 1];
      
      const instrIdx = subArgs.indexOf('--instructions');
      if (instrIdx >= 0 && subArgs[instrIdx + 1]) options.instructions = subArgs[instrIdx + 1];
      
      const keywordsIdx = subArgs.indexOf('--keywords');
      if (keywordsIdx >= 0 && subArgs[keywordsIdx + 1]) options.delegationKeywords = subArgs[keywordsIdx + 1];

      const manualIdx = subArgs.indexOf('--manual');
      if (manualIdx >= 0) options.manual = true;

      try {
        const newAgent = agentManager.createSubagent(name, options);
        success(`Successfully created subagent: @${newAgent.name}`);
        info('Updated configurations and deployed to ~/.agents/agents.yaml');
      } catch (err) {
        error(`Failed to create subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'skill': {
      let agentName = subArgs[0];
      let agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        process.exit(1);
      }

      const agentPassedOnCli = !!agentName;
      if (agentPassedOnCli) {
        const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (!found) {
          error(`Subagent "@${agentName}" not found.`);
          process.exit(1);
        }
        agentName = found.name;
      }

      // Check if direct skill argument was passed, e.g. konoha agent skill anbu <skill-name>
      if (agentPassedOnCli && subArgs[1]) {
        const targetSkill = subArgs[1];
        try {
          const ok = agentManager.embedSkill(agentName, targetSkill);
          if (ok) {
            success(`Successfully embedded skill "${targetSkill}" into @${agentName}`);
          } else {
            warn(`Skill "${targetSkill}" is already embedded in @${agentName}`);
          }
          info('Re-deployed team configurations.');
        } catch (err) {
          error(`Failed to embed skill: ${err.message}`);
          process.exit(1);
        }
        break;
      }

      if (!process.stdin || !process.stdin.isTTY) {
        header(agentPassedOnCli ? `Skills Status for @${agentName}` : 'All Subagents Skills Status');
        const targetAgents = agentPassedOnCli ? [agents.find(a => a.name === agentName)] : agents;
        targetAgents.forEach(a => {
          log(`  ${C.bold}${a.icon || '👤'} @${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsList}${C.reset}\n`);
        });
        info('Tip: Run interactively in a TTY, or use: konoha skill <skillname> embed <agentname>');
        break;
      }

      let step = agentPassedOnCli ? 'SELECT_SKILL' : 'SELECT_AGENT';
      
      while (true) {
        if (step === 'SELECT_AGENT') {
          header('Choose Subagent');
          agents.forEach((a, idx) => {
            const numStr = `${idx + 1}`.padStart(2);
            log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}@${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
            const skillsStr = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
            log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsStr}${C.reset}\n`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back / Exit${C.reset}`);

          const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
          if (isCancel(ans)) {
            info('Exiting skill configuration.');
            break;
          }

          const num = parseInt(ans, 10);
          if (isNaN(num) || num < 1 || num > agents.length) {
            error('Invalid subagent selection.');
            continue;
          }
          agentName = agents[num - 1].name;
          step = 'SELECT_SKILL';
        }
        
        else if (step === 'SELECT_SKILL') {
          // Reload agents to get the most up-to-date skills status
          agents = agentManager.loadAgents();
          const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
          if (!agent) {
            error(`Error: agent @${agentName} could not be loaded.`);
            step = 'SELECT_AGENT';
            continue;
          }

          // Get all installed skills
          const installedSkills = skillManager.listInstalledSkills();
          const allUniqueSkills = new Map();
          
          const defaultSkills = [
            { name: 'genin-skill', description: 'Codebase Reconnaissance & Trace SOPs' },
            { name: 'kage-skill', description: 'Architecture & Strategy SOPs' },
            { name: 'chunin-skill', description: 'Research & Intel SOPs' },
            { name: 'jonin-skill', description: 'UI & Frontend Specialist SOPs' },
            { name: 'anbu-skill', description: 'Backend, Bug Fixing & DevOps SOPs' },
            { name: 'tokubetsu-jonin-skill', description: 'Technical Scribe SOPs' }
          ];
          defaultSkills.forEach(s => {
            allUniqueSkills.set(s.name, s.description);
          });

          installedSkills.forEach(s => {
            allUniqueSkills.set(s.name, s.description);
          });

          agents.forEach(a => {
            if (a.skills) {
              a.skills.forEach(s => {
                if (!allUniqueSkills.has(s)) {
                  allUniqueSkills.set(s, 'Currently embedded skill');
                }
              });
            }
          });

          const skillList = Array.from(allUniqueSkills.entries()).map(([name, desc]) => ({
            name,
            description: desc
          })).sort((a, b) => a.name.localeCompare(b.name));

          if (skillList.length === 0) {
            warn('No skills found. Install some skills first using "konoha skill search" or "konoha skill add".');
            if (agentPassedOnCli) {
              break;
            } else {
              step = 'SELECT_AGENT';
              continue;
            }
          }

          header(`Configure Skills for @${agentName}`);
          log('Select a skill to toggle (embed / unembed):');
          skillList.forEach((s, idx) => {
            const isEmbedded = agent.skills && agent.skills.includes(s.name);
            const statusIcon = isEmbedded 
              ? `${C.green}✨ [✓] Embedded${C.reset}` 
              : `${C.dim}   [ ] Not Embedded${C.reset}`;
            const numStr = `${idx + 1}`.padStart(2);
            log(`  ${C.cyan}[${numStr}]${C.reset} ${statusIcon} ${C.bold}${s.name}${C.reset}`);
            log(`       ${C.dim}${s.description}${C.reset}\n`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back${C.reset}`);

          const skillAns = await askQuestion(`\nSelect skill to toggle (1-${skillList.length}): `);
          if (isCancel(skillAns)) {
            if (agentPassedOnCli) {
              info('Exiting skill configuration.');
              break;
            } else {
              step = 'SELECT_AGENT';
              continue;
            }
          }

          const skillNum = parseInt(skillAns, 10);
          if (isNaN(skillNum) || skillNum < 1 || skillNum > skillList.length) {
            error('Invalid skill selection.');
            continue;
          }

          const selectedSkill = skillList[skillNum - 1].name;
          const isCurrentlyEmbedded = agent.skills && agent.skills.includes(selectedSkill);

          try {
            if (isCurrentlyEmbedded) {
              agentManager.unembedSkill(agentName, selectedSkill);
              success(`Successfully removed skill "${selectedSkill}" from @${agentName}`);
            } else {
              agentManager.embedSkill(agentName, selectedSkill);
              success(`Successfully embedded skill "${selectedSkill}" into @${agentName}`);
            }
            info('Re-deployed team configurations.');
          } catch (err) {
            error(`Failed to toggle skill: ${err.message}`);
          }
          // The loop automatically continues, displaying the updated list!
        }
      }
      break;
    }
    case 'delete': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent delete <agent-name>');
        process.exit(1);
      }
      try {
        // 1. Try to delete from agents.yaml
        let deletedFromJson = false;
        try {
          agentManager.deleteAgent(name);
          deletedFromJson = true;
        } catch (err) {
          if (!err.message.includes('not found')) {
            throw err;
          }
        }

        // 2. Try to prune from database tool_calls
        let deletedFromDb = false;
        if (fileExists(DB_PATH)) {
          try {
            const { pruneAgentStats } = require('../../src/agent_stats');
            const res = pruneAgentStats(name, DB_PATH);
            if (res && res.success && res.deleted_count > 0) {
              deletedFromDb = true;
            }
          } catch (e) {
            warn(`Failed to prune database statistics: ${e.message}`);
          }
        }

        if (deletedFromJson || deletedFromDb) {
          success(`Successfully deleted/pruned subagent: @${name}`);
          if (deletedFromJson) {
            info('Updated and redeployed configurations.');
          }
          if (deletedFromDb) {
            info('Pruned historical call statistics from database.');
          }
        } else {
          error(`Failed to delete subagent: Subagent "${name}" not found in configuration or statistics.`);
          process.exit(1);
        }
      } catch (err) {
        error(`Failed to delete subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'status': {
      await cmdAgentStatus();
      break;
    }
    default:
      error(`Unknown agent subcommand: ${subcommand}`);
      log(`Available subcommands: list, create, skill, delete, status`);
      process.exit(1);
  }
}


const AVAILABLE_MODELS = [
  { name: 'Gemini 3.5 Flash (Low)', tag: 'Fast', aliases: ['flash-low', 'gemini-3.5-flash-low', 'low'] },
  { name: 'Gemini 3.5 Flash (Medium)', tag: 'Fast', aliases: ['flash-medium', 'gemini-3.5-flash-medium', 'medium'] },
  { name: 'Gemini 3.5 Flash (High)', tag: 'Fast', aliases: ['flash-high', 'gemini-3.5-flash-high', 'high'] },
  { name: 'Gemini 3.6 Flash (Low)', tag: 'Fast', aliases: ['flash-3.6-low', 'gemini-3.6-flash-low', '3.6-low'] },
  { name: 'Gemini 3.6 Flash (Medium)', tag: 'Fast', aliases: ['flash-3.6-medium', 'gemini-3.6-flash-medium', '3.6-medium'] },
  { name: 'Gemini 3.6 Flash (High)', tag: 'Fast', aliases: ['flash-3.6-high', 'gemini-3.6-flash-high', '3.6-high'] },
  { name: 'Gemini 3.7 Flash (Low)', tag: 'Fast', aliases: ['flash-3.7-low', 'gemini-3.7-flash-low', '3.7-low'] },
  { name: 'Gemini 3.7 Flash (Medium)', tag: 'Fast', aliases: ['flash-3.7-medium', 'gemini-3.7-flash-medium', '3.7-medium'] },
  { name: 'Gemini 3.7 Flash (High)', tag: 'Fast', aliases: ['flash-3.7-high', 'gemini-3.7-flash-high', '3.7-high'] },
  { name: 'Gemini 3.1 Pro (Low)', tag: 'Standard', aliases: ['pro-low', 'gemini-3.1-pro-low'] },
  { name: 'Gemini 3.1 Pro (High)', tag: 'Standard', aliases: ['pro-high', 'gemini-3.1-pro-high'] },
  { name: 'Claude Sonnet 4.6 (Thinking)', tag: 'Reasoning', aliases: ['sonnet', 'sonnet-4.6', 'claude-sonnet-4.6', 'sonnet-thinking'] },
  { name: 'Claude Opus 4.6 (Thinking)', tag: 'Advanced', aliases: ['opus', 'opus-4.6', 'claude-opus-4.6', 'opus-thinking'] },
];

async function getActiveModels() {
  const models = [...AVAILABLE_MODELS];
  const bridges = loadBridges();
  const existing = new Set(models.map(m => m.name.toLowerCase()));

  // Query each bridge's backend target for models, add prefixed versions
  const bridgeList = bridges.filter(b => b.enabled && b.targetUrl);
  const bridgeTargets = bridgeList.map(async bridge => {
    const targetPath = bridge.targetUrl.endsWith('/v1') ? bridge.targetUrl + '/models' : bridge.targetUrl;
    const parsed = new URL(targetPath);
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    const headers = {};
    if (bridge.apiKey) {
      headers['Authorization'] = `Bearer ${bridge.apiKey}`;
    }
    return new Promise((resolveInner) => {
      const req = mod.get(url, { headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolveInner(JSON.parse(d)); } catch { resolveInner(null); }
        });
      });
      req.on('error', () => resolveInner(null));
      req.setTimeout(8000, () => { req.destroy(); resolveInner(null); });
    });
  });
  const targets = await Promise.all(bridgeTargets);

  for (let i = 0; i < targets.length; i++) {
    const bridge = bridgeList[i];
    const targetJson = targets[i];
    if (!targetJson || !Array.isArray(targetJson.data)) continue;
    for (const m of targetJson.data) {
      const id = m.id;
      const prefixedId = `${bridge.name}-${id}`;
      if (!existing.has(prefixedId.toLowerCase())) {
        let tag = 'Bridge';
        if (id.includes('claude')) tag = 'Reasoning';
        else if (id.includes('gpt')) tag = 'Standard';
        else if (id.includes('gemini')) {
          if (id.includes('flash')) tag = 'Fast';
          else tag = 'Standard';
        }
        models.push({ name: prefixedId, tag, aliases: [prefixedId.toLowerCase()] });
        existing.add(prefixedId.toLowerCase());
      }
    }
  }

  return models;
}



module.exports = {
  cmdAgent,
  cmdAgentHelp,
  cmdAgentStatus,
  cmdAgentModels,
  startAgentTui,
  startAgentModelTui,
  getActiveModels,
  AVAILABLE_MODELS
};
