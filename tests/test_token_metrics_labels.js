#!/usr/bin/env node
// DB isolation: usage rows are written to a throwaway database.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_token_metrics_labels.js — a byte estimate must never be printed as
 * a measurement.
 *
 * `measure_context_budget.js` divides bytes by 3.8 to say how big the context
 * is. That is an estimate, and the report used to print it exactly like a
 * provider's token count. The rules pinned here:
 *   - every byte-derived figure is labelled `~tok (est)` and the report names
 *     the method (`bytes/3.8`);
 *   - provider-reported usage is reported only when a provider actually said
 *     something, otherwise `available: false` with a reason;
 *   - `normalizeUsage` returns nulls, never zeros, when nothing was reported.
 */

const assert = require('assert');
const path = require('path');

const { normalizeUsage } = require('../src/token_usage');
const { log } = require('../src/tools_savings_logger');
const { reportedUsage, ESTIMATE_METHOD } = require('../scripts/measure_context_budget');
const { getDb } = require('../src/db');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log('Token metric labelling');

check('a provider usage object normalizes onto the shared fields', () => {
  const norm = normalizeUsage({ prompt_tokens: 1200, completion_tokens: 340, prompt_tokens_details: { cached_tokens: 800 } });
  assert.strictEqual(norm.available, true);
  assert.strictEqual(norm.input_tokens, 1200);
  assert.strictEqual(norm.output_tokens, 340);
  assert.strictEqual(norm.total_tokens, 1540);
  assert.strictEqual(norm.cache_read_input_tokens, 800);
  assert.strictEqual(norm.method, 'provider_reported');
});

check('absent usage is unavailable, not zero', () => {
  for (const input of [null, undefined, {}, { prompt_tokens: null }, 'nope']) {
    const norm = normalizeUsage(input);
    assert.strictEqual(norm.available, false, `must not claim usage for ${JSON.stringify(input)}`);
    assert.strictEqual(norm.input_tokens, null);
    assert.strictEqual(norm.output_tokens, null);
    assert.ok(norm.reason);
  }
});

check('a cache-only payload is not a measured prompt count', () => {
  const norm = normalizeUsage({ cache_read_input_tokens: 900 });
  assert.strictEqual(norm.available, false);
  assert.strictEqual(norm.input_tokens, null);
});

check('the budget report names its estimate method', () => {
  assert.strictEqual(ESTIMATE_METHOD, 'bytes/3.8');
});

check('reportedUsage says so when the database holds no provider usage', () => {
  const report = reportedUsage();
  assert.strictEqual(report.available, false);
  assert.match(report.reason, /no provider usage recorded/);
  assert.strictEqual(report.method, 'provider_reported');
});

check('recorded usage round-trips through the tool_calls row', () => {
  log('get_skill', 'konoha/contract', 1200, 'claude', null, {
    prompt_tokens: 2100,
    completion_tokens: 120,
    cached_tokens: 1500
  });

  const conn = getDb();
  try {
    const row = conn.prepare('SELECT input_tokens, output_tokens, cached_tokens FROM tool_calls WHERE tool = ? ORDER BY id DESC LIMIT 1').get('get_skill');
    assert.strictEqual(row.input_tokens, 2100);
    assert.strictEqual(row.output_tokens, 120);
    assert.strictEqual(row.cached_tokens, 1500);
  } finally {
    conn.close();
  }

  const report = reportedUsage();
  assert.strictEqual(report.available, true);
  assert.strictEqual(report.input_tokens, 2100);
  assert.strictEqual(report.output_tokens, 120);
  assert.strictEqual(report.cache_read_input_tokens, 1500);
  assert.strictEqual(report.total_tokens, 2220);
});

check('logging without usage leaves the row unmeasured', () => {
  log('find_skill', 'audit', 40, 'cursor');

  const conn = getDb();
  try {
    const row = conn.prepare('SELECT input_tokens, output_tokens, cached_tokens FROM tool_calls WHERE tool = ? ORDER BY id DESC LIMIT 1').get('find_skill');
    assert.strictEqual(row.input_tokens, null, 'an unreported count stays NULL, never 0');
    assert.strictEqual(row.output_tokens, null);
    assert.strictEqual(row.cached_tokens, null);
  } finally {
    conn.close();
  }
});

check('the printed report marks byte-derived tokens as estimates', () => {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'measure_context_budget.js')], {
    encoding: 'utf8',
    env: { ...process.env, KONOHA_DB_PATH: process.env.KONOHA_DB_PATH }
  });
  assert.match(out, /tokens are ESTIMATES/);
  assert.match(out, /~tok {2}\(est\)/, 'every estimate row carries the est marker');
  assert.ok(!/\d+ +tok {2}\(/.test(out), 'no byte-derived figure is printed as a bare token count');
});

console.log(`\n${passed} checks passed`);
