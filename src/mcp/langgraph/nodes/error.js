'use strict';

async function errorNode(state) {
  const errorMsg = state.error || 'Workflow execution error';
  const circuitState = state.circuitState || (state.circuitOpen ? 'OPEN' : 'CLOSED');
  const payload = {
    status: 'error',
    phase: 'error',
    error: errorMsg,
    circuit_open: !!state.circuitOpen,
    circuit_state: circuitState,
    task_dir: state.taskDir || null,
    thread_id: state.threadId || null,
  };
  return {
    ...payload,
    result: payload,
  };
}

module.exports = {
  errorNode,
};
