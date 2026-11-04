#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * Verifies the prompt-cache and usage-accounting layer of the Anthropic bridge.
 *
 * Contracts covered:
 * - capability detection never claims caching for an unknown custom endpoint
 * - cache hints are additive metadata only (no content loss, no reordering)
 * - usage is passed through from the upstream instead of fabricated zeros
 * - cached-token reporting treats "not reported" as unknown, not as zero
 * - prefix reuse reporting is accurate so a cache miss is explainable
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  detectCacheCapability,
  applyAnthropicCacheHint,
  extractCachedTokens
} = require('../src/bridge/cache_capability');
const {
  sortToolsStable,
  findVolatileSegments,
  summarizePrefixReuse
} = require('../src/bridge/prefix_stability');
const { compressContext } = require('../src/bridge/sanitize');
const { validateRequestBudget, clampMaxTokens, createSessionBudget, LIMITS } = require('../src/bridge/request_budget');

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

console.log('cache capability detection');

test('known anthropic endpoint supports caching', () => {
  const r = detectCacheCapability({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4' });
  assert.strictEqual(r.supported, true);
  assert.strictEqual(r.strategy, 'anthropic_cache_control');
});

test('unknown custom endpoint does not claim caching', () => {
  const r = detectCacheCapability({ baseUrl: 'https://llm.internal.corp/v1' });
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.reason, 'unknown_custom_endpoint');
});

test('custom endpoint may opt in explicitly', () => {
  const r = detectCacheCapability({ baseUrl: 'https://llm.internal.corp/v1', allowCustomCache: true });
  assert.strictEqual(r.supported, true);
});

test('loopback bridge is treated as passthrough', () => {
  const r = detectCacheCapability({ baseUrl: 'http://127.0.0.1:8082/v1' });
  assert.strictEqual(r.reason, 'local_bridge_passthrough');
});

console.log('cache hint safety');

test('hint preserves every block and its order', () => {
  const system = [
    { type: 'text', text: 'alpha' },
    { type: 'text', text: 'beta' }
  ];
  const out = applyAnthropicCacheHint(system);
  assert.deepStrictEqual(out.map((b) => b.text), ['alpha', 'beta']);
  assert.deepStrictEqual(out[1].cache_control, { type: 'ephemeral' });
});

test('hint never mutates the caller array', () => {
  const system = [{ type: 'text', text: 'stable' }];
  applyAnthropicCacheHint(system);
  assert.strictEqual(system[0].cache_control, undefined);
});

test('hint is idempotent so breakpoints cannot stack', () => {
  const system = [{ type: 'text', text: 'stable block' }];
  const once = applyAnthropicCacheHint(system);
  const twice = applyAnthropicCacheHint(once);
  assert.strictEqual(JSON.stringify(once), JSON.stringify(twice));
});

test('short prompt below the cache floor is left untouched', () => {
  const system = [{ type: 'text', text: 'hi' }];
  const out = applyAnthropicCacheHint(system, { estimatedTokens: 4 });
  assert.strictEqual(out[0].cache_control, undefined);
});

console.log('usage accounting');

test('cached tokens read from provider variations', () => {
  assert.strictEqual(extractCachedTokens({ cache_read_input_tokens: 900 }), 900);
  assert.strictEqual(extractCachedTokens({ prompt_tokens_details: { cached_tokens: 12 } }), 12);
});

test('missing cache reporting is null, never a fabricated zero', () => {
  assert.strictEqual(extractCachedTokens({ input_tokens: 10 }), null);
});

test('bridge no longer hardcodes zero usage', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge', 'gateway_adapters.js'), 'utf8');
  assert.ok(
    !src.includes('usage: { input_tokens: 0, output_tokens: 0 }'),
    'fabricated zero usage must not be reintroduced'
  );
  assert.ok(src.includes('buildAnthropicUsage'), 'usage must derive from the upstream response');
});

console.log('prefix stability');

test('tool order from the caller is preserved (no behaviour perturbation)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge', 'gateway_adapters.js'), 'utf8');
  assert.ok(
    !/openAiPayload\.tools = sortToolsStable/.test(src),
    'tools must not be reordered: order can affect model tool selection'
  );
  assert.ok(src.includes('openAiPayload.tools = tools;'), 'tools must be forwarded verbatim');
});

test('sortToolsStable remains order-stable for equivalent toolsets', () => {
  const a = [{ function: { name: 'b' } }, { function: { name: 'a' } }];
  const b = [{ function: { name: 'a' } }, { function: { name: 'b' } }];
  assert.strictEqual(JSON.stringify(sortToolsStable(a)), JSON.stringify(sortToolsStable(b)));
  assert.strictEqual(a[0].function.name, 'b', 'input must not be mutated');
});

test('volatile timestamps are detected', () => {
  assert.strictEqual(findVolatileSegments('at 2026-11-04T10:22:31Z').length, 1);
});

test('prefix reuse is reported accurately', () => {
  const prev = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  const next = [...prev, { role: 'assistant', content: 'a' }];
  assert.strictEqual(summarizePrefixReuse(prev, next).reused, true);

  const changed = [{ role: 'system', content: 'different' }, { role: 'user', content: 'u' }];
  const diverged = summarizePrefixReuse(prev, changed);
  assert.strictEqual(diverged.reused, false);
  assert.strictEqual(diverged.diverged_at, 0);
});

console.log('context compression safety');

test('compression terminates at its floor', () => {
  const huge = 'x'.repeat(2_000_000);
  const out = compressContext([
    { role: 'system', content: huge },
    { role: 'user', content: huge },
    { role: 'assistant', content: huge }
  ], null);
  assert.strictEqual(out.length, 3, 'expected system plus two retained messages');
  assert.strictEqual(out[0].role, 'system');
});

test('under-threshold conversations are returned untouched', () => {
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }];
  assert.strictEqual(compressContext(msgs, null).length, 2);
});

test('compression always keeps the most recent turn', () => {
  const msgs = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 300; i += 1) {
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'y'.repeat(2000) });
  }
  const out = compressContext(msgs, null);
  assert.ok(out.length < msgs.length);
  assert.strictEqual(out[out.length - 1].content, 'y'.repeat(2000));
});

console.log('request budget guards');

test('normal request is accepted', () => {
  const r = validateRequestBudget({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(r.ok, true);
});

test('legitimate large coding context is not rejected', () => {
  const big = 'c'.repeat(350000);
  const r = validateRequestBudget({ system: big, messages: [{ role: 'user', content: 'refactor' }] });
  assert.strictEqual(r.ok, true, 'must not block real work');
});

test('runaway payload is rejected with a reason', () => {
  const huge = 'x'.repeat(2000000);
  const r = validateRequestBudget({ messages: [{ role: 'user', content: huge }, { role: 'assistant', content: huge }] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'input_tokens_exceeded');
});

test('message explosion is rejected', () => {
  const messages = Array.from({ length: LIMITS.MAX_MESSAGES + 5 }, () => ({ role: 'user', content: 'hi' }));
  assert.strictEqual(validateRequestBudget({ messages }).reason, 'too_many_messages');
});

test('max_tokens is clamped to remaining budget', () => {
  assert.strictEqual(clampMaxTokens(10000, 4000), 4000);
});

test('session budget reports exhaustion', () => {
  const b = createSessionBudget(1000);
  b.record(600);
  assert.strictEqual(b.exhausted(), false);
  assert.strictEqual(b.record(500).exhausted, true);
});

console.log('streaming usage path');

test('SSE stream usage is captured into the anthropic response', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge', 'gateway_adapters.js'), 'utf8');
  assert.ok(
    src.includes('streamUsage = chunk.usage'),
    'coalesce loop must capture usage-bearing chunks'
  );
  assert.ok(
    src.includes('if (streamUsage) openAiResp.usage = streamUsage;'),
    'captured usage must be attached to the coalesced response'
  );
});

test('every stream message_start carries usage', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge', 'gateway_adapters.js'), 'utf8');
  const emitters = src.match(/type: 'message_start', message:/g) || [];
  assert.ok(emitters.length >= 2, 'expected both stream entry points to emit message_start');
  const bare = src.match(/type: 'message_start', message: \{[^}]*stop_reason: null \}/g) || [];
  assert.strictEqual(bare.length, 0, 'message_start must always include a usage field');
});

console.log('request size guards');

test('oversized bodies are rejected from Content-Length before buffering', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bridge', 'gateway_adapters.js'), 'utf8');
  assert.ok(src.includes('function rejectOversizedByHeader'), 'header guard must exist');
  const headerCall = src.indexOf('rejectOversizedByHeader(req, res');
  const readCall = src.indexOf('await readBody(req, LIMITS.MAX_BODY_BYTES)');
  assert.ok(headerCall > 0, 'header guard must be invoked');
  assert.ok(headerCall < readCall, 'header guard must run before readBody buffers the body');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
