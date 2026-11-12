'use strict';

/**
 * Outbound payload hygiene for the LLM bridge.
 *
 * Tool definitions and tool results ride on every upstream request, so an
 * unbounded result block is re-billed with every subsequent turn of the
 * conversation. These helpers keep the caller's tool order (ordering changes
 * tool-selection behaviour), drop only provably redundant entries, and cap
 * oversized tool output with an explicit marker instead of silently trimming.
 *
 * Two lossless rewrites run before the cap, because truncating is the last
 * resort: HTML is reduced to its readable text, and pretty-printed JSON is
 * minified without altering a single value. Only content that is still too
 * large afterwards loses anything, and then the marker says exactly how much.
 */

const { compressWebOutput } = require('./web_content');
const { getConfigValue } = require('../config_access');

const DEFAULT_MAX_TOOL_OUTPUT_CHARS = getConfigValue('bridge_max_tool_output_chars');
const MARKER_RESERVE_CHARS = 320;
const MIN_JSON_LENGTH = 512;
const JSON_HEADS = new Set(['{', '[']);

function resolveMaxToolOutputChars(options = {}) {
  const override = options.maxToolOutputChars;
  if (Number.isFinite(override) && override > 0) return override;
  const fromEnv = Number(process.env.KONOHA_BRIDGE_MAX_TOOL_OUTPUT_CHARS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
}

/**
 * Drop repeated tool definitions by name, keeping the first occurrence so the
 * surviving order matches the caller exactly. Definitions without a name are
 * unusable upstream and are dropped as well.
 */
function dedupeToolDefinitions(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  const seen = new Set();
  const kept = [];
  for (const tool of tools) {
    const name = tool && tool.function ? tool.function.name : null;
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    kept.push(tool);
  }
  return kept;
}

/**
 * Minify a JSON tool result without changing its values. Pretty printing costs
 * two to four characters per field on real payloads, which is pure billing
 * overhead once the model reads it.
 */
function compactJsonOutput(text) {
  if (typeof text !== 'string' || text.length < MIN_JSON_LENGTH) return { text, changed: false };
  const trimmed = text.trimStart();
  if (!JSON_HEADS.has(trimmed[0])) return { text, changed: false };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text, changed: false };
  }
  if (parsed === null || typeof parsed !== 'object') return { text, changed: false };
  const minified = JSON.stringify(parsed);
  if (minified.length >= text.length) return { text, changed: false };
  return { text: minified, changed: true };
}

function truncateWithMarker(text, maxChars) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxChars) return text;
  const budget = Math.max(0, maxChars - MARKER_RESERVE_CHARS);
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  const dropped = text.length - head - tail;
  const marker = `\n\n[…konoha bridge truncated ${dropped} characters (${text.length} total) to keep this tool result within ${maxChars} characters; request a narrower range for the full content.]\n\n`;
  return text.slice(0, head) + marker + (tail > 0 ? text.slice(text.length - tail) : '');
}

/**
 * Cap the text of tool-result messages without mutating the caller's array.
 * Only role `tool` messages are touched: assistant text and user prompts are
 * never rewritten, so intent is preserved.
 */
function capToolOutputs(messages, options = {}) {
  if (!Array.isArray(messages)) return messages;
  const maxChars = resolveMaxToolOutputChars(options);
  let truncated = 0;
  let reclaimedChars = 0;
  let htmlCompressed = 0;
  let reclaimedHtmlChars = 0;
  let jsonCompacted = 0;
  let reclaimedJsonChars = 0;

  const capped = messages.map((msg) => {
    if (!msg || msg.role !== 'tool' || typeof msg.content !== 'string') return msg;

    const web = compressWebOutput(msg.content);
    let content = web.changed ? web.text : msg.content;
    if (web.changed) {
      htmlCompressed += 1;
      reclaimedHtmlChars += msg.content.length - content.length;
    }

    const json = compactJsonOutput(content);
    if (json.changed) {
      reclaimedJsonChars += content.length - json.text.length;
      jsonCompacted += 1;
      content = json.text;
    }

    if (content.length <= maxChars) {
      return content === msg.content ? msg : { ...msg, content };
    }

    const next = truncateWithMarker(content, maxChars);
    truncated += 1;
    reclaimedChars += content.length - next.length;
    return { ...msg, content: next };
  });

  if (truncated === 0 && htmlCompressed === 0 && jsonCompacted === 0) return messages;
  Object.defineProperty(capped, '_toolOutputStats', {
    value: { truncated, reclaimedChars, maxChars, htmlCompressed, reclaimedHtmlChars, jsonCompacted, reclaimedJsonChars },
    enumerable: false
  });
  return capped;
}

/**
 * Byte/token accounting for one outbound payload. Used for honest telemetry:
 * values describe what was actually sent, never an estimate of what might have
 * been saved.
 */
function measurePayload(payload) {
  if (!payload || typeof payload !== 'object') return { toolsBytes: 0, messagesBytes: 0, systemBytes: 0, estimatedTokens: 0 };
  const bytes = (v) => (v === undefined || v === null ? 0 : JSON.stringify(v).length);
  const toolsBytes = bytes(payload.tools);
  const messagesBytes = bytes(payload.messages);
  const systemBytes = bytes(payload.system);
  const total = toolsBytes + messagesBytes + systemBytes;
  return { toolsBytes, messagesBytes, systemBytes, estimatedTokens: Math.ceil(total / 3.5) };
}

module.exports = {
  DEFAULT_MAX_TOOL_OUTPUT_CHARS,
  resolveMaxToolOutputChars,
  dedupeToolDefinitions,
  compactJsonOutput,
  capToolOutputs,
  truncateWithMarker,
  measurePayload
};
