#!/usr/bin/env node
// DB isolation: init must never touch the real database.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_client_selection_args.js — an explicit `--client` is validated or
 * rejected, never repaired into "all clients".
 *
 * The defect: `parseRequestedClients(['--client='])` returned `[]`, which
 * `explicitSelection` read as "no flag", silently widening an explicit empty
 * selection into auto-detect over every client. `['--client']` (no value) was
 * indistinguishable from no flag, and `['--client=unknown']` was accepted.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseRequestedClients, KNOWN_CLIENTS } = require('../bin/commands/init_clients');
const { deployKonohaCommands, UNSUPPORTED_CLIENTS } = require('../src/client_commands');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function expectThrow(args, pattern) {
  assert.throws(() => parseRequestedClients(args), pattern);
}

console.log('\n[Client selection parsing]');

check('no flag is null, not an empty selection', () => {
  assert.strictEqual(parseRequestedClients([]), null);
  assert.strictEqual(parseRequestedClients(['init']), null);
  assert.strictEqual(parseRequestedClients(['--yes', '--no-embed']), null);
});

check('every known client parses to itself', () => {
  for (const client of KNOWN_CLIENTS) {
    assert.deepStrictEqual(parseRequestedClients([`--client=${client}`]), [client], client);
  }
});

check('aliases normalize', () => {
  assert.deepStrictEqual(parseRequestedClients(['--client=claude-code']), ['claude']);
  assert.deepStrictEqual(parseRequestedClients(['--client=command-code']), ['commandcode']);
  assert.deepStrictEqual(parseRequestedClients(['--client=antigravity-cli']), ['antigravity']);
  assert.deepStrictEqual(parseRequestedClients(['--client=gemini']), ['antigravity']);
});

check('comma lists and both flag spellings parse', () => {
  assert.deepStrictEqual(parseRequestedClients(['--client=cursor,codex']), ['cursor', 'codex']);
  assert.deepStrictEqual(parseRequestedClients(['--clients=cursor']), ['cursor']);
  assert.deepStrictEqual(parseRequestedClients(['--client', 'cursor']), ['cursor']);
});

check('all is a whole selection, never a list member', () => {
  assert.deepStrictEqual(parseRequestedClients(['--client=all']), ['all']);
  // Mixed lists must fail: folding them to `all` would quietly widen an explicit choice.
  expectThrow(['--client=cursor,all'], /cannot be combined with other clients/);
  expectThrow(['--client=all,cursor'], /cannot be combined with other clients/);
});

console.log('\n[Client selection rejection]');

check('empty value throws instead of returning []', () => {
  expectThrow(['--client='], /--client requires a value/);
  expectThrow(['--client=,'], /--client has an empty entry/);
  expectThrow(['--client=  '], /--client requires a value/);
});

check('malformed member lists are rejected, not repaired', () => {
  expectThrow(['--client=cursor,,codex'], /empty entry at position 2/);
  expectThrow(['--client=cursor,'], /empty entry at position 2/);
  expectThrow(['--client=,cursor'], /empty entry at position 1/);
});

check('missing value throws instead of returning null', () => {
  expectThrow(['--client'], /--client requires a value/);
  expectThrow(['--client', '--yes'], /--client requires a value/);
});

check('unknown client throws and names the token', () => {
  expectThrow(['--client=unknown'], /unknown client "unknown"/);
  expectThrow(['--client=claude,unknown'], /unknown client "unknown"/);
});

console.log('\n[Empty selection writes nothing]');

check('deployKonohaCommands with clients: [] selects no client', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sel_home_'));
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    const before = fs.readdirSync(home, { recursive: true }).map(String).sort();
    const result = deployKonohaCommands({ home, clients: [] });
    assert.deepStrictEqual(result.deployed, [], 'no command file may be written');
    const after = fs.readdirSync(home, { recursive: true }).map(String).sort();
    assert.deepStrictEqual(after, before, 'an explicit empty selection must not touch the filesystem');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check('unsupported clients are reported only when explicitly requested', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sel_home_'));
  try {
    const none = deployKonohaCommands({ home, clients: [] });
    assert.deepStrictEqual(none.skipped, []);
    const pi = deployKonohaCommands({ home, clients: ['pi'] });
    assert.deepStrictEqual(pi.skipped.map((s) => s.client).sort(),
      UNSUPPORTED_CLIENTS.map((s) => s.client).filter((c) => c === 'pi'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

console.log('\n[init rejects an invalid selection before writing]');

check('konoha init --client= exits 1 and creates nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sel_cli_'));
  try {
    const { spawnSync } = require('child_process');
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'init', '--yes', '--client='], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, HOME: home, USERPROFILE: home, KONOHA_SKIP_UV_INSTALL: '1', KONOHA_SKIP_RTK_INSTALL: '1' },
      encoding: 'utf8',
      timeout: 120000
    });
    assert.strictEqual(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}${res.stderr}`, /--client requires a value/);
    assert.deepStrictEqual(fs.readdirSync(home, { recursive: true }).map(String), [],
      'a rejected selection must not create any file');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check('an invalid selection is rejected before the --force cleanup runs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sel_force_'));
  try {
    const { spawnSync } = require('child_process');
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'init', '--yes', '--force', '--client='], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, HOME: home, USERPROFILE: home, KONOHA_SKIP_UV_INSTALL: '1', KONOHA_SKIP_RTK_INSTALL: '1' },
      encoding: 'utf8',
      timeout: 120000
    });
    assert.strictEqual(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}${res.stderr}`, /--client requires a value/);
    assert.deepStrictEqual(fs.readdirSync(home, { recursive: true }).map(String), [],
      '--force must not reach the cache purge or UI stop when the selection is invalid');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed\n`);
