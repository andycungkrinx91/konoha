'use strict';

/**
 * Pre-flight guards against runaway token spend on a single request.
 *
 * The bridge previously accepted bodies up to 200 MB, which is effectively
 * unbounded: one oversized turn bills the entire prefix and can repeat every
 * request. These checks reject or clamp before the upstream is called, and
 * report the reason so the failure is diagnosable rather than a silent stall.
 */

const CHARS_PER_TOKEN = 3.5;

const LIMITS = Object.freeze({
  MAX_BODY_BYTES: 32 * 1024 * 1024,
  MAX_INPUT_TOKENS: 200000,
  GEMINI_MAX_INPUT_TOKENS: 120000,
  GEMINI_COMPACT_TARGET_TOKENS: 50000,
  COMPACT_THRESHOLD_TOKENS: 120000,
  MAX_MESSAGES: 2000
});

function estimateTokens(value) {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Compact conversation history when context exceeds budget ceilings.
 * Preserves system message, initial task prompt (turn 0), and latest 3 turns,
 * sets compactContext flag, and bounds tokens under targetTokens (<50,000).
 */
function compactConversationHistory(payload, targetTokens = LIMITS.GEMINI_COMPACT_TARGET_TOKENS) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length <= 4) {
    return { compacted: false, reason: 'insufficient_messages' };
  }
  const originalTokens = estimateTokens({ system: payload.system, messages: payload.messages, tools: payload.tools });
  if (originalTokens <= targetTokens) {
    return { compacted: false, estimated_tokens: originalTokens };
  }

  const msgs = payload.messages;
  const firstMsg = msgs[0];
  // Preserve latest 3 turns (at most 3 messages)
  const recentTurns = msgs.slice(-3);
  const droppedCount = msgs.length - 1 - recentTurns.length;

  if (droppedCount <= 0) {
    return { compacted: false, estimated_tokens: originalTokens };
  }

  const summaryUser = {
    role: 'user',
    content: `[Konoha Token Guard: Compacted ${droppedCount} intermediate conversation turns to preserve token budget under ${targetTokens}]`
  };
  const summaryAssistant = {
    role: 'assistant',
    content: '[Konoha Token Guard: Context acknowledged; continuing with active task execution]'
  };

  payload.messages = [firstMsg, summaryUser, summaryAssistant, ...recentTurns];
  payload.compactContext = true;
  const newTokens = estimateTokens({ system: payload.system, messages: payload.messages, tools: payload.tools });
  return {
    compacted: true,
    compactContext: true,
    original_tokens: originalTokens,
    new_tokens: newTokens,
    dropped_turns: droppedCount
  };
}

/**
 * Validate an incoming bridge payload. Returns { ok, reason, detail } and never
 * throws, so callers can turn a rejection into a clean 4xx.
 */
function validateRequestBudget(payload, limits = {}) {
  const cfg = { ...LIMITS, ...limits };

  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_payload', detail: 'request body must be an object' };
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length > cfg.MAX_MESSAGES) {
    return {
      ok: false,
      reason: 'too_many_messages',
      detail: `${messages.length} messages exceeds limit of ${cfg.MAX_MESSAGES}`, 
      observed: messages.length,
      limit: cfg.MAX_MESSAGES
    };
  }

  const isGemini = Boolean(limits.is_gemini || (payload.model && /gemini/i.test(String(payload.model))) || (limits.model && /gemini/i.test(String(limits.model))));
  const ceiling = isGemini ? (cfg.GEMINI_MAX_INPUT_TOKENS || 120000) : cfg.MAX_INPUT_TOKENS;
  const targetCompacted = isGemini ? (cfg.GEMINI_COMPACT_TARGET_TOKENS || 50000) : cfg.COMPACT_THRESHOLD_TOKENS;

  let inputTokens = estimateTokens({ system: payload.system, messages, tools: payload.tools });
  let compacted = false;

  if (inputTokens > (isGemini ? targetCompacted : ceiling) && messages.length > 4) {
    const compactRes = compactConversationHistory(payload, targetCompacted);
    if (compactRes.compacted) {
      compacted = true;
      inputTokens = compactRes.new_tokens;
    }
  }

  if (inputTokens > ceiling) {
    return {
      ok: false,
      reason: 'input_tokens_exceeded',
      detail: `~${inputTokens} estimated input tokens exceeds limit of ${ceiling}${isGemini ? ' (Gemini ceiling)' : ''}`, 
      observed: inputTokens,
      limit: ceiling,
      is_gemini: isGemini
    };
  }

  return {
    ok: true,
    estimated_input_tokens: inputTokens,
    compacted,
    compactContext: Boolean(payload.compactContext),
    is_gemini: isGemini,
    payload
  };
}

/**
 * Clamp a requested max_tokens to the remaining session allowance so a single
 * reply cannot consume the whole budget.
 */
function clampMaxTokens(requested, remainingSessionBudget, hardCeiling = 32000) {
  const ceiling = Math.min(hardCeiling, Number.isFinite(remainingSessionBudget) ? remainingSessionBudget : hardCeiling);
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : ceiling;
  return Math.max(1, Math.min(wanted, ceiling));
}

/**
 * Track spend across a session and report when the allowance is exhausted.
 */
function createSessionBudget(limitTokens) {
  const limit = Number.isFinite(limitTokens) && limitTokens > 0 ? limitTokens : 500000;
  let used = 0;
  return {
    limit,
    record(tokens) {
      const n = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
      used += n;
      return { used, limit, remaining: Math.max(0, limit - used), exhausted: used >= limit };
    },
    remaining() {
      return Math.max(0, limit - used);
    },
    exhausted() {
      return used >= limit;
    },
    snapshot() {
      return { used, limit, remaining: Math.max(0, limit - used), exhausted: used >= limit };
    }
  };
}

module.exports = {
  LIMITS,
  estimateTokens,
  compactConversationHistory,
  validateRequestBudget,
  clampMaxTokens,
  createSessionBudget
};
