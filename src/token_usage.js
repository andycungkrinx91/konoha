'use strict';

/**
 * src/token_usage.js — provider-reported token usage, recorded or explicitly absent.
 *
 * The budget report and the savings logger both used to present byte-derived
 * estimates as if a provider had measured them. Keeping the two apart is the
 * point of this module: `normalizeUsage` returns `available: false` with a
 * reason when a provider said nothing, so no caller can print a fabricated
 * number where a measurement belongs.
 */

const { extractCachedTokens } = require('./bridge/cache_capability');

/** Provider field spellings that carry a real prompt/completion count. */
const INPUT_KEYS = ['prompt_tokens', 'input_tokens', 'promptTokenCount'];
const OUTPUT_KEYS = ['completion_tokens', 'output_tokens', 'candidatesTokenCount'];

function _firstFinite(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/**
 * Normalize a provider usage object onto the fields every consumer reads.
 *
 * @param {object|null} usage raw provider usage
 * @returns {{available: boolean, reason?: string, input_tokens: number|null,
 *   output_tokens: number|null, total_tokens: number|null, cache_read_input_tokens: number|null}}
 *   `available` is false whenever no provider count was present. The token
 *   fields are then null, never 0: "not measured" is not "measured zero".
 */
function normalizeUsage(usage) {
  const absent = { available: false, reason: 'no provider usage recorded', input_tokens: null, output_tokens: null, total_tokens: null, cache_read_input_tokens: null };
  if (!usage || typeof usage !== 'object') return absent;

  const input = _firstFinite(usage, INPUT_KEYS);
  const output = _firstFinite(usage, OUTPUT_KEYS);
  const total = _firstFinite(usage, ['total_tokens', 'totalTokenCount'])
    ?? (input !== null && output !== null ? input + output : null);
  const cached = extractCachedTokens(usage);

  if (input === null && output === null) return absent;
  return {
    available: true,
    method: 'provider_reported',
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    cache_read_input_tokens: cached
  };
}

module.exports = { normalizeUsage };
