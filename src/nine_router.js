const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isCommandAvailable } = require('./platform_utils');

const DEFAULT_9ROUTER_PORT = 20128;
const DEFAULT_9ROUTER_HOST = '127.0.0.1';
const PROBE_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 5000;

let cachedModels = null;
let lastFetchTime = 0;

/**
 * Detects whether 9router is installed on the local system.
 * Follows same non-destructive detector conventions as Semble and RTK.
 */
function is9RouterInstalled() {
  try {
    if (isCommandAvailable('9router')) return true;

    const HOME = os.homedir();
    if (fs.existsSync(path.join(HOME, '.config', '9router'))) return true;

    // Check if client configurations reference 9router
    const claudeSettings = path.join(HOME, '.claude', 'settings.json');
    if (fs.existsSync(claudeSettings)) {
      try {
        const text = fs.readFileSync(claudeSettings, 'utf8');
        if (text.includes('20128') || text.includes('9router')) return true;
      } catch (_) {
        /* ignore unreadable claude settings */
      }
    }

    const ompModelsYml = path.join(HOME, '.omp', 'agent', 'models.yml');
    if (fs.existsSync(ompModelsYml)) {
      try {
        const text = fs.readFileSync(ompModelsYml, 'utf8');
        if (text.includes('20128') || text.includes('9router')) return true;
      } catch (_) {
        /* ignore unreadable omp models config */
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

function _parseModelsResponse(body, statusCode) {
  if (statusCode < 200 || statusCode >= 300) {
    return { ok: false, statusCode, data: [] };
  }
  try {
    const data = JSON.parse(body);
    if (data && Array.isArray(data.data)) {
      return { ok: true, statusCode, data: data.data };
    }
  } catch (_) { /* ignore */ }
  return { ok: false, statusCode, data: [] };
}

function _wireProbeRequest(req, resolve) {
  req.on('error', () => resolve({ ok: false, error: 'connection_refused', data: [] }));
  req.on('timeout', () => {
    req.destroy();
    resolve({ ok: false, error: 'timeout', data: [] });
  });
}

function _handleProbeResponse(res, resolve) {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => resolve(_parseModelsResponse(body, res.statusCode)));
}

/**
 * Probes whether the 9router local HTTP service is currently listening and responsive.
 */
function probe9RouterEndpoint(port = DEFAULT_9ROUTER_PORT, host = DEFAULT_9ROUTER_HOST) {
  return new Promise((resolve) => {
    try {
      const req = http.get(
        `http://${host}:${port}/v1/models`,
        { timeout: PROBE_TIMEOUT_MS },
        (res) => _handleProbeResponse(res, resolve)
      );
      _wireProbeRequest(req, resolve);
    } catch (err) {
      resolve({ ok: false, error: err.message, data: [] });
    }
  });
}

/**
 * Discovers actual 9router models with full endpoint IDs.
 * Formats IDs with provider prefixes (e.g. 9router-ag/gemini-3.8-flash-high).
 */
async function discover9RouterModels(options = {}) {
  const port = options.port || DEFAULT_9ROUTER_PORT;
  const host = options.host || DEFAULT_9ROUTER_HOST;
  const now = Date.now();

  if (port === DEFAULT_9ROUTER_PORT && host === DEFAULT_9ROUTER_HOST && cachedModels && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedModels;
  }

  const result = await probe9RouterEndpoint(port, host);
  if (!result.ok || !Array.isArray(result.data)) {
    if (port === DEFAULT_9ROUTER_PORT && host === DEFAULT_9ROUTER_HOST) {
      cachedModels = null;
    }
    return [];
  }

  const models = [];
  const seen = new Set();

  for (const item of result.data) {
    const rawId = item.id || '';
    if (!rawId) continue;

    // Full endpoint ID with provider prefix, e.g. 9router-ag/gemini-3.8-flash-high
    const fullId = rawId.startsWith('9router-')
      ? rawId
      : (rawId.startsWith('9router/') ? `9router-${rawId.slice(8)}` : `9router-${rawId}`);

    if (seen.has(fullId)) continue;
    seen.add(fullId);

    models.push({
      id: fullId,
      model_name: fullId,
      raw_id: rawId,
      bridge: '9router',
      owned_by: item.owned_by || '9router',
      source: '9router',
      capabilities: item.capabilities || null,
      context_length: item.context_length || null
    });
  }

  cachedModels = models;
  lastFetchTime = now;
  return models;
}

/**
 * Returns comprehensive status of 9router integration.
 */
async function get9RouterStatus(port = DEFAULT_9ROUTER_PORT) {
  const installed = is9RouterInstalled();
  const probe = await probe9RouterEndpoint(port);

  return {
    installed,
    running: probe.ok,
    port,
    base_url: `http://${DEFAULT_9ROUTER_HOST}:${port}/v1`,
    model_count: probe.ok ? probe.data.length : 0,
    error: probe.ok ? null : (probe.error || 'unreachable')
  };
}

module.exports = {
  is9RouterInstalled,
  probe9RouterEndpoint,
  discover9RouterModels,
  get9RouterStatus,
  DEFAULT_9ROUTER_PORT,
  DEFAULT_9ROUTER_HOST
};
