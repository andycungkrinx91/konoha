const assert = require('assert');
const os = require('os');
const path = require('path');
const { evaluateSandboxGuard, evaluateMaintenanceGuard } = require('./helpers/sandbox_guard');

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

// Maintenance guard: the suite runs in the container or on an ephemeral CI
// runner, never on a developer host. RTK is a shell wrapper, so it is absent
// from this decision by construction — the same env decides either way.
assert.strictEqual(evaluateMaintenanceGuard({ KONOHA_SANDBOX_CONTAINER: '1' }).allowed, true);
assert.strictEqual(evaluateMaintenanceGuard({ CI: 'true' }).allowed, true);
assert.strictEqual(
  evaluateMaintenanceGuard({ KONOHA_SANDBOX_CONTAINER: '1', CI: 'true' }).mode,
  'container',
  'the container marker wins when both are present'
);
assert.strictEqual(evaluateMaintenanceGuard({}).allowed, false, 'a bare host env must refuse');
assert.strictEqual(evaluateMaintenanceGuard({ HOME: '/tmp/x' }).allowed, false, 'an isolated HOME is not the sandbox');
assert.match(
  evaluateMaintenanceGuard({}).reason,
  /pnpm test:sandbox/,
  'the refusal must name the accepted command'
);
assert.match(
  evaluateMaintenanceGuard({}).reason,
  /rtk node tests\/run_all\.js` refuses identically/,
  'the refusal must state that RTK does not lift it'
);

// Option H1 host-isolated child invariants
const tmpSuite = path.join(os.tmpdir(), 'konoha_suite_unit_test_home');
const validHostEnv = {
  KONOHA_HOST_ISOLATED: '1',
  KONOHA_TEST_SANDBOX: '1',
  HOME: tmpSuite,
  USERPROFILE: tmpSuite,
  KONOHA_DB_PATH: path.join(tmpSuite, '.konoha', 'konoha.db')
};
const hostRes = evaluateMaintenanceGuard(validHostEnv, { realHome: '/home/realuser' });
assert.strictEqual(hostRes.allowed, true, 'valid host-isolated child env must allow');
assert.strictEqual(hostRes.mode, 'host-isolated');

assert.strictEqual(
  evaluateMaintenanceGuard({ ...validHostEnv, KONOHA_DB_PATH: '/home/realuser/.konoha/konoha.db' }, { realHome: '/home/realuser' }).allowed,
  false,
  'host-isolated mode must refuse DB outside isolated HOME'
);
assert.strictEqual(
  evaluateMaintenanceGuard({ ...validHostEnv, HOME: '/home/realuser', USERPROFILE: '/home/realuser' }, { realHome: '/home/realuser' }).allowed,
  false,
  'host-isolated mode must refuse real HOME'
);

console.log('test_sandbox_guard: PASS');
