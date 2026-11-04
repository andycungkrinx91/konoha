#!/usr/bin/env node
'use strict';

/**
 * Guards the Telegram subagent surface: every agent the poller routes must
 * have a dispatch entry and appear in `/help`, and `/doctor` must derive its
 * version/skill counts from live sources instead of literals.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'telegram', 'poller.js'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('telegram subagent parity');

const routeMatch = src.match(/match\(\/\^\\\/\(([^)]+)\)/);
if (!routeMatch) throw new Error('dispatch regex not found in poller source');
const routeAgents = routeMatch[1].split('|').map((t) => t.replace('[-_]jonin', '-jonin').trim());

const mapBlock = src.slice(src.indexOf('const AGENT_SUBCOMMANDS'), src.indexOf('function _buildDoctorText'));
const mapAgents = [...mapBlock.matchAll(/^\s+'?([a-z][a-z-]*)'?: \{ name:/gm)].map((m) => m[1]);

const helpBlock = src.slice(src.indexOf('Subagent Direct Dispatch'), src.indexOf('You can also send any plain'));
const helpAgents = [...helpBlock.matchAll(/<b>\/([a-z_-]+) &lt;prompt/g)].map((m) => m[1].replace(/_/g, '-'));

test('dispatch regex is non-empty and normalizes to known agents', () => {
  assert.ok(routeAgents.length >= 9, `parsed ${routeAgents.length} routed agents`);
});

test('every routed agent has a dispatch entry', () => {
  const missing = routeAgents.filter((a) => !mapAgents.includes(a));
  assert.deepStrictEqual(missing, [], `no AGENT_SUBCOMMANDS entry for: ${missing.join(', ')}`);
});

test('every dispatch entry is routed', () => {
  const orphan = mapAgents.filter((a) => !routeAgents.includes(a));
  assert.deepStrictEqual(orphan, [], `unreachable dispatch entry: ${orphan.join(', ')}`);
});

test('/help lists every routed agent', () => {
  const missing = routeAgents.filter((a) => !helpAgents.includes(a));
  assert.deepStrictEqual(missing, [], `/help omits: ${missing.join(', ')}`);
});

test('/doctor derives version and skill count at runtime', () => {
  assert.ok(src.includes("require('../../package.json').version"), '/doctor must read package.json');
  assert.ok(src.includes('FROM skills'), '/doctor must count skills from the database');
  assert.ok(!/1,027/.test(src), '/doctor must not ship a hardcoded skill count');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
