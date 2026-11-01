'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { globalCircuitRegistry } = require('../../../circuit_breaker');
const { estimateTokens, checkBudget } = require('../token_guard');

async function remediateNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const breaker = globalCircuitRegistry.getOrCreate('workflow');

  const currentCycles = (status.slop_cycles || 0) + 1;
  status.slop_cycles = currentCycles;

  const breakerStatus = breaker.getStatus();
  const maxCyclesExceeded = currentCycles > 7;
  const circuitTripped = breakerStatus.state === 'OPEN' || maxCyclesExceeded;

  if (circuitTripped) {
    status.circuit_broken = true;
    status.phase = 'done';
    status.gateVerdict = 'circuit_open';
    if (taskDir) saveWorkflowStatus(taskDir, status);

    const delta = estimateTokens({ circuitTripped, currentCycles });
    const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);
    return {
      status,
      phase: 'done',
      circuitOpen: true,
      circuitState: 'OPEN',
      remediationCount: currentCycles,
      error: `Circuit breaker tripped: remediation cycle limit (7) or failure threshold reached (cycles=${currentCycles}, state=${breakerStatus.state}).`,
      tokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
  }

  status.phase = 'execute';
  status.assigned_agent = 'anbu';
  if (Array.isArray(status.tasks)) {
    for (const t of status.tasks) {
      if (t.status !== 'completed' || t.needs_remediation) {
        t.status = 'pending';
      }
    }
  }
  if (taskDir) saveWorkflowStatus(taskDir, status);

  const delta = estimateTokens({ remediationCycle: currentCycles });
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    status,
    phase: 'execute',
    circuitOpen: false,
    remediationCount: currentCycles,
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { remediateNode };
