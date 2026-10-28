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

function extractAnthropicSystemText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return '';
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

function streamEmptyAnthropicMessage(res, model, msgId) {
  res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: `msg_${msgId}`, type: 'message', role: 'assistant', model: model || 'unknown', content: [], stop_reason: null } })}\n\n`);
  res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop', delta: { stop_reason: 'stop' }, usage: { output_tokens: 0 } })}\n\n`);
  res.end();
}

function streamOpenAIResponseToAnthropic(openAiResp, options) {
  const { model, msgId, res } = options;
  const choices = openAiResp.choices || [];
  if (choices.length === 0) {
    streamEmptyAnthropicMessage(res, model, msgId);
    return;
  }

  const choice = choices[0];
  const msg = choice.message || {};
  const toolCalls = msg.tool_calls || [];
  const textContent = (msg.content || '').toString();

  res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: `msg_${msgId}`, type: 'message', role: 'assistant', model: model || 'unknown', content: [], stop_reason: null } })}\n\n`);

  if (textContent) {
    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: textContent } })}\n\n`);
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  }

  writeAnthropicToolCallBlocks(res, toolCalls, Boolean(textContent));

  const stopReason = choice.finish_reason || 'stop';
  res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason === 'tool_calls' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
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

  sendJson(res, 200, {
    id: `msg_${msgId}`,
    type: 'message',
    role: 'assistant',
    model: model || 'unknown',
    content: contentBlocks,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 }
  });
}

function openAIResponseToAnthropic(openAiResp, options) {
  if (options.isStream) {
    streamOpenAIResponseToAnthropic(openAiResp, options);
    return;
  }
  nonStreamOpenAIResponseToAnthropic(openAiResp, options);
}

function buildOpenAiPayloadFromAnthropic(body, targetModel) {
  const isStream = body.stream === true;
  const openAiPayload = {
    model: targetModel,
    messages: anthropicMessagesToOpenAi(body.system, body.messages || []),
    stream: isStream,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stop: body.stop_sequences
  };
  const tools = anthropicToolsToOpenAi(body.tools);
  if (tools) openAiPayload.tools = tools;

  for (const k of Object.keys(openAiPayload)) {
    if (openAiPayload[k] === undefined || openAiPayload[k] === null) delete openAiPayload[k];
  }
  return openAiPayload;
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

function coalesceOpenAiStreamToAnthropic(buffer, targetModel, msgId, res) {
  const lines = buffer.split('\n').filter((l) => l.startsWith('data:'));
  let content = '';
  const toolCalls = [];

  for (const ln of lines) {
    const json = ln.replace(/^data:\s*/, '').trim();
    if (!json || json === '[DONE]') continue;
    try {
      const chunk = JSON.parse(json);
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
  openAIResponseToAnthropic(openAiResp, { model: targetModel, msgId, isStream: true, res });
}

function pipeAnthropicStreamResponse(forwardRes, targetModel, res, resetStreamTimeout) {
  let buffer = '';
  const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  forwardRes.on('data', (chunk) => {
    resetStreamTimeout();
    buffer += chunk.toString('utf8');
  });
  forwardRes.on('end', () => coalesceOpenAiStreamToAnthropic(buffer, targetModel, msgId, res));
  forwardRes.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Upstream stream error: ${err.message}` } });
    }
  });
}

function handleAnthropicNonStreamData(raw, targetModel, res) {
  try {
    const parsed = JSON.parse(raw);
    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openAIResponseToAnthropic(parsed, { model: targetModel, msgId, isStream: false, res });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Malformed bridge response: ${err.message}` } });
    }
  }
}

function pipeAnthropicNonStreamResponse(forwardRes, targetModel, res) {
  let raw = '';
  forwardRes.on('data', (c) => { raw += c.toString('utf8'); });
  forwardRes.on('end', () => handleAnthropicNonStreamData(raw, targetModel, res));
  forwardRes.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { type: 'error', error: { type: 'api_error', message: `Upstream error: ${err.message}` } });
    }
  });
}

function handleAnthropicResponse(forwardRes, options) {
  const { isStream, targetModel, res, resetStreamTimeout } = options;
  if (forwardRes.statusCode >= 400) {
    handleAnthropicUpstreamError(forwardRes, isStream, res);
    return;
  }
  if (isStream) {
    pipeAnthropicStreamResponse(forwardRes, targetModel, res, resetStreamTimeout);
    return;
  }
  pipeAnthropicNonStreamResponse(forwardRes, targetModel, res);
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

async function handleAnthropicMessages(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  const resetStreamTimeout = () => { lastActivityTime = Date.now(); };

  try {
    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr);
    const model = body.model;
    if (!model || typeof model !== 'string') {
      return sendJson(res, 400, { error: { type: 'error', error: { type: 'invalid_request_error', message: 'Missing model parameter' } } });
    }

    const resolved = await resolveBridgeAndModel(model, activeBridges);
    if (!resolved) {
      return sendJson(res, 404, { error: { type: 'error', error: { type: 'not_found', message: `No suitable bridge found for model: "${model}"` } } });
    }

    const { active, bridgeName, targetModel } = resolved;
    const isStream = body.stream === true;
    const openAiPayload = buildOpenAiPayloadFromAnthropic(body, targetModel);
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
      handleAnthropicResponse(forwardRes, { isStream, targetModel, res, resetStreamTimeout });
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
  openAIResponseToAnthropic,
  handleAnthropicMessages,
  handleGeminiRequest
};
