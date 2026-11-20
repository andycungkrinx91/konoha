#!/usr/bin/env node
'use strict';

/**
 * `supportsStreamUsage` is only real if it survives the whole path: CLI/API ->
 * sqlite -> reload -> outgoing request payload. A bridge that rejects unknown
 * parameters fails the entire request when we send `stream_options`, so each
 * direction of the override has to be observable on the wire.
 */

const assert = require('assert');
require('./helpers/isolate_db');

const bridges = require('../src/db_bridges');
const { buildOpenAiPayloadFromAnthropic } = require('../src/bridge/gateway_adapters');
const { cmdBridge } = require('../bin/commands/bridge');

const BODY = { stream: true, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };
const STRICT_PROVIDER = 'groq';
const ALLOWLISTED_PROVIDER = 'openai';

function payloadFor(bridgeConfig, body = BODY) {
  return buildOpenAiPayloadFromAnthropic(body, 'gpt-4o-mini', bridgeConfig);
}

function storedOverride(name) {
  return bridges.listBridges().find((b) => b.name === name).supportsStreamUsage;
}

async function runCli(args) {
  const log = console.log;
  const error = console.error;
  const exit = process.exit;
  console.log = () => {};
  console.error = () => {};
  process.exit = (code) => { throw new Error(`exit ${code}`); };
  try {
    await cmdBridge(args);
  } finally {
    console.log = log;
    console.error = error;
    process.exit = exit;
  }
}

let passed = 0;
async function check(label, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function main() {
  bridges.upsertBridge({ name: 'allowlisted', port: 11501, provider: ALLOWLISTED_PROVIDER, enabled: true });
  bridges.upsertBridge({ name: 'strict', port: 11502, provider: STRICT_PROVIDER, enabled: true });

  try {
    await check('allowlisted provider receives stream_options by default', () => {
      assert('stream_options' in payloadFor({ provider: ALLOWLISTED_PROVIDER }), 'openai must be asked for usage');
    });

    await check('unknown provider is denied stream_options by default', () => {
      assert(!('stream_options' in payloadFor({ provider: STRICT_PROVIDER })), 'strict provider must not receive it');
    });

    await check('non-streaming requests never carry stream_options', () => {
      const payload = payloadFor({ provider: ALLOWLISTED_PROVIDER, supportsStreamUsage: true }, { ...BODY, stream: false });
      assert(!('stream_options' in payload), 'stream_options belongs to streaming only');
    });

    await check('CLI override opts a strict provider in and persists', async () => {
      await runCli(['stream-usage', 'strict', 'always']);
      assert.strictEqual(storedOverride('strict'), true);
      assert('stream_options' in payloadFor(bridges.listBridges().find((b) => b.name === 'strict')));
    });

    await check('CLI override opts an allowlisted provider out and persists', async () => {
      await runCli(['stream-usage', 'allowlisted', 'never']);
      assert.strictEqual(storedOverride('allowlisted'), false);
      assert(!('stream_options' in payloadFor(bridges.listBridges().find((b) => b.name === 'allowlisted'))));
    });

    await check('an unrelated update preserves the stored override', () => {
      bridges.upsertBridge({ name: 'allowlisted', port: 11503, provider: ALLOWLISTED_PROVIDER, enabled: true, targetUrl: 'http://127.0.0.1:9000/v1' });
      assert.strictEqual(storedOverride('allowlisted'), false, 'partial upsert must not reset the override');
    });

    await check('clearing to auto restores the provider allowlist decision', async () => {
      await runCli(['stream-usage', 'strict', 'auto']);
      await runCli(['stream-usage', 'allowlisted', 'auto']);
      assert.strictEqual(storedOverride('strict'), undefined);
      assert(!('stream_options' in payloadFor({ provider: STRICT_PROVIDER })));
      assert('stream_options' in payloadFor({ provider: ALLOWLISTED_PROVIDER }));
    });

    await check('an unknown bridge is rejected instead of silently created', async () => {
      await assert.rejects(runCli(['stream-usage', 'nope', 'always']), /exit 1/);
      assert.strictEqual(bridges.listBridges().some((b) => b.name === 'nope'), false);
    });

    console.log(`stream usage wiring: ${passed} cases passed, 0 failed.`);
  } finally {
    bridges.deleteBridge('allowlisted');
    bridges.deleteBridge('strict');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});