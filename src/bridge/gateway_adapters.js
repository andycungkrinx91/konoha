'use strict';

const http = require('http');
const {
  httpAgent,
  STREAM_TIMEOUT_MS,
  STREAM_INACTIVITY_MS,
  sendJson,
  resolveBridgeAndModel,
  sanitizeForwardHeaders,
  readBody,
  pipeWithModelRewrite
} = require('./gateway_router');
const { dedupeToolDefinitions, capToolOutputs } = require('./tool_payload');
const { normalizeUsage } = require('../token_usage');
const { recordProviderUsage, PROVIDER_USAGE_SOURCES } = require('../provider_usage_logger');
const { validateRequestBudget, LIMITS } = require('./request_budget');

// Anthropic's wire schema requires integer usage counts: `input_tokens` and
// `output_tokens` on a message, and `output_tokens` on a `message_delta`.
// When the provider reported neither there is no schema-valid usage to emit,
// and fabricating zeros would misreport billing. Fail instead.
const USAGE_UNAVAILABLE_MESSAGE =
  'Upstream reported no token usage; refusing to emit a schema-invalid Anthropic response';

/**
 * Persist what the upstream provider actually reported. Best-effort: the
 * response has already been written, so a telemetry failure must not surface.
 */
function recordUpstreamUsage(usage, meta) {
  try {
    recordProviderUsage({ source: PROVIDER_USAGE_SOURCES.GATEWAY, usage, ...meta });
  } catch (_) { /* telemetry must never break a response */ }
}

function extractAnthropicSystemText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return '';
}

/**
 * Resolve the active client id; best-effort lazy load so require-time
 * failures (missing db) do not abort the bridge.
 */
function resolveClient() {
  try {
    const { detectActiveClient } = require('../tools_savings_logger');
    return detectActiveClient() || 'unattributed';
  } catch (_) {
    return 'unattributed';
  }
}

function convertContentBlock(block, state) {
  if (block.type === 'text') {
    state.textParts.push({ type: 'text', text: block.text || '' });
    return;
  }
  if (block.type === 'image' && block.source) {
    state.textParts.push({
      type: 'image_url',
      image_url: { url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}` }
    });
    return;
  }
  if (block.type === 'tool_use') {
    state.toolCalls.push({
      id: block.id || 'call_unknown',
      type: 'function',
      function: {
        name: block.name,
        arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {})
      }
    });
    return;
  }
  if (block.type === 'tool_result') {
    const resultContent = Array.isArray(block.content)
      ? block.content.map((c) => (c.type === 'text' ? c.text : '')).filter(Boolean).join('\n')
      : block.content || '';
    state.toolResults.push({
      role: 'tool',
      tool_call_id: block.tool_use_id || '',
      content: resultContent
    });
  }
}

function pushConvertedBlocks(role, state, result) {
  if (state.toolResults.length > 0) {
    if (state.textParts.length > 0) result.push({ role: 'user', content: state.textParts });
    result.push(...state.toolResults);
    return;
  }
  if (state.toolCalls.length > 0) {
    result.push({ role: 'assistant', content: state.textParts, tool_calls: state.toolCalls });
    return;
  }
  result.push({ role, content: state.textParts });
}

function processSingleAnthropicMessage(msg, result) {
  const role = msg.role;
  const content = msg.content;
  if (typeof content === 'string') {
    result.push({ role, content });
    return;
  }
  if (!Array.isArray(content)) {
    result.push({ role, content: '' });
    return;
  }
  const state = { textParts: [], toolCalls: [], toolResults: [] };
  for (const block of content) convertContentBlock(block, state);
  pushConvertedBlocks(role, state, result);
}

function anthropicMessagesToOpenAi(system, messages) {
  const result = [];
  if (system) {
    result.push({ role: 'system', content: typeof system === 'string' ? system : extractAnthropicSystemText(system) });
  }
  for (const msg of messages) {
    processSingleAnthropicMessage(msg, result);
  }
  return result;
}

function anthropicToolsToOpenAi(tools) {
  if (!tools || tools.length === 0) return null;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} }
    }
  }));
}

function writeAnthropicToolCallBlocks(res, toolCalls, hasText) {
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const idx = i + (hasText ? 1 : 0);
    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments || '{}' } })}\n\n`);
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: idx })}\n\n`);
  }
}

function streamEmptyAnthropicMessage(res, model, msgId, openAiResp) {
  const usage = completeAnthropicUsage(openAiResp);
  if (!usage) {
    sendAnthropicErrorResponse(res, 502, 'api_error', USAGE_UNAVAILABLE_MESSAGE, true);
    return;
  }
  const startMessage = { id: `msg_${msgId}`, type: 'message', role: 'assistant', model: model || 'unknown', content: [], stop_reason: null, usage };
  res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: startMessage })}\n\n`);
  res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop', delta: { stop_reason: 'stop' } })}\n\n`);
  res.end();
}

function streamOpenAIResponseToAnthropic(openAiResp, options) {
  const { model, msgId, res } = options;
  const choices = openAiResp.choices || [];
  if (choices.length === 0) {
    streamEmptyAnthropicMessage(res, model, msgId, openAiResp);
    return;
  }

  const choice = choices[0];
  const msg = choice.message || {};
  const toolCalls = msg.tool_calls || [];
  const textContent = (msg.content || '').toString();

  const usage = completeAnthropicUsage(openAiResp);
  if (!usage) {
    sendAnthropicErrorResponse(res, 502, 'api_error', USAGE_UNAVAILABLE_MESSAGE, true);
    return;
  }
  const mainMessage = { id: `msg_${msgId}`, type: 'message', role: 'assistant', model: model || 'unknown', content: [], stop_reason: null, usage };
  res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: mainMessage })}\n\n`);

  if (textContent) {
    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: textContent } })}\n\n`);
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  }

  writeAnthropicToolCallBlocks(res, toolCalls, Boolean(textContent));

  const stopReason = choice.finish_reason || 'stop';
  res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason === 'tool_calls' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage })}\n\n`);
  res.write('event: message_stop\ndata: {}\n\n');
  res.end();
}

function nonStreamOpenAIResponseToAnthropic(openAiResp, options) {
  const { model, msgId, res } = options;
  const choices = openAiResp.choices || [];
  const choice = choices[0] || {};
  const msg = choice.message || {};
  const toolCalls = msg.tool_calls || [];
  const textContent = (msg.content || '').toString();

  const contentBlocks = [];
  for (const tc of toolCalls) {
    let input;
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch { input = {}; }
    contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
  }
  if (textContent) {
    contentBlocks.push({ type: 'text', text: textContent });
  }

  const usage = completeAnthropicUsage(openAiResp);
  if (!usage) {
    sendAnthropicErrorResponse(res, 502, 'api_error', USAGE_UNAVAILABLE_MESSAGE, false);
    return;
  }

  sendJson(res, 200, {
    id: `msg_${msgId}`,
    type: 'message',
    role: 'assistant',
    model: model || 'unknown',
    content: contentBlocks,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage
  });
}

function openAIResponseToAnthropic(openAiResp, options) {
  if (options.isStream) {
    streamOpenAIResponseToAnthropic(openAiResp, options);
    return;
  }
  nonStreamOpenAIResponseToAnthropic(openAiResp, options);
}

/**
 * Translate upstream [OI]-shaped usage into an Anthropic usage object.
 *
 * Counts come only from what the provider reported: an unreported count stays
 * null, which is how a consumer tells "provider gave no breakdown" apart from
 * "provider measured zero". `normalizeUsage` also accepts Anthropic-native
 * field spellings, so an already-translated upstream is not re-estimated.
 */
function buildAnthropicUsage(openAiResp) {
  const measured = normalizeUsage(openAiResp && openAiResp.usage);
  const result = {
    input_tokens: measured.available ? measured.input_tokens : null,
    output_tokens: measured.available ? measured.output_tokens : null
  };
  if (measured.cache_read_input_tokens !== null) result.cache_read_input_tokens = measured.cache_read_input_tokens;
  return result;
}

/**
 * Anthropic's wire `usage` declares integer counts. When a provider reported
 * nothing, the honest options are (a) omit the field or (b) emit a fabricated
 * 0. We omit: a client that null-coalesces is correct, a client that trusts a
 * fake zero is not. A genuine provider zero (measured, `0`) still passes
 * through, so "unknown" and "measured zero" stay distinguishable on the wire.
 */
function anthropicUsageWire(usage) {
  const out = {};
  for (const [key, value] of Object.entries(usage || {})) {
    // Anthropic token counts are integers; a fractional or unsafe value is not
    // a measurement we can publish.
    if (Number.isSafeInteger(value) && value >= 0) out[key] = value;
  }
  return out;
}

/**
 * Build the wire usage only when it satisfies the Anthropic schema. A message
 * and a `message_start` both require integer `input_tokens` and `output_tokens`,
 * and a `message_delta` requires `output_tokens`; the SDK accumulator reads
 * `usage.output_tokens` unconditionally. A provider that reported neither count
 * leaves no schema-valid usage, so this returns null and the caller fails the
 * request instead of emitting `{}` or a fabricated zero.
 */
function completeAnthropicUsage(openAiResp) {
  const wire = anthropicUsageWire(buildAnthropicUsage(openAiResp));
  if (typeof wire.input_tokens !== 'number' || typeof wire.output_tokens !== 'number') return null;
  return wire;
}

/**
 * `stream_options.include_usage` is an [OI] Chat Completions field, and the
 * local bridge forwards to an [OI]-compatible upstream by construction, so it
 * is requested by default. A bridge pointed at a server that rejects unknown
 * parameters sets `supportsStreamUsage: false` to opt out.
 */
function supportsStreamUsage(bridgeConfig) {
  if (!bridgeConfig) return true;
  return bridgeConfig.supportsStreamUsage !== false;
}

function buildOpenAiPayloadFromAnthropic(body, targetModel, bridgeConfig) {
  const isStream = body.stream === true;
  const openAiPayload = {
    model: targetModel,
    messages: capToolOutputs(anthropicMessagesToOpenAi(body.system, body.messages || [])),
    stream: isStream,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stop: body.stop_sequences
  };
  // Tool order is taken verbatim from the caller. anthropicToolsToOpenAi maps
  // over the input array, so order is already deterministic per request, and
  // preserving the caller's order avoids perturbing tool-selection behaviour.
  const tools = dedupeToolDefinitions(anthropicToolsToOpenAi(body.tools));
  if (Array.isArray(tools) && tools.length > 0) openAiPayload.tools = tools;

  if (body.compactContext === true) {
    openAiPayload.compactContext = true;
  }
  // The [OI] Chat Completions streaming contract gates the final usage-bearing
  // chunk behind this field, and `coalesceOpenAiStreamToAnthropic` reads
  // `chunk.usage`; without it every streamed response's token columns stay null.
  if (isStream && supportsStreamUsage(bridgeConfig)) openAiPayload.stream_options = { include_usage: true };
  for (const k of Object.keys(openAiPayload)) {
    if (openAiPayload[k] === undefined || openAiPayload[k] === null) delete openAiPayload[k];
  }
  return openAiPayload;
}

/**
 * Fail a translated Anthropic request. Streams get an `error` SSE event, which
 * the SDK surfaces verbatim; it precedes `message_start`, so the accumulator
 * never sees an out-of-order or schema-invalid event.
 */
function sendAnthropicErrorResponse(res, statusCode, errType, message, isStream) {
  const body = { type: 'error', error: { type: errType, message } };
  if (isStream) {
    if (!res.headersSent) res.writeHead(statusCode, { 'Content-Type': 'text/event-stream' });
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
      res.end();
    }
    return;
  }
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  sendJson(res, statusCode, body);
}

function sendAnthropicUpstreamError(raw, statusCode, isStream, res) {
  if (res.headersSent) return;
  if (isStream) res.writeHead(statusCode, { 'Content-Type': 'text/event-stream' });
  try {
    const parsed = JSON.parse(raw);
    const errType = statusCode === 429 ? 'rate_limit_error' : 'api_error';
    const msg = parsed.error?.message || `Bridge returned ${statusCode}`;
    if (isStream) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errType, message: msg } })}\n\n`);
      res.end();
      return;
    }
    sendJson(res, statusCode, { type: 'error', error: { type: errType, message: msg } });
  } catch {
    sendJson(res, statusCode, { type: 'error', error: { type: 'api_error', message: raw.slice(0, 500) } });
  }
}

function handleAnthropicUpstreamError(forwardRes, isStream, res) {
  let raw = '';
  forwardRes.on('data', (c) => { raw += c.toString('utf8'); });
  forwardRes.on('end', () => sendAnthropicUpstreamError(raw, forwardRes.statusCode, isStream, res));
}

function accumulateToolCallDeltas(delta, toolCalls) {
  if (!delta.tool_calls) return;
  for (const tcd of delta.tool_calls) {
    const idx = tcd.index !== undefined ? tcd.index : toolCalls.length;
    if (!toolCalls[idx]) toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    if (tcd.id) toolCalls[idx].id = tcd.id;
    if (tcd.function?.name) toolCalls[idx].function.name += tcd.function.name;
    if (tcd.function?.arguments) toolCalls[idx].function.arguments += tcd.function.arguments;
  }
}

function coalesceOpenAiStreamToAnthropic(buffer, targetModel, msgId, res, usageMeta) {
  const lines = buffer.split('\n').filter((l) => l.startsWith('data:'));
  let content = '';
  const toolCalls = [];

  let streamUsage = null;
  for (const ln of lines) {
    const json = ln.replace(/^data:\s*/, '').trim();
    if (!json || json === '[DONE]') continue;
    try {
      const chunk = JSON.parse(json);
      // OpenAI-compatible servers emit a final usage-bearing chunk when
      // stream_options.include_usage is set; keep the last one seen.
      if (chunk.usage && typeof chunk.usage === 'object') streamUsage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) content += delta.content;
      accumulateToolCallDeltas(delta, toolCalls);
    } catch { /* ignore malformed SSE chunks */ }
  }

  const openAiResp = {
    choices: [{
      index: 0,
      message: { role: 'assistant', content, tool_calls: toolCalls },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
    }]
  };
  if (streamUsage) openAiResp.usage = streamUsage;
  recordUpstreamUsage(streamUsage, { ...usageMeta, model: targetModel, stream: true });
  openAIResponseToAnthropic(openAiResp, { model: targetModel, msgId, isStream: true, res });
}

function pipeAnthropicStreamResponse(forwardRes, targetModel, res, resetStreamTimeout, usageMeta) {
  let buffer = '';
  const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  forwardRes.on('data', (chunk) => {
    resetStreamTimeout();
    buffer += chunk.toString('utf8');
  });
  forwardRes.on('end', () => coalesceOpenAiStreamToAnthropic(buffer, targetModel, msgId, res, usageMeta));
  forwardRes.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Upstream stream error: ${err.message}` } });
    }
  });
}

function handleAnthropicNonStreamData(raw, targetModel, res, usageMeta) {
  try {
    const parsed = JSON.parse(raw);
    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    recordUpstreamUsage(parsed && parsed.usage, { ...usageMeta, model: targetModel, stream: false });
    openAIResponseToAnthropic(parsed, { model: targetModel, msgId, isStream: false, res });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Malformed bridge response: ${err.message}` } });
    }
  }
}

function pipeAnthropicNonStreamResponse(forwardRes, targetModel, res, usageMeta) {
  let raw = '';
  forwardRes.on('data', (c) => { raw += c.toString('utf8'); });
  forwardRes.on('end', () => handleAnthropicNonStreamData(raw, targetModel, res, usageMeta));
  forwardRes.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Upstream error: ${err.message}` } });
    }
  });
}

function handleAnthropicResponse(forwardRes, options) {
  const { isStream, targetModel, res, resetStreamTimeout, usageMeta } = options;
  if (forwardRes.statusCode >= 400) {
    handleAnthropicUpstreamError(forwardRes, isStream, res);
    return;
  }
  if (isStream) {
    pipeAnthropicStreamResponse(forwardRes, targetModel, res, resetStreamTimeout, usageMeta);
    return;
  }
  pipeAnthropicNonStreamResponse(forwardRes, targetModel, res, usageMeta);
}

function setupStreamEvents(forwardReq, res, options) {
  const { bridgeName, getLastActivity } = options;
  forwardReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { type: 'error', error: { type: 'api_error', message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}` } } });
    }
  });

  forwardReq.on('timeout', () => {
    const inactivityMs = Date.now() - getLastActivity();
    if (inactivityMs <= STREAM_INACTIVITY_MS) {
      forwardReq.setTimeout(STREAM_TIMEOUT_MS);
      return;
    }
    forwardReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: { type: 'error', error: { type: 'cancelled', message: `Bridge request timed out: no data for ${inactivityMs}ms` } } });
    }
  });
}

/**
 * Reject an oversized body from its Content-Length header before any bytes are
 * buffered. Streaming/chunked requests without a length fall through to the
 * post-parse guard, which remains the backstop.
 */
function rejectOversizedByHeader(req, res, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (!Number.isFinite(declared) || declared <= 0) return false;
  if (declared <= maxBytes) return false;
  sendJson(res, 413, {
    error: {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Request rejected: declared body of ${declared} bytes exceeds the ${maxBytes} byte limit`
      }
    }
  });
  return true;
}

async function handleAnthropicMessages(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  const resetStreamTimeout = () => { lastActivityTime = Date.now(); };

  try {
    if (rejectOversizedByHeader(req, res, LIMITS.MAX_BODY_BYTES)) return false;
    const bodyStr = await readBody(req, LIMITS.MAX_BODY_BYTES);
    const body = JSON.parse(bodyStr);
    // Second gate: a caller may omit Content-Length, so the parsed payload is
    // still checked before any upstream tokens are billed.
    const model = body.model;
    if (!model || typeof model !== 'string') {
      return sendJson(res, 400, { error: { type: 'error', error: { type: 'invalid_request_error', message: 'Missing model parameter' } } });
    }

    const resolved = await resolveBridgeAndModel(model, activeBridges);
    if (!resolved) {
      return sendJson(res, 404, { error: { type: 'error', error: { type: 'not_found', message: `No suitable bridge found for model: "${model}"` } } });
    }

    const { active, bridgeName, targetModel } = resolved;
    const isGemini = /gemini/i.test(model) || /gemini/i.test(targetModel || '') || /gemini/i.test(bridgeName || '');
    const budget = validateRequestBudget(body, { is_gemini: isGemini, model: targetModel || model });
    if (!budget.ok) {
      return sendJson(res, 413, {
        error: { type: 'error', error: { type: 'invalid_request_error', message: `Request rejected: ${budget.detail}` } },
        konoha_budget: budget
      });
    }
    const effectiveBody = budget.payload || body;
    const isStream = effectiveBody.stream === true;
    const openAiPayload = buildOpenAiPayloadFromAnthropic(effectiveBody, targetModel, active.bridgeConfig);
    const rewrittenBody = JSON.stringify(openAiPayload);

    const headers = sanitizeForwardHeaders(req.headers);
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);
    if (active.bridgeConfig.apiKey) {
      headers['authorization'] = `Bearer ${active.bridgeConfig.apiKey}`;
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers,
      agent: httpAgent,
      timeout: STREAM_TIMEOUT_MS
    }, (forwardRes) => {
      handleAnthropicResponse(forwardRes, {
        isStream,
        targetModel,
        res,
        resetStreamTimeout,
        usageMeta: {
          provider: (active.bridgeConfig && active.bridgeConfig.provider) || null,
          bridgeName,
          client: resolveClient()
        }
      });
    });

    setupStreamEvents(forwardReq, res, { bridgeName, getLastActivity: () => lastActivityTime });
    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      const status = err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
      sendJson(res, status, { error: { type: 'error', error: { type: 'api_error', message: err.message } } });
    }
  }
}

function setupGeminiStreamEvents(forwardReq, res, options) {
  const { bridgeName, getLastActivity } = options;
  forwardReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { code: 502, message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`, status: 'INTERNAL' } });
    }
  });

  forwardReq.on('timeout', () => {
    const inactivityMs = Date.now() - getLastActivity();
    if (inactivityMs <= STREAM_INACTIVITY_MS) {
      forwardReq.setTimeout(STREAM_TIMEOUT_MS);
      return;
    }
    forwardReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: { code: 504, message: `Bridge request timed out: no data for ${inactivityMs}ms`, status: 'DEADLINE_EXCEEDED' } });
    }
  });
}

async function handleGeminiRequest(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  const resetStreamTimeout = () => { lastActivityTime = Date.now(); };

  const pathname = req.url;
  const match = pathname.match(/\/v1beta\/models\/([^/:]+)(?::(\w+))?/);
  if (!match) {
    return sendJson(res, 400, { error: { code: 400, message: 'Invalid pathname format', status: 'INVALID_ARGUMENT' } });
  }

  const model = match[1];
  const resolved = await resolveBridgeAndModel(model, activeBridges);
  if (!resolved) {
    return sendJson(res, 404, { error: { code: 404, message: `No suitable bridge found for model: "${model}"`, status: 'NOT_FOUND' } });
  }

  const { active, bridgeName, targetModel } = resolved;
  try {
    const rewrittenPath = pathname.replace(model, targetModel);
    const rewrittenBody = await readBody(req);
    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: rewrittenPath,
      method: req.method,
      headers,
      agent: httpAgent,
      timeout: STREAM_TIMEOUT_MS
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, { baseModel: targetModel, originalModel: model, onActivity: resetStreamTimeout });
    });

    setupGeminiStreamEvents(forwardReq, res, { bridgeName, getLastActivity: () => lastActivityTime });
    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      const status = err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
      sendJson(res, status, { error: { code: status, message: err.message, status: 'INTERNAL' } });
    }
  }
}

module.exports = {
  anthropicMessagesToOpenAi,
  extractAnthropicSystemText,
  anthropicToolsToOpenAi,
  buildOpenAiPayloadFromAnthropic,
  buildAnthropicUsage,
  anthropicUsageWire,
  completeAnthropicUsage,
  supportsStreamUsage,
  sendAnthropicErrorResponse,
  USAGE_UNAVAILABLE_MESSAGE,
  openAIResponseToAnthropic,
  handleAnthropicMessages,
  handleGeminiRequest
};
