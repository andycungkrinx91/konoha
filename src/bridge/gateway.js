/* gateway.js intentionally uses CommonJS (require/module.exports) — required for Node.js 18.x compatibility and HTTP server integration. */
'use strict';

const http = require('http');

const {
  httpAgent,
  bridgeModelsCache,
  STREAM_TIMEOUT_MS,
  STREAM_INACTIVITY_MS,
  sendJson,
  resolveBridgeAndModel,
  sanitizeForwardHeaders,
  readBody,
  pipeWithModelRewrite
} = require('./gateway_router');

const {
  anthropicMessagesToOpenAi,
  extractAnthropicSystemText,
  anthropicToolsToOpenAi,
  openAIResponseToAnthropic,
  handleAnthropicMessages,
  handleGeminiRequest
} = require('./gateway_adapters');

let gatewayServer = null;

function testSinglePort(tryPort) {
  return new Promise((resolve) => {
    const testServer = http.createServer(() => {});
    testServer.once('error', (err) => {
      resolve(err.code !== 'EADDRINUSE' ? null : false);
    });
    testServer.listen(tryPort, '127.0.0.1', () => {
      testServer.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxRetries = 10) {
  for (let offset = 0; offset <= maxRetries; offset++) {
    const tryPort = startPort + offset;
    const isFree = await testSinglePort(tryPort);
    if (isFree === true) return tryPort;
    if (isFree === null) break;
  }
  const errMsg = `listen EADDRINUSE: Exhausted ${maxRetries} sequential ports starting at ${startPort}`;
  process.stderr.write(`[gateway] ${errMsg}\n`);
  throw new Error(errMsg);
}

function handleCorsHeaders(req, res) {
  const origin = req.headers['origin'];
  if (origin && /^(https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?))$|^null$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-konoha-gateway-token');
}

function routeIncomingRequest(req, res, activeBridges) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (reqUrl.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  handleCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const p = reqUrl.pathname;
  if (req.method === 'GET' && (p === '/v1/models' || p === '/models')) {
    handleGetModels(activeBridges, req, res);
    return;
  }
  if (req.method === 'POST' && (p === '/v1/chat/completions' || p === '/chat/completions')) {
    handleChatCompletions(activeBridges, req, res);
    return;
  }
  if (req.method === 'POST' && p === '/v1/messages') {
    handleAnthropicMessages(activeBridges, req, res);
    return;
  }
  if (req.method === 'POST' && p === '/v1/messages/count_tokens') {
    readBody(req).catch(() => {});
    sendJson(res, 200, { input_tokens: 0 });
    return;
  }
  if (p.startsWith('/v1beta/models/')) {
    handleGeminiRequest(activeBridges, req, res);
    return;
  }

  sendJson(res, 404, { error: { message: `Unknown path: ${req.method} ${p}`, type: 'not_found' } });
}

function listenGatewayServer(server, boundPort) {
  return new Promise((resolve, reject) => {
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.maxRequestsPerSocket = 0;
    server.on('error', (err) => {
      process.stderr.write(`[gateway] Proxy Gateway server error: ${err.message}\n`);
    });
    server.listen(boundPort, '127.0.0.1', (err) => {
      if (err) return reject(err);
      process.stderr.write(`[gateway] Proxy Gateway running on http://127.0.0.1:${boundPort}\n`);
      resolve();
    });
  });
}

async function startGateway(activeBridges, port = 19999) {
  if (gatewayServer) {
    await stopGateway();
  }

  const boundPort = await findAvailablePort(port);
  gatewayServer = http.createServer((req, res) => {
    routeIncomingRequest(req, res, activeBridges);
  });

  return listenGatewayServer(gatewayServer, boundPort);
}

async function stopGateway() {
  if (!gatewayServer) return;
  return new Promise((resolve) => {
    gatewayServer.close(() => {
      process.stderr.write('[gateway] Proxy Gateway server stopped.\n');
      gatewayServer = null;
      resolve();
    });
  });
}

function parseBridgeModelsResponse(data, name) {
  try {
    const json = JSON.parse(data);
    if (json && Array.isArray(json.data)) {
      bridgeModelsCache.set(name, { data: json.data, timestamp: Date.now() });
      return json.data.map(m => ({ ...m, id: `${name}-${m.id}` }));
    }
  } catch (_) { /* non-fatal */ }
  return [];
}

function requestBridgeModels(port, name, resolve) {
  const clientReq = http.get(`http://127.0.0.1:${port}/v1/models`, (clientRes) => {
    let data = '';
    clientRes.on('data', (chunk) => { data += chunk; });
    clientRes.on('end', () => resolve(parseBridgeModelsResponse(data, name)));
  });
  clientReq.on('error', () => resolve([]));
  clientReq.setTimeout(10000, () => {
    clientReq.destroy();
    resolve([]);
  });
}

function fetchBridgeModelsCached(name, port) {
  if (bridgeModelsCache.has(name)) {
    const cached = bridgeModelsCache.get(name);
    const cachedData = cached.data || cached;
    return Promise.resolve(cachedData.map(m => ({ ...m, id: `${name}-${m.id}` })));
  }

  return new Promise((resolve) => requestBridgeModels(port, name, resolve));
}

function mapAnthropicModels(allModels) {
  return allModels.map((m) => {
    let displayName = m.display_name || m.name || m.id;
    if (!m.display_name && !m.name) {
      displayName = m.id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    const createdAt = m.created_at || (m.created ? new Date(m.created * 1000).toISOString() : new Date().toISOString());
    return {
      type: 'model',
      id: m.id,
      display_name: displayName,
      created_at: createdAt
    };
  });
}

async function handleGetModels(activeBridges, req, res) {
  const modelPromises = [];
  for (const [name, active] of activeBridges.entries()) {
    modelPromises.push(fetchBridgeModelsCached(name, active.bridgeConfig.port));
  }

  const results = await Promise.all(modelPromises);
  const allModels = results.flat();

  const isAnthropic = Boolean(
    req.headers['anthropic-version'] ||
    req.headers['x-api-key'] ||
    (req.headers['user-agent'] && req.headers['user-agent'].toLowerCase().includes('claude-code'))
  );

  if (isAnthropic) {
    const data = mapAnthropicModels(allModels);
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

function setupChatCompletionsEvents(forwardReq, res, options) {
  const { bridgeName, getLastActivity } = options;
  forwardReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`, type: 'gateway_error' } });
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
      sendJson(res, 504, { error: { message: `Bridge request timed out: no data for ${inactivityMs}ms`, type: 'gateway_timeout' } });
    }
  });
}

async function handleChatCompletions(activeBridges, req, res) {
  let lastActivityTime = Date.now();
  const resetStreamTimeout = () => { lastActivityTime = Date.now(); };

  try {
    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr);
    const model = body.model;
    if (!model || typeof model !== 'string') {
      return sendJson(res, 400, { error: { message: 'Missing model parameter', type: 'invalid_request_error' } });
    }

    const resolved = await resolveBridgeAndModel(model, activeBridges);
    if (!resolved) {
      return sendJson(res, 404, { error: { message: `No suitable bridge found for model: "${model}"`, type: 'not_found' } });
    }

    const { active, bridgeName, targetModel } = resolved;
    body.model = targetModel;
    const rewrittenBody = JSON.stringify(body);

    const headers = sanitizeForwardHeaders(req.headers);
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);
    if (active.bridgeConfig.apiKey) {
      headers['authorization'] = `Bearer ${active.bridgeConfig.apiKey}`;
    }

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: req.url,
      method: 'POST',
      headers,
      agent: httpAgent,
      timeout: STREAM_TIMEOUT_MS
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, { baseModel: targetModel, originalModel: model, onActivity: resetStreamTimeout });
    });

    setupChatCompletionsEvents(forwardReq, res, { bridgeName, getLastActivity: () => lastActivityTime });
    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    if (!res.headersSent) {
      const status = err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
      sendJson(res, status, { error: { message: err.message, type: 'internal_error' } });
    }
  }
}

module.exports = {
  startGateway,
  stopGateway,
  handleGetModels,
  handleChatCompletions,
  anthropicMessagesToOpenAi,
  extractAnthropicSystemText,
  anthropicToolsToOpenAi,
  openAIResponseToAnthropic,
  handleAnthropicMessages,
  handleGeminiRequest,
  resolveBridgeAndModel,
  pipeWithModelRewrite
};
