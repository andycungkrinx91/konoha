'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');

async function errorNode(state) {
  const taskDir = state.taskDir || '';
  const status = (taskDir ? loadWorkflowStatus(taskDir) : null) || state.status || {};

  const errorMsg = state.error || 'Workflow execution error';
  const circuitState = state.circuitState || (state.circuitOpen ? 'OPEN' : 'CLOSED');
  const resumeNode = state.resumeNode || 'node_classify';
  const turnIndex = state.turnIndex || 1;

  status.error = errorMsg;
  status.resume_node = resumeNode;
  status.turn_index = turnIndex;
  if (taskDir) {
    try {
      fs.mkdirSync(taskDir, { recursive: true });
      saveWorkflowStatus(taskDir, status);
    } catch (_) { /* intentional best-effort status persistence */ }
  }

  const payload = {
    status: 'error',
    phase: 'error',
    error: errorMsg,
    circuit_open: Boolean(state.circuitOpen),
    circuit_state: circuitState,
    resume_node: resumeNode,
    turn_index: turnIndex,
    workflow_complete: false,
    retryable: true,
    task_dir: taskDir || null,
    thread_id: state.threadId || null,
    next_action: `Turn halted on error. Next call will retry at ${resumeNode}.`,
  };

  return {
    status,
    phase: 'error',
    error: errorMsg,
    circuitOpen: Boolean(state.circuitOpen),
    circuitState,
    resumeNode,
    result: payload,
  };
}

module.exports = {
  errorNode,
};
