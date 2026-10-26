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
 * 5. Real LXC bridge containment verification (ipv4.nat: false required).
 * 6. Real Docker network containment verification (Internal: true required, default bridge rejected).
 * 7. Real Teardown execution and process kill verification (cleanup_confirmed: true/false).
 * 8. Standalone Red-Team Isolation Workflow (multi-phase in-sandbox execution).
 * 9. Standalone Blue-Team Direct Host Workflow (host-level defensive audit).
 * 10. Akatsuki Security Final Gate enforcement of sandbox evidence and cleanup proof.
 */

process.env.KONOHA_AKATSUKI_REDTEAM = '1';

const assert = require('assert');
const path = require('path');

const {
  DEFAULT_LAB_NAME,
  DECLINE_NO_ENGINE,
  HOST_EXECUTION_DENIED_REASON,
  INVALID_LAB_NAME_REASON,
  getRequiredEngine,
  checkEngineInstalled,
  getLabStatus,
  validateLabPrerequisites,
  executeInLab,
  teardownLab
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
runTest('Lab identity defaults to akatsuki-lab and non-standard name is rejected', () => {
  assert.strictEqual(DEFAULT_LAB_NAME, 'akatsuki-lab');
  const res = validateLabPrerequisites({ authorized: true, target: '10.77.77.10', lab_name: 'custom-unverified-box' });
  assert.strictEqual(res.ready, false);
  assert.strictEqual(res.reason, INVALID_LAB_NAME_REASON);
});

// 5. LXC real network isolation verification (fails on ipv4.nat=true, passes on ipv4.nat=false)
runTest('LXC network verification rejects bridge when ipv4.nat is true', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'lxc' && args[0] === 'list') {
      return {
        status: 0,
        stdout: JSON.stringify([{
          name: 'akatsuki-lab',
          status: 'RUNNING',
          devices: { eth0: { type: 'nic', network: 'lxcbr0' } },
          state: { network: { eth0: { addresses: [{ family: 'inet', address: '10.0.3.15' }] } } }
        }])
      };
    }
    if (cmd === 'lxc' && args[0] === 'network' && args[1] === 'show') {
      return {
        status: 0,
        stdout: 'name: lxcbr0\nconfig:\n  ipv4.address: 10.0.3.1/24\n  ipv4.nat: "true"\n'
      };
    }
    return { status: 0, stdout: '' };
  };

  const status = getLabStatus('akatsuki-lab', 'lxc', { runner: mockRunner, platform: 'linux' });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.network_isolated, false, 'Bridge with NAT enabled must fail isolation check');
  assert.match(status.details, /NAT enabled/i);
});

runTest('LXC network verification accepts bridge when ipv4.nat is false', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'lxc' && args[0] === 'list') {
      return {
        status: 0,
        stdout: JSON.stringify([{
          name: 'akatsuki-lab',
          status: 'RUNNING',
          devices: { eth0: { type: 'nic', network: 'labbr0' } },
          state: { network: { eth0: { addresses: [{ family: 'inet', address: '10.77.77.153' }] } } }
        }])
      };
    }
    if (cmd === 'lxc' && args[0] === 'network' && args[1] === 'show') {
      return {
        status: 0,
        stdout: 'name: labbr0\nconfig:\n  ipv4.address: 10.77.77.1/24\n  ipv4.nat: "false"\n'
      };
    }
    return { status: 0, stdout: '' };
  };

  const status = getLabStatus('akatsuki-lab', 'lxc', { runner: mockRunner, platform: 'linux' });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.network_isolated, true, 'Bridge with ipv4.nat=false must pass isolation check');
  assert.match(status.details, /verified isolated/i);
});

// 6. Docker real network isolation verification
runTest('Docker network verification rejects container on default bridge network', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'docker' && args[0] === 'inspect') {
      return {
        status: 0,
        stdout: 'true|default|{"bridge":{"NetworkID":"abc"}}'
      };
    }
    return { status: 0, stdout: '' };
  };

  const status = getLabStatus('akatsuki-lab', 'docker', { runner: mockRunner, platform: 'darwin' });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.network_isolated, false, 'Default docker bridge with NAT must fail isolation check');
  assert.match(status.details, /default "bridge" network/i);
});

runTest('Docker network verification rejects non-internal custom network', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'docker' && args[0] === 'inspect') {
      return {
        status: 0,
        stdout: 'true|custom|{"my-net":{"NetworkID":"net1"}}'
      };
    }
    if (cmd === 'docker' && args[0] === 'network' && args[1] === 'inspect') {
      return {
        status: 0,
        stdout: 'false|bridge' // Internal: false
      };
    }
    return { status: 0, stdout: '' };
  };

  const status = getLabStatus('akatsuki-lab', 'docker', { runner: mockRunner, platform: 'darwin' });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.network_isolated, false, 'Docker network with Internal: false must fail isolation check');
  assert.match(status.details, /internal: false/i);
});

runTest('Docker network verification accepts internal custom network', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'docker' && args[0] === 'inspect') {
      return {
        status: 0,
        stdout: 'true|custom|{"akatsuki-internal":{"NetworkID":"net1"}}'
      };
    }
    if (cmd === 'docker' && args[0] === 'network' && args[1] === 'inspect') {
      return {
        status: 0,
        stdout: 'true|bridge' // Internal: true
      };
    }
    return { status: 0, stdout: '' };
  };

  const status = getLabStatus('akatsuki-lab', 'docker', { runner: mockRunner, platform: 'darwin' });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.network_isolated, true, 'Docker network with Internal: true must pass isolation check');
  assert.match(status.details, /verified internal/i);
});

// 7. Teardown execution verification
runTest('Teardown returns cleanup_confirmed: false if process termination command fails', () => {
  const mockFailRunner = (cmd) => {
    if (cmd === 'lxc') {
      return { status: 127, stdout: '', stderr: 'lxc command failed' };
    }
    return { status: 0, stdout: '' };
  };

  const teardown = teardownLab('akatsuki-lab', 'lxc', { runner: mockFailRunner, platform: 'linux' });
  assert.strictEqual(teardown.cleanup_confirmed, false, 'Failed command must not confirm cleanup');
  assert.match(teardown.message, /failed with status/i);
});

runTest('Teardown returns cleanup_confirmed: true when cleanup command succeeds', () => {
  const mockSuccessRunner = (cmd) => {
    if (cmd === 'lxc') {
      return { status: 0, stdout: 'terminated', stderr: '' };
    }
    return { status: 0, stdout: '' };
  };

  const teardown = teardownLab('akatsuki-lab', 'lxc', { runner: mockSuccessRunner, platform: 'linux' });
  assert.strictEqual(teardown.cleanup_confirmed, true);
  assert.match(teardown.message, /Cleanup verified/i);
});

runTest('executeInLab executes safely inside container without host execution', () => {
  const mockRunner = (cmd, args) => {
    assert.strictEqual(cmd, 'lxc');
    assert.strictEqual(args[0], 'exec');
    assert.strictEqual(args[1], 'akatsuki-lab');
    return { status: 0, stdout: 'in-sandbox-output\n', stderr: '' };
  };
  const res = executeInLab('akatsuki-lab', ['echo', 'ping'], { runner: mockRunner, platform: 'linux' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, 'in-sandbox-output\n');
});

// 8. Standalone Red-Team Isolation Workflow
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

runTest('Red-Team workflow fails gate if teardown cleanup cannot be confirmed', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where') {
      return { status: 0, stdout: '/usr/bin/lxc\n' };
    }
    if (cmd === 'lxc' && args[0] === 'list') {
      return {
        status: 0,
        stdout: JSON.stringify([{
          name: 'akatsuki-lab',
          status: 'RUNNING',
          devices: { eth0: { type: 'nic', network: 'labbr0' } },
          state: { network: { eth0: { addresses: [{ family: 'inet', address: '10.77.77.153' }] } } }
        }])
      };
    }
    if (cmd === 'lxc' && args[0] === 'network' && args[1] === 'show') {
      return {
        status: 0,
        stdout: 'name: labbr0\nconfig:\n  ipv4.address: 10.77.77.1/24\n  ipv4.nat: "false"\n'
      };
    }
    if (cmd === 'lxc' && args[0] === 'exec') {
      // Simulate failure in teardown pkill execution
      return { status: 1, stdout: '', stderr: 'exec error' };
    }
    return { status: 0, stdout: '' };
  };

  const result = runRedTeamWorkflow(
    { authorized: true, target: '10.77.77.153', lab_name: 'akatsuki-lab' },
    { runner: mockRunner, platform: 'linux', skip_container_exec: true }
  );

  assert.strictEqual(result.workflow_type, 'red_team');
  assert.strictEqual(result.cleanup_confirmed, false, 'Unconfirmed teardown must reflect cleanup_confirmed: false');
  assert.strictEqual(result.gate_decision, 'failed', 'Unconfirmed teardown must fail the gate');
});

runTest('Red-Team workflow executes in sandbox when authorized and isolated with confirmed teardown', () => {
  const mockRunner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where') {
      return { status: 0, stdout: '/usr/bin/lxc\n' };
    }
    if (cmd === 'lxc' && args[0] === 'list') {
      return {
        status: 0,
        stdout: JSON.stringify([{
          name: 'akatsuki-lab',
          status: 'RUNNING',
          devices: { eth0: { type: 'nic', network: 'labbr0' } },
          state: { network: { eth0: { addresses: [{ family: 'inet', address: '10.77.77.153' }] } } }
        }])
      };
    }
    if (cmd === 'lxc' && args[0] === 'network' && args[1] === 'show') {
      return {
        status: 0,
        stdout: 'name: labbr0\nconfig:\n  ipv4.address: 10.77.77.1/24\n  ipv4.nat: "false"\n'
      };
    }
    if (cmd === 'lxc' && args[0] === 'exec') {
      return { status: 0, stdout: 'ok', stderr: '' };
    }
    return { status: 0, stdout: '' };
  };

  const result = runRedTeamWorkflow(
    { authorized: true, target: '10.77.77.153', lab_name: 'akatsuki-lab' },
    { runner: mockRunner, platform: 'linux', skip_container_exec: true }
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

// 9. Standalone Blue-Team Direct Host Workflow
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

// 10. Security Final Gate Verification
runTest('Final Gate blocks red-team review missing sandbox isolation evidence', () => {
  const fakeReview = {
    workflow_type: 'red_team',
    status: 'completed',
    lab_name: 'unisolated-host-box',
    network_isolated: false,
    host_execution_denied: false,
    cleanup_confirmed: true,
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

runTest('Final Gate blocks red-team review when cleanup was not confirmed', () => {
  const uncleanedReview = {
    workflow_type: 'red_team',
    status: 'completed',
    lab_name: 'akatsuki-lab',
    engine: 'lxc',
    network_isolated: true,
    host_execution_denied: true,
    cleanup_confirmed: false,
    critical_count: 0,
    high_count: 0,
    gate_decision: 'passed'
  };

  const gateResult = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Implement security pentest',
    akatsuki_review: uncleanedReview
  });

  assert.strictEqual(gateResult.passed, false);
  assert.strictEqual(gateResult.decision, 'blocked');
  assert.match(gateResult.reason, /sandbox isolation evidence/i);
});

runTest('Final Gate passes clean red-team review with valid sandbox isolation evidence and confirmed cleanup', () => {
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

// 11. Real host LXC status test against actual akatsuki-lab and labbr0 bridge
runTest('Real host LXC status against akatsuki-lab container on labbr0', () => {
  const status = getLabStatus('akatsuki-lab', 'lxc');
  assert.strictEqual(status.exists, true, 'akatsuki-lab container must exist on host');
  assert.strictEqual(status.running, true, 'akatsuki-lab container must be running');
  assert.strictEqual(status.network_isolated, true, 'akatsuki-lab on labbr0 must be verified network isolated');
  assert.strictEqual(status.bridge, 'labbr0', 'akatsuki-lab bridge must be labbr0');
  assert.ok(status.ips.includes('10.77.77.153'), 'akatsuki-lab container IP must match 10.77.77.153');
});

console.log(`\nAll ${testsPassed} Akatsuki Lab Isolation tests passed successfully!`);
