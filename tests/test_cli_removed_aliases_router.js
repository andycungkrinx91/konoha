#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const repoDir = path.resolve(__dirname, '..');
const cliPath = path.join(repoDir, 'bin', 'cli.js');

const removedLabels = [
  'embeddings',
  'detect_ai',
  'ai-detector',
  'detect_docs',
  'docs-detector',
  'detect-doc',
  'personas',
  'memories',
  'spirit',
  'will-of-fire',
  'projects',
  'tasks',
  'web-search',
  'inbox',
  'install',
  'memory',
  'setup',
  'update',
  'saving',
  'agents',
  'tg',
  'tunnels',
  'prune',
  'context',
  'persona',
  'searxng',
  'sdlc'
];

const canonicalHelpCommands = [
  ['task', 'help'],
  ['project', 'help'],
  ['search', '--help'],
  ['data', 'help'],
  ['soul', 'help'],
  ['queue', 'help'],
  ['skill', 'help'],
  ['agent', 'help'],
  ['detect-ai', '--help'],
  ['detect-docs', '--help']
];

// 1. Static AST / Source Router Inspection
const cliSrc = fs.readFileSync(cliPath, 'utf8');
const switchStart = cliSrc.indexOf('switch (command)');
const switchEnd = cliSrc.indexOf('case undefined:', switchStart);
assert.ok(switchStart !== -1 && switchEnd !== -1, 'Could not find router switch block in bin/cli.js');
const routerBlock = cliSrc.slice(switchStart, switchEnd);

for (const label of removedLabels) {
  assert.ok(
    !routerBlock.includes(`case '${label}':`),
    `Router switch in bin/cli.js must NOT contain removed label: case '${label}':`
  );
}

// 2. Isolated Environment Setup (Following Sections 25.10 & 26.7)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cli-test-home-'));
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
  PORT: '1439'
};

try {
  // 3. Dynamic Child Process Execution: Assert exit code 1 and "Unknown command"
  for (const label of removedLabels) {
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
      `Expected 'Unknown command: ${label}' in output for removed alias '${label}'. Output: ${output}`
    );
  }

  // 4. Assert Harmless Canonical Commands Still Route
  for (const [cmd, ...args] of canonicalHelpCommands) {
    const res = spawnSync(process.execPath, [cliPath, cmd, ...args], {
      env: baseEnv,
      encoding: 'utf8',
      timeout: 5000
    });

    assert.strictEqual(
      res.status,
      0,
      `Canonical command '${cmd} ${args.join(' ')}' failed with exit code ${res.status}. Output: ${res.stdout} ${res.stderr}`
    );
  }

  // 5. Assert No Daemon Started
  const pidFile = path.join(dotKonoha, 'ui.pid');
  assert.strictEqual(fs.existsSync(pidFile), false, 'Daemon pid file should not exist');

  // 6. Assert cmdHelp lists canonical names and queue, and lists none of the 11 removed labels
  const coreStart = cliSrc.indexOf('${C.bold}CORE COMMANDS${C.reset}');
  const coreEnd = cliSrc.indexOf('${C.bold}GLOBAL OPTIONS${C.reset}');
  assert.ok(coreStart !== -1 && coreEnd !== -1, 'Could not find CORE COMMANDS in bin/cli.js');
  const topLevelListing = cliSrc.slice(coreStart, coreEnd);
  const topCommands = [...topLevelListing.matchAll(/\${C\.cyan}([^\$]+)\${C\.reset}/g)].map(m => m[1]);

  const expectedCanonicals = [
    'init', 'migrate', 'embed', 'test', 'status', 'version',
    'upgrade', 'savings', 'detect-ai', 'detect-docs', 'project',
    'task', 'data', 'soul', 'doctor', 'bridge', 'search',
    'ui', 'service', 'telegram', 'tunnel', 'clean', 'queue',
    'uninstall', 'skill', 'agent', 'help'
  ];
  for (const name of expectedCanonicals) {
    assert.ok(
      topCommands.some(c => c.split(',').map(s => s.trim()).includes(name)),
      `cmdHelp must list canonical command '${name}'`
    );
  }

  const batch43Labels = [
    'setup', 'update', 'saving', 'agents', 'tg', 'tunnels',
    'prune', 'context', 'persona', 'searxng', 'sdlc'
  ];
  for (const label of batch43Labels) {
    assert.ok(
      !topCommands.some(c => c.split(',').map(s => s.trim()).includes(label)),
      `cmdHelp must not list removed alias '${label}' in top-level commands`
    );
  }

  console.log('✓ All 27 removed aliases cleanly rejected with exit code 1 and Unknown command message.');
  console.log('✓ Canonical commands correctly routed to their handlers.');
  console.log('✓ cmdHelp contract verified (canonical names + queue present, removed aliases absent).');
  console.log('✓ No background daemon leaked into test environment.');
} finally {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch (_) {}
}
