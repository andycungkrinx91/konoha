#!/usr/bin/env node
// DB isolation: this test must not touch the real database.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_client_capability_matrix.js — the per-client capability table in
 * docs/SETUP-MCP-CLIENTS.md must match the code that implements it.
 *
 * The doc is the only place a user can find out which client gets a `/konoha`
 * command file, which skills directory it reads, and whether it can spawn a
 * native subagent. A table that drifts from `src/client_commands.js`,
 * `src/global_skill_sync.js`, or `src/mcp/lazy_subagent.js` misleads exactly the
 * user who has no other source. Parsing the real table and comparing it to the
 * real modules makes drift a failing test instead of a support ticket.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { COMMAND_TARGETS, UNSUPPORTED_CLIENTS } = require('../src/client_commands');
const { getGlobalHarnessSkillTargets } = require('../src/global_skill_sync');
const { resolveSpawnDescriptor } = require('../src/mcp/lazy_subagent');

const DOC = path.join(__dirname, '..', 'docs', 'SETUP-MCP-CLIENTS.md');
const HEADING = /^## Native `\/konoha` command and subagent support$/;

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

/** Rows of the capability table: `client` plus the raw cells. */
function readMatrix() {
  const lines = fs.readFileSync(DOC, 'utf8').split('\n');
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  assert.ok(start >= 0, `docs/SETUP-MCP-CLIENTS.md is missing the "${HEADING.source}" section`);

  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^## /.test(line)) break; // next section: table ended
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (/^-+$/.test(cells[0].replace(/:/g, ''))) continue; // separator row
    const name = cells[0].replace(/`/g, '');
    if (name === 'Client') continue; // header row
    rows.push({ client: name, command: cells[1], skills: cells[2], mcp: cells[3], spawn: cells[4] });
  }
  return rows;
}

const rows = readMatrix();
const documented = rows.map((r) => r.client);

// Doc uses `claudecode`; the sync table calls the same client `claude`.
const CODE_ALIAS = { claudecode: 'claude' };
const canonical = (name) => CODE_ALIAS[name] || name;

console.log('\n[Client capability matrix]');

check('every documented client exists in code, and no client is undocumented', () => {
  const fromCommands = new Set([
    ...COMMAND_TARGETS.map((t) => t.client),
    ...COMMAND_TARGETS.flatMap((t) => t.alsoServes || []),
    ...UNSUPPORTED_CLIENTS.map((u) => u.client)
  ]);
  assert.deepStrictEqual(
    [...fromCommands].sort(),
    [...documented].sort(),
    'the doc table and src/client_commands.js must name the same clients'
  );
});

check('command-file column matches whether a prompt file is written', () => {
  const written = new Set([
    ...COMMAND_TARGETS.map((t) => t.client),
    ...COMMAND_TARGETS.flatMap((t) => t.alsoServes || [])
  ]);
  for (const row of rows) {
    if (written.has(row.client)) {
      assert.match(row.command, /konoha\.md/, `${row.client} must document a command file path`);
      assert.ok(!/^none$/i.test(row.command), `${row.client} does get a command file`);
    } else {
      assert.match(row.command, /^none$/i, `${row.client} must be documented as "none"`);
    }
  }
});

check('every documented skills directory is a real sync target', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_matrix_'));
  try {
    const targets = getGlobalHarnessSkillTargets(home);
    for (const row of rows) {
      const dirs = targets
        .filter((t) => t.client === canonical(row.client))
        .map((t) => t.skillsDir);
      assert.ok(dirs.length > 0, `${row.client} has no skills sync target`);
      // The doc writes `~/…`; resolve it against the same home the sync targets
      // use and demand an exact match. A suffix comparison would accept a wrong
      // client path that happens to end the same way.
      const documentedPaths = row.skills.match(/`~\/[^`]+`/g) || [];
      assert.ok(documentedPaths.length > 0, `${row.client} must document at least one ~/ skills path`);
      for (const quoted of documentedPaths) {
        const expected = path.join(home, quoted.replace(/`/g, '').slice(2));
        assert.ok(dirs.includes(expected),
          `${row.client} documents a skills dir that no sync target writes: ${quoted} (resolved: ${expected}; targets: ${dirs.join(', ')})`);
      }
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check('native-spawn column matches resolveSpawnDescriptor', () => {
  for (const row of rows) {
    const desc = resolveSpawnDescriptor(row.client);
    const expectSupported = row.client !== 'pi';
    assert.strictEqual(desc.supported, expectSupported,
      `${row.client}: doc says ${row.spawn}; resolveSpawnDescriptor.supported=${desc.supported}`);
    if (expectSupported) {
      assert.ok(row.spawn.includes(`${desc.tool}(`),
        `${row.client}: documented tool must be ${desc.tool}(…), got "${row.spawn}"`);
    }
  }
});

check('pi becomes spawn-capable only with the extension, and the doc says so', () => {
  assert.strictEqual(resolveSpawnDescriptor('pi').supported, false);
  assert.strictEqual(resolveSpawnDescriptor('pi', { piSubagentSupported: true }).supported, true);
  const pi = rows.find((r) => r.client === 'pi');
  assert.match(pi.spawn, /pi-subagents/, 'pi row must name the extension the capability depends on');
});

check('every documented client mirrors into the shared global skills dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_matrix_'));
  try {
    const targets = getGlobalHarnessSkillTargets(home);
    assert.ok(targets.some((t) => t.client === 'global'), 'the shared global target must exist');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed\n`);
