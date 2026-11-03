'use strict';

/**
 * Model Router for Generative 3D Asset Subsystem.
 * Dynamically resolves models and chat endpoints across all 8+ Client Coding Agents,
 * live 9router catalog, and Konoha LLM Bridges with zero hardcoded model strings.
 */

const { is9RouterInstalled, discover9RouterModels, get9RouterStatus, DEFAULT_9ROUTER_PORT, DEFAULT_9ROUTER_HOST } = require('../../nine_router');
const { discoverClientModels } = require('../../web/controllers/common');
const { getConnection } = require('../../db');

function resolve9RouterBaseUrl() {
  if (process.env.KONOHA_9ROUTER_URL) return process.env.KONOHA_9ROUTER_URL.replace(/\/+$/, '');
  const port = process.env.KONOHA_9ROUTER_PORT || DEFAULT_9ROUTER_PORT;
  return `http://${DEFAULT_9ROUTER_HOST}:${port}/v1`;
}

function resolveInherited3DModel(options = {}) {
  if (options.model && options.model !== '__custom__' && options.model.trim() !== '') {
    return options.model.trim();
  }

  if (process.env.KONOHA_3D_MODEL && process.env.KONOHA_3D_MODEL.trim() !== '') {
    return process.env.KONOHA_3D_MODEL.trim();
  }

  try {
    const conn = options.conn || getConnection();
    const row = conn.prepare("SELECT model FROM agents WHERE name = 'yamanaka'").get();
    if (row && row.model && row.model.trim() !== '') {
      return row.model.trim();
    }
  } catch (_) {}

  try {
    const clientModels = discoverClientModels();
    if (clientModels && clientModels.length > 0) {
      return clientModels[0].id;
    }
  } catch (_) {}

  try {
    const conn = options.conn || getConnection();
    const bridgeRow = conn.prepare("SELECT name FROM bridges WHERE enabled = 1 LIMIT 1").get();
    if (bridgeRow && bridgeRow.name) {
      return bridgeRow.name;
    }
  } catch (_) {}

  return null;
}

async function discoverAll3DModels(options = {}) {
  const refresh = options.refresh === true;
  const clientModels = discoverClientModels();
  const nineRouterStatus = await get9RouterStatus();

  let nineRouterModels = [];
  if (nineRouterStatus.installed || nineRouterStatus.running) {
    try {
      nineRouterModels = await discover9RouterModels({ forceRefresh: refresh });
    } catch (_) {
      nineRouterModels = [];
    }
  }

  let bridgeModels = [];
  try {
    const conn = options.conn || getConnection();
    const rows = conn.prepare("SELECT name as id, name as model_name, target_url, provider, enabled FROM bridges WHERE enabled = 1").all();
    bridgeModels = rows.map(r => ({
      id: r.id || r.model_name,
      model_name: r.model_name,
      bridge: r.provider || 'bridge',
      owned_by: r.provider || 'custom',
      source: 'bridge:sqlite'
    }));
  } catch (_) {}

  const seenIds = new Set();
  const allModels = [];

  function addModel(m, group) {
    if (!m || !m.id || seenIds.has(m.id)) return;
    seenIds.add(m.id);
    allModels.push({ ...m, group });
  }

  for (const m of nineRouterModels) addModel(m, '9router');
  for (const m of clientModels) addModel(m, 'client_agent');
  for (const m of bridgeModels) addModel(m, 'bridge');

  return {
    nine_router: nineRouterStatus,
    models: allModels,
    groups: {
      client_agents: clientModels,
      nine_router: nineRouterModels,
      bridges: bridgeModels
    }
  };
}

function resolveChatTargets(options = {}) {
  const resolvedModel = resolveInherited3DModel(options);
  const targets = [];
  const seenUrls = new Set();

  function addTarget(t) {
    const key = `${t.kind}:${t.target_url}`;
    if (!seenUrls.has(key)) {
      seenUrls.add(key);
      targets.push(t);
    }
  }

  if (options.endpoint_url) {
    const clean = options.endpoint_url.replace(/\/+$/, '');
    addTarget({
      kind: 'custom',
      target_url: clean,
      baseUrl: clean,
      api_key: options.api_key || '',
      apiKey: options.api_key || '',
      model: resolvedModel || options.model || 'default'
    });
  }

  if (is9RouterInstalled() || process.env.KONOHA_9ROUTER_URL || (resolvedModel && resolvedModel.startsWith('9router-'))) {
    const base = resolve9RouterBaseUrl();
    const rawModel = resolvedModel ? resolvedModel.replace(/^9router-/, '') : 'default';
    addTarget({
      kind: '9router',
      target_url: base,
      baseUrl: base,
      api_key: process.env.KONOHA_9ROUTER_API_KEY || '9router-local',
      apiKey: process.env.KONOHA_9ROUTER_API_KEY || '9router-local',
      model: rawModel
    });
  }

  try {
    const conn = options.conn || getConnection();
    if (resolvedModel) {
      const bridge = conn.prepare("SELECT target_url, api_key as auth_token, provider FROM bridges WHERE name = ? AND enabled = 1").get(resolvedModel, resolvedModel);
      if (bridge && bridge.target_url) {
        const clean = bridge.target_url.replace(/\/+$/, '');
        addTarget({
          kind: bridge.provider || 'bridge',
          target_url: clean,
          baseUrl: clean,
          api_key: bridge.auth_token || '',
          apiKey: bridge.auth_token || '',
          model: resolvedModel
        });
      }
    }
  } catch (_) {}

  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    addTarget({
      kind: 'openai',
      target_url: base,
      baseUrl: base,
      api_key: process.env.OPENAI_API_KEY,
      apiKey: process.env.OPENAI_API_KEY,
      model: resolvedModel || 'gpt-4o'
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    addTarget({
      kind: 'anthropic',
      target_url: base,
      baseUrl: base,
      api_key: process.env.ANTHROPIC_API_KEY,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: resolvedModel || 'claude-3-5-sonnet-20241022'
    });
  }

  return targets;
}

async function sendChatMessage(target, chatArgs = {}) {
  if (!target || (!target.target_url && !target.baseUrl)) {
    throw new Error('Valid target endpoint configuration required for sendChatMessage');
  }

  const baseUrl = (target.target_url || target.baseUrl).replace(/\/+$/, '');
  const apiKey = target.api_key || target.apiKey || '';
  const timeoutMs = chatArgs.timeoutMs || 45000;
  const requestedModel = chatArgs.model || target.model || 'default';

  // Format messages
  let messages = [];
  if (Array.isArray(chatArgs.messages)) {
    messages = chatArgs.messages;
  } else {
    if (chatArgs.system) {
      messages.push({ role: 'system', content: chatArgs.system });
    }
    if (chatArgs.imageBuffer) {
      const mime = chatArgs.mimeType || 'image/png';
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: chatArgs.userText || '' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mime};base64,${chatArgs.imageBuffer.toString('base64')}`
            }
          }
        ]
      });
    } else if (chatArgs.userText) {
      messages.push({ role: 'user', content: chatArgs.userText });
    }
  }

  const chatUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: requestedModel,
      messages,
      temperature: chatArgs.temperature !== undefined ? chatArgs.temperature : 0.2,
      max_tokens: chatArgs.max_tokens || 4096,
      stream: false
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`LLM endpoint ${chatUrl} failed with HTTP ${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = (choice && choice.message && choice.message.content) || (choice && choice.text) || '';
  const usage = data.usage || null;

  return {
    text,
    content: text,
    model_used: requestedModel,
    usage,
    raw: data
  };
}

module.exports = {
  resolve9RouterBaseUrl,
  resolveInherited3DModel,
  discoverAll3DModels,
  resolveChatTargets,
  sendChatMessage
};
