'use strict';

const {
  C,
  header,
  log,
  drawTable,
  NINJA_THEME,
  RASENGAN_THEME,
  getVisualLength,
  padEndVisual
} = require('../lib/format');

function buildListRows(agents, selectedIndex) {
  return agents.map((a, idx) => {
    const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
    const indicator = idx === selectedIndex ? '➔' : ' ';
    return [
      indicator,
      `${a.icon || '👤'} @${a.name}`,
      a.title || 'Ninja',
      skillsList
    ];
  });
}

function computeListColumnWidths(headers, rows) {
  return headers.map((h, colIdx) => {
    if (colIdx === 0) return 2;
    let maxLen = getVisualLength(h);
    for (const row of rows) {
      const cellLen = getVisualLength(row[colIdx]);
      if (cellLen > maxLen) maxLen = cellLen;
    }
    return maxLen;
  });
}

function renderAgentListView(agents, selectedIndex) {
  header('🥷 Subagents Interactive Explorer');
  log(`  ${C.dim}Use ↑/↓ keys to navigate, Press Enter to view details, ESC to exit${C.reset}\n`);

  const headers = [' ', 'Subagent', 'Title', 'Active Skills'];
  const aligns = ['left', 'left', 'left', 'left'];
  const rows = buildListRows(agents, selectedIndex);
  const widths = computeListColumnWidths(headers, rows);

  const rowColors = agents.map((_, idx) => {
    if (idx === selectedIndex) {
      return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.magenta];
    }
    return [C.dim, C.cyan, C.reset, C.bold + C.magenta];
  });

  drawTable(headers, widths, aligns, rows, rowColors, NINJA_THEME);
  log('');
}

function findLineSplitIndex(remaining, contentWidth) {
  let splitIdx = 0;
  let currentVisualLen = 0;
  for (let i = 0; i < remaining.length; i++) {
    const code = remaining.charCodeAt(i);
    const charLen = (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
    if (currentVisualLen + charLen > contentWidth) {
      splitIdx = i;
      break;
    }
    currentVisualLen += charLen;
    if (charLen === 2) i++;
  }
  return splitIdx;
}

function wrapDetailLineText(text, contentWidth) {
  let remaining = String(text);
  const lines = [];
  while (getVisualLength(remaining) > contentWidth) {
    const splitIdx = findLineSplitIndex(remaining, contentWidth);
    lines.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx);
  }
  lines.push(remaining);
  return lines;
}

function printDetailLine(label, val, boxWidth, color = C.reset) {
  const contentWidth = boxWidth - 17;
  const d = C.dim;
  const r = C.reset;
  const lines = wrapDetailLineText(val, contentWidth);

  lines.forEach((line, idx) => {
    const lbl = idx === 0 ? padEndVisual(label, 12) : ' '.repeat(12);
    const formatted = `${d}│${r} ${C.bold}${lbl}${C.reset} ${d}➔${r} ${color}${padEndVisual(line, contentWidth)}${r} ${d}│${r}`;
    log(`    ${formatted}`);
  });
}

function printWrappedWords(words, contentWidth, d, r) {
  let line = '';
  for (const word of words) {
    if (getVisualLength(line + word) > contentWidth) {
      log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
      line = `${word} `;
    } else {
      line += `${word} `;
    }
  }
  if (line.trim()) {
    log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
  }
}

function printMultiLineSection(title, text, boxWidth) {
  const d = C.dim;
  const r = C.reset;
  const contentWidth = boxWidth - 2;
  log(`    ${d}│${r} ${C.bold}${padEndVisual(title, contentWidth)}${r} ${d}│${r}`);

  const paragraphs = text.split('\n');
  for (const p of paragraphs) {
    if (!p.trim()) continue;
    printWrappedWords(p.split(' '), contentWidth, d, r);
  }
}

function renderAgentDetailView(agent) {
  header(`🥷 Subagent Details: ${agent.icon || '👤'} @${agent.name}`);
  log(`  ${C.dim}Press ESC or Backspace to return to list${C.reset}\n`);

  const boxWidth = 80;
  const d = C.dim;
  const r = C.reset;

  log(`    ${d}┌${'─'.repeat(boxWidth)}┐${r}`);
  printDetailLine('Icon', agent.icon || '👤', boxWidth, C.yellow);
  printDetailLine('Name', `@${agent.name}`, boxWidth, C.cyan);
  printDetailLine('Title', agent.title || 'Ninja', boxWidth, C.white);
  printDetailLine('Purpose', agent.purpose || 'General assistant', boxWidth, C.reset);
  printDetailLine('Skills', agent.skills && agent.skills.length > 0 ? agent.skills.join(', ') : 'None', boxWidth, C.magenta);
  printDetailLine('Model', agent.model || 'inherit', boxWidth, C.green);
  printDetailLine('Keywords', agent.delegationKeywords || agent.name, boxWidth, C.yellow);

  log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
  printMultiLineSection('Description/Purpose:', agent.description || agent.purpose || 'Custom subagent.', boxWidth);
  log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
  printMultiLineSection('Constraints:', agent.constraints || 'None', boxWidth);
  log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
  printMultiLineSection('Workflow:', agent.workflow || 'Process input and report findings.', boxWidth);
  log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
  printMultiLineSection('Instructions:', agent.instructions || 'General instructions.', boxWidth);
  log(`    ${d}└${'─'.repeat(boxWidth)}┘${r}\n`);
}

function setupRawStdin() {
  if (process.stdin && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  if (process.stdin) {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }
}

function teardownRawStdin(onKey) {
  if (process.stdin) {
    process.stdin.removeListener('data', onKey);
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
  process.stdout.write('\x1b[?25h');
}

function handleAgentTuiListKey(options) {
  const { key, state, agents, cleanup, resolve } = options;
  if (key === '\u001b[A' || key === 'k') {
    state.selectedIndex = (state.selectedIndex - 1 + agents.length) % agents.length;
    return true;
  }
  if (key === '\u001b[B' || key === 'j') {
    state.selectedIndex = (state.selectedIndex + 1) % agents.length;
    return true;
  }
  if (key === '\r' || key === '\n') {
    state.viewMode = 'detail';
    return true;
  }
  if (key === '\u001b') {
    cleanup();
    resolve();
    return false;
  }
  return false;
}

function dispatchAgentTuiKey(key, state, context) {
  const { agents, cleanup, resolve, render } = context;
  if (key === '\u0003') {
    cleanup();
    process.exit(0);
  }
  if (state.viewMode === 'list') {
    if (handleAgentTuiListKey({ key, state, agents, cleanup, resolve })) render();
    return;
  }
  if (key === '\u001b' || key === '\u007f' || key === 'q' || key === '\b') {
    state.viewMode = 'list';
    render();
  }
}

function renderAgentTuiState(state, agents) {
  console.clear();
  if (state.viewMode === 'list') {
    renderAgentListView(agents, state.selectedIndex);
    return;
  }
  renderAgentDetailView(agents[state.selectedIndex]);
}

function startAgentTui(agents) {
  return new Promise((resolve) => {
    const state = { selectedIndex: 0, viewMode: 'list' };
    process.stdout.write('\x1b[?25l');

    const render = () => renderAgentTuiState(state, agents);
    render();
    setupRawStdin();

    function cleanup() {
      teardownRawStdin(onKey);
    }

    function onKey(key) {
      dispatchAgentTuiKey(key, state, { agents, cleanup, resolve, render });
    }

    if (process.stdin) process.stdin.on('data', onKey);
  });
}

function renderSelectAgentStep(agents, agentIndex) {
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
  const widths = computeListColumnWidths(headers, rows);
  const rowColors = agents.map((_, idx) => {
    if (idx === agentIndex) {
      return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.green];
    }
    return [C.dim, C.cyan, C.reset, C.green];
  });

  drawTable(headers, widths, aligns, rows, rowColors, NINJA_THEME);
  log('');
}

function renderSelectModelStep(agent, modelRows, modelIndex) {
  header(`🤖 Agent Model Config — Model for ${agent.icon || '👤'} @${agent.name}`);
  log(`  ${C.dim}Use ↑/↓ keys to navigate, Enter to assign, ESC to go back${C.reset}\n`);

  const headers = [' ', 'Model', 'Tag'];
  const aligns = ['left', 'left', 'left'];
  const rows = modelRows.map((m, idx) => [
    idx === modelIndex ? '➔' : ' ',
    m.name,
    m.tag || '-'
  ]);
  const widths = computeListColumnWidths(headers, rows);
  const rowColors = modelRows.map((_, idx) => {
    if (idx === modelIndex) return [C.bold + C.yellow, C.bold + C.white, C.bold + C.cyan];
    return [C.dim, C.reset, C.cyan];
  });

  drawTable(headers, widths, aligns, rows, rowColors, RASENGAN_THEME);
  log(`  ${C.dim}Current: ${C.reset}${C.green}${agent.model || 'inherit'}${C.reset}\n`);
}

function handleModelStepKey(options) {
  const { key, state, modelRows, agents, models, cleanup, resolve } = options;
  if (key === '\u001b[A' || key === 'k') {
    state.modelIndex = (state.modelIndex - 1 + modelRows.length) % modelRows.length;
    return true;
  }
  if (key === '\u001b[B' || key === 'j') {
    state.modelIndex = (state.modelIndex + 1) % modelRows.length;
    return true;
  }
  if (key === '\r' || key === '\n') {
    cleanup();
    const agent = agents[state.agentIndex];
    const model = state.modelIndex === 0 ? null : models[state.modelIndex - 1];
    resolve({ agent, model });
    return false;
  }
  if (key === '\u001b' || key === '\u007f' || key === 'q' || key === '\b') {
    state.step = 'SELECT_AGENT';
    return true;
  }
  return false;
}

function handleAgentStepKey(options) {
  const { key, state, agents, cleanup, resolve } = options;
  if (key === '\u001b[A' || key === 'k') {
    state.agentIndex = (state.agentIndex - 1 + agents.length) % agents.length;
    return true;
  }
  if (key === '\u001b[B' || key === 'j') {
    state.agentIndex = (state.agentIndex + 1) % agents.length;
    return true;
  }
  if (key === '\r' || key === '\n') {
    state.step = 'SELECT_MODEL';
    state.modelIndex = 0;
    return true;
  }
  if (key === '\u001b') {
    cleanup();
    resolve(null);
    return false;
  }
  return false;
}

function dispatchAgentModelKey(key, state, context) {
  const { agents, modelRows, models, cleanup, resolve, render } = context;
  if (key === '\u0003') {
    cleanup();
    process.exit(0);
  }
  if (state.step === 'SELECT_AGENT') {
    if (handleAgentStepKey({ key, state, agents, cleanup, resolve })) render();
    return;
  }
  if (handleModelStepKey({ key, state, modelRows, agents, models, cleanup, resolve })) render();
}

function renderAgentModelState(state, agents, modelRows) {
  console.clear();
  if (state.step === 'SELECT_AGENT') {
    renderSelectAgentStep(agents, state.agentIndex);
    return;
  }
  renderSelectModelStep(agents[state.agentIndex], modelRows, state.modelIndex);
}

function startAgentModelTui(agents, models) {
  return new Promise((resolve) => {
    const state = { step: 'SELECT_AGENT', agentIndex: 0, modelIndex: 0 };
    const inheritRow = { name: '⤺ Inherit (clear assignment)', tag: 'Host default' };
    const modelRows = [inheritRow, ...models];

    process.stdout.write('\x1b[?25l');

    const render = () => renderAgentModelState(state, agents, modelRows);
    render();
    setupRawStdin();

    function cleanup() {
      teardownRawStdin(onKey);
    }

    function onKey(key) {
      dispatchAgentModelKey(key, state, { agents, modelRows, models, cleanup, resolve, render });
    }

    if (process.stdin) process.stdin.on('data', onKey);
  });
}

module.exports = {
  startAgentTui,
  startAgentModelTui
};
