#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const cursor = require('../src/cursor_manager');
const clients = require('../src/mcp_clients_manager');
const platform = require('../src/platform_utils');

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-audit-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

withTempHome((home) => {
  const serverPath = path.join(home, 'server.py');
  fs.writeFileSync(serverPath, '#!/usr/bin/env python3\n');

  const cursorDir = path.join(home, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  const cursorPath = path.join(cursorDir, 'mcp.json');
  fs.writeFileSync(cursorPath, JSON.stringify({ mcpServers: { thirdParty: { command: 'custom-server' } } }));

  const originalCursorPath = cursor.CURSOR_MCP_GLOBAL;
  const originalCursorLegacy = require('../src/../bin/lib/paths').CURSOR_MCP_LEGACY;
  assert.ok(originalCursorPath.endsWith(path.join('.cursor', 'mcp.json')));
  assert.ok(originalCursorLegacy.endsWith(path.join('.cursor', 'mcp.yaml')));

  const parsed = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
  parsed.mcpServers.konoha = { command: 'node', args: ['launcher.js'] };
  fs.writeFileSync(cursorPath, JSON.stringify(parsed));
  assert.equal(JSON.parse(fs.readFileSync(cursorPath, 'utf8')).mcpServers.thirdParty.command, 'custom-server');
});

assert.deepStrictEqual(platform.normalizeCommand('["py", "-3"]'), {
  executable: 'py',
  prefixArgs: ['-3']
});
assert.deepStrictEqual(platform.normalizeCommand('py -3'), {
  executable: 'py',
  prefixArgs: ['-3']
});

const migration = cp.spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
  path.join(root, 'src', 'migrate.py'),
  '--help'
], { cwd: root, encoding: 'utf8' });
assert.equal(migration.status, 0, migration.stderr);

const dbAgents = cp.spawnSync(process.platform === 'win32' ? 'python' : 'python3', [
  path.join(root, 'src', 'db_agents.py'),
  '--help'
], { cwd: root, encoding: 'utf8' });
assert.equal(dbAgents.status, 0, dbAgents.stderr);

assert.equal(typeof clients.registerClaudeCodeGlobalMcp, 'function');
assert.equal(typeof cursor.registerCursorProjectMcp, 'function');
console.log('Audit regression contracts passed.');
