'use strict';

/**
 * Prompt-prefix stability utilities.
 *
 * Upstream prefix caches (OpenAI, Gemini 2.5+, DeepSeek, xAI) key on an exact
 * byte match of the leading messages. Any volatile value — a timestamp, a
 * request id, a shuffled tool list — invalidates the cache and re-bills the
 * whole prefix at full price. These helpers make the prefix deterministic and
 * report precisely what changed, so a cache miss is explainable instead of
 * invisible.
 */

const VOLATILE_PATTERNS = [
  { name: 'iso_timestamp', re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g },
  { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { name: 'epoch_ms', re: /\b1[6-9]\d{11}\b/g },
  { name: 'crypto_job_id', re: /\bjob_\d{10,}_[0-9a-f]{6,}\b/g }
];

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Sort tool definitions by name so the same toolset always serialises
 * identically, regardless of how the caller ordered it.
 */
function sortToolsStable(tools) {
  if (!Array.isArray(tools)) return tools;
  return [...tools].sort((a, b) => {
    const an = a?.function?.name || a?.name || '';
    const bn = b?.function?.name || b?.name || '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/**
 * Detect volatile values that would break prefix caching, without altering
 * them. Callers decide whether to normalise, and telemetry records the cause.
 */
function findVolatileSegments(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = [];
  for (const { name, re } of VOLATILE_PATTERNS) {
    re.lastIndex = 0;
    let match = re.exec(text);
    while (match) {
      found.push({ kind: name, value: match[0], index: match.index });
      match = re.exec(text);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Compute a short stable fingerprint for a message prefix so consecutive
 * turns can be compared cheaply.
 */
function fingerprintPrefix(messages) {
  const crypto = require('crypto');
  const payload = stableStringify(Array.isArray(messages) ? messages : []);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Report how much of the previous prefix survived into the new request.
 * A result of full reuse means the upstream cache should hit for those tokens.
 */
function summarizePrefixReuse(previousPrefix, nextMessages) {
  if (!Array.isArray(previousPrefix) || previousPrefix.length === 0) {
    return { previous_len: 0, reused_len: 0, reused: false, diverged_at: null };
  }
  if (!Array.isArray(nextMessages) || nextMessages.length === 0) {
    return { previous_len: previousPrefix.length, reused_len: 0, reused: false, diverged_at: 0 };
  }
  let i = 0;
  while (i < previousPrefix.length && i < nextMessages.length) {
    if (stableStringify(previousPrefix[i]) !== stableStringify(nextMessages[i])) break;
    i += 1;
  }
  return {
    previous_len: previousPrefix.length,
    reused_len: i,
    reused: i === previousPrefix.length,
    diverged_at: i < previousPrefix.length ? i : null
  };
}

module.exports = {
  stableStringify,
  sortToolsStable,
  findVolatileSegments,
  fingerprintPrefix,
  summarizePrefixReuse
};
