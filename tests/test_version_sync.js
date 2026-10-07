'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('Running test_version_sync.js...');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const expectedVersion = pkg.version;
assert.ok(expectedVersion, 'package.json must declare a version');

// 1. Web package version
const webPkgPath = path.join(ROOT, 'apps', 'web', 'package.json');
if (fs.existsSync(webPkgPath)) {
  const webPkg = JSON.parse(fs.readFileSync(webPkgPath, 'utf8'));
  assert.strictEqual(webPkg.version, expectedVersion, `apps/web/package.json version (${webPkg.version}) must match package.json (${expectedVersion})`);
}

// 2. CLI version via bin/cli.js version
const cliPath = path.join(ROOT, 'bin', 'cli.js');
const cliRun = spawnSync(process.execPath, [cliPath, 'version'], { encoding: 'utf8' });
assert.strictEqual(cliRun.status, 0, `cli.js version should exit 0: ${cliRun.stderr}`);
assert.ok(cliRun.stdout.includes(expectedVersion), `cli.js version output (${cliRun.stdout.trim()}) must contain ${expectedVersion}`);

// 3. MCP protocol SERVER_VERSION
const protocolPath = path.join(ROOT, 'src', 'mcp', 'protocol.js');
if (fs.existsSync(protocolPath)) {
  const protocolCode = fs.readFileSync(protocolPath, 'utf8');
  assert.ok(protocolCode.includes('getServerVersion()'), 'protocol.js must dynamically resolve server version');
}

// 4. File tools MCP protocol SERVER_VERSION
const fileToolsMcpPath = path.join(ROOT, 'src', 'file_tools_mcp.js');
if (fs.existsSync(fileToolsMcpPath)) {
  const fileToolsCode = fs.readFileSync(fileToolsMcpPath, 'utf8');
  assert.ok(fileToolsCode.includes('SERVER_VERSION'), 'file_tools_mcp.js must export SERVER_VERSION');
}

console.log(`✓ All version sync checks passed cleanly. Current version locked at: v${expectedVersion}`);
