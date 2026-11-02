'use strict';

const { estimateTokens, normalizeTokenBudget } = require('./token_guard');

/**
 * @param {object} state - current graph state
 * @param {object} payload - node result payload
 * @param {string} nextNode - node id to run next if this turn continues (the successor)
 * @param {object} opts - { selfResume, selfNode, source, resumeNode }
 *                  selfResume: true  → resume at THIS node (HITL pause / error)
 *                  resumeNode: explicit override
 */
function finalizeNodeResult(state, payload = {}, nextNode = '', opts = {}) {
  const source = opts.source !== undefined ? opts.source : payload;
  const delta = estimateTokens(source);
  const turnUsed = (state.turnTokensUsed || 0) + delta;
  const budget = normalizeTokenBudget(state.tokenBudget);
  const exceeded = turnUsed >= budget;
  const resumeNode = opts.selfResume
    ? (opts.selfNode || nextNode)
    : (opts.resumeNode !== undefined ? opts.resumeNode : nextNode);

  return {
    ...payload,
    tokensUsed: delta,
    turnTokensUsed: turnUsed,
    budgetExceeded: exceeded,
    resumeNode,
  };
}

module.exports = {
  finalizeNodeResult,
};
