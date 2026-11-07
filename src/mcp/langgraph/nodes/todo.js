'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus, workflowParseTasks } = require('../../workflow_common');
const { detectParallelWorkstreams } = require('../../workflow_sannin');
const { syncTodoAndWalkthrough } = require('../../todo_walkthrough_sync');
const { finalizeNodeResult } = require('../budget');

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

  const syncBundle = syncTodoAndWalkthrough(status, {
    client: state.client || status.client || '',
    taskDir,
    tasks
  });

  const payload = {
    status,
    todos: tasks,
    walkthrough_steps: syncBundle.walkthrough_steps,
    client_todo_directive: syncBundle.client_todo_directive,
    slices: tasks.filter(t => t.parallel_group),
    phase: 'execute',
  };
  return finalizeNodeResult(state, payload, 'node_dispatch', { source: tasks });
}

module.exports = { todoNode };
