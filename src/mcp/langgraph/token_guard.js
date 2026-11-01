'use strict';

const { countTiktoken } = require('../../token_sampler');

const ALLOWED_CEILINGS = [8192, 16384, 32768, 65536];

function normalizeTokenBudget(budget) {
  const candidate = budget != null ? Number(budget) : null;
  const envBudget = process.env.KONOHA_TURN_BUDGET ? Number(process.env.KONOHA_TURN_BUDGET) : null;
  const b = candidate || envBudget || 8192;

  if (isNaN(b) || b <= 0) return 8192;
  if (b <= 100) return b;
  if (ALLOWED_CEILINGS.includes(b)) return b;

  for (const ceiling of ALLOWED_CEILINGS) {
    if (b <= ceiling) return ceiling;
  }
  return 65536;
}

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
  const maxBudget = normalizeTokenBudget(budget);
  return {
    tokensUsed: delta,
    totalUsed: total,
    budgetExceeded: total >= maxBudget,
    maxBudget,
  };
}

module.exports = {
  ALLOWED_CEILINGS,
  normalizeTokenBudget,
  estimateTokens,
  checkBudget,
};
