'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { runAislopGate } = require('../../workflow_dispatch');
const { applyGate2Choice, buildGate2Prompt, parseGateChoice } = require('../../workflow_gates');
const sdlcManager = require('../../../workflow/kage-reviewer/sdlc_manager');
const { superviseLifecycleStage } = require('../../../workflow/kage-reviewer/advisor_monitor');
const { runAkatsukiFinalGate, _evaluateAkatsukiReview } = require('../../../workflow/akatsuki/workflows');
const { finalizeNodeResult } = require('../budget');

function createPassResult(status, taskDir, state, payload) {
  status.human_signed_off = true;
  status.hitl_gate = null;
  status.phase = 'done';
  status.gateVerdict = 'pass';
  if (taskDir) saveWorkflowStatus(taskDir, status);

  const resPayload = {
    status,
    phase: 'done',
    gateVerdict: 'pass',
    hitlPending: false,
    hitlStage: null,
    hitlChoice: null,
    hitlRefinement: null,
  };
  return finalizeNodeResult(state, resPayload, 'node_complete', { source: payload });
}

const AKATSUKI_VERDICTS = Object.freeze(['passed', 'blocked', 'failed', 'error', 'skipped_violation', 'not_applicable']);

/** A cached gate is only meaningful when it names a verdict this gate understands. */
function isRecognizedAkatsukiGate(gate) {
  if (!gate || typeof gate !== 'object') return false;
  if (!AKATSUKI_VERDICTS.includes(gate.decision)) return false;
  if (typeof gate.passed !== 'boolean') return false;
  return true;
}

function _evaluateAkatsukiPreGate(state, status, projectPath, taskDir) {
  // A cached review may arrive in either shape: the raw blue-team report
  // (`akatsuki_review`, uses `gate_decision`) or the normalized gate
  // (`akatsuki_gate`, uses `decision`). Reading either verbatim and then testing
  // `decision` silently treated a BLOCKED review as a pass (fail-open). Keep the
  // presence info but always normalize through _evaluateAkatsukiReview.
  const cachedReview = state.akatsukiReview || status.akatsuki_review || null;
  // `akatsuki_gate` is what execute persists as the authoritative normalized verdict;
  // `akatsuki_final_gate` is the same shape under a different key. Both outrank a raw report.
  const cachedGate = state.akatsukiGate || status.akatsuki_gate || status.akatsuki_final_gate || null;
  let akatsukiGate = null;
  if (cachedGate) {
    // A cached object is only trusted when it carries a recognizable verdict. An
    // empty/partial object would otherwise satisfy the permissive pass check below
    // (`undefined !== false`), turning missing security evidence into a pass.
    akatsukiGate = isRecognizedAkatsukiGate(cachedGate)
      ? cachedGate
      : {
          decision: 'error',
          mode: 'blue',
          passed: false,
          error: `Unrecognized cached Akatsuki gate shape: ${JSON.stringify(cachedGate).slice(0, 200)}`,
        };
  } else if (cachedReview) {
    try {
      akatsukiGate = _evaluateAkatsukiReview(cachedReview);
    } catch (err) {
      // Unreadable security evidence must not authorize delivery.
      akatsukiGate = {
        decision: 'error',
        mode: 'blue',
        passed: false,
        error: `Malformed cached Akatsuki review: ${err.message}`,
      };
    }
  }
  if (!akatsukiGate && taskDir) {
    const reviewFile = path.join(taskDir, 'akatsuki_review.json');
    if (fs.existsSync(reviewFile)) {
      try {
        akatsukiGate = _evaluateAkatsukiReview(JSON.parse(fs.readFileSync(reviewFile, 'utf8')));
      } catch (err) {
        akatsukiGate = {
          decision: 'error',
          mode: 'blue',
          passed: false,
          error: `Malformed Akatsuki review artifact: ${err.message}`,
        };
      }
    }
  }
  const skipRequested = Boolean(
    state.skipAkatsukiGate ||
    status.skip_akatsuki_gate ||
    status.skip_akatsuki_blue_mode === true ||
    status.akatsuki_skipped === true
  );
  if (skipRequested) {
    akatsukiGate = {
      decision: 'skipped_violation',
      mode: 'blue',
      passed: false,
      error: 'Akatsuki Blue Mode was explicitly skipped before Kage Review Gate (fail-closed violation).',
    };
    status.akatsuki_final_gate = akatsukiGate;
    status.blue_mode_before_kage_verified = false;
  } else if (!akatsukiGate) {
    try {
      akatsukiGate = runAkatsukiFinalGate(projectPath, status, { taskDir });
    } catch (err) {
      akatsukiGate = {
        decision: 'error',
        mode: 'blue',
        passed: false,
        error: err.message,
      };
      status.akatsuki_final_gate = akatsukiGate;
    }
  }
  const akatsukiPassed = !skipRequested && (
    !akatsukiGate || (
      akatsukiGate.decision !== 'block' &&
      akatsukiGate.decision !== 'error' &&
      akatsukiGate.decision !== 'skipped_violation' &&
      akatsukiGate.passed !== false
    )
  );
  if (akatsukiPassed) {
    status.blue_mode_before_kage_verified = true;
  }
  return { akatsukiGate, akatsukiPassed };
}

async function reviewNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const rootId = process.env.KONOHA_TASK_ID || state.threadId || status.task_id || path.basename(taskDir);
  const projectPath = state.projectPath || status.project_path || process.cwd();

  // Delegation integrity: review may only judge work that subagents actually
  // reported. Without this guard the graph raised Gate 2 "Delivery Sign-Off" on
  // tasks that were still `pending` with `completed_dispatches: []` — the main
  // agent had executed nothing, yet the task looked ready to ship.
  const pendingTasks = (status.tasks || []).filter((t) => t.status !== 'completed');
  if (pendingTasks.length > 0) {
    status.phase = 'execute';
    status.hitl_gate = null;
    if (taskDir) saveWorkflowStatus(taskDir, status);

    const payload = {
      status,
      phase: 'execute',
      hitlPending: false,
      hitlStage: null,
      delegationPending: true,
      pending_task_ids: pendingTasks.map((t) => t.id),
      error: null,
    };
    return finalizeNodeResult(state, payload, 'node_dispatch', {
      resumeNode: 'node_dispatch',
      source: { delegationPending: true, pending: payload.pending_task_ids },
    });
  }

  // Re-run the slop gate on every review pass. Confidence must reflect the code
  // as it is now; caching it meant a run that started below 98% remediated 7 times
  // against a frozen score and could never recover, even after the code was fixed.
  try {
    const gateRes = runAislopGate(projectPath, status);
    if (gateRes && gateRes.score !== undefined) {
      status.confidence = gateRes.score;
      status.ai_slop_findings = (gateRes.findings || []).length;
      status.ai_slop_clean = gateRes.pass;
    }
  } catch (_) {
    // safe fallback: keep any previously recorded confidence
  }

  const rootRecord = sdlcManager.getTask(rootId);
  if (status.confidence === undefined && rootRecord && rootRecord.confidence !== undefined) {
    status.confidence = rootRecord.confidence;
  }

  const { akatsukiGate, akatsukiPassed } = _evaluateAkatsukiPreGate(state, status, projectPath, taskDir);

  const confidence = status.confidence !== undefined ? status.confidence : 100;
  const slopFindings = status.ai_slop_findings || 0;
  const isSlopClean = status.ai_slop_clean !== false && slopFindings === 0;
  const advisorReview = superviseLifecycleStage('review', { status, taskDir, projectPath });

  if (confidence < 98 || !isSlopClean || !advisorReview.approved || !akatsukiPassed) {
    status.phase = 'remediate';
    status.gateVerdict = 'remediate';
    if (!akatsukiPassed) {
      status.remediation_reason = akatsukiGate?.decision === 'skipped_violation'
        ? 'akatsuki_blue_mode_skipped'
        : 'akatsuki_blue_mode_failed';
    }
    if (taskDir) saveWorkflowStatus(taskDir, status);

    const payload = {
      status,
      phase: 'remediate',
      confidence,
      akatsukiPassed,
      gateVerdict: 'remediate',
    };
    return finalizeNodeResult(state, payload, 'node_remediate', {
      source: { verdict: 'remediate', confidence, slopFindings, akatsukiPassed },
    });
  }

  if (state.hitlChoice && (state.hitlStage === 'gate2' || !status.human_signed_off)) {
    const choiceObj = parseGateChoice(state.hitlChoice, state.hitlRefinement);
    const g2Res = applyGate2Choice(choiceObj, status, taskDir, sdlcManager);
    if (g2Res && g2Res.signed_off) {
      return createPassResult(status, taskDir, state, g2Res);
    }
    if (g2Res && (g2Res.remediation || choiceObj?.action === 'remediate')) {
      status.phase = 'remediate';
      status.gateVerdict = 'remediate';
      status.hitl_gate = null;
      if (taskDir) saveWorkflowStatus(taskDir, status);

      const payload = {
        status,
        phase: 'remediate',
        gateVerdict: 'remediate',
        hitlPending: false,
        hitlStage: null,
        hitlChoice: null,
        hitlRefinement: null,
      };
      return finalizeNodeResult(state, payload, 'node_remediate', {
        source: { verdict: 'remediate', choiceObj, g2Res },
      });
    }
  }

  const isSignedOffInDb = rootRecord && rootRecord.status === 'completed';
  const isDirectSubagent = status.invocation_mode === 'direct_subagent' || state.invocationMode === 'direct_subagent';
  const autoSignoffActive = Boolean(state.autoSignoff || status.auto_signoff || isDirectSubagent);

  if (status.human_signed_off || isSignedOffInDb || autoSignoffActive) {
    return createPassResult(status, taskDir, state, { verdict: 'pass', auto_signoff: autoSignoffActive });
  }

  status.phase = 'review';
  status.hitl_gate = 'pending_human_signoff';
  if (taskDir) saveWorkflowStatus(taskDir, status);

  const prompt = buildGate2Prompt(status, taskDir, rootId, confidence, status.report);
  const payload = {
    status,
    phase: 'review',
    hitlPending: true,
    hitlStage: 'gate2',
    gateVerdict: 'pending_signoff',
    result: prompt,
  };
  return finalizeNodeResult(state, payload, 'node_complete', {
    selfResume: true,
    selfNode: 'node_review',
    source: prompt,
  });
}

module.exports = { reviewNode };
