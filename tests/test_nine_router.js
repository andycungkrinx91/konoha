#!/usr/bin/env node
'use strict';

const assert = require('assert');
const nineRouter = require('../src/nine_router');

console.log('Running test_nine_router.js...');

async function runTests() {
  // 1. is9RouterInstalled
  const installed = nineRouter.is9RouterInstalled();
  assert.strictEqual(typeof installed, 'boolean', 'is9RouterInstalled must return a boolean');
  console.log(`  ✓ is9RouterInstalled: ${installed}`);

  // 2. get9RouterStatus
  const status = await nineRouter.get9RouterStatus();
  assert.ok(status, 'get9RouterStatus must return an object');
  assert.strictEqual(typeof status.installed, 'boolean');
  assert.strictEqual(typeof status.running, 'boolean');
  assert.strictEqual(typeof status.port, 'number');
  assert.strictEqual(typeof status.base_url, 'string');
  assert.strictEqual(typeof status.model_count, 'number');
  console.log(`  ✓ get9RouterStatus: running=${status.running}, port=${status.port}, model_count=${status.model_count}`);

  // 3. discover9RouterModels
  const models = await nineRouter.discover9RouterModels();
  assert.ok(Array.isArray(models), 'discover9RouterModels must return an array');
  if (status.running && models.length > 0) {
    const first = models[0];
    assert.ok(first.id.startsWith('9router-'), `Model ID must start with 9router- prefix, got ${first.id}`);
    assert.strictEqual(first.bridge, '9router');
    assert.strictEqual(first.source, '9router');
    console.log(`  ✓ discover9RouterModels returned ${models.length} endpoints with 9router- prefix (e.g. ${first.id})`);
  } else {
    console.log('  ✓ discover9RouterModels cleanly returned empty array or offline state.');
  }

  // 4. Resilience to Unreachable / Closed Port (No hang, no crash, clean empty response)
  const deadProbe = await nineRouter.probe9RouterEndpoint(59999);
  assert.strictEqual(deadProbe.ok, false);
  assert.deepStrictEqual(deadProbe.data, []);

  const deadModels = await nineRouter.discover9RouterModels({ port: 59999 });
  assert.deepStrictEqual(deadModels, [], 'discover9RouterModels on offline port must return empty array');
  console.log('  ✓ probe9RouterEndpoint safely handles closed/dead port with timeout.');

  console.log('All tests in test_nine_router.js passed successfully!\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
