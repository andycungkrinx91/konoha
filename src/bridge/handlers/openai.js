'use strict';

const { randomUUID } = require('crypto');
const {
  log,
  verboseLog,
  sendJson,
  setupStreamResponse,
  readBody,
  
} = require('../utils');
const { extractText, extractAllImages } = require('../images');
const { sanitizeRequest } = require('../sanitize');

// POST /v1/chat/completions

async function handleChatCompletions(ctx, req, res) {
  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: { message: 'Invalid JSON', type: 'invalid_request' } });
  }

  verboseLog(ctx, `📥 Request body (${body.length} bytes): ${body.substring(0, 500)}...`, body);

  payload = sanitizeRequest(payload);
  const isStream = payload.stream === true;
  const messages = payload.messages || [];
  const completionId = `chatcmpl-${randomUUID()}`;

  // Safeguard: detect [object Object] serialization corruption
  const userTexts = messages.filter((m) => m.role === 'user').map((m) => extractText(m.content));
  const allCorrupted = userTexts.length > 0 && userTexts.every((t) => t.startsWith('[object Object]'));
  if (allCorrupted) {
    log(ctx, `⚠️ [object Object] DETECTED — upstream caller is not serializing messages properly!`, true);
    return sendJson(res, 400, {
      error: {
        message:
          'Messages contain "[object Object]" — the caller is not serializing message objects to JSON properly.',
        type: 'invalid_request',
      },
    });
  }

  return handleOpenAiDirect(ctx, req, res, messages, isStream, completionId, payload);
}

async function handleOpenAiDirect(ctx, req, res, messages, ...rest) {
  const [isStream, completionId, payload] = rest;
  ctx.requestedModel = payload.model;

  const tools = payload.tools && payload.tools.length > 0 ? payload.tools : null;
  let images = [];
  try {
    images = await extractAllImages(ctx, messages);
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }

  if (isStream) {
    return streamOpenAiDirect(ctx, req, res, messages, completionId, tools, images);
  }

  try {
    const bridgeConfig = ctx.bridgeConfig || {};
    let requestUrl = bridgeConfig.targetUrl || '';
    if (requestUrl.endsWith('/')) requestUrl = requestUrl.slice(0, -1);
    if (requestUrl.endsWith('/chat/completions')) {
      // already complete
    } else if (requestUrl.endsWith('/v1')) {
      requestUrl = requestUrl + '/chat/completions';
    } else if (requestUrl) {
      requestUrl = requestUrl + '/v1/chat/completions';
    } else {
      requestUrl = 'https://api.openai.com/v1/chat/completions';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (bridgeConfig.apiKey) headers['Authorization'] = `Bearer ${bridgeConfig.apiKey}`;

    const reqBody = { model: ctx.requestedModel || payload.model, messages, stream: false };
    if (tools) reqBody.tools = tools;

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      return sendJson(res, response.status, {
        error: { message: errText, type: 'upstream_error' },
      });
    }

    const completion = await response.json();
    sendJson(res, 200, completion);
  } catch (err) {
    const status = err.statusCode || 502;
    sendJson(res, status, {
      error: {
        message: err.message || 'OpenAI provider error',
        type: 'upstream_error',
      },
    });
  }
}

function _writeStreamLine(line, res, state) {
  if (line.startsWith('data:')) {
    if (line.slice(5).trim() === '[DONE]') state.sawDone = true;
    if (!res.writableEnded) res.write(line + '\n');
  } else if (line.trim() === '' && !res.writableEnded) {
    res.write('\n');
  }
}

async function _pipeReaderToResponse(reader, res) {
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { sawDone: false };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      _writeStreamLine(line, res, state);
    }
  }
  if (buffer && buffer.trim()) {
    _writeStreamLine(buffer, res, state);
  }
  if (!state.sawDone && !res.writableEnded) {
    res.write('data: [DONE]\n\n');
  }
  if (!res.writableEnded) res.end();
}

async function _handleStreamFetchResponse(response, res) {
  if (!response.ok) {
    const errText = await response.text();
    const safeErr = (errText || '').replace(/[^\x20-\x7E]/g, '').substring(0, 4000);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: { message: safeErr, type: 'upstream_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }
  await _pipeReaderToResponse(response.body.getReader(), res);
}

function streamOpenAiDirect(ctx, req, res, messages, ...rest) {
  const [_completionId, tools, _] = rest;
  setupStreamResponse(res);

  const bridgeConfig = ctx.bridgeConfig || {};
  let requestUrl = bridgeConfig.targetUrl || '';
  if (requestUrl.endsWith('/')) requestUrl = requestUrl.slice(0, -1);
  if (requestUrl.endsWith('/chat/completions')) {
    // already a chat completions URL
  } else if (requestUrl.endsWith('/v1')) {
    requestUrl = requestUrl + '/chat/completions';
  } else if (requestUrl) {
    requestUrl = requestUrl + '/v1/chat/completions';
  } else {
    requestUrl = 'https://api.openai.com/v1/chat/completions';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (bridgeConfig.apiKey) headers['Authorization'] = `Bearer ${bridgeConfig.apiKey}`;

  const reqBody = { model: ctx.requestedModel, messages, stream: true };
  if (tools) reqBody.tools = tools;

  let abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  fetch(requestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
    signal: abortController.signal,
  })
    .then(async (response) => _handleStreamFetchResponse(response, res))
    .catch((err) => {
      if (err.name === 'AbortError') return;
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: (err.message || 'Stream error').substring(0, 4000), type: 'upstream_error' } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    });
}

module.exports = { handleChatCompletions, handleOpenAiDirect };
