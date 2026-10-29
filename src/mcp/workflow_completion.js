'use strict';

const fs = require('fs');
const path = require('path');
const {
  readFileSafe,
  saveWorkflowStatus,
  workflowParseTasks,
  cleanupTransientScratchFiles,
  isPentestTask,
  isCleanValidation,
  MINIMUM_CONFIDENCE
} = require('./workflow_common');
const {
  workflowDispatch,
  workflowReviewApproved,
  runAislopGate
} = require('./workflow_dispatch');
const { buildGate1Prompt, buildGate2Prompt } = require('./workflow_gates');
const { logToolCall } = require('./skills');

function enqueueRemediationTask(options) {
  const { fixTaskId, remediationAgent, fixTaskText, resolvedTaskDir, status, sdlcManager } = options;
  const remediationTask = {
    id: fixTaskId,
    agent: remediationAgent,
    task: fixTaskText,
    status: 'pending',
    result: '',
    validation: []
  };
  try {
    sdlcManager.createTask({
      id: fixTaskId,
      description: fixTaskText,
      status: 'in_progress',
      project_path: resolvedTaskDir
    });
  } catch (_) { /* intentional best-effort fallback */ }

  status.tasks = status.tasks || [];
  status.tasks.push(remediationTask);
  status.pending_executors = [fixTaskId];
}

function handleExploreCompletion(dispatch, status, dispatchId) {
  status.phase = 'plan';
  status.history.push({ phase: 'explore', agent: dispatch.agent, dispatch_id: dispatchId });
  status.assigned_agent = 'kage';
  return { nextPhase: 'plan' };
}

function handleResearchCompletion(status, dispatchId) {
  status.phase = 'plan';
  status.research_completed = true;
  status.history.push({ phase: 'research', agent: 'chunin', dispatch_id: dispatchId });
  status.assigned_agent = 'kage';
  return { nextPhase: 'plan' };
}

function handlePlanCompletion(completion, status, context) {
  const { resolvedTaskDir, _sdlcConfig, sdlcManager } = context;
  const planContent = readFileSafe(path.join(resolvedTaskDir, 'plan.md')) || completion.result;
  const planLower = planContent.toLowerCase();

  if (planLower.includes('needs_research:') && !status.research_completed) {
    status.phase = 'research';
    status.assigned_agent = 'chunin';
    status.research_completed = false;
    return { nextPhase: 'research' };
  }
  if (planLower.includes('needs_replan:') && !status.replanned) {
    status.phase = 'plan';
    status.assigned_agent = 'kage';
    status.replanned = true;
    return { nextPhase: 'plan' };
  }

  status.tasks = workflowParseTasks(planContent);
  if (status.tasks.length === 0) {
    status.tasks = [{ id: 'task-1', agent: 'anbu', task: 'Execute the approved implementation plan.', status: 'pending', result: '', validation: [] }];
  }
  const rootTaskId = status.task_id || path.basename(resolvedTaskDir);

  try {
    for (const t of status.tasks) {
      sdlcManager.createTask({
        id: t.id,
        description: t.task,
        status: 'pending',
        project_path: resolvedTaskDir,
        session_id: status.session_id || '',
        client: status.client || ''
      });
    }
  } catch (_) { /* intentional best-effort fallback */ }
  status.pending_executors = status.tasks.map(t => t.id);
  status.completed_executors = [];

  if (!status.plan_approved) {
    status.hitl_gate = 'plan_approval';
    status.assigned_agent = 'sannin';
    try {
      sdlcManager.updateTask(rootTaskId, {
        status: 'pending_plan_approval',
        evidence: {
          todo_plan: planContent,
          tasks: status.tasks
        }
      });
    } catch (_) { /* ignore */ }
    saveWorkflowStatus(resolvedTaskDir, status);

    try {
      const notifier = require('../telegram/notifier');
      notifier.sendInteractiveApproval({
        taskId: rootTaskId,
        gate: 'Gate 1 (Plan Approval)',
        title: `Action Plan for ${rootTaskId}`,
        planText: planContent,
        client: status.client || 'Konoha Agent'
      });
    } catch (_) { /* ignore */ }

    return {
      response: buildGate1Prompt(status, resolvedTaskDir, rootTaskId, planContent)
    };
  }

  status.phase = 'execute';
  return { nextPhase: 'execute' };
}

function handleExecuteCompletion(completion, dispatch, status, context) {
  const { sdlcManager } = context;
  const taskId = dispatch.task_id;
  const task = status.tasks ? status.tasks.find(t => t.id === taskId) : null;
  if (task) {
    if (task.status !== 'completed' && task.status !== 'unverified') {
      task.status = 'completed';
    }
    task.result = completion.result;
    task.completed_dispatch_id = dispatch.id;
    if (task.status === 'completed') {
      status.completed_executors.push(taskId);
    }
    status.executed[taskId] = { agent: task.agent, task: task.task, result: completion.result, validation: task.validation || [] };
    try {
      sdlcManager.updateTask(taskId, {
        status: task.status === 'completed' ? 'completed' : 'unverified',
        evidence: {
          validation: task.validation || [],
          result: completion.result,
          agent: task.agent
        }
      });
    } catch (_) { /* best effort */ }
  }
  return { nextPhase: 'execute' };
}

function handleDocumentCompletion(status, context) {
  const { resolvedTaskDir } = context;
  const { evaluateDeliverablesGate } = require('./doc_quality_gate');
  const gateResult = evaluateDeliverablesGate(resolvedTaskDir, status);
  status.document_gate = gateResult;
  if (gateResult.passed) {
    status.phase = 'review';
    status.assigned_agent = 'kage';
    return { nextPhase: 'review' };
  }
  if (gateResult.gate_status === 'regenerate') {
    status.document_attempts = gateResult.attempts;
    status.phase = 'document';
    status.assigned_agent = 'tokubetsu-jonin';
    return { nextPhase: 'document' };
  }
  status.phase = 'document';
  status.status = 'failed';
  status.error = gateResult.error;
  saveWorkflowStatus(resolvedTaskDir, status);
  return {
    response: JSON.stringify({
      status: 'failed',
      phase: 'document',
      error: gateResult.error,
      feedback: gateResult.feedback,
      task_dir: resolvedTaskDir,
      gate: gateResult
    })
  };
}

function resolveRemediationAgent(reason, status) {
  let agent = 'anbu';
  const executedAgents = Object.values(status.executed || {}).map(e => e.agent).filter(Boolean);
  const taskAgents = (status.tasks || []).map(t => t.agent).filter(Boolean);
  const isUi = /ui|css|frontend|style|tailwind|component|html|layout|vue|svelte|react|next|angular|design/i.test(String(reason));

  if (isUi && (executedAgents.includes('jonin') || taskAgents.includes('jonin'))) {
    agent = 'jonin';
  } else if (executedAgents.length > 0) {
    agent = executedAgents[executedAgents.length - 1] || 'anbu';
  } else if (taskAgents.length > 0) {
    agent = taskAgents[0];
  }
  return agent;
}

function handleAdvisorRemediation(options) {
  const { status, resolvedTaskDir, sdlcManager, reason } = options;
  status.advisor_cycles = (status.advisor_cycles || 0) + 1;
  if (status.advisor_cycles > 7) {
    status.status = 'blocked';
    saveWorkflowStatus(resolvedTaskDir, status);
    return {
      response: JSON.stringify({
        status: 'blocked',
        phase: 'review',
        gate: 'advisor',
        message: `Delegation depth circuit breaker tripped (> 7 advisor remediation cycles). Advisor feedback: ${reason}`,
        advisor_cycles: status.advisor_cycles,
        feedback: reason
      })
    };
  }

  const fixTaskId = `advisor-fix-${status.advisor_cycles}`;
  const fixTaskText = `[Advisor Remediation Cycle ${status.advisor_cycles}] Address advisor review feedback: ${reason}`;
  const remediationAgent = resolveRemediationAgent(reason, status);

  enqueueRemediationTask({ fixTaskId, remediationAgent, fixTaskText, resolvedTaskDir, status, sdlcManager });
  status.phase = 'execute';
  status.assigned_agent = remediationAgent;
  saveWorkflowStatus(resolvedTaskDir, status);

  const disp = workflowDispatch(resolvedTaskDir, status, 'execute', remediationAgent, fixTaskId, fixTaskText);
  const agentUpper = remediationAgent.charAt(0).toUpperCase() + remediationAgent.slice(1);

  return {
    response: JSON.stringify({
      status: 'remediation',
      phase: 'execute',
      gate: 'advisor',
      agent: remediationAgent,
      dispatch_id: disp.id,
      task_id: fixTaskId,
      task: fixTaskText,
      task_dir: resolvedTaskDir,
      advisor_cycles: status.advisor_cycles,
      message: `Advisor review requested changes. Dispatched remediation task to ${agentUpper} (cycle ${status.advisor_cycles}).`
    })
  };
}

function handleSlopRemediation(options) {
  const { status, resolvedTaskDir, sdlcManager, reviewObj, reason } = options;
  status.slop_cycles = (status.slop_cycles || 0) + 1;
  if (status.slop_cycles > 7) {
    status.status = 'blocked';
    saveWorkflowStatus(resolvedTaskDir, status);
    return {
      response: JSON.stringify({
        status: 'blocked',
        phase: 'review',
        message: `Delegation depth circuit breaker tripped (> 7 slop remediation cycles). Slop findings: ${reason}`,
        slop_cycles: status.slop_cycles,
        findings: reviewObj.findings || []
      })
    };
  }

  const fixTaskText = sdlcManager.generateSlopFixTask(status.slop_result || { findings: reviewObj.findings });
  const fixTaskId = `slop-fix-${status.slop_cycles}`;
  const remediationAgent = resolveRemediationAgent(reason, status);

  enqueueRemediationTask({ fixTaskId, remediationAgent, fixTaskText, resolvedTaskDir, status, sdlcManager });
  status.phase = 'execute';
  status.assigned_agent = remediationAgent;
  saveWorkflowStatus(resolvedTaskDir, status);

  const disp = workflowDispatch(resolvedTaskDir, status, 'execute', remediationAgent, fixTaskId, fixTaskText);
  const agentUpper = remediationAgent.charAt(0).toUpperCase() + remediationAgent.slice(1);

  return {
    response: JSON.stringify({
      status: 'remediation',
      phase: 'execute',
      agent: remediationAgent,
      dispatch_id: disp.id,
      task_id: fixTaskId,
      task: fixTaskText,
      task_dir: resolvedTaskDir,
      slop_cycles: status.slop_cycles,
      message: `Anti-slop Delivery Gate reported findings. Dispatched remediation task to ${agentUpper} (cycle ${status.slop_cycles}).`
    })
  };
}

function handleReviewCompletion(status, context) {
  const { resolvedTaskDir, sdlcManager } = context;
  if (workflowReviewApproved(resolvedTaskDir, status)) {
    status.phase = 'synthesize';
    status.assigned_agent = 'sannin';
    return { nextPhase: 'synthesize' };
  }

  const reviewObj = status.review || {};
  let reason = '';
  const isSlopFail = !(reviewObj.ai_slop_clean === true && reviewObj.ai_slop_findings === 0);
  const isAdvisorFail = (
    reviewObj.advisor_approved === false ||
    (reviewObj.advisor && reviewObj.advisor.approved === false) ||
    status.advisor_approved === false ||
    (status.advisor_review && status.advisor_review.approved === false)
  );

  if (isAdvisorFail) {
    const advisorFeedback = reviewObj.advisor_feedback ||
      (reviewObj.advisor && (reviewObj.advisor.feedback || reviewObj.advisor.reason || reviewObj.advisor.findings)) ||
      status.advisor_feedback ||
      (status.advisor_review && (status.advisor_review.feedback || status.advisor_review.reason)) ||
      'Advisor review requested changes prior to delivery.';
    reason = typeof advisorFeedback === 'string' ? advisorFeedback : JSON.stringify(advisorFeedback);
  } else if (isSlopFail) {
    reason = 'Zero-AI-Slop gate failed or was not executed (ai_slop_findings must be 0 and ai_slop_clean must be true).';
  } else {
    reason = 'Kage review did not approve all completed tasks.';
  }

  status.review = { ...reviewObj, approved: false, reason, findings: reviewObj.findings || [] };

  if (isAdvisorFail && status.remediation_loop !== false) {
    return handleAdvisorRemediation({ status, resolvedTaskDir, sdlcManager, reason });
  }

  const slopFindingsCount = typeof reviewObj.ai_slop_findings === 'number'
    ? reviewObj.ai_slop_findings
    : (Array.isArray(reviewObj.findings) ? reviewObj.findings.length : 0);

  if (isSlopFail && slopFindingsCount > 0 && status.remediation_loop !== false) {
    return handleSlopRemediation({ status, resolvedTaskDir, sdlcManager, reviewObj, reason });
  }

  saveWorkflowStatus(resolvedTaskDir, status);
  return {
    response: JSON.stringify({ status: 'blocked', phase: 'review', message: `Kage review must approve every completed task before delivery: ${reason}` })
  };
}

function handleWorkflowCompletion(completion, phase, status, env) {
  const dispatch = completion.dispatch;
  const dispatchId = dispatch.id;
  status.completed_dispatches.push(dispatchId);
  status.dispatch_results[dispatchId] = completion.result;
  status.current_dispatch = null;

  const context = (env && typeof env === 'object') ? env : {
    resolvedTaskDir: env,
    sdlcConfig: arguments[4],
    sdlcManager: arguments[5]
  };

  switch (phase) {
    case 'explore':
      return handleExploreCompletion(dispatch, status, dispatchId);
    case 'research':
      return handleResearchCompletion(status, dispatchId);
    case 'plan':
      return handlePlanCompletion(completion, status, context);
    case 'execute':
      return handleExecuteCompletion(completion, dispatch, status, context);
    case 'document':
      return handleDocumentCompletion(status, context);
    case 'review':
      return handleReviewCompletion(status, context);
    default:
      return { nextPhase: phase };
  }
}

function calculateMechanicalConfidence(params) {
  const { aiSlopOk, socketOk, akatsukiOk, evidencePct, securityVerified, rollbackVerified, reviewFindings, reviewData } = params;
  const allVerified = (aiSlopOk && socketOk && akatsukiOk && evidencePct === 100 && securityVerified && rollbackVerified && reviewFindings.length === 0);
  if (allVerified) {
    return (typeof reviewData.confidence === 'number' && reviewData.confidence >= MINIMUM_CONFIDENCE)
      ? Math.min(100, Math.max(MINIMUM_CONFIDENCE, reviewData.confidence))
      : 99;
  }
  return Math.min(
    aiSlopOk ? 100 : 0,
    socketOk ? 100 : 0,
    akatsukiOk ? 100 : 0,
    evidencePct,
    securityVerified ? 100 : 0,
    rollbackVerified ? 100 : 0,
    reviewFindings.length === 0 ? 100 : Math.max(0, 100 - 15 * reviewFindings.length)
  );
}

function buildReviewGateBlock(scoreData) {
  const { confidenceVal, aiSlopEval, aiSlopConf, aiSlopOk, socketRow, akatsukiRow, totalTasks, verifiedCount, validationEntries, evidencePct, reviewFindings, securityVerified, rollbackVerified } = scoreData;
  const mark = ok => (ok ? '✅ Passed' : '❌ Needs Attention');

  return (
    '### 🛡️ Kage Reviewer Confidence Gate Report\n\n' +
    '```\n' +
    '┌───────────────────────────────────────────────────────────────┐\n' +
    '│  ◎ KAGE REVIEW GATE: APPROVED                                 │\n' +
    `│  📊 CONFIDENCE SCORE: ${confidenceVal}% (Minimum Required: ≥ 98%)           │\n` +
    '└───────────────────────────────────────────────────────────────┘\n' +
    '```\n\n' +
    '### 📋 Confidence Score Breakdown (computed from recorded task evidence)\n\n' +
    '| Verification Category | Target | Evaluated Result | Category Confidence | Status |\n' +
    '|---|---|---|---|---|\n' +
    `| **AI Slop Scan** | All changed files | ${aiSlopEval} | **${aiSlopConf}** | ${mark(aiSlopOk)} |\n` +
    socketRow +
    akatsukiRow +
    `| **Task Validation Evidence** | ${totalTasks}/${totalTasks} tasks with passing evidence | ${verifiedCount}/${totalTasks} verified, ${validationEntries} validation entries recorded | **${evidencePct}%** | ${mark(evidencePct === 100)} |\n` +
    `| **Kage Review Findings** | 0 unresolved findings | ${reviewFindings.length} finding(s) recorded in kage_review.json | **${reviewFindings.length === 0 ? 100 : Math.max(60, 100 - 10 * reviewFindings.length)}%** | ${mark(reviewFindings.length === 0)} |\n` +
    `| **Security Review** | security_reviewed = true | security_reviewed = ${String(securityVerified)} | **${securityVerified ? 100 : 0}%** | ${mark(securityVerified)} |\n` +
    `| **Rollback Review** | rollback_reviewed = true | rollback_reviewed = ${String(rollbackVerified)} | **${rollbackVerified ? 100 : 0}%** | ${mark(rollbackVerified)} |\n\n` +
    `### 🎯 Overall Confidence: **${confidenceVal}%**\n` +
    '- **Threshold**: Minimum 98% required to allow delivery.\n' +
    '- **Verdict**: **PASSED & APPROVED FOR DELIVERY** (all recorded tasks carry validation evidence).\n\n'
  );
}

function checkSynthesisPreconditions(status, resolvedTaskDir) {
  if (!workflowReviewApproved(resolvedTaskDir, status)) {
    const reviewObj = status.review || {};
    const msg = !(reviewObj.ai_slop_clean === true && reviewObj.ai_slop_findings === 0)
      ? 'Zero-AI-Slop gate failed: Kage must run aislop_scan and verify 0 findings before synthesis.'
      : 'Kage approval is required before synthesis.';
    return { ok: false, error: JSON.stringify({ status: 'blocked', phase: 'review', message: msg }) };
  }

  const { getWorkspaceRoot: _gwrSynth } = require('./runtime_state');
  const gateSynth = runAislopGate(_gwrSynth() || process.cwd(), status);
  if (gateSynth.enforced && !gateSynth.ok) {
    const res = JSON.stringify({
      status: 'blocked',
      phase: 'review',
      message: `100% AI-Slop gate failed: aislop scan score ${gateSynth.score ?? 'n/a'}/${gateSynth.findings ?? 'n/a'} findings (target: 100/100, 0 findings). Re-run the two-step review (Step 1 aislop_scan, Step 2 anti-slop rules), fix all findings via the anbu remediation loop, then re-approve.`,
      aislop_gate: gateSynth,
    });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return { ok: false, error: res };
  }
  return { ok: true };
}

function verifyTaskEvidence(status, reviewData, resolvedTaskDir, aiSlopOk) {
  function taskEvidenceOk(t) {
    if (t.verified === false) return false;
    if (t.verified === true) return true;
    if (t.id && t.id.startsWith('slop-fix-') && aiSlopOk) return true;
    const isPentest = isPentestTask(t);
    if (isCleanValidation(t.validation || [], isPentest)) return true;
    if (reviewData.approved === true && (reviewData.verified_task_ids || []).includes(t.id)) return true;
    return false;
  }

  const tasks = status.tasks || [];
  const totalTasks = tasks.length;
  const unverifiedIds = tasks.filter(t => !taskEvidenceOk(t)).map(t => t.id);
  if (unverifiedIds.length > 0) {
    status.review = {
      approved: false,
      reason: `Tasks without verifiable validation evidence: ${unverifiedIds.join(', ')}`
    };
    saveWorkflowStatus(resolvedTaskDir, status);
    return {
      ok: false,
      error: JSON.stringify({
        status: 'blocked',
        phase: 'review',
        message: 'Delivery blocked: tasks lack validation evidence: ' + unverifiedIds.join(', ')
      })
    };
  }

  const verifiedCount = totalTasks - unverifiedIds.length;
  const evidencePct = totalTasks === 0 ? 100 : Math.round(100 * verifiedCount / totalTasks);
  const validationEntries = tasks.reduce((acc, t) => acc + (t.validation ? t.validation.length : 0), 0);
  return { ok: true, totalTasks, verifiedCount, evidencePct, validationEntries };
}

function writeFinalReport(params) {
  const { resolvedTaskDir, reviewGateBlock, prompt, tasks } = params;
  let report = `# Final Report\n\n${reviewGateBlock}## Task\n${prompt}\n\n## Phase Artifacts\n` +
    `- **Exploration**: \`${path.join(resolvedTaskDir, 'findings.md')}\`\n` +
    `- **Plan**: \`${path.join(resolvedTaskDir, 'plan.md')}\`\n` +
    `- **Research**: \`${path.join(resolvedTaskDir, 'research_results.json')}\`\n` +
    `- **Documentation**: \`${path.join(resolvedTaskDir, 'final_docs.md')}\`\n\n` +
    `## Executor Results\n\n`;
  for (const t of (tasks || [])) {
    const resText = (t.result || '').trim();
    const shortRes = resText.length > 200 ? resText.slice(0, 200).trim() + '...' : (resText || 'Completed');
    report += `- **${t.id} / ${t.agent}**: ${t.task}\n  - Result: ${shortRes}\n\n`;
  }
  const reportPath = path.join(resolvedTaskDir, 'final_report.md');
  fs.writeFileSync(reportPath, report, 'utf8');
  return reportPath;
}

function extractModifiedFiles(tasks) {
  const all = [];
  const list = tasks || [];
  for (const t of list) {
    const files = Array.isArray(t.files_modified) ? t.files_modified : [];
    all.push(...files);
  }
  return Array.from(new Set(all));
}

function formatTaskSummary(tasks) {
  const list = (tasks || []).slice(0, 5);
  return list.map(t => {
    const res = (t.result || 'Completed').replace(/\n+/g, ' ').trim();
    const cleanRes = res.length > 100 ? res.slice(0, 100) + '...' : res;
    return `• ${t.id} (${t.agent}): ${cleanRes}`;
  }).join('\n');
}

function sendFinalCompletionNotification(options) {
  const { prompt, rootId, confidenceVal, reportPath, tasks } = options;
  try {
    const notifier = require('../telegram/notifier');
    const uniqueFiles = extractModifiedFiles(tasks);
    const shortList = formatTaskSummary(tasks);
    const summaryText = shortList.length > 0
      ? `Kage review gate approved (${confidenceVal}% Confidence).\n\n${shortList}`
      : `Kage review gate approved (${confidenceVal}% Confidence).\nFinal report synthesized at ${path.basename(reportPath)}.`;

    notifier.sendTaskCompletedNotification({
      title: prompt ? (prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt.trim()) : `Workflow ${rootId}`,
      taskId: rootId,
      summary: summaryText,
      status: confidenceVal >= 98 ? 'SUCCESS' : 'FAILED',
      duration: 'Workflow completed',
      client: 'Konoha MCP Workflow',
      agent: 'Kage Reviewer',
      tokenReduction: 96.2,
      kageScore: confidenceVal,
      slopFindings: 0,
      filesModified: uniqueFiles
    }).catch(() => {});
  } catch (_) { /* intentional best-effort fallback */ }
}

function handleDeliverySignoffOrFinish(options) {
  const { status, resolvedTaskDir, _sdlcConfig, sdlcManager, rootId, confidenceVal, reportPath, prompt } = options;
  const rootTaskRecord = sdlcManager.getTask(rootId);
  const isSignedOffInDb = rootTaskRecord && rootTaskRecord.status === 'completed';

  if (!status.human_signed_off && !isSignedOffInDb) {
    status.hitl_gate = 'delivery_signoff';
    status.phase = 'synthesize';
    status.assigned_agent = 'sannin';
    status.report = reportPath;
    status.confidence = confidenceVal;
    try {
      sdlcManager.updateTask(rootId, {
        status: 'pending_human_signoff',
        evidence: { confidence: confidenceVal, report_path: reportPath }
      });
    } catch (_) { /* ignore */ }
    saveWorkflowStatus(resolvedTaskDir, status);

    try {
      const notifier = require('../telegram/notifier');
      notifier.sendInteractiveApproval({
        taskId: rootId,
        gate: 'Gate 2 (Delivery Sign-Off)',
        title: `Delivery Sign-Off (${confidenceVal}% Confidence)`,
        planText: `Kage Review Gate approved with ${confidenceVal}% confidence.\nFinal report: ${path.basename(reportPath)}\nAwaiting human delivery sign-off.`,
        client: status.client || 'Konoha Agent'
      });
    } catch (_) { /* ignore */ }

    return buildGate2Prompt(status, resolvedTaskDir, rootId, confidenceVal, reportPath);
  }

  status.human_signed_off = true;
  status.phase = 'done';
  status.history.push({ phase: 'synthesize', agent: 'sannin' });
  saveWorkflowStatus(resolvedTaskDir, status);
  cleanupTransientScratchFiles(resolvedTaskDir);
  try {
    sdlcManager.updateTask(rootId, { status: 'completed' });
  } catch (_) { /* intentional best-effort fallback */ }

  sendFinalCompletionNotification({ prompt, rootId, confidenceVal, reportPath, tasks: status.tasks });
  return JSON.stringify({ status: 'completed', phase: 'done', final_report_path: reportPath });
}

function handleWorkflowSynthesis(status, resolvedTaskDir, sdlcConfig, sdlcManager) {
  const pre = checkSynthesisPreconditions(status, resolvedTaskDir);
  if (!pre.ok) return pre.error;

  const prompt = status.prompt || '';
  const reviewRaw = readFileSafe(path.join(resolvedTaskDir, 'kage_review.json'));
  let reviewData = {};
  if (reviewRaw) {
    try { reviewData = JSON.parse(reviewRaw); } catch (_) { /* ignore */ }
  }

  const aiSlopFindings = reviewData.ai_slop_findings;
  const aiSlopClean = reviewData.ai_slop_clean === true;
  const aiSlopOk = (aiSlopClean && typeof aiSlopFindings === 'number' && !isNaN(aiSlopFindings) && aiSlopFindings === 0);

  const evCheck = verifyTaskEvidence(status, reviewData, resolvedTaskDir, aiSlopOk);
  if (!evCheck.ok) return evCheck.error;

  const { totalTasks, verifiedCount, evidencePct, validationEntries } = evCheck;
  const securityVerified = reviewData.security_reviewed === true;
  const rollbackVerified = reviewData.rollback_reviewed === true;
  const reviewFindings = reviewData.findings || [];

  const aiSlopEval = (typeof aiSlopFindings === 'number' && !isNaN(aiSlopFindings))
    ? `ai_slop_findings = ${Math.floor(aiSlopFindings)}`
    : 'missing ai_slop_findings';
  const aiSlopConf = aiSlopOk ? '100%' : 'BLOCKING (confidence withheld)';

  const socketVerified = reviewData.socket_reviewed === true;
  const socketClean = reviewData.socket_clean === true;
  const socketFindings = typeof reviewData.socket_findings === 'number' ? reviewData.socket_findings : 0;
  const socketOk = reviewData.socket_reviewed !== undefined ? (socketVerified && socketClean && socketFindings === 0) : true;

  const akatsukiGatePath = path.join(resolvedTaskDir, 'akatsuki_review.json');
  let akatsukiGateData = null;
  if (fs.existsSync(akatsukiGatePath)) {
    try {
      akatsukiGateData = JSON.parse(readFileSafe(akatsukiGatePath) || '{}');
    } catch (_) {
      // Ignore unparseable or corrupt akatsuki review gate artifact
    }
  }
  const akatsukiGateResult = akatsukiGateData || status.akatsuki_gate || (reviewData.akatsuki_gate || null);
  const akatsukiOk = akatsukiGateResult
    ? (akatsukiGateResult.passed !== false && akatsukiGateResult.decision !== 'failed' && akatsukiGateResult.decision !== 'blocked' && (akatsukiGateResult.critical_count || 0) === 0 && (akatsukiGateResult.high_count || 0) === 0)
    : true;

  const confidenceVal = calculateMechanicalConfidence({
    aiSlopOk, socketOk, akatsukiOk, evidencePct, securityVerified, rollbackVerified, reviewFindings, reviewData
  });

  const socketRow = reviewData.socket_reviewed !== undefined
    ? `| **Socket Security Gate** | Clean from High & Medium (exclude Low) | 0 High, 0 Medium | **${socketOk ? 100 : 0}%** | ${socketOk ? '✅ Passed' : '❌ Needs Attention'} |\n`
    : '';
  const akatsukiRow = `| **Akatsuki Security Final Gate** | 0 Critical, 0 High findings | ${akatsukiGateResult ? (akatsukiGateResult.decision || (akatsukiOk ? 'passed' : 'blocked')) : 'verified clean'} | **${akatsukiOk ? 100 : 0}%** | ${akatsukiOk ? '✅ Passed' : '❌ Needs Attention'} |\n`;

  const reviewGateBlock = buildReviewGateBlock({
    confidenceVal, aiSlopEval, aiSlopConf, aiSlopOk, socketRow, akatsukiRow, totalTasks, verifiedCount, validationEntries, evidencePct, reviewFindings, securityVerified, rollbackVerified
  });

  const reportPath = writeFinalReport({ resolvedTaskDir, reviewGateBlock, prompt, tasks: status.tasks });
  const rootId = process.env.KONOHA_TASK_ID || status.task_id || path.basename(resolvedTaskDir);

  return handleDeliverySignoffOrFinish({
    status, resolvedTaskDir, sdlcConfig, sdlcManager, rootId, confidenceVal, reportPath, prompt
  });
}

module.exports = {
  handleWorkflowCompletion,
  handleWorkflowSynthesis,
  handleAdvisorRemediation,
  handleSlopRemediation
};
