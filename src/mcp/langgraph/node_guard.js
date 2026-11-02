'use strict';

const { globalCircuitRegistry } = require('../../circuit_breaker');

function wrapGuardedNode(nodeName, nodeFn) {
  return async function guardedNode(state, config) {
    const threadId = state?.threadId || config?.configurable?.thread_id || '';
    const breakerKey = threadId ? `workflow:${threadId}` : 'workflow';
    const breaker = globalCircuitRegistry.getOrCreate(breakerKey);

    if (!breaker.allowRequest()) {
      const status = breaker.getStatus();
      return {
        error: `Circuit breaker OPEN at node ${nodeName}: failure count ${status.failure_count}`,
        circuitOpen: true,
        circuitState: status.state,
        resumeNode: nodeName,
        trace: [nodeName],
        phase: 'error',
      };
    }

    try {
      const res = await nodeFn(state, config);
      if (res && (res.error || res.circuitOpen)) {
        breaker.recordFailure();
      } else {
        breaker.recordSuccess();
      }

      if (res && typeof res === 'object') {
        return {
          ...res,
          trace: [nodeName],
        };
      }
      return res;
    } catch (err) {
      breaker.recordFailure();
      const status = breaker.getStatus();
      return {
        error: `Node failure in ${nodeName}: ${err.message || String(err)}`,
        circuitOpen: status.state === 'OPEN',
        circuitState: status.state,
        resumeNode: nodeName,
        trace: [nodeName],
        phase: 'error',
      };
    }
  };
}

module.exports = {
  wrapGuardedNode,
};
