'use strict';

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const deployUtils = require('./deploy_utils');
const { SKILLS_DB_DIR } = require('../bin/lib/paths');
const webAuth = require('./auth');
const tunnelSecurity = require('./tunnel/security');

const authController = require('./web/controllers/auth_controller');
const coreController = require('./web/controllers/core_controller');
const skillsController = require('./web/controllers/skills_controller');
const sdlcController = require('./web/controllers/sdlc_controller');
const servicesController = require('./web/controllers/services_controller');
const {
  MAX_BODY_BYTES,
  sendJson,
  getTrustedClientIp,
  getClientSessionId,
  isBrowserClient
} = require('./web/controllers/common');

let cachedWebUiDir = null;
let cachedDistDir = null;

function getWebUiDir() {
  if (cachedWebUiDir) return cachedWebUiDir;
  cachedWebUiDir = deployUtils.resolveWebUiDir() || path.resolve(__dirname, '..', 'apps', 'web');
  return cachedWebUiDir;
}

function getDistDir() {
  if (cachedDistDir) return cachedDistDir;
  const base = getWebUiDir();
  const buildClient = path.join(base, 'build', 'client');
  if (fs.existsSync(buildClient)) {
    cachedDistDir = buildClient;
    return cachedDistDir;
  }
  cachedDistDir = path.join(base, 'dist');
  return cachedDistDir;
}

const WEB_UI_DIR = getWebUiDir();

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

async function handleWebServerRequest(req, res, ctx) {
  req._res = res;
  const { port, host, sessionToken, getSvelteKitHandler } = ctx;
  const parsedUrl = new URL(req.url, 'http://' + host + ':' + port);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const rawCl = req.headers['content-length'];
    if (rawCl !== undefined) {
      const parsedCl = parseInt(rawCl, 10);
      if (!isNaN(parsedCl) && parsedCl > MAX_BODY_BYTES) {
        return sendJson(res, 413, { error: 'Request body exceeds 1 MiB limit' });
      }
    }
  }

  const rawHost = req.headers['host'];
  let hostWithoutPort = '';
  if (rawHost) {
    const hStr = String(rawHost).trim().toLowerCase();
    if (hStr.startsWith('[')) {
      const endBracket = hStr.indexOf(']');
      hostWithoutPort = endBracket !== -1 ? hStr.slice(0, endBracket + 1) : hStr;
    } else {
      hostWithoutPort = hStr.split(':')[0];
    }
  }

  const isLoopbackHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostWithoutPort);
  let isAllowedTunnelHost = false;
  if (!isLoopbackHost && hostWithoutPort) {
    try {
      const tunnelMgr = require('./tunnel/manager');
      const tunnelStatus = tunnelMgr.getTunnelStatus();
      if (tunnelStatus && tunnelStatus.enabled) {
        const allowedHosts = new Set();
        if (tunnelStatus.custom_domain) {
          try {
            const normHost = tunnelMgr.normalizeAndValidateTunnelHostname(tunnelStatus.custom_domain);
            allowedHosts.add(normHost);
          } catch (_) { /* invalid custom domain */ }
        }
        if (allowedHosts.has(hostWithoutPort)) {
          isAllowedTunnelHost = true;
        }
      }
    } catch (_) { /* tunnel manager unavailable */ }
  }

  if (!isLoopbackHost && !isAllowedTunnelHost) {
    return sendJson(res, 403, { error: 'Forbidden: Invalid or untrusted Host header' });
  }

  const isRemote = tunnelSecurity.isRemoteRequest(req);
  ctx.isRemote = isRemote;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Konoha-Web-Token, Authorization, X-Konoha-Pin'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    if (await authController.handleAuthRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;

    if (isRemote) {
      const isStaticOrHealth = pathname.startsWith('/_app/') ||
                               pathname === '/favicon.png' ||
                               pathname === '/api/v1/health' ||
                               pathname === '/api/v1/auth/pin' ||
                               pathname === '/api/v1/auth/login' ||
                               pathname === '/api/v1/auth/status';
      if (!isStaticOrHealth) {
        const auth = tunnelSecurity.verifyRemoteAccess(req);
        if (!auth.authenticated) {
          return sendJson(res, 401, { error: auth.error, requires_pin: true });
        }
      }
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname.startsWith('/api/v1/')) {
      if (pathname !== '/api/v1/auth/pin' && pathname !== '/api/v1/auth/login') {
        const tokenHeader = req.headers['x-konoha-web-token'];
        if (!tokenHeader || tokenHeader !== sessionToken) {
          return sendJson(res, 403, { error: 'Forbidden: Invalid or missing X-Konoha-Web-Token CSRF header' });
        }
      }
    }

    const isPublicApi = pathname === '/api/v1/health' ||
                        pathname === '/api/v1/csrf' ||
                        pathname === '/api/v1/token' ||
                        pathname === '/api/v1/auth/login' ||
                        pathname === '/api/v1/auth/pin' ||
                        pathname === '/api/v1/auth/status' ||
                        pathname === '/api/v1/auth/session';

    if (pathname.startsWith('/api/v1/') && !isPublicApi) {
      const sessionId = getClientSessionId(req);
      const session = sessionId ? webAuth.getSession(sessionId) : null;
      const hasMasterToken = req.headers['x-konoha-web-token'] === sessionToken;
      const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const isBrowser = isBrowserClient(req);

      if (isBrowser) {
        if (!session) {
          return sendJson(res, 401, { error: 'Unauthorized: Authentication required', requires_login: true });
        }
      } else if (!isLoopback && !hasMasterToken && !session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required', requires_login: true });
      }

      if (session && session.isBootstrap) {
        if (pathname !== '/api/v1/auth/change-password' && pathname !== '/api/v1/auth/logout') {
          return sendJson(res, 403, {
            error: 'Mandatory password change required before normal dashboard access',
            requires_password_change: true
          });
        }
      }
    }

    if (await coreController.handleCoreRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
    if (await skillsController.handleSkillsRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
    if (await sdlcController.handleSdlcRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
    if (await servicesController.handleServicesRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;

    const error_id = 'err_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return sendJson(res, 404, {
      status: 404,
      code: 'NOT_FOUND',
      message: `API endpoint '${method} ${pathname}' not found.`,
      error: `API endpoint '${method} ${pathname}' not found.`,
      error_id
    });
  }

  if (pathname.startsWith('/assets/')) {
    const assetRel = pathname.slice('/assets/'.length);
    const rootAssetPath = path.resolve(__dirname, '..', 'assets', assetRel);
    if (fs.existsSync(rootAssetPath) && !fs.statSync(rootAssetPath).isDirectory()) {
      const ext = path.extname(rootAssetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(rootAssetPath);
      stream.on('error', () => {
        try { res.end(); } catch (_) { /* intentional best-effort fallback */ }
      });
      return stream.pipe(res);
    }
  }

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

  const distDir = getDistDir();
  let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
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
      try { res.end(); } catch (_) { /* intentional best-effort fallback */ }
    });
    return stream.pipe(res);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><head><title>Konoha Web UI</title></head><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;"><h1>🍃 Konoha Web UI</h1><p>Server running on port ' + port + '. Frontend initializing...</p></body></html>');
}

function createWebServer(options = {}) {
  const port = options.port !== undefined ? options.port : 1404;
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
    } catch (_) { /* intentional best-effort fallback */ }
  }
  if (!sessionToken) {
    sessionToken = crypto.randomBytes(16).toString('hex');
    try {
      if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
      fs.writeFileSync(tokenFile, sessionToken, { encoding: 'utf8', mode: 0o600 });
    } catch (_) { /* intentional best-effort fallback */ }
  }
  const sseClients = new Set();
  const systemMetrics = { _lastCpuTimes: null, _lastCpuUsage: null, _lastHrtime: process.hrtime.bigint() };

  function broadcastEvent(type, data) {
    const payload = 'event: ' + type + '\n' + 'data: ' + JSON.stringify(data) + '\n\n';
    for (const client of sseClients) {
      try { client.write(payload); } catch (_) { sseClients.delete(client); }
    }
  }

  let svelteKitHandler = null;

  async function getSvelteKitHandler() {
    if (svelteKitHandler) return svelteKitHandler;
    const resolvedWebDir = deployUtils.resolveWebUiDir() || WEB_UI_DIR;
    const svelteKitHandlerPath = path.join(resolvedWebDir, 'build', 'handler.js');
    if (fs.existsSync(svelteKitHandlerPath) && process.env.KONOHA_UI_ROUTER !== 'legacy') {
      try {
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
      } catch (_) { /* intentional best-effort fallback */ }
    }
    return svelteKitHandler;
  }

  const ctx = {
    port,
    host,
    sessionToken,
    sseClients,
    systemMetrics,
    broadcastEvent,
    getSvelteKitHandler,
    options
  };

  const server = http.createServer((req, res) => {
    handleWebServerRequest(req, res, ctx).catch(err => {
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
      } catch (_) { /* ignore */ }
    });
  });

  return {
    server,
    port,
    host,
    sessionToken,
    broadcastEvent,
    start: () => new Promise((resolve, reject) => {
      server.listen(port, host, () => {
        try {
          if (process.env.KONOHA_DISABLE_TELEGRAM_POLLER !== '1') {
            const tgConfig = require('./telegram/config');
            const poller = require('./telegram/poller');
            const cfg = tgConfig.getTelegramConfig();
            if (cfg.enabled && cfg.mode === 'two_way' && cfg.bot_token) {
              poller.startPoller();
            }
          }
        } catch (_) { /* intentional fallback */ }
        try {
          const queueWorker = require('./queue/worker');
          queueWorker.startWorker();
        } catch (_) { /* intentional fallback */ }
        const actualPort = server.address() ? server.address().port : port;
        resolve({ port: actualPort, host, token: sessionToken });
      });
      server.on('error', reject);
    }),
    stop: () => new Promise(resolve => {
      try {
        const poller = require('./telegram/poller');
        poller.stopPoller();
      } catch (_) { /* intentional fallback */ }
      try {
        const queueWorker = require('./queue/worker');
        queueWorker.stopWorker();
      } catch (_) { /* intentional fallback */ }
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
  startWebServer,
  getTrustedClientIp
};
