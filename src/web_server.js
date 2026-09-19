'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const db = require('./db');
const dbBridges = require('./db_bridges');
const dbSavings = require('./db_savings');
const agentManager = require('./agent_manager');
const doctor = require('./doctor');
const pkg = require('../package.json');
const sembleManager = require('./semble_manager');
const deployUtils = require('./deploy_utils');
const { SKILLS_DB_DIR } = require('../bin/lib/paths');

// Web UI build resolution works across runtimes (repo, installed ~/.konoha
// copy, npm global package) via deployUtils.resolveWebUiDir()
const WEB_UI_DIR = deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', 'apps', 'web');
const BUILD_CLIENT_DIR = path.join(WEB_UI_DIR, 'build', 'client');
const DIST_DIR = fs.existsSync(BUILD_CLIENT_DIR) ? BUILD_CLIENT_DIR : path.join(WEB_UI_DIR, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
    // No CORS headers: the UI is served same-origin, and a wildcard here lets
    // any web page read the CSRF token / bridge API keys from a victim browser.
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function checkPortActive(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// aislop-ignore-next-line complexity/function-too-long (orchestrator web server factory hosting full API route tree and SvelteKit handler)
function createWebServer(options = {}) {
  const port = options.port || 1404;
  const host = options.host || '127.0.0.1';
  let sessionToken = options.token;
  const tokenFile = path.join(SKILLS_DB_DIR, 'web_token');
  if (!sessionToken) {
    try {
      if (fs.existsSync(tokenFile)) {
        const stat = fs.statSync(tokenFile);
        if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
          const cached = fs.readFileSync(tokenFile, 'utf8').trim();
          if (cached && cached.length >= 16) {
            sessionToken = cached;
          }
        }
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  if (!sessionToken) {
    sessionToken = crypto.randomBytes(16).toString('hex');
    try {
      if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
      fs.writeFileSync(tokenFile, sessionToken, { encoding: 'utf8', mode: 0o600 });
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  const sseClients = new Set();
  // Delta-sample state for the /api/v1/system/metrics CPU gauges
  const systemMetrics = { _lastCpuTimes: null, _lastCpuUsage: null, _lastHrtime: process.hrtime.bigint() };

  function broadcastEvent(type, data) {
    const payload = 'event: ' + type + '\n' + 'data: ' + JSON.stringify(data) + '\n\n';
    for (const client of sseClients) {
      try { client.write(payload); } catch (_) { sseClients.delete(client); }
    }
  }

  let svelteKitHandler = null;
  let svelteKitAttempted = false;

  async function getSvelteKitHandler() {
    if (svelteKitAttempted) return svelteKitHandler;
    svelteKitAttempted = true;
    const svelteKitHandlerPath = path.join(WEB_UI_DIR, 'build', 'handler.js');
    if (fs.existsSync(svelteKitHandlerPath) && process.env.KONOHA_UI_ROUTER !== 'legacy') {
      try {
        // Guarantee ESM package boundary for SvelteKit handler to prevent [MODULE_TYPELESS_PACKAGE_JSON] warning
        const buildDir = path.dirname(svelteKitHandlerPath);
        const buildPkgPath = path.join(buildDir, 'package.json');
        if (!fs.existsSync(buildPkgPath)) {
          fs.writeFileSync(buildPkgPath, '{\n  "type": "module"\n}\n');
        }
        const appWebDir = path.dirname(buildDir);
        const appWebPkg = path.join(appWebDir, 'package.json');
        if (!fs.existsSync(appWebPkg)) {
          fs.writeFileSync(appWebPkg, '{\n  "name": "konoha-web",\n  "type": "module",\n  "private": true\n}\n');
        }
        const { pathToFileURL } = require('url');
        const mod = await import(pathToFileURL(svelteKitHandlerPath).href);
        svelteKitHandler = mod.handler;
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
    return svelteKitHandler;
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://' + host + ':' + port);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Konoha-Web-Token, Authorization'
      });
      return res.end();
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname.startsWith('/api/v1/')) {
      const tokenHeader = req.headers['x-konoha-web-token'];
      if (!tokenHeader || tokenHeader !== sessionToken) {
        return sendJson(res, 403, { error: 'Forbidden: Invalid or missing X-Konoha-Web-Token CSRF header' });
      }
    }

    if (method === 'GET' && (pathname === '/api/v1/csrf' || pathname === '/api/v1/token')) {
      return sendJson(res, 200, { token: sessionToken });
    }

    if (method === 'GET' && pathname === '/api/v1/health') {
      let skillsCount = 0;
      let agentsCount = 0;
      try {
        const conn = db.getConnection(null, false);
        skillsCount = conn.prepare('SELECT COUNT(*) as c FROM skills').get().c;
        agentsCount = conn.prepare('SELECT COUNT(*) as c FROM agents').get().c;
        conn.close();
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      return sendJson(res, 200, {
        status: 'healthy',
        version: pkg.version,
        port,
        host,
        db_path: db.DB_PATH,
        skills_count: skillsCount,
        agents_count: agentsCount,
        uptime: process.uptime(),
        node: process.version,
        platform: process.platform
      });
    }

    if (method === 'GET' && pathname === '/api/v1/system/metrics') {
      // Grafana-style metrics: system CPU/memory sampling plus Konoha feature counters.
      const cpuCount = os.cpus().length;
      const cpuModel = (os.cpus()[0] && os.cpus()[0].model || '').trim();
      // os.loadavg() returns fake [0,0,0] on Windows; report null instead so the
      // UI can show an honest em-dash rather than misleading zeros.
      const loadAvg = os.platform() === 'win32' ? null : os.loadavg();

      // System CPU % from os.cpus() times delta between requests
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

      // Process CPU % from process.cpuUsage() delta
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

      // Disk usage via statfs(2): the homedir root filesystem plus the Konoha
      // data directory (deduped when they share one filesystem).
      // path.parse(os.homedir()).root yields 'C:\\' on Windows and '/' on POSIX;
      // statfsSync is feature-detected because it only exists on Node >= 18.15.
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
            } catch (_) { /* unreachable mount (e.g. disconnected network drive): skip it, keep the others */ }
          }
        }
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      let dbSizeBytes = null;
      try { dbSizeBytes = fs.statSync(db.DB_PATH).size; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      // Konoha feature counters (each best-effort; a failing subsystem must not
      // take down the whole metrics endpoint)
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
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      try {
        const sdlcManager = require('./sdlc_manager');
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
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      try {
        const clientDefs = [
          { name: 'Antigravity', rel: ['.gemini', 'config', 'mcp_config.json'] },
          { name: 'Cursor', rel: ['.cursor', 'mcp.json'] },
          { name: 'Claude Code', rel: ['.claude.json'] },
          { name: 'OpenCode', rel: ['.config', 'opencode', 'opencode.json'] },
          { name: 'CommandCode', rel: ['.commandcode', 'mcp.json'] },
          { name: 'Codex', rel: ['.codex', 'config.toml'] },
          { name: 'Pi', rel: ['.pi', 'agent', 'mcp.json'] }
        ];
        features.clients_detail = clientDefs.map(c => ({
          name: c.name,
          configured: fs.existsSync(path.join(os.homedir(), ...c.rel))
        }));
        features.clients_configured = features.clients_detail.filter(c => c.configured).length;
        features.clients_total = clientDefs.length;
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      try {
        const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
        const bestPath = path.join(searxngDir, 'best_instance.json');
        features.search_engine_active = fs.existsSync(bestPath);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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

    if (method === 'GET' && pathname === '/api/v1/bridges/models') {
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
          try {
            const parsed = new URL(targetPath);
            const mod = parsed.protocol === 'https:' ? require('https') : require('http');
            const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
            const headers = {};
            if (bridge.api_key || bridge.apiKey) {
              headers['Authorization'] = `Bearer ${bridge.api_key || bridge.apiKey}`;
            }
            return new Promise((resolve) => {
              const req = mod.get(url, { headers }, (r) => {
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
              req.on('error', () => resolve({ bridge: bridge.name, data: [] }));
              req.setTimeout(5000, () => { req.destroy(); resolve({ bridge: bridge.name, data: [] }); });
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
              owned_by: m.owned_by || resItem.bridge
            });
          }
        }
        return sendJson(res, 200, { models, total: models.length });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/bridges/gateway/start') {
      try {
        const alreadyRunning = await checkPortActive(19999);
        if (alreadyRunning) {
          return sendJson(res, 200, { status: 'already_running', port: 19999, gateway_running: true });
        }
        const { spawn } = require('child_process');
        const mcpScript = fs.existsSync(path.join(SKILLS_DB_DIR, 'file_tools_mcp.js'))
          ? path.join(SKILLS_DB_DIR, 'file_tools_mcp.js')
          : path.join(__dirname, 'file_tools_mcp.js');
        const child = spawn(process.execPath || 'node', [mcpScript], {
          detached: true,
          stdio: 'ignore',
          env: Object.assign({}, process.env, { KONOHA_DAEMON: 'true' })
        });
        child.unref();
        try {
          fs.writeFileSync(path.join(SKILLS_DB_DIR, 'bridge.pid'), String(child.pid));
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        await new Promise((r) => setTimeout(r, 1200));
        const nowRunning = await checkPortActive(19999);
        return sendJson(res, 200, { status: nowRunning ? 'started' : 'starting', port: 19999, gateway_running: nowRunning, pid: child.pid });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/bridges/gateway/stop') {
      try {
        const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
        let stopped = false;
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (Number.isFinite(pid) && pid > 0) {
            try {
              process.kill(pid, 'SIGTERM');
              stopped = true;
            } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
          }
        }
        if (!stopped && process.platform !== 'win32') {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -f "KONOHA_DAEMON"', { stdio: 'ignore' });
            stopped = true;
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
        await new Promise((r) => setTimeout(r, 600));
        const stillRunning = await checkPortActive(19999);
        return sendJson(res, 200, { status: !stillRunning ? 'stopped' : 'stopping', port: 19999, gateway_running: stillRunning });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/bridges/gateway/restart') {
      try {
        const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
          if (Number.isFinite(pid) && pid > 0) {
            try { process.kill(pid, 'SIGTERM'); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
          }
        }
        if (process.platform !== 'win32') {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -f "KONOHA_DAEMON"', { stdio: 'ignore' });
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
        await new Promise((r) => setTimeout(r, 800));

        // aislop-ignore-next-line code-quality/duplicate-block (API endpoint handlers sharing validation/CSRF shape)
        const { spawn } = require('child_process');
        // aislop-ignore-next-line code-quality/duplicate-block (API endpoint handlers sharing validation/CSRF shape)
        const mcpScript = fs.existsSync(path.join(SKILLS_DB_DIR, 'file_tools_mcp.js'))
          ? path.join(SKILLS_DB_DIR, 'file_tools_mcp.js')
          : path.join(__dirname, 'file_tools_mcp.js');
        const child = spawn(process.execPath || 'node', [mcpScript], {
          detached: true,
          stdio: 'ignore',
          env: Object.assign({}, process.env, { KONOHA_DAEMON: 'true' })
        });
        // aislop-ignore-next-line code-quality/duplicate-block (structurally similar handler boilerplate with contextual differences)
        child.unref();
        try {
          fs.writeFileSync(path.join(SKILLS_DB_DIR, 'bridge.pid'), String(child.pid));
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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

    if (method === 'GET' && pathname === '/api/v1/vectors/stats') {
      try {
        const conn = db.getConnection(null, false);
        const totalChunks = conn.prepare('SELECT count(*) as c FROM skill_chunks').get().c;
        const totalEmbedded = conn.prepare('SELECT count(*) as c FROM skill_chunks WHERE embedding IS NOT NULL').get().c;
        const skillsCount = conn.prepare('SELECT count(DISTINCT skill_name) as c FROM skill_chunks').get().c;
        conn.close();
        return sendJson(res, 200, {
          model: 'IBM Granite Multilingual (384-dim)',
          dimension: 384,
          total_chunks: totalChunks,
          embedded_chunks: totalEmbedded,
          vectorized_skills: skillsCount,
          reranker: 'Neural Cross-Encoder (MS MARCO MiniLM) + Reciprocal Rank Fusion (RRF, k=60)'
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/skills') {
      const q = parsedUrl.searchParams.get('q');
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
      const isSemantic = parsedUrl.searchParams.get('semantic') === '1' || parsedUrl.searchParams.get('mode') === 'semantic';
      try {
        const conn = db.getConnection(null, false);
        let skills;
        if (q && isSemantic) {
          try {
            const vectorSearch = require('./vector_search');
            const semanticRes = vectorSearch.findSkillSemantic(conn, q, limit);
            if (semanticRes && semanticRes.length > 0) {
              skills = semanticRes;
            }
          } catch (_) {
            skills = null;
          }
        }
        if (!skills) {
          if (q) {
            skills = conn.prepare(
              'SELECT name, skill_name, type, tags, byte_size, line_count FROM skills WHERE name LIKE ? OR skill_name LIKE ? OR tags LIKE ? ORDER BY name ASC LIMIT ?'
            ).all('%' + q + '%', '%' + q + '%', '%' + q + '%', limit);
          } else {
            skills = conn.prepare(
              'SELECT name, skill_name, type, tags, byte_size, line_count FROM skills ORDER BY name ASC LIMIT ?'
            ).all(limit);
          }
        }
        conn.close();
        return sendJson(res, 200, skills);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/skills/registry') {
      const q = (parsedUrl.searchParams.get('q') || '').trim();
      if (!q) {
        return sendJson(res, 200, { results: [] });
      }
      try {
        const skillManager = require('./skill_manager');
        const results = await skillManager.searchRegistry(q);
        return sendJson(res, 200, { results: Array.isArray(results) ? results : [] });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/skills/')) {
      const skillName = decodeURIComponent(pathname.slice('/api/v1/skills/'.length));
      try {
        const conn = db.getConnection(null, false);
        const skill = conn.prepare('SELECT * FROM skills WHERE name = ?').get(skillName);
        if (!skill) {
          conn.close();
          return sendJson(res, 404, { error: 'Skill not found' });
        }
        try {
          const chunkRows = conn.prepare(
            'SELECT id, chunk_index, chunk_text, embedding FROM skill_chunks WHERE skill_name = ? ORDER BY chunk_index ASC'
          ).all(skillName);
          skill.chunks = chunkRows.map(c => {
            let vectorSample = [];
            if (c.embedding && c.embedding.length >= 20) {
              const f32 = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, Math.min(8, Math.floor(c.embedding.byteLength / 4)));
              vectorSample = Array.from(f32).map(v => Number(v.toFixed(4)));
            }
            return {
              id: c.id,
              chunk_index: c.chunk_index,
              chunk_text: c.chunk_text,
              has_embedding: !!c.embedding,
              embedding_dim: c.embedding ? Math.floor(c.embedding.byteLength / 4) : 0,
              vector_sample: vectorSample
            };
          });
          skill.chunks_count = skill.chunks.length;
        } catch (_) {
          skill.chunks = [];
          skill.chunks_count = 0;
        }
        conn.close();
        return sendJson(res, 200, skill);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/skills/install') {
      try {
        const body = await parseBody(req);
        let repoUrl = (body.repo_url || body.repoUrl || '').trim();
        const skillName = (body.skill_name || body.skillName || body.name || '').trim();
        let nameOrUrl = (body.name_or_url || repoUrl || skillName || '').trim();

        if (!nameOrUrl) {
          return sendJson(res, 400, { error: 'Missing skill name or repository URL.' });
        }

        if (repoUrl && !repoUrl.startsWith('https://') && !repoUrl.startsWith('git@') && !repoUrl.startsWith('http://')) {
          if (repoUrl.includes('/') && !repoUrl.includes(' ')) {
            repoUrl = `https://github.com/${repoUrl}`;
          }
        }

        const skillManager = require('./skill_manager');
        let installedPath = null;
        if (repoUrl && skillName) {
          installedPath = await skillManager.addSkillDirect(repoUrl, skillName);
        } else {
          installedPath = await skillManager.addSkill(nameOrUrl, skillName || undefined);
        }

        broadcastEvent('skills_updated', { action: 'install', name: skillName || nameOrUrl });
        return sendJson(res, 200, { ok: true, skill_name: skillName || nameOrUrl, installed_path: installedPath || null });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/skills') {
      try {
        const body = await parseBody(req);
        const name = (body.name || '').trim().toLowerCase();
        const description = (body.description || '').trim();
        const tags = (body.tags || '').trim();
        const content = (body.content || '').trim();
        const embedAgent = (body.embed_agent || body.embedAgent || '').trim();

        if (!name || !/^[a-z0-9_-]+$/.test(name)) {
          return sendJson(res, 400, { error: 'Invalid skill name. Only lowercase letters, numbers, hyphens, and underscores are allowed.' });
        }
        if (!description) {
          return sendJson(res, 400, { error: 'Skill description is required.' });
        }

        const tagsList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        let fullContent = '---\n';
        fullContent += `name: ${name}\n`;
        fullContent += `description: ${description}\n`;
        if (tagsList.length > 0) {
          fullContent += 'tags:\n';
          tagsList.forEach(t => { fullContent += `  - ${t}\n`; });
        }
        fullContent += '---\n\n';
        fullContent += `# ${name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}\n\n`;
        fullContent += content || `${description}\n`;

        const projectSkillsDir = path.resolve(__dirname, '..', '.agents', 'skills', name);
        const globalSkillsDir = path.join(os.homedir(), '.agents', 'skills', name);
        const targetDir = fs.existsSync(path.resolve(__dirname, '..', '.agents', 'skills'))
          ? projectSkillsDir
          : globalSkillsDir;

        fs.mkdirSync(targetDir, { recursive: true });
        const targetFile = path.join(targetDir, 'SKILL.md');
        fs.writeFileSync(targetFile, fullContent, 'utf8');

        // Re-index skill into SQLite
        const migrate = require('./migrate');
        const conn = db.getConnection(null, false);
        const migrated = migrate.migrateSkill(conn, name, false, path.dirname(targetDir));
        conn.close();

        // Optional embedding in agent
        let embedded = false;
        if (embedAgent) {
          try {
            const skillManager = require('./skill_manager');
            embedded = skillManager.embedSkillInAgent(name, embedAgent);
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }

        broadcastEvent('skills_updated', { action: 'create', name });
        return sendJson(res, 201, {
          ok: true,
          name,
          file_path: targetFile,
          migrated: migrated > 0,
          embedded_in: embedded ? embedAgent : null
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/skills/reindex') {
      try {
        const { spawnSync } = require('child_process');
        const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
        const run = spawnSync(process.execPath || 'node', [cliPath, 'migrate'], { encoding: 'utf8' });
        broadcastEvent('skills_updated', { action: 'reindex' });
        return sendJson(res, 200, { ok: true, output: (run.stdout || '').trim() });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname.startsWith('/api/v1/skills/') && pathname.endsWith('/embed')) {
      try {
        const parts = pathname.split('/');
        const skillName = decodeURIComponent(parts[4]);
        const body = await parseBody(req);
        const agentName = (body.agent || body.agent_name || '').trim();
        if (!agentName) {
          return sendJson(res, 400, { error: 'Agent name is required' });
        }
        const skillManager = require('./skill_manager');
        const embedded = skillManager.embedSkillInAgent(skillName, agentName);
        broadcastEvent('skills_updated', { action: 'embed', skill: skillName, agent: agentName });
        return sendJson(res, 200, { ok: true, skill: skillName, agent: agentName, embedded });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // aislop-ignore-next-line code-quality/duplicate-block (API endpoint handlers sharing validation/CSRF shape)
    if (method === 'POST' && pathname.startsWith('/api/v1/skills/') && pathname.endsWith('/unembed')) {
      try {
        const parts = pathname.split('/');
        const skillName = decodeURIComponent(parts[4]);
        const body = await parseBody(req);
        const agentName = (body.agent || body.agent_name || '').trim();
        if (!agentName) {
          return sendJson(res, 400, { error: 'Agent name is required' });
        }
        const skillManager = require('./skill_manager');
        const unembedded = skillManager.unembedSkillFromAgent(skillName, agentName);
        broadcastEvent('skills_updated', { action: 'unembed', skill: skillName, agent: agentName });
        return sendJson(res, 200, { ok: true, skill: skillName, agent: agentName, unembedded });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/v1/skills/')) {
      try {
        const skillName = decodeURIComponent(pathname.slice('/api/v1/skills/'.length));
        const skillManager = require('./skill_manager');
        try {
          skillManager.removeSkill(skillName);
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        const conn = db.getConnection(null, false);
        conn.prepare("DELETE FROM skill_chunks WHERE skill_name = ?").run(skillName);
        conn.prepare("DELETE FROM skills WHERE name = ? OR skill_name = ?").run(skillName, skillName);
        conn.close();
        broadcastEvent('skills_updated', { action: 'delete', name: skillName });
        return sendJson(res, 200, { ok: true, name: skillName });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/detect-ai') {
      const target = (parsedUrl.searchParams.get('target') || parsedUrl.searchParams.get('path') || parsedUrl.searchParams.get('url') || '').trim();
      if (!target) {
        return sendJson(res, 400, { error: 'Missing required query parameter: target (site directory path or http(s) URL)' });
      }
      try {
        const { detectWebsiteAiAsync } = require('./ai_detector');
        const result = await detectWebsiteAiAsync(target);
        if (result && result.error) {
          return sendJson(res, 400, result);
        }
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/detect-docs') {
      const file_path = (parsedUrl.searchParams.get('file_path') || parsedUrl.searchParams.get('path') || parsedUrl.searchParams.get('target') || '').trim();
      if (!file_path) {
        return sendJson(res, 400, { error: 'Missing required query parameter: file_path (document file path)' });
      }
      try {
        const { detectDocsAi } = require('./docs_ai_detector');
        const result = detectDocsAi(file_path);
        if (result && result.error) {
          return sendJson(res, 400, result);
        }
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/detect-docs/text') {
      try {
        const body = await parseBody(req);
        const text = (body && body.text) ? String(body.text).trim() : '';
        if (!text) {
          return sendJson(res, 400, { error: 'Missing required field: text' });
        }
        const tmpDir = require('os').tmpdir();
        const tmpFile = path.join(tmpDir, `konoha_docs_detect_${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, text, 'utf8');
        try {
          const { detectDocsAi } = require('./docs_ai_detector');
          const detectResult = detectDocsAi(tmpFile);
          if (detectResult && detectResult.error) {
            return sendJson(res, 400, detectResult);
          }
          return sendJson(res, 200, detectResult);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch (_) { /* cleanup */ }
        }
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/savings') {
      try {
        const report = dbSavings.getSavingsReport();
        const semble = sembleManager.getSembleSavings();
        const today = {
          ...report.today,
          pct_saved: typeof report.today?.pct === 'number' ? report.today.pct : 0,
          tokens_saved_bytes: report.today?.bytes ?? 0,
          tokens_saved_approx: report.today?.tokens ?? 0
        };
        const last_7_days = {
          ...report.last7days,
          pct_saved: typeof report.last7days?.pct === 'number' ? report.last7days.pct : 0,
          tokens_saved_bytes: report.last7days?.bytes ?? 0,
          tokens_saved_approx: report.last7days?.tokens ?? 0
        };
        const all_time = {
          ...report.alltime,
          pct_saved: typeof report.alltime?.pct === 'number' ? report.alltime.pct : 0,
          tokens_saved_bytes: report.alltime?.bytes ?? 0,
          tokens_saved_approx: report.alltime?.tokens ?? 0
        };

        const parseTokenCount = (val) => {
          if (typeof val === 'number') return val;
          if (!val || typeof val !== 'string') return 0;
          const clean = val.replace(/^[~ ]+/, '').replace(/\s*tokens?$/i, '').trim();
          const match = clean.match(/^(\d+\.?\d*)([kKmMbB])?$/);
          if (!match) return parseFloat(clean) || 0;
          const num = parseFloat(match[1]);
          const unit = (match[2] || '').toLowerCase();
          if (unit === 'b') return Math.round(num * 1000000000);
          if (unit === 'm') return Math.round(num * 1000000);
          if (unit === 'k') return Math.round(num * 1000);
          return Math.round(num);
        };

        const parseCallsCount = (val) => {
          if (typeof val === 'number') return val;
          if (!val || typeof val !== 'string') return 0;
          const clean = val.trim();
          const match = clean.match(/^(\d+\.?\d*)([kKmM])?$/);
          if (!match) return parseInt(clean, 10) || 0;
          const num = parseFloat(match[1]);
          const unit = (match[2] || '').toLowerCase();
          if (unit === 'm') return Math.round(num * 1000000);
          if (unit === 'k') return Math.round(num * 1000);
          return Math.round(num);
        };

        const parsePct = (val) => (typeof val === 'number' && !isNaN(val)) ? val : (parseInt(val, 10) || 0);

        const sTodayCalls = parseCallsCount(semble.today?.calls);
        const sTodayTokens = parseTokenCount(semble.today?.tokens_saved);
        const sTodayPct = parsePct(semble.today?.ratio_pct ?? semble.today?.pct);

        const sLast7Calls = parseCallsCount(semble.last_7_days?.calls ?? semble['7days']?.calls ?? semble.last7days?.calls);
        const sLast7Tokens = parseTokenCount(semble.last_7_days?.tokens_saved ?? semble['7days']?.tokens_saved ?? semble.last7days?.tokens_saved);
        const sLast7Pct = parsePct(semble.last_7_days?.ratio_pct ?? semble['7days']?.pct ?? semble.last7days?.pct);

        const sAllTimeCalls = parseCallsCount(semble.all_time?.calls ?? semble.all?.calls ?? semble.alltime?.calls);
        const sAllTimeTokens = parseTokenCount(semble.all_time?.tokens_saved ?? semble.all?.tokens_saved ?? semble.alltime?.tokens_saved);
        const sAllTimePct = parsePct(semble.all_time?.ratio_pct ?? semble.all?.pct ?? semble.alltime?.pct);

        const calcCombinedPeriod = (dbStats, sCalls, sTokens, sPct) => {
          const dbCalls = dbStats?.calls || 0;
          const dbTokens = dbStats?.tokens || 0;
          const dbBytes = dbStats?.bytes || 0;
          const dbTotalBytes = dbStats?.total_bytes || 0;

          const sSavedBytes = sTokens * 4;
          const sTotalBytes = (sPct > 0 && sTokens > 0)
            ? Math.round(sSavedBytes / (sPct / 100))
            : (dbTotalBytes > 0 ? dbTotalBytes : 0);

          const combCalls = dbCalls + sCalls;
          const combTokens = dbTokens + sTokens;
          const combBytes = dbBytes + sSavedBytes;
          const combTotalBytes = dbTotalBytes + (sPct > 0 ? sTotalBytes : 0);
          const combPct = combTotalBytes > 0 ? Math.round((combBytes / combTotalBytes) * 100) : (dbStats?.pct || 0);

          return {
            calls: combCalls,
            tokens: combTokens,
            bytes: combBytes,
            pct: combPct
          };
        };

        const combinedToday = calcCombinedPeriod(today, sTodayCalls, sTodayTokens, sTodayPct);
        const combinedLast7Days = calcCombinedPeriod(last_7_days, sLast7Calls, sLast7Tokens, sLast7Pct);
        const combinedAllTime = calcCombinedPeriod(all_time, sAllTimeCalls, sAllTimeTokens, sAllTimePct);
        const avgPct = combinedToday.pct > 0
          ? combinedToday.pct
          : (combinedLast7Days.pct > 0 ? combinedLast7Days.pct : combinedAllTime.pct);

        const combined = {
          today: combinedToday,
          last_7_days: combinedLast7Days,
          last7days: combinedLast7Days,
          all_time: combinedAllTime,
          alltime: combinedAllTime,
          avg_pct: avgPct
        };

        return sendJson(res, 200, {
          ...report,
          today,
          last7days: last_7_days,
          last_7_days,
          alltime: all_time,
          all_time,
          semble,
          combined
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/semble') {
      try {
        const status = sembleManager.getSembleStatus();
        return sendJson(res, 200, status);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/semble/savings') {
      try {
        const savings = sembleManager.getSembleSavings();
        return sendJson(res, 200, savings);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/semble/search') {
      try {
        const body = await parseBody(req);
        const results = sembleManager.searchSemble(body.query, body.path, body.limit);
        return sendJson(res, 200, results);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/search/status') {
      try {
        const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
        const bestPath = path.join(searxngDir, 'best_instance.json');
        const instPath = path.join(searxngDir, 'instances_cache.json');
        const logPath = path.join(searxngDir, 'search.log');
        let bestInstance = null;
        let instancesCount = 0;
        let logSize = 0;
        if (fs.existsSync(bestPath)) {
          try { bestInstance = JSON.parse(fs.readFileSync(bestPath, 'utf8')); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
        if (fs.existsSync(instPath)) {
          try {
            const insts = JSON.parse(fs.readFileSync(instPath, 'utf8'));
            instancesCount = Array.isArray(insts) ? insts.length : 0;
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
        if (fs.existsSync(logPath)) {
          try { logSize = fs.statSync(logPath).size; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
        const customUrl = process.env.SEARXNG_URL || process.env.KONOHA_SEARXNG_URL || null;
        return sendJson(res, 200, {
          provider: 'SearXNG Multi-Source Chain',
          custom_url: customUrl,
          best_instance: bestInstance ? bestInstance.url : null,
          best_instance_resolved_at: bestInstance ? bestInstance.resolved_at : null,
          cached_candidates_count: instancesCount,
          search_log_size_bytes: logSize,
          fallbacks: ['DuckDuckGo HTML', 'Startpage HTML', 'Wikipedia OpenSearch'],
          zero_api_key: true
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/search/logs') {
      try {
        const logPath = path.join(os.homedir(), '.konoha', 'searxng', 'search.log');
        let logs = [];
        if (fs.existsSync(logPath)) {
          const content = fs.readFileSync(logPath, 'utf8');
          logs = content.split('\n').filter(Boolean).slice(-100).reverse();
        }
        return sendJson(res, 200, { logs, count: logs.length });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/search') {
      try {
        const body = await parseBody(req);
        if (!body.query || !body.query.trim()) {
          return sendJson(res, 400, { error: 'Search query is required.' });
        }
        const numResults = Math.min(Math.max(parseInt(body.num_results || body.numResults || 5, 10), 1), 50);
        const searchDepth = ['standard', 'deep'].includes(body.search_depth || body.searchDepth) ? (body.search_depth || body.searchDepth) : 'standard';
        const webSearch = require('./mcp/web_search');
        const rawRes = await webSearch.runWebSearch(body.query.trim(), numResults, searchDepth, 'web_ui');
        let parsed = null;
        try { parsed = JSON.parse(rawRes); } catch (_) { parsed = { status: 'success', results: [] }; }
        return sendJson(res, 200, parsed);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/search/clear-cache') {
      try {
        const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
        const bestPath = path.join(searxngDir, 'best_instance.json');
        const instPath = path.join(searxngDir, 'instances_cache.json');
        let cleared = 0;
        if (fs.existsSync(bestPath)) { fs.unlinkSync(bestPath); cleared++; }
        if (fs.existsSync(instPath)) { fs.unlinkSync(instPath); cleared++; }
        return sendJson(res, 200, { ok: true, cleared });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/doctor') {
      try {
        const report = doctor.getDiagnostics();
        return sendJson(res, 200, report);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/doctor/repair') {
      try {
        const body = await parseBody(req);
        const report = doctor.runRepairs(body.check || 'all');
        broadcastEvent('doctor_repaired', report);
        return sendJson(res, 200, report);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // ── SDLC Governance (Tasks, DoR, config) — web parity for `konoha task/project` TUI commands ──

    if (method === 'GET' && pathname === '/api/v1/sdlc/tasks') {
      try {
        const sdlcManager = require('./sdlc_manager');
        const status = parsedUrl.searchParams.get('status') || null;
        const project = parsedUrl.searchParams.get('project') || null;
        const limitParam = parseInt(parsedUrl.searchParams.get('limit'), 10);
        const tasks = sdlcManager.listTasks({
          projectPath: project,
          status,
          limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50
        });
        return sendJson(res, 200, { tasks, count: tasks.length });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/sdlc/tasks/')) {
      try {
        const sdlcManager = require('./sdlc_manager');
        const taskId = decodeURIComponent(pathname.slice('/api/v1/sdlc/tasks/'.length));
        if (!taskId) {
          return sendJson(res, 400, { error: 'SDLC task id is required.' });
        }
        const task = sdlcManager.getTask(taskId);
        if (!task) {
          return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
        }
        return sendJson(res, 200, { task });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && (pathname === '/api/v1/sdlc/tasks' || pathname === '/api/v1/sdlc/tasks/')) {
      try {
        const sdlcManager = require('./sdlc_manager');
        const all = parsedUrl.searchParams.get('all') === 'true';
        const status = parsedUrl.searchParams.get('status') || null;
        const project = parsedUrl.searchParams.get('project') || null;
        const session = parsedUrl.searchParams.get('session') || null;
        const result = sdlcManager.deleteTasks({
          projectPath: project,
          sessionId: session,
          status,
          all
        });
        broadcastEvent('sdlc_tasks_updated', { action: 'delete_many', ...result });
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/v1/sdlc/tasks/')) {
      try {
        const sdlcManager = require('./sdlc_manager');
        const taskId = decodeURIComponent(pathname.slice('/api/v1/sdlc/tasks/'.length));
        if (!taskId) {
          return sendJson(res, 400, { error: 'SDLC task id is required.' });
        }
        const deleted = sdlcManager.deleteTask(taskId);
        if (!deleted) {
          return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
        }
        broadcastEvent('sdlc_tasks_updated', { action: 'delete', id: taskId });
        return sendJson(res, 200, { ok: true, id: taskId });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/sdlc/check-readiness') {
      try {
        const sdlcManager = require('./sdlc_manager');
        const body = await parseBody(req);
        const taskText = (body.task || body.description || '').trim();
        if (!taskText) {
          return sendJson(res, 400, { error: 'Task text is required for a readiness check.' });
        }
        const projectPath = body.project_path || body.projectPath || process.cwd();
        const dor = sdlcManager.checkReadiness(taskText, projectPath);
        return sendJson(res, 200, { ...dor, project_path: projectPath });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/sdlc/config') {
      try {
        const sdlcManager = require('./sdlc_manager');
        const projectPath = parsedUrl.searchParams.get('project') || process.cwd();
        const config = sdlcManager.getProjectSdlcConfig(projectPath);
        return sendJson(res, 200, { project_path: projectPath, ...config });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'PATCH' && pathname === '/api/v1/sdlc/config') {
      try {
        const sdlcManager = require('./sdlc_manager');
        const body = await parseBody(req);
        const projectPath = body.project_path || body.projectPath || process.cwd();
        const config = sdlcManager.setProjectSdlcConfig(projectPath, {
          dor_mode: body.dor_mode !== undefined ? body.dor_mode : null,
          review_mode: body.review_mode !== undefined ? body.review_mode : null
        });
        broadcastEvent('sdlc_config_updated', { project_path: projectPath, ...config });
        return sendJson(res, 200, { project_path: projectPath, ...config });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/clients') {
      const clientsList = [
        {
          id: 'antigravity',
          name: 'Antigravity IDE / CLI',
          configPath: '~/.gemini/config/mcp_config.json',
          configured: fs.existsSync(path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'))
        },
        {
          id: 'cursor',
          name: 'Cursor IDE / CLI',
          configPath: '~/.cursor/mcp.json',
          configured: fs.existsSync(path.join(os.homedir(), '.cursor', 'mcp.json'))
        },
        {
          id: 'claude',
          name: 'Claude Code CLI',
          configPath: '~/.claude.json',
          configured: fs.existsSync(path.join(os.homedir(), '.claude.json'))
        },
        {
          id: 'opencode',
          name: 'OpenCode IDE',
          configPath: '~/.config/opencode/opencode.json',
          configured: fs.existsSync(path.join(os.homedir(), '.config', 'opencode', 'opencode.json')) || fs.existsSync(path.join(os.homedir(), '.opencode', 'config.json'))
        },
        {
          id: 'commandcode',
          name: 'Command Code CLI',
          configPath: '~/.commandcode/mcp.json',
          configured: fs.existsSync(path.join(os.homedir(), '.commandcode', 'mcp.json'))
        },
        {
          id: 'codex',
          name: 'Codex IDE / CLI',
          configPath: '~/.codex/config.toml',
          configured: fs.existsSync(path.join(os.homedir(), '.codex', 'config.toml'))
        },
        {
          id: 'pi',
          name: 'Pi (pi.dev)',
          configPath: '~/.pi/agent/mcp.json',
          configured: (function () {
            try {
              const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi', 'agent', 'mcp.json'), 'utf-8'));
              return !!(cfg && cfg.mcpServers && cfg.mcpServers['konoha']);
            } catch (_) {
              return false;
            }
          })()
        }
      ];
      return sendJson(res, 200, clientsList);
    }

    if (method === 'POST' && pathname.startsWith('/api/v1/clients/') && pathname.endsWith('/setup')) {
      const clientName = pathname.split('/')[4];
      try {
        if (clientName === 'cursor') require('./cursor_manager').ensureCursorSetup(true);
        if (clientName === 'claude') require('./mcp_clients_manager').ensureClaudeCodeSetup(true);
        if (clientName === 'commandcode') require('./mcp_clients_manager').ensureCommandCodeSetup(true);
        if (clientName === 'opencode') require('./opencode_manager').ensureOpenCodeSetup(true);
        if (clientName === 'codex') require('./codex_manager').ensureCodexSetup(true);
        if (clientName === 'pi') require('./pi_manager').ensurePiSetup({ silent: true });
        broadcastEvent('clients_updated', { client: clientName, action: 'setup' });
        return sendJson(res, 200, { ok: true, client: clientName });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname.startsWith('/api/v1/clients/') && pathname.endsWith('/remove')) {
      const clientName = pathname.split('/')[4];
      try {
        if (clientName === 'cursor') require('./cursor_manager').removeCursorConfig(true);
        if (clientName === 'claude') require('./mcp_clients_manager').removeClaudeCodeConfig(true);
        if (clientName === 'opencode') require('./opencode_manager').removeOpenCodeConfig(true);
        if (clientName === 'codex') require('./codex_manager').removeCodexConfig(true);
        if (clientName === 'pi') require('./pi_manager').removePiMcp(true);
        broadcastEvent('clients_updated', { client: clientName, action: 'remove' });
        return sendJson(res, 200, { ok: true, client: clientName });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Persona Memory Endpoints
    if (method === 'GET' && pathname === '/api/v1/persona') {
      try {
        const personaMemory = require('./persona_memory');
        const agentFilter = parsedUrl.searchParams.get('agent') || null;
        const memoryType = parsedUrl.searchParams.get('type') || null;
        const search = parsedUrl.searchParams.get('search') || null;
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        let memories = [];
        if (search) {
          memories = personaMemory.queryMemories({
            agentName: agentFilter || 'global',
            query: search,
            memoryType: memoryType || undefined,
            limit
          });
        } else {
          memories = personaMemory.listMemories({
            agentName: agentFilter,
            memoryType: memoryType || undefined,
            limit
          });
        }
        return sendJson(res, 200, { memories: memories || [], total: (memories || []).length });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/persona') {
      try {
        const body = await parseBody(req);
        if (!body.agentName || !body.content) {
          return sendJson(res, 400, { error: 'Missing required fields: agentName, content' });
        }
        const personaMemory = require('./persona_memory');
        const id = personaMemory.saveMemory({
          agentName: body.agentName,
          content: body.content,
          title: body.title || '',
          memoryType: body.memoryType || 'rule',
          tags: body.tags || '',
          importance: parseInt(body.importance || 1, 10),
          projectPath: body.projectPath || null
        });
        broadcastEvent('persona_updated', { action: 'create', id, agent: body.agentName });
        return sendJson(res, 201, { id, ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/v1/persona/')) {
      try {
        const memId = pathname.split('/')[4];
        const personaMemory = require('./persona_memory');
        personaMemory.deleteMemory(memId);
        broadcastEvent('persona_updated', { action: 'delete', id: memId });
        return sendJson(res, 200, { ok: true, id: memId });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/persona/prune') {
      try {
        const body = await parseBody(req).catch(() => ({}));
        const personaMemory = require('./persona_memory');
        const resPrune = personaMemory.pruneMemories(body);
        broadcastEvent('persona_updated', { action: 'prune', ...resPrune });
        return sendJson(res, 200, { ok: true, ...resPrune });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Project Context Endpoints
    if (method === 'GET' && pathname === '/api/v1/projects') {
      try {
        const personaMemory = require('./persona_memory');
        const projects = personaMemory.listProjects(50);
        return sendJson(res, 200, { projects: projects || [] });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/projects/current') {
      try {
        const personaMemory = require('./persona_memory');
        const targetPath = parsedUrl.searchParams.get('path') || process.cwd();
        let profile = personaMemory.getProjectProfile(targetPath);
        if (!profile) {
          const pHash = personaMemory.saveOrUpdateProject(targetPath, '', null);
          profile = personaMemory.getProjectProfile(pHash);
        }
        const mems = personaMemory.listMemories({ projectPath: targetPath, limit: 20 });
        return sendJson(res, 200, { profile: profile || {}, memories: mems || [] });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && pathname === '/api/v1/projects') {
      try {
        const body = await parseBody(req);
        const pPath = body.projectPath || process.cwd();
        const personaMemory = require('./persona_memory');
        const hash = personaMemory.saveOrUpdateProject(pPath, body.contextSummary || '', body.techStack || null);
        broadcastEvent('projects_updated', { action: 'update', hash, path: pPath });
        return sendJson(res, 200, { ok: true, project_hash: hash, project_path: pPath });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/v1/projects/') && pathname.includes('/memories/')) {
      try {
        const parts = pathname.split('/');
        const hash = parts[4];
        const memId = parts[6];
        const personaMemory = require('./persona_memory');
        const deleted = personaMemory.deleteMemory(memId);
        broadcastEvent('projects_updated', { action: 'memory_delete', hash, memId });
        broadcastEvent('persona_updated', { action: 'delete', id: memId });
        return sendJson(res, 200, { ok: true, deleted, id: memId, project_hash: hash });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'POST' && ((pathname.startsWith('/api/v1/projects/') && pathname.endsWith('/prune')) || pathname === '/api/v1/projects/prune')) {
      try {
        const body = await parseBody(req).catch(() => ({}));
        const parts = pathname.split('/');
        const hashFromUrl = (pathname !== '/api/v1/projects/prune') ? parts[4] : null;
        const projectHash = hashFromUrl || body.projectHash || body.projectPath || process.cwd();
        const personaMemory = require('./persona_memory');
        const result = personaMemory.pruneProjectMemories(projectHash, body);
        broadcastEvent('projects_updated', { action: 'prune', ...result });
        broadcastEvent('persona_updated', { action: 'prune', ...result });
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && (pathname === '/api/v1/projects' || pathname === '/api/v1/projects/')) {
      try {
        const personaMemory = require('./persona_memory');
        const keepCurrent = parsedUrl.searchParams.get('keepCurrent') === 'true';
        const currentHash = parsedUrl.searchParams.get('currentHash') || '';
        const result = personaMemory.pruneAllProjects({ keepCurrent, currentHash });
        broadcastEvent('projects_updated', { action: 'prune_all', ...result });
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/v1/projects/')) {
      try {
        const hash = pathname.split('/')[4];
        const personaMemory = require('./persona_memory');
        personaMemory.deleteProject(hash);
        broadcastEvent('projects_updated', { action: 'delete', hash });
        return sendJson(res, 200, { ok: true, hash });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/v1/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('event: connected\ndata: ' + JSON.stringify({ ok: true, time: Date.now() }) + '\n\n');
      sseClients.add(res);
      req.on('close', () => { sseClients.delete(res); });
      return;
    }

    res.setHeader('Set-Cookie', `konoha-web-token=${sessionToken}; Path=/; SameSite=Strict; HttpOnly`);

    const skHandler = await getSvelteKitHandler();
    if (skHandler && !pathname.startsWith('/api/')) {
      if (!req.headers.cookie || !req.headers.cookie.includes('konoha-web-token=')) {
        req.headers.cookie = (req.headers.cookie ? req.headers.cookie + '; ' : '') + 'konoha-web-token=' + sessionToken;
      }
      return skHandler(req, res, () => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });
    }

    let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      if (ext === '.html') {
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(fs.readFileSync(filePath, 'utf-8'));
      }
      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        // Read can still fail after the existsSync check (permissions, races);
        // without this handler the uncaught 'error' would kill the server
        try { res.end(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      });
      return stream.pipe(res);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Konoha Web UI</title></head><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;"><h1>🍃 Konoha Web UI</h1><p>Server running on port ' + port + '. Frontend initializing...</p></body></html>');
  });

  return {
    server,
    port,
    host,
    sessionToken,
    broadcastEvent,
    start: () => new Promise((resolve, reject) => {
      server.listen(port, host, () => resolve({ port, host, token: sessionToken }));
      server.on('error', reject);
    }),
    // Robust shutdown: server.close() alone never resolves while keep-alive
    // or SSE (/api/v1/events) connections stay open, which historically left
    // SIGTERMed daemons alive-but-deaf (zombie "ui daemon" processes). Close
    // idle connections immediately and force-terminate the rest after a short
    // grace period so stop() always settles. Cross-platform: both helpers are
    // plain Node APIs (>= 18.2) and feature-detected.
    stop: () => new Promise(resolve => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      server.close(done);
      try { if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections(); } catch (_) { /* best-effort */ }
      const force = setTimeout(() => {
        try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch (_) { /* best-effort */ }
        done();
      }, 1500);
      if (typeof force.unref === 'function') force.unref();
    })
  };
}

async function startWebServer(options = {}) {
  const instance = createWebServer(options);
  const info = await instance.start();
  return { ...info, instance };
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '1404', 10);
  startWebServer({ port }).then(info => {
    console.log('🍃 Konoha Web UI server listening at http://' + info.host + ':' + info.port + '/');
  }).catch(err => {
    console.error('Failed to start web server:', err.message);
    process.exit(1);
  });
}

module.exports = {
  createWebServer,
  startWebServer
};
