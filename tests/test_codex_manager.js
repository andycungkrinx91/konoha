#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const codexManager = require('../src/codex_manager');
const {
  parseCodexToml,
  updateCodexTomlMcp,
  isCodexInstalled,
  getCodexStatus
} = codexManager;

console.log('--- Testing Codex Manager ---');

// Test 1: TOML parsing with empty / null content
const emptyParsed = parseCodexToml('');
assert.deepStrictEqual(emptyParsed, { mcp_servers: {} }, 'Empty TOML should return empty mcp_servers');

// Test 2: TOML parsing with MCP servers
const sampleToml = `
# Global Codex Configuration
model = "o3-mini"

[mcp_servers.konoha]
command = "python3"
args = ["/home/user/.konoha/server.py"]

[mcp_servers.semble]
command = "uvx"
args = ["--from", "semble[mcp]@latest", "semble", "--content", "all"]

[user]
name = "Ninja"
`;

const parsed = parseCodexToml(sampleToml);
assert.ok(parsed.mcp_servers.konoha, 'Should parse konoha server');
assert.strictEqual(parsed.mcp_servers.konoha.command, 'python3');
assert.deepStrictEqual(parsed.mcp_servers.konoha.args, ['/home/user/.konoha/server.py']);

assert.ok(parsed.mcp_servers.semble, 'Should parse semble server');
assert.strictEqual(parsed.mcp_servers.semble.command, 'uvx');
assert.deepStrictEqual(parsed.mcp_servers.semble.args, ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']);

// Test 3: Updating / injecting MCP servers in TOML
const updatedToml = updateCodexTomlMcp(
  'model = "o3-mini"\n[user]\nname = "Ninja"\n',
  'python3',
  '/custom/path/server.py',
  'uvx'
);

assert.match(updatedToml, /\[mcp_servers\.konoha\]/);
assert.match(updatedToml, /\[mcp_servers\.semble\]/);
assert.match(updatedToml, /model = "o3-mini"/);
assert.match(updatedToml, /name = "Ninja"/);

const reParsed = parseCodexToml(updatedToml);
assert.strictEqual(reParsed.mcp_servers.konoha.command, 'python3');
assert.deepStrictEqual(reParsed.mcp_servers.konoha.args, ['/custom/path/server.py']);
assert.strictEqual(reParsed.mcp_servers.semble.command, 'uvx');

// Test 4: Idempotent replacement of existing MCP servers
const replacedToml = updateCodexTomlMcp(
  sampleToml,
  'python3.11',
  '/new/server.py',
  'uvx'
);

const reParsed2 = parseCodexToml(replacedToml);
assert.strictEqual(reParsed2.mcp_servers.konoha.command, 'python3.11');
assert.deepStrictEqual(reParsed2.mcp_servers.konoha.args, ['/new/server.py']);
assert.match(replacedToml, /model = "o3-mini"/);

// Test 5: Status detection structure
const status = getCodexStatus();
assert.strictEqual(typeof status.installed, 'boolean');
assert.strictEqual(typeof status.configExists, 'boolean');
assert.strictEqual(typeof status.mcpKonoha, 'boolean');
assert.strictEqual(typeof status.mcpSemble, 'boolean');
assert.strictEqual(typeof status.rtkRuleDeployed, 'boolean');

console.log('✓ All Codex Manager tests passed successfully!');
