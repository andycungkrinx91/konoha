'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus, workflowParseTasks } = require('../../workflow_common');
const { detectParallelWorkstreams } = require('../../workflow_sannin');
const { estimateTokens, checkBudget } = require('../token_guard');

async function todoNode(state) {
  const taskDir = state.taskDir || '';
  const status = loadWorkflowStatus(taskDir) || state.status || {};

  let tasks = status.tasks || [];
  if (!tasks.length && status.plan) {
    tasks = workflowParseTasks(status.plan);
  }

  if (!tasks.length) {
    const parallelAnalysis = detectParallelWorkstreams(state.prompt || status.prompt || '');
    if (parallelAnalysis.is_parallel && parallelAnalysis.slices?.length) {
      tasks = parallelAnalysis.slices.map((slice, i) => ({
        id: `task_${i + 1}`,
        task: slice.task,
        agent: slice.agent || 'anbu',
        status: 'pending',
        parallel_group: slice.parallel_group || 'group_1',
      }));
    } else {
      tasks = [
        { id: 'task_1', task: state.prompt || 'Execute core task', agent: 'anbu', status: 'pending' },
      ];
    }
  }

  status.tasks = tasks;
  if (taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    saveWorkflowStatus(taskDir, status);
  }

  const delta = estimateTokens(tasks);
  const budgetCheck = checkBudget(state.tokensUsed, delta, state.tokenBudget);

  return {
    status,
    todos: tasks,
    slices: tasks.filter(t => t.parallel_group),
    phase: 'execute',
    tokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { todoNode };
