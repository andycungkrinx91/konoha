'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { globalCircuitRegistry } = require('../../../circuit_breaker');
const { finalizeNodeResult } = require('../budget');
const worktree = require('../../worktree_isolation');

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

  if (sliceResults && typeof sliceResults === 'object' && Object.keys(sliceResults).length > 0) {
    for (const t of tasks) {
      if (t.status !== 'completed' && sliceResults[t.id]) {
        t.status = 'completed';
        t.result = sliceResults[t.id];
        recordCompletedDispatch(status, t.dispatch_id);
      }
    }
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

function _tryMergeActiveParallelGroup(status) {
  if (!status.active_parallel_group) return;
  try {
    const mergeBack = worktree.mergeBackParallelGroup({ status, groupName: status.active_parallel_group });
    if (!mergeBack || !mergeBack.ok) return;
    (status.tasks || []).filter(t => t.parallel_group === status.active_parallel_group).forEach(t => { t.worktree_merged = true; });
    status.last_group_merge = {
      group: mergeBack.group,
      results: (mergeBack.results || []).map(r => ({ task_id: r.task_id, merged: r.merged, reason: r.reason }))
    };
    status.active_parallel_group = null;
    status.active_parallel_group_order = null;
  } catch (_) { /* best effort merge-back */ }
}

function advancePostExecutionPhase(status, state, allCompleted) {
  const defaultReport = 'Documentation synthesized according to Tokubetsu-Jonin engineering standard.';
  if (allCompleted) {
    _tryMergeActiveParallelGroup(status);
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
