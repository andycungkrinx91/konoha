#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = fs.readFileSync(path.join(__dirname, '..', '.cursor', 'mcp.yaml'), 'utf8');
const cli = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');

for (const command of ['init', 'migrate', 'test', 'status', 'version', 'upgrade', 'savings', 'data', 'doctor', 'bridge', 'uninstall', 'skill', 'agent', 'models', 'project', 'help']) {
  assert.ok(cli.includes(`case '${command}'`), `missing implementation case for ${command}`);
}
assert.ok(cli.includes('Configure Ninja subagents (list, create, toggle skills, delete, status).'));
assert.ok(cli.includes('Clear local usage telemetry from the SQLite database.'));
assert.ok(!cli.includes('restore model quotas'));
assert.ok(!cli.includes('assign them to subagents'));
assert.ok(yaml.includes('mcpServers:\n  semble:'));
assert.ok(yaml.includes('  konoha:\n'));
assert.ok(yaml.includes('command: uvx'));
console.log('CLI help and Cursor MCP YAML contract passed');
