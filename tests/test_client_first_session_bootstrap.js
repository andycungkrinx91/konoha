#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const agentManager = require('../src/agent_manager');
const agentContract = require('../src/agent_contract');

const testRoot = path.join('/tmp', `konoha-test-bootstrap-${Date.now()}`);
fs.mkdirSync(testRoot, { recursive: true });

console.log(`Testing client bootstrap in isolated fixture: ${testRoot}`);

const CLIENTS = [
  'antigravity',
  'cursor',
  'claude',
  'opencode',
  'commandcode',
  'codex',
  'pi',
  'omp'
];

for (const client of CLIENTS) {
  const isolatedHome = path.join(testRoot, client, 'home');
  const isolatedProj = path.join(testRoot, client, 'proj');
  fs.mkdirSync(isolatedHome, { recursive: true });
  fs.mkdirSync(isolatedProj, { recursive: true });

  const result = agentManager.ensureClientSetup(client, {
    home: isolatedHome,
    projectRoot: isolatedProj,
    deployProject: true,
    force: true,
    skipDetection: true,
    silent: true
  });
  assert.ok(result.ok !== false, `Client ${client} setup must succeed`);

  let mcpPath = null;
  let contractPath = null;

  if (client === 'antigravity') {
    mcpPath = path.join(isolatedHome, '.gemini', 'config', 'mcp_config.json');
    contractPath = path.join(isolatedHome, '.gemini', 'GEMINI.md');
    assert.ok(fs.existsSync(path.join(isolatedHome, '.gemini', 'antigravity-cli', 'rules', 'rtk.md')));
  } else if (client === 'cursor') {
    mcpPath = path.join(isolatedHome, '.cursor', 'mcp.json');
    contractPath = path.join(isolatedHome, '.cursor', 'rules', 'konoha.mdc');
    const hooksPath = path.join(isolatedHome, '.cursor', 'hooks.json');
    assert.ok(fs.existsSync(hooksPath), 'Cursor hooks.json must exist');
    const hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.ok(hooksData.hooks?.sessionStart?.some(h => h.command.includes('cursor_bootstrap.js')), 'Cursor sessionStart hook must be registered');
  } else if (client === 'claude') {
    mcpPath = path.join(isolatedHome, '.claude.json');
    contractPath = path.join(isolatedHome, '.claude', 'CLAUDE.md');
    const settingsPath = path.join(isolatedHome, '.claude', 'settings.json');
    assert.ok(fs.existsSync(settingsPath), 'Claude settings.json must exist');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.hooks?.SessionStart?.length > 0, 'Claude SessionStart hook must be registered');
    assert.ok(settings.hooks?.UserPromptSubmit?.length > 0, 'Claude UserPromptSubmit hook must be registered');
  } else if (client === 'commandcode') {
    mcpPath = path.join(isolatedHome, '.commandcode', 'mcp.json');
    contractPath = path.join(isolatedHome, '.commandcode', 'AGENTS.md');
    const settingsPath = path.join(isolatedHome, '.commandcode', 'settings.json');
    assert.ok(fs.existsSync(settingsPath), 'Command Code settings.json must exist');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.hooks?.SessionStart?.length > 0, 'Command Code SessionStart hook must be registered');
  } else if (client === 'opencode') {
    mcpPath = path.join(isolatedHome, '.config', 'opencode', 'opencode.json');
    contractPath = path.join(isolatedHome, '.config', 'opencode', 'AGENTS.md');
    assert.ok(fs.existsSync(path.join(isolatedHome, '.config', 'opencode', 'rules', 'konoha.md')));
  } else if (client === 'codex') {
    mcpPath = path.join(isolatedHome, '.codex', 'config.toml');
    contractPath = path.join(isolatedHome, '.codex', 'instructions.md');
    assert.ok(fs.existsSync(path.join(isolatedHome, '.codex', 'CODEX.md')));
    assert.ok(fs.existsSync(path.join(isolatedHome, '.codex', 'rules', 'konoha.md')));
  } else if (client === 'pi') {
    mcpPath = path.join(isolatedHome, '.pi', 'agent', 'mcp.json');
    contractPath = path.join(isolatedHome, '.pi', 'agent', 'AGENTS.md');
    assert.ok(fs.existsSync(path.join(isolatedHome, '.pi', 'agent', 'settings.json')));
  } else if (client === 'omp') {
    mcpPath = path.join(isolatedHome, '.omp', 'agent', 'mcp.json');
    contractPath = path.join(isolatedHome, '.omp', 'agent', 'AGENTS.md');
  }

  assert.ok(fs.existsSync(mcpPath), `MCP config must exist at ${mcpPath}`);
  const mcpContent = fs.readFileSync(mcpPath, 'utf8');
  assert.match(mcpContent, /konoha/, `Client ${client} must declare konoha server`);
  assert.match(mcpContent, /semble/, `Client ${client} must declare semble server`);
  assert.match(mcpContent, /aislop/, `Client ${client} must declare aislop server`);

  assert.ok(fs.existsSync(contractPath), `Contract must exist at ${contractPath}`);
  const contractContent = fs.readFileSync(contractPath, 'utf8');
  assert.match(contractContent, /<!-- KONOHA-CONTRACT-START -->/);
  assert.match(contractContent, /<!-- KONOHA-CONTRACT-END -->/);
  assert.match(contractContent, /Konoha is mandatory/);
  assert.match(contractContent, /Semble is mandatory/);

  console.log(`  ✓ Client ${client.toUpperCase()} verified in isolated home.`);
}

// Test workspace auto-scaffolding
const freshProj = path.join(testRoot, 'fresh-workspace');
fs.mkdirSync(freshProj, { recursive: true });

const { deployProjectWorkspace } = require('../src/agent_deployer');
const deployRes = deployProjectWorkspace(freshProj, { silent: true, force: true });
assert.ok(deployRes.ok, 'Workspace deployment must succeed');

assert.ok(fs.existsSync(path.join(freshProj, 'GEMINI.md')), 'Workspace GEMINI.md must exist');
assert.ok(fs.existsSync(path.join(freshProj, 'CLAUDE.md')), 'Workspace CLAUDE.md must exist');
assert.ok(fs.existsSync(path.join(freshProj, 'AGENTS.md')), 'Workspace AGENTS.md must exist');
assert.ok(fs.existsSync(path.join(freshProj, '.cursor', 'rules', 'konoha.mdc')), 'Workspace konoha.mdc must exist');
assert.ok(fs.existsSync(path.join(freshProj, '.cursor', 'mcp.json')), 'Workspace Cursor mcp.json must exist');
assert.ok(fs.existsSync(path.join(freshProj, '.opencode', 'opencode.json')), 'Workspace OpenCode opencode.json must exist');
assert.ok(fs.existsSync(path.join(freshProj, '.codex', 'config.toml')), 'Workspace Codex config.toml must exist');
assert.ok(fs.existsSync(path.join(freshProj, '.omp', 'agent', 'mcp.json')), 'Workspace OMP mcp.json must exist');

// Clean up test fixture
fs.rmSync(testRoot, { recursive: true, force: true });
console.log('✓ All 8 clients pass fresh isolated-HOME bootstrap without manual second-step setup.');
