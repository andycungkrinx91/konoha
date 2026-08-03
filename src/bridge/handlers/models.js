'use strict';

const { MODEL_MAP } = require('../models');
const { sendJson, log } = require('../utils');

// ─────────────────────────────────────────────
// GET /v1/models
// ─────────────────────────────────────────────

async function handleModels(ctx, req, res) {
  const bridgeConfig = ctx.bridgeConfig || {};
  log(ctx, `DEBUG handleModels: bridgeConfig = ${JSON.stringify(bridgeConfig)}`);
  if (bridgeConfig.provider === 'openai' || bridgeConfig.provider === 'openai-compatible') {
    const targetUrl = bridgeConfig.targetUrl || '';
    if (!targetUrl) {
      return sendJson(res, 200, { object: 'list', data: [] });
    }

    let requestUrl = targetUrl;
    if (requestUrl.endsWith('/chat/completions')) {
      requestUrl = requestUrl.replace('/chat/completions', '/models');
    }
    if (!requestUrl.endsWith('/models')) {
      if (requestUrl.endsWith('/')) {
        requestUrl = requestUrl.slice(0, -1);
      }
      if (requestUrl.endsWith('/v1')) {
        requestUrl = requestUrl + '/models';
      } else {
        requestUrl = requestUrl + '/v1/models';
      }
    }

    const headers = {};
    if (bridgeConfig.apiKey) {
      headers['Authorization'] = `Bearer ${bridgeConfig.apiKey}`;
    } else if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    try {
      log(ctx, `📡 Fetching OpenAI models from: ${requestUrl}`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Upstream returned HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json && Array.isArray(json.data)) {
        return sendJson(res, 200, json);
      }
      return sendJson(res, 200, { object: 'list', data: [] });
    } catch (err) {
      log(ctx, `⚠️ Failed to fetch models from custom provider: ${err.message}`, true);
      return sendJson(res, 200, { object: 'list', data: [] });
    }
  }

  // Default antigravity provider: use hardcoded MODEL_MAP
  const data = Object.entries(MODEL_MAP)
    .filter(([, m]) => !m.hidden)
    .map(([id, m]) => ({
      id,
      object: 'model',
      created: 1700000000,
      owned_by: m.owned_by,
    }));
  sendJson(res, 200, { object: 'list', data });
}

module.exports = { handleModels };
