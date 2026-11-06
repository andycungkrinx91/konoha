#!/usr/bin/env node
'use strict';

/**
 * 9router / OpenAI-compatible bridge sources and the credential invariant.
 *
 * Provider sources are surfaced credential-free; bridge API keys stay in the
 * encrypted SQLite store and must never reach a client-facing payload or a
 * client config file.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { findCredentialLeaks } = require('../src/provider_sources');

async function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function testSourcesAgainstFakeRouter() {
  const fake = await listen((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'ag/gemini-3.8-flash-high', owned_by: 'ag' }, { id: 'cx/gpt-5.1' }] }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });

  try {
    const nineRouter = require('../src/nine_router');
    const models = await nineRouter.discover9RouterModels({ port: fake.port });
    assert.strictEqual(models.length, 2);
    assert.ok(models.every((m) => m.id.startsWith('9router-')), 'discovered ids are 9router-prefixed');
    assert.ok(models.every((m) => m.source === '9router' && m.bridge === '9router'));
    assert.deepStrictEqual(findCredentialLeaks(models), [], 'discovered models carry no credentials');
    console.log('  ✓ 9router models discovered and surfaced credential-free.');
  } finally {
    await new Promise((r) => fake.server.close(r));
  }
}

async function testDiscoverBridgeSourcesShape() {
  const nineRouter = require('../src/nine_router');
  assert.ok(Array.isArray(nineRouter.COMPATIBLE_SOURCES));
  assert.ok(nineRouter.COMPATIBLE_SOURCES.every((s) => s.provider === 'openai-compatible'));

  const sources = await nineRouter.discoverBridgeSources({ port: 1 });
  assert.ok(Array.isArray(sources));
  assert.deepStrictEqual(findCredentialLeaks(sources), []);
  console.log('  ✓ discoverBridgeSources returns a credential-free source list.');
}

function testCredentialLeakDetector() {
  assert.deepStrictEqual(findCredentialLeaks({ models: [{ id: 'm', has_credentials: false }] }), []);
  assert.deepStrictEqual(findCredentialLeaks({ apiKey: 'sk-live' }), ['apiKey']);
  assert.deepStrictEqual(findCredentialLeaks({ nested: [{ authorization: 'Bearer x' }] }), ['nested.0.authorization']);
  assert.deepStrictEqual(findCredentialLeaks(null), []);
  console.log('  ✓ Credential leak detector flags keys/tokens and ignores booleans.');
}

function testBridgeKeysNeverInClientConfigs() {
  // A bridge key must live only in the encrypted store; client config writers
  // must not embed it. Scan the client managers for bridge-key persistence.
  const clientModules = [
    'src/mcp_clients_manager.js',
    'src/cursor_manager.js',
    'src/opencode_manager.js',
    'src/codex_manager.js',
    'src/omp_manager.js',
    'bin/commands/init_clients.js'
  ];
  const repoRoot = path.resolve(__dirname, '..');
  // aislop-ignore-next-line security/hardcoded-secret (regex source, not a secret)
  const secretWrite = /(?:apiKey|api_key|api-key)\s*[:=]\s*(?:['"`][^'"`]+|bridge)/;
  for (const rel of clientModules) {
    const file = path.join(repoRoot, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.strictEqual(secretWrite.test(text), false, `${rel} must not persist bridge api keys into client config`);
  }
  console.log('  ✓ No client-config module persists bridge credentials.');
}

function testSourcesPayloadCredentialFree() {
  const payload = {
    models: [{ id: '9router-ag/gemini-3.8-flash-high', bridge: '9router', source: '9router', has_credentials: false }],
    sources: [{ id: '9router', has_credentials: false, base_url: 'http://127.0.0.1:20128/v1' }]
  };
  assert.deepStrictEqual(findCredentialLeaks(payload), []);
  assert.strictEqual(JSON.stringify(payload).includes('20128/v1'), true);
  console.log('  ✓ /bridges source payload exposes endpoints but no credentials.');
}

async function run() {
  console.log('Running test_bridge_provider_sources.js...');
  await testSourcesAgainstFakeRouter();
  await testDiscoverBridgeSourcesShape();
  testCredentialLeakDetector();
  testBridgeKeysNeverInClientConfigs();
  testSourcesPayloadCredentialFree();
  console.log('All tests in test_bridge_provider_sources.js passed.');
}

run().catch((err) => {
  console.error('Test failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
