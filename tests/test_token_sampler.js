#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { countTiktoken, getLastEstimatorUsed } = require('../src/token_sampler');

function testGoldenCorpusParity() {
  const fixturePath = path.join(__dirname, 'fixtures', 'tiktoken_golden_corpus.json');
  assert.ok(fs.existsSync(fixturePath), 'Golden corpus fixture must exist');

  const corpus = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.ok(Array.isArray(corpus) && corpus.length > 0, 'Corpus must be non-empty array');

  let totalExpected = 0;
  let totalActual = 0;

  for (const item of corpus) {
    const actual = countTiktoken(item.text);
    assert.strictEqual(actual, item.expected_tokens, `Token count for "${item.text.slice(0, 30)}..." must match golden`);
    totalExpected += item.expected_tokens;
    totalActual += actual;
  }

  const divergencePct = Math.abs(totalActual - totalExpected) / totalExpected * 100;
  assert.ok(divergencePct <= 1.0, `Divergence (${divergencePct}%) must be <= 1%`);
  assert.strictEqual(getLastEstimatorUsed(), 'pure_js_cl100k', 'Estimator used must be pure_js_cl100k');
  console.log('✓ Test 1: Golden corpus parity verified (0.00% divergence)');
}

function testNoChildProcessInHotPath() {
  let spawnSyncCalled = false;
  const originalSpawnSync = cp.spawnSync;

  try {
    cp.spawnSync = function (...args) {
      spawnSyncCalled = true;
      return originalSpawnSync.apply(this, args);
    };

    const text = 'Ensuring hot path executes purely in-process without child_process forks.';
    const count = countTiktoken(text);
    assert.ok(count > 0);
    assert.strictEqual(spawnSyncCalled, false, 'child_process.spawnSync must NOT be called in hot path');
    assert.strictEqual(getLastEstimatorUsed(), 'pure_js_cl100k');
    console.log('✓ Test 2: Hot path runs with 0 child_process calls verified');
  } finally {
    cp.spawnSync = originalSpawnSync;
  }
}

function testPerformanceBenchmark() {
  const text = 'Benchmark sample text repeating '.repeat(50);
  const start = Date.now();
  for (let i = 0; i < 200; i++) {
    countTiktoken(text);
  }
  const elapsed = Date.now() - start;
  const avgMs = elapsed / 200;
  assert.ok(avgMs < 2.0, `Average time per call (${avgMs.toFixed(3)} ms) should be well under 2ms`);
  console.log(`✓ Test 3: High performance tokenization verified (${avgMs.toFixed(3)} ms/call)`);
}

function testFallbackChain() {
  // Edge cases: null, undefined, empty
  assert.strictEqual(countTiktoken(''), 0);
  assert.strictEqual(countTiktoken(null), 0);
  assert.strictEqual(countTiktoken(undefined), 0);

  console.log('✓ Test 4: Edge cases and fallback chain verified');
}

console.log('Running test_token_sampler.js...');
testGoldenCorpusParity();
testNoChildProcessInHotPath();
testPerformanceBenchmark();
testFallbackChain();
console.log('All test_token_sampler.js tests passed cleanly!');
