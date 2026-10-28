'use strict';

const agentManager = require('../../src/agent_manager');
const { DB_PATH } = require('../lib/paths');
const { fileExists } = require('../../src/platform_utils');
const {
  header,
  sectionTitle,
  log,
  warn,
  drawTable,
  computeTableWidths,
  applyGradient,
  drawLogo,
  NINJA_THEME,
  CHIDORI_THEME,
  LEAF_THEME,
  FIRE_THEME
} = require('../lib/format');

function retrieveAgentStats() {
  if (!fileExists(DB_PATH)) return {};
  try {
    const agentStatsModule = require('../../src/agent_stats');
    const stats = agentStatsModule.getAgentStats(DB_PATH);
    return stats.error ? {} : stats;
  } catch (e) {
    warn(`Failed to retrieve stats: ${e.message}`);
    return {};
  }
}

function buildRegisteredAgentList(agents, stats, registeredNames) {
  const displayAgents = [];
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
  return displayAgents;
}

function aggregateDirectStats(stats, registeredNames) {
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
  return directStats;
}

async function cmdAgentStatus() {
  drawLogo();
  header('🥷 Agent Call Statistics');

  const agents = agentManager.loadAgents(false, true);
  const stats = retrieveAgentStats();

  const registeredNames = new Set();
  const displayAgents = buildRegisteredAgentList(agents, stats, registeredNames);
  const directStats = aggregateDirectStats(stats, registeredNames);

  displayAgents.push({
    name: 'Direct Tool Calls',
    icon: '⚡',
    title: 'Non-agent / direct MCP tools usage',
    today: directStats.today,
    last7days: directStats.last7days,
    alltime: directStats.alltime,
    isRegistered: false
  });

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

module.exports = {
  cmdAgentStatus
};
