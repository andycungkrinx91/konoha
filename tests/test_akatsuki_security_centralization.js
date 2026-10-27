'use strict';

/**
 * tests/test_akatsuki_security_centralization.js
 *
 * Comprehensive contract and behavioral test suite for Akatsuki security centralization:
 * 1. Official roster, tool manifest, and client config presence.
 * 2. Canonical skill ownership and isolation from general agents.
 * 3. Red-team fail-closed authorization and target boundary enforcement.
 * 4. Blue-team defensive auditing, Skill Guardian verification, and fail-closed scanner failure.
 * 5. Akatsuki Security Final Gate behavioral contract (clean pass, critical/high block, not_applicable).
 * 6. Final delivery workflow integration and non-bypassability.
 */

process.env.KONOHA_AKATSUKI_REDTEAM = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { CANONICAL_OFFICIAL_NINJAS, getOfficialAgentNames } = require('../src/agent_crud');
const { CANONICAL_SKILL_NAMES } = require('../src/canonical_skills');
const { KONOHA_CANONICAL_TOOLS } = require('../src/deploy_utils');
const {
  validateAuthorization,
  runBlueTeamWorkflow,
  runRedTeamWorkflow,
  runAkatsukiFinalGate,
  dispatchAkatsuki,
  isSecurityApplicable
} = require('../src/workflow/akatsuki/workflows');
const { workflowReviewApproved } = require('../src/mcp/workflow_dispatch');

async function runAkatsukiTests() {
  console.log('Running test_akatsuki_security_centralization.js...\n');

  // =========================================================================
  // 1. Roster Presence & Manifest Parity
  // =========================================================================
  console.log('1. Verifying official roster and tool manifest presence...');

  assert.ok(CANONICAL_OFFICIAL_NINJAS.includes('akatsuki'), 'CANONICAL_OFFICIAL_NINJAS must include akatsuki');
  assert.ok(getOfficialAgentNames().includes('akatsuki'), 'getOfficialAgentNames() must include akatsuki');
  assert.ok(CANONICAL_SKILL_NAMES.has('akatsuki-skill'), 'CANONICAL_SKILL_NAMES must include akatsuki-skill');
  assert.ok(KONOHA_CANONICAL_TOOLS.includes('akatsuki'), 'KONOHA_CANONICAL_TOOLS must include akatsuki');

  // Verify src/mcp_tool_manifest.json
  const manifestPath = path.resolve(__dirname, '..', 'src', 'mcp_tool_manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'mcp_tool_manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const akatsukiTool = (manifest.tools || []).find(t => t.name === 'akatsuki');
  assert.ok(akatsukiTool, 'mcp_tool_manifest.json must declare akatsuki tool');
  assert.ok(akatsukiTool.description.toLowerCase().includes('security'), 'akatsuki tool description must mention security');
  assert.ok(akatsukiTool.inputSchema && akatsukiTool.inputSchema.properties.workflow_type, 'akatsuki tool inputSchema must include workflow_type');

  // Verify rosters across client mirrors
  const clientFiles = [
    'AGENTS.md',
    '.cursorrules',
    'CLAUDE.md',
    'GEMINI.md',
    'src/templates/AGENTS.md',
    'src/templates/GEMINI.md',
    'apps/web/AGENTS.md',
    'apps/web/.cursorrules',
    'apps/web/CLAUDE.md',
    'apps/web/GEMINI.md'
  ];

  for (const rel of clientFiles) {
    const full = path.resolve(__dirname, '..', rel);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf8');
      assert.ok(content.includes('@akatsuki'), `${rel} must include @akatsuki in roster`);
    }
  }

  // Verify .claude.json tools list
  const claudeJsonPath = path.resolve(__dirname, '..', '.claude.json');
  if (fs.existsSync(claudeJsonPath)) {
    const cjson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
    const tools = (cjson.mcpServers && cjson.mcpServers.konoha && cjson.mcpServers.konoha.autoApprove) || [];
    assert.ok(tools.includes('akatsuki'), '.claude.json must include akatsuki in konoha autoApprove');
  }

  console.log('✓ Official roster and client configuration verified across all client trees.');

  // =========================================================================
  // 2. Skill Ownership & Isolation from General Agents
  // =========================================================================
  console.log('\n2. Verifying security skill ownership and isolation...');

  const akatsukiSkillPath = path.resolve(__dirname, '..', 'src', 'templates', 'skills', 'akatsuki-skill', 'SKILL.md');
  assert.ok(fs.existsSync(akatsukiSkillPath), 'src/templates/skills/akatsuki-skill/SKILL.md must exist');
  const akatsukiSkillContent = fs.readFileSync(akatsukiSkillPath, 'utf8');
  assert.ok(akatsukiSkillContent.includes('Akatsuki: Red-Team & Blue-Team Security Specialist'), 'Must have Akatsuki title');
  assert.ok(akatsukiSkillContent.includes('Akatsuki Security Final Gate'), 'Must define Akatsuki Security Final Gate');

  // Anbu must be limited to basic security hygiene and safe escalation
  const anbuSkillPath = path.resolve(__dirname, '..', 'src', 'templates', 'skills', 'anbu-skill', 'SKILL.md');
  const anbuSkillContent = fs.readFileSync(anbuSkillPath, 'utf8');
  assert.ok(!anbuSkillContent.includes('SOP 5: Dev/Local Penetration Testing'), 'anbu-skill must not contain penetration testing SOP');
  assert.ok(anbuSkillContent.includes('SOP 5: Basic Security Hygiene & Safe Escalation'), 'anbu-skill must contain basic security hygiene SOP');
  assert.ok(anbuSkillContent.includes('@akatsuki'), 'anbu-skill must instruct escalation to @akatsuki');

  // Verify anbu references do not contain offensive assets
  const anbuRefDir = path.resolve(__dirname, '..', 'src', 'templates', 'skills', 'anbu-skill', 'references');
  assert.ok(!fs.existsSync(path.join(anbuRefDir, 'anthropic-cybersecurity-skills-assets')), 'anbu references must NOT contain cyber assets');
  assert.ok(!fs.existsSync(path.join(anbuRefDir, 'anthropic-cybersecurity-skills.md')), 'anbu references must NOT contain cyber skill markdown');
  assert.ok(!fs.existsSync(path.join(anbuRefDir, 'autonomous-red-teamer.md')), 'anbu references must NOT contain autonomous-red-teamer');

  // Verify akatsuki references contain the assets
  const akatsukiRefDir = path.resolve(__dirname, '..', 'src', 'templates', 'skills', 'akatsuki-skill', 'references');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'anthropic-cybersecurity-skills-assets')), 'akatsuki references must contain cyber assets');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'anthropic-cybersecurity-skills.md')), 'akatsuki references must contain cyber markdown');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'autonomous-red-teamer.md')), 'akatsuki references must contain autonomous-red-teamer');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'skill-guardian.md')), 'akatsuki references must contain skill-guardian');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'blue-team-defense.md')), 'akatsuki references must contain blue-team-defense');
  assert.ok(fs.existsSync(path.join(akatsukiRefDir, 'red-team-offensive.md')), 'akatsuki references must contain red-team-offensive');

  console.log('✓ Security skills centralized in Akatsuki and cleanly pruned from general agents.');

  // =========================================================================
  // 3. Red-Team Authorization & Scope Boundary (Fail-Closed)
  // =========================================================================
  console.log('\n3. Testing Red-Team fail-closed authorization and scoping...');

  // Test 3a: Explicit unauthorized red team -> blocked
  const unauthResult = runRedTeamWorkflow({
    task: 'Probe login endpoint for SQL injection vulnerability',
    target: 'localhost:3000',
    authorized: false
  });
  assert.strictEqual(unauthResult.status, 'blocked', 'Unauthenticated red team must be blocked');
  assert.strictEqual(unauthResult.authorized, false, 'authorized must be false');
  assert.strictEqual(unauthResult.gate_decision, 'blocked', 'gate_decision must be blocked');
  assert.deepStrictEqual(unauthResult.checks_performed, [], 'checks_performed must be empty when blocked');
  assert.ok(unauthResult.reason.includes('REQUIRE explicit written authorization'), 'Reason must cite authorization requirement');

  // Test 3b: Out-of-scope target -> blocked
  const outOfScopeResult = runRedTeamWorkflow({
    task: 'Audit endpoint',
    authorized: true,
    target: 'https://unauthorized-external-domain.com'
  });
  assert.strictEqual(outOfScopeResult.status, 'blocked', 'Out-of-scope target must be blocked');
  assert.strictEqual(outOfScopeResult.authorized, false, 'authorized must be false for out-of-scope target');
  assert.strictEqual(outOfScopeResult.gate_decision, 'blocked', 'gate_decision must be blocked');
  assert.ok(outOfScopeResult.reason.includes('outside authorized local/dev boundary'), 'Reason must cite boundary restriction');

  // Test 3c: Explicit authorized local target -> executes cleanly with non-destructive proof & cleanup
  const authResult = runRedTeamWorkflow({
    task: 'Conduct authorized penetration test on auth routes',
    authorized: true,
    target: 'localhost:8080'
  });
  assert.strictEqual(authResult.status, 'completed', 'Authorized test must complete');
  assert.strictEqual(authResult.authorized, true, 'authorized must be true');
  assert.strictEqual(authResult.gate_decision, 'passed', 'gate_decision must pass when clean');
  assert.ok(authResult.checks_performed.length > 0, 'Must perform reconnaissance and probe checks');
  assert.strictEqual(authResult.cleanup_confirmed, true, 'cleanup_confirmed must be true');

  console.log('✓ Red-Team fail-closed authorization, scoping, and cleanup verified.');

  // =========================================================================
  // 4. Blue-Team Defensive Auditing & Scanner Fail-Closed
  // =========================================================================
  console.log('\n4. Testing Blue-Team defensive audit and scanner fail-closed...');

  // Test 4a: Clean Blue-Team run
  const cleanBlue = runBlueTeamWorkflow({ scope: 'local-repository' });
  assert.strictEqual(cleanBlue.workflow_type, 'blue_team');
  assert.strictEqual(cleanBlue.status, 'completed');
  assert.strictEqual(cleanBlue.critical_count, 0, 'Clean run must have 0 critical findings');
  assert.strictEqual(cleanBlue.high_count, 0, 'Clean run must have 0 high findings');
  assert.strictEqual(cleanBlue.gate_decision, 'passed', 'Clean run gate_decision must be passed');
  assert.ok(cleanBlue.evidence_references.includes('skill_guardian_scan_completed'), 'Must include guardian evidence');

  // Test 4b: Injected Critical finding -> fails gate
  const vulnBlue = runBlueTeamWorkflow({
    test_findings: [
      {
        id: 'TEST_CRITICAL_SQLI',
        severity: 'critical',
        component: 'api/users',
        title: 'SQL injection vulnerability in user lookup',
        remediation: 'Use parameterized queries'
      }
    ]
  });
  assert.strictEqual(vulnBlue.status, 'failed', 'Status must be failed on critical finding');
  assert.strictEqual(vulnBlue.gate_decision, 'failed', 'Gate decision must be failed');
  assert.strictEqual(vulnBlue.critical_count, 1);
  assert.strictEqual(vulnBlue.residual_risk, 'critical');

  // Test 4c: Scanner tool failure -> fails closed (blocked)
  const failBlue = runBlueTeamWorkflow({ force_scanner_failure: true });
  assert.strictEqual(failBlue.status, 'failed');
  assert.strictEqual(failBlue.gate_decision, 'blocked', 'Scanner tool failure must fail closed as blocked');

  console.log('✓ Blue-Team defensive checks and scanner fail-closed verified.');

  // =========================================================================
  // 5. Akatsuki Security Final Gate
  // =========================================================================
  console.log('\n5. Testing Akatsuki Security Final Gate...');

  // Test 5a: Clean applicable change passes gate
  const cleanGate = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Implement new database migration and backend route',
    changed_files: ['src/routes/api.js', 'src/db.js']
  });
  assert.strictEqual(cleanGate.gate, 'akatsuki_security');
  assert.strictEqual(cleanGate.passed, true, 'Clean change must pass gate');
  assert.strictEqual(cleanGate.decision, 'passed');

  // Test 5b: Unresolved critical finding blocks gate
  const blockedGate = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Add payment integration',
    changed_files: ['src/payment.js'],
    akatsuki_review: {
      gate_decision: 'failed',
      critical_count: 1,
      high_count: 0,
      findings: [{ id: 'LEAKED_STRIPE_KEY', severity: 'critical' }]
    }
  });
  assert.strictEqual(blockedGate.passed, false, 'Critical finding must block gate');
  assert.strictEqual(blockedGate.decision, 'blocked');

  // Test 5c: Non-applicable change (pure documentation) requires explicit justification
  const notAppGate = runAkatsukiFinalGate(process.cwd(), {
    prompt: 'Update README with new tutorial documentation',
    changed_files: ['README.md', 'docs/guide.md']
  });
  assert.strictEqual(notAppGate.decision, 'not_applicable', 'Docs only change must be not_applicable');
  assert.strictEqual(notAppGate.passed, true, 'not_applicable change must pass gate');
  assert.ok(notAppGate.reason && notAppGate.reason.length > 10, 'not_applicable decision must provide reason');

  console.log('✓ Akatsuki Security Final Gate behavioral contract verified.');

  // =========================================================================
  // 6. Workflow Integration & Delivery Gate Non-Bypassability
  // =========================================================================
  console.log('\n6. Testing workflowReviewApproved gate integration...');

  const tmpTaskDir = path.join(os.tmpdir(), `konoha-akatsuki-gate-test-${Date.now()}`);
  fs.mkdirSync(tmpTaskDir, { recursive: true });

  try {
    // 6a: Kage review is approved, but Akatsuki review has critical finding -> DELIVERY BLOCKED
    const kageReviewClean = {
      approved: true,
      verified_task_ids: ['task-1'],
      validation: ['all tests passed: 0 errors and 0 warnings'],
      security_reviewed: true,
      rollback_reviewed: true,
      ai_slop_findings: 0,
      ai_slop_clean: true,
      findings: [],
      confidence: 99
    };
    fs.writeFileSync(path.join(tmpTaskDir, 'kage_review.json'), JSON.stringify(kageReviewClean), 'utf8');

    const akatsukiReviewVuln = {
      workflow_type: 'blue_team',
      gate_decision: 'failed',
      critical_count: 1,
      high_count: 0,
      findings: [{ id: 'EXPOSED_API_KEY', severity: 'critical' }]
    };
    fs.writeFileSync(path.join(tmpTaskDir, 'akatsuki_review.json'), JSON.stringify(akatsukiReviewVuln), 'utf8');

    const statusWithVuln = {
      tasks: [{ id: 'task-1', status: 'completed', validation: ['0 errors and 0 warnings'] }],
      prompt: 'Implement auth service'
    };

    const reviewApprovedWithVuln = workflowReviewApproved(tmpTaskDir, statusWithVuln);
    assert.strictEqual(reviewApprovedWithVuln, false, 'Delivery must be BLOCKED when Akatsuki gate fails, even if Kage approved');

    // 6b: Akatsuki review clean -> DELIVERY APPROVED
    const akatsukiReviewClean = {
      workflow_type: 'blue_team',
      gate_decision: 'passed',
      critical_count: 0,
      high_count: 0,
      findings: []
    };
    fs.writeFileSync(path.join(tmpTaskDir, 'akatsuki_review.json'), JSON.stringify(akatsukiReviewClean), 'utf8');

    const reviewApprovedClean = workflowReviewApproved(tmpTaskDir, statusWithVuln);
    assert.strictEqual(reviewApprovedClean, true, 'Delivery must be APPROVED when both Kage and Akatsuki pass');

    // 6c: Direct standalone dispatch via dispatchAkatsuki
    const directDispatch = JSON.parse(dispatchAkatsuki({
      workflow_type: 'blue_team',
      task_dir: tmpTaskDir
    }));
    assert.strictEqual(directDispatch.workflow_type, 'blue_team');
    assert.strictEqual(directDispatch.gate_decision, 'passed');
    assert.ok(fs.existsSync(path.join(tmpTaskDir, 'akatsuki_review.json')), 'dispatchAkatsuki must write akatsuki_review.json');

  } finally {
    try { fs.rmSync(tmpTaskDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('✓ Akatsuki Final Gate cannot be bypassed; delivery blocks on security findings.');

  console.log('\n=============================================================');
  console.log('✅ ALL AKATSUKI SECURITY CENTRALIZATION TESTS PASSED CLEANLY!');
  console.log('=============================================================');
}

runAkatsukiTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
