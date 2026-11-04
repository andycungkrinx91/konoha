#!/usr/bin/env node
'use strict';

/**
 * Guards the RTK-only web retrieval policy for research agents.
 *
 * Chunin is the only agent allowed to leave the sandbox for external sources.
 * Every source must come back through `rtk curl` so the gateway receives
 * compressed, citation-bearing text instead of raw markup. Non-research agents
 * must not pay for the rule at all.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runner = require(path.join(ROOT, 'src/mcp/memory_subagent_runner'));
const { getCanonicalAgentNames } = require(path.join(ROOT, 'src/canonical_agents'));

const runnerSource = fs.readFileSync(path.join(ROOT, 'src/mcp/memory_subagent_runner.js'), 'utf8');
const agentTemplate = fs.readFileSync(path.join(ROOT, 'src/templates/agents.yaml'), 'utf8');
const chuninSkill = fs.readFileSync(path.join(ROOT, 'src/templates/skills/chunin-skill/SKILL.md'), 'utf8');

function chuninTemplateBlock() {
  const start = agentTemplate.indexOf('- name: chunin\n');
  assert.ok(start >= 0, 'chunin block must exist in src/templates/agents.yaml');
  const next = agentTemplate.indexOf('\n- name: ', start);
  return agentTemplate.slice(start, next < 0 ? agentTemplate.length : next);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('research fetch rule mandates rtk curl and forbids bare fetchers', () => {
  const rule = runner.buildResearchFetchRule('chunin');
  assert.ok(rule.includes('rtk curl <url>'), 'rule must mandate `rtk curl <url>`');
  assert.ok(/never bare curl, wget, or raw fetch/.test(rule), 'rule must forbid bare curl/wget/fetch');
  assert.ok(/citation ids verbatim/i.test(rule), 'rule must preserve citation ids verbatim');
  assert.ok(rule.endsWith('\n'), 'rule must end with a newline so prompt sections do not merge');
});

test('research fetch rule stays inside its byte budget', () => {
  const bytes = Buffer.byteLength(runner.buildResearchFetchRule('chunin'), 'utf8');
  assert.ok(bytes > 60 && bytes <= 220, `rule must stay bounded, got ${bytes} B`);
});

test('only research agents receive the fetch rule', () => {
  const roster = getCanonicalAgentNames();
  assert.ok(roster.length >= 9, 'canonical roster must be loaded');
  const withRule = roster.filter((name) => runner.buildResearchFetchRule(name).length > 0);
  assert.deepStrictEqual(withRule, ['chunin'], `unexpected agents with fetch rule: ${withRule.join(', ')}`);
});

test('unknown agents never receive the fetch rule', () => {
  for (const name of ['', 'orchestrator', 'kage ', 'CHUNIN']) {
    assert.strictEqual(runner.buildResearchFetchRule(name), '', `agent "${name}" must not receive the rule`);
  }
});

test('prompt anchor mandates rtk for web fetches in every subagent prompt', () => {
  assert.ok(runnerSource.includes('rtk curl <url>'), 'prompt anchor must mention `rtk curl <url>`');
  assert.ok(
    runnerSource.includes('Prefix shell and test runs with `rtk <command>`'),
    'prompt anchor must cover both shell commands and test runs'
  );
  assert.ok(
    !runnerSource.includes('RTK IS MANDATORY FOR COMMANDS'),
    'superseded command-only wording must be gone'
  );
});

test('duplicate confidence-gate line stays removed so policy bytes are offset', () => {
  const occurrences = runnerSource.split('Minimum 98% confidence gate: mechanically verified').length - 1;
  assert.strictEqual(occurrences, 0, 'the duplicated confidence gate line must stay removed');
  assert.ok(
    runnerSource.includes('KAGE 98% CONFIDENCE GATE'),
    'the canonical KAGE confidence gate must remain'
  );
});

test('chunin template contract carries the rtk fetch mandate', () => {
  const block = chuninTemplateBlock();
  assert.ok(block.includes('rtk curl <url>'), 'chunin constraints must mandate `rtk curl <url>`');
  assert.ok(/minimum 98% confidence gate/.test(block), 'chunin confidence gate must survive the edit');
  assert.ok(
    !/allow (bare|plain) curl/i.test(block),
    'chunin template must never authorize bare curl'
  );
});

test('chunin skill SOP teaches the same retrieval rule', () => {
  assert.ok(chuninSkill.includes('rtk curl <url>'), 'chunin-skill must mandate `rtk curl <url>`');
  assert.ok(/citation id/i.test(chuninSkill), 'chunin-skill must keep citation ids verbatim');
  assert.ok(
    !/use `curl /.test(chuninSkill),
    'chunin-skill must not contradict the mandate by recommending bare curl'
  );
});

test('non-chunin agents keep the generic RTK shell mandate only', () => {
  const anbuRule = runner.buildResearchFetchRule('anbu');
  const joninRule = runner.buildResearchFetchRule('jonin');
  assert.strictEqual(anbuRule, '');
  assert.strictEqual(joninRule, '');
  assert.ok(
    runnerSource.includes('RTK IS MANDATORY'),
    'generic RTK shell mandate must remain for every agent'
  );
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}`);
    console.log(`  ${err.message}`);
  }
}

console.log(`\n${passed}/${tests.length} research RTK policy tests passed`);
if (failures.length > 0) process.exit(1);
