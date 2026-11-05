'use strict';

/**
 * Model Router for Generative 3D Asset Subsystem.
 * Resolves Client Coding Agent credentials, active model roles, and chat endpoints
 * at runtime from environment variables and on-disk client configuration files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { is9RouterInstalled, discover9RouterModels, get9RouterStatus, DEFAULT_9ROUTER_PORT, DEFAULT_9ROUTER_HOST } = require('../../nine_router');
const { discoverClientModels } = require('../../web/controllers/common');
const { getConnection } = require('../../db');
const { parseYaml } = require('../../yaml_utils');

const REQUESTED_9ROUTER_HOSTS = /(?:9router|:20128)/i;
const PROVIDER_PREFIX = /^(?:9router[/-])+/i;
const EFFORT_SUFFIX = /:(?:none|low|medium|high|max|auto|xhigh|thinking)$/i;

function resolve9RouterBaseUrl() {
  if (process.env.KONOHA_9ROUTER_URL) return process.env.KONOHA_9ROUTER_URL.replace(/\/+$/, '');
  const clientCfg = readClientProviderCredentials();
  const configured = clientCfg.providers['9router'];
  if (configured && configured.baseUrl) return configured.baseUrl.replace(/\/+$/, '');
  const port = process.env.KONOHA_9ROUTER_PORT || DEFAULT_9ROUTER_PORT;
  return `http://${DEFAULT_9ROUTER_HOST}:${port}/v1`;
}

function readJsonIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readYamlIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseYaml(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function normalizeModelId(rawId) {
  if (!rawId || typeof rawId !== 'string') return '';
  return rawId.trim().replace(PROVIDER_PREFIX, '').replace(EFFORT_SUFFIX, '').trim();
}

function stripVsuffix(modelId) {
  return String(modelId || '')
    .replace(/-v\d+$/i, '')
    .trim();
}

function collectClientRoles(ompConfig) {
  const roles = (ompConfig && ompConfig.modelRoles) || {};
  const priority = ['default', 'plan', 'task', 'slow', 'advisor', 'smol', 'tiny', 'vision', 'memory', 'commit', 'judge'];
  const ordered = priority.filter((k) => roles[k]).map((k) => roles[k]);
  return ordered
    .filter((v) => typeof v === 'string' && /^9router[/-]/i.test(v))
    .map((v) => normalizeModelId(v))
    .filter(Boolean);
}

function readClaudeSettings(homeDir, providers, preferredModels) {
  const settings = readJsonIfPresent(path.join(homeDir, '.claude', 'settings.json'));
  const env = (settings && settings.env) || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || '';
  const token = env.ANTHROPIC_AUTH_TOKEN || '';
  const modelKeys = ['ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL'];
  for (const key of modelKeys) {
    const value = normalizeModelId(env[key]);
    if (value) preferredModels.push(value);
  }
  if (baseUrl && token) {
    if (REQUESTED_9ROUTER_HOSTS.test(baseUrl)) {
      if (!providers['9router']) providers['9router'] = { baseUrl, apiKey: token, source: 'claude-settings' };
    } else if (token.startsWith('sk-ant')) {
      providers.anthropic = { baseUrl, apiKey: token, source: 'claude-settings' };
    }
  }
}

function readOpencodeConfig(homeDir, providers) {
  const cfg = readJsonIfPresent(path.join(homeDir, '.config', 'opencode', 'opencode.json'));
  const declared = cfg && cfg.provider;
  if (!declared || typeof declared !== 'object') return;
  for (const [id, entry] of Object.entries(declared)) {
    const options = (entry && entry.options) || {};
    const models = (entry && entry.models) || {};
    const baseUrl = options.baseURL || options.baseUrl || '';
    if (!baseUrl) continue;
    providers[id] = {
      baseUrl,
      apiKey: options.apiKey || options.api_key || '',
      models: Object.keys(models).map((m) => `${id}/${m}`),
      source: 'opencode'
    };
  }
}

function is9RouterProvider(id, entry) {
  if (!entry) return false;
  if (/^9router/i.test(String(id))) return true;
  return /9router|:20128/i.test(String(entry.baseUrl || ''));
}

function readClientProviderCredentials(homeDir = os.homedir()) {
  const providers = {};
  const preferredModels = [];

  if (process.env.KONOHA_9ROUTER_API_KEY || process.env.KONOHA_9ROUTER_URL) {
    providers['9router'] = {
      baseUrl: process.env.KONOHA_9ROUTER_URL || `http://${DEFAULT_9ROUTER_HOST}:${process.env.KONOHA_9ROUTER_PORT || DEFAULT_9ROUTER_PORT}/v1`,
      apiKey: process.env.KONOHA_9ROUTER_API_KEY || '',
      source: 'env'
    };
  }
  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      source: 'env'
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = {
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
      source: 'env'
    };
  }

  const ompModels = readYamlIfPresent(path.join(homeDir, '.omp', 'agent', 'models.yml'));
  const ompProvider = ompModels && ompModels.providers && ompModels.providers['9router'];
  if (ompProvider) {
    providers['9router'] = {
      baseUrl: ompProvider.baseUrl || providers['9router']?.baseUrl,
      apiKey: ompProvider.apiKey || providers['9router']?.apiKey || '',
      source: 'omp-models-yml'
    };
  }

  const ompConfig = readYamlIfPresent(path.join(homeDir, '.omp', 'agent', 'config.yml'));
  preferredModels.push(...collectClientRoles(ompConfig));

  readClaudeSettings(homeDir, providers, preferredModels);
  readOpencodeConfig(homeDir, providers);

  return { providers, preferredModels: [...new Set(preferredModels.filter(Boolean))] };
}

function candidateModelsFor(providerId, credentials, requestedModel) {
  const entry = credentials.providers[providerId] || {};
  const owned = Array.isArray(entry.models) ? entry.models : [];
  const preferred = credentials.preferredModels;
  const requested = normalizeModelId(requestedModel);
  const pool = [requested, ...preferred, ...owned].filter(Boolean);
  if (owned.length > 0) {
    const ownedSet = new Set(owned);
    return [...new Set(pool.filter((m) => ownedSet.has(m)))];
  }
  return [...new Set(pool)];
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
  } catch { /* intentional best-effort fallback: router falls back to the default model */ }

  const credentials = readClientProviderCredentials();
  const routerConfigured = Boolean(credentials.providers['9router'] && credentials.providers['9router'].baseUrl);
  if (credentials.preferredModels.length > 0) {
    return routerConfigured ? normalizeModelId(credentials.preferredModels[0]) : credentials.preferredModels[0];
  }

  try {
    const conn = options.conn || getConnection();
    const bridgeRow = conn.prepare('SELECT name FROM bridges WHERE enabled = 1 LIMIT 1').get();
    if (bridgeRow && bridgeRow.name) {
      return bridgeRow.name;
    }
  } catch { /* intentional best-effort fallback: router falls back to the default model */ }

  try {
    const clientModels = discoverClientModels();
    if (clientModels && clientModels.length > 0) {
      return clientModels[0].id;
    }
  } catch { /* intentional best-effort fallback: router falls back to the default model */ }

  return null;
}


function rankModels(models, preferredModels) {
  const preferredNorm = preferredModels.map((m) => normalizeModelId(m));
  const rankIndex = new Map();
  preferredNorm.forEach((m, idx) => {
    if (!rankIndex.has(m)) rankIndex.set(m, idx);
    const base = stripVsuffix(m);
    if (!rankIndex.has(base)) rankIndex.set(base, idx);
    const family = base.split('/').slice(0, 2).join('/');
    if (family && !rankIndex.has(family)) rankIndex.set(family, idx + 0.5);
  });
  return models
    .map((m, idx) => {
      const candidates = [normalizeModelId(m.id), stripVsuffix(normalizeModelId(m.id))];
      let rank = Infinity;
      for (const c of candidates) {
        if (rankIndex.has(c)) rank = Math.min(rank, rankIndex.get(c));
      }
      return { model: m, rank, idx };
    })
    .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
    .map((entry) => entry.model);
}

function filterRouterOwnedModels(models) {
  return models.filter((m) => {
    const owner = String((m && (m.owned_by || m.bridge || m.source)) || '');
    const id = String((m && m.id) || '');
    return /9router/i.test(owner) || /9router/i.test(id) || !owner;
  });
}

async function discoverAll3DModels(options = {}) {
  const refresh = options.refresh === true;
  const credentials = readClientProviderCredentials(options.homeDir);
  const routerConfigured = Boolean(credentials.providers['9router'] && credentials.providers['9router'].baseUrl);
  const discoveredClients = discoverClientModels();
  const clientModels = routerConfigured ? filterRouterOwnedModels(discoveredClients) : discoveredClients;
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
    const rows = conn.prepare('SELECT name as id, name as model_name, target_url, provider, enabled FROM bridges WHERE enabled = 1').all();
    bridgeModels = rows.map((r) => ({
      id: r.id || r.model_name,
      model_name: r.model_name,
      bridge: r.provider || 'bridge',
      owned_by: r.provider || 'custom',
      source: 'bridge:sqlite'
    }));
  } catch { /* intentional best-effort fallback: router falls back to the default model */ }

  const seenIds = new Set();
  const allModels = [];

  function addModel(m, group) {
    if (!m || !m.id || seenIds.has(m.id)) return;
    seenIds.add(m.id);
    allModels.push({ ...m, group });
  }

  for (const m of nineRouterModels) addModel(m, '9router');
  for (const m of clientModels) addModel(m, 'client_agent');
  if (!routerConfigured) for (const m of bridgeModels) addModel(m, 'bridge');

  const seenNormalized = new Set();
  const ranked = [];
  for (const model of rankModels(allModels, credentials.preferredModels)) {
    const id = normalizeModelId(model.id);
    if (!id || seenNormalized.has(id)) continue;
    seenNormalized.add(id);
    ranked.push({ ...model, id });
  }
  const normalizedPreferred = credentials.preferredModels.map((m) => normalizeModelId(m));

  return {
    nine_router: nineRouterStatus,
    client_default_model: ranked.length > 0 ? ranked[0].id : null,
    preferred_models: normalizedPreferred,
    models: ranked,
    groups: {
      client_agents: clientModels,
      nine_router: nineRouterModels,
      bridges: bridgeModels
    }
  };
}

function addUniqueTarget(targets, seenUrls, target) {
  const key = `${target.kind}:${target.target_url}:${target.model || ''}`;
  if (target.target_url && !seenUrls.has(key)) {
    seenUrls.add(key);
    targets.push(target);
  }
}

function resolveBridgeTargets(options, resolvedModel, addTarget) {
  try {
    const conn = options.conn || getConnection();
    if (!resolvedModel) return;
    const bridge = conn.prepare('SELECT target_url, api_key as auth_token, provider FROM bridges WHERE name = ? AND enabled = 1').get(resolvedModel);
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
  } catch { /* intentional best-effort fallback: router falls back to the default model */ }
}

function resolveChatTargets(options = {}) {
  const resolvedModel = resolveInherited3DModel(options);
  const credentials = readClientProviderCredentials(options.homeDir);
  const targets = [];
  const seenUrls = new Set();
  const addTarget = (t) => addUniqueTarget(targets, seenUrls, t);

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

  const routerTargets = [];
  if (is9RouterInstalled() || process.env.KONOHA_9ROUTER_URL || /^9router/i.test(resolvedModel || '')) {
    const base = resolve9RouterBaseUrl();
    const routerKey = credentials.providers['9router']?.apiKey || process.env.KONOHA_9ROUTER_API_KEY || '';
    for (const modelId of candidateModelsFor('9router', credentials, resolvedModel)) {
      routerTargets.push({
        kind: '9router',
        target_url: base,
        baseUrl: base,
        api_key: routerKey,
        apiKey: routerKey,
        model: modelId
      });
    }
  }
  routerTargets.slice(0, 4).forEach(addTarget);

  resolveBridgeTargets(options, resolvedModel, addTarget);

  const routerConfigured = Boolean(credentials.providers['9router'] && credentials.providers['9router'].baseUrl);
  if (routerConfigured) return targets;

  for (const [id, entry] of Object.entries(credentials.providers)) {
    if (id === '9router' || !is9RouterProvider(id, entry) && !entry.models) continue;
    if (!entry.baseUrl) continue;
    const catalog = candidateModelsFor(id, credentials, resolvedModel);
    for (const modelId of catalog.slice(0, 1)) {
      addTarget({
        kind: id,
        target_url: entry.baseUrl.replace(/\/+$/, ''),
        baseUrl: entry.baseUrl.replace(/\/+$/, ''),
        api_key: entry.apiKey,
        apiKey: entry.apiKey,
        model: modelId
      });
    }
  }

  return targets;
}

function buildChatMessages(chatArgs) {
  if (Array.isArray(chatArgs.messages)) return chatArgs.messages;
  const messages = [];
  if (chatArgs.system) messages.push({ role: 'system', content: chatArgs.system });
  if (chatArgs.imageBuffer) {
    const mime = chatArgs.mimeType || 'image/png';
    const content = [
      { type: 'text', text: chatArgs.userText || '' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${chatArgs.imageBuffer.toString('base64')}` } }
    ];
    for (const extra of chatArgs.extraImages || []) {
      if (!extra || !extra.buffer) continue;
      content.push({
        type: 'image_url',
        image_url: { url: `data:${extra.mimeType || 'image/png'};base64,${extra.buffer.toString('base64')}` }
      });
    }
    messages.push({ role: 'user', content });
  } else if (chatArgs.userText) {
    messages.push({ role: 'user', content: chatArgs.userText });
  }
  return messages;
}

function applySseChunk(chunk, acc) {
  const line = chunk.trim();
  if (!line.startsWith('data:')) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (_) {
    return;
  }
  if (parsed.usage) acc.usage = parsed.usage;
  const choice = parsed.choices && parsed.choices[0];
  if (!choice) return;
  const delta = choice.delta || choice.message || {};
  if (typeof delta.content === 'string') acc.content += delta.content;
  if (typeof delta.reasoning_content === 'string') acc.reasoning += delta.reasoning_content;
  if (typeof choice.text === 'string') acc.content += choice.text;
  acc.rawChunks.push(parsed);
}

async function readChatResponse(res, chatArgs, requestedModel) {
  const contentType = String(res.headers.get('content-type') || '');
  const shouldStream = contentType.includes('text/event-stream') || !contentType.includes('json');

  if (!shouldStream) {
    const data = await res.json();
    const choice = data.choices && data.choices[0];
    const text = (choice && choice.message && choice.message.content) || (choice && choice.text) || '';
    const reasoning = (choice && choice.message && choice.message.reasoning_content) || '';
    return { text, reasoning, usage: data.usage || null, raw: data };
  }

  const acc = { content: '', reasoning: '', usage: null, rawChunks: [] };
  const decoder = new TextDecoder();
  let buffer = '';
  let lastReport = Date.now();
  const flush = (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const part of parts) applySseChunk(part, acc);
  };

  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      flush(decoder.decode(value, { stream: true }));
      if (chatArgs.onProgress && Date.now() - lastReport > 400) {
        lastReport = Date.now();
        chatArgs.onProgress({ model: requestedModel, contentLength: acc.content.length, reasoningLength: acc.reasoning.length, usage: acc.usage });
      }
    }
  } else {
    flush(await res.text());
  }
  if (buffer.trim()) applySseChunk(buffer, acc);

  return { text: acc.content, reasoning: acc.reasoning, usage: acc.usage, raw: { chunks: acc.rawChunks.length } };
}

async function sendChatMessage(target, chatArgs = {}) {
  if (!target || (!target.target_url && !target.baseUrl)) {
    throw new Error('Valid target endpoint configuration required for sendChatMessage');
  }

  const baseUrl = (target.target_url || target.baseUrl).replace(/\/+$/, '');
  const apiKey = target.api_key || target.apiKey || '';
  const timeoutMs = chatArgs.timeoutMs || 45000;
  const requestedModel = normalizeModelId(chatArgs.model || target.model || 'default') || 'default';
  const messages = buildChatMessages(chatArgs);

  const chatUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: requestedModel,
      messages,
      temperature: chatArgs.temperature !== undefined ? chatArgs.temperature : 0.2,
      max_tokens: chatArgs.max_tokens || 8192,
      stream: false,
      // Providers that support prompt caching (9router/Anthropic-style) reuse the
      // byte-stable system prompt + spec schema across iterations.
      ...(chatArgs.cacheKey ? { cache_key: chatArgs.cacheKey, prompt_cache_key: chatArgs.cacheKey } : {})
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    const err = new Error(`LLM endpoint ${chatUrl} failed with HTTP ${res.status}: ${errorText.slice(0, 200)}`);
    err.status = res.status;
    err.model = requestedModel;
    throw err;
  }

  const parsed = await readChatResponse(res, chatArgs, requestedModel);
  return {
    text: parsed.text,
    content: parsed.text,
    reasoning: parsed.reasoning,
    model_used: requestedModel,
    usage: parsed.usage,
    raw: parsed.raw
  };
}

const STRONG_MODEL_PATTERN = /(opus|gpt-5|gpt5|sonnet-4|o3|gemini-2\.5-pro|claude-4|grok-4|deepseek-r1)/i;

/**
 * Stage model split: routing/brief work stays on the already-selected (cheap)
 * model, while visual critique prefers the strongest available catalog entry.
 */
function resolveStageModels(options = {}) {
  const routingModel = options.routing || options.model || resolveInherited3DModel(options) || null;
  let critiqueModel = options.critique || null;
  if (!critiqueModel) {
    const catalog = Array.isArray(options.catalogModels) ? options.catalogModels : [];
    const strong = catalog.find((id) => STRONG_MODEL_PATTERN.test(String(id)));
    critiqueModel = strong || routingModel;
  }
  return { routing_model: routingModel, critique_model: critiqueModel };
}

module.exports = {
  resolveStageModels,
  resolve9RouterBaseUrl,
  readClientProviderCredentials,
  normalizeModelId,
  resolveInherited3DModel,
  discoverAll3DModels,
  resolveChatTargets,
  sendChatMessage
};
