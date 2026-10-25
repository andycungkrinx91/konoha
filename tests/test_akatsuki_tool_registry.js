'use strict';

/**
 * tests/test_akatsuki_tool_registry.js
 *
 * Behavioral test suite for Akatsuki Red-Team Tool Registry, Custom Tool Profiles,
 * Phase Planner, and Fail-Closed Safety Gate Integration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  VALID_CATEGORIES,
  VALID_SAFETY_CLASSES,
  validateCustomToolProfile,
  getToolProfile,
  listSupportedTools,
  planToolExecution
} = require('../src/akatsuki_tool_registry');
const {
  runRedTeamWorkflow,
  runAkatsukiFinalGate,
  isRedTeamEnabled,
  setRedTeamEnabled
} = require('../src/akatsuki_workflows');
const { cmdAkatsuki } = require('../bin/commands/akatsuki');

function testCuratedToolRegistry() {
  console.log('1. Verifying Curated Tool Registry...');

  const expectedTools = [
    'nmap',
    'tshark',
    'metasploit',
    'zap',
    'nuclei',
    'ffuf',
    'sqlmap',
    'testssl',
    'trivy',
    'curl_probe'
  ];

  for (const toolId of expectedTools) {
    const tool = getToolProfile(toolId);
    assert.ok(tool, `Tool "${toolId}" must exist in curated registry`);
    assert.strictEqual(tool.id, toolId);
    assert.ok(typeof tool.display_name === 'string' && tool.display_name.length > 0);
    assert.ok(VALID_CATEGORIES.has(tool.category), `Tool category "${tool.category}" must be valid`);
    assert.ok(VALID_SAFETY_CLASSES.has(tool.safety_class), `Safety class "${tool.safety_class}" must be valid`);
    assert.ok(Array.isArray(tool.binary_candidates) && tool.binary_candidates.length > 0);
    assert.ok(Array.isArray(tool.allowed_operations) && tool.allowed_operations.length > 0);
    assert.strictEqual(tool.required_scope, 'local_or_dev');
    assert.ok(tool.timeout_ms >= 1000 && tool.timeout_ms <= 120000);
    assert.ok(Array.isArray(tool.cleanup_steps) && tool.cleanup_steps.length > 0);
  }

  const supportedList = listSupportedTools();
  assert.strictEqual(supportedList.length, expectedTools.length);
  console.log('✓ Curated registry contains 10 verified tools with complete metadata.');
}

function testCustomToolValidation() {
  console.log('\n2. Testing Custom Tool Profile Validation & Safety Boundaries...');

  // 2a: Valid custom profile
  const validProfile = {
    id: 'custom_fuzzer',
    display_name: 'Custom Protocol Fuzzer',
    category: 'protocol_probe',
    binary_candidates: ['proto_fuzz'],
    safety_class: 'vulnerability_audit',
    allowed_operations: ['frame_fuzzing', 'state_machine_probe'],
    required_scope: 'local_or_dev',
    timeout_ms: 15000,
    cleanup_steps: ['pkill -f proto_fuzz || true']
  };
  const valValid = validateCustomToolProfile(validProfile);
  assert.strictEqual(valValid.valid, true);
  assert.strictEqual(valValid.sanitized.id, 'custom_fuzzer');
  assert.strictEqual(valValid.sanitized.is_custom, true);

  // 2b: Missing ID
  const noId = validateCustomToolProfile({ binary_candidates: ['bin'] });
  assert.strictEqual(noId.valid, false);
  assert.ok(noId.reason.includes('id'));

  // 2c: Dangerous system binary (netcat / nc)
  const dangerBin = validateCustomToolProfile({
    id: 'danger_nc',
    binary_candidates: ['nc'],
    allowed_operations: ['port_connect']
  });
  assert.strictEqual(dangerBin.valid, false);
  assert.ok(dangerBin.reason.includes('restricted system utility'));

  // 2d: Forbidden host network capability
  const dangerHostNet = validateCustomToolProfile({
    id: 'host_sniff',
    binary_candidates: ['sniffer'],
    allowed_operations: ['host_network_promiscuous_capture']
  });
  assert.strictEqual(dangerHostNet.valid, false);
  assert.ok(dangerHostNet.reason.includes('restricted pattern'));

  // 2e: Forbidden persistence capability
  const dangerPersist = validateCustomToolProfile({
    id: 'backdoor_tool',
    binary_candidates: ['agent_daemon'],
    allowed_operations: ['install_persistence_cron']
  });
  assert.strictEqual(dangerPersist.valid, false);
  assert.ok(dangerPersist.reason.includes('restricted pattern'));

  // 2f: Non-local scope
  const extScope = validateCustomToolProfile({
    id: 'ext_scanner',
    binary_candidates: ['ext_scan'],
    allowed_operations: ['sweep'],
    required_scope: 'external_wan'
  });
  assert.strictEqual(extScope.valid, false);
  assert.ok(extScope.reason.includes('local_or_dev'));

  console.log('✓ Custom tool profile validation strictly enforces safety bounds and rejects dangerous patterns.');
}

function testPhasePlanner() {
  console.log('\n3. Testing Phase Planner and Stop Conditions...');

  // 3a: Standard plan with network, web, and protocol tools
  const plan = planToolExecution({
    tools: ['nmap', 'tshark', 'zap', 'nuclei', 'curl_probe'],
    target: 'localhost:8080'
  });
  assert.ok(plan.phases.length >= 5);
  const phaseNames = plan.phases.map(p => p.phase);
  assert.ok(phaseNames.includes('rules_of_engagement'));
  assert.ok(phaseNames.includes('sandbox_containment'));
  assert.ok(phaseNames.includes('asset_discovery'));
  assert.ok(phaseNames.includes('packet_analysis'));
  assert.ok(phaseNames.includes('vulnerability_audit'));
  assert.ok(phaseNames.includes('containment_teardown'));
  assert.strictEqual(plan.tools_blocked.length, 0);

  // 3b: Unprofiled tool blocked
  const unprofiledPlan = planToolExecution({
    tools: ['nmap', 'totally_unknown_exploit_tool_v99'],
    target: 'localhost:8080'
  });
  assert.strictEqual(unprofiledPlan.tools_blocked.length, 1);
  assert.strictEqual(unprofiledPlan.tools_blocked[0].tool, 'totally_unknown_exploit_tool_v99');

  // 3c: Metasploit blocked without allow_controlled_exploit_verification
  const msfBlockedPlan = planToolExecution({
    tools: ['nmap', 'metasploit'],
    allow_controlled_exploit_verification: false,
    target: 'localhost:8080'
  });
  assert.strictEqual(msfBlockedPlan.tools_blocked.length, 1);
  assert.strictEqual(msfBlockedPlan.tools_blocked[0].tool, 'metasploit');
  assert.ok(msfBlockedPlan.tools_blocked[0].reason.includes('allow_controlled_exploit_verification'));

  // 3d: Metasploit allowed with explicit flag
  const msfAllowedPlan = planToolExecution({
    tools: ['nmap', 'metasploit'],
    allow_controlled_exploit_verification: true,
    target: 'localhost:8080'
  });
  assert.strictEqual(msfAllowedPlan.tools_blocked.length, 0);
  assert.ok(msfAllowedPlan.phases.map(p => p.phase).includes('controlled_verification'));

  console.log('✓ Phase planner maps objectives deterministically and gates controlled exploit verification.');
}

function testWorkflowIntegration() {
  console.log('\n4. Testing Workflow Integration with Multiple Tool Categories...');

  // 4a: Full authorized assessment with multiple tools using mock tool runner for uninstalled lab tools
  const multiToolRes = runRedTeamWorkflow({
    task: 'Authorized penetration test across network and web surface',
    authorized: true,
    target: '10.77.77.153',
    tools: ['nmap', 'tshark', 'zap', 'nuclei', 'curl_probe']
  }, {
    mockToolExecutor: (toolId, phase, cmdArgs) => ({
      status: 0,
      stdout: `Tool ${toolId} in phase ${phase} command ${cmdArgs[0]} executed successfully`,
      stderr: ''
    })
  });
  assert.strictEqual(multiToolRes.status, 'completed');
  assert.strictEqual(multiToolRes.gate_decision, 'passed');
  assert.strictEqual(multiToolRes.tools_requested.length, 5);
  assert.strictEqual(multiToolRes.tools_available.length, 5);
  assert.strictEqual(multiToolRes.tools_blocked.length, 0);
  assert.ok(multiToolRes.commands_executed.length >= 5);
  assert.ok(multiToolRes.evidence_references.includes('tool_verified_nmap'));

  // Assert per-phase status and command metadata
  assert.ok(multiToolRes.phases.length >= 5, 'Must plan multiple execution phases');
  for (const ph of multiToolRes.phases) {
    assert.strictEqual(ph.status, 'completed', `Phase ${ph.phase} must be completed`);
    assert.strictEqual(ph.exit_status, 0, `Phase ${ph.phase} exit_status must be 0`);
  }
  const cmdSample = multiToolRes.commands_executed[0];
  assert.ok(cmdSample.phase, 'Command record must include phase');
  assert.ok(cmdSample.tool, 'Command record must include tool');
  assert.ok(cmdSample.binary, 'Command record must include binary');
  assert.ok(cmdSample.command, 'Command record must include command string');
  assert.strictEqual(cmdSample.exit_status, 0, 'Command record must include exit_status');
  assert.ok(cmdSample.timeout_ms > 0, 'Command record must include timeout_ms');
  assert.ok(cmdSample.evidence_reference, 'Command record must include evidence_reference');
  assert.ok(cmdSample.timestamp, 'Command record must include timestamp');

  // 4b: Real container execution with nmap
  const realRes = runRedTeamWorkflow({
    task: 'Live in-sandbox nmap assessment',
    authorized: true,
    target: '10.77.77.153',
    tools: ['nmap']
  });
  assert.strictEqual(realRes.status, 'completed');
  assert.strictEqual(realRes.gate_decision, 'passed');
  const assetPhase = realRes.phases.find(p => p.phase === 'asset_discovery');
  assert.ok(assetPhase, 'Must include asset_discovery phase');
  assert.strictEqual(assetPhase.status, 'completed');
  assert.strictEqual(assetPhase.exit_status, 0);

  // 4c: Assessment requesting unprofiled tool fails closed
  const blockedToolRes = runRedTeamWorkflow({
    task: 'Attempt assessment with unprofiled tool',
    authorized: true,
    target: 'localhost:8080',
    tools: ['nmap', 'unprofiled_shadow_scanner']
  });
  assert.strictEqual(blockedToolRes.status, 'blocked');
  assert.strictEqual(blockedToolRes.gate_decision, 'blocked');
  assert.strictEqual(blockedToolRes.tools_blocked.length, 1);
  assert.strictEqual(blockedToolRes.tools_blocked[0].tool, 'unprofiled_shadow_scanner');
  assert.ok(blockedToolRes.stop_conditions.length > 0);

  // 4c: Controlled verification flag enforcement
  const msfNoFlag = runRedTeamWorkflow({
    task: 'Verify exploitability',
    authorized: true,
    target: 'localhost:8080',
    tools: ['metasploit']
  });
  assert.strictEqual(msfNoFlag.status, 'blocked');
  assert.strictEqual(msfNoFlag.gate_decision, 'blocked');

  const msfWithFlag = runRedTeamWorkflow({
    task: 'Authorized controlled verification',
    authorized: true,
    target: 'localhost:8080',
    tools: ['metasploit'],
    allow_controlled_exploit_verification: true
  });
  assert.strictEqual(msfWithFlag.status, 'completed');
  assert.strictEqual(msfWithFlag.gate_decision, 'passed');
  assert.strictEqual(msfWithFlag.tools_blocked.length, 0);

  // 4d: Custom tool profile integration
  const customRes = runRedTeamWorkflow({
    task: 'Test with custom tool',
    authorized: true,
    target: 'localhost:8080',
    tools: ['nmap', 'custom_api_auditor'],
    custom_tools: [{
      id: 'custom_api_auditor',
      display_name: 'Custom API Auditor',
      category: 'web_api_assessment',
      binary_candidates: ['api_auditor'],
      safety_class: 'vulnerability_audit',
      allowed_operations: ['endpoint_check'],
      required_scope: 'local_or_dev',
      timeout_ms: 20000,
      cleanup_steps: ['pkill -f api_auditor || true']
    }]
  });
  assert.strictEqual(customRes.status, 'completed');
  assert.strictEqual(customRes.gate_decision, 'passed');
  assert.strictEqual(customRes.tools_available.includes('custom_api_auditor'), true);

  console.log('✓ Red-team workflow flawlessly handles multi-tool suites, custom profiles, and authorization gates.');
}

function testFinalGateSafetyEnforcement() {
  console.log('\n5. Testing Akatsuki Final Gate with Tool Manifests...');

  // 5a: Gate blocks on blocked tools
  const blockedReview = {
    workflow_type: 'red_team',
    lab_name: 'akatsuki-lab',
    engine: 'lxc',
    network_isolated: true,
    host_execution_denied: true,
    cleanup_confirmed: true,
    status: 'blocked',
    gate_decision: 'blocked',
    tools_blocked: [{ tool: 'shadow_tool', reason: 'Unprofiled' }]
  };
  const gateBlock = runAkatsukiFinalGate('/tmp', { akatsuki_review: blockedReview }, { skip_if_not_applicable: false });
  assert.strictEqual(gateBlock.passed, false);
  assert.strictEqual(gateBlock.decision, 'blocked');
  assert.ok(gateBlock.reason.includes('blocked tools'));

  // 5b: Gate passes on clean multi-tool review
  const cleanReview = {
    workflow_type: 'red_team',
    lab_name: 'akatsuki-lab',
    engine: 'lxc',
    network_isolated: true,
    host_execution_denied: true,
    cleanup_confirmed: true,
    status: 'completed',
    gate_decision: 'passed',
    findings: [],
    tools_blocked: [],
    stop_conditions: []
  };
  const gatePass = runAkatsukiFinalGate('/tmp', { akatsuki_review: cleanReview }, { skip_if_not_applicable: false });
  assert.strictEqual(gatePass.passed, true);
  assert.strictEqual(gatePass.decision, 'passed');

  console.log('✓ Akatsuki Final Gate enforces tool manifest evidence and blocks on unapproved tools.');
}

async function testAkatsukiCliAndFeatureToggle() {
  console.log('\n6. Testing Akatsuki CLI & Red-Team Operator Toggle (Enable/Disable)...');

  const tmpConfig = path.join(os.tmpdir(), `akatsuki_test_${Date.now()}.json`);
  process.env.KONOHA_AKATSUKI_CONFIG = tmpConfig;

  try {
    // 6a: Test disabling red-team operations
    setRedTeamEnabled(false);
    assert.strictEqual(isRedTeamEnabled(), false, 'Red-team must be disabled after setRedTeamEnabled(false)');

    const disabledRes = runRedTeamWorkflow({
      task: 'Attempt assessment while disabled',
      authorized: true,
      target: 'localhost:8080'
    });
    assert.strictEqual(disabledRes.status, 'blocked');
    assert.strictEqual(disabledRes.authorized, false);
    assert.strictEqual(disabledRes.gate_decision, 'blocked');
    assert.ok(disabledRes.reason.includes('currently disabled'));

    // 6b: Test enabling red-team operations
    setRedTeamEnabled(true);
    assert.strictEqual(isRedTeamEnabled(), true, 'Red-team must be enabled after setRedTeamEnabled(true)');

    const enabledRes = runRedTeamWorkflow({
      task: 'Authorized assessment while enabled',
      authorized: true,
      target: 'localhost:8080'
    });
    assert.strictEqual(enabledRes.status, 'completed');
    assert.strictEqual(enabledRes.authorized, true);
    assert.strictEqual(enabledRes.gate_decision, 'passed');

    // 6c: Test CLI subcommand dispatch
    await cmdAkatsuki(['status']);
    await cmdAkatsuki(['redteam', 'disable']);
    assert.strictEqual(isRedTeamEnabled(), false);

    await cmdAkatsuki(['redteam', 'enable']);
    assert.strictEqual(isRedTeamEnabled(), true);

    console.log('✓ Akatsuki CLI commands and red-team feature toggle verified (isolated config file).');
  } finally {
    try {
      if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
    } catch (_) {}
    delete process.env.KONOHA_AKATSUKI_CONFIG;
  }
}

async function runAll() {
  setRedTeamEnabled(true);
  testCuratedToolRegistry();
  testCustomToolValidation();
  testPhasePlanner();
  testWorkflowIntegration();
  testFinalGateSafetyEnforcement();
  await testAkatsukiCliAndFeatureToggle();

  console.log('\n======================================================');
  console.log('✅ ALL AKATSUKI TOOL REGISTRY & SAFETY TESTS PASSED!');
  console.log('======================================================\n');
}

runAll();
