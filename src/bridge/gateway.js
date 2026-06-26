'use strict';

const http = require('http');

let gatewayServer = null;
const bridgeModelsCache = new Map();

async function getBridgeModels(bridgeName, activeBridge) {
  if (bridgeModelsCache.has(bridgeName)) {
    const cached = bridgeModelsCache.get(bridgeName);
    return new Set(cached.map(m => m.id));
  }

  const port = activeBridge.bridgeConfig.port;
  return new Promise((resolve) => {
    const clientReq = http.get(`http://127.0.0.1:${port}/v1/models`, (clientRes) => {
      let data = '';
      clientRes.on('data', (chunk) => { data += chunk; });
      clientRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && Array.isArray(json.data)) {
            bridgeModelsCache.set(bridgeName, json.data);
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
    clientReq.setTimeout(2000, () => {
      clientReq.destroy();
      resolve(new Set());
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function startGateway(activeBridges, port = 11434) {
  if (gatewayServer) {
    await stopGateway();
  }

  gatewayServer = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

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

function pipeWithModelRewrite(forwardRes, res, baseModel, originalModel) {
  const headers = { ...forwardRes.headers };
  delete headers['content-length'];
  res.writeHead(forwardRes.statusCode, headers);

  let buffer = '';
  forwardRes.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const rewritten = line.replaceAll(baseModel, originalModel);
      res.write(rewritten + '\n');
    }
  });

  forwardRes.on('end', () => {
    if (buffer) {
      const rewritten = buffer.replaceAll(baseModel, originalModel);
      res.write(rewritten);
    }
    res.end();
  });

  forwardRes.on('error', () => {
    res.end();
  });
}

async function handleGetModels(activeBridges, req, res) {
  const modelPromises = [];
  
  for (const [name, active] of activeBridges.entries()) {
    const port = active.bridgeConfig.port;
    if (bridgeModelsCache.has(name)) {
      const cached = bridgeModelsCache.get(name);
      const mapped = cached.map((m) => {
        const prefix = `${name}-`;
        return {
          ...m,
          id: m.id.startsWith(prefix) ? m.id : `${prefix}${m.id}`
        };
      });
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
                 bridgeModelsCache.set(name, json.data);

                 const mapped = json.data.map((m) => {
                   const prefix = `${name}-`;
                   return {
                     ...m,
                     id: m.id.startsWith(prefix) ? m.id : `${prefix}${m.id}`
                   };
                 });
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
  try {
    const bodyStr = await readBody(req);
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

    const idx = model.indexOf('-');
    if (idx === -1) {
      return sendJson(res, 400, {
        error: {
          message: `Invalid model name: "${model}". Model name must be in format "<bridge_name>-<model_name>"`,
          type: 'invalid_request_error'
        }
      });
    }

    const bridgeName = model.substring(0, idx);
    const baseModel = model.substring(idx + 1);

    const active = activeBridges.get(bridgeName);
    if (!active) {
      return sendJson(res, 404, {
        error: {
          message: `Bridge "${bridgeName}" is not running or not configured.`,
          type: 'not_found'
        }
      });
    }

    const originalModels = await getBridgeModels(bridgeName, active);
    const targetModel = originalModels.has(model) ? model : baseModel;

    body.model = targetModel;
    const rewrittenBody = JSON.stringify(body);

    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: req.url,
      method: 'POST',
      headers
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model);
    });

    forwardReq.on('error', (err) => {
      sendJson(res, 502, {
        error: {
          message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`,
          type: 'gateway_error'
        }
      });
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    sendJson(res, 500, { error: { message: err.message, type: 'internal_error' } });
  }
}

async function handleAnthropicMessages(activeBridges, req, res) {
  try {
    const bodyStr = await readBody(req);
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

    const idx = model.indexOf('-');
    if (idx === -1) {
      return sendJson(res, 400, {
        error: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Invalid model name: "${model}". Model name must be in format "<bridge_name>-<model_name>"`
          }
        }
      });
    }

    const bridgeName = model.substring(0, idx);
    const baseModel = model.substring(idx + 1);

    const active = activeBridges.get(bridgeName);
    if (!active) {
      return sendJson(res, 404, {
        error: {
          type: 'error',
          error: {
            type: 'not_found',
            message: `Bridge "${bridgeName}" is not running or not configured.`
          }
        }
      });
    }

    const originalModels = await getBridgeModels(bridgeName, active);
    const targetModel = originalModels.has(model) ? model : baseModel;

    body.model = targetModel;
    const rewrittenBody = JSON.stringify(body);

    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
    headers.host = `127.0.0.1:${active.bridgeConfig.port}`;
    headers['content-length'] = Buffer.byteLength(rewrittenBody);

    const forwardReq = http.request({
      hostname: '127.0.0.1',
      port: active.bridgeConfig.port,
      path: req.url,
      method: 'POST',
      headers
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model);
    });

    forwardReq.on('error', (err) => {
      sendJson(res, 502, {
        error: {
          type: 'error',
          error: {
            type: 'api_error',
            message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`
          }
        }
      });
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    sendJson(res, 500, { error: { type: 'error', error: { type: 'api_error', message: err.message } } });
  }
}

async function handleGeminiRequest(activeBridges, req, res) {
  const pathname = req.url;
  // Match /v1beta/models/([^/:]+)(?::(\w+))?
  const match = pathname.match(/\/v1beta\/models\/([^/:]+)(?::(\w+))?/);
  if (!match) {
    return sendJson(res, 400, { error: { code: 400, message: 'Invalid pathname format', status: 'INVALID_ARGUMENT' } });
  }

  const model = match[1];
  const operation = match[2] || '';

  const idx = model.indexOf('-');
  if (idx === -1) {
    return sendJson(res, 400, {
      error: {
        code: 400,
        message: `Invalid model name: "${model}". Model name must be in format "<bridge_name>-<model_name>"`,
        status: 'INVALID_ARGUMENT'
      }
    });
  }

  const bridgeName = model.substring(0, idx);
  const baseModel = model.substring(idx + 1);

  const active = activeBridges.get(bridgeName);
  if (!active) {
    return sendJson(res, 404, {
      error: {
        code: 404,
        message: `Bridge "${bridgeName}" is not running or not configured.`,
        status: 'NOT_FOUND'
      }
    });
  }

  try {
    const originalModels = await getBridgeModels(bridgeName, active);
    const targetModel = originalModels.has(model) ? model : baseModel;

    // Rewrite URL path
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
      headers
    }, (forwardRes) => {
      pipeWithModelRewrite(forwardRes, res, targetModel, model);
    });

    forwardReq.on('error', (err) => {
      sendJson(res, 502, {
        error: {
          code: 502,
          message: `Gateway failed to reach bridge "${bridgeName}": ${err.message}`,
          status: 'INTERNAL'
        }
      });
    });

    forwardReq.write(rewrittenBody);
    forwardReq.end();
  } catch (err) {
    sendJson(res, 500, { error: { code: 500, message: err.message, status: 'INTERNAL' } });
  }
}

function readBody(req, maxBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy(new Error(`Request body exceeds ${maxBytes} bytes`));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}

module.exports = { startGateway, stopGateway };
