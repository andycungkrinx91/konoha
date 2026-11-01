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
    const workstreams = Array.isArray(parallelAnalysis)
      ? parallelAnalysis
      : (parallelAnalysis?.slices || []);

    if (workstreams.length > 1) {
      tasks = workstreams.map((ws, i) => ({
        id: `task_${i + 1}`,
        task: ws.task || `Implement ${ws.domain || ws.agent} requirements`,
        agent: ws.agent || 'anbu',
        status: 'pending',
        parallel_group: ws.parallel_group || 'parallel_group_1',
      }));
    } else {
      const assignedAgent = (state.intent === 'pentest') ? 'akatsuki' : (status.assigned_agent || 'anbu');
      tasks = [
        { id: 'task_1', task: state.prompt || 'Execute core task', agent: assignedAgent, status: 'pending' },
      ];
    }
  }

  status.tasks = tasks;
  if (taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    saveWorkflowStatus(taskDir, status);
  }

  const delta = estimateTokens(tasks);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);

  return {
    status,
    todos: tasks,
    slices: tasks.filter(t => t.parallel_group),
    phase: 'execute',
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { todoNode };
