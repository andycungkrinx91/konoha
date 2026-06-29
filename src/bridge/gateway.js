/* gateway.js intentionally uses CommonJS (require/module.exports) — required for Node.js 18.x compatibility and HTTP server integration. */
'use strict';

const http = require('http');

let gatewayServer = null;

// High-performance HTTP Keep-Alive Agent for downstream connection pooling
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 256,
  maxFreeSockets: 64,
  timeout: 120000
});

const bridgeModelsCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds cache TTL
const STREAM_TIMEOUT_MS = 300000; // 5 minutes max total duration
const STREAM_INACTIVITY_MS = 45000; // 45s of silence before kill (keeps connection alive during active streaming)

async function getBridgeModels(bridgeName, activeBridge) {
  const now = Date.now();
  if (bridgeModelsCache.has(bridgeName)) {
    const cached = bridgeModelsCache.get(bridgeName);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return new Set(cached.data.map(m => m.id));
    }
  }

  const port = activeBridge.bridgeConfig.port;
  return new Promise((resolve) => {
    const clientReq = http.get(`http://127.0.0.1:${port}/v1/models`, { agent: httpAgent }, (clientRes) => {
      let chunks = [];
      clientRes.on('data', (chunk) => { chunks.push(chunk); });
      clientRes.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(data);
          if (json && Array.isArray(json.data)) {
            bridgeModelsCache.set(bridgeName, { data: json.data, timestamp: Date.now() });
            const ids = new Set(json.data.map(m => m.id));
            resolve(ids);
            return;
          }
        } catch {}
        resolve(new Set());
      });
    });
    clientReq.on('error', () => {
      resolve(new Set());
    });
    clientReq.setTimeout(3000, () => {
      clientReq.destroy();
      resolve(new Set());
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function resolveBridgeAndModel(model, activeBridges) {
  if (!model || typeof model !== 'string') {
    return null;
  }

  // Build a combined cache of model-name→bridge mapping in a single pass.
  // This avoids calling getBridgeModels separately for each bridge.
  const bridgeModelMap = new Map(); // modelId -> { bridgeName, bridge }
  for (const [name, active] of activeBridges.entries()) {
    const models = await getBridgeModels(name, active);
    for (const modelId of models) {
      // Only register the first bridge that has a given model
      if (!bridgeModelMap.has(modelId)) {
        bridgeModelMap.set(modelId, { bridgeName: name, bridge: active });
      }
    }
  }

  // 1. Direct prefix match: check if model starts with any active bridge name followed by '-'
  for (const [name] of activeBridges.entries()) {
    const prefix = `${name}-`;
    if (model.startsWith(prefix)) {
      const baseModel = model.substring(prefix.length);
      const targetModel = bridgeModelMap.has(model) ? model : baseModel;
      const active = activeBridges.get(name);
      return { active, bridgeName: name, targetModel };
    }
  }

  // 2. Exact match from combined cache
  if (bridgeModelMap.has(model)) {
    const { bridgeName, bridge } = bridgeModelMap.get(model);
    return { active: bridge, bridgeName, targetModel: model };
  }

  // 3. Fallback: try first active bridge
  if (activeBridges.size > 0) {
    const fallbackName = activeBridges.keys().next().value;
    const active = activeBridges.get(fallbackName);
    if (active) {
      return { active, bridgeName: fallbackName, targetModel: model };
    }
  }

  return null;
}

async function startGateway(activeBridges, port = 19999) {
  if (gatewayServer) {
    await stopGateway();
  }

  gatewayServer = http.createServer((req, res) => {
    // CORS: allow only requests from local IDE clients (no wildcard).
    // Echo back the request's Origin only if it's a known local client (null,
    // localhost, 127.0.0.1). Never return '*'.
    const origin = req.headers['origin'];
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Lightweight health-check endpoint (no auth required).
    if (reqUrl.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (origin && /^(https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?))$|^null$/i.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-konoha-gateway-token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = reqUrl;

    // Route 1: GET /v1/models or GET /models
    if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
      handleGetModels(activeBridges, req, res);
      return;
    }

    // Route 2: POST /v1/chat/completions or POST /chat/completions
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
      handleChatCompletions(activeBridges, req, res);
      return;
    }

    // Route 3: POST /v1/messages (Anthropic)
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      handleAnthropicMessages(activeBridges, req, res);
      return;
    }

    // Route 3b: POST /v1/messages/count_tokens (Anthropic preflight)
    if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
      sendJson(res, 200, { input_tokens: 0 });
      return;
    }

    // Route 4: Gemini native format
    // Matches /v1beta/models/<model-name>[:operation]
    if (url.pathname.startsWith('/v1beta/models/')) {
      handleGeminiRequest(activeBridges, req, res);
      return;
    }

    // Fallback
    sendJson(res, 404, {
      error: {
        message: `Unknown path: ${req.method} ${url.pathname}`,
        type: 'not_found'
      }
    });
  });

  return new Promise((resolve, reject) => {
    gatewayServer.keepAliveTimeout = 65000;
    gatewayServer.headersTimeout = 66000;
    gatewayServer.maxRequestsPerSocket = 0;
    gatewayServer.listen(port, '127.0.0.1', (err) => {
      if (err) {
        reject(err);
      } else {
        process.stderr.write(`[gateway] Proxy Gateway running on http://127.0.0.1:${port}\n`);
        resolve();
      }
    });
    gatewayServer.on('error', (err) => {
      process.stderr.write(`[gateway] Proxy Gateway server error: ${err.message}\n`);
    });
  });
}

async function stopGateway() {
  if (!gatewayServer) return;
  return new Promise((resolve) => {
    gatewayServer.close(() => {
      process.stderr.write(`[gateway] Proxy Gateway server stopped.\n`);
      gatewayServer = null;
      resolve();
    });
  });
}

/**
 * Pipe upstream response to client with model name rewriting.
 * Handles both streaming (SSE) and non-streaming responses.
 * Implements streaming-keepalive: resets the inactivity timeout on every chunk received.
 * Prevents gateway timeout from killing streams that are still producing data.
 */
function pipeWithModelRewrite(forwardRes, res, baseModel, originalModel, onActivity) {
  const headers = { ...forwardRes.headers };
  delete headers['content-length'];
  res.writeHead(forwardRes.statusCode, headers);

  // Reset keep-alive timer on first chunk
  if (onActivity) onActivity();

  // Fast-path zero-copy stream piping if no model string rewrite is required
  if (baseModel === originalModel || !baseModel) {
    forwardRes.pipe(res, { end: false });
    forwardRes.on('data', () => {
      if (onActivity) onActivity();
    });
    forwardRes.on('end', () => res.end());
    forwardRes.on('error', (err) => {
      if (!res.headersSent) {
        sendJson(res, 502, { error: { message: 'Upstream bridge stream error', type: 'gateway_error' } });
      }
      res.end();
    });
    return;
  }

  // Escape special regex chars for safe regex construction
  const escapedBase = baseModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modelRegex = new RegExp(`("model"\\s*:\\s*)"${escapedBase}"(?!\\w)`);
  const modelRegexSSE = new RegExp(`(data:\\s*"model"\\s*:\\s*)"${escapedBase}"(?!\\w)`);

  let buffer = '';
  let activityTimer = null;

  // Reset gateway-level timeout on every data chunk
  function resetTimeout() {
    if (onActivity) onActivity();
    // Extend the inactivity window for active streams
    if (forwardReq) forwardReq.setTimeout(STREAM_TIMEOUT_MS);
  }

  forwardRes.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    resetTimeout();

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      let rewritten = line;

      // Normal JSON line: {"model": "foo", ...}
      rewritten = rewritten.replace(modelRegex, `$1"${originalModel}"`);
      // SSE data line: data: {"model": "foo"}
      rewritten = rewritten.replace(modelRegexSSE, `$1"${originalModel}"`);

      // If no model field was found, fall back to simple string replace
      if (rewritten === line) {
        rewritten = line.replaceAll(baseModel, originalModel);
      }

      res.write(rewritten + '\n');
    }
  });

  forwardRes.on('end', () => {
    clearTimeout(activityTimer);
    if (buffer) {
      let rewritten = buffer;
      rewritten = rewritten.replace(modelRegex, `$1"${originalModel}"`);
      rewritten = rewritten.replace(modelRegexSSE, `$1"${originalModel}"`);
      if (rewritten === buffer) {
        rewritten = buffer.replaceAll(baseModel, originalModel);
      }
      res.write(rewritten);
    }
    res.end();
  });

  forwardRes.on('error', (err) => {
    clearTimeout(activityTimer);
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: {
          message: `Upstream bridge stream error: ${err.message}`,
          type: 'gateway_error'
        }
      });
    }
    res.end();
  });
}

async function handleGetModels(activeBridges, req, res) {
  const modelPromises = [];
  for (const [name, active] of activeBridges.entries()) {
    const port = active.bridgeConfig.port;

    if (bridgeModelsCache.has(name)) {
      const cached = bridgeModelsCache.get(name);
      const cachedData = cached.data || cached; // support both formats for transition
      const mapped = cachedData.map((m) => ({
        ...m,
        // Prefix added (condition was always-true, simplified)
        id: `${name}-${m.id}`
      }));
      modelPromises.push(Promise.resolve(mapped));
      continue;
    }

    modelPromises.push(
      new Promise((resolve) => {
        const clientReq = http.get(`http://127.0.0.1:${port}/v1/models`, (clientRes) => {
          let data = '';
          clientRes.on('data', (chunk) => { data += chunk; });
          clientRes.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json && Array.isArray(json.data)) {
                 bridgeModelsCache.set(name, { data: json.data, timestamp: Date.now() });
                 const mapped = json.data.map((m) => ({
                   ...m,
                   id: `${name}-${m.id}`
                 }));
                 resolve(mapped);
              } else {
                resolve([]);
              }
            } catch {
              resolve([]);
            }
          });
        });
        clientReq.on('error', () => {
          resolve([]);
        });
        clientReq.setTimeout(10000, () => {
          clientReq.destroy();
          resolve([]);
        });
      })
    );
  }

  const results = await Promise.all(modelPromises);
  const allModels = results.flat();

  const isAnthropic = !!(
    req.headers['anthropic-version'] ||
    req.headers['x-api-key'] ||
    (req.headers['user-agent'] && req.headers['user-agent'].toLowerCase().includes('claude-code'))
  );

  if (isAnthropic) {
    const data = allModels.map((m) => {
      let displayName = m.display_name || m.name || m.id;
      if (!m.display_name && !m.name) {
        displayName = m.id
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      const created_at = m.created_at || (m.created ? new Date(m.created * 1000).toISOString() : new Date().toISOString());
      return {
        type: 'model',
        id: m.id,
        display_name: displayName,
        created_at: created_at
      };
    });

    sendJson(res, 200, {
      data,
      has_more: false,
      first_id: data.length > 0 ? data[0].id : null,
      last_id: data.length > 0 ? data[data.length - 1].id : null
    });
  } else {
    sendJson(res, 200, { object: 'list', data: allModels });
  }
}

async function handleChatCompletions(activeBridges, req, res) {
  // Track total request age and stream inactivity separately
  let startTime = Date.now();
  let lastActivityTime = startTime;

  function resetStreamTimeout() {
    lastActivityTime = Date.now();
  }

  try {
    let bodyStr;
    try {
      bodyStr = await readBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: { message: 'Request body too large', type: 'payload_too_large' } });
      }
      throw err;
    }
    let body;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      return sendJson(res, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } });
    }

    const model = body.model;
    if (!model || typeof model !== 'string') {
      return sendJson(res, 400, { error: { message: 'Missing model parameter', type: 'invalid_request_error' } });
    }

    const resolved = await resolveBridgeAndModel(model, activeBridges);
    if (!resolved) {
      return sendJson(res, 404, {
        error: {
          message: `No suitable bridge found for model: "${model}"`,
          type: 'not_found'
        }
      });
    }

    const { active, bridgeName, targetModel } = resolved;

    body.model = targetModel;
    const rewrittenBody = JSON.stringify(body);

    // Sanitize headers: strip auth keys and hop-by-hop headers before
    // forwarding to the bridge. Prevents leaking Claude Code / Cursor API tokens.
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (lower.match(/^(authorization|x-api-key|x-forwarded[-_]for|x-forwarded[-_]proto|x-request-id|x-client-|x-konoha-gateway)/)) {
        continue;
      }
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];

    // Inject API key if configured
    if (active.bridgeConfig.apiKey) {
      headers['authorization'] = `Bearer ${active.bridgeConfig.apiKey}`;
    }

    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: req.url,
      method: 'POST',
      headers,
      agent: httpAgent,
      // Use absolute max duration, not inactivity. Streaming activity extends lifetime.
      timeout: STREAM_TIMEOUT_MS,
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model, resetStreamTimeout);
    });

    forwardReq.on('error', (err) => {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: {
            message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`,
            type: 'gateway_error'
          }
        });
      }
    });

    forwardReq.on('timeout', () => {
      // Check if this is due to stream inactivity (data was flowing) or total max duration
      const inactivityMs = Date.now() - lastActivityTime;
      if (inactivityMs <= STREAM_INACTIVITY_MS) {
        // Data was flowing, just reset the timeout (it was a false alarm from total duration)
        forwardReq.setTimeout(STREAM_TIMEOUT_MS);
        return;
      }
      forwardReq.destroy();
      if (!res.headersSent) {
        sendJson(res, 504, {
          error: {
            message: `Bridge request timed out: no data for ${inactivityMs}ms`,
            type: 'gateway_timeout'
          }
        });
      }
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: { message: err.message, type: 'internal_error' } });
    }
  }
}

async function handleAnthropicMessages(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  function resetStreamTimeout() {
    lastActivityTime = Date.now();
  }

  try {
    let bodyStr;
    try {
      bodyStr = await readBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: { type: 'error', error: { type: 'payload_too_large', message: 'Request body too large' } } });
      }
      throw err;
    }
    let body;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      return sendJson(res, 400, { error: { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } } });
    }

    const model = body.model;
    if (!model || typeof model !== 'string') {
      return sendJson(res, 400, { error: { type: 'error', error: { type: 'invalid_request_error', message: 'Missing model parameter' } } });
    }

    const resolved = await resolveBridgeAndModel(model, activeBridges);
    if (!resolved) {
      return sendJson(res, 404, {
        error: {
          type: 'error',
          error: {
            type: 'not_found',
            message: `No suitable bridge found for model: "${model}"`
          }
        }
      });
    }

    const { active, bridgeName, targetModel } = resolved;

    body.model = targetModel;
    const rewrittenBody = JSON.stringify(body);

    // Sanitize headers: strip auth keys and hop-by-hop headers before
    // forwarding to the bridge. Prevents leaking Claude Code / Cursor API
    // tokens into the bridge's target server.
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (lower.match(/^(authorization|x-api-key|x-forwarded[-_]for|x-forwarded[-_]proto|x-request-id|x-client-|x-konoha-gateway)/)) {
        continue;
      }
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: req.url,
      method: 'POST',
      headers,
      agent: httpAgent,
      timeout: STREAM_TIMEOUT_MS,
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model, resetStreamTimeout);
    });

    forwardReq.on('error', (err) => {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: {
            type: 'error',
            error: {
              type: 'api_error',
              message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`
            }
          }
        });
      }
    });

    forwardReq.on('timeout', () => {
      const inactivityMs = Date.now() - lastActivityTime;
      if (inactivityMs <= STREAM_INACTIVITY_MS) {
        forwardReq.setTimeout(STREAM_TIMEOUT_MS);
        return;
      }
      forwardReq.destroy();
      if (!res.headersSent) {
        sendJson(res, 504, {
          error: {
            type: 'error',
            error: {
              type: 'cancelled',
              message: `Bridge request timed out: no data for ${inactivityMs}ms`
            }
          }
        });
      }
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: { type: 'error', error: { type: 'api_error', message: err.message } } });
    }
  }
}

async function handleGeminiRequest(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  function resetStreamTimeout() {
    lastActivityTime = Date.now();
  }

  const pathname = req.url;
  // Match /v1beta/models/([^/:]+)(?::(\w+))?
  const match = pathname.match(/\/v1beta\/models\/([^/:]+)(?::(\w+))?/);
  if (!match) {
    return sendJson(res, 400, { error: { code: 400, message: 'Invalid pathname format', status: 'INVALID_ARGUMENT' } });
  }

  const model = match[1];

  const resolved = await resolveBridgeAndModel(model, activeBridges);
  if (!resolved) {
    return sendJson(res, 404, {
      error: {
        code: 404,
        message: `No suitable bridge found for model: "${model}"`,
        status: 'NOT_FOUND'
      }
    });
  }

  const { active, bridgeName, targetModel } = resolved;

  try {
    // Rewrite URL path
    const rewrittenPath = pathname.replace(model, targetModel);

    let rewrittenBody;
    try {
      rewrittenBody = await readBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: { code: 413, message: 'Request body too large', status: 'FAILED_PRECONDITION' } });
      }
      throw err;
    }
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
      timeout: STREAM_TIMEOUT_MS,
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model, resetStreamTimeout);
    });

    forwardReq.on('error', (err) => {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: {
            code: 502,
            message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`,
            status: 'INTERNAL'
          }
        });
      }
    });

    forwardReq.on('timeout', () => {
      const inactivityMs = Date.now() - lastActivityTime;
      if (inactivityMs <= STREAM_INACTIVITY_MS) {
        forwardReq.setTimeout(STREAM_TIMEOUT_MS);
        return;
      }
      forwardReq.destroy();
      if (!res.headersSent) {
        sendJson(res, 504, {
          error: {
            code: 504,
            message: `Bridge request timed out: no data for ${inactivityMs}ms`,
            status: 'DEADLINE_EXCEEDED'
          }
        });
      }
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: 500, message: err.message, status: 'INTERNAL' } });
    }
  }
}

function readBody(req, maxBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

module.exports = { startGateway, stopGateway };
