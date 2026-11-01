'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');

async function budgetExceededNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};

  status.budget_exceeded = true;
  status.tokens_used = state.tokensUsed;
  status.token_budget = state.tokenBudget;
  if (taskDir) {
    saveWorkflowStatus(taskDir, status);
  }

  const payload = {
    status: 'paused_budget_exceeded',
    phase: state.phase,
    tokens_used: state.tokensUsed,
    turn_tokens_used: state.turnTokensUsed || state.tokensUsed,
    token_budget: state.tokenBudget,
    message: `Workflow halted: token budget exceeded (${state.turnTokensUsed || state.tokensUsed} >= ${state.tokenBudget}). State persisted for resumption with higher ceiling.`,
    task_dir: taskDir,
  };

  return {
    status,
    budgetExceeded: true,
    result: payload,
    error: null,
  };
}

module.exports = { budgetExceededNode };
