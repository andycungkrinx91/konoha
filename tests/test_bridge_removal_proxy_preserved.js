// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const extensionLib = require('../bin/lib/extension');
const bridgeGateway = require('../src/bridge/gateway');
const bridgeContext = require('../src/bridge/context');

function run() {
  // 1. Verify konoha-bridge VSIX auto-install functions are completely removed
  assert.strictEqual(extensionLib.autoInstallKonohaBridgeExtension, undefined, 'autoInstallKonohaBridgeExtension must be removed');
  assert.strictEqual(extensionLib.installExtensionViaCli, undefined, 'installExtensionViaCli must be removed');

  // 2. Verify VSIX binary asset is removed
  const vsixAsset = path.resolve(__dirname, '..', 'assets', 'konoha-bridge-1.7.0.vsix');
  assert.strictEqual(fs.existsSync(vsixAsset), false, 'assets/konoha-bridge-1.7.0.vsix must be removed');

  // 3. Verify local OpenAI-compatible Proxy Gateway is intact and functional
  assert.strictEqual(typeof bridgeGateway.startGateway, 'function', 'startGateway must be preserved');
  assert.strictEqual(typeof bridgeGateway.stopGateway, 'function', 'stopGateway must be preserved');
  assert.strictEqual(typeof bridgeContext.createContext, 'function', 'createContext must be preserved');

  const ctx = bridgeContext.createContext();
  assert.ok(ctx.sessionId, 'Bridge context must have sessionId');
  assert.strictEqual(typeof ctx.DEDUP_WINDOW_MS, 'number');

  // 4. Verify all critical bridge handler files exist in src/bridge/
  const bridgeDir = path.resolve(__dirname, '..', 'src', 'bridge');
  const requiredBridgeFiles = [
    'gateway.js',
    'context.js',
    'server.js',
    'manager.js',
    'handlers/openai.js',
    'handlers/anthropic.js',
    'handlers/gemini.js',
    'handlers/proxy.js'
  ];

  for (const rel of requiredBridgeFiles) {
    const full = path.join(bridgeDir, rel);
    assert.ok(fs.existsSync(full), `src/bridge/${rel} must exist and be preserved`);
  }

  console.log('✓ test_bridge_removal_proxy_preserved passed');
}

run();
