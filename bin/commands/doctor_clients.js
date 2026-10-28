'use strict';

const { spawnSync } = require('child_process');
const cursorManager = require('../../src/cursor_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const agentManager = require('../../src/agent_manager');
const { installAgentBrowser, getAgentBrowserCommand, getUvxCommand } = require('../lib/extension');
const { checkPython } = require('../lib/runtime_lifecycle');
const { SERVER_PATH } = require('../lib/paths');

function checkCursorClient(clientOptions, context) {
  if (!cursorManager.isCursorInstalled()) return;
  const cursorStatus = cursorManager.getCursorStatus();
  if (cursorStatus.mcpSkillsDb && cursorStatus.mcpSemble && cursorStatus.mcpKonoha) {
    context.record('Cursor IDE/CLI (~/.cursor/)', 'HEALTHY', 'MCP and hooks configured');
    return;
  }
  try {
    cursorManager.ensureCursorSetup(clientOptions);
    const repaired = cursorManager.getCursorStatus();
    if (repaired.mcpKonoha && repaired.mcpSemble) {
      context.record('Cursor IDE/CLI (~/.cursor/)', 'REPAIRED', 'Registered MCP and session hook');
      context.incrementRepairs();
    } else {
      context.record('Cursor IDE/CLI (~/.cursor/)', 'WARNING', 'Partial Cursor setup — run konoha init');
    }
  } catch (e) {
    context.record('Cursor IDE/CLI (~/.cursor/)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkClaudeCodeClient(context) {
  if (!mcpClientsManager.isClaudeCodeInstalled()) return;
  const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
  if (claudeStatus.mcpKonoha && claudeStatus.mcpSemble && claudeStatus.mcpAislop && claudeStatus.permissionsAllowed) {
    context.record('Claude Code (~/.claude.json)', 'HEALTHY', 'konoha, semble, and aislop active & allowed');
    return;
  }
  try {
    const python = checkPython() || 'python3';
    const agents = agentManager.loadAgents();
    const ruleContent = agentManager.generateClaudeCodeMd(agents);
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      ruleContent,
      silent: true
    });
    const repaired = mcpClientsManager.getClaudeCodeStatus();
    if (repaired.mcpKonoha && repaired.mcpSemble && repaired.permissionsAllowed) {
      context.record('Claude Code (~/.claude.json)', 'REPAIRED', 'Registered Konoha MCP servers & allowed tools');
      context.incrementRepairs();
    } else {
      context.record('Claude Code (~/.claude.json)', 'WARNING', 'Partial Claude Code setup — run konoha init');
    }
  } catch (e) {
    context.record('Claude Code (~/.claude.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkOpenCodeClient(clientOptions, context) {
  if (!opencodeManager.isOpenCodeInstalled()) return;
  const openCodeStatus = opencodeManager.getOpenCodeStatus();
  if (openCodeStatus.mcpKonoha && openCodeStatus.mcpSemble && openCodeStatus.mcpAislop) {
    context.record('OpenCode (~/.opencode/config.json)', 'HEALTHY', 'konoha, semble, and aislop active');
    return;
  }
  try {
    opencodeManager.ensureOpenCodeSetup(clientOptions);
    const repaired = opencodeManager.getOpenCodeStatus();
    if (repaired.mcpKonoha && repaired.mcpSemble) {
      context.record('OpenCode (~/.opencode/config.json)', 'REPAIRED', 'Registered MCP and session hook');
      context.incrementRepairs();
    } else {
      context.record('OpenCode (~/.opencode/config.json)', 'WARNING', 'Partial OpenCode setup — run konoha init');
    }
  } catch (e) {
    context.record('OpenCode (~/.opencode/config.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkCommandCodeClient(context) {
  if (!mcpClientsManager.isCommandCodeInstalled()) return;
  const cmdStatus = mcpClientsManager.getCommandCodeStatus();
  if (cmdStatus.mcpKonoha && cmdStatus.mcpSemble && cmdStatus.mcpAislop) {
    context.record('Command Code (~/.commandcode/mcp.json)', 'HEALTHY', 'konoha, semble, and aislop active');
    return;
  }
  try {
    const python = checkPython() || 'python3';
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    const repaired = mcpClientsManager.getCommandCodeStatus();
    if (repaired.mcpKonoha && repaired.mcpSemble) {
      context.record('Command Code (~/.commandcode/mcp.json)', 'REPAIRED', 'Registered Konoha MCP servers');
      context.incrementRepairs();
    } else {
      context.record('Command Code (~/.commandcode/mcp.json)', 'WARNING', 'Partial Command Code setup — run konoha init');
    }
  } catch (e) {
    context.record('Command Code (~/.commandcode/mcp.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkCodexClient(context) {
  if (!codexManager.isCodexInstalled()) return;
  const codexStatus = codexManager.getCodexStatus();
  if (codexStatus.mcpKonoha && codexStatus.mcpSemble && codexStatus.mcpAislop) {
    context.record('Codex (~/.codex/config.toml)', 'HEALTHY', 'konoha, semble, and aislop active');
    return;
  }
  try {
    const python = checkPython() || 'python3';
    codexManager.ensureCodexSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    const repaired = codexManager.getCodexStatus();
    if (repaired.mcpKonoha && repaired.mcpSemble) {
      context.record('Codex (~/.codex/config.toml)', 'REPAIRED', 'Registered Konoha MCP servers');
      context.incrementRepairs();
    } else {
      context.record('Codex (~/.codex/config.toml)', 'WARNING', 'Partial Codex setup — run konoha init');
    }
  } catch (e) {
    context.record('Codex (~/.codex/config.toml)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkPiClient(context) {
  if (!piManager.isPiInstalled()) return;
  const piStatus = piManager.getPiStatus();
  if (piStatus.mcpKonoha && piStatus.adapterInstalled && piStatus.contractDeployed && piStatus.blockerDeployed) {
    context.record('Pi pi.dev (~/.pi/agent/mcp.json)', 'HEALTHY', 'pi-mcp-adapter + konoha contract deployed; workflow routing active');
    return;
  }
  try {
    const python = checkPython() || 'python3';
    piManager.ensurePiSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    const repaired = piManager.getPiStatus();
    if (repaired.mcpKonoha && repaired.adapterInstalled) {
      context.record('Pi pi.dev (~/.pi/agent/mcp.json)', 'REPAIRED', repaired.contractDeployed
        ? 'Registered Konoha MCP servers via pi-mcp-adapter; runtime contract deployed'
        : 'Registered Konoha MCP servers via pi-mcp-adapter');
      context.incrementRepairs();
    } else {
      context.record('Pi pi.dev (~/.pi/agent/mcp.json)', 'WARNING', 'Partial Pi setup — run konoha init');
    }
  } catch (e) {
    context.record('Pi pi.dev (~/.pi/agent/mcp.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function inspectBrowserDoctor(agentBrowserCmd) {
  try {
    const docRes = spawnSync(agentBrowserCmd, ['doctor', '--offline', '--quick'], { encoding: 'utf-8', shell: process.platform === 'win32' });
    if (docRes.status === 0 && (docRes.stdout.includes('Google Chrome') || docRes.stdout.includes('Chromium'))) {
      return ' (Chrome ready)';
    }
  } catch { /* intentional fallback */ }
  return '';
}

function tryInstallAgentBrowserCli(context) {
  try {
    const repaired = installAgentBrowser(true);
    const agentBrowserCmd = getAgentBrowserCommand();
    if (repaired && agentBrowserCmd) {
      context.record('agent-browser CLI', 'REPAIRED', 'Auto-installed agent-browser CLI');
      context.incrementRepairs();
      return;
    }
  } catch { /* intentional fallback */ }
  context.record('agent-browser CLI', 'WARNING', 'Missing agent-browser (run: pnpm add -g agent-browser && agent-browser install)');
}

function checkAgentBrowserClient(context) {
  const agentBrowserCmd = getAgentBrowserCommand();
  if (!agentBrowserCmd) {
    tryInstallAgentBrowserCli(context);
    return;
  }

  let agentBrowserVersion = '';
  try {
    const abVerRes = spawnSync(agentBrowserCmd, ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
    if (abVerRes.status === 0) agentBrowserVersion = abVerRes.stdout.trim();
  } catch { /* intentional fallback */ }

  const chromeDetail = inspectBrowserDoctor(agentBrowserCmd);
  context.record('agent-browser CLI', 'ACTIVE', `${agentBrowserVersion || 'Installed'}${chromeDetail}`);
}

function checkAndRepairClientConfigs(clientOptions, context) {
  checkCursorClient(clientOptions, context);
  checkClaudeCodeClient(context);
  checkOpenCodeClient(clientOptions, context);
  checkCommandCodeClient(context);
  checkCodexClient(context);
  checkPiClient(context);
  checkAgentBrowserClient(context);
}

module.exports = {
  checkAndRepairClientConfigs
};
