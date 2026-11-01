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
      const isRemediating = status.slop_cycles && status.slop_cycles > 0;
      if (isRemediating) {
        status.phase = 'review';
        status.assigned_agent = 'kage';
      } else if (!status.report && !state.report) {
        status.phase = 'document';
        status.assigned_agent = 'tokubetsu-jonin';
        status.report = 'Documentation synthesized according to Tokubetsu-Jonin engineering standard.';
      } else {
        status.phase = 'review';
        status.assigned_agent = 'kage';
      }
    } else if (status.phase === 'document') {
      if (!status.report && !state.report) {
        status.report = 'Documentation synthesized according to Tokubetsu-Jonin engineering standard.';
      }
      status.phase = 'review';
      status.assigned_agent = 'kage';
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
    phase: status.phase || 'review',
    report: status.report || state.report || '',
    circuitOpen,
    circuitState: breakerStatus.state,
    error: executionError,
  };

  const delta = estimateTokens(outputPayload);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);

  return {
    ...outputPayload,
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { executeNode };
