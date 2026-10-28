'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../db');
const dbBridges = require('../../db_bridges');
const dbSavings = require('../../db_savings');
const agentManager = require('../../agent_manager');
const { SKILLS_DB_DIR } = require('../../../bin/lib/paths');
const { killProcessOnPort } = require('../../platform_utils');
const { checkPortActive } = require('../../bridge/utils');
const {
  sendJson,
  parseBody,
  isClientConfigured,
  spawnGatewayDaemon,
  validateBridgeTargetUrl,
  isAuthorizedRequest,
  discoverClientModels
} = require('./common');

function _handleCsrfAndHealth(req, res, pathname, method, ctx) {
  if (method !== 'GET') return false;
  if (pathname === '/api/v1/csrf' || pathname === '/api/v1/token') {
    return sendJson(res, 200, {
      token: ctx.sessionToken,
      version: ctx.SERVER_VERSION,
      port: ctx.PORT,
      uptime: Math.round(process.uptime())
    });
  }
  if (pathname === '/api/v1/health') {
    const isAuth = isAuthorizedRequest(req, ctx.sessionToken);
    if (!isAuth) {
      return sendJson(res, 200, {
        status: 'healthy',
        version: ctx.SERVER_VERSION,
        uptime: Math.round(process.uptime()),
        node: process.version,
        platform: process.platform
      });
    }
    let skillsCount = 0;
    let agentsCount = 0;
    try {
      const conn = db.getConnection(null, false);
      skillsCount = conn.prepare('SELECT COUNT(*) as c FROM skills').get().c;
      agentsCount = conn.prepare('SELECT COUNT(*) as c FROM agents').get().c;
      conn.close();
    } catch (_) { /* intentional best-effort fallback */ }
    return sendJson(res, 200, {
      status: 'healthy',
      version: ctx.SERVER_VERSION,
      uptime: Math.round(process.uptime()),
      port: ctx.PORT,
      db_path: db.DB_PATH,
      skills_count: skillsCount,
      agents_count: agentsCount,
      node: process.version,
      platform: process.platform
    });
  }
  return false;
}

function _computeCpuStats(systemMetrics) {
  const cpuTimesNow = os.cpus().reduce((acc, c) => {
    acc.idle += c.times.idle;
    acc.total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
    return acc;
  }, { idle: 0, total: 0 });
  let systemCpuPct = null;
  if (systemMetrics._lastCpuTimes && systemMetrics._lastCpuTimes.total > 0) {
    const idleDelta = cpuTimesNow.idle - systemMetrics._lastCpuTimes.idle;
    const totalDelta = cpuTimesNow.total - systemMetrics._lastCpuTimes.total;
    if (totalDelta > 0) systemCpuPct = Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
  }
  systemMetrics._lastCpuTimes = cpuTimesNow;

  const cpuUsageNow = process.cpuUsage();
  let processCpuPct = null;
  if (systemMetrics._lastCpuUsage) {
    const userDelta = (cpuUsageNow.user - systemMetrics._lastCpuUsage.user) / 1e6;
    const sysDelta = (cpuUsageNow.system - systemMetrics._lastCpuUsage.system) / 1e6;
    const wallDelta = Number(process.hrtime.bigint() - systemMetrics._lastHrtime) / 1e9;
    if (wallDelta > 0) processCpuPct = Math.round(((userDelta + sysDelta) / wallDelta) * 1000) / 10;
  }
  systemMetrics._lastCpuUsage = cpuUsageNow;
  systemMetrics._lastHrtime = process.hrtime.bigint();
  return { systemCpuPct, processCpuPct };
}

function _collectDiskMounts() {
  const diskMounts = [];
  if (typeof fs.statfsSync !== 'function') return diskMounts;
  try {
    const diskPaths = [path.parse(os.homedir()).root, path.join(os.homedir(), '.konoha')];
    const seenMounts = new Set();
    for (const mountPath of diskPaths) {
      try {
        const st = fs.statfsSync(mountPath);
        const mountSig = `${st.type}:${st.blocks}:${st.bsize}`;
        if (seenMounts.has(mountSig)) continue;
        seenMounts.add(mountSig);
        const totalBytes = Number(st.blocks) * Number(st.bsize);
        const freeBytes = Number(st.bfree) * Number(st.bsize);
        diskMounts.push({
          mount: mountPath,
          total_bytes: totalBytes,
          free_bytes: freeBytes,
          used_bytes: totalBytes - freeBytes,
          used_pct: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : null
        });
      } catch (_) { /* skip unreachable mount */ }
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return diskMounts;
}

function _collectDbFeatures(features) {
  try {
    const conn = db.getConnection(null, false);
    features.agents = conn.prepare('SELECT COUNT(*) as c FROM agents').get().c;
    features.agent_names = conn.prepare('SELECT name FROM agents ORDER BY name').all().map(r => r.name);
    features.skills = conn.prepare('SELECT COUNT(*) as c FROM skills').get().c;
    features.skills_by_type = conn.prepare('SELECT type, COUNT(*) as c FROM skills GROUP BY type ORDER BY c DESC').all()
      .reduce((acc, r) => { acc[r.type] = r.c; return acc; }, {});
    try {
      features.vectors_total_chunks = conn.prepare('SELECT COUNT(*) as c FROM skill_chunks').get().c;
      features.vectorized_skills = conn.prepare('SELECT count(DISTINCT skill_name) as c FROM skill_chunks WHERE embedding IS NOT NULL').get().c;
      features.embedded_chunks = conn.prepare('SELECT count(*) as c FROM skill_chunks WHERE embedding IS NOT NULL').get().c;
    } catch (_) { features.vectors_total_chunks = 0; features.vectorized_skills = 0; features.embedded_chunks = 0; }
    try {
      features.persona_memories = conn.prepare('SELECT COUNT(*) as c FROM persona_memories').get().c;
      features.persona_projects = conn.prepare('SELECT COUNT(DISTINCT project_hash) as c FROM persona_memories').get().c;
    } catch (_) { features.persona_memories = 0; features.persona_projects = 0; }
    conn.close();
  } catch (_) { /* intentional best-effort fallback */ }
}

async function _collectBridgeFeatures(features) {
  try {
    const bridges = dbBridges.listBridges();
    const bridgeStatuses = await Promise.all(bridges.map(async (b) => ({
      name: b.name,
      port: b.port,
      provider: b.provider,
      enabled: b.enabled !== false,
      running: await checkPortActive(b.port)
    })));
    features.bridges_total = bridges.length;
    features.bridges_enabled = bridges.filter(b => b.enabled !== false).length;
    features.bridges_running = bridgeStatuses.filter(b => b.running).length;
    features.bridges_detail = bridgeStatuses;
  } catch (_) { /* intentional best-effort fallback */ }
}

function _collectSdlcAndClientFeatures(features) {
  try {
    const sdlcManager = require('../../workflow/kage-reviewer/sdlc_manager');
    const tasks = sdlcManager.listTasks({ limit: 500 });
    features.sdlc_total = tasks.length;
    features.sdlc_by_status = tasks.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});
    features.sdlc_verified = tasks.filter(t => t.verified === true || t.verified === 1).length;
    const sdlcConfig = sdlcManager.getProjectSdlcConfig(process.cwd());
    features.sdlc_dor_mode = sdlcConfig.dor_mode;
    features.sdlc_review_mode = sdlcConfig.review_mode;
  } catch (_) { /* intentional best-effort fallback */ }

  const clientDefs = [
    { id: 'antigravity', name: 'Antigravity' }, { id: 'cursor', name: 'Cursor' },
    { id: 'claude', name: 'Claude Code' }, { id: 'opencode', name: 'OpenCode' },
    { id: 'commandcode', name: 'CommandCode' }, { id: 'codex', name: 'Codex' },
    { id: 'pi', name: 'Pi' }, { id: 'omp', name: 'OMP' }
  ];
  features.clients_detail = clientDefs.map(c => ({ name: c.name, configured: isClientConfigured(c.id) }));
  features.clients_configured = features.clients_detail.filter(c => c.configured).length;
  features.clients_total = clientDefs.length;
}

function _collectSavingsFeatures(features) {
  try {
    const report = dbSavings.getSavingsReport();
    features.savings_today_tokens = Number(report.today?.tokens) || 0;
    features.savings_today_calls = Number(report.today?.calls) || 0;
    features.savings_today_pct = Number(report.today?.pct) || 0;
    features.savings_7d_tokens = Number(report.last7days?.tokens) || 0;
    features.savings_7d_calls = Number(report.last7days?.calls) || 0;
    features.savings_7d_pct = Number(report.last7days?.pct) || 0;
    features.savings_alltime_tokens = Number(report.alltime?.tokens) || 0;
    features.savings_alltime_calls = Number(report.alltime?.calls) || 0;
    features.savings_alltime_pct = Number(report.alltime?.pct) || 0;
    features.savings_alltime_usd = Number(report.alltime?.net_saved_usd) || 0;
  } catch (_) { /* intentional best-effort fallback */ }
  const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
  features.search_engine_active = fs.existsSync(path.join(searxngDir, 'best_instance.json'));
}

async function _handleSystemMetrics(req, res, sessionToken, systemMetrics) {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  if (!isLoopback && !isAuthorizedRequest(req, sessionToken)) {
    return sendJson(res, 401, { error: 'Unauthorized: Authentication required to view system metrics' });
  }

  const { systemCpuPct, processCpuPct } = _computeCpuStats(systemMetrics);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const mem = process.memoryUsage();
  const loadAvg = os.platform() === 'win32' ? null : os.loadavg();
  let dbSizeBytes = null;
  try { dbSizeBytes = fs.statSync(db.DB_PATH).size; } catch (_) { /* ignore */ }

  const features = {};
  _collectDbFeatures(features);
  await _collectBridgeFeatures(features);
  _collectSdlcAndClientFeatures(features);
  _collectSavingsFeatures(features);

  return sendJson(res, 200, {
    timestamp: new Date().toISOString(),
    system: {
      cpu: {
        count: os.cpus().length,
        model: (os.cpus()[0]?.model || '').trim(),
        system_pct: systemCpuPct,
        process_pct: processCpuPct,
        load_avg_1m: loadAvg ? Math.round(loadAvg[0] * 100) / 100 : null,
        load_avg_5m: loadAvg ? Math.round(loadAvg[1] * 100) / 100 : null,
        load_avg_15m: loadAvg ? Math.round(loadAvg[2] * 100) / 100 : null
      },
      memory: {
        total_bytes: totalMem,
        free_bytes: freeMem,
        used_bytes: totalMem - freeMem,
        used_pct: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
        process_rss_bytes: mem.rss,
        process_heap_used_bytes: mem.heapUsed,
        process_heap_total_bytes: mem.heapTotal,
        process_external_bytes: mem.external
      },
      disk: { mounts: _collectDiskMounts(), db_size_bytes: dbSizeBytes },
      uptime_seconds: Math.round(process.uptime()),
      os_uptime_seconds: Math.round(os.uptime()),
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      node: process.version
    },
    features
  });
}

function _updateBridge(bridgeName, body) {
  if (typeof body.enabled === 'boolean') {
    dbBridges.setEnabled(bridgeName, body.enabled);
    return null;
  }
  if (body.target_url) {
    const check = validateBridgeTargetUrl(body.target_url);
    if (!check.ok) return check.reason;
  }
  dbBridges.upsertBridge({
    name: bridgeName, port: parseInt(body.port, 10), provider: body.provider,
    enabled: body.enabled !== false, target_url: body.target_url || null, api_key: body.api_key || null
  });
  return null;
}

async function _handleBridges(req, res, pathname, method, broadcastEvent) {
  if (method === 'GET' && pathname === '/api/v1/bridges') {
    try {
      const bridges = dbBridges.listBridges().map(b => {
        const { apiKey, ...safeBridge } = b;
        safeBridge.has_key = Boolean(apiKey);
        return safeBridge;
      });
      return sendJson(res, 200, bridges);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/bridges') {
    try {
      const body = await parseBody(req);
      if (!body.name || !body.port || !body.provider) {
        return sendJson(res, 400, { error: 'Missing required fields: name, port, provider' });
      }
      if (body.target_url) {
        const check = validateBridgeTargetUrl(body.target_url);
        if (!check.ok) return sendJson(res, 400, { error: check.reason });
      }
      dbBridges.upsertBridge({
        name: body.name, port: parseInt(body.port, 10), provider: body.provider,
        enabled: body.enabled !== false, target_url: body.target_url || null, api_key: body.api_key || null
      });
      broadcastEvent('bridges_updated', { action: 'create', name: body.name });
      return sendJson(res, 201, { ok: true, name: body.name });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'PATCH' && pathname.startsWith('/api/v1/bridges/')) {
    const bridgeName = decodeURIComponent(pathname.slice('/api/v1/bridges/'.length));
    try {
      const body = await parseBody(req);
      const errReason = _updateBridge(bridgeName, body);
      if (errReason) return sendJson(res, 400, { error: errReason });
      broadcastEvent('bridges_updated', { action: 'update', name: bridgeName });
      return sendJson(res, 200, { ok: true, name: bridgeName });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/v1/bridges/')) {
    const bridgeName = decodeURIComponent(pathname.slice('/api/v1/bridges/'.length));
    try {
      dbBridges.deleteBridge(bridgeName);
      broadcastEvent('bridges_updated', { action: 'delete', name: bridgeName });
      return sendJson(res, 200, { ok: true, name: bridgeName });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/v1/bridges/status') {
    try {
      const bridges = dbBridges.listBridges();
      const gatewayRunning = await checkPortActive(19999);
      const bridgeStatuses = await Promise.all(bridges.map(async (b) => ({
        name: b.name, port: b.port, provider: b.provider, enabled: Boolean(b.enabled),
        target_url: b.target_url, running: await checkPortActive(b.port)
      })));
      return sendJson(res, 200, { router_port: 19999, gateway_running: gatewayRunning, bridges: bridgeStatuses });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return false;
}

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
    if (bridge.api_key || bridge.apiKey) headers['Authorization'] = `Bearer ${bridge.api_key || bridge.apiKey}`;
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

async function _handleBridgesModels(res, pathname) {
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
    return sendJson(res, 200, { models, total: models.length, nine_router: nineRouterStatus });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _stopGatewayProcess() {
  const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 'SIGTERM'); } catch (_) { /* ignore */ }
    }
  }
  await killProcessOnPort(19999);
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch (_) { /* ignore */ }
  }
}

async function _handleGateway(req, res, pathname, sessionToken) {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  if (!isLoopback && !isAuthorizedRequest(req, sessionToken)) {
    return sendJson(res, 401, { error: 'Unauthorized: Authentication required for gateway lifecycle' });
  }

  if (pathname === '/api/v1/bridges/gateway/start') {
    try {
      if (await checkPortActive(19999)) {
        return sendJson(res, 200, { status: 'already_running', port: 19999, gateway_running: true });
      }
      const child = spawnGatewayDaemon();
      await new Promise(r => setTimeout(r, 1200));
      const nowRunning = await checkPortActive(19999);
      return sendJson(res, 200, { status: nowRunning ? 'started' : 'starting', port: 19999, gateway_running: nowRunning, pid: child.pid });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/v1/bridges/gateway/stop') {
    try {
      await _stopGatewayProcess();
      const stillRunning = await checkPortActive(19999);
      if (stillRunning) {
        return sendJson(res, 500, { error: 'Failed to stop bridge proxy gateway: port 19999 remains active', gateway_running: true });
      }
      return sendJson(res, 200, { status: 'stopped', port: 19999, gateway_running: false });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, gateway_running: await checkPortActive(19999) });
    }
  }

  if (pathname === '/api/v1/bridges/gateway/restart') {
    try {
      await _stopGatewayProcess();
      await new Promise(r => setTimeout(r, 400));
      const child = spawnGatewayDaemon();
      await new Promise(r => setTimeout(r, 1200));
      const nowRunning = await checkPortActive(19999);
      return sendJson(res, 200, { status: nowRunning ? 'running' : 'starting', port: 19999, gateway_running: nowRunning, pid: child.pid });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return false;
}

async function _handleEmbedSkill(req, res, pathname, broadcastEvent) {
  const parts = pathname.slice('/api/v1/agents/'.length).split('/skills/');
  if (parts.length !== 2) return false;
  const agentName = decodeURIComponent(parts[0]);
  const skillName = decodeURIComponent(parts[1]);
  try {
    const body = await parseBody(req);
    if (body.embedded) agentManager.embedSkill(agentName, skillName);
    else agentManager.unembedSkill(agentName, skillName);
    broadcastEvent('agents_updated', { agent: agentName, skill: skillName, embedded: body.embedded });
    return sendJson(res, 200, { ok: true, agent: agentName, skill: skillName, embedded: body.embedded });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleCreateAgent(req, res, broadcastEvent) {
  try {
    const body = await parseBody(req);
    if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: 'Subagent "name" is required' });
    const created = agentManager.createSubagent(String(body.name).trim(), {
      manual: true, title: body.title, purpose: body.purpose, description: body.description,
      instructions: body.instructions, icon: body.icon, skills: Array.isArray(body.skills) ? body.skills : [],
      model: body.model || null
    });
    if (body.model) {
      try { agentManager.updateAgentModel(created.name, body.model); } catch (_) { /* ignore */ }
    }
    broadcastEvent('agents_updated', { action: 'create', agent: created.name });
    return sendJson(res, 201, { ok: true, agent: created });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }
}

async function _handleUpdateAgent(req, res, pathname, broadcastEvent) {
  const agentName = decodeURIComponent(pathname.slice('/api/v1/agents/'.length));
  try {
    const body = await parseBody(req);
    const updated = agentManager.updateAgent(agentName, body);
    broadcastEvent('agents_updated', { action: 'update', agent: agentName });
    return sendJson(res, 200, { ok: true, agent: updated });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }
}

async function _handleUpdateAgentModel(req, res, pathname, broadcastEvent) {
  const agentName = decodeURIComponent(pathname.slice('/api/v1/agents/'.length, -'/model'.length));
  try {
    const body = await parseBody(req);
    if (typeof body.model !== 'string' && body.model !== null) {
      return sendJson(res, 400, { error: 'Field "model" must be a string or null' });
    }
    agentManager.updateAgentModel(agentName, body.model);
    broadcastEvent('agents_updated', { agent: agentName, model: body.model });
    return sendJson(res, 200, { ok: true, agent: agentName, model: body.model });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleDeleteAgent(res, pathname, broadcastEvent) {
  const agentName = decodeURIComponent(pathname.slice('/api/v1/agents/'.length));
  try {
    agentManager.deleteAgent(agentName);
    broadcastEvent('agents_updated', { agent: agentName, action: 'delete' });
    return sendJson(res, 200, { ok: true, deleted: agentName });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }
}

async function _handleAgents(req, res, pathname, method, broadcastEvent) {
  if (method === 'GET' && pathname === '/api/v1/agents') {
    try {
      return sendJson(res, 200, agentManager.loadAgents());
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'POST' && pathname === '/api/v1/agents') {
    return await _handleCreateAgent(req, res, broadcastEvent);
  }
  if (method === 'PUT' && pathname.startsWith('/api/v1/agents/')) {
    return await _handleUpdateAgent(req, res, pathname, broadcastEvent);
  }
  if (method === 'PATCH' && pathname.startsWith('/api/v1/agents/') && pathname.endsWith('/model')) {
    return await _handleUpdateAgentModel(req, res, pathname, broadcastEvent);
  }
  if (method === 'PATCH' && pathname.startsWith('/api/v1/agents/')) {
    const embedRes = await _handleEmbedSkill(req, res, pathname, broadcastEvent);
    if (embedRes !== false) return embedRes;
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/agents/')) {
    return _handleDeleteAgent(res, pathname, broadcastEvent);
  }
  return false;
}

async function handleCoreRoutes(req, res, ctx, _parsedUrl, ...rest) {
  const [pathname, method] = rest;
  const { sessionToken, broadcastEvent, systemMetrics } = ctx;

  const csrfOrHealth = _handleCsrfAndHealth(req, res, pathname, method, ctx);
  if (csrfOrHealth !== false) return csrfOrHealth;

  if (method === 'GET' && pathname === '/api/v1/system/metrics') {
    return await _handleSystemMetrics(req, res, sessionToken, systemMetrics);
  }

  if (pathname === '/api/v1/bridges' || pathname.startsWith('/api/v1/bridges/')) {
    if (pathname.startsWith('/api/v1/bridges/gateway/')) {
      return await _handleGateway(req, res, pathname, sessionToken);
    }
    if (pathname === '/api/v1/bridges/models') {
      return await _handleBridgesModels(res, pathname);
    }
    const bridgeRes = await _handleBridges(req, res, pathname, method, broadcastEvent);
    if (bridgeRes !== false) return bridgeRes;
  }

  if (method === 'GET' && (pathname === '/api/v1/models' || pathname === '/api/v1/9router/status' || pathname === '/api/v1/router/status')) {
    return await _handleBridgesModels(res, pathname);
  }

  if (pathname === '/api/v1/agents' || pathname.startsWith('/api/v1/agents/')) {
    return await _handleAgents(req, res, pathname, method, broadcastEvent);
  }

  return false;
}

module.exports = {
  discoverClientModels,
  handleCoreRoutes
};
