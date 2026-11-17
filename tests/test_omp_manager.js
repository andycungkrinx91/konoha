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

  // A sandboxed home must not write the developer's project config. Suite runs used
  // to point the repo's `.omp/mcp.json` at a temp launcher that no longer existed,
  // and every delegated OMP agent then lost the Konoha MCP server entirely.
  const fakeProject = path.join(tmpDir, 'project');
  const fakeProjectMcp = path.join(fakeProject, '.omp', 'mcp.json');
  fs.mkdirSync(path.dirname(fakeProjectMcp), { recursive: true });
  fs.writeFileSync(fakeProjectMcp, JSON.stringify({ mcpServers: { konoha: { command: 'sentinel' } } }), 'utf8');
  const cwdBefore = process.cwd();
  try {
    process.chdir(fakeProject);
    ompManager.ensureOmpSetup({ home: tmpDir, silent: true });
  } finally {
    process.chdir(cwdBefore);
  }
  const afterProject = JSON.parse(fs.readFileSync(fakeProjectMcp, 'utf8'));
  assert.strictEqual(afterProject.mcpServers.konoha.command, 'sentinel',
    'A temp-home run must leave the project .omp/mcp.json untouched');

  // A suite overrides the environment, not the `home` option, so the same guard must
  // hold when HOME/USERPROFILE point at a sandbox. `paths.js` captures HOME at module
  // load, so this has to run in a child process to reproduce the real condition.
  const envHome = path.join(tmpDir, 'sandbox-home');
  fs.mkdirSync(envHome, { recursive: true });
  const childScript = `
    const manager = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omp_manager.js'))});
    manager.ensureOmpSetup({ silent: true });
  `;
  const child = require('child_process').spawnSync(process.execPath, ['-e', childScript], {
    cwd: fakeProject,
    env: { ...process.env, HOME: envHome, USERPROFILE: envHome },
    encoding: 'utf8',
    timeout: 120000
  });
  assert.strictEqual(child.status, 0, `sandboxed ensureOmpSetup must exit 0: ${child.stderr}`);
  const afterEnv = JSON.parse(fs.readFileSync(fakeProjectMcp, 'utf8'));
  assert.strictEqual(afterEnv.mcpServers.konoha.command, 'sentinel',
    'An overridden HOME must not let ensureOmpSetup rewrite the project .omp/mcp.json');

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
