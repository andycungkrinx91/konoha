#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Guards the `konoha help` catalog against drift: every command the CLI
 * accepts must be discoverable in help, and help must not advertise commands
 * that no longer exist.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cliSrc = fs.readFileSync(path.join(root, 'bin', 'cli.js'), 'utf8');
const helpSrc = fs.readFileSync(path.join(root, 'bin', 'commands', 'help.js'), 'utf8');

const cliCommands = [...cliSrc.matchAll(/case '([a-z][a-z-]*)':/g)]
  .map((m) => m[1])
  .filter((c) => !c.startsWith('-'));
const CMD_OPEN = String.fromCharCode(36) + '{C.cyan}';
const CMD_CLOSE = String.fromCharCode(36) + '{C.reset}';
const helpCommands = helpSrc
  .split('\n')
  .map((line) => {
    const start = line.indexOf(CMD_OPEN);
    if (start < 0) return [];
    const end = line.indexOf(CMD_CLOSE, start);
    if (end < 0) return [];
    return line.slice(start + CMD_OPEN.length, end).split(',').map((t) => t.trim()).filter(Boolean);
  })
  .flat();

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('konoha help currency');

test('every CLI command appears in help', () => {
  const missing = [...new Set(cliCommands)].filter((c) => !helpCommands.includes(c));
  assert.deepStrictEqual(missing, [], `help omits: ${missing.join(', ')}`);
});

test('help advertises no command the CLI rejects', () => {
  // Help documents the short flags alongside their long forms.
  const phantom = helpCommands.filter((c) => !c.startsWith('-') && !cliCommands.includes(c));
  assert.deepStrictEqual(phantom, [], `help invents: ${phantom.join(', ')}`);
});

test('help names all eight supported clients', () => {
  const clients = ['Antigravity', 'Cursor', 'Claude Code', 'OpenCode', 'Command Code', 'Codex', 'Pi', 'OMP'];
  const missing = clients.filter((c) => !helpSrc.includes(c));
  assert.deepStrictEqual(missing, [], `help omits clients: ${missing.join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
