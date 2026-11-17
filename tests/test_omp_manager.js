#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ompManager = require('../src/omp_manager');
const { validateContractText } = require('../src/agent_contract');

console.log('Running test_omp_manager.js...');

// Module Exports Verification
const requiredFunctions = [
  'isOmpInstalled',
  'getOmpConfigPath',
  'getOmpAgentsMdPath',
  'buildOmpWorkflowAddendum',
  'buildOmpManagedContract',
  'buildOmpMcpServers',
  'registerOmpMcp',
  'deployOmpContract',
  'deployOmpRtkRule',
  'ensureOmpSetup',
  'removeOmpConfig',
  'removeOmpContract',
  'getOmpStatus'
];

for (const fn of requiredFunctions) {
  assert.strictEqual(typeof ompManager[fn], 'function', `ompManager.${fn} must be a function`);
}
console.log('  ✓ omp_manager exports verified.');

// Workflow Addendum Content Verification
const addendum = ompManager.buildOmpWorkflowAddendum();
assert.match(addendum, /## Konoha Workflow Mandate \(OMP\) — MANDATORY/, 'Addendum must include header');
assert.match(addendum, /Route through the village, never free-run/, 'Must enforce sannin triage');
assert.match(addendum, /Step 0: Classify request/i, 'Must enforce request classification');
assert.match(addendum, /BRANCH B: Website Scaffolding Pipeline/i, 'Must enforce Branch B pipeline');
assert.match(addendum, /Project-Specific Design Mandate/, 'Must enforce the brief-driven design mandate');
assert.doesNotMatch(addendum, /Archetype-Adaptive Mobile Dock/, 'Must not reimpose a house dock template');
assert.doesNotMatch(addendum, /Floating Bottom-Left Theme Switcher Popup/, 'Must not reimpose a house theme popup');
assert.doesNotMatch(addendum, /minimum of 4 high-definition slides/, 'Must not reimpose a hero carousel');
assert.match(addendum, /Zero Errors & Zero Warnings/, 'Must enforce zero warnings/errors');
console.log('  ✓ Workflow addendum invariants verified.');

// Managed Contract Construction & Validation
const managedContract = ompManager.buildOmpManagedContract();
const validation = validateContractText(managedContract);
assert.ok(validation.ok, `Managed contract validation failed: ${JSON.stringify(validation)}`);
assert.match(managedContract, /<!-- KONOHA-CONTRACT-START -->/, 'Must have contract start marker');
assert.match(managedContract, /<!-- KONOHA-CONTRACT-END -->/, 'Must have contract end marker');
console.log('  ✓ Managed contract syntax and markers verified.');

// MCP Servers Configuration Verification
const servers = ompManager.buildOmpMcpServers({
  nodeCmd: 'node',
  launcherPath: '/path/to/launcher.js',
});
assert.ok(servers.konoha, 'Must configure konoha server');
assert.strictEqual(servers.semble, undefined, 'Must not configure the retired semble server');
assert.ok(servers.aislop, 'Must configure aislop server');
assert.strictEqual(servers.konoha.type, 'stdio', 'Konoha server must specify stdio transport');
assert.strictEqual(servers.aislop.type, 'stdio', 'Aislop server must specify stdio transport');
assert.strictEqual(servers.konoha.env.ACTIVE_CLIENT, 'omp', 'Konoha server must target omp client');
assert.strictEqual(servers.konoha.env.KONOHA_CLIENT, 'omp', 'Konoha server must pass KONOHA_CLIENT=omp');
console.log('  ✓ MCP server specifications verified.');

// Atomic File Registration & Removal Lifecycle (Isolated Temp Directory)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-test-'));
try {
  const testConfigPath = path.join(tmpDir, 'agent', 'mcp.json');
  const testAgentsMd = path.join(tmpDir, 'agent', 'AGENTS.md');

  // Initial registration
  const regResult = ompManager.registerOmpMcp({
    configPath: testConfigPath,
    silent: true
  });
  assert.ok(regResult.ok, 'registerOmpMcp must succeed');
  assert.ok(fs.existsSync(testConfigPath), 'mcp.json must be created');

  const configContent = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
  assert.strictEqual(configContent.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'mcp.json must use valid OMP schema');
  assert.ok(configContent.mcpServers.konoha, 'konoha must be registered in mcp.json');
  assert.strictEqual(configContent.mcpServers.semble, undefined, 'retired semble server must not be registered');
  assert.ok(configContent.mcpServers.aislop, 'aislop must be registered in mcp.json');

  // Contract deployment
  const depResult = ompManager.deployOmpContract({
    targetFile: testAgentsMd,
    silent: true
  });
  assert.ok(depResult.ok, 'deployOmpContract must succeed');
  assert.ok(fs.existsSync(testAgentsMd), 'AGENTS.md must be created');
  const agentsMdContent = fs.readFileSync(testAgentsMd, 'utf8');
  assert.match(agentsMdContent, /Konoha runtime contract/);

  // Status check
  const status = ompManager.getOmpStatus();
  assert.strictEqual(typeof status.installed, 'boolean');

  // Clean removal
  const rmResult = ompManager.removeOmpConfig(true);
  assert.strictEqual(typeof rmResult, 'boolean');
  console.log('  ✓ File registration and removal lifecycle verified.');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('All tests in test_omp_manager.js passed successfully!\n');
