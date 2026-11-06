/* request_retry.js uses CommonJS (require/module.exports) — required for Node.js 18.x compatibility. */
'use strict';

const http = require('http');
const https = require('https');
const { httpAgent } = require('./gateway_router');

/**
 * Same-provider retry before the first byte reaches the client.
 *
 * A chat/completions POST is not idempotent: the provider may have already
 * executed and billed the request. So a retry is only allowed when it is
 * provable the provider never processed the request (never connected, DNS never
 * resolved, or an explicit run-budget rejection). Errors that arrive AFTER the
 * request body was fully transmitted are indeterminate and must never be
 * retried — retrying them would double-charge the caller.
 *
 * Every retry re-sends the SAME bridge, the SAME model string and the SAME
 * body. This module never substitutes a model or falls back to another provider.
 */

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 2000;
const RETRY_JITTER_RATIO = 0.25;
const DEFAULT_MAX_RETRY_BUDGET_MS = 120000;

// Connection refused: the TCP handshake never completed, so zero requests
// reached the provider.
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN'
]);

// Server-side availability signals the provider itself reports; the request was
// rejected before completion, not silently consumed.
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

// Deliberately NOT retryable: the request body was already on the wire, so the
// provider may have processed and billed it.
const INDETERMINATE_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNABORTED',
  'ESOCKETTIMEDOUT'
]);

function retryBudgets() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    baseBackoffMs: BASE_BACKOFF_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
    maxRetryBudgetMs: DEFAULT_MAX_RETRY_BUDGET_MS
  };
}

function capabilityReport() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    retryableTransportCodes: [...RETRYABLE_TRANSPORT_CODES].sort(),
    retryableHttpStatuses: [...RETRYABLE_HTTP_STATUSES].sort((a, b) => a - b),
    indeterminateTransportCodes: [...INDETERMINATE_TRANSPORT_CODES].sort()
  };
}

/**
 * True only for transport errors that prove no request reached the provider.
 * ECONNRESET / ETIMEDOUT are intentionally false: they are indeterminate.
 */
function isTransportRetryable(code) {
  return RETRYABLE_TRANSPORT_CODES.has(code);
}

function isRetryableStatus(statusCode) {
  return RETRYABLE_HTTP_STATUSES.has(statusCode);
}

function hasFlushed(res) {
  if (!res) return false;
  if (typeof res.headersSent === 'boolean' && res.headersSent) return true;
  return Boolean(typeof res.writableEnded === 'boolean' && res.writableEnded);
}

/**
 * Exponential backoff from 250ms, capped at 2000ms, with +/-25% jitter.
 * `attemptNumber` is 1-based for the retry being scheduled.
 */
function computeBackoffDelay(attemptNumber, random = Math.random, options = {}) {
  const base = options.baseBackoffMs || BASE_BACKOFF_MS;
  const cap = options.maxBackoffMs || MAX_BACKOFF_MS;
  const exponential = base * Math.pow(2, Math.max(0, attemptNumber - 1));
  const bounded = Math.min(exponential, cap);
  const jitter = (random() * 2 - 1) * RETRY_JITTER_RATIO * bounded;
  return Math.max(0, Math.min(cap, Math.round(bounded + jitter)));
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
 * Returns null when absent or unparseable.
 */
function parseRetryAfterHeader(value, nowMs = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const dateMs = Date.parse(raw);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function computeRetryDelay(attemptNumber, retryAfterHeader, random, options) {
  const retryAfterMs = parseRetryAfterHeader(retryAfterHeader);
  const backoffMs = computeBackoffDelay(attemptNumber, random, options);
  if (retryAfterMs === null) return { delayMs: backoffMs, source: 'backoff' };
  return { delayMs: Math.max(retryAfterMs, backoffMs), source: 'retry_after' };
}

/**
 * Decide whether an attempt outcome is eligible for a same-provider retry.
 *
 * `hasFlushed` is the hard stop: once a byte reached the client the response is
 * already committed and nothing may be retried.
 */
function classifyRetryDecision({ attempt, maxAttempts, res, error, statusCode, retryAfter }) {
  const attempts = Number.isInteger(attempt) ? attempt : 0;
  const exhausted = attempts >= (maxAttempts || MAX_ATTEMPTS);
  const code = error ? (error.code || error.errno || null) : null;
  const httpStatus = Number.isInteger(statusCode) ? statusCode : null;
  // The upstream signal is carried on every branch so exhaustion can still
  // surface the final status/code to the client.
  const signal = { attempts, statusCode: httpStatus, code, retryAfter: null };

  if (hasFlushed(res)) return { ...signal, retry: false, reason: 'response_already_flushed', exhausted: false };
  if (error) {
    const retry = isTransportRetryable(code);
    return {
      ...signal,
      retry,
      reason: exhausted ? 'attempts_exhausted' : (retry ? 'transport_never_dialed' : 'transport_indeterminate'),
      exhausted
    };
  }
  if (httpStatus !== null) {
    const retry = isRetryableStatus(httpStatus);
    return {
      ...signal,
      retry,
      reason: retry ? (exhausted ? 'attempts_exhausted' : 'upstream_unavailable_status') : 'upstream_client_error',
      retryAfter: retry && !exhausted ? (retryAfter || null) : null,
      exhausted
    };
  }
  return { ...signal, retry: false, reason: 'no_retryable_signal', exhausted: false };
}

/**
 * Structured error forwarded to the client when retries are exhausted or
 * ineligible. Always carries attempts, the final upstream status (or transport
 * code) and the upstream message verbatim.
 */
function buildExhaustedError({ attempts, statusCode, code, upstreamMessage, decision }) {
  const message = upstreamMessage || (code ? `Bridge transport error: ${code}` : 'Bridge forwarding failed');
  return {
    error: {
      message,
      type: 'upstream_error',
      attempts_made: attempts,
      max_attempts: MAX_ATTEMPTS,
      final_status: Number.isInteger(statusCode) ? statusCode : null,
      final_transport_code: code || null,
      retry_exhausted: Boolean(decision && decision.exhausted),
      retry_suppressed_reason: decision ? decision.reason : null,
      upstream_message: message
    }
  };
}

function buildRequestOptions(url, headers, agent) {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'https:';
  return {
    secure,
    options: {
      hostname: parsed.hostname,
      port: parsed.port || (secure ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers,
      agent: agent || (secure ? undefined : httpAgent)
    }
  };
}

function createAttemptDispatcher(onProgress) {
  const _noop = (status) => status;
  const report = typeof onProgress === 'function' ? onProgress : _noop;

  return function dispatchAttempt(attemptNumber, url, headers, body) {
    const { secure, options } = buildRequestOptions(url, headers);
    const client = secure ? https : http;

    return new Promise((resolve) => {
      let settled = false;
      // Resolved exactly once by whichever of response/error lands first, so a
      // previous attempt can never both succeed and keep running.
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const req = client.request(options, (upstreamRes) => {
        report({ type: 'response', attemptNumber, statusCode: upstreamRes.statusCode });
        settle({
          kind: 'response',
          attempt: attemptNumber,
          statusCode: upstreamRes.statusCode,
          retryAfter: upstreamRes.headers['retry-after'],
          body: upstreamRes
        });
      });

      req.on('error', (err) => {
        report({ type: 'transport_error', attemptNumber, code: err.code || null });
        settle({ kind: 'error', attempt: attemptNumber, code: err.code || null, error: err });
      });

      req.write(body);
      req.end();
    });
  };
}

/**
 * Read an upstream error body verbatim (bounded) for structured surfacing.
 */
function readUpstreamBody(stream, limit = 4000) {
  return new Promise((resolve) => {
    let raw = '';
    const finish = () => resolve(raw);
    stream.on('data', (chunk) => {
      if (raw.length >= limit) return;
      raw += chunk.toString('utf8').slice(0, limit - raw.length);
    });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

function extractUpstreamMessage(rawBody) {
  const text = String(rawBody || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    const candidate = parsed && parsed.error;
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate.message === 'string') return candidate.message;
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch (_) { /* non-JSON error bodies are surfaced verbatim below */ }
  return text;
}

/**
 * Forward a chat/completions POST with same-provider, pre-first-byte retries.
 *
 * The SAME url, headers, body and model are re-sent on every attempt. Once
 * `res` has flushed, retries stop immediately.
 *
 * @returns {Promise<{delivered: boolean, attempts: number, retried: object[], response?: object, error?: object}>}
 */
async function forwardWithRetry(options) {
  const {
    url,
    headers,
    body,
    res,
    onRetry,
    random,
    sleep = defaultSleep,
    dispatch = createAttemptDispatcher()
  } = options;
  const attemptsAllowed = Math.min(options.maxAttempts || MAX_ATTEMPTS, MAX_ATTEMPTS);
  const budgetMs = options.maxRetryBudgetMs || DEFAULT_MAX_RETRY_BUDGET_MS;
  const now = options.now || Date.now;
  const startedAt = now();
  const retried = [];

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    if (hasFlushed(res)) return suppressed(retried, attempt - 1, 'response_already_flushed');

    const outcome = await dispatch(attempt, url, headers, body);

    if (outcome.kind === 'response' && outcome.statusCode < 400) {
      return { delivered: true, attempts: attempt, retried, response: outcome };
    }

    const upstreamMessage = outcome.kind === 'response'
      ? extractUpstreamMessage(await readUpstreamBody(outcome.body))
      : null;

    const decision = classifyRetryDecision({
      attempt,
      maxAttempts: attemptsAllowed,
      res,
      error: outcome.kind === 'error' ? outcome.error : null,
      statusCode: outcome.kind === 'response' ? outcome.statusCode : undefined,
      retryAfter: outcome.kind === 'response' ? outcome.retryAfter : null
    });
    decision.upstreamMessage = upstreamMessage;

    if (!decision.retry || decision.exhausted) return failed(decision, retried, decision.reason);

    const { delayMs, source } = computeRetryDelay(attempt, decision.retryAfter, random);
    if (now() - startedAt + delayMs > budgetMs) {
      return failed(decision, retried, 'retry_budget_exceeded');
    }

    retried.push({
      attempt,
      reason: decision.reason,
      delay_ms: delayMs,
      delay_source: source,
      status: decision.statusCode || null,
      code: decision.code || null
    });
    if (typeof onRetry === 'function') onRetry({ attempt, delayMs, source, decision });
    await sleep(delayMs);
  }

  return suppressed(retried, attemptsAllowed, 'attempts_exhausted');
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failed(decision, retried, suppressedReason) {
  return {
    delivered: false,
    attempts: decision.attempts,
    retried,
    error: {
      ...buildExhaustedError({
        attempts: decision.attempts,
        statusCode: decision.statusCode,
        code: decision.code,
        upstreamMessage: decision.upstreamMessage,
        decision
      }),
      retry_suppressed_reason: suppressedReason
    }
  };
}

function suppressed(retried, attempts, suppressedReason) {
  return {
    delivered: false,
    attempts,
    retried,
    error: {
      ...buildExhaustedError({ attempts, decision: { reason: suppressedReason, exhausted: false } }),
      retry_suppressed_reason: suppressedReason
    }
  };
}

module.exports = {
  MAX_ATTEMPTS,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  DEFAULT_MAX_RETRY_BUDGET_MS,
  RETRYABLE_TRANSPORT_CODES,
  RETRYABLE_HTTP_STATUSES,
  INDETERMINATE_TRANSPORT_CODES,
  retryBudgets,
  capabilityReport,
  isTransportRetryable,
  isRetryableStatus,
  hasFlushed,
  computeBackoffDelay,
  computeRetryDelay,
  parseRetryAfterHeader,
  classifyRetryDecision,
  buildExhaustedError,
  readUpstreamBody,
  extractUpstreamMessage,
  forwardWithRetry
};
