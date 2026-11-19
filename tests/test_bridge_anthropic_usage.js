#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * The per-bridge `/v1/messages` handler (src/bridge/handlers/anthropic.js) is a
 * separate path from the gateway adapter. It used to answer with
 * `usage: { input_tokens: 0, output_tokens: 0 }` whatever the provider said,
 * and it persisted nothing.
 *
 * Contracts:
 * - a provider-reported count reaches the Anthropic wire response
 * - an unreported count is omitted, never written as a fabricated 0
 * - reported usage is persisted once, with source `bridge`
 * - absent usage writes no row
 */

const assert = require('assert');

const RAW_PATH = require.resolve('../src/bridge/sidecar/raw');

let nextRaw = { content: 'ok', toolCalls: null, usage: null };
require.cache[RAW_PATH] = {
  id: RAW_PATH,
  filename: RAW_PATH,
  loaded: true,
  exports: { callRawInference: async () => nextRaw }
};

const { handleAnthropicToOpenAi } = require('../src/bridge/handlers/anthropic');
const { getDb } = require('../src/db');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

async function run(payload, isStream) {
  let body = null;
  const events = [];
  const res = {
    headersSent: false,
    setHeader() {},
    writeHead() { this.headersSent = true; },
    write(chunk) { events.push(String(chunk)); },
    end(chunk) { if (chunk) body = JSON.parse(chunk); }
  };
  const ctx = { bridgeConfig: { provider: 'anthropic' }, requestedModel: null };
  await handleAnthropicToOpenAi(ctx, {}, res, isStream, payload, 'testmsg');
  return { body, wire: events.join(''), ctx };
}

function usageRows() {
  const conn = getDb();
  try {
    return conn.prepare('SELECT source, provider, input_tokens, output_tokens FROM provider_usage ORDER BY id').all();
  } finally {
    try { conn.close(); } catch (_) { /* ignore */ }
  }
}

function clearRows() {
  const conn = getDb();
  try { conn.prepare('DELETE FROM provider_usage').run(); } finally {
    try { conn.close(); } catch (_) { /* ignore */ }
  }
}

function parseEvents(wire) {
  return wire.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    return {
      event: lines.find((l) => l.startsWith('event: '))?.slice(7),
      data: JSON.parse(lines.find((l) => l.startsWith('data: ')).slice(6))
    };
  });
}

(async () => {
  console.log('non-stream usage');

  clearRows();
  nextRaw = { content: 'ok', toolCalls: null, usage: { prompt_tokens: 31, completion_tokens: 9 } };
  const reported = await run({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, false);
  test('provider counts reach the non-stream response', () => {
    assert.strictEqual(reported.body.usage.input_tokens, 31);
    assert.strictEqual(reported.body.usage.output_tokens, 9);
  });
  test('reported usage is persisted once with source gateway', () => {
    const rows = usageRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].source, 'gateway');
    assert.strictEqual(rows[0].input_tokens, 31);
    assert.strictEqual(rows[0].output_tokens, 9);
  });

  clearRows();
  nextRaw = { content: 'ok', toolCalls: null, usage: null };
  const absent = await run({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, false);
  test('unreported usage is omitted, not fabricated as 0', () => {
    assert.deepStrictEqual(absent.body.usage, {});
  });
  test('absent usage persists no row', () => {
    assert.strictEqual(usageRows().length, 0);
  });

  clearRows();
  nextRaw = { content: 'ok', toolCalls: null, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  const zero = await run({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, false);
  test('provider-measured zero survives the wire', () => {
    assert.strictEqual(zero.body.usage.input_tokens, 0);
    assert.strictEqual(zero.body.usage.output_tokens, 0);
  });

  console.log('stream usage');
  clearRows();
  nextRaw = { content: 'ok', toolCalls: null, usage: { prompt_tokens: 44, completion_tokens: 12 } };
  const streamed = await run({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }, true);
  const events = parseEvents(streamed.wire);
  test('message_delta carries provider counts, not a fabricated 0', () => {
    const delta = events.find((e) => e.event === 'message_delta');
    assert.strictEqual(delta.data.usage.input_tokens, 44);
    assert.strictEqual(delta.data.usage.output_tokens, 12);
  });

  clearRows();
  nextRaw = { content: 'ok', toolCalls: null, usage: null };
  const streamedAbsent = await run({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }, true);
  test('unreported stream usage is an empty object', () => {
    const delta = parseEvents(streamedAbsent.wire).find((e) => e.event === 'message_delta');
    assert.deepStrictEqual(delta.data.usage, {});
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
