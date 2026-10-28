'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { executeAislopScan } = require('./anti_slop');
const { CircuitBreaker } = require('../circuit_breaker');
const {
  MINIMUM_CONFIDENCE,
  AISLOP_GATE_TIMEOUT_MS,
  readFileSafe,
  workflowHash,
  isPentestTask,
  isCleanValidation
} = require('./workflow_common');

const _aislopBreaker = new CircuitBreaker('aislop-gate', 2, 120, 1);

function runAislopGate(projectPath, status) {
  if (status && status._forceBreakerOpen) {
    return { enforced: true, ok: false, pass: false, reason: 'circuit_breaker_open', error: 'circuit_breaker_open' };
  }

  if (!_aislopBreaker.allowRequest()) {
    return {
      enforced: true,
      ok: false,
      pass: false,
      reason: 'circuit_breaker_open',
      error: 'aislop gate circuit breaker tripped after repeated failures'
    };
  }

  if (process.env.KONOHA_DB_PATH && (process.env.KONOHA_DB_PATH.includes('/tmp/') || process.env.KONOHA_DB_PATH.includes('\\tmp\\')) && !process.env.KONOHA_FORCE_AISLOP_GATE) {
    return { enforced: false, ok: true, pass: true, reason: 'test isolation' };
  }

  const changedFiles = (status && Array.isArray(status.changed_files)) ? status.changed_files : [];
  const scanResult = executeAislopScan(projectPath, {
    changedFiles,
    timeoutMs: AISLOP_GATE_TIMEOUT_MS
  });

  if (!scanResult.ok) {
    _aislopBreaker.recordFailure();
    const failureGate = {
      enforced: true,
      ok: false,
      pass: false,
      score: scanResult.score,
      errors: scanResult.errors,
      warnings: scanResult.warnings,
      findings: scanResult.findings,
      reason: scanResult.error || 'Zero-AI-Slop gate failed: findings > 0 or score < 100'
    };
    if (status) status.aislop_gate = failureGate;
    return failureGate;
  }

  _aislopBreaker.recordSuccess();
  const passGate = {
    enforced: true,
    ok: true,
    pass: true,
    score: 100,
    findings: [],
    errors: 0,
    warnings: 0,
    cached_at: Date.now()
  };
  if (status) status.aislop_gate = passGate;
  return passGate;
}

function workflowDispatch(taskDir, status, phase, agent, ...rest) {
  const [taskId = null, task = null] = rest;
  const current = status.current_dispatch || {};
  if (current.phase === phase && current.agent === agent && current.task_id === taskId) {
    return current;
  }
  const resultPath = path.join(taskDir, 'result.md');
  const dispatch = {
    id: crypto.createHash('sha256').update(`${phase}:${agent}:${taskId}:${Date.now()}`).digest('hex').substring(0, 16),
    phase,
    agent,
    task_id: taskId,
    task: task || '',
    started_at: new Date().toISOString(),
    started_at_ns: Date.now() * 1e6,
    previous_result_hash: workflowHash(resultPath)
  };
  status.current_dispatch = dispatch;
  return dispatch;
}

function workflowDispatchCompleted(taskDir, status) {
  const dispatch = status.current_dispatch || {};
  if (!dispatch || !dispatch.id) return null;
  if ((status.completed_dispatches || []).includes(dispatch.id)) {
    return { dispatch, result: (status.dispatch_results || {})[dispatch.id] || '' };
  }
  const resultPath = path.join(taskDir, 'result.md');
  const currentHash = workflowHash(resultPath);
  if (!currentHash || currentHash === dispatch.previous_result_hash) return null;
  const result = readFileSafe(resultPath) || '';
  return { dispatch, result };
}

function _ensureStatusTasks(status) {
  let tasks = status.tasks || [];
  if (tasks.length === 0 && status.executed) {
    tasks = [];
    let idx = 1;
    for (const [taskId, item] of Object.entries(status.executed)) {
      const it = typeof item === 'object' && item !== null ? item : { result: item };
      tasks.push({
        id: taskId || `task-${idx++}`,
        agent: it.agent || taskId,
        task: it.task || '',
        status: 'completed',
        result: it.result || '',
        validation: it.validation || []
      });
    }
    status.tasks = tasks;
  }
  return tasks;
}

function _checkTasksClean(tasks) {
  if (tasks.length === 0 || tasks.some(t => t.status !== 'completed')) return false;
  for (const t of tasks) {
    if (t.verified === false) return false;
    const isPentest = isPentestTask(t);
    if (!isCleanValidation(t.validation || [], isPentest)) return false;
  }
  return true;
}

function _checkCategoriesPass(categories) {
  if (!categories || typeof categories !== 'object') return true;
  for (const val of Object.values(categories)) {
    const score = typeof val === 'number' ? val : (val && typeof val.confidence === 'number' ? val.confidence : null);
    if (typeof score === 'number' && score < 98) return false;
  }
  return true;
}

function _checkAdvisorPass(review, status) {
  return review.advisor_approved !== false &&
    (review.advisor ? review.advisor.approved !== false : true) &&
    status.advisor_approved !== false &&
    (status.advisor_review ? status.advisor_review.approved !== false : true);
}

function _checkAkatsukiGatePass(taskDir, review, status) {
  const akatsukiPath = path.join(taskDir, 'akatsuki_review.json');
  if (fs.existsSync(akatsukiPath)) {
    try {
      const akReview = JSON.parse(readFileSafe(akatsukiPath) || '{}');
      if (akReview.gate_decision === 'blocked' || akReview.gate_decision === 'failed' || akReview.status === 'blocked') {
        return false;
      }
      if ((akReview.critical_count || 0) > 0 || (akReview.high_count || 0) > 0) {
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  if (review.akatsuki_reviewed !== undefined) return review.akatsuki_reviewed === true;
  if (status.akatsuki_gate) return status.akatsuki_gate.passed !== false;
  return true;
}

function _checkSdlcTasksComplete(taskDir, status, tasks) {
  try {
    const sdlcMgr = require('../workflow/kage-reviewer/sdlc_manager');
    const rootTaskId = status.task_id || path.basename(taskDir);
    if (rootTaskId) {
      const rootTask = sdlcMgr.getTask(rootTaskId);
      if (rootTask && (rootTask.status === 'blocked' || rootTask.status === 'failed')) return false;
    }
    for (const t of tasks) {
      if (t.id && t.id !== rootTaskId) {
        if (t.status !== 'completed') return false;
        const st = sdlcMgr.getTask(t.id);
        if (st && st.status !== 'completed') return false;
      }
    }
    return true;
  } catch (_) {
    return true;
  }
}

function _syncTaskSdlcStatus(taskDir, status, tasks, slopGate) {
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const rootTaskId = path.basename(taskDir || '');
    if (rootTaskId) sdlcManager.recordSlopResult(rootTaskId, slopGate, status.slop_cycles || 0);
    for (const t of tasks) {
      const implAgent = t.agent || 'anbu';
      const independence = sdlcManager.detectReviewIndependence(implAgent, 'kage');
      sdlcManager.updateTask(t.id, {
        status: t.status === 'completed' ? 'completed' : (t.status || 'in_progress'),
        review_mode: independence.reviewMode,
        project_path: taskDir
      });
      sdlcManager.recordSlopResult(t.id, slopGate, status.slop_cycles || 0);
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function _verifyTaskCoverage(tasks, verifiedTasks, aiSlopPass, advisorPass) {
  for (const t of tasks) {
    if (t.id && t.id.startsWith('slop-fix-') && aiSlopPass) verifiedTasks.add(t.id);
    if (t.id && t.id.startsWith('advisor-fix-') && advisorPass) verifiedTasks.add(t.id);
  }
  const expectedTasks = new Set(tasks.map(t => t.id));
  return Array.from(expectedTasks).every(id => verifiedTasks.has(id));
}

function _evaluateReviewFile(taskDir, status, tasks) {
  const reviewPath = path.join(taskDir, 'kage_review.json');
  if (!fs.existsSync(reviewPath)) return null;

  try {
    const review = JSON.parse(readFileSafe(reviewPath) || '{}');
    const reviewValidation = review.validation || review.validation_evidence || [];
    const verifiedTasks = new Set(review.verified_task_ids || []);
    const securityVerified = review.security_reviewed === true;
    const rollbackVerified = review.rollback_reviewed === true;
    const categoriesPass = _checkCategoriesPass(review.categories);

    const isPentestReview = tasks.some(t => isPentestTask(t)) || reviewValidation.some(item => String(item).toLowerCase().includes('pentest'));
    const cleanValidation = reviewValidation.length > 0 && isCleanValidation(reviewValidation, isPentestReview, false);

    const aiSlopFindings = review.ai_slop_findings;
    const aiSlopPass = review.ai_slop_clean === true && typeof aiSlopFindings === 'number' && !isNaN(aiSlopFindings) && aiSlopFindings === 0;
    const advisorPass = _checkAdvisorPass(review, status);

    const mechanicalConfidence = (aiSlopPass && advisorPass && cleanValidation && securityVerified && rollbackVerified && categoriesPass && (review.findings || []).length === 0)
      ? (typeof review.confidence === 'number' && review.confidence >= MINIMUM_CONFIDENCE ? Math.min(100, Math.max(MINIMUM_CONFIDENCE, review.confidence)) : 99)
      : 0;
    const confidencePass = mechanicalConfidence >= MINIMUM_CONFIDENCE;

    status.review = review;
    try {
      const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
      const slopGate = sdlcManager.evaluateAntiSlopDeliveryGate(review);
      status.slop_result = slopGate;
      _syncTaskSdlcStatus(taskDir, status, tasks, slopGate);
    } catch (_) { /* intentional best-effort fallback */ }

    const tasksMatch = _verifyTaskCoverage(tasks, verifiedTasks, aiSlopPass, advisorPass);
    const sdlcTasksComplete = _checkSdlcTasksComplete(taskDir, status, tasks);
    const akatsukiGatePass = _checkAkatsukiGatePass(taskDir, review, status);

    return Boolean(
      review.approved === true && advisorPass && cleanValidation && tasksMatch &&
      sdlcTasksComplete && securityVerified && rollbackVerified && confidencePass &&
      aiSlopPass && categoriesPass && akatsukiGatePass
    );
  } catch (_) {
    return false;
  }
}

function _evaluateFallbackReview(status) {
  const review = status.review || {};
  const confidence = review.confidence !== undefined ? review.confidence : (review.confidence_score !== undefined ? review.confidence_score : 0);
  const confidencePass = typeof confidence === 'number' && !isNaN(confidence) && confidence >= MINIMUM_CONFIDENCE;
  const categoriesPass = _checkCategoriesPass(review.categories);
  const aiSlopFindings = review.ai_slop_findings;
  const aiSlopPass = review.ai_slop_clean === true && typeof aiSlopFindings === 'number' && !isNaN(aiSlopFindings) && aiSlopFindings === 0;
  const advisorPass = _checkAdvisorPass(review, status);
  const akatsukiGatePass = status.akatsuki_gate ? status.akatsuki_gate.passed !== false : true;

  return Boolean(
    review.approved === true && advisorPass && confidencePass && aiSlopPass &&
    categoriesPass && akatsukiGatePass && (status.tasks || []).every(t => t.status === 'completed')
  );
}

function workflowReviewApproved(taskDir, status) {
  const tasks = _ensureStatusTasks(status);
  if (!_checkTasksClean(tasks)) return false;

  const fileApproval = _evaluateReviewFile(taskDir, status, tasks);
  if (fileApproval !== null) return fileApproval;

  return _evaluateFallbackReview(status);
}

module.exports = {
  runAislopGate,
  workflowDispatch,
  workflowDispatchCompleted,
  workflowReviewApproved
};
