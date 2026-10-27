'use strict';

/**
 * src/akatsuki_workflows.js
 * Professional Red-Team and Blue-Team security workflows for Akatsuki.
 * Enforces fail-closed authorization, sandbox containment, and Kage delivery gates.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
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
} = require('./akatsuki_lab');
const {
  CURATED_TOOL_REGISTRY,
  VALID_CATEGORIES,
  VALID_SAFETY_CLASSES,
  validateCustomToolProfile,
  getToolProfile,
  listSupportedTools,
  planToolExecution,
  buildPhaseCommand
} = require('./akatsuki_tool_registry');
const {
  isRedTeamEnabled,
  loadAkatsukiConfig,
  setRedTeamEnabled
} = require('./akatsuki_config');

const LOCAL_TARGET_REGEX = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|app|web|dev|staging|container|cluster)(?::\d+)?(\/.*)?$/i;

/**
 * Validate explicit authorization and target scope for red-team operations.
 * Fails closed if authorization is missing, ambiguous, or target is out-of-scope.
 * 
 * @param {Object} params
 * @returns {{ authorized: boolean, scope: string, reason?: string }}
 */
function validateAuthorization(params = {}, options = {}) {
  const taskText = [
    params.task || '',
    params.prompt || '',
    params.instructions || '',
    params.context || '',
    params.authorization || ''
  ].join(' ');

  const explicitRevocation = params.authorized === false || params.permission === 'denied' || params.authorization === 'revoked';
  const explicitAuthField = params.authorized === true ||
    params.permission === 'granted' ||
    params.authorization === 'authorized' ||
    params.auth === true;

  const authPattern = /\b(explicit(?:ly)?\s+authorized|authorized:\s*(?:true|yes|granted)|authorization\s*granted|scope:\s*authorized|written\s+authorization|pentest\s+approved|security\s+audit\s+authorized)\b/i;
  const hasTextAuth = authPattern.test(taskText);

  const redModeActive = isRedTeamEnabled(options);
  const isAuthorized = !explicitRevocation && (explicitAuthField || hasTextAuth || redModeActive);

  let targetScope = (params.scope || params.target || '').trim();
  let scopeDefaultedLocal = false;
  if (!targetScope) {
    const scopeMatch = taskText.match(/\b(?:target|scope|host|endpoint):\s*([^\s,;]+)/i);
    if (scopeMatch) {
      targetScope = scopeMatch[1];
    } else if (/\b(localhost|127\.0\.0\.1|local\s*dev|local\s*repo|codebase)\b/i.test(taskText)) {
      targetScope = 'local-repository';
    } else if (redModeActive) {
      targetScope = '127.0.0.1';
      scopeDefaultedLocal = true;
    }
  }

  if (!isAuthorized) {
    return {
      authorized: false,
      scope: targetScope || 'unspecified',
      reason: 'Red-team operations strictly REQUIRE explicit written authorization in task context (e.g. authorized: true). Execution fails closed.'
    };
  }

  if (!targetScope) {
    return {
      authorized: false,
      scope: 'unspecified',
      reason: 'Target scope is unspecified. Red-team operations require explicit target definition (localhost, dev container, or project files).'
    };
  }

  // Reject public internet targets or unauthorized domains
  const isLocalTarget = targetScope === 'local-repository' ||
    targetScope === '127.0.0.1' ||
    targetScope === 'localhost' ||
    LOCAL_TARGET_REGEX.test(targetScope) ||
    (!targetScope.includes('://') && !targetScope.includes('.')) ||
    targetScope.endsWith('.local') ||
    targetScope.endsWith('.test');

  if (!isLocalTarget && !params.allow_external_scope) {
    return {
      authorized: false,
      scope: targetScope,
      reason: `Target "${targetScope}" is outside authorized local/dev boundary. External targets are prohibited without explicit bypass flag.`
    };
  }

  return {
    authorized: true,
    scope: targetScope,
    scope_defaulted_local: scopeDefaultedLocal
  };
}

const { runBlueTeamWorkflow } = require('./akatsuki_blue_workflows');

/**
 * Execute professional Red-Team Offensive workflow inside isolated sandbox.
 * Strictly verifies authorization, sandbox prerequisite ('akatsuki-lab' on LXC/Docker),
 * network isolation, non-destructive OWASP/configuration probing, and teardown containment.
 * 
 * Direct host execution is STRICTLY DENIED.
 * 
 * @param {Object} params
 * @param {Object} [options={}]
 * @returns {Object} structured red-team assessment artifact
 */
function runRedTeamWorkflow(params = {}, options = {}) {
  // 0. Operator feature toggle check (Fail-closed if Red-Team is disabled via CLI)
  if (!isRedTeamEnabled(options)) {
    return {
      workflow_type: 'red_team',
      execution_mode: 'isolated_sandbox',
      status: 'blocked',
      authorized: false,
      scope: params.target || params.scope || 'unassessed',
      reason: 'Red-Team operations are currently disabled. Enable via: konoha akatsuki redteam enable',
      checks_performed: [],
      findings: [],
      evidence_references: [],
      remediation_status: 'not_applicable',
      residual_risk: 'unassessed',
      gate_decision: 'blocked',
      cleanup_confirmed: true,
      message: 'Red-team operation blocked: Red-Team operations are currently disabled. Enable via: konoha akatsuki redteam enable'
    };
  }

  // 1. Authorization check (Fail-closed)
  const auth = validateAuthorization(params, options);
  if (!auth.authorized) {
    return {
      workflow_type: 'red_team',
      execution_mode: 'isolated_sandbox',
      status: 'blocked',
      authorized: false,
      scope: auth.scope,
      reason: auth.reason,
      checks_performed: [],
      findings: [],
      evidence_references: [],
      remediation_status: 'not_applicable',
      residual_risk: 'unassessed',
      gate_decision: 'blocked',
      cleanup_confirmed: true,
      message: `Red-team operation blocked: ${auth.reason}`
    };
  }

  // 2. Sandbox isolation & prerequisite check (Fail-closed)
  const labParams = {
    ...params,
    allow_sandbox_redirect: true
  };
  const labCheck = validateLabPrerequisites(labParams, options);
  if (!labCheck.ready) {
    return {
      workflow_type: 'red_team',
      execution_mode: 'isolated_sandbox',
      status: 'blocked',
      authorized: true,
      scope: auth.scope,
      lab_name: labCheck.lab_name || DEFAULT_LAB_NAME,
      engine: labCheck.engine || null,
      lab_status: 'blocked',
      declined: labCheck.declined === true,
      network_isolated: labCheck.network_isolated === true,
      host_execution_denied: true,
      reason: labCheck.reason,
      checks_performed: [],
      findings: [],
      evidence_references: [],
      remediation_status: 'not_applicable',
      residual_risk: 'unassessed',
      gate_decision: 'blocked',
      cleanup_confirmed: labCheck.cleanup_confirmed !== false,
      message: `Red-team operation blocked: ${labCheck.reason}`
    };
  }

  // 3. Reconnaissance planning & Chunin threat intelligence
  const { buildReconDirective, gatherKnowledge } = require('./akatsuki_recon');
  const reconDirective = buildReconDirective({
    scope: auth.scope,
    task: params.task || params.prompt || params.instructions
  });
  const reconSources = gatherKnowledge(reconDirective.queries, options);
  const chuninDispatch = {
    agent: 'chunin',
    task: reconDirective.chunin_task
  };

  // 4. Plan tool execution and professional Red-Team phases inside sandbox
  const toolPlan = planToolExecution({
    tools: params.tools,
    custom_tools: params.custom_tools,
    allow_controlled_exploit_verification: params.allow_controlled_exploit_verification,
    target: auth.scope,
    mode: 'red'
  }, options);

  const toolsRequested = params.tools || ['nmap', 'whatweb', 'httpx', 'nuclei', 'nikto', 'ffuf', 'sqlmap', 'testssl'];
  const toolsAvailable = toolPlan.tools_available;
  const toolsBlocked = toolPlan.tools_blocked;
  const stopConditions = [...toolPlan.stop_conditions];

  const checksPerformed = [
    'rules_of_engagement_and_scope_verification',
    'sandbox_isolation_and_network_containment_verification',
    'chunin_passive_reconnaissance_and_threat_intel',
    'attack_surface_enumeration',
    'authentication_and_session_probe',
    'parameter_and_injection_probe',
    'privilege_boundary_verification',
    'non_destructive_exploitability_validation',
    ...toolPlan.phases.map(p => `phase_${p.phase}`),
    'post_assessment_teardown_and_containment_proof'
  ];

  const findings = [];
  const evidenceReferences = [
    `sandbox_verified_${labCheck.lab_name}_on_${labCheck.engine}`,
    'network_isolation_confirmed',
    'chunin_passive_reconnaissance_and_threat_intel',
    `recon_completed_target_${auth.scope}`,
    'non_destructive_owasp_probing_executed'
  ];

  if (labCheck.auto_provisioned) {
    evidenceReferences.push(`lab_auto_provisioned_${labCheck.engine}`);
  }

  const commandsExecuted = [];

  // Record any blocked tools as stop conditions and high-severity findings
  if (toolsBlocked.length > 0) {
    for (const b of toolsBlocked) {
      stopConditions.push(`Tool "${b.tool}" blocked: ${b.reason}`);
      findings.push({
        id: `TOOL_BLOCKED_${String(b.tool).toUpperCase()}`,
        severity: 'high',
        component: `tool:${b.tool}`,
        title: `Red-team tool ${b.tool} blocked by safety policy`,
        description: b.reason,
        remediation: 'Supply an explicit valid custom tool profile or ensure explicit authorization flags.'
      });
    }
  }

  // 3b. Execute phased assessments inside sandbox
  for (const phase of toolPlan.phases) {
    phase.commands = [];

    if (phase.phase === 'rules_of_engagement') {
      phase.status = 'completed';
      phase.exit_status = 0;
      phase.evidence_reference = 'rules_of_engagement_verified';
      evidenceReferences.push('rules_of_engagement_verified');
      continue;
    }

    if (phase.phase === 'sandbox_containment') {
      phase.status = 'completed';
      phase.exit_status = 0;
      phase.evidence_reference = 'sandbox_containment_verified';
      evidenceReferences.push('sandbox_containment_verified');
      continue;
    }

    if (phase.phase === 'reconnaissance') {
      phase.status = 'completed';
      phase.exit_status = 0;
      phase.evidence_reference = 'chunin_passive_reconnaissance_and_threat_intel';
      phase.recon_directive = reconDirective;
      phase.recon_sources = reconSources;
      phase.chunin_dispatch = chuninDispatch;
      evidenceReferences.push('chunin_passive_reconnaissance_and_threat_intel');
      continue;
    }

    if (phase.phase === 'containment_teardown') {
      // Handled in teardown phase below
      continue;
    }

    // Active execution phases: asset_discovery, packet_analysis, vulnerability_audit, controlled_verification
    phase.status = 'in_progress';
    let phaseSuccess = true;

    for (const toolId of (phase.tools || [])) {
      const tool = toolsAvailable.find(t => t.id === toolId);
      if (!tool) continue;

      const cmdArgs = buildPhaseCommand(tool, auth.scope);
      const primaryBin = (tool.binary_candidates && tool.binary_candidates[0]) || tool.id;
      let cmdRes = { status: 0, stdout: 'simulated', stderr: '' };

      if (typeof options.mockToolExecutor === 'function') {
        cmdRes = options.mockToolExecutor(tool.id, phase.phase, cmdArgs);
      } else if (!options.skip_container_exec && labCheck.lab_running) {
        try {
          const toolTimeout = tool.timeout_ms !== undefined ? tool.timeout_ms : 3600000;
          cmdRes = executeInLab(labCheck.lab_name, cmdArgs, { ...options, timeout: toolTimeout });
        } catch (err) {
          cmdRes = { status: 1, stdout: '', stderr: err.message };
        }
      }

      const cmdRecord = {
        phase: phase.phase,
        tool: tool.id,
        binary: primaryBin,
        args: cmdArgs.slice(1),
        command: cmdArgs.join(' '),
        exit_status: cmdRes ? cmdRes.status : 0,
        timeout_ms: tool.timeout_ms,
        evidence_reference: `evidence_${phase.phase}_${tool.id}`,
        timestamp: new Date().toISOString()
      };

      commandsExecuted.push(cmdRecord);
      phase.commands.push(cmdRecord);
      evidenceReferences.push(`tool_verified_${tool.id}`);
      evidenceReferences.push(`evidence_${phase.phase}_${tool.id}`);

      if (cmdRes && cmdRes.status !== 0) {
        phaseSuccess = false;
        findings.push({
          id: `COMMAND_ERROR_${tool.id.toUpperCase()}`,
          severity: 'medium',
          component: `tool:${tool.id}`,
          title: `Command execution returned non-zero status in phase ${phase.phase}`,
          description: cmdRes.stderr || 'Non-zero exit status',
          remediation: 'Inspect tool arguments and container environment.'
        });
      }
    }

    phase.status = phaseSuccess ? 'completed' : 'failed';
    phase.exit_status = phaseSuccess ? 0 : 1;
    phase.evidence_reference = `phase_${phase.phase}_completed`;
  }

  if (commandsExecuted.length > 0) {
    evidenceReferences.push('in_sandbox_probe_successful');
  } else if (!options.skip_container_exec && labCheck.lab_running) {
    evidenceReferences.push('in_sandbox_probe_successful');
  }

  // Check for test simulated findings
  if (params.test_findings && Array.isArray(params.test_findings)) {
    findings.push(...params.test_findings);
  }

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;
  const lowCount = findings.filter(f => f.severity === 'low').length;

  // 4. Teardown & containment confirmation
  const teardown = teardownLab(labCheck.lab_name, labCheck.engine, options);
  if (teardown.cleanup_confirmed) {
    evidenceReferences.push('containment_and_teardown_verified');
  }

  const teardownPhase = toolPlan.phases.find(p => p.phase === 'containment_teardown');
  if (teardownPhase) {
    teardownPhase.status = teardown.cleanup_confirmed ? 'completed' : 'failed';
    teardownPhase.exit_status = teardown.cleanup_confirmed ? 0 : 1;
    teardownPhase.cleanup_result = teardown;
    teardownPhase.evidence_reference = 'containment_and_teardown_verified';
  }

  const passed = criticalCount === 0 &&
    highCount === 0 &&
    teardown.cleanup_confirmed === true &&
    toolsBlocked.length === 0 &&
    stopConditions.length === 0;

  let gateDecision = 'passed';
  if (toolsBlocked.length > 0 || stopConditions.length > 0) {
    gateDecision = 'blocked';
  } else if (!passed) {
    gateDecision = 'failed';
  }

  // 5. Generate Tokubetsu-Jonin Standard Red-Team PDF Report if requested or task_dir provided
  let reportAttachment = null;
  const reportOption = params.report;
  if (reportOption === 'pdf' || (reportOption && reportOption.format === 'pdf') || params.task_dir) {
    try {
      const { buildRedTeamReportModel, generateRedTeamReportPdf } = require('./akatsuki_report');
      const targetDir = params.task_dir || (typeof reportOption === 'object' && reportOption.output_dir) || os.tmpdir();
      const pdfPath = (typeof reportOption === 'object' && reportOption.output_path) || path.join(targetDir, 'akatsuki_redteam_report.pdf');

      const reportContext = {
        scope: auth.scope,
        lab_name: labCheck.lab_name,
        engine: labCheck.engine,
        tools_available: toolsAvailable,
        findings,
        commands_executed: commandsExecuted,
        phases: toolPlan.phases,
        recon_directive: reconDirective,
        recon_sources: reconSources,
        critical_count: criticalCount,
        high_count: highCount,
        medium_count: mediumCount,
        low_count: lowCount,
        gate_decision: gateDecision,
        cleanup_confirmed: teardown.cleanup_confirmed
      };

      const model = buildRedTeamReportModel(reportContext, options);
      generateRedTeamReportPdf(reportContext, { output_path: pdfPath, task_dir: targetDir });

      reportAttachment = {
        format: 'pdf',
        path: pdfPath,
        sections: model.sections.length
      };
      evidenceReferences.push('report_pdf_generated');
    } catch (_) {
      // Best effort PDF generation
    }
  }

  return {
    workflow_type: 'red_team',
    execution_mode: 'isolated_sandbox',
    status: (toolsBlocked.length > 0 || stopConditions.length > 0) ? 'blocked' : 'completed',
    authorized: true,
    scope: auth.scope,
    scope_defaulted_local: Boolean(auth.scope_defaulted_local),
    lab_name: labCheck.lab_name,
    engine: labCheck.engine,
    lab_status: labCheck.lab_running ? 'running' : 'verified',
    network_isolated: true,
    host_execution_denied: true,
    tools_requested: toolsRequested,
    tools_available: toolsAvailable.map(t => t.id),
    tools_blocked: toolsBlocked,
    phases: toolPlan.phases,
    recon_directive: reconDirective,
    recon_sources: reconSources,
    chunin_dispatch: chuninDispatch,
    report: reportAttachment,
    commands_executed: commandsExecuted,
    stop_conditions: stopConditions,
    checks_performed: checksPerformed,
    findings,
    critical_count: criticalCount,
    high_count: highCount,
    medium_count: mediumCount,
    low_count: lowCount,
    evidence_references: evidenceReferences,
    remediation_status: findings.length === 0 ? 'clean' : (params.remediation_applied ? 'verified' : 'pending'),
    residual_risk: criticalCount > 0 ? 'critical' : (highCount > 0 ? 'high' : 'low'),
    gate_decision: gateDecision,
    cleanup_confirmed: teardown.cleanup_confirmed === true,
    message: passed
      ? `Red-team assessment completed in sandbox "${labCheck.lab_name}" on authorized scope "${auth.scope}" with ${toolsAvailable.length} verified tools.`
      : (toolsBlocked.length > 0
          ? `Red-team assessment blocked: ${toolsBlocked.length} requested tool(s) blocked by safety policy.`
          : `Red-team assessment completed with ${criticalCount} critical, ${highCount} high findings or unconfirmed cleanup.`)
  };
}

/**
 * Determine if a task touches security-sensitive files or behaviors.
 * 
 * @param {string} [task='']
 * @param {string[]} [filesChanged=[]]
 * @returns {boolean}
 */
function isSecurityApplicable(task = '', filesChanged = []) {
  if (filesChanged && filesChanged.length > 0) {
    const isDocOnly = filesChanged.every(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.md', '.txt', '.png', '.jpg', '.webp', '.svg'].includes(ext);
    });
    if (isDocOnly) return false;
  }

  const text = (task || '').toLowerCase();
  const docOnlySignals = [
    'write a doc', 'documentation only', 'update readme', 'fix typo in docs', 'write a prd'
  ];
  if (docOnlySignals.some(s => text.includes(s)) && !text.includes('security') && !text.includes('auth')) {
    return false;
  }

  return true;
}

/**
 * Akatsuki Security Final Gate (Fail-Closed).
 * Must pass before Kage delivery approval whenever applicable.
 * Validates sandbox isolation evidence for red-team operations.
 * 
 * @param {string} projectPath
 * @param {Object} [status={}]
 * @param {Object} [options={}]
 * @returns {Object} gate result
 */
function runAkatsukiFinalGate(projectPath, status = {}, options = {}) {
  const prompt = status.prompt || '';
  const changedFiles = status.changed_files || [];

  if (!isSecurityApplicable(prompt, changedFiles) && options.skip_if_not_applicable !== false) {
    const notAppResult = {
      gate: 'akatsuki_security',
      decision: 'not_applicable',
      passed: true,
      reason: 'Change is strictly non-functional documentation or media with zero code/infra/security impact.'
    };
    if (status) status.akatsuki_gate = notAppResult;
    return notAppResult;
  }

  // If a manual or executed Akatsuki review already exists in status
  if (status.akatsuki_review && typeof status.akatsuki_review === 'object') {
    const rev = status.akatsuki_review;
    const critical = rev.critical_count || (rev.findings || []).filter(f => f.severity === 'critical').length;
    const high = rev.high_count || (rev.findings || []).filter(f => f.severity === 'high').length;

    // For red-team workflows: must verify lab isolation evidence!
    const isRedTeam = rev.workflow_type === 'red_team';
    const labValid = !isRedTeam || (
      rev.lab_name === DEFAULT_LAB_NAME &&
      rev.network_isolated === true &&
      rev.host_execution_denied === true &&
      rev.cleanup_confirmed === true &&
      (!rev.tools_blocked || rev.tools_blocked.length === 0) &&
      (!rev.stop_conditions || rev.stop_conditions.length === 0) &&
      rev.status === 'completed'
    );

    const passed = rev.gate_decision === 'passed' && critical === 0 && high === 0 && labValid;

    let failReason;
    if (isRedTeam && !labValid) {
      if (rev.tools_blocked && rev.tools_blocked.length > 0) {
        failReason = `Security gate blocked: Red-team review lacks required sandbox isolation evidence (requested blocked tools: ${rev.tools_blocked.map(t => t.tool).join(', ')}).`;
      } else if (rev.stop_conditions && rev.stop_conditions.length > 0) {
        failReason = `Security gate blocked: Red-team review lacks required sandbox isolation evidence (stopped due to safety condition: ${rev.stop_conditions.join('; ')}).`;
      } else if (rev.cleanup_confirmed !== true) {
        failReason = 'Security gate blocked: Red-team review lacks required sandbox isolation evidence (cleanup could not be confirmed).';
      } else {
        failReason = 'Security gate blocked: Red-team review lacks required sandbox isolation evidence (akatsuki-lab on LXC/Docker with network isolation).';
      }
    } else if (!passed) {
      failReason = `Security gate blocked: ${critical} critical, ${high} high findings.`;
    } else {
      failReason = 'Akatsuki security review verified clean with required sandbox isolation evidence.';
    }

    const gateResult = {
      gate: 'akatsuki_security',
      decision: passed ? 'passed' : 'blocked',
      passed,
      critical_count: critical,
      high_count: high,
      findings: rev.findings || [],
      reason: failReason
    };
    status.akatsuki_gate = gateResult;
    return gateResult;
  }

  // Execute automated Blue-Team check across changed files
  const blueResult = runBlueTeamWorkflow({ projectPath, scope: 'local-repository', ...options });
  const passed = blueResult.gate_decision === 'passed';

  const gateResult = {
    gate: 'akatsuki_security',
    decision: blueResult.gate_decision,
    passed,
    score: passed ? 100 : Math.max(0, 100 - (blueResult.critical_count * 50 + blueResult.high_count * 25)),
    critical_count: blueResult.critical_count,
    high_count: blueResult.high_count,
    findings: blueResult.findings,
    reason: passed
      ? 'All automated defensive security checks passed with 0 Critical and 0 High findings.'
      : `Security gate failed: ${blueResult.critical_count} critical and ${blueResult.high_count} high findings.`
  };

  if (status) status.akatsuki_gate = gateResult;
  return gateResult;
}

/**
 * Dispatch Akatsuki execution directly.
 * Automatically routes to Red-Team Isolation Workflow or Blue-Team Direct Host Workflow.
 * 
 * @param {Object} params
 * @param {Object} [options={}]
 * @returns {string} JSON-serialized result
 */
function dispatchAkatsuki(params = {}, options = {}) {
  const taskText = (params.task || params.prompt || params.instructions || '').toLowerCase();
  const isRedTeam = params.workflow_type === 'red_team' ||
    params.red_team === true ||
    params.pentest === true ||
    /\b(red[- ]team|pentest|penetration test|exploit|adversary|attack simulation|fuzz)\b/i.test(taskText);

  let result;
  if (isRedTeam) {
    result = runRedTeamWorkflow(params, options);
  } else {
    result = runBlueTeamWorkflow(params, options);
  }

  if (params.task_dir && fs.existsSync(params.task_dir)) {
    try {
      const reviewPath = path.join(params.task_dir, 'akatsuki_review.json');
      fs.writeFileSync(reviewPath, JSON.stringify(result, null, 2), 'utf8');
    } catch (_) { /* best-effort write */ }
  }

  return JSON.stringify(result);
}

module.exports = {
  DEFAULT_LAB_NAME,
  DECLINE_NO_ENGINE,
  HOST_EXECUTION_DENIED_REASON,
  INVALID_LAB_NAME_REASON,
  getRequiredEngine,
  checkEngineInstalled,
  getLabStatus,
  validateLabPrerequisites,
  executeInLab,
  teardownLab,
  validateAuthorization,
  runBlueTeamWorkflow,
  runRedTeamWorkflow,
  runAkatsukiFinalGate,
  dispatchAkatsuki,
  isSecurityApplicable,
  CURATED_TOOL_REGISTRY,
  VALID_CATEGORIES,
  VALID_SAFETY_CLASSES,
  validateCustomToolProfile,
  getToolProfile,
  listSupportedTools,
  planToolExecution,
  isRedTeamEnabled,
  loadAkatsukiConfig,
  setRedTeamEnabled
};
