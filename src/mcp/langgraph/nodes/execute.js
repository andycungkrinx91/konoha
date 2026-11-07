'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { globalCircuitRegistry } = require('../../../circuit_breaker');
const { finalizeNodeResult } = require('../budget');

function recordCompletedDispatch(status, dispatchId) {
  if (!dispatchId) return;
  status.completed_dispatches = status.completed_dispatches || [];
  if (!status.completed_dispatches.includes(dispatchId)) {
    status.completed_dispatches.push(dispatchId);
  }
}

function completePendingTasks(status, sliceResults) {
  const tasks = status.tasks || [];
  const pendingTask = tasks.find(t => t.status !== 'completed');
  if (!pendingTask) return tasks;

  if (sliceResults && sliceResults[pendingTask.id]) {
    pendingTask.status = 'completed';
    pendingTask.result = sliceResults[pendingTask.id];
    return tasks;
  }

  for (const t of tasks) {
    if (t.status !== 'completed') {
      t.status = 'completed';
      recordCompletedDispatch(status, t.dispatch_id);
    }
  }
  return tasks;
}

function advancePostExecutionPhase(status, state, allCompleted) {
  const defaultReport = 'Documentation synthesized according to Tokubetsu-Jonin engineering standard.';
  if (allCompleted) {
    const isRemediating = status.slop_cycles && status.slop_cycles > 0;
    if (isRemediating || status.report || state.report) {
      status.phase = 'review';
      status.assigned_agent = 'kage';
      return;
    }
    status.phase = 'document';
    status.assigned_agent = 'tokubetsu-jonin';
    status.report = defaultReport;
    return;
  }

  if (status.phase === 'document') {
    if (!status.report && !state.report) {
      status.report = defaultReport;
    }
    status.phase = 'review';
    status.assigned_agent = 'kage';
  }
}

async function executeNode(state, config) {
  const taskDir = state.taskDir || '';
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const threadId = state.threadId || config?.configurable?.thread_id || '';
  const breakerKey = threadId ? `workflow:${threadId}` : 'workflow';
  const breaker = globalCircuitRegistry.getOrCreate(breakerKey);

  let executionError = null;

  try {
    const tasks = completePendingTasks(status, state.sliceResults);
    const allCompleted = tasks.every(t => t.status === 'completed');
    advancePostExecutionPhase(status, state, allCompleted);

    if (taskDir) {
      fs.mkdirSync(taskDir, { recursive: true });
      saveWorkflowStatus(taskDir, status);
    }
  } catch (err) {
    executionError = err.message;
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

  const nextNode = outputPayload.phase === 'document' ? 'node_dispatch' : 'node_review';
  return finalizeNodeResult(state, outputPayload, nextNode);
}

module.exports = { executeNode };
