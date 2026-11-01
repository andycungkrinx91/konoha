'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { globalCircuitRegistry } = require('../../../circuit_breaker');
const { estimateTokens, checkBudget } = require('../token_guard');

async function executeNode(state) {
  const taskDir = state.taskDir || '';
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const breaker = globalCircuitRegistry.getOrCreate('workflow');

  let executionSuccess = true;
  let executionError = null;

  try {
    const tasks = status.tasks || [];
    const pendingTask = tasks.find(t => t.status !== 'completed');

    if (pendingTask) {
      if (state.sliceResults && state.sliceResults[pendingTask.id]) {
        pendingTask.status = 'completed';
        pendingTask.result = state.sliceResults[pendingTask.id];
      }
    }

    const allCompleted = tasks.every(t => t.status === 'completed');
    if (allCompleted) {
      status.phase = (status.slop_cycles && status.slop_cycles > 0) ? 'review' : 'document';
      status.assigned_agent = (status.phase === 'review') ? 'kage' : 'tokubetsu-jonin';
    }

    if (taskDir) {
      fs.mkdirSync(taskDir, { recursive: true });
      saveWorkflowStatus(taskDir, status);
    }
  } catch (err) {
    executionSuccess = false;
    executionError = err.message;
  }

  if (executionSuccess) {
    breaker.recordSuccess();
  } else {
    breaker.recordFailure();
  }

  const breakerStatus = breaker.getStatus();
  const circuitOpen = breakerStatus.state === 'OPEN';

  const outputPayload = {
    status,
    phase: status.phase || 'document',
    circuitOpen,
    circuitState: breakerStatus.state,
    error: executionError,
  };

  const delta = estimateTokens(outputPayload);
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    ...outputPayload,
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { executeNode };
