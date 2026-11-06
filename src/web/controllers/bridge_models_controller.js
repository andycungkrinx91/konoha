'use strict';

const dbBridges = require('../../db_bridges');
const { sendJson, validateBridgeTargetUrl, discoverClientModels } = require('./common');
const { probeOpenAiCompatibleEndpoint } = require('../../provider_sources');

function _parseBridgeModelsResponse(d, bridgeName) {
  try {
    const parsedData = JSON.parse(d);
    return { bridge: bridgeName, data: Array.isArray(parsedData?.data) ? parsedData.data : [] };
  } catch {
    return { bridge: bridgeName, data: [] };
  }
}

function _fetchBridgeModels(bridge) {
  let targetPath = bridge.target_url || bridge.targetUrl || `http://127.0.0.1:${bridge.port}`;
  if (targetPath.endsWith('/chat/completions')) targetPath = targetPath.replace('/chat/completions', '/models');
  if (!targetPath.endsWith('/models')) {
    if (targetPath.endsWith('/')) targetPath = targetPath.slice(0, -1);
    targetPath = targetPath.endsWith('/v1') ? targetPath + '/models' : targetPath + '/v1/models';
  }
  const check = validateBridgeTargetUrl(targetPath);
  if (!check.ok) return Promise.resolve({ bridge: bridge.name, data: [] });
  try {
    const parsed = check.parsed;
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    const headers = {};
    const key = bridge.api_key || bridge.apiKey;
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (key && (parsed.protocol === 'https:' || isLoopback)) {
      headers['Authorization'] = `Bearer ${key}`;
    }
    return new Promise((resolve) => {
      const reqMod = mod.get(url, { headers }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve(_parseBridgeModelsResponse(d, bridge.name)));
      });
      reqMod.on('error', () => resolve({ bridge: bridge.name, data: [] }));
      reqMod.setTimeout(5000, () => { reqMod.destroy(); resolve({ bridge: bridge.name, data: [] }); });
    });
  } catch {
    return Promise.resolve({ bridge: bridge.name, data: [] });
  }
}

async function _collectBridgeSources() {
  try {
    const nineRouter = require('../../nine_router');
    const routerStatus = await nineRouter.get9RouterStatus();
    const sources = [{
      id: '9router',
      label: '9router',
      provider: '9router',
      installed: routerStatus.installed,
      running: routerStatus.running,
      base_url: routerStatus.base_url,
      model_count: routerStatus.model_count,
      has_credentials: false
    }];
    for (const candidate of nineRouter.COMPATIBLE_SOURCES) {
      const probe = await probeOpenAiCompatibleEndpoint(candidate.port, candidate.host);
      sources.push({
        id: candidate.id,
        label: candidate.label,
        provider: candidate.provider,
        installed: probe.ok,
        running: probe.ok,
        base_url: `http://${candidate.host}:${candidate.port}/v1`,
        model_count: probe.ok ? probe.data.length : 0,
        has_credentials: false
      });
    }
    return sources;
  } catch (_) {
    return [];
  }
}

async function handleBridgesModels(res, pathname) {
  if (pathname === '/api/v1/9router/status' || pathname === '/api/v1/router/status') {
    try {
      const nineRouter = require('../../nine_router');
      return sendJson(res, 200, await nineRouter.get9RouterStatus());
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  try {
    const bridges = dbBridges.listBridges();
    const enabledBridges = bridges.filter(b => b.enabled && (b.target_url || b.targetUrl));
    const results = await Promise.all(enabledBridges.map(_fetchBridgeModels));
    const models = [];
    for (const resItem of results) {
      for (const m of resItem.data) {
        models.push({ id: `${resItem.bridge}-${m.id}`, model_name: m.id, bridge: resItem.bridge, owned_by: m.owned_by || resItem.bridge, source: 'bridge' });
      }
    }
    for (const cm of discoverClientModels()) models.push(cm);
    const nineRouter = require('../../nine_router');
    for (const nm of await nineRouter.discover9RouterModels()) models.push(nm);
    const nineRouterStatus = await nineRouter.get9RouterStatus();
    const sources = await _collectBridgeSources();
    return sendJson(res, 200, { models, total: models.length, nine_router: nineRouterStatus, sources });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

module.exports = {
  handleBridgesModels,
  _fetchBridgeModels,
  _collectBridgeSources
};
