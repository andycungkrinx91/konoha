#!/usr/bin/env node
// DB isolation: provider usage rows land in a throwaway database.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_provider_usage_persistence.js — provider usage must be recorded
 * from the real production path, and never invented.
 *
 * Contracts pinned here:
 *   - a gateway response carrying provider usage creates one `provider_usage`
 *     row and zero `tool_calls` rows (savings math must not see gateway traffic);
 *   - a gateway response with no provider usage writes nothing;
 *   - the recorded counts are the provider's, never byte-derived;
 *   - `reportedUsage()` reads the persisted row.
 */

const assert = require('assert');
const { getDb } = require('../src/db');
const { recordProviderUsage } = require('../src/provider_usage_logger');
const { reportedUsage } = require('../scripts/measure_context_budget');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function count(conn, table) {
  return conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

console.log('Provider usage persistence');

check('a reported gateway response is persisted with provider counts', () => {
  const result = recordProviderUsage({
    source: 'gateway',
    usage: { prompt_tokens: 4200, completion_tokens: 310, prompt_tokens_details: { cached_tokens: 3000 } },
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    client: 'claudecode',
    bridgeName: 'anthropic-bridge',
    stream: true
  });
  assert.strictEqual(result.recorded, true);

  const conn = getDb();
  try {
    const row = conn.prepare('SELECT * FROM provider_usage ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.source, 'gateway');
    assert.strictEqual(row.provider, 'anthropic');
    assert.strictEqual(row.model, 'claude-sonnet-4');
    assert.strictEqual(row.bridge_name, 'anthropic-bridge');
    assert.strictEqual(row.stream, 1);
    assert.strictEqual(row.input_tokens, 4200);
    assert.strictEqual(row.output_tokens, 310);
    assert.strictEqual(row.cached_tokens, 3000);
    assert.strictEqual(row.total_tokens, 4510);
  } finally {
    conn.close();
  }
});

check('gateway traffic never becomes a tool call', () => {
  const conn = getDb();
  try {
    assert.strictEqual(count(conn, 'tool_calls'), 0, 'a gateway response must not inflate savings call counts');
  } finally {
    conn.close();
  }
});

check('absent provider usage writes nothing', () => {
  for (const usage of [null, undefined, {}, { cache_read_input_tokens: 900 }]) {
    const result = recordProviderUsage({ source: 'gateway', usage, model: 'm' });
    assert.strictEqual(result.recorded, false, `must not record for ${JSON.stringify(usage)}`);
    assert.ok(result.reason);
  }
  const conn = getDb();
  try {
    assert.strictEqual(count(conn, 'provider_usage'), 1, 'only the reported response may be stored');
  } finally {
    conn.close();
  }
});

check('a measured zero is stored as zero, not dropped as absent', () => {
  recordProviderUsage({ source: 'gateway', usage: { prompt_tokens: 0, completion_tokens: 0 }, model: 'm' });
  const conn = getDb();
  try {
    const row = conn.prepare('SELECT input_tokens, output_tokens, total_tokens FROM provider_usage ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.input_tokens, 0);
    assert.strictEqual(row.output_tokens, 0);
    assert.strictEqual(row.total_tokens, 0);
  } finally {
    conn.close();
  }
});

check('reportedUsage reads the persisted provider row', () => {
  const report = reportedUsage();
  assert.strictEqual(report.available, true);
  assert.strictEqual(report.method, 'provider_reported');
  assert.strictEqual(report.source, 'gateway');
  assert.strictEqual(report.input_tokens, 0);
  assert.strictEqual(report.output_tokens, 0);
});

check('a partial report leaves total_tokens null instead of a fake sum', () => {
  recordProviderUsage({ source: 'gateway', usage: { prompt_tokens: 100 }, model: 'm' });
  const report = reportedUsage();
  assert.strictEqual(report.input_tokens, 100);
  assert.strictEqual(report.output_tokens, null);
  assert.strictEqual(report.total_tokens, null, 'half a total must not be printed as a total');
});

check('an aggregate is null when any measured event omitted that field', () => {
  const report = reportedUsage();
  assert.strictEqual(report.totals.output_tokens, null, 'one event without an output count makes the output total unknown');
  const conn = getDb();
  let expectedInput;
  try {
    expectedInput = conn.prepare('SELECT SUM(input_tokens) AS s FROM provider_usage').get().s;
  } finally {
    conn.close();
  }
  assert.strictEqual(report.totals.input_tokens, expectedInput, 'every measured event reported input, so the input total is real');
});

check('the writer survives a broken database handle', () => {
  const result = recordProviderUsage({ source: 'gateway', usage: { prompt_tokens: 5 } }, '/nonexistent/dir/none.db');
  assert.strictEqual(result.recorded, false, 'telemetry must fail closed, not throw');
});

console.log(`\n${passed} checks passed`);
