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
  test('unreported usage fails the request instead of emitting {}', () => {
    assert.strictEqual(absent.body.type, 'error');
    assert.strictEqual(absent.body.error.type, 'api_error');
    assert.match(absent.body.error.message, /no token usage/i);
    assert.strictEqual(absent.body.usage, undefined);
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
  test('unreported stream usage emits an error event, never a message_start', () => {
    const absentEvents = parseEvents(streamedAbsent.wire);
    assert.strictEqual(absentEvents.length, 1);
    assert.strictEqual(absentEvents[0].event, 'error');
    assert.strictEqual(absentEvents[0].data.type, 'error');
    assert.strictEqual(absentEvents.find((e) => e.event === 'message_start'), undefined);
    assert.strictEqual(absentEvents.find((e) => e.event === 'message_delta'), undefined);
  });

  test('message_start precedes message_delta and both carry the required counts', () => {
    const names = events.map((e) => e.event);
    assert.strictEqual(names[0], 'message_start');
    assert.ok(names.indexOf('message_delta') > 0);
    const start = events.find((e) => e.event === 'message_start');
    assert.strictEqual(start.data.message.usage.input_tokens, 44);
    assert.strictEqual(start.data.message.usage.output_tokens, 12);
  });

  console.log('provider compatibility');

  test('stream usage reporting is requested by default and can be opted out', () => {
    const { supportsStreamUsage } = require('../src/bridge/gateway_adapters');
    assert.strictEqual(supportsStreamUsage({ provider: 'openai' }), true);
    assert.strictEqual(supportsStreamUsage({ provider: 'openai-compatible' }), true);
    assert.strictEqual(supportsStreamUsage({ provider: 'strict-validator' }), true);
    assert.strictEqual(supportsStreamUsage(null), true);
    assert.strictEqual(supportsStreamUsage({ provider: 'strict-validator', supportsStreamUsage: false }), false);
  });

  test('non-integer provider counts are rejected, not rounded or emitted', () => {
    const { completeAnthropicUsage } = require('../src/bridge/gateway_adapters');
    const withUsage = (usage) => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage });
    assert.strictEqual(completeAnthropicUsage(withUsage({ prompt_tokens: 12.5, completion_tokens: 4 })), null, 'fractional input must not reach the wire');
    assert.strictEqual(completeAnthropicUsage(withUsage({ prompt_tokens: 12, completion_tokens: 4.5 })), null, 'fractional output must not reach the wire');
    assert.strictEqual(completeAnthropicUsage(withUsage({ prompt_tokens: 2 ** 60, completion_tokens: 4 })), null, 'unsafe magnitude must not reach the wire');
    assert.deepStrictEqual(
      completeAnthropicUsage(withUsage({ prompt_tokens: 12, completion_tokens: 4, cached_tokens: 3.5 })),
      { input_tokens: 12, output_tokens: 4 },
      'a fractional cache count is dropped, the measured counts survive'
    );
  });

  console.log('gateway forwarding');

  await (async () => {
    const http = require('http');
    const seen = [];
    const fakeBridge = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm' }] }));
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        seen.push(parsed);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
        // A real [OI] server only sends the usage chunk when asked for it.
        if (parsed.stream_options?.include_usage) {
          res.write('data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3}}\n\n');
        }
        res.end('data: [DONE]\n\n');
      });
    });

    await new Promise((r) => fakeBridge.listen(0, r));
    const port = fakeBridge.address().port;

    const callGateway = async (bridgeConfig) => {
      const { handleAnthropicMessages } = require('../src/bridge/gateway_adapters');
      const activeBridges = new Map([['b', { bridgeConfig: { port, ...bridgeConfig } }]]);
      const payload = JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] });
      const req = {
        headers: {},
        on(ev, fn) { if (ev === 'data') fn(Buffer.from(payload)); if (ev === 'end') fn(); },
        destroy() {}
      };
      const chunks = [];
      let finish;
      const done = new Promise((r) => { finish = r; });
      const res = {
        headersSent: false,
        writableEnded: false,
        setHeader() {},
        writeHead() { this.headersSent = true; },
        write(c) { chunks.push(String(c)); },
        end() { this.writableEnded = true; finish(); },
        on() {},
        once() {}
      };
      await handleAnthropicMessages(activeBridges, req, res);
      // handleAnthropicMessages returns once the request is written; the
      // translated response arrives on the upstream callback.
      await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
      return chunks.join('');
    };

    try {
      seen.length = 0;
      const wire = await callGateway({ provider: 'openai' });
      test('the gateway forwards stream_options and the local bridge keeps it', () => {
        assert.deepStrictEqual(seen[0].stream_options, { include_usage: true });
      });
      test('a usage-bearing upstream stream produces a valid message_start and message_delta', () => {
        const evs = parseEvents(wire);
        const start = evs.find((e) => e.event === 'message_start');
        const delta = evs.find((e) => e.event === 'message_delta');
        assert.ok(start, 'message_start missing');
        assert.strictEqual(start.data.message.usage.input_tokens, 8);
        assert.strictEqual(start.data.message.usage.output_tokens, 3);
        assert.strictEqual(delta.data.usage.output_tokens, 3);
        assert.strictEqual(evs.find((e) => e.event === 'error'), undefined);
      });

      seen.length = 0;
      const optedOut = await callGateway({ provider: 'strict-validator', supportsStreamUsage: false });
      test('an opted-out bridge is not sent stream_options', () => {
        assert.strictEqual(seen[0].stream_options, undefined);
      });
      test('a stream without usage fails with an error event instead of an invalid message', () => {
        const evs = parseEvents(optedOut);
        assert.strictEqual(evs.length, 1);
        assert.strictEqual(evs[0].event, 'error');
        assert.strictEqual(evs.find((e) => e.event === 'message_start'), undefined);
      });
    } finally {
      await new Promise((r) => fakeBridge.close(r));
    }
  })();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
