#!/usr/bin/env node
// DB isolation: deployment reporting must not touch the real DB.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_client_commands.js — `/konoha` exists only where a prompt file
 * was written, and a failed client deployment must be reported, not swallowed.
 *
 * Three defects are pinned here:
 *   1. No client ever received a `/konoha` command file, so the slash command
 *      could not exist in any client.
 *   2. `deployGlobalClientConfigs` wrapped every client in `catch (_) {}`, so a
 *      half-deployed setup reported success.
 *   3. A parked `.konoha-proposed` agent profile was invisible, so a foreign
 *      profile could stay in effect with nothing pointing at it.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { deployKonohaCommands, KONOHA_COMMAND_BODY, LEGACY_COMMAND_BODY, COMMAND_TARGETS, UNSUPPORTED_CLIENTS } =
  require('../src/client_commands');
const { listAgentConflicts } = require('../src/agent_file_safety');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function tempHome(clients) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cmd_home_'));
  for (const client of clients) {
    const target = COMMAND_TARGETS.find((t) => t.client === client);
    if (target) fs.mkdirSync(path.join(home, target.configRoot), { recursive: true });
  }
  return home;
}

console.log('\n[Slash command deployment]');

check('writes /konoha for every client whose config root exists', () => {
  const home = tempHome(['claudecode', 'cursor', 'opencode', 'commandcode', 'codex']);
  const result = deployKonohaCommands({ home });
  const clients = result.deployed.map((d) => d.client).sort();
  assert.deepStrictEqual(clients, ['claudecode', 'codex', 'commandcode', 'cursor', 'omp', 'opencode']);
  for (const entry of result.deployed) {
    assert.strictEqual(fs.readFileSync(entry.path, 'utf8'), KONOHA_COMMAND_BODY);
  }
  // omp shares codex's prompt directory; one file serves both.
  const omp = result.deployed.find((d) => d.client === 'omp');
  assert.strictEqual(omp.path, result.deployed.find((d) => d.client === 'codex').path);
  fs.rmSync(home, { recursive: true, force: true });
});

check('skips a client whose config root is absent instead of creating it', () => {
  const home = tempHome(['claudecode']);
  const result = deployKonohaCommands({ home });
  assert.deepStrictEqual(result.deployed.map((d) => d.client), ['claudecode']);
  const cursorSkip = result.skipped.find((s) => s.client === 'cursor');
  assert.ok(cursorSkip, 'cursor must be reported as skipped');
  assert.match(cursorSkip.reason, /not present for this user/);
  assert.ok(!fs.existsSync(path.join(home, '.cursor')), 'must not create the cursor root');
  fs.rmSync(home, { recursive: true, force: true });
});

check('pi and antigravity are reported unsupported, never given a dead file', () => {
  const home = tempHome([]);
  const result = deployKonohaCommands({ home, force: true });
  for (const entry of UNSUPPORTED_CLIENTS) {
    const skip = result.skipped.find((s) => s.client === entry.client);
    assert.ok(skip, `${entry.client} must be reported`);
    assert.ok(!result.deployed.some((d) => d.client === entry.client), `${entry.client} must not be written`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});

check('rewrites its own command file but leaves a user-authored one alone', () => {
  const home = tempHome(['claudecode']);
  const file = path.join(home, '.claude', 'commands', 'konoha.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, KONOHA_COMMAND_BODY, 'utf8');

  const first = deployKonohaCommands({ home });
  assert.strictEqual(first.deployed[0].unchanged, true, 'identical file is reported unchanged');

  fs.writeFileSync(file, 'my own command\n', 'utf8');
  const second = deployKonohaCommands({ home });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'my own command\n', 'user file must survive');
  assert.match(second.skipped.find((s) => s.client === 'claudecode').reason, /user-owned/);
  fs.rmSync(home, { recursive: true, force: true });
});

check('project scope writes beside the project when a project root is given', () => {
  const home = tempHome(['claudecode']);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cmd_proj_'));
  const result = deployKonohaCommands({ home, projectRoot: project });
  const projectEntry = result.deployed.find((d) => d.scope === 'project');
  assert.ok(projectEntry, 'project-scope command must be written');
  assert.strictEqual(
    projectEntry.path,
    path.join(project, '.claude', 'commands', 'konoha.md')
  );
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

check('ownership is decided by the marker line, not by the body wording', () => {
  const home = tempHome(['claudecode']);
  const file = path.join(home, '.claude', 'commands', 'konoha.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // A user file that merely quotes the template sentence must survive.
  const quoted = '---\ndescription: mine\n---\nRun the Konoha multi-agent workflow for this request\n';
  fs.writeFileSync(file, quoted, 'utf8');
  const first = deployKonohaCommands({ home });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), quoted, 'a user file quoting the body must not be overwritten');
  assert.match(first.skipped.find((s) => s.client === 'claudecode').reason, /user-owned/);

  // Konoha's own file with an older body must still be upgraded.
  const older = '---\ndescription: old\ngenerated_by: konoha\n---\nold instructions\n';
  fs.writeFileSync(file, older, 'utf8');
  const second = deployKonohaCommands({ home });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), KONOHA_COMMAND_BODY, 'an outdated Konoha file must be rewritten');
  assert.strictEqual(second.deployed.find((d) => d.client === 'claudecode').unchanged, undefined);
  fs.rmSync(home, { recursive: true, force: true });
});

check('upgrades a command file written before the marker existed', () => {
  const home = tempHome(['claudecode']);
  const file = path.join(home, '.claude', 'commands', 'konoha.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, LEGACY_COMMAND_BODY, 'utf8');
  assert.notStrictEqual(LEGACY_COMMAND_BODY, KONOHA_COMMAND_BODY, 'the legacy body must differ from the current one');

  const result = deployKonohaCommands({ home });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), KONOHA_COMMAND_BODY, 'a markerless Konoha file must gain the marker');
  assert.strictEqual(result.skipped.some((s) => s.client === 'claudecode'), false, 'it must not be reported as user-owned');
  fs.rmSync(home, { recursive: true, force: true });
});

check('the command body names the workflow entry points and the spawn fallback', () => {
  for (const needle of ['konoha.sannin', 'konoha.build_from_text', 'konoha.report_from_agent', 'run-agent']) {
    assert.ok(KONOHA_COMMAND_BODY.includes(needle), `command body must mention ${needle}`);
  }
});

check('statusOnly reports what is installed without writing anything', () => {
  const home = tempHome(['claudecode']);
  const before = deployKonohaCommands({ home, statusOnly: true });
  assert.deepStrictEqual(before.deployed, [], 'a client with no command file must not be reported as deployed');
  assert.match(before.skipped.find((s) => s.client === 'claudecode').reason, /no command file/);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'commands')), 'statusOnly must not create the directory');

  deployKonohaCommands({ home });
  const after = deployKonohaCommands({ home, statusOnly: true });
  assert.deepStrictEqual(after.deployed.map((d) => d.client), ['claudecode']);
  fs.rmSync(home, { recursive: true, force: true });
});

console.log('\n[Deploy failure reporting]');

check('a throwing client is reported as a failure, the others still deploy', () => {
  const home = tempHome(['claudecode']);

  // `agent_deployer` binds `mcp_clients_manager` at require time, so the stub
  // must be installed before the deployer module is first loaded.
  const stubPath = require.resolve('../src/mcp_clients_manager');
  const savedStub = require.cache[stubPath];
  const deployerPath = require.resolve('../src/agent_deployer');
  const savedDeployer = require.cache[deployerPath];
  delete require.cache[deployerPath];
  require.cache[stubPath] = {
    id: stubPath,
    filename: stubPath,
    loaded: true,
    exports: {
      ensureClaudeCodeSetup: () => { throw new Error('claude setup exploded'); },
      ensureCommandCodeSetup: () => {}
    }
  };

  try {
    const deployer = require('../src/agent_deployer');
    const result = deployer.deployGlobalClientConfigs({
      pythonCmd: 'python3',
      serverPath: '/tmp/server.js',
      agents: [{ name: 'kage', purpose: 'x', instructions: 'x', type: 'self' }],
      home,
      force: false
    });
    const failed = result.failures.find((f) => f.client === 'claudecode');
    assert.ok(failed, 'claudecode failure must be recorded');
    assert.match(failed.error, /claude setup exploded/);
    assert.ok(!result.failures.some((f) => f.client === 'commands'), 'command deployment must not fail');
    assert.ok(result.commands.deployed.some((d) => d.client === 'claudecode'), 'commands still deploy');
  } finally {
    if (savedStub) require.cache[stubPath] = savedStub;
    else delete require.cache[stubPath];
    if (savedDeployer) require.cache[deployerPath] = savedDeployer;
    else delete require.cache[deployerPath];
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check('deployGlobalClientConfigs hands the project root to the command layer', () => {
  const home = tempHome(['claudecode']);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_cmd_deployer_proj_'));

  // The deployer binds its managers at require time, so every one of them is
  // stubbed before the module is loaded. Only the command layer may write.
  const stubs = {
    '../src/mcp_clients_manager': { ensureClaudeCodeSetup: () => {}, ensureCommandCodeSetup: () => {} },
    '../src/opencode_manager': { ensureOpenCodeSetup: () => {} },
    '../src/codex_manager': { ensureCodexSetup: () => {} }
  };
  const saved = {};
  for (const [spec, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(spec);
    saved[resolved] = require.cache[resolved];
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  const deployerPath = require.resolve('../src/agent_deployer');
  saved[deployerPath] = require.cache[deployerPath];
  delete require.cache[deployerPath];

  try {
    const deployer = require('../src/agent_deployer');
    const result = deployer.deployGlobalClientConfigs({
      pythonCmd: 'python3',
      serverPath: '/tmp/server.js',
      agents: [],
      home,
      projectRoot: project,
      deployProject: true,
      force: false
    });
    const projectEntry = result.commands.deployed.find((d) => d.scope === 'project');
    assert.ok(projectEntry, '--project must reach the command layer');
    assert.strictEqual(projectEntry.path, path.join(project, '.claude', 'commands', 'konoha.md'));
    assert.ok(fs.existsSync(projectEntry.path), 'the project-scoped command file must exist');
  } finally {
    for (const [resolved, entry] of Object.entries(saved)) {
      if (entry) require.cache[resolved] = entry;
      else delete require.cache[resolved];
    }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

console.log('\n[Agent profile conflicts]');

check('classifies a foreign profile as foreign and Konoha\'s own as stale', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_conflict_home_'));
  const dir = path.join(home, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });

  // Foreign: the live file is user-authored, so Konoha's version never landed.
  fs.writeFileSync(path.join(dir, 'kage.md'), '# my own kage\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'kage.md.konoha-proposed'), '---\ngenerated_by: konoha\n---\n', 'utf8');

  // Stale: Konoha's own newer file is live; the parked copy is older residue.
  fs.writeFileSync(path.join(dir, 'genin.md'), '---\ngenerated_by: konoha\n---\nv2.2.23\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'genin.md.konoha-proposed'), '---\ngenerated_by: konoha\n---\nv2.2.22\n', 'utf8');

  // Identical: nothing pending at all.
  fs.writeFileSync(path.join(dir, 'anbu.md'), 'same\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'anbu.md.konoha-proposed'), 'same\n', 'utf8');

  const found = listAgentConflicts(home);
  const kindOf = (name) => found.find((c) => path.basename(c.path) === `${name}.md`).kind;
  assert.strictEqual(kindOf('kage'), 'foreign');
  assert.strictEqual(kindOf('genin'), 'stale');
  assert.strictEqual(kindOf('anbu'), 'identical');

  fs.rmSync(home, { recursive: true, force: true });
});

check('reports conflicts in every client agent directory, not only claude', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_conflict_multi_'));
  for (const segments of [['.cursor', 'agents'], ['.codex', 'agents'], ['.omp', 'agent', 'agents']]) {
    const dir = path.join(home, ...segments);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kage.md'), 'foreign\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'kage.md.konoha-proposed'), 'konoha\n', 'utf8');
  }
  const found = listAgentConflicts(home).filter((c) => c.kind === 'foreign');
  assert.strictEqual(found.length, 3, 'cursor, codex and omp conflicts must all be reported');
  fs.rmSync(home, { recursive: true, force: true });
});

check('conflict scan is read-only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_conflict_ro_'));
  const dir = path.join(home, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kage.md'), 'foreign\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'kage.md.konoha-proposed'), 'konoha\n', 'utf8');
  const before = fs.readdirSync(dir).sort();
  listAgentConflicts(home);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), before, 'scan must not create or delete files');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'kage.md'), 'utf8'), 'foreign\n', 'scan must not overwrite');
  fs.rmSync(home, { recursive: true, force: true });
});

console.log(`\n${passed} checks passed\n`);
