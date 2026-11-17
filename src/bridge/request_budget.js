'use strict';

/**
 * Pre-flight guards against runaway token spend on a single request.
 *
 * The bridge previously accepted bodies up to 200 MB, which is effectively
 * unbounded: one oversized turn bills the entire prefix and can repeat every
 * request. These checks reject or clamp before the upstream is called, and
 * report the reason so the failure is diagnosable rather than a silent stall.
 */

const { extractKeyMiddleAnchors } = require('../context_budget');
const { resolveDynamicInputQuota, captureLangGraphCompactionState } = require('../context_compaction');
const { redactSecrets } = require('./utils');

const CHARS_PER_TOKEN = 3.5;

const LIMITS = Object.freeze({
  MAX_BODY_BYTES: 32 * 1024 * 1024,
  MAX_INPUT_TOKENS: 180000,
  GEMINI_MAX_INPUT_TOKENS: 100000,
  GEMINI_COMPACT_TARGET_TOKENS: 50000,
  COMPACT_THRESHOLD_TOKENS: 100000,
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

  const middleMsgs = msgs.slice(1, msgs.length - recentTurns.length);
  const anchorCharBudget = Math.min(4800, Math.max(400, Math.floor(targetTokens * 0.08 * CHARS_PER_TOKEN)));
  const perTurnBudget = Math.max(120, Math.floor(anchorCharBudget / Math.min(middleMsgs.length, 6)));
  const sampleCount = Math.min(middleMsgs.length, 6);
  const step = middleMsgs.length / sampleCount;
  const anchors = [];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.min(middleMsgs.length - 1, Math.floor(i * step));
    const m = middleMsgs[idx];
    const raw = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
    const snippet = extractKeyMiddleAnchors(raw, perTurnBudget, { start: 0, end: raw.length }) || raw.slice(0, perTurnBudget).trim();
    if (snippet) anchors.push(`[Turn ${idx + 1} (${m?.role || 'msg'})]: ${snippet}`);
  }
  const middleDigest = anchors.length > 0 ? `\nPreserved Middle Anchors:\n${anchors.join('\n')}` : '';

  const summaryUser = {
    role: 'user',
    content: `[Konoha Token Guard: Compacted ${droppedCount} intermediate conversation turns to preserve token budget under ${targetTokens}]${middleDigest}`
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
    auto_continue: true,
    original_tokens: originalTokens,
    new_tokens: newTokens,
    dropped_turns: droppedCount,
    latest_condition: middleDigest || summaryUser.content
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
  const dynamicQuota = resolveDynamicInputQuota();
  const hasExplicitGeminiMax = Object.prototype.hasOwnProperty.call(limits, 'GEMINI_MAX_INPUT_TOKENS');
  const hasExplicitThreshold = Object.prototype.hasOwnProperty.call(limits, 'COMPACT_THRESHOLD_TOKENS');

  const ceiling = isGemini
    ? (hasExplicitGeminiMax ? cfg.GEMINI_MAX_INPUT_TOKENS : LIMITS.GEMINI_MAX_INPUT_TOKENS)
    : cfg.MAX_INPUT_TOKENS;
  const triggerThreshold = isGemini
    ? (cfg.GEMINI_COMPACT_TARGET_TOKENS || 50000)
    : (hasExplicitThreshold ? Math.min(ceiling, cfg.COMPACT_THRESHOLD_TOKENS) : dynamicQuota);
  const targetCompacted = isGemini
    ? (cfg.GEMINI_COMPACT_TARGET_TOKENS || 50000)
    : Math.min(ceiling, Math.max(1000, Math.floor(triggerThreshold * 0.5)));

  let inputTokens = estimateTokens({ system: payload.system, messages, tools: payload.tools });
  let compacted = false;
  let checkpointMeta = null;

  if (inputTokens > triggerThreshold && messages.length > 4) {
    const compactRes = compactConversationHistory(payload, targetCompacted);
    if (compactRes.compacted) {
      compacted = true;
      inputTokens = compactRes.new_tokens;
      checkpointMeta = captureLangGraphCompactionState({
        taskDir: limits.taskDir || '',
        taskId: limits.taskId || '',
        sessionId: limits.sessionId || '',
        agent: limits.agent || 'bridge',
        task: typeof payload.system === 'string' ? redactSecrets(payload.system.slice(0, 400)) : '',
        work: redactSecrets(compactRes.latest_condition || ''),
        latestCondition: redactSecrets(compactRes.latest_condition || ''),
        quotaTokens: triggerThreshold,
        observedInputTokens: compactRes.original_tokens,
        trigger: 'bridge_request_budget'
      });
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
    quota_tokens: triggerThreshold,
    compacted,
    compactContext: Boolean(payload.compactContext),
    auto_continue: compacted ? true : undefined,
    backend: checkpointMeta ? checkpointMeta.backend : undefined,
    thread_id: checkpointMeta ? checkpointMeta.thread_id : undefined,
    checkpoint_ns: checkpointMeta ? checkpointMeta.checkpoint_ns : undefined,
    checkpoint_id: checkpointMeta ? checkpointMeta.checkpoint_id : undefined,
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
