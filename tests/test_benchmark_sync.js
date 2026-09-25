#!/usr/bin/env node
'use strict';

/**
 * tests/test_benchmark_sync.js
 * Regression test locking docs/BENCHMARK.md generation, structural integrity,
 * and drift detection against live telemetry.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { generateBenchmarkMarkdown, syncBenchmark } = require('../scripts/generate_benchmark');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_PATH = path.join(ROOT, 'docs', 'BENCHMARK.md');

console.log('Running test_benchmark_sync.js...');

// 1. Ensure file exists and is populated
assert.ok(fs.existsSync(BENCHMARK_PATH), 'docs/BENCHMARK.md must exist');
const originalContent = fs.readFileSync(BENCHMARK_PATH, 'utf8');
assert.ok(originalContent.length > 500, 'docs/BENCHMARK.md must not be empty');

// 2. Programmatic check passes
assert.doesNotThrow(() => {
  syncBenchmark(true);
}, 'docs/BENCHMARK.md must pass structural and telemetry check');
console.log('  ✓ Programmatic sync check passed.');

// 3. CLI execution check
const cliRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate_benchmark.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.strictEqual(cliRes.status, 0, `CLI sync check failed: ${cliRes.stderr || cliRes.stdout}`);
console.log('  ✓ scripts/generate_benchmark.js --check exits with code 0.');

// 4. Content assertions
assert.ok(originalContent.includes('Combined Optimization Impact'), 'Must contain Combined Optimization Impact section');
assert.ok(originalContent.includes('Wire-Level Verification & Tiktoken Tokenization Accuracy'), 'Must contain Wire-Level and Tiktoken section');
assert.ok(originalContent.includes('RTK (Rust Token Killer) Empirical Savings'), 'Must contain RTK Empirical Savings section');
assert.ok(originalContent.includes('Appendix — Superseded Historical Snapshot'), 'Must contain Appendix');
assert.ok(originalContent.includes('read_file_range'), 'Must list read_file_range in call-type table');
assert.ok(originalContent.includes('find_skill'), 'Must list find_skill in call-type table');
assert.ok(originalContent.includes('list_skills'), 'Must list list_skills in call-type table');
assert.ok(originalContent.includes('get_skill'), 'Must list get_skill in call-type table');
assert.ok(originalContent.includes('cl100k_base'), 'Must mention cl100k_base');
console.log('  ✓ Core content and call-type anchors verified.');

// 5. Induced-failure test: corrupting benchmark file must cause check to fail
try {
  const corruptedContent = originalContent.replace('## 🏆 Combined Optimization Impact', '## Corrupted Section');
  fs.writeFileSync(BENCHMARK_PATH, corruptedContent, 'utf8');

  let caughtError = false;
  try {
    syncBenchmark(true);
  } catch (err) {
    caughtError = true;
    assert.ok(err.message.includes('missing required structural anchor'), 'Error must specify missing anchor');
  }
  assert.strictEqual(caughtError, true, 'Corrupted benchmark must throw in programmatic check');

  const cliFailRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate_benchmark.js'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.strictEqual(cliFailRes.status, 1, 'Corrupted benchmark must cause CLI check to exit with 1');
  console.log('  ✓ Induced failure test caught corrupted structural anchor.');
} finally {
  // Always restore original file
  fs.writeFileSync(BENCHMARK_PATH, originalContent, 'utf8');
}

// 6. Verify restoration
assert.doesNotThrow(() => {
  syncBenchmark(true);
}, 'Restored file must pass verification');
console.log('  ✓ Restored file verified.');

console.log('All tests in test_benchmark_sync.js passed cleanly!');
