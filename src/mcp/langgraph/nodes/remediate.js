'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { globalCircuitRegistry } = require('../../../circuit_breaker');
const { finalizeNodeResult } = require('../budget');

async function remediateNode(state, config) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const threadId = state.threadId || config?.configurable?.thread_id || '';
  const breakerKey = threadId ? `workflow:${threadId}` : 'workflow';
  const breaker = globalCircuitRegistry.getOrCreate(breakerKey);

  const currentCycles = (status.slop_cycles || 0) + 1;
  status.slop_cycles = currentCycles;

  const breakerStatus = breaker.getStatus();
  const maxCyclesExceeded = currentCycles >= 7;
  const circuitTripped = breakerStatus.state === 'OPEN' || maxCyclesExceeded;

  if (circuitTripped) {
    status.circuit_broken = true;
    status.phase = 'error';
    status.gateVerdict = 'circuit_open';
    if (taskDir) saveWorkflowStatus(taskDir, status);

    const payload = {
      status,
      phase: 'error',
      circuitOpen: true,
      circuitState: 'OPEN',
      remediationCount: currentCycles,
      error: `Circuit breaker tripped: remediation cycle limit (7) or failure threshold reached (cycles=${currentCycles}, state=${breakerStatus.state}).`,
    };
    return finalizeNodeResult(state, payload, 'node_error', {
      source: { circuitTripped, currentCycles },
    });
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

  const payload = {
    status,
    phase: 'execute',
    circuitOpen: false,
    remediationCount: currentCycles,
  };
  return finalizeNodeResult(state, payload, 'node_dispatch', {
    source: { remediationCycle: currentCycles },
  });
}

module.exports = { remediateNode };
