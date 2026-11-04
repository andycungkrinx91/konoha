#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies that every supported coding client receives a complete, canonical
 * delegation contract: the full ninja roster, a router that may spawn
 * subagents, and a bounded discipline contract on each dispatch.
 *
 * This is the cross-client guard for the "subagents never appear / never
 * delegate" class of defect.
 */

const assert = require('assert');
const { SUPPORTED_CLIENTS } = require('../src/agent_manager');
const { getCanonicalAgentNames } = require('../src/canonical_agents');
const { buildDisciplineContract } = require('../src/mcp/discipline_contract');
const { buildDefineSubagentArgs } = require('../src/antigravity_agents');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

const canonical = getCanonicalAgentNames();

console.log(`client roster (${SUPPORTED_CLIENTS.length} clients)`);

test('exactly eight clients are supported', () => {
  assert.strictEqual(SUPPORTED_CLIENTS.length, 8, `found ${SUPPORTED_CLIENTS.length}`);
});

test('client list matches the documented set', () => {
  const expected = ['antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi', 'omp'];
  assert.deepStrictEqual([...SUPPORTED_CLIENTS].sort(), expected.sort());
});

test('canonical roster contains all nine agents', () => {
  const expected = ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka'];
  assert.deepStrictEqual([...canonical].sort(), expected.sort());
});

console.log('delegation capability');

test('only the router may spawn subagents', () => {
  const mk = (name) => ({ name, description: 'd', instructions: 'i', skills: [] });
  assert.strictEqual(buildDefineSubagentArgs(mk('sannin')).enable_subagent_tools, true,
    'the router must be able to spawn subagents');
  for (const name of canonical.filter((n) => n !== 'sannin')) {
    assert.strictEqual(buildDefineSubagentArgs(mk(name)).enable_subagent_tools, false,
      `${name} must not spawn subagents`);
  }
});

test('every dispatched agent receives the discipline contract', () => {
  const contract = buildDisciplineContract();
  assert.ok(contract.includes('Anti-Slop Mandate'));
  assert.ok(contract.includes('i-have-adhd'));
});

console.log('per-client roster binding');

// Pi is MCP-only: it registers the konoha MCP server and a prose contract,
// and has no per-agent definition files to generate, so it needs no roster module.
const perAgentFileClients = {
  cursor: '../src/cursor_manager',
  codex: '../src/codex_manager',
  antigravity: '../src/antigravity_manager'
};

for (const [client, modulePath] of Object.entries(perAgentFileClients)) {
  test(`${client} derives its roster from the canonical source`, () => {
    const src = require('fs').readFileSync(require.resolve(modulePath), 'utf8');
    const usesCanonical = src.includes('getCanonicalAgentNames') || src.includes('canonical_agents');
    assert.ok(usesCanonical, `${client} must not hardcode a roster`);
  });
}

console.log('antigravity deployment');

test('deployed Antigravity agent.json grants spawning to the router only', () => {
  const os = require('os');
  const path = require('path');
  const { buildAgentJson } = require('../src/antigravity_agents');
  const { loadAgents } = require('../src/agent_manager');
  const agents = loadAgents();
  const enabled = agents
    .map((a) => [a.name, buildAgentJson(a).config.customAgent.enable_subagent_tools])
    .filter(([, flag]) => flag === true)
    .map(([name]) => name);
  assert.deepStrictEqual(enabled, ['sannin'], 'only the router may spawn subagents');
});

test('deployed agents carry the canonical roster', () => {
  const { loadAgents } = require('../src/agent_manager');
  const names = loadAgents().map((a) => a.name).sort();
  assert.deepStrictEqual(names, [...canonical].sort());
});

console.log('pi prose contract');

test('pi contract names every canonical agent', () => {
  const src = require('fs').readFileSync(require.resolve('../src/pi_manager'), 'utf8');
  const missing = canonical.filter((name) => !src.includes(name));
  assert.deepStrictEqual(missing, [], `pi contract never names: ${missing.join(', ')}`);
});

console.log('roster completeness');

test('yamanaka is present in the canonical roster', () => {
  assert.ok(canonical.includes('yamanaka'), 'yamanaka must be deployable to every client');
});

test('no duplicate agent names', () => {
  assert.strictEqual(new Set(canonical).size, canonical.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
