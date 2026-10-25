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

module.exports = {
  MAX_BODY_BYTES,
  sendJson,
  parseBody,
  isDeleteConfirmed,
  isClientConfigured,
  getTrustedClientIp,
  getClientSessionId,
  isBrowserClient,
  spawnGatewayDaemon
};
