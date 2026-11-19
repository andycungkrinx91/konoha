'use strict';

/**
 * src/provider_usage_logger.js — persist provider-reported token usage.
 *
 * `tool_calls` measures how much a Konoha tool saved in bytes; it is not a
 * record of what an LLM provider billed. Gateway traffic (`/v1/messages` ->
 * bridge `/v1/chat/completions`) never produced a tool row at all, so
 * `tool_calls.input_tokens` was NULL for every real runtime write and the
 * budget report could only ever print estimates.
 *
 * This writer fills that hole without touching tool-call accounting:
 * `queryStats`/`getSavingsReport` count every `tool_calls` row as a call, so a
 * pseudo-row per gateway request would have inflated savings and per-client
 * attribution. Rows land in `provider_usage` instead, which no savings query
 * reads.
 *
 * Only a provider payload is ever written. When the provider reported nothing,
 * nothing is inserted — there is no byte-derived fallback, because a fabricated
 * count is worse than a missing one.
 */

const { getDb } = require('./db');
const { normalizeUsage } = require('./token_usage');

/**
 * The `source` column enumerates writers, per the approved plan:
 * `gateway` — one bridged provider response. Two writers produce it:
 *   `handleAnthropicMessages` (`src/bridge/gateway_adapters.js`) and the
 *   per-bridge `/v1/messages` handler (`src/bridge/handlers/anthropic.js`).
 *   Both answer the same request shape against the same upstream population, so
 *   they share the value; `bridge_name` distinguishes the two.
 * `tool_call` — reserved for mirroring provider usage attached to a
 *   `tool_calls` row. Nothing writes it today.
 */
const PROVIDER_USAGE_SOURCES = Object.freeze({ GATEWAY: 'gateway', TOOL_CALL: 'tool_call' });

function closeQuietly(conn) {
  if (!conn) return;
  try { conn.close(); } catch (_) { /* ignore close error */ }
}

function insertRow(conn, event, measured) {
  conn.prepare(`
    INSERT INTO provider_usage
    (source, provider, model, client, bridge_name, stream,
     input_tokens, output_tokens, cached_tokens, total_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(event.source || PROVIDER_USAGE_SOURCES.GATEWAY).slice(0, 40),
    event.provider ? String(event.provider).slice(0, 100) : null,
    event.model ? String(event.model).slice(0, 200) : null,
    event.client ? String(event.client).slice(0, 100) : null,
    event.bridgeName ? String(event.bridgeName).slice(0, 100) : null,
    event.stream ? 1 : 0,
    measured.input_tokens,
    measured.output_tokens,
    measured.cache_read_input_tokens,
    measured.total_tokens
  );
}

/**
 * @param {object} event
 * @param {string} event.source - `gateway` | `tool_call`
 * @param {object|null} event.usage - raw provider usage payload
 * @param {string} [event.provider]
 * @param {string} [event.model]
 * @param {string} [event.client]
 * @param {string} [event.bridgeName]
 * @param {boolean} [event.stream]
 * @param {string|null} [dbPath]
 * @returns {{recorded: boolean, reason?: string}}
 */
function recordProviderUsage(event = {}, dbPath = null) {
  const measured = normalizeUsage(event.usage);
  if (!measured.available) return { recorded: false, reason: measured.reason };

  let conn = null;
  try {
    conn = getDb(dbPath || undefined);
    insertRow(conn, event, measured);
    return { recorded: true };
  } catch (_) {
    // Telemetry must never break a response that is already being written.
    return { recorded: false, reason: 'write_failed' };
  } finally {
    closeQuietly(conn);
  }
}

module.exports = { recordProviderUsage, PROVIDER_USAGE_SOURCES };
