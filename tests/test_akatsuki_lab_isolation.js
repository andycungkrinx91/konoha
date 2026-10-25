'use strict';

/**
 * tests/test_akatsuki_lab_isolation.js
 * 
 * Verifies strict sandbox isolation for Akatsuki Red-Team operations:
 * 1. Platform engine selection: LXC on Linux, Docker on Windows & macOS.
 * 2. Missing engine returns exact decline reason:
 *    "Declined: LXC/Docker not installed on this machine."
 * 3. Direct host execution is strictly denied (host_execution_denied: true).
 * 4. Required sandbox identity: 'akatsuki-lab'.
 * 5. Network containment enforcement (non-host bridge, network_isolated: true).
 * 6. Standalone Red-Team Isolation Workflow (multi-phase in-sandbox execution).
 * 7. Standalone Blue-Team Direct Host Workflow (host-level defensive audit).
 * 8. Akatsuki Security Final Gate enforcement of sandbox evidence.
 */

const assert = require('assert');
const path = require('path');

const {
  DEFAULT_LAB_NAME,
  DECLINE_NO_ENGINE,
  HOST_EXECUTION_DENIED_REASON,
  INVALID_LAB_NAME_REASON,
  getRequiredEngine,
  checkEngineInstalled,
  validateLabPrerequisites
} = require('../src/akatsuki_lab');

const {
  runRedTeamWorkflow,
  runBlueTeamWorkflow,
  runAkatsukiFinalGate
} = require('../src/akatsuki_workflows');

let testsPassed = 0;

function runTest(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('Running Akatsuki Lab Isolation & Workflows Test Suite...\n');

// 1. Platform engine selection
runTest('Linux platform strictly selects LXC engine', () => {
  const engine = getRequiredEngine('linux');
  assert.strictEqual(engine, 'lxc', 'Linux must require LXC engine');
});

runTest('Windows platform strictly selects Docker engine', () => {
  const engine = getRequiredEngine('win32');
  assert.strictEqual(engine, 'docker', 'Windows must require Docker engine');
});

runTest('macOS platform strictly selects Docker engine', () => {
  const engine = getRequiredEngine('darwin');
  assert.strictEqual(engine, 'docker', 'macOS must require Docker engine');
});

runTest('Unsupported platform returns null without falling back', () => {
  const engine = getRequiredEngine('sunos');
  assert.strictEqual(engine, null, 'Unsupported OS must return null');
});

// 2. Missing engine check and decline reason
runTest('Missing engine returns exact decline message', () => {
  const mockRunner = () => ({ status: 1, stdout: '', stderr: 'not found' });
  const check = checkEngineInstalled('lxc', { runner: mockRunner, platform: 'linux' });
  assert.strictEqual(check.installed, false);

  const labCheck = validateLabPrerequisites({ authorized: true, target: '10.77.77.100' }, {
    platform: 'linux',
    runner: mockRunner
  });

  assert.strictEqual(labCheck.ready, false);
  assert.strictEqual(labCheck.declined, true);
  assert.strictEqual(labCheck.reason, DECLINE_NO_ENGINE);
  assert.strictEqual(labCheck.reason, 'Declined: LXC/Docker not installed on this machine.');
});

// 3. Direct host execution denial
runTest('Direct host execution request is strictly denied', () => {
  const hostTargets = ['host', 'localhost', '127.0.0.1'];
  for (const t of hostTargets) {
    const res = validateLabPrerequisites({ authorized: true, target: t, lab_name: 'akatsuki-lab' });
    assert.strictEqual(res.ready, false);
    assert.strictEqual(res.host_execution_denied, true);
    assert.strictEqual(res.reason, HOST_EXECUTION_DENIED_REASON);
  }

  const directHostFlag = validateLabPrerequisites({ authorized: true, direct_host: true, lab_name: 'akatsuki-lab' });
  assert.strictEqual(directHostFlag.ready, false);
  assert.strictEqual(directHostFlag.host_execution_denied, true);
  assert.strictEqual(directHostFlag.reason, HOST_EXECUTION_DENIED_REASON);
});

// 4. Lab identity validation
runTest('Non-standard lab name is rejected', () => {
  const res = validateLabPrerequisites({ authorized: true, target: '10.77.77.10', lab_name: 'custom-unverified-box' });
  assert.strictEqual(res.ready, false);
  assert.strictEqual(res.reason, INVALID_LAB_NAME_REASON);
});

// 5. Network containment verification
runTest('Network containment fails if container shares host network stack', () => {
  const mockLabStatus = { exists: true, running: true, network_isolated: false, details: 'host network mode' };
  const mockRunner = (cmd) => ({ status: 0, stdout: `/usr/bin/${cmd}\n`, stderr: '' });

  const res = validateLabPrerequisites(
    { authorized: true, target: '10.77.77.10', lab_name: DEFAULT_LAB_NAME },
    { mockLabStatus, runner: mockRunner, platform: 'linux' }
  );

  assert.strictEqual(res.ready, false);
  assert.match(res.reason, /network isolation failed/i);
});

// 6. Standalone Red-Team Isolation Workflow
runTest('Red-Team workflow blocks and declines when engine is missing', () => {
  const mockRunner = () => ({ status: 1, stdout: '', stderr: 'not found' });
  const result = runRedTeamWorkflow(
    { authorized: true, target: '10.77.77.153', lab_name: 'akatsuki-lab' },
    { runner: mockRunner, platform: 'linux' }
  );

  assert.strictEqual(result.workflow_type, 'red_team');
  assert.strictEqual(result.execution_mode, 'isolated_sandbox');
  assert.strictEqual(result.status, 'blocked');
  assert.strictEqual(result.declined, true);
  assert.strictEqual(result.host_execution_denied, true);
  assert.strictEqual(result.reason, 'Declined: LXC/Docker not installed on this machine.');
  assert.strictEqual(result.gate_decision, 'blocked');
});

runTest('Red-Team workflow executes in sandbox when authorized and isolated', () => {
  const mockRunner = (cmd) => ({ status: 0, stdout: `/usr/bin/${cmd}\n`, stderr: '' });
  const mockLabStatus = { exists: true, running: true, network_isolated: true, details: 'LXC container akatsuki-lab (Running)' };

  const result = runRedTeamWorkflow(
    { authorized: true, target: '10.77.77.153', lab_name: 'akatsuki-lab' },
    { mockLabStatus, runner: mockRunner, platform: 'linux', skip_container_exec: true }
  );

  assert.strictEqual(result.workflow_type, 'red_team');
  assert.strictEqual(result.execution_mode, 'isolated_sandbox');
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.authorized, true);
  assert.strictEqual(result.lab_name, 'akatsuki-lab');
  assert.strictEqual(result.engine, 'lxc');
  assert.strictEqual(result.network_isolated, true);
  assert.strictEqual(result.host_execution_denied, true);
  assert.strictEqual(result.cleanup_confirmed, true);
  assert.strictEqual(result.gate_decision, 'passed');
  assert.ok(result.checks_performed.includes('rules_of_engagement_and_scope_verification'));
  assert.ok(result.checks_performed.includes('sandbox_isolation_and_network_containment_verification'));
  assert.ok(result.checks_performed.includes('post_assessment_teardown_and_containment_proof'));
});

// 7. Standalone Blue-Team Direct Host Workflow
runTest('Blue-Team workflow executes directly on host repository', () => {
  const result = runBlueTeamWorkflow({ project_path: path.resolve(__dirname, '..') });
  assert.strictEqual(result.workflow_type, 'blue_team');
  assert.strictEqual(result.execution_mode, 'direct_host');
  assert.strictEqual(result.authorized, true);
  assert.strictEqual(result.gate_decision, 'passed');
  assert.ok(result.checks_performed.includes('repository_perimeter_and_asset_inventory'));
  assert.ok(result.checks_performed.includes('secret_leakage_and_credentials_audit'));
  assert.ok(result.checks_performed.includes('sast_code_quality_and_owasp_hygiene'));
});

// 8. Security Final Gate Verification
runTest('Final Gate blocks red-team review missing sandbox isolation evidence', () => {
  const fakeReview = {
    workflow_type: 'red_team',
    status: 'completed',
    lab_name: 'unisolated-host-box',
    network_isolated: false,
    host_execution_denied: false,
    critical_count: 0,
    high_count: 0,
    gate_decision: 'passed'
  };

  const gateResult = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Implement security pentest',
    akatsuki_review: fakeReview
  });

  assert.strictEqual(gateResult.passed, false);
  assert.strictEqual(gateResult.decision, 'blocked');
  assert.match(gateResult.reason, /sandbox isolation evidence/i);
});

runTest('Final Gate passes clean red-team review with valid sandbox isolation evidence', () => {
  const validReview = {
    workflow_type: 'red_team',
    status: 'completed',
    lab_name: 'akatsuki-lab',
    engine: 'lxc',
    network_isolated: true,
    host_execution_denied: true,
    cleanup_confirmed: true,
    critical_count: 0,
    high_count: 0,
    findings: [],
    gate_decision: 'passed'
  };

  const gateResult = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Authorized penetration test in akatsuki-lab',
    akatsuki_review: validReview
  });

  assert.strictEqual(gateResult.passed, true);
  assert.strictEqual(gateResult.decision, 'passed');
  assert.match(gateResult.reason, /verified clean with required sandbox isolation evidence/i);
});

console.log(`\nAll ${testsPassed} Akatsuki Lab Isolation tests passed successfully!`);
