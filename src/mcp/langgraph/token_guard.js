'use strict';

const { countTiktoken } = require('../../token_sampler');

function estimateTokens(payload) {
  if (payload == null) return 0;
  if (typeof payload === 'string') {
    return countTiktoken(payload);
  }
  if (typeof payload === 'object') {
    try {
      return countTiktoken(JSON.stringify(payload));
    } catch {
      return 0;
    }
  }
  return countTiktoken(String(payload));
}

function checkBudget(currentUsed, delta, budget) {
  const total = (currentUsed || 0) + (delta || 0);
  const maxBudget = budget || 8192;
  return {
    tokensUsed: delta,
    totalUsed: total,
    budgetExceeded: total >= maxBudget,
  };
}

module.exports = {
  estimateTokens,
  checkBudget,
};
