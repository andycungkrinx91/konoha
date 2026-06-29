'use strict';

const { log, sendJson, readBody, parseRetryAfter, extractProviderError } = require('../utils');
const { resolveModel } = require('../models');
const { extractAllImages } = require('../images');
const { callRawInference } = require('../sidecar/raw');
const { sanitizeRequest } = require('../sanitize');

const VALUE_TO_MODEL_ENUM = {
  1018: 'MODEL_PLACEHOLDER_M18', // Flash
  1037: 'MODEL_PLACEHOLDER_M16', // Pro High
  1036: 'MODEL_PLACEHOLDER_M36', // Pro Low
  1035: 'MODEL_PLACEHOLDER_M35', // Sonnet
  1026: 'MODEL_PLACEHOLDER_M26', // Opus
  342: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', // GPT-OSS 120B
};

// ─────────────────────────────────────────────
// Gemini → OpenAI message conversion
// Gemini uses `contents[].parts[].text`
// ─────────────────────────────────────────────

/**
 * Convert Gemini-format `contents` to OpenAI-format messages.
 * Gemini roles: 'user' | 'model'  →  OpenAI roles: 'user' | 'assistant'
 */
function geminiContentsToOpenAi(contents, systemInstruction) {
  const messages = [];

  // systemInstruction is { parts: [{ text }] } in Gemini native format
  if (systemInstruction) {
    const sysParts = systemInstruction.parts || [];
    const sysText = sysParts.map((p) => p.text || '').join('');
    if (sysText) messages.push({ role: 'system', content: sysText });
  }

  for (const item of contents || []) {
    const role = item.role === 'model' ? 'assistant' : 'user';
    const parts = item.parts || [];
    const content = [];
    for (const p of parts) {
      if (p.text) content.push({ type: 'text', text: p.text });
      if (p.inlineData || p.inline_data) {
        const id = p.inlineData || p.inline_data;
        content.push({ type: 'image_url', image_url: { url: `data:${id.mimeType || 'image/png'};base64,${id.data}` } });
      }
    }
    messages.push({ role, content });
  }

  return messages;
}

/**
 * Convert Gemini tool declarations to OpenAI tool format.
 * Gemini: { functionDeclarations: [{ name, description, parameters }] }
 */
function geminiToolsToOpenAi(tools) {
  if (!tools || tools.length === 0) return null;

  const openAiTools = [];
  for (const toolGroup of tools) {
    const declarations = toolGroup.functionDeclarations || toolGroup.function_declarations || [];
    for (const decl of declarations) {
      openAiTools.push({
        type: 'function',
        function: {
          name: decl.name,
          description: decl.description || '',
          parameters: decl.parameters || { type: 'object', properties: {} },
        },
      });
    }
  }
  return openAiTools.length > 0 ? openAiTools : null;
}

// ─────────────────────────────────────────────
// Gemini response builders
// ─────────────────────────────────────────────

function buildGeminiDelta(text, modelKey) {
  return {
    candidates: [
      {
        content: { role: 'model', parts: text ? [{ text }] : [] },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    modelVersion: modelKey,
  };
}

function buildGeminiResponse(text, toolCalls, modelKey) {
  const parts = [];

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: tc.function.name, args } });
    }
  } else if (text) {
    parts.push({ text });
  }

  return {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: toolCalls && toolCalls.length > 0 ? 'FUNCTION_CALL' : 'STOP',
        index: 0,
        safetyRatings: [],
      },
    ],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: modelKey,
  };
}

// Stream text by word chunks with small delays. The Gemini SDK reads a newline-
// delimited JSON array; we open the array, emit incremental deltas, then close.
async function streamGeminiResponse(res, text, modelKey) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.writeHead(200);
  res.write('[\n');
  if (text) {
    const tokens = text.match(/\S+\s*|\s+/g) || [text];
    let acc = '';
    for (const tok of tokens) {
      if (res.writableEnded) return;
      acc += tok;
      const chunk = buildGeminiDelta(acc, modelKey);
      res.write(JSON.stringify(chunk) + ',\n');
      acc = '';
      // Yield to the event loop so the client receives each chunk incrementally.
      await new Promise(r => setImmediate(r));
    }
  }
  // Final completion chunk.
  const final = {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: modelKey,
  };
  res.write(JSON.stringify(final) + '\n]\n');
  res.end();
}

// ─────────────────────────────────────────────
// POST /v1beta/models/:model:generateContent
// POST /v1beta/models/:model:streamGenerateContent
// ─────────────────────────────────────────────

async function handleGeminiGenerateContent(ctx, req, res, modelFromPath) {
  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: { code: 400, message: 'Invalid JSON', status: 'INVALID_ARGUMENT' } });
  }

  // Detect streaming from URL suffix (already stripped by router, stored in req._geminiStream)
  const isStream = req._geminiStream === true;

  // Resolve model — modelFromPath comes from the URL like "gemini-3.1-pro-high"
  const resolved = resolveModel(modelFromPath || payload.model);
  ctx.requestedModel = modelFromPath || payload.model;

  // OpenAI provider — skip sidecar enum mapping
  if (ctx.bridgeConfig && ctx.bridgeConfig.provider === 'openai') {
    return handleGeminiToOpenAi(ctx, req, res, isStream, payload, modelFromPath);
  }

  log(ctx, `📡 [Gemini] Model: ${resolved.key} (enum=${resolved.value})`);

  const modelEnum = VALUE_TO_MODEL_ENUM[resolved.value];
  if (!modelEnum) {
    const msg = `No raw model enum mapping for value ${resolved.value}.`;
    return sendJson(res, 400, { error: { code: 400, message: msg, status: 'INVALID_ARGUMENT' } });
  }

  // Rate limit guard
  const now = Date.now();
  if (now - ctx.lastResponseTimestamp < ctx.MIN_REQUEST_INTERVAL_MS) {
    return sendJson(res, 429, {
      error: { code: 429, message: 'Rate limited — please wait.', status: 'RESOURCE_EXHAUSTED' },
    });
  }

  // Convert Gemini → OpenAI format
  let openAiMessages = geminiContentsToOpenAi(
    payload.contents,
    payload.systemInstruction || payload.system_instruction,
  );
  let openAiTools = geminiToolsToOpenAi(payload.tools);

  // Sanitize the converted OpenAI payload
  const sanitized = sanitizeRequest({
    messages: openAiMessages,
    tools: openAiTools,
  });
  openAiMessages = sanitized.messages;
  openAiTools = sanitized.tools;

  if (ctx.chatRequestsInFlight >= ctx.MAX_CONCURRENT_REQUESTS) {
    return sendJson(res, 429, {
      error: { code: 429, message: 'Too many concurrent requests.', status: 'RESOURCE_EXHAUSTED' },
    });
  }

  ctx.chatRequestsInFlight++;
  log(ctx, `📡 [Gemini] Requests in flight: ${ctx.chatRequestsInFlight}`);

  let images = [];
  try {
    images = await extractAllImages(ctx, openAiMessages);
    if (images.length > 0) log(ctx, `🖼️ Extracted ${images.length} image(s) from Gemini contents`);
  } catch (e) {
    log(ctx, `⚠️ Image extraction failed: ${e.message}`);
  }

  try {
    log(ctx, `🧠 [Gemini] Trying raw inference (${modelEnum})...`);
    const raw = await callRawInference(ctx, openAiMessages, modelEnum, openAiTools, images);

    if (!raw || (!raw.content && !raw.toolCalls)) {
      throw new Error('Raw inference returned empty content');
    }

    log(ctx, `✅ [Gemini] Raw inference succeeded (${(raw.content || '').length} chars)`);
    const responseBody = buildGeminiResponse(raw.content || '', raw.toolCalls, resolved.key);

    if (isStream) {
      // For tool-call responses we can't stream incrementally — fall back to single chunk.
      if (raw.toolCalls && raw.toolCalls.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.writeHead(200);
        res.write('[\n' + JSON.stringify(responseBody) + '\n]\n');
        res.end();
      } else {
        await streamGeminiResponse(res, raw.content || '', resolved.key);
      }
    } else {
      sendJson(res, 200, responseBody);
    }
  } catch (err) {
    log(ctx, `⚠️ [Gemini] Raw inference failed: ${err.message}`);
    const isRateLimit =
      err.message.includes('capacity') ||
      err.message.includes('429') ||
      err.message.includes('RESOURCE_EXHAUSTED') ||
      err.message.toLowerCase().includes('sse read timed out') ||
      err.message.includes('H2 connect') ||
      err.message.includes('H2 timeout') ||
      err.message.includes('Sidecar not discovered') ||
      err.message.includes('No reachable LS port') ||
      err.message.includes('empty content') ||
      err.message.includes('HTTP 500') ||
      err.message.includes('INTERNAL') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('socket hang up');
    let status = isRateLimit ? 429 : 502;
    let geminiStatus = isRateLimit ? 'RESOURCE_EXHAUSTED' : 'INTERNAL';
    let message = `Upstream error: ${extractProviderError(err.message)}`;

    if (err.isUpstreamError) {
      status = err.statusCode;
      message = err.message;
      if (status === 401 || status === 403) {
        geminiStatus = 'UNAUTHENTICATED';
      } else if (status === 429) {
        geminiStatus = 'RESOURCE_EXHAUSTED';
      } else {
        geminiStatus = err.rawError?.error?.status || 'INTERNAL';
      }
    }

    const retryAfterSecs = parseRetryAfter(err.message);
    log(
      ctx,
      `🛑 [Gemini][${err.isUpstreamError ? 'upstream' : isRateLimit ? 'rate_limit' : 'server_error'}→${status}] returning ${status} (Retry-After: ${retryAfterSecs}s): ${err.message.substring(0, 120)}`,
    );
    const errBody = {
      error: {
        code: status,
        message,
        status: geminiStatus,
      },
    };
    if (!res.headersSent) {
      res.setHeader('Retry-After', String(retryAfterSecs));
      sendJson(res, status, errBody);
    }
  } finally {
    ctx.chatRequestsInFlight--;
    ctx.lastResponseTimestamp = Date.now();
  }
}

/**
 * Parse the model name from a Gemini-style URL path.
 * Strips the operation suffix `:generateContent` / `:streamGenerateContent`.
 * e.g. "/v1beta/models/gemini-3.1-pro-high:streamGenerateContent" → "gemini-3.1-pro-high"
 *
 * @param {string} pathname
 * @returns {{ model: string|null, isStream: boolean }}
 */
function parseGeminiPath(pathname) {
  // Match /v1beta/models/<model-name>[:operation]
  const match = pathname.match(/\/v1beta\/models\/([^/:]+)(?::(\w+))?/);
  if (!match) return { model: null, isStream: false };
  const model = match[1];
  const operation = match[2] || '';
  const isStream = operation === 'streamGenerateContent';
  return { model, isStream };
}

// ─────────────────────────────────────────────
// Gemini format adapter for OpenAI provider
// Converts Gemini → OpenAI → callRawInference → Gemini response
// ─────────────────────────────────────────────

async function handleGeminiToOpenAi(ctx, req, res, isStream, payload, modelFromPath) {
  let openAiMessages = geminiContentsToOpenAi(
    payload.contents,
    payload.systemInstruction || payload.system_instruction,
  );
  let openAiTools = geminiToolsToOpenAi(payload.tools);
  const sanitized = sanitizeRequest({ messages: openAiMessages, tools: openAiTools });
  openAiMessages = sanitized.messages;
  openAiTools = sanitized.tools;

  ctx.requestedModel = modelFromPath || payload.model;

  try {
    const raw = await callRawInference(ctx, openAiMessages, null, openAiTools, []);
    if (!raw || (!raw.content && !raw.toolCalls)) throw new Error('Empty response');

    const responseBody = buildGeminiResponse(raw.content || '', raw.toolCalls, ctx.requestedModel);

    if (isStream) {
      if (raw.toolCalls && raw.toolCalls.length > 0) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.writeHead(200);
        res.write('[\n' + JSON.stringify(responseBody) + '\n]\n');
        res.end();
      } else {
        await streamGeminiResponse(res, raw.content || '', ctx.requestedModel);
      }
    } else {
      sendJson(res, 200, responseBody);
    }
  } catch (err) {
    sendJson(res, err.statusCode || 502, {
      error: {
        code: err.statusCode || 502,
        message: err.message || 'OpenAI provider error',
        status: err.statusCode === 401 || err.statusCode === 403 ? 'UNAUTHENTICATED' : 'INTERNAL',
      },
    });
  }
}

module.exports = { handleGeminiGenerateContent, parseGeminiPath, handleGeminiToOpenAi };
