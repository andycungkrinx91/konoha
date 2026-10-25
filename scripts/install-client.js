#!/usr/bin/env node
'use strict';

/**
 * scripts/install-client.js (and install-client.ts)
 * Declarative cross-client Konoha MCP & RTK configuration installer.
 * Supports: --client=cursor|claude|opencode|omp|codex|pi|all
 */

const cursorManager = require('../src/cursor_manager');
const mcpClientsManager = require('../src/mcp_clients_manager');
const opencodeManager = require('../src/opencode_manager');
const codexManager = require('../src/codex_manager');
const piManager = require('../src/pi_manager');
const ompManager = require('../src/omp_manager');
const agentManager = require('../src/agent_manager');
const { getUvxCommand, detectPythonOrDefault } = require('../src/platform_utils');
const { SERVER_PATH, FILE_TOOLS_LAUNCHER_JS } = require('../bin/lib/paths');

async function installClient(clientName, options = {}) {
  const norm = String(clientName || '').toLowerCase().trim();
  const python = options.python || detectPythonOrDefault();
  const uvxCmd = options.uvxCmd || getUvxCommand();
  const serverPath = options.serverPath || SERVER_PATH;
  const projectRoot = options.projectRoot || process.cwd();
  const silent = options.silent !== false;

  const results = {};
  const agents = agentManager.loadAgents();

  if (norm === 'all' || norm === 'cursor') {
    results.cursor = cursorManager.ensureCursorSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject: true,
      silent
    });
    cursorManager.registerCursorProjectMcp(projectRoot, python, serverPath, uvxCmd, silent);
  }

  if (norm === 'all' || norm === 'claude' || norm === 'claude-code' || norm === 'claudecode') {
    results.claude = mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      ruleContent: agentManager.generateClaudeCodeMd(agents),
      silent,
      agents,
      projectRoot,
      deployProject: true
    });
  }

  if (norm === 'all' || norm === 'opencode') {
    results.opencode = opencodeManager.ensureOpenCodeSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      silent
    });
  }

  if (norm === 'all' || norm === 'commandcode' || norm === 'command-code') {
    results.commandcode = mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      silent
    });
  }

  if (norm === 'all' || norm === 'codex') {
    results.codex = codexManager.ensureCodexSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      silent
    });
  }

  if (norm === 'all' || norm === 'pi') {
    results.pi = piManager.ensurePiSetup({
      pythonCmd: python,
      serverPath,
      uvxCmd,
      silent
    });
  }

  if (norm === 'all' || norm === 'omp') {
    results.omp = ompManager.ensureOmpSetup({
      nodeCmd: process.execPath,
      launcherPath: FILE_TOOLS_LAUNCHER_JS,
      uvxCmd,
      silent
    });
  }

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let target = 'all';
  const clientArg = args.find(a => a.startsWith('--client=') || a.startsWith('--clients='));
  if (clientArg) {
    target = clientArg.split('=')[1];
  } else if (args[0] && !args[0].startsWith('-')) {
    target = args[0];
  }

  installClient(target, { silent: false })
    .then(res => {
      console.log('Installation results:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Installation error:', err);
      process.exit(1);
    });
}

module.exports = {
  installClient
};
