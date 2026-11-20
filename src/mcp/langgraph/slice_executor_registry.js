'use strict';

// LangGraph rebuilds `config.configurable` for its own runtime keys, so a caller's
// executor cannot ride along there. A function also cannot live in the state
// schema: the checkpointer serialises state. This registry is the one channel that
// survives both, keyed by thread so concurrent runs stay isolated.
const executors = new Map();

function setSliceExecutor(threadId, fn) {
  if (!threadId || typeof fn !== 'function') return;
  executors.set(threadId, fn);
}

function getSliceExecutor(threadId) {
  return threadId ? executors.get(threadId) || null : null;
}

function clearSliceExecutor(threadId) {
  if (threadId) executors.delete(threadId);
}

module.exports = { setSliceExecutor, getSliceExecutor, clearSliceExecutor };
