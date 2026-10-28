'use strict';

const http = require('http');

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 256,
  maxFreeSockets: 64,
  timeout: 120000
});

const bridgeModelsCache = new Map();
const CACHE_TTL_MS = 30000;
const STREAM_TIMEOUT_MS = 300000;
const STREAM_INACTIVITY_MS = 45000;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBridgeModelsBuffer(chunks) {
  try {
    const data = Buffer.concat(chunks).toString('utf8');
    const json = JSON.parse(data);
    return Array.isArray(json?.data) ? json.data : null;
  } catch {
    return null;
  }
}

function sendBridgeModelsRequest(port, agent, resolve) {
  const clientReq = http.get(`http://127.0.0.1:${port}/v1/models`, { agent }, (clientRes) => {
    const chunks = [];
    clientRes.on('data', (chunk) => { chunks.push(chunk); });
    clientRes.on('end', () => resolve(parseBridgeModelsBuffer(chunks)));
  });
  clientReq.on('error', () => resolve(null));
  clientReq.setTimeout(3000, () => {
    clientReq.destroy();
    resolve(null);
  });
}

function fetchModelsFromBridge(port, agent) {
  return new Promise((resolve) => sendBridgeModelsRequest(port, agent, resolve));
}

async function getBridgeModels(bridgeName, activeBridge) {
  const now = Date.now();
  if (bridgeModelsCache.has(bridgeName)) {
    const cached = bridgeModelsCache.get(bridgeName);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return new Set(cached.data.map(m => m.id));
    }
  }

  const port = activeBridge.bridgeConfig.port;
  const models = await fetchModelsFromBridge(port, httpAgent);
  if (models) {
    bridgeModelsCache.set(bridgeName, { data: models, timestamp: Date.now() });
    return new Set(models.map(m => m.id));
  }
  return new Set();
}

async function populateBridgeModels(name, active, bridgeModelMap) {
  const models = await getBridgeModels(name, active);
  for (const modelId of models) {
    if (!bridgeModelMap.has(modelId)) {
      bridgeModelMap.set(modelId, { bridgeName: name, bridge: active });
    }
  }
}

function matchPrefixBridge(model, activeBridges, bridgeModelMap) {
  for (const [name] of activeBridges.entries()) {
    const prefix = `${name}-`;
    if (model.startsWith(prefix)) {
      const baseModel = model.substring(prefix.length);
      const targetModel = bridgeModelMap.has(model) ? model : baseModel;
      const active = activeBridges.get(name);
      return { active, bridgeName: name, targetModel };
    }
  }
  return null;
}

async function resolveBridgeAndModel(model, activeBridges) {
  if (!model || typeof model !== 'string') return null;

  const bridgeModelMap = new Map();
  for (const [name, active] of activeBridges.entries()) {
    await populateBridgeModels(name, active, bridgeModelMap);
  }

  const prefixMatch = matchPrefixBridge(model, activeBridges, bridgeModelMap);
  if (prefixMatch) return prefixMatch;

  if (bridgeModelMap.has(model)) {
    const { bridgeName, bridge } = bridgeModelMap.get(model);
    return { active: bridge, bridgeName, targetModel: model };
  }

  if (activeBridges.size > 0) {
    const fallbackName = activeBridges.keys().next().value;
    const active = activeBridges.get(fallbackName);
    if (active) return { active, bridgeName: fallbackName, targetModel: model };
  }

  return null;
}

function sanitizeForwardHeaders(reqHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(reqHeaders)) {
    const lower = name.toLowerCase();
    if (lower.match(/^(authorization|x-api-key|x-forwarded[-_]for|x-forwarded[-_]proto|x-request-id|x-client-|x-konoha-gateway|cookie|proxy-authorization|x-auth-token)/)) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  delete headers['accept-encoding'];
  delete headers['Accept-Encoding'];
  return headers;
}

function trackBodyChunk(chunk, state, maxBytes, req) {
  state.totalBytes += chunk.length;
  if (state.totalBytes > maxBytes) {
    state.overflow = true;
    req.destroy();
    return false;
  }
  state.chunks.push(chunk);
  return true;
}

function attachBodyListeners(req, state, maxBytes, handlers) {
  const { resolve, reject } = handlers;
  req.on('data', (chunk) => {
    if (!trackBodyChunk(chunk, state, maxBytes, req)) {
      reject(new Error('PAYLOAD_TOO_LARGE'));
    }
  });
  req.on('end', () => resolve(Buffer.concat(state.chunks).toString('utf8')));
  req.on('error', (err) => reject(err));
}

function readBody(req, maxBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const state = { chunks: [], totalBytes: 0, overflow: false };
    attachBodyListeners(req, state, maxBytes, { resolve, reject });
  });
}

function handleUnmodifiedStream(forwardRes, res, onActivity) {
  forwardRes.pipe(res, { end: false });
  forwardRes.on('data', () => {
    if (onActivity) onActivity();
  });
  forwardRes.on('end', () => res.end());
  forwardRes.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message: 'Upstream bridge stream error', type: 'gateway_error' } });
    }
    res.end();
  });
}

function rewriteChunkLine(line, modelRegex, modelRegexSSE, originalModel) {
  let rewritten = line.replace(modelRegex, `$1"${originalModel}"`);
  return rewritten.replace(modelRegexSSE, `$1"${originalModel}"`);
}

function handleChunkData(chunk, state, context) {
  state.buffer += chunk.toString('utf8');
  if (context.onActivity) context.onActivity();

  const lines = state.buffer.split('\n');
  state.buffer = lines.pop();

  for (const line of lines) {
    const rewritten = rewriteChunkLine(line, context.modelRegex, context.modelRegexSSE, context.originalModel);
    context.res.write(rewritten + '\n');
  }
}

function handleStreamEnd(state, context) {
  if (state.buffer) {
    let rewritten = rewriteChunkLine(state.buffer, context.modelRegex, context.modelRegexSSE, context.originalModel);
    if (rewritten === state.buffer) {
      rewritten = state.buffer.replaceAll(context.baseModel, context.originalModel);
    }
    context.res.write(rewritten);
  }
  context.res.end();
}

function pipeWithModelRewrite(forwardRes, res, options) {
  const { baseModel, originalModel, onActivity } = options;
  const headers = { ...forwardRes.headers };
  delete headers['content-length'];
  res.writeHead(forwardRes.statusCode, headers);

  if (onActivity) onActivity();

  if (baseModel === originalModel || !baseModel) {
    handleUnmodifiedStream(forwardRes, res, onActivity);
    return;
  }

  const escapedBase = baseModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modelRegex = new RegExp(`("model"\\s*:\\s*)"${escapedBase}"(?!\\w)`);
  const modelRegexSSE = new RegExp(`(data:\\s*"model"\\s*:\\s*)"${escapedBase}"(?!\\w)`);

  const state = { buffer: '' };
  const context = { res, modelRegex, modelRegexSSE, baseModel, originalModel, onActivity };

  forwardRes.on('data', (chunk) => handleChunkData(chunk, state, context));
  forwardRes.on('end', () => handleStreamEnd(state, context));
  forwardRes.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message: `Upstream bridge stream error: ${err.message}`, type: 'gateway_error' } });
    }
    res.end();
  });
}

module.exports = {
  httpAgent,
  bridgeModelsCache,
  CACHE_TTL_MS,
  STREAM_TIMEOUT_MS,
  STREAM_INACTIVITY_MS,
  sendJson,
  getBridgeModels,
  populateBridgeModels,
  resolveBridgeAndModel,
  sanitizeForwardHeaders,
  readBody,
  pipeWithModelRewrite
};
