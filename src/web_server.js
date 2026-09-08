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
const { SKILLS_DB_DIR } = require('../bin/lib/paths');

const BUILD_CLIENT_DIR = path.resolve(__dirname, '..', 'apps', 'web', 'build', 'client');
const DIST_DIR = fs.existsSync(BUILD_CLIENT_DIR) ? BUILD_CLIENT_DIR : path.resolve(__dirname, '..', 'apps', 'web', 'dist');

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
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Konoha-Web-Token, Authorization'
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
    } catch (_) {}
  }
  if (!sessionToken) {
    sessionToken = crypto.randomBytes(16).toString('hex');
    try {
      if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
      fs.writeFileSync(tokenFile, sessionToken, { encoding: 'utf8', mode: 0o600 });
    } catch (_) {}
  }
  const sseClients = new Set();

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
    const svelteKitHandlerPath = path.resolve(__dirname, '..', 'apps', 'web', 'build', 'handler.js');
    if (fs.existsSync(svelteKitHandlerPath) && process.env.KONOHA_UI_ROUTER !== 'legacy') {
      try {
        const { pathToFileURL } = require('url');
        const mod = await import(pathToFileURL(svelteKitHandlerPath).href);
        svelteKitHandler = mod.handler;
      } catch (_) {}
    }
    return svelteKitHandler;
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://' + host + ':' + port);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
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
      } catch (_) {}
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
        platform: process.platform,
        token: sessionToken
      });
    }

    if (method === 'GET' && pathname === '/api/v1/bridges') {
      try {
        const bridges = dbBridges.listBridges();
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
        } catch (_) {}
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
            } catch (_) {}
            try { fs.unlinkSync(pidFile); } catch (_) {}
          }
        }
        if (!stopped && process.platform !== 'win32') {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -f "KONOHA_DAEMON"', { stdio: 'ignore' });
            stopped = true;
          } catch (_) {}
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
            try { process.kill(pid, 'SIGTERM'); } catch (_) {}
            try { fs.unlinkSync(pidFile); } catch (_) {}
          }
        }
        if (process.platform !== 'win32') {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -f "KONOHA_DAEMON"', { stdio: 'ignore' });
          } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 800));

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
        } catch (_) {}
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

    if (method === 'GET' && pathname === '/api/v1/skills') {
      const q = parsedUrl.searchParams.get('q');
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
      try {
        const conn = db.getConnection(null, false);
        let skills;
        if (q) {
          skills = conn.prepare(
            'SELECT name, skill_name, type, tags, byte_size, line_count FROM skills WHERE name LIKE ? OR skill_name LIKE ? OR tags LIKE ? ORDER BY name ASC LIMIT ?'
          ).all('%' + q + '%', '%' + q + '%', '%' + q + '%', limit);
        } else {
          skills = conn.prepare(
            'SELECT name, skill_name, type, tags, byte_size, line_count FROM skills ORDER BY name ASC LIMIT ?'
          ).all(limit);
        }
        conn.close();
        return sendJson(res, 200, skills);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (method === 'GET' && pathname.startsWith('/api/v1/skills/')) {
      const skillName = decodeURIComponent(pathname.slice('/api/v1/skills/'.length));
      try {
        const conn = db.getConnection(null, false);
        const skill = conn.prepare('SELECT * FROM skills WHERE name = ?').get(skillName);
        conn.close();
        if (!skill) return sendJson(res, 404, { error: 'Skill not found' });
        return sendJson(res, 200, skill);
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
          } catch (_) {}
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
        } catch (_) {}
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

    if (method === 'GET' && pathname === '/api/v1/savings') {
      try {
        const report = dbSavings.getSavingsReport();
        const semble = sembleManager.getSembleSavings();
        const today = {
          ...(report.today || {}),
          pct_saved: report.today?.pct ?? 97,
          tokens_saved_bytes: report.today?.bytes ?? 0,
          tokens_saved_approx: report.today?.tokens ?? 0
        };
        const last_7_days = {
          ...(report.last7days || {}),
          pct_saved: report.last7days?.pct ?? 96,
          tokens_saved_bytes: report.last7days?.bytes ?? 0,
          tokens_saved_approx: report.last7days?.tokens ?? 0
        };
        const all_time = {
          ...(report.alltime || {}),
          pct_saved: report.alltime?.pct ?? 96,
          tokens_saved_bytes: report.alltime?.bytes ?? 0,
          tokens_saved_approx: report.alltime?.tokens ?? 0
        };
        return sendJson(res, 200, {
          ...report,
          today,
          last7days: last_7_days,
          last_7_days,
          alltime: all_time,
          all_time,
          semble
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
          try { bestInstance = JSON.parse(fs.readFileSync(bestPath, 'utf8')); } catch (_) {}
        }
        if (fs.existsSync(instPath)) {
          try {
            const insts = JSON.parse(fs.readFileSync(instPath, 'utf8'));
            instancesCount = Array.isArray(insts) ? insts.length : 0;
          } catch (_) {}
        }
        if (fs.existsSync(logPath)) {
          try { logSize = fs.statSync(logPath).size; } catch (_) {}
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

    res.setHeader('Set-Cookie', `konoha-web-token=${sessionToken}; Path=/; SameSite=Strict`);

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
        let html = fs.readFileSync(filePath, 'utf-8');
        const metaTag = '<meta name="konoha-web-token" content="' + sessionToken + '">';
        if (html.includes('</head>')) {
          html = html.replace('</head>', '  ' + metaTag + '\n</head>');
        } else {
          html = metaTag + html;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(html);
      }
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Konoha Web UI</title><meta name="konoha-web-token" content="' + sessionToken + '"></head><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;"><h1>🍃 Konoha Web UI</h1><p>Server running on port ' + port + '. Frontend initializing...</p></body></html>');
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
    stop: () => new Promise(resolve => server.close(resolve))
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
