'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../db');
const dbBridges = require('../../db_bridges');
const dbSavings = require('../../db_savings');
const agentManager = require('../../agent_manager');
const pkg = require('../../../package.json');
const { SKILLS_DB_DIR } = require('../../../bin/lib/paths');
const { checkPortActive, killProcessOnPort } = require('../../platform_utils');
const tunnelSecurity = require('../../tunnel/security');
const webAuth = require('../../auth');
const {
  sendJson,
  parseBody,
  getClientSessionId,
  isClientConfigured,
  spawnGatewayDaemon,
  validateBridgeTargetUrl,
  isAuthorizedRequest,
  discoverClientModels
} = require('./common');

async function handleCoreRoutes(req, res, ctx, parsedUrl, pathname, method) {
  const { port, host, sessionToken, systemMetrics, broadcastEvent, isRemote } = ctx;

  if (method === 'GET' && (pathname === '/api/v1/csrf' || pathname === '/api/v1/token')) {
    if (isRemote) {
      const auth = tunnelSecurity.verifyRemoteAccess(req);
      if (!auth.authenticated) {
        return sendJson(res, 403, { error: 'Forbidden: Remote access requires valid authentication or PIN' });
      }
    } else {
      const cookieHeader = req.headers.cookie || '';
      const hasCookie = cookieHeader.split(';').some(c => c.trim() === `konoha-web-token=${sessionToken}`);
      const secFetchSite = req.headers['sec-fetch-site'];
      const origin = req.headers.origin || req.headers.referer;
      const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const isSameOrigin = !origin || origin.includes(`127.0.0.1:${port}`) || origin.includes(`localhost:${port}`);
      if (!hasCookie && (!isLoopback || !isSameOrigin || (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none'))) {
        return sendJson(res, 403, { error: 'Forbidden: Missing or invalid session authentication' });
      }
    }
    return sendJson(res, 200, { token: sessionToken });
  }

  if (method === 'GET' && pathname === '/api/v1/health') {
    const sessionId = getClientSessionId(req);
    const isAuthSession = sessionId ? Boolean(webAuth.getSession(sessionId)) : false;
    const headerToken = req.headers['x-konoha-web-token'] || (typeof req.headers['authorization'] === 'string' ? req.headers['authorization'].replace(/^Bearer\s+/i, '') : null);
    const isAuthToken = Boolean(headerToken && headerToken === sessionToken);
    const isAuthenticated = isAuthSession || isAuthToken;

    const baseHealth = {
      status: 'healthy',
      version: pkg.version,
      uptime: process.uptime()
    };

    if (!isAuthenticated) {
      return sendJson(res, 200, baseHealth);
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
      ...baseHealth,
      port,
      host,
      db_path: db.DB_PATH,
      skills_count: skillsCount,
      agents_count: agentsCount,
      node: process.version,
      platform: process.platform
    });
  }

  if (method === 'GET' && pathname === '/api/v1/system/metrics') {
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
    if (!isLoopback && !isAuthorizedRequest(req, sessionToken)) {
      return sendJson(res, 401, { error: 'Unauthorized: Authentication required to view system metrics' });
    }
    const cpuCount = os.cpus().length;
    const cpuModel = (os.cpus()[0] && os.cpus()[0].model || '').trim();
    const loadAvg = os.platform() === 'win32' ? null : os.loadavg();

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

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const mem = process.memoryUsage();

    const diskMounts = [];
    try {
      if (typeof fs.statfsSync === 'function') {
        const diskPaths = [path.parse(os.homedir()).root, path.join(os.homedir(), '.konoha')];
        const seenMounts = new Set();
        for (const mountPath of diskPaths) {
          try {
            const st = fs.statfsSync(mountPath);
            const mountSig = st.type + ':' + st.blocks + ':' + st.bsize;
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
      }
    } catch (_) { /* intentional best-effort fallback */ }
    let dbSizeBytes = null;
    try { dbSizeBytes = fs.statSync(db.DB_PATH).size; } catch (_) { /* intentional best-effort fallback */ }

    const features = {};
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

    try {
      const clientDefs = [
        { id: 'antigravity', name: 'Antigravity' },
        { id: 'cursor', name: 'Cursor' },
        { id: 'claude', name: 'Claude Code' },
        { id: 'opencode', name: 'OpenCode' },
        { id: 'commandcode', name: 'CommandCode' },
        { id: 'codex', name: 'Codex' },
        { id: 'pi', name: 'Pi' },
        { id: 'omp', name: 'OMP' }
      ];
      features.clients_detail = clientDefs.map(c => ({
        name: c.name,
        configured: isClientConfigured(c.id)
      }));
      features.clients_configured = features.clients_detail.filter(c => c.configured).length;
      features.clients_total = clientDefs.length;
    } catch (_) { /* intentional best-effort fallback */ }

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

    try {
      const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
      const bestPath = path.join(searxngDir, 'best_instance.json');
      features.search_engine_active = fs.existsSync(bestPath);
    } catch (_) { /* intentional best-effort fallback */ }

    return sendJson(res, 200, {
      timestamp: new Date().toISOString(),
      system: {
        cpu: {
          count: cpuCount,
          model: cpuModel,
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
        disk: {
          mounts: diskMounts,
          db_size_bytes: dbSizeBytes
        },
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

  if (method === 'GET' && pathname === '/api/v1/bridges') {
    try {
      const bridges = dbBridges.listBridges().map(b => {
        const { apiKey, ...safeBridge } = b;
        safeBridge.has_key = !!apiKey;
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
        name: body.name,
        port: parseInt(body.port, 10),
        provider: body.provider,
        enabled: body.enabled !== false,
        target_url: body.target_url || null,
        api_key: body.api_key || null
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
      if (typeof body.enabled === 'boolean') {
        dbBridges.setEnabled(bridgeName, body.enabled);
      } else {
        if (body.target_url) {
          const check = validateBridgeTargetUrl(body.target_url);
          if (!check.ok) return sendJson(res, 400, { error: check.reason });
        }
        dbBridges.upsertBridge({
          name: bridgeName,
          port: parseInt(body.port, 10),
          provider: body.provider,
          enabled: body.enabled !== false,
          target_url: body.target_url || null,
          api_key: body.api_key || null
        });
      }
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
      const bridgeStatuses = await Promise.all(bridges.map(async (b) => {
        const isRunning = await checkPortActive(b.port);
        return {
          name: b.name,
          port: b.port,
          provider: b.provider,
          enabled: !!b.enabled,
          target_url: b.target_url,
          running: isRunning
        };
      }));
      return sendJson(res, 200, {
        router_port: 19999,
        gateway_running: gatewayRunning,
        bridges: bridgeStatuses
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && (pathname === '/api/v1/bridges/models' || pathname === '/api/v1/models')) {
    try {
      const bridges = dbBridges.listBridges();
      const enabledBridges = bridges.filter(b => b.enabled && (b.target_url || b.targetUrl));
      const modelPromises = enabledBridges.map(async (bridge) => {
        let targetPath = bridge.target_url || bridge.targetUrl || `http://127.0.0.1:${bridge.port}`;
        if (targetPath.endsWith('/chat/completions')) {
          targetPath = targetPath.replace('/chat/completions', '/models');
        }
        if (!targetPath.endsWith('/models')) {
          if (targetPath.endsWith('/')) targetPath = targetPath.slice(0, -1);
          if (targetPath.endsWith('/v1')) targetPath = targetPath + '/models';
          else targetPath = targetPath + '/v1/models';
        }
        const check = validateBridgeTargetUrl(targetPath);
        if (!check.ok) return { bridge: bridge.name, data: [] };
        try {
          const parsed = check.parsed;
          const mod = parsed.protocol === 'https:' ? require('https') : require('http');
          const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
          const headers = {};
          if (bridge.api_key || bridge.apiKey) {
            headers['Authorization'] = `Bearer ${bridge.api_key || bridge.apiKey}`;
          }
          return new Promise((resolve) => {
            const reqMod = mod.get(url, { headers }, (r) => {
              let d = '';
              r.on('data', c => d += c);
              r.on('end', () => {
                try {
                  const parsedData = JSON.parse(d);
                  resolve({ bridge: bridge.name, data: parsedData && Array.isArray(parsedData.data) ? parsedData.data : [] });
                } catch {
                  resolve({ bridge: bridge.name, data: [] });
                }
              });
            });
            reqMod.on('error', () => resolve({ bridge: bridge.name, data: [] }));
            reqMod.setTimeout(5000, () => { reqMod.destroy(); resolve({ bridge: bridge.name, data: [] }); });
          });
        } catch {
          return { bridge: bridge.name, data: [] };
        }
      });
      const results = await Promise.all(modelPromises);
      const models = [];
      for (const resItem of results) {
        for (const m of resItem.data) {
          models.push({
            id: `${resItem.bridge}-${m.id}`,
            model_name: m.id,
            bridge: resItem.bridge,
            owned_by: m.owned_by || resItem.bridge,
            source: 'bridge'
          });
        }
      }
      const clientModels = discoverClientModels();
      for (const cm of clientModels) {
        models.push(cm);
      }
      const nineRouter = require('../../nine_router');
      const nineRouterModels = await nineRouter.discover9RouterModels();
      for (const nm of nineRouterModels) {
        models.push(nm);
      }
      const nineRouterStatus = await nineRouter.get9RouterStatus();
      return sendJson(res, 200, { models, total: models.length, nine_router: nineRouterStatus });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && (pathname === '/api/v1/9router/status' || pathname === '/api/v1/router/status')) {
    try {
      const nineRouter = require('../../nine_router');
      const status = await nineRouter.get9RouterStatus();
      return sendJson(res, 200, status);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/bridges/gateway/start') {
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
    if (!isLoopback && !isAuthorizedRequest(req, sessionToken)) {
      return sendJson(res, 401, { error: 'Unauthorized: Authentication required for gateway lifecycle' });
    }
    try {
      const alreadyRunning = await checkPortActive(19999);
      if (alreadyRunning) {
        return sendJson(res, 200, { status: 'already_running', port: 19999, gateway_running: true });
      }
      const child = spawnGatewayDaemon();
      await new Promise((r) => setTimeout(r, 1200));
      const nowRunning = await checkPortActive(19999);
      return sendJson(res, 200, { status: nowRunning ? 'started' : 'starting', port: 19999, gateway_running: nowRunning, pid: child.pid });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/bridges/gateway/stop') {
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
    if (!isLoopback && !isAuthorizedRequest(req, sessionToken)) {
      return sendJson(res, 401, { error: 'Unauthorized: Authentication required for gateway lifecycle' });
    }
    try {
      const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch (_) { /* intentional best-effort fallback */ }
        }
      }
      await killProcessOnPort(19999);
      if (fs.existsSync(pidFile)) {
        try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback */ }
      }
      const stillRunning = await checkPortActive(19999);
      if (stillRunning) {
        return sendJson(res, 500, { error: 'Failed to stop bridge proxy gateway: port 19999 remains active', gateway_running: true });
      }
      return sendJson(res, 200, { status: 'stopped', port: 19999, gateway_running: false });
    } catch (err) {
      return sendJson(res, 500, { error: err.message, gateway_running: await checkPortActive(19999) });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/bridges/gateway/restart') {
    try {
      const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          try { process.kill(pid, 'SIGTERM'); } catch (_) { /* intentional best-effort fallback */ }
        }
      }
      await killProcessOnPort(19999);
      if (fs.existsSync(pidFile)) {
        try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback */ }
      }
      await new Promise((r) => setTimeout(r, 400));

      const child = spawnGatewayDaemon();
      await new Promise((r) => setTimeout(r, 1200));
      const nowRunning = await checkPortActive(19999);
      return sendJson(res, 200, { status: nowRunning ? 'running' : 'starting', port: 19999, gateway_running: nowRunning, pid: child.pid });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/v1/agents') {
    try {
      const agents = agentManager.loadAgents();
      return sendJson(res, 200, agents);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/agents') {
    try {
      const body = await parseBody(req);
      if (!body.name || !String(body.name).trim()) {
        return sendJson(res, 400, { error: 'Subagent "name" is required' });
      }
      const created = agentManager.createSubagent(String(body.name).trim(), {
        manual: true,
        title: body.title,
        purpose: body.purpose,
        description: body.description,
        instructions: body.instructions,
        icon: body.icon,
        skills: Array.isArray(body.skills) ? body.skills : [],
        model: body.model || null
      });
      if (body.model) {
        try {
          agentManager.updateAgentModel(created.name, body.model);
        } catch (_) { /* intentional fallback */ }
      }
      broadcastEvent('agents_updated', { action: 'create', agent: created.name });
      return sendJson(res, 201, { ok: true, agent: created });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (method === 'PUT' && pathname.startsWith('/api/v1/agents/')) {
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

  if (method === 'PATCH' && pathname.startsWith('/api/v1/agents/') && pathname.endsWith('/model')) {
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

  if (method === 'PATCH' && pathname.startsWith('/api/v1/agents/')) {
    const parts = pathname.slice('/api/v1/agents/'.length).split('/skills/');
    if (parts.length === 2) {
      const agentName = decodeURIComponent(parts[0]);
      const skillName = decodeURIComponent(parts[1]);
      try {
        const body = await parseBody(req);
        if (body.embedded) {
          agentManager.embedSkill(agentName, skillName);
        } else {
          agentManager.unembedSkill(agentName, skillName);
        }
        broadcastEvent('agents_updated', { agent: agentName, skill: skillName, embedded: body.embedded });
        return sendJson(res, 200, { ok: true, agent: agentName, skill: skillName, embedded: body.embedded });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/v1/agents/')) {
    const agentName = decodeURIComponent(pathname.slice('/api/v1/agents/'.length));
    try {
      agentManager.deleteAgent(agentName);
      broadcastEvent('agents_updated', { agent: agentName, action: 'delete' });
      return sendJson(res, 200, { ok: true, deleted: agentName });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  return false;
}

module.exports = {
  discoverClientModels,
  handleCoreRoutes
};
