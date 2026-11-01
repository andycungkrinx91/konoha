'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { applyGate1Choice, buildGate1Prompt, parseGateChoice } = require('../../workflow_gates');
const sdlcManager = require('../../../workflow/kage-reviewer/sdlc_manager');
const { estimateTokens, checkBudget } = require('../token_guard');

async function planNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || { phase: 'plan' };
  const rootTaskId = state.threadId || status.task_id || path.basename(taskDir);

  if (state.hitlChoice && (state.hitlStage === 'gate1' || !status.plan_approved)) {
    const choiceObj = parseGateChoice(state.hitlChoice, state.hitlRefinement);
    if (choiceObj) {
      applyGate1Choice(choiceObj, status, taskDir, sdlcManager);
      status.plan_approved = true;
      status.hitl_gate = null;
      status.phase = 'brief';
      saveWorkflowStatus(taskDir, status);
    }

    const delta = estimateTokens(choiceObj);
    const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);
    return {
      status,
      plan: status.plan,
      phase: 'brief',
      hitlPending: false,
      hitlStage: null,
      tokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
  }

  const rootRecord = sdlcManager.getTask(rootTaskId);
  const isApprovedInDb = rootRecord && (rootRecord.status === 'in_progress' || rootRecord.status === 'completed');

  if (status.plan_approved || isApprovedInDb) {
    status.plan_approved = true;
    status.hitl_gate = null;
    status.phase = 'brief';
    saveWorkflowStatus(taskDir, status);

    const planData = status.plan || 'Plan approved.';
    const delta = estimateTokens(planData);
    const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);
    return {
      status,
      plan: planData,
      phase: 'brief',
      hitlPending: false,
      hitlStage: null,
      tokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
  }

  status.phase = 'plan';
  status.hitl_gate = 'pending_plan_approval';
  saveWorkflowStatus(taskDir, status);

  const prompt = buildGate1Prompt(status, taskDir, rootTaskId, status.plan);
  const delta = estimateTokens(prompt);
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    status,
    plan: status.plan,
    phase: 'plan',
    hitlPending: true,
    hitlStage: 'gate1',
    result: prompt,
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { planNode };
