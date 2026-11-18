'use strict';

/**
 * Structured judgment for routing and drift checks.
 *
 * Heuristics stay the default: they are deterministic, free, and right most of
 * the time. This module is the escalation path for the cases heuristics cannot
 * separate — a routing margin too small to trust, or a drift candidate whose
 * keywords are ambiguous. It borrows the host's already-configured model
 * (`model_router`), never a separate provider, and degrades to the heuristic
 * verdict on any failure.
 */

const crypto = require('crypto');
const { resolveChatTargets, sendChatMessage } = require('./three_asset/model_router');

// Below this top1-top2 score gap the heuristic ranking is not trustworthy.
const SJ_AMBIGUITY_MARGIN = 0.15;
// Measured on the 9router host model: 3.1-5.4 s per verdict, so 2500 ms timed out
// every call and the feature silently never fired. Bounded, not generous.
const SJ_MODEL_TIMEOUT_MS = 8000;
const SJ_MAX_TOKENS = 300;
const SJ_CACHE_MAX = 64;
const SJ_MIN_CONFIDENCE = 0.6;
// Prompt text is clipped: routing signals live in the first few hundred chars.
const SJ_PROMPT_CHARS = 1200;
// A degraded verdict is still a verdict. Caching it briefly stops a repeated
// ambiguous dispatch from re-billing the model, without pinning a recovered
// provider to the first failure for the life of the process.
const SJ_FALLBACK_TTL_MS = 60000;

const cache = new Map();

function _cacheKey(kind, payload) {
  const h = crypto.createHash('sha256').update(`${kind}\0${payload}`).digest('hex').slice(0, 16);
  return h;
}

function _cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  if (hit.expiresAt <= Date.now()) return null;
  cache.set(key, hit);
  return hit.value;
}

function _cacheSet(key, value, ttlMs = Infinity) {
  cache.set(key, { value, expiresAt: ttlMs === Infinity ? Infinity : Date.now() + ttlMs });
  while (cache.size > SJ_CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Cache a degraded verdict under the short TTL and hand it back. */
function _fallback(key, reason) {
  const out = { source: 'heuristic', reason };
  _cacheSet(key, out, SJ_FALLBACK_TTL_MS);
  return out;
}

/** Strip fences and prose so `JSON.parse` sees only the model's object. */
function _extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function _ask(system, user) {
  const targets = resolveChatTargets({});
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const target = targets[0];
  const res = await sendChatMessage(target, {
    system,
    userText: user,
    temperature: 0,
    max_tokens: SJ_MAX_TOKENS,
    timeoutMs: SJ_MODEL_TIMEOUT_MS
  });
  return { json: _extractJson(res && res.text), usage: (res && res.usage) || null };
}

/**
 * Rank a routing decision that the keyword heuristic could not separate.
 * Returns `{source, agent, confidence, reason}`; `source: 'heuristic'` means the
 * caller must keep its own verdict.
 */
async function judgeRoute({ prompt = '', candidates = [], projectPath = null } = {}) {
  const names = (Array.isArray(candidates) ? candidates : [])
    .map((c) => (typeof c === 'string' ? c : c && c.agent))
    .filter(Boolean);
  if (names.length < 2) return { source: 'heuristic', reason: 'fewer than two candidates' };

  const key = _cacheKey('route', `${crypto.createHash('sha256').update(String(prompt)).digest('hex').slice(0, 16)}\0${names.join(',')}`);
  const cached = _cacheGet(key);
  if (cached) return { ...cached, usage: null };

  try {
    const { json: verdict, usage } = await _ask(
      'You route tasks between specialist agents. Answer with JSON only: {"agent": "<one of the given names>", "confidence": <0..1>, "reason": "<12 words max>"}.',
      `Agents: ${names.join(', ')}\nProject: ${projectPath || 'unknown'}\nTask: ${String(prompt).slice(0, SJ_PROMPT_CHARS)}`
    );
    if (!verdict || !names.includes(verdict.agent)) return _fallback(key, 'model returned no valid agent');
    const confidence = Number(verdict.confidence);
    if (!Number.isFinite(confidence) || confidence < SJ_MIN_CONFIDENCE) {
      return _fallback(key, `model confidence ${verdict.confidence} below ${SJ_MIN_CONFIDENCE}`);
    }
    const out = {
      source: 'model',
      agent: verdict.agent,
      confidence,
      reason: String(verdict.reason || '').slice(0, 120),
      usage
    };
    _cacheSet(key, out);
    return out;
  } catch (_) {
    return _fallback(key, 'model unavailable');
  }
}

/**
 * Second opinion on drift candidates a keyword check already flagged.
 * Returns `{source, drift, reason}`; `drift: false` clears the candidate.
 */
async function judgeDrift({ agent = 'worker', goal = '', plan = '', todos = [], summary = '' } = {}) {
  const summaryText = String(summary || '');
  if (!summaryText.trim()) return { source: 'heuristic', reason: 'empty summary' };

  const todoList = (Array.isArray(todos) ? todos : []).slice(0, 8).map((t) => `- ${typeof t === 'string' ? t : (t && (t.content || t.task)) || ''}`).join('\n');
  const key = _cacheKey('drift', `${crypto.createHash('sha256').update(`${agent}\0${goal}\0${plan}\0${todoList}\0${summaryText}`).digest('hex').slice(0, 16)}`);
  const cached = _cacheGet(key);
  if (cached) return { ...cached, usage: null };

  try {
    const { json: verdict, usage } = await _ask(
      'You audit whether an agent summary stays inside its goal and plan. Answer with JSON only: {"drift": true|false, "confidence": <0..1>, "reason": "<12 words max>"}.',
      `Agent: ${agent}\nGoal: ${String(goal).slice(0, 400)}\nPlan: ${String(plan).slice(0, 400)}\nTodos:\n${todoList}\nSummary: ${summaryText.slice(0, SJ_PROMPT_CHARS)}`
    );
    if (!verdict || typeof verdict.drift !== 'boolean') return _fallback(key, 'model returned no verdict');
    const confidence = Number(verdict.confidence);
    if (!Number.isFinite(confidence) || confidence < SJ_MIN_CONFIDENCE) {
      return _fallback(key, `model confidence ${verdict.confidence} below ${SJ_MIN_CONFIDENCE}`);
    }
    const out = { source: 'model', drift: verdict.drift, confidence, reason: String(verdict.reason || '').slice(0, 120), usage };
    _cacheSet(key, out);
    return out;
  } catch (_) {
    return _fallback(key, 'model unavailable');
  }
}

function clearJudgmentCache() {
  cache.clear();
}

module.exports = {
  SJ_AMBIGUITY_MARGIN,
  SJ_MODEL_TIMEOUT_MS,
  SJ_MAX_TOKENS,
  SJ_CACHE_MAX,
  SJ_MIN_CONFIDENCE,
  SJ_PROMPT_CHARS,
  SJ_FALLBACK_TTL_MS,
  judgeRoute,
  judgeDrift,
  clearJudgmentCache
};
