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

function workflowDispatch(taskDir, status, phase, agent, taskId = null, task = null) {
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

function workflowReviewApproved(taskDir, status) {
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

  if (tasks.length === 0 || tasks.some(t => t.status !== 'completed')) return false;

  for (const t of tasks) {
    if (t.verified === false) return false;
    const isPentest = isPentestTask(t);
    if (!isCleanValidation(t.validation || [], isPentest)) return false;
  }

  const reviewPath = path.join(taskDir, 'kage_review.json');
  if (fs.existsSync(reviewPath)) {
    try {
      const review = JSON.parse(readFileSafe(reviewPath) || '{}');
      const reviewValidation = review.validation || review.validation_evidence || [];
      const verifiedTasks = new Set(review.verified_task_ids || []);
      const expectedTasks = new Set(tasks.map(t => t.id));
      const securityVerified = review.security_reviewed === true;
      const rollbackVerified = review.rollback_reviewed === true;

      let categoriesPass = true;
      if (review.categories && typeof review.categories === 'object') {
        for (const val of Object.values(review.categories)) {
          const score = typeof val === 'number' ? val : (val && typeof val.confidence === 'number' ? val.confidence : null);
          if (typeof score === 'number' && score < 98) {
            categoriesPass = false;
            break;
          }
        }
      }

      const isPentestReview = tasks.some(t => isPentestTask(t)) || reviewValidation.some(item => String(item).toLowerCase().includes('pentest'));
      const cleanValidation = reviewValidation.length > 0 && isCleanValidation(reviewValidation, isPentestReview, false);

      const aiSlopFindings = review.ai_slop_findings;
      const aiSlopClean = review.ai_slop_clean === true;
      const aiSlopPass = (
        aiSlopClean &&
        typeof aiSlopFindings === 'number' &&
        !isNaN(aiSlopFindings) &&
        aiSlopFindings === 0
      );

      const advisorPass = review.advisor_approved !== false &&
        (review.advisor ? review.advisor.approved !== false : true) &&
        status.advisor_approved !== false &&
        (status.advisor_review ? status.advisor_review.approved !== false : true);

      const mechanicalConfidence = (aiSlopPass && advisorPass && cleanValidation && securityVerified && rollbackVerified && categoriesPass && (review.findings || []).length === 0)
        ? (typeof review.confidence === 'number' && review.confidence >= MINIMUM_CONFIDENCE ? Math.min(100, Math.max(MINIMUM_CONFIDENCE, review.confidence)) : 99)
        : Math.min(
            aiSlopPass ? 100 : 0,
            cleanValidation ? 100 : 0,
            securityVerified ? 100 : 0,
            rollbackVerified ? 100 : 0,
            (review.findings || []).length === 0 ? 100 : Math.max(0, 100 - 15 * (review.findings || []).length)
          );
      const confidence = mechanicalConfidence;
      const confidencePass = typeof confidence === 'number' && !isNaN(confidence) && confidence >= MINIMUM_CONFIDENCE;

      status.review = review;
      try {
        const sdlcManager = require('../sdlc_manager');
        const slopGate = sdlcManager.evaluateAntiSlopDeliveryGate(review);
        status.slop_result = slopGate;
        const rootTaskId = path.basename(taskDir || '');
        if (rootTaskId) {
          sdlcManager.recordSlopResult(rootTaskId, slopGate, status.slop_cycles || 0);
        }
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

      for (const t of tasks) {
        if (t.id && t.id.startsWith('slop-fix-') && aiSlopPass) {
          verifiedTasks.add(t.id);
        }
        if (t.id && t.id.startsWith('advisor-fix-') && advisorPass) {
          verifiedTasks.add(t.id);
        }
      }

      const tasksMatch = Array.from(expectedTasks).every(id => verifiedTasks.has(id));

      let sdlcTasksComplete = true;
      try {
        const sdlcMgr = require('../sdlc_manager');
        const rootTaskId = status.task_id || path.basename(taskDir);
        if (rootTaskId) {
          const rootTask = sdlcMgr.getTask(rootTaskId);
          if (rootTask && (rootTask.status === 'blocked' || rootTask.status === 'failed')) {
            sdlcTasksComplete = false;
          }
        }
        for (const t of tasks) {
          if (t.id && t.id !== rootTaskId) {
            if (t.status !== 'completed') {
              sdlcTasksComplete = false;
              break;
            }
            const st = sdlcMgr.getTask(t.id);
            if (st && st.status !== 'completed') {
              sdlcTasksComplete = false;
              break;
            }
          }
        }
      } catch (_) { /* intentional best-effort fallback */ }

      // Akatsuki Security Final Gate Check (Fail-Closed)
      const akatsukiPath = path.join(taskDir, 'akatsuki_review.json');
      let akatsukiGatePass = true;
      if (fs.existsSync(akatsukiPath)) {
        try {
          const akatsukiReview = JSON.parse(readFileSafe(akatsukiPath) || '{}');
          if (akatsukiReview.gate_decision === 'blocked' || akatsukiReview.gate_decision === 'failed' || akatsukiReview.status === 'blocked') {
            akatsukiGatePass = false;
          }
          if ((akatsukiReview.critical_count || 0) > 0 || (akatsukiReview.high_count || 0) > 0) {
            akatsukiGatePass = false;
          }
        } catch (_) {
          akatsukiGatePass = false;
        }
      } else if (review.akatsuki_reviewed !== undefined) {
        akatsukiGatePass = review.akatsuki_reviewed === true;
      } else if (status.akatsuki_gate) {
        akatsukiGatePass = status.akatsuki_gate.passed !== false;
      }

      if (review.approved === true && advisorPass && cleanValidation && tasksMatch && sdlcTasksComplete && securityVerified && rollbackVerified && confidencePass && aiSlopPass && categoriesPass && akatsukiGatePass) {
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  const review = status.review || {};
  const confidence = review.confidence !== undefined ? review.confidence : (review.confidence_score !== undefined ? review.confidence_score : 0);
  const confidencePass = typeof confidence === 'number' && !isNaN(confidence) && confidence >= MINIMUM_CONFIDENCE;
  let categoriesPass = true;
  if (review.categories && typeof review.categories === 'object') {
    for (const val of Object.values(review.categories)) {
      const score = typeof val === 'number' ? val : (val && typeof val.confidence === 'number' ? val.confidence : null);
      if (typeof score === 'number' && score < 98) {
        categoriesPass = false;
        break;
      }
    }
  }
  const aiSlopFindings = review.ai_slop_findings;
  const aiSlopClean = review.ai_slop_clean === true;
  const aiSlopPass = (
    aiSlopClean &&
    typeof aiSlopFindings === 'number' &&
    !isNaN(aiSlopFindings) &&
    aiSlopFindings === 0
  );

  const advisorPass = review.advisor_approved !== false &&
    (review.advisor ? review.advisor.approved !== false : true) &&
    status.advisor_approved !== false &&
    (status.advisor_review ? status.advisor_review.approved !== false : true);

  const akatsukiGatePass = status.akatsuki_gate ? status.akatsuki_gate.passed !== false : true;

  return review.approved === true && advisorPass && confidencePass && aiSlopPass && categoriesPass && akatsukiGatePass && (status.tasks || []).every(t => t.status === 'completed');
}

module.exports = {
  runAislopGate,
  workflowDispatch,
  workflowDispatchCompleted,
  workflowReviewApproved
};
