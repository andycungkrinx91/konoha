'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { runAislopGate } = require('../../workflow_dispatch');
const { applyGate2Choice, buildGate2Prompt, parseGateChoice } = require('../../workflow_gates');
const sdlcManager = require('../../../workflow/kage-reviewer/sdlc_manager');
const { estimateTokens, checkBudget } = require('../token_guard');

function createPassResult(status, taskDir, state, payload) {
  status.human_signed_off = true;
  status.hitl_gate = null;
  status.phase = 'done';
  status.gateVerdict = 'pass';
  if (taskDir) saveWorkflowStatus(taskDir, status);

  const delta = estimateTokens(payload);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);
  return {
    status,
    phase: 'done',
    gateVerdict: 'pass',
    hitlPending: false,
    hitlStage: null,
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

async function reviewNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const rootId = process.env.KONOHA_TASK_ID || state.threadId || status.task_id || path.basename(taskDir);
  const projectPath = state.projectPath || status.project_path || process.cwd();

  if (status.confidence === undefined && !status.aislop_gate) {
    try {
      const gateRes = runAislopGate(projectPath, status);
      if (gateRes && gateRes.score !== undefined) {
        status.confidence = gateRes.score;
        status.ai_slop_findings = (gateRes.findings || []).length;
        status.ai_slop_clean = gateRes.pass;
      }
    } catch (_) {
      // safe fallback
    }
  }

  const rootRecord = sdlcManager.getTask(rootId);
  if (rootRecord && rootRecord.confidence !== undefined && status.confidence === undefined) {
    status.confidence = rootRecord.confidence;
  }

  const confidence = status.confidence !== undefined ? status.confidence : 100;
  const slopFindings = status.ai_slop_findings || 0;
  const isSlopClean = status.ai_slop_clean !== false && slopFindings === 0;

  if (confidence < 98 || !isSlopClean) {
    status.phase = 'remediate';
    status.gateVerdict = 'remediate';
    if (taskDir) saveWorkflowStatus(taskDir, status);

    const delta = estimateTokens({ verdict: 'remediate', confidence, slopFindings });
    const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
    const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);
    return {
      status,
      phase: 'remediate',
      confidence,
      gateVerdict: 'remediate',
      tokensUsed: delta,
      turnTokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
  }

  if (state.hitlChoice && (state.hitlStage === 'gate2' || !status.human_signed_off)) {
    const choiceObj = parseGateChoice(state.hitlChoice, state.hitlRefinement);
    const g2Res = applyGate2Choice(choiceObj, status, taskDir, sdlcManager);
    if (g2Res.signed_off) {
      return createPassResult(status, taskDir, state, g2Res);
    }
  }

  const isSignedOffInDb = rootRecord && rootRecord.status === 'completed';
  const autoSignoffActive = Boolean(state.autoSignoff || status.auto_signoff);

  if (status.human_signed_off || isSignedOffInDb || autoSignoffActive) {
    return createPassResult(status, taskDir, state, { verdict: 'pass', auto_signoff: autoSignoffActive });
  }

  status.phase = 'review';
  status.hitl_gate = 'pending_human_signoff';
  if (taskDir) saveWorkflowStatus(taskDir, status);

  const prompt = buildGate2Prompt(status, taskDir, rootId, confidence, status.report);
  const delta = estimateTokens(prompt);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);

  return {
    status,
    phase: 'review',
    hitlPending: true,
    hitlStage: 'gate2',
    gateVerdict: 'pending_signoff',
    result: prompt,
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { reviewNode };
