#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ompManager = require('../src/omp_manager');
const { validateContractText } = require('../src/agent_contract');

console.log('Running test_omp_manager.js...');

// 1. Module Exports Verification
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

// 2. Workflow Addendum Content Verification
const addendum = ompManager.buildOmpWorkflowAddendum();
assert.match(addendum, /## Konoha Workflow Mandate \(OMP\) — MANDATORY/, 'Addendum must include header');
assert.match(addendum, /Route through the village, never free-run/, 'Must enforce sannin triage');
assert.match(addendum, /Step 0: Classify request/i, 'Must enforce request classification');
assert.match(addendum, /BRANCH B: Website Scaffolding Pipeline/i, 'Must enforce Branch B pipeline');
assert.match(addendum, /Header Logo on Far LEFT/, 'Must enforce header logo on left');
assert.match(addendum, /Mobile View Invariant \(NO Hamburger Menu Toggle in Header\)/, 'Must enforce mobile invariant');
assert.match(addendum, /Archetype-Adaptive Mobile Dock/, 'Must enforce mobile dock invariant');
assert.match(addendum, /Floating Bottom-Left Theme Switcher Popup/, 'Must enforce floating theme popup');
assert.match(addendum, /Zero Errors & Zero Warnings/, 'Must enforce zero warnings/errors');
console.log('  ✓ Workflow addendum invariants verified.');

// 3. Managed Contract Construction & Validation
const managedContract = ompManager.buildOmpManagedContract();
const validation = validateContractText(managedContract);
assert.ok(validation.ok, `Managed contract validation failed: ${JSON.stringify(validation)}`);
assert.match(managedContract, /<!-- KONOHA-CONTRACT-START -->/, 'Must have contract start marker');
assert.match(managedContract, /<!-- KONOHA-CONTRACT-END -->/, 'Must have contract end marker');
console.log('  ✓ Managed contract syntax and markers verified.');

// 4. MCP Servers Configuration Verification
const servers = ompManager.buildOmpMcpServers({
  nodeCmd: 'node',
  launcherPath: '/path/to/launcher.js',
  uvxCmd: 'uvx'
});
assert.ok(servers.konoha, 'Must configure konoha server');
assert.ok(servers.semble, 'Must configure semble server');
assert.ok(servers.aislop, 'Must configure aislop server');
assert.strictEqual(servers.konoha.type, 'stdio', 'Konoha server must specify stdio transport');
assert.strictEqual(servers.semble.type, 'stdio', 'Semble server must specify stdio transport');
assert.strictEqual(servers.aislop.type, 'stdio', 'Aislop server must specify stdio transport');
assert.strictEqual(servers.konoha.env.ACTIVE_CLIENT, 'omp', 'Konoha server must target omp client');
assert.strictEqual(servers.konoha.env.KONOHA_CLIENT, 'omp', 'Konoha server must pass KONOHA_CLIENT=omp');
assert.deepStrictEqual(servers.semble.args.slice(-2), ['--content', 'all'], 'Semble must use --content all');
console.log('  ✓ MCP server specifications verified.');

// 5. Atomic File Registration & Removal Lifecycle (Isolated Temp Directory)
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
  assert.ok(configContent.mcpServers.semble, 'semble must be registered in mcp.json');
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
