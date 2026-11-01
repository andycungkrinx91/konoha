'use strict';

const { globalCircuitRegistry } = require('../../circuit_breaker');

function wrapGuardedNode(nodeName, nodeFn) {
  return async function guardedNode(state, config) {
    const breaker = globalCircuitRegistry.getOrCreate('workflow');

    if (!breaker.allowRequest()) {
      const status = breaker.getStatus();
      return {
        error: `Circuit breaker OPEN at node ${nodeName}: failure count ${status.failure_count}`,
        circuitOpen: true,
        circuitState: status.state,
        phase: 'error',
      };
    }

    try {
      const res = await nodeFn(state, config);
      if (res && res.circuitOpen) {
        // preserve node-level trip
      } else {
        breaker.recordSuccess();
      }
      return res;
    } catch (err) {
      breaker.recordFailure();
      const status = breaker.getStatus();
      return {
        error: `Node failure in ${nodeName}: ${err.message || String(err)}`,
        circuitOpen: status.state === 'OPEN',
        circuitState: status.state,
        phase: 'error',
      };
    }
  };
}

module.exports = {
  wrapGuardedNode,
};
