#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Running test_client_disconnect_and_bridge_scope.js...');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-scope-test-'));

try {
  // 1. Test antigravity_manager removeAntigravityConfig and ensureAntigravitySetup
  const agManager = require('../src/antigravity_manager');
  assert.strictEqual(typeof agManager.removeAntigravityConfig, 'function', 'removeAntigravityConfig should be exported');
  assert.strictEqual(typeof agManager.ensureAntigravitySetup, 'function', 'ensureAntigravitySetup should be exported');

  const geminiConfigDir = path.join(tempHome, '.gemini', 'config');
  fs.mkdirSync(geminiConfigDir, { recursive: true });
  const mcpConfigFile = path.join(geminiConfigDir, 'mcp_config.json');

  // Seed with Konoha servers
  fs.writeFileSync(mcpConfigFile, JSON.stringify({
    mcpServers: {
      konoha: { command: 'node', args: ['server.js'] },
      semble: { command: 'uvx', args: ['semble'] },
      aislop: { command: 'npx', args: ['aislop'] },
      other_custom_server: { command: 'custom' }
    }
  }, null, 2));

  // Override HOME temporarily
  const origHome = process.env.HOME;
  process.env.HOME = tempHome;

  // Run removeAntigravityConfig
  const removeRes = agManager.removeAntigravityConfig(true, { home: tempHome });
  assert.strictEqual(removeRes.ok, true);

  const parsedAfterRemove = JSON.parse(fs.readFileSync(mcpConfigFile, 'utf8'));
  assert.strictEqual(parsedAfterRemove.mcpServers.konoha, undefined, 'konoha should be removed');
  assert.strictEqual(parsedAfterRemove.mcpServers.semble, undefined, 'semble should be removed');
  assert.strictEqual(parsedAfterRemove.mcpServers.aislop, undefined, 'aislop should be removed');
  assert.ok(parsedAfterRemove.mcpServers.other_custom_server, 'other custom servers must be preserved');
  console.log('  ✓ antigravity_manager removeAntigravityConfig verified.');

  // 2. Test mcp_clients_manager removeCommandCodeConfig
  const mcpClients = require('../src/mcp_clients_manager');
  assert.strictEqual(typeof mcpClients.removeCommandCodeConfig, 'function', 'removeCommandCodeConfig should be exported');

  const ccDir = path.join(tempHome, '.commandcode');
  fs.mkdirSync(ccDir, { recursive: true });
  const ccMcpFile = path.join(ccDir, 'mcp.json');
  fs.writeFileSync(ccMcpFile, JSON.stringify({
    mcpServers: {
      konoha: { command: 'node' },
      semble: { command: 'uvx' },
      user_tool: { command: 'tool' }
    }
  }, null, 2));

  const removeCcRes = mcpClients.removeCommandCodeConfig(true, { home: tempHome });
  assert.strictEqual(removeCcRes.ok, true);
  const parsedCcAfter = JSON.parse(fs.readFileSync(ccMcpFile, 'utf8'));
  assert.strictEqual(parsedCcAfter.mcpServers.konoha, undefined, 'konoha should be removed from commandcode');
  assert.strictEqual(parsedCcAfter.mcpServers.semble, undefined, 'semble should be removed from commandcode');
  assert.ok(parsedCcAfter.mcpServers.user_tool, 'user_tool must be preserved in commandcode');
  console.log('  ✓ mcp_clients_manager removeCommandCodeConfig verified.');

  // 3. Test cursor_manager removeCursorConfig cleans up accidental konoha-bridge
  const cursorMgr = require('../src/cursor_manager');
  const cursorExtDir = path.join(tempHome, '.cursor', 'extensions');
  fs.mkdirSync(cursorExtDir, { recursive: true });
  const dummyBridgeExt = path.join(cursorExtDir, 'andycungkrinx91.konoha-bridge-test');
  fs.mkdirSync(dummyBridgeExt, { recursive: true });
  assert.ok(fs.existsSync(dummyBridgeExt));

  cursorMgr.removeCursorConfig(true, { home: tempHome });
  assert.strictEqual(fs.existsSync(dummyBridgeExt), false, 'konoha-bridge extension should be purged from ~/.cursor/extensions');
  console.log('  ✓ cursor_manager removeCursorConfig purges konoha-bridge extension from Cursor.');

  // 4. Test bin/cli.js invariants: installExtensionViaCli refusal for non-antigravity
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.match(cliSource, /if\s*\(cliName\s*!==\s*'antigravity'\)/, 'installExtensionViaCli must guard against non-antigravity CLI');
  assert.match(cliSource, /Refusing to install konoha-bridge \(Antigravity IDE only\)/, 'Refusal warning must be present');
  console.log('  ✓ bin/cli.js installExtensionViaCli antigravity-only guard verified.');

  // 5. Test agent_contract.js invariants
  const contractSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent_contract.js'), 'utf8');
  assert.match(contractSource, /Konoha-Bridge extension scoping invariant/, 'agent contract must include Konoha-Bridge extension scoping invariant');
  assert.match(contractSource, /is exclusively for Antigravity IDE/, 'agent contract must state extension is exclusively for Antigravity IDE');
  console.log('  ✓ agent_contract.js Konoha-Bridge scoping invariant verified.');

  process.env.HOME = origHome;
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

console.log('\nAll test_client_disconnect_and_bridge_scope.js tests passed!');
