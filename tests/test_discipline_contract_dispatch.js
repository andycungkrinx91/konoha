#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies that every dispatched subagent receives the bounded discipline
 * contract (antislop rules + i-have-adhd output shaping).
 *
 * Regression guard: autoloadSkillsFromPrompt deliberately skips these skills,
 * which previously meant they never reached a spawned subagent at all.
 */

const assert = require('assert');
const {
  buildDisciplineContract,
  MAX_CONTRACT_BYTES,
  ADHD_RULES,
  ANTISLOP_RULES
} = require('../src/mcp/discipline_contract');
const runner = require('../src/mcp/memory_subagent_runner');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('discipline contract shape');

test('contract stays within its byte ceiling', () => {
  const bytes = Buffer.byteLength(buildDisciplineContract(), 'utf8');
  assert.ok(bytes <= MAX_CONTRACT_BYTES, `${bytes} bytes exceeds ${MAX_CONTRACT_BYTES}`);
});

test('carries all antislop rules', () => {
  const c = buildDisciplineContract();
  for (const r of ANTISLOP_RULES) assert.ok(c.includes(r), `missing: ${r.slice(0, 40)}`);
});

test('carries all adhd shaping rules', () => {
  const c = buildDisciplineContract();
  for (const r of ADHD_RULES) assert.ok(c.includes(r), `missing: ${r.slice(0, 40)}`);
});

test('is deterministic so it does not break prompt caching', () => {
  assert.strictEqual(buildDisciplineContract(), buildDisciplineContract());
});

console.log('dispatch prompt integration');

const prompt = runner.runMcpAgent('anbu', 'harden the bridge error paths', null, null);

test('runMcpAgent returns a prompt string', () => {
  assert.strictEqual(typeof prompt, 'string');
});

test('dispatch prompt contains the antislop mandate', () => {
  assert.ok(prompt.includes('Anti-Slop Mandate'), 'antislop rules must reach the subagent');
});

test('dispatch prompt contains adhd output shaping', () => {
  assert.ok(prompt.includes('i-have-adhd'), 'adhd shaping must reach the subagent');
});

test('dispatch prompt contains the MCP tool boundary block', () => {
  assert.ok(prompt.includes('MCP Tools Available To You'));
});

test('dispatch prompt remains bounded', () => {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  assert.ok(bytes < 16384, `prompt grew to ${bytes} bytes`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
