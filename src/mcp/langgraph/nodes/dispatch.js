'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { _dispatchExecutePhase } = require('../../workflow_runner');
const { estimateTokens, checkBudget } = require('../token_guard');

async function dispatchNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || { tasks: state.todos || [] };

  const dispatchResult = _dispatchExecutePhase(status, taskDir);

  if (!dispatchResult) {
    const nextPhase = status.phase || 'document';
    saveWorkflowStatus(taskDir, status);
    const delta = estimateTokens({ phase: nextPhase });
    const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);
    return {
      status,
      phase: nextPhase,
      tokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(dispatchResult);
  } catch {
    parsed = { raw: dispatchResult };
  }

  const delta = estimateTokens(parsed);
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    status,
    phase: 'execute',
    result: parsed,
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { dispatchNode };
