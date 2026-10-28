#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const yaml = fs.readFileSync(path.join(__dirname, '..', '.cursor', 'mcp.yaml'), 'utf8');
const cli = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
const helpSrc = fs.readFileSync(path.join(__dirname, '..', 'bin', 'commands', 'help.js'), 'utf8');

const batch43Labels = [
  'setup', 'update', 'saving', 'agents', 'tg', 'tunnels',
  'prune', 'context', 'persona', 'searxng', 'sdlc'
];

const expectedCanonicals = [
  'init', 'migrate', 'embed', 'test', 'status', 'version',
  'upgrade', 'savings', 'detect-ai', 'detect-docs', 'project',
  'task', 'data', 'soul', 'doctor', 'bridge', 'search',
  'ui', 'service', 'telegram', 'clean', 'queue',
  'uninstall', 'skill', 'agent', 'help'
];

for (const command of ['init', 'migrate', 'test', 'status', 'version', 'upgrade', 'savings', 'data', 'doctor', 'bridge', 'uninstall', 'skill', 'agent', 'project', 'help']) {
  assert.ok(cli.includes(`case '${command}'`), `missing implementation case for ${command}`);
}
assert.ok(helpSrc.includes('Configure Ninja subagents (list, create, toggle skills, models config, delete, status).'));
assert.ok(!cli.includes('konoha models <subcommand>'), 'konoha models command should be removed');
assert.ok(!cli.includes('await cmdModels('), 'cmdModels router call should be removed');
assert.ok(!cli.includes('restore model quotas'));
assert.ok(!cli.includes('assign them to subagents'));
assert.ok(yaml.includes('mcpServers:\n  semble:'));
assert.ok(yaml.includes('  konoha:\n'));
assert.ok(yaml.includes('command: uvx'));

// a. Verify every one of the 11 labels exits 1 with "Unknown command: <label>"
const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cli-help-contract-'));
const dotKonoha = path.join(tmpHome, '.konoha');
fs.mkdirSync(dotKonoha, { recursive: true });
fs.mkdirSync(path.join(tmpHome, '.agents'), { recursive: true });
fs.mkdirSync(path.join(tmpHome, '.gemini', 'config'), { recursive: true });

const cliVer = require('../package.json').version;
fs.writeFileSync(path.join(dotKonoha, 'konoha.db'), '');
fs.writeFileSync(path.join(dotKonoha, 'server.js'), '');
fs.writeFileSync(path.join(dotKonoha, 'file_tools_mcp.js'), '');
fs.writeFileSync(path.join(tmpHome, '.gemini', 'config', 'mcp_config.json'), '{}');
fs.writeFileSync(path.join(tmpHome, '.agents', 'agents.yaml'), '');
const mtime = fs.statSync(path.join(tmpHome, '.agents', 'agents.yaml')).mtimeMs;
fs.writeFileSync(path.join(dotKonoha, '.auto_setup_state.json'), JSON.stringify({ version: cliVer, agentsMtime: mtime }));

const baseEnv = {
  ...process.env,
  KONOHA_UI_AUTOSTART: '0',
  HOME: tmpHome,
  USERPROFILE: tmpHome,
  KONOHA_DB_PATH: path.join(dotKonoha, 'konoha.db'),
  PORT: '1440'
};

try {
  for (const label of batch43Labels) {
    const res = spawnSync(process.execPath, [cliPath, label], {
      env: baseEnv,
      encoding: 'utf8',
      timeout: 5000
    });
    assert.strictEqual(
      res.status,
      1,
      `Expected exit code 1 for removed alias '${label}', got ${res.status}. Output: ${res.stdout} ${res.stderr}`
    );
    const output = (res.stdout || '') + (res.stderr || '');
    assert.ok(
      output.includes(`Unknown command: ${label}`),
      `Expected 'Unknown command: ${label}' in output for '${label}'. Output: ${output}`
    );
  }
} finally {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch (_) {}
}

// b. Verify cmdHelp lists canonical names and queue, and lists none of the 11 labels
const coreStart = helpSrc.indexOf('${C.bold}CORE COMMANDS${C.reset}');
const coreEnd = helpSrc.indexOf('${C.bold}GLOBAL OPTIONS${C.reset}');
assert.ok(coreStart !== -1 && coreEnd !== -1, 'Could not find CORE COMMANDS in bin/commands/help.js');
const topLevelListing = helpSrc.slice(coreStart, coreEnd);
const topCommands = [...topLevelListing.matchAll(/\${C\.cyan}([^\$]+)\${C\.reset}/g)].map(m => m[1]);

for (const name of expectedCanonicals) {
  assert.ok(
    topCommands.some(c => c.split(',').map(s => s.trim()).includes(name)),
    `cmdHelp must list canonical command '${name}'`
  );
}

for (const label of batch43Labels) {
  assert.ok(
    !topCommands.some(c => c.split(',').map(s => s.trim()).includes(label)),
    `cmdHelp must not list removed alias '${label}' in top-level commands`
  );
}

console.log('CLI help and Cursor MCP YAML contract passed');
