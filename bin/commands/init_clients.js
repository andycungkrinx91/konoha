'use strict';

const cursorManager = require('../../src/cursor_manager');
const antigravityManager = require('../../src/antigravity_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const ompManager = require('../../src/omp_manager');
const agentManager = require('../../src/agent_manager');
const { registerMcp, registerHooks } = require('../lib/runtime_mcp');
const { SERVER_PATH, FILE_TOOLS_LAUNCHER_JS } = require('../lib/paths');
const { header, info } = require('../lib/format');
const { startSpinner } = require('../lib/prompt');

function normalizeClientToken(token) {
  const clean = String(token || '').trim().toLowerCase();
  if (clean === 'claude-code' || clean === 'claudecode') return 'claude';
  if (clean === 'command-code') return 'commandcode';
  if (clean === 'gemini' || clean === 'antigravity-ide' || clean === 'antigravity-cli') return 'antigravity';
  return clean;
}

function parseRequestedClients(args) {
  const clientFlag = args.find(a => a.startsWith('--client=') || a.startsWith('--clients='));
  if (clientFlag) {
    const val = clientFlag.split('=')[1].toLowerCase();
    return val === 'all' ? ['all'] : val.split(',').map(normalizeClientToken).filter(Boolean);
  }
  const clientIdx = args.indexOf('--client');
  if (clientIdx !== -1 && args[clientIdx + 1]) {
    const val = args[clientIdx + 1].toLowerCase();
    return val === 'all' ? ['all'] : val.split(',').map(normalizeClientToken).filter(Boolean);
  }
  return null;
}

function configureAntigravity(context) {
  if (!context.allowAntigravity) return;
  header('🌌 Configuring Antigravity IDE/CLI');
  const spinner = startSpinner('Registering Antigravity MCP, rules, and permissions...');
  registerMcp(context.python, true, true);
  registerHooks(true, true);
  const agSetup = antigravityManager.ensureAntigravitySetup({
    silent: true,
    projectRoot: context.currentCwd,
    deployProject: context.deployProject,
    appendProject: context.appendProject,
    home: context.home
  });
  if (agSetup.ok) spinner.success('Antigravity IDE/CLI configured.');
  else spinner.warn(`Antigravity setup skipped: ${agSetup.reason || 'unknown error'}`);
}

function configureCursor(context) {
  const { allowCursor, python, setupAgents, currentCwd, deployProject, appendProject, home } = context;
  if (!allowCursor) return;
  header('🖱️  Configuring Cursor IDE/CLI');
  const spinner = startSpinner('Registering Cursor MCP, subagents, and permissions...');
  const cursorSetup = cursorManager.ensureCursorSetup({
    pythonCmd: python,
    serverPath: SERVER_PATH,
    agents: setupAgents,
    projectRoot: currentCwd,
    deployProject: Boolean(deployProject),
    appendProject: Boolean(appendProject),
    home,
    silent: true,
    allowHooks: true,
    ruleContent: null
  });
  if (cursorSetup.ok) spinner.success('Cursor IDE/CLI configured.');
  else spinner.warn(`Cursor setup skipped: ${cursorSetup.reason || 'unknown error'}`);
}

function configureClaudeCode(context) {
  const { allowClaudeCode, claudeInstalled, python, setupAgents, currentCwd, deployProject, appendProject, home } = context;
  if (allowClaudeCode) {
    header('🤖 Configuring Claude Code');
    const spinner = startSpinner('Registering Claude Code MCP servers...');
    const claudeSetup = mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      ruleContent: agentManager.generateClaudeCodeMd(setupAgents),
      silent: true,
      agents: setupAgents,
      projectRoot: currentCwd,
      deployProject: Boolean(deployProject),
      appendProject: Boolean(appendProject),
      home,
      force: true,
      skipDetection: true
    });
    if (claudeSetup.ok) spinner.success('Claude Code MCP configured.');
    else spinner.warn(`Claude Code setup skipped: ${claudeSetup.reason || 'unknown error'}`);
  } else if (!claudeInstalled && context.explicitSelection) {
    info('Claude Code not detected — skip auto-setup (see docs/templates/claude-code.mcp.json if you install later).');
  }
}

function _buildStandardClientSetupOptions(context) {
  return {
    pythonCmd: context.python,
    serverPath: SERVER_PATH,
    projectRoot: context.currentCwd,
    deployProject: Boolean(context.deployProject),
    appendProject: Boolean(context.appendProject),
    home: context.home,
    silent: true,
    force: true,
    skipDetection: true
  };
}

function configureOpenCode(context) {
  if (!context.allowOpenCode) return;
  header('🟢 Configuring OpenCode');
  const spinner = startSpinner('Registering OpenCode MCP servers and RTK rules...');
  const openCodeSetup = opencodeManager.ensureOpenCodeSetup(_buildStandardClientSetupOptions(context));
  if (openCodeSetup.ok) spinner.success('OpenCode MCP and RTK configured.');
  else spinner.warn(`OpenCode setup skipped: ${openCodeSetup.reason || 'unknown error'}`);
}

function configureCommandCode(context) {
  if (!context.allowCommandCode) return;
  header('⚡ Configuring Command Code');
  const spinner = startSpinner('Registering Command Code MCP servers and RTK rules...');
  const commandCodeSetup = mcpClientsManager.ensureCommandCodeSetup(_buildStandardClientSetupOptions(context));
  if (commandCodeSetup.ok) spinner.success('Command Code MCP and RTK configured.');
  else spinner.warn(`Command Code setup skipped: ${commandCodeSetup.reason || 'unknown error'}`);
}

function configureCodex(context) {
  if (!context.allowCodex) return;
  header('📖 Configuring Codex');
  const spinner = startSpinner('Registering Codex MCP servers, instructions, and RTK rules...');
  const codexSetup = codexManager.ensureCodexSetup(_buildStandardClientSetupOptions(context));
  if (codexSetup.ok) spinner.success('Codex MCP and RTK configured.');
  else spinner.warn(`Codex setup skipped: ${codexSetup.reason || 'unknown error'}`);
}

function configurePi(context) {
  if (!context.allowPi) return;
  header('🥧 Configuring Pi (pi.dev)');
  const spinner = startSpinner('Registering Pi MCP servers, subagents, and pi-mcp-adapter...');
  const piSetup = piManager.ensurePiSetup(_buildStandardClientSetupOptions(context));
  if (piSetup.ok) spinner.success('Pi pi.dev configured (mcp.json + pi-mcp-adapter).');
  else spinner.warn(`Pi setup skipped: ${piSetup.reason || 'unknown error'}`);
}

function configureOmp(context) {
  if (!context.allowOmp) return;
  header('🔴 Configuring OMP (oh-my-pi)');
  const spinner = startSpinner('Registering OMP MCP servers, subagents, and tools...');
  const ompSetup = ompManager.ensureOmpSetup({
    nodeCmd: process.execPath,
    launcherPath: FILE_TOOLS_LAUNCHER_JS,
    projectRoot: context.currentCwd,
    deployProject: Boolean(context.deployProject),
    appendProject: Boolean(context.appendProject),
    home: context.home,
    silent: true,
    force: true
  });
  if (ompSetup.ok) spinner.success('OMP configured (plugins + AGENTS.md + MCP tools).');
  else spinner.warn(`OMP setup skipped: ${ompSetup.reason || 'unknown error'}`);
}

function setupClientIntegrations(options) {
  const { onProgress } = options;
  if (onProgress) onProgress(4, 'MCP Clients', 'Configuring requested AI coding clients');
  configureAntigravity(options);
  configureCursor(options);
  configureClaudeCode(options);
  configureOpenCode(options);
  configureCommandCode(options);
  configureCodex(options);
  configurePi(options);
  configureOmp(options);
}

module.exports = {
  parseRequestedClients,
  setupClientIntegrations
};
