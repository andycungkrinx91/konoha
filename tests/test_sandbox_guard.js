const assert = require('assert');
const { evaluateSandboxGuard } = require('./helpers/sandbox_guard');

// Test 1: Real HOME without sandbox marker refuses
const res1 = evaluateSandboxGuard(
  { HOME: '/home/testuser' },
  '/home/testuser'
);
assert.strictEqual(res1.allowed, false, 'Must refuse when HOME equals realHome without marker');
assert.strictEqual(
  res1.reason,
  "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
);

// Test 2: Sandboxed HOME allows execution
const res2 = evaluateSandboxGuard(
  { HOME: '/tmp/isolated_home' },
  '/home/testuser'
);
assert.strictEqual(res2.allowed, true, 'Must allow when HOME is different from realHome');

// Test 3: Real HOME WITH sandbox marker must STILL refuse (marker cannot override real HOME)
const res3 = evaluateSandboxGuard(
  { HOME: '/home/testuser', KONOHA_TEST_SANDBOX: '1' },
  '/home/testuser'
);
assert.strictEqual(res3.allowed, false, 'Must refuse when HOME equals realHome even with marker');
assert.strictEqual(
  res3.reason,
  "Refusing to run standalone test against real $HOME without sandbox. Run via the sandboxed runner: node tests/run_all.js, or set HOME to a seeded temp directory."
);

// Test 4: Missing realHome edge case
const res4 = evaluateSandboxGuard({ HOME: '/tmp/test' }, null);
assert.strictEqual(typeof res4.allowed, 'boolean');

console.log('test_sandbox_guard: PASS');
