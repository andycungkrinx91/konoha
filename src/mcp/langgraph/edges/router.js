'use strict';

function classifyRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  if (state.isFastTrack) return 'node_complete';
  return 'node_plan';
}

function planRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  if (state.hitlPending) return '__end__';
  return 'node_brief';
}

function briefRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  return 'node_todo';
}

function todoRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  return 'node_dispatch';
}

function dispatchRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  if (state.phase === 'done') return 'node_complete';
  return 'node_execute';
}

function executeRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  if (state.phase === 'document') return 'node_dispatch';
  return 'node_review';
}

function reviewRouter(state) {
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  if (state.hitlPending) return '__end__';
  if (state.gateVerdict === 'pass') return 'node_complete';
  if (state.gateVerdict === 'remediate') return 'node_remediate';
  return 'node_complete';
}

function remediateRouter(state) {
  if (state.circuitOpen) return 'node_complete';
  if (state.error || state.phase === 'error') return 'node_error';
  if (state.budgetExceeded) return 'node_budget_exceeded';
  return 'node_dispatch';
}

module.exports = {
  classifyRouter,
  planRouter,
  briefRouter,
  todoRouter,
  dispatchRouter,
  executeRouter,
  reviewRouter,
  remediateRouter,
};
