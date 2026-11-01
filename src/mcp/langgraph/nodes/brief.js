'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { estimateTokens, checkBudget } = require('../token_guard');

async function briefNode(state) {
  const taskDir = state.taskDir || '';
  const status = loadWorkflowStatus(taskDir) || state.status || {};

  const planText = typeof state.plan === 'string'
    ? state.plan
    : JSON.stringify(state.plan || status.plan || 'Standard implementation plan.');

  const brief = {
    objective: state.prompt || status.prompt || 'Execute engineering workflow according to plan.',
    plan_reference: planText.slice(0, 300),
    architecture_boundaries: {
      zero_slop: true,
      circuit_breaker_active: true,
      token_budget: state.tokenBudget || 8192,
      max_remediations: 7,
    },
    validation_criteria: 'All tests pass with 0 errors and 0 warnings. Kage confidence >= 98%. Zero AI slop findings.',
    created_at: new Date().toISOString(),
  };

  status.brief = brief;
  if (taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    saveWorkflowStatus(taskDir, status);
  }

  const delta = estimateTokens(brief);
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    status,
    brief,
    phase: 'todo',
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { briefNode };
