'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { SKILLS_DB_DIR } = require('../../../bin/lib/paths');

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB body size cap

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req, res = null) {
  const targetRes = res || req._res || null;
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytesCount = 0;
    let destroyed = false;
    req.on('data', chunk => {
      if (destroyed) return;
      bytesCount += chunk.length;
      if (bytesCount > MAX_BODY_BYTES) {
        destroyed = true;
        if (targetRes && !targetRes.headersSent) {
          sendJson(targetRes, 413, { error: 'Request body exceeds 1 MiB limit' });
        }
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (destroyed || bytesCount > MAX_BODY_BYTES) return;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', err => {
      if (!destroyed) reject(err);
    });
  });
}

async function isDeleteConfirmed(req, parsedUrl) {
  if (parsedUrl.searchParams.get('confirm') === 'true') return true;
  try {
    const body = await parseBody(req);
    return Boolean(body && body.confirm === true);
  } catch (_) {
    return false;
  }
}

function isClientConfigured(id) {
  try {
    if (id === 'antigravity') {
      const cfgPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
      if (!fs.existsSync(cfgPath)) return false;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return !!(cfg && cfg.mcpServers && (cfg.mcpServers['konoha'] || cfg.mcpServers['skills-db']));
    }
    if (id === 'cursor') {
      const cfgPath = path.join(os.homedir(), '.cursor', 'mcp.json');
      if (!fs.existsSync(cfgPath)) return false;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return !!(cfg && cfg.mcpServers && (cfg.mcpServers['konoha'] || cfg.mcpServers['skills-db']));
    }
    if (id === 'claude') {
      const cfgPath = path.join(os.homedir(), '.claude.json');
      if (!fs.existsSync(cfgPath)) return false;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return !!(cfg && cfg.mcpServers && (cfg.mcpServers['konoha'] || cfg.mcpServers['skills-db']));
    }
    if (id === 'opencode') {
      const p1 = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const p2 = path.join(os.homedir(), '.opencode', 'config.json');
      const target = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
      if (!target) return false;
      const cfg = JSON.parse(fs.readFileSync(target, 'utf8'));
      return !!(cfg && cfg.mcp && (cfg.mcp['konoha'] || cfg.mcp['skills-db']));
    }
    if (id === 'commandcode') {
      const cfgPath = path.join(os.homedir(), '.commandcode', 'mcp.json');
      if (!fs.existsSync(cfgPath)) return false;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return !!(cfg && cfg.mcpServers && (cfg.mcpServers['konoha'] || cfg.mcpServers['skills-db']));
    }
    if (id === 'codex') {
      const cfgPath = path.join(os.homedir(), '.codex', 'config.toml');
      if (!fs.existsSync(cfgPath)) return false;
      const content = fs.readFileSync(cfgPath, 'utf8');
      return /\[mcp(?:_servers)?\.(?:konoha|skills-db)\]/i.test(content);
    }
    if (id === 'pi') {
      const cfgPath = path.join(os.homedir(), '.pi', 'agent', 'mcp.json');
      if (!fs.existsSync(cfgPath)) return false;
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return !!(cfg && cfg.mcpServers && (cfg.mcpServers['konoha'] || cfg.mcpServers['skills-db']));
    }
    if (id === 'omp') {
      const ompMgr = require('../../omp_manager');
      return ompMgr.getOmpStatus().configured;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function getTrustedClientIp(req) {
  const remoteIp = req.socket?.remoteAddress || '';
  const isLoopbackOrTrusted = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIp);
  if (isLoopbackOrTrusted) {
    const cfIp = req.headers['cf-connecting-ip'];
    const xff = req.headers['x-forwarded-for'];
    if (cfIp && typeof cfIp === 'string') return cfIp.trim();
    if (xff && typeof xff === 'string') return xff.split(',')[0].trim();
  }
  return remoteIp || '127.0.0.1';
}

function getClientSessionId(req) {
  if (!req || !req.headers) return null;
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/konoha_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1].trim());
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xSession = req.headers['x-konoha-session'];
  if (xSession) return String(xSession).trim();
  return null;
}

function isBrowserClient(req) {
  if (!req || !req.headers) return false;
  if (req.headers['sec-fetch-site'] || req.headers['sec-fetch-mode'] || req.headers['sec-ch-ua']) return true;
  const cookie = req.headers.cookie || '';
  if (cookie.includes('konoha_session=') || cookie.includes('konoha-web-token=')) return true;
  const ua = String(req.headers['user-agent'] || '');
  if (ua.includes('Mozilla/') || ua.includes('Chrome/') || ua.includes('Safari/')) return true;
  return false;
}

function spawnGatewayDaemon() {
  const mcpScript = fs.existsSync(path.join(SKILLS_DB_DIR, 'file_tools_mcp.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_mcp.js')
    : path.join(__dirname, '..', '..', 'file_tools_mcp.js');
  const child = spawn(process.execPath || 'node', [mcpScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, { KONOHA_DAEMON: 'true' })
  });
  child.unref();
  try {
    fs.writeFileSync(path.join(SKILLS_DB_DIR, 'bridge.pid'), String(child.pid));
  } catch (_) { /* intentional best-effort fallback */ }
  return child;
}

const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
  /^100\.100\.100\.200$/,
  /^fd00:/i,
  /^fe80:/i,
  /^::ffff:169\.254\./i
];

function validateBridgeTargetUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    return { ok: false, reason: 'Empty or missing target URL' };
  }
  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch (err) {
    return { ok: false, reason: `Malformed URL: ${err.message}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Disallowed protocol scheme "${parsed.protocol}"` };
  }

  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return { ok: false, reason: `Target host "${hostname}" blocked by SSRF protection policy` };
    }
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (port < 80 || (port > 80 && port < 1024 && port !== 443)) {
    return { ok: false, reason: `Target port ${port} is a restricted system port` };
  }

  return { ok: true, parsed };
}

function isAuthorizedRequest(req, sessionToken) {
  if (!req) return false;
  const webAuth = require('../../auth');
  const sessionId = getClientSessionId(req);
  if (sessionId && webAuth.getSession(sessionId)) return true;

  const headerToken = req.headers['x-konoha-web-token'] ||
    (typeof req.headers['authorization'] === 'string' ? req.headers['authorization'].replace(/^Bearer\s+/i, '').trim() : null);
  if (headerToken && headerToken === sessionToken) return true;

  const cookieHeader = req.headers.cookie || '';
  if (sessionToken && cookieHeader.split(';').some(c => c.trim() === `konoha-web-token=${sessionToken}`)) return true;

  return false;
}

function discoverClientModels() {
  const discovered = [], seenIds = new Set(), HOME = os.homedir();
  try {
    const ompDbPath = path.join(HOME, '.omp', 'agent', 'models.db');
    if (fs.existsSync(ompDbPath)) {
      const Database = require('../../sqlite_driver');
      const ompConn = new Database(ompDbPath);
      try {
        const rows = ompConn.prepare('SELECT models FROM model_cache').all();
        for (const row of rows) {
          if (!row.models) continue;
          try {
            const list = JSON.parse(row.models);
            if (Array.isArray(list)) {
              for (const m of list) {
                if (m && m.id && !seenIds.has(m.id)) {
                  seenIds.add(m.id);
                  discovered.push({ id: m.id, model_name: m.name || m.id, bridge: m.provider || 'omp', owned_by: m.provider || 'omp', source: 'client:omp' });
                }
              }
            }
          } catch (_) { /* ignore */ }
        }
      } finally { ompConn.close(); }
    }
  } catch (_) { /* non-fatal best effort */ }

  try {
    const claudeJsonPath = path.join(HOME, '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      const data = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      if (data && typeof data === 'object') {
        const cModels = data.models || data.customModels || [];
        if (Array.isArray(cModels)) {
          for (const m of cModels) {
            const id = typeof m === 'string' ? m : (m && m.id);
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              discovered.push({ id, model_name: typeof m === 'object' && m.name ? m.name : id, bridge: 'claude', owned_by: 'claude', source: 'client:claude' });
            }
          }
        }
      }
    }
  } catch (_) { /* non-fatal best effort */ }

  try {
    const opencodePath = path.join(HOME, '.config', 'opencode', 'opencode.json');
    if (fs.existsSync(opencodePath)) {
      const data = JSON.parse(fs.readFileSync(opencodePath, 'utf8'));
      if (data && Array.isArray(data.models)) {
        for (const m of data.models) {
          const id = typeof m === 'string' ? m : (m && m.id);
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            discovered.push({ id, model_name: id, bridge: 'opencode', owned_by: 'opencode', source: 'client:opencode' });
          }
        }
      }
    }
  } catch (_) { /* non-fatal best effort */ }

  return discovered;
}

module.exports = {
  MAX_BODY_BYTES,
  sendJson,
  parseBody,
  isDeleteConfirmed,
  isClientConfigured,
  getTrustedClientIp,
  getClientSessionId,
  isBrowserClient,
  spawnGatewayDaemon,
  validateBridgeTargetUrl,
  isAuthorizedRequest,
  discoverClientModels
};
