#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const antigravity = require('../src/antigravity_manager');

const absentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-no-ag-'));
try {
  const absent = antigravity.detectAntigravityIde({
    home: absentHome,
    env: {},
    fileExists: () => false,
    commandAvailable: () => false,
  });
  assert.strictEqual(absent.present, false);

  const cliOnly = antigravity.detectAntigravityIde({
    home: absentHome,
    env: {},
    fileExists: (p) => p.includes('antigravity-cli'),
    commandAvailable: () => false,
  });
  assert.strictEqual(cliOnly.present, false);

  const override = antigravity.detectAntigravityIde({
    home: absentHome,
    env: { KONOHA_ANTIGRAVITY_IDE: '1' },
    fileExists: () => false,
    commandAvailable: () => false,
  });
  assert.strictEqual(override.present, true);

  const ide = antigravity.detectAntigravityIde({
    home: absentHome,
    env: {},
    fileExists: (p) => p.endsWith(path.join('antigravity-ide', 'brain')),
    commandAvailable: () => false,
  });
  assert.strictEqual(ide.present, true);
} finally {
  fs.rmSync(absentHome, { recursive: true, force: true });
}

const dbScript = path.join(root, 'src', 'db_bridges.py');
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-bridge-db-'));
try {
  const env = { ...process.env, HOME: tempHome };
  const result = spawnSync('python3', [dbScript, 'upsert', JSON.stringify({
    name: 'ag-extension',
    provider: 'antigravity-extension',
  })], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const list = spawnSync('python3', [dbScript, 'list'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(list.status, 0, list.stderr);
  const bridges = JSON.parse(list.stdout);
  assert.deepStrictEqual(bridges[0], {
    name: 'ag-extension',
    port: 1313,
    provider: 'antigravity-extension',
    enabled: false,
    targetUrl: 'http://127.0.0.1:1313',
  });

  const invalid = spawnSync('python3', [dbScript, 'upsert', JSON.stringify({
    name: 'bad-extension',
    provider: 'antigravity-extension',
    targetUrl: 'http://example.com:1313',
  })], { cwd: root, env, encoding: 'utf8' });
  assert.notStrictEqual(invalid.status, 0, 'external provider must remain loopback-only');

  const explicitlyEnabled = spawnSync('python3', [dbScript, 'upsert', JSON.stringify({
    name: 'enabled-extension',
    provider: 'antigravity-extension',
    enabled: true,
  })], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(explicitlyEnabled.status, 0, explicitlyEnabled.stderr);
  const enabledList = JSON.parse(spawnSync('python3', [dbScript, 'list'], { cwd: root, env, encoding: 'utf8' }).stdout);
  assert.strictEqual(enabledList.find((bridge) => bridge.name === 'enabled-extension').enabled, true);
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

const cliSource = fs.readFileSync(path.join(root, 'bin', 'cli.js'), 'utf8');
assert.match(cliSource, /KONOHA_BRIDGE_REF = 'master'/);
assert.match(cliSource, /andycungkrinx91\.konoha-bridge-master-universal/);
assert.match(cliSource, /antigravity-ide-not-detected/);
assert.match(cliSource, /pkg\.publisher === 'andycungkrinx91'/);
assert.match(cliSource, /bridgePort === 1313/);
assert.match(cliSource, /rev-parse.*HEAD/);
assert.doesNotMatch(cliSource, /KONOHA_BRIDGE_VERSION/);
assert.doesNotMatch(cliSource, /v1\.2\.0/);

const mcpSource = fs.readFileSync(path.join(root, 'src', 'file_tools_mcp.js'), 'utf8');
assert.match(mcpSource, /provider !== 'antigravity-extension'/);
assert.match(mcpSource, /provider === 'antigravity-extension'/);

console.log('Antigravity external bridge contract passed.');
