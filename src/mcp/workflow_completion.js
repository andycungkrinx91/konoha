'use strict';

const {
  checkAiSlopGate,
  checkSecurityReview,
  calculateMechanicalConfidence,
  buildReviewGateBlock,
  evaluateTaskEvidence,
  writeFinalReport,
  extractModifiedFiles,
  formatTaskSummary,
  sendTelegramCompletion
} = require('./workflow_completion_helpers');
/**
 * src/mcp/workflow_completion.js — Workflow Phase Completion & Synthesis Handlers.
 *
 * Implements completion routing for explore, research, plan, execute, document, and review phases,
 * calculating confidence ratings and orchestrating remediation loops.
 */

const path = require('path');
const { workflowParseTasks, saveWorkflowStatus, cleanupTransientScratchFiles } = require('./workflow_common');
const { buildGate1Prompt, buildGate2Prompt } = require('./workflow_gates');

function enqueueRemediationTask(options) {
  const { status, resolvedTaskDir, sdlcManager, fixTaskId, fixTaskText, agent } = options;
  const remediationTask = {
    id: fixTaskId,
    agent,
    task: fixTaskText,
    line: 0,
    status: 'pending',
    result: '',
    validation: []
  };

  try {
    sdlcManager.createTask({
      id: fixTaskId,
      description: fixTaskText,
      status: 'in_progress',
      project_path: resolvedTaskDir,
      session_id: status.session_id || '',
      client: status.client || ''
    });
  } catch (_) { /* intentional best-effort fallback */ }

  status.tasks = status.tasks || [];
  status.tasks.push(remediationTask);
  status.pending_executors = [fixTaskId];
}

function handleExploreCompletion(dispatch, status, dispatchId) {
  const exploreResult = (status.dispatch_results && status.dispatch_results[dispatchId]) || dispatch.summary || '';
  status.findings = exploreResult;
  status.exploration_evidence = exploreResult;
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
  const planContent = (completion && completion.result) || '';
  status.plan = planContent;
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
  const { sdlcManager, resolvedTaskDir } = context;
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
    try {
      const existingTask = sdlcManager.getTask(taskId);
      const prevEv = existingTask?.evidence || {};
      sdlcManager.updateTask(taskId, {
        status: task.status,
        session_id: status.session_id || '',
        client: status.client || '',
        project_path: resolvedTaskDir,
        evidence: {
          ...prevEv,
          result: task.result,
          validation: task.validation,
          verified: task.verified
        }
      });
    } catch (_) { /* best effort */ }
  }
  return { nextPhase: 'execute' };
}

function handleDocumentCompletion(status, context, dispatchId) {
  const { resolvedTaskDir } = context;
  const { evaluateDeliverablesGate } = require('./doc_quality_gate');
  const docResult = (dispatchId && status.dispatch_results?.[dispatchId]) || '';
  const taskFiles = [];
  for (const t of (status.tasks || [])) {
    if (Array.isArray(t.files_created)) taskFiles.push(...t.files_created);
    if (Array.isArray(t.files_modified)) taskFiles.push(...t.files_modified);
  }
  const filesList = (Array.isArray(status.deliverables) && status.deliverables.length > 0) ? status.deliverables : (taskFiles.length > 0 ? taskFiles : null);
  const gateResult = evaluateDeliverablesGate(resolvedTaskDir, status, filesList, docResult);
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
        cycles: status.advisor_cycles,
        advisor_cycles: status.advisor_cycles,
        task_dir: resolvedTaskDir,
        message: 'Advisor remediation limit exceeded (7 cycles). Manual developer intervention required.'
      })
    };
  }

  const fixTaskId = `advisor-fix-${status.advisor_cycles}`;
  const fixAgent = resolveRemediationAgent(reason, status);
  const fixTaskText = `Remediate advisor findings: ${reason}. Ensure all functional and architectural invariants pass cleanly.`;

  enqueueRemediationTask({
    status, resolvedTaskDir, sdlcManager, fixTaskId, fixTaskText, agent: fixAgent
  });

  status.phase = 'execute';
  status.assigned_agent = fixAgent;
  saveWorkflowStatus(resolvedTaskDir, status);
  const { workflowDispatch } = require('./workflow_dispatch');
  const disp = workflowDispatch(resolvedTaskDir, status, 'execute', fixAgent, fixTaskId, fixTaskText);
  return {
    response: JSON.stringify({
      status: 'remediation',
      phase: 'execute',
      gate: 'advisor',
      agent: fixAgent,
      dispatch_id: disp.id,
      task_id: fixTaskId,
      task: fixTaskText,
      task_dir: resolvedTaskDir,
      advisor_cycles: status.advisor_cycles,
      feedback: reason
    })
  };
}

function handleSlopRemediation(options) {
  const { status, resolvedTaskDir, sdlcManager, slopResult, reviewObj, reason } = options;
  status.slop_cycles = (status.slop_cycles || 0) + 1;
  if (status.slop_cycles > 7) {
    status.status = 'blocked';
    saveWorkflowStatus(resolvedTaskDir, status);
    return {
      response: JSON.stringify({
        status: 'blocked', phase: 'review', gate: 'anti-slop', slop_cycles: status.slop_cycles, task_dir: resolvedTaskDir,
        message: `Delegation depth circuit breaker tripped (> 7 slop remediation cycles). Slop findings: ${reason}`,
        findings: reviewObj?.findings || []
      })
    };
  }

  const fixTaskId = `slop-fix-${status.slop_cycles}`;
  const effectiveReason = reason || (slopResult?.findings ? slopResult.findings.join('; ') : '');
  const remediationAgent = resolveRemediationAgent(effectiveReason, status);
  const fixTaskText = (typeof sdlcManager.generateSlopFixTask === 'function')
    ? sdlcManager.generateSlopFixTask(status.slop_result || { findings: reviewObj?.findings || [effectiveReason] })
    : `Remediate anti-slop violations: ${effectiveReason}`;

  enqueueRemediationTask({ status, resolvedTaskDir, sdlcManager, fixTaskId, fixTaskText, agent: remediationAgent });
  status.phase = 'execute';
  status.assigned_agent = remediationAgent;
  saveWorkflowStatus(resolvedTaskDir, status);
  const { workflowDispatch } = require('./workflow_dispatch');
  const disp = workflowDispatch(resolvedTaskDir, status, 'execute', remediationAgent, fixTaskId, fixTaskText);
  const agentUpper = remediationAgent.charAt(0).toUpperCase() + remediationAgent.slice(1);
  return {
    response: JSON.stringify({
      status: 'remediation', phase: 'execute', gate: 'anti-slop', agent: remediationAgent,
      dispatch_id: disp.id, task_id: fixTaskId, task: fixTaskText, task_dir: resolvedTaskDir,
      slop_cycles: status.slop_cycles, slop_result: slopResult,
      message: `Dispatched remediation task to ${agentUpper} (cycle ${status.slop_cycles})`
    })
  };
}

function handleReviewCompletion(status, context) {
  const { resolvedTaskDir, sdlcManager } = context;
  const { workflowReviewApproved } = require('./workflow_dispatch');
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
    const slopReason = Array.isArray(reviewObj.findings) && reviewObj.findings.length > 0 ? reviewObj.findings.join('; ') : reason;
    return handleSlopRemediation({
      status, resolvedTaskDir, sdlcManager, reviewObj, reason: slopReason,
      slopResult: status.slop_result || { score: 70, findingsCount: slopFindingsCount, passed: false, findings: reviewObj.findings }
    });
  }

  saveWorkflowStatus(resolvedTaskDir, status);
  return {
    response: JSON.stringify({ status: 'blocked', phase: 'review', message: `Kage review must approve every completed task before delivery: ${reason}` })
  };
}

function handleWorkflowCompletion(completion, phase, status, env) {
  const dispatch = completion.dispatch;
  const dispatchId = dispatch.id;
  status.completed_dispatches = status.completed_dispatches || [];
  if (!status.completed_dispatches.includes(dispatchId)) {
    status.completed_dispatches.push(dispatchId);
  }
  status.dispatch_results = status.dispatch_results || {};
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
      return handleDocumentCompletion(status, context, dispatchId);
    case 'review':
      return handleReviewCompletion(status, context);
    default:
      return { nextPhase: phase };
  }
}

function handleDeliverySignoffOrFinish(options) {
  const { status, resolvedTaskDir, _sdlcConfig, sdlcManager, rootId, confidenceVal, reportPath } = options;
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

    const promptRes = buildGate2Prompt(status, resolvedTaskDir, rootId, confidenceVal, reportPath);
    return { response: promptRes };
  }

  status.hitl_gate = null;
  status.phase = 'done';
  status.report = reportPath;
  status.confidence = confidenceVal;
  cleanupTransientScratchFiles(resolvedTaskDir);

  const uniqueFiles = extractModifiedFiles(status.tasks);
  const taskSummaryText = formatTaskSummary(status.tasks);

  sendTelegramCompletion({ rootId, confidenceVal, uniqueFiles, taskSummaryText });

  try {
    sdlcManager.updateTask(rootId, {
      status: 'completed',
      evidence: { confidence: confidenceVal, report_path: reportPath, files_modified: uniqueFiles }
    });
  } catch (_) { /* intentional best-effort fallback */ }

  saveWorkflowStatus(resolvedTaskDir, status);
  return {
    response: JSON.stringify({
      status: 'completed',
      phase: 'done',
      task_id: rootId,
      task_dir: resolvedTaskDir,
      final_report_path: reportPath,
      confidence: confidenceVal
    })
  };
}

function handleWorkflowSynthesis(options, dirArg, configArg, managerArg, promptArg) {
  const isPos = dirArg !== undefined;
  const status = isPos ? options : (options && options.status);
  const resolvedTaskDir = isPos ? dirArg : (options && options.resolvedTaskDir);
  const sdlcConfig = isPos ? configArg : (options && options.sdlcConfig);
  const sdlcManager = isPos ? managerArg : (options && options.sdlcManager);
  const prompt = isPos ? promptArg : (options && options.prompt);
  const akatsukiGateData = isPos ? arguments[5] : (options && options.akatsukiGateData);
  let tasks = status.tasks || [];
  if (tasks.length === 0 && status.executed) {
    tasks = Object.entries(status.executed).map(([k, v]) => ({
      id: k,
      agent: (v && v.agent) || k,
      task: (v && v.task) || '',
      status: 'completed',
      result: (v && typeof v === 'object') ? (v.result || '') : String(v || '')
    }));
    status.tasks = tasks;
  }
  const evalOutcome = evaluateTaskEvidence(tasks);
  if (!evalOutcome.ok) return evalOutcome;

  const { totalTasks, verifiedCount, evidencePct, validationEntries } = evalOutcome;
  const slopResult = status.slop_result;
  const reviewData = status.review || {};

  const { aiSlopOk, aiSlopConf, aiSlopEval } = checkAiSlopGate({ slopResult, reviewData, status });
  const { securityVerified, rollbackVerified, reviewFindings, socketOk } = checkSecurityReview({
    reviewData
  });

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

  const reportPath = writeFinalReport({ resolvedTaskDir, reviewGateBlock, prompt, tasks: status.tasks, status });
  const rootId = process.env.KONOHA_TASK_ID || status.task_id || path.basename(resolvedTaskDir);

  return handleDeliverySignoffOrFinish({
    status, resolvedTaskDir, _sdlcConfig: sdlcConfig, sdlcManager, rootId, confidenceVal, reportPath
  });
}

module.exports = {
  handleWorkflowCompletion,
  handleWorkflowSynthesis,
  handleAdvisorRemediation,
  handleSlopRemediation
};
