'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webAuth = require('./auth');
const deployUtils = require('./deploy_utils');
const { SKILLS_DB_DIR } = require('../bin/lib/paths');
const authController = require('./web/controllers/auth_controller');
const coreController = require('./web/controllers/core_controller');
const skillsController = require('./web/controllers/skills_controller');
const sdlcController = require('./web/controllers/sdlc_controller');
const servicesController = require('./web/controllers/services_controller');
const {
  MAX_BODY_BYTES,
  sendJson,
  getClientSessionId,
  isBrowserClient
} = require('./web/controllers/common');

const WEB_UI_DIR = path.resolve(__dirname, '..', 'apps', 'web');

function getDistDir() {
  const resolved = deployUtils.resolveWebUiDir();
  if (resolved) {
    const candidateDist = path.join(resolved, 'dist');
    if (fs.existsSync(candidateDist)) return candidateDist;
  }
  const localDist = path.join(WEB_UI_DIR, 'dist');
  if (fs.existsSync(localDist)) return localDist;
  const legacyWeb = path.resolve(__dirname, '..', 'web');
  if (fs.existsSync(legacyWeb)) return legacyWeb;
  return localDist;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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

function _extractHostWithoutPort(rawHost) {
  if (!rawHost) return '';
  const hStr = String(rawHost).trim().toLowerCase();
  if (hStr.startsWith('[')) {
    const endBracket = hStr.indexOf(']');
    return endBracket !== -1 ? hStr.slice(0, endBracket + 1) : hStr;
  }
  return hStr.split(':')[0];
}

function _isHostAllowed(hostWithoutPort) {
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostWithoutPort)) return true;
  return false;
}

function _verifyApiAuthentication(req, pathname, method, sessionToken) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname.startsWith('/api/v1/')) {
    if (pathname !== '/api/v1/auth/login') {
      const tokenHeader = req.headers['x-konoha-web-token'];
      if (!tokenHeader || tokenHeader !== sessionToken) {
        return { ok: false, status: 403, error: 'Forbidden: Invalid or missing X-Konoha-Web-Token CSRF header' };
      }
    }
  }

  const isPublicApi = ['/api/v1/health', '/api/v1/csrf', '/api/v1/token', '/api/v1/auth/login', '/api/v1/auth/status', '/api/v1/auth/session'].includes(pathname);
  if (!pathname.startsWith('/api/v1/') || isPublicApi) return { ok: true };

  const sessionId = getClientSessionId(req);
  const session = sessionId ? webAuth.getSession(sessionId) : null;
  const hasMasterToken = req.headers['x-konoha-web-token'] === sessionToken;
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const isBrowser = isBrowserClient(req);

  if (isBrowser && !session) return { ok: false, status: 401, error: 'Unauthorized: Authentication required', requires_login: true };
  if (!isBrowser && !isLoopback && !hasMasterToken && !session) return { ok: false, status: 401, error: 'Unauthorized: Authentication required', requires_login: true };

  if (session?.isBootstrap && pathname !== '/api/v1/auth/change-password' && pathname !== '/api/v1/auth/logout') {
    return { ok: false, status: 403, error: 'Mandatory password change required before normal dashboard access', requires_password_change: true };
  }
  return { ok: true };
}

function _serveAssetFile(res, pathname) {
  const assetRel = pathname.slice('/assets/'.length);
  const rootAssetPath = path.resolve(__dirname, '..', 'assets', assetRel);
  if (!fs.existsSync(rootAssetPath) || fs.statSync(rootAssetPath).isDirectory()) return false;
  const ext = path.extname(rootAssetPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  const stream = fs.createReadStream(rootAssetPath);
  stream.on('error', () => { try { res.end(); } catch (_) { /* ignore */ } });
  stream.pipe(res);
  return true;
}

function _serveDistFile(res, pathname, port) {
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
    stream.on('error', () => { try { res.end(); } catch (_) { /* ignore */ } });
    return stream.pipe(res);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Konoha Web UI</title></head><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;"><h1>🍃 Konoha Web UI</h1><p>Server running on port ${port}. Frontend initializing...</p></body></html>`);
}

async function _dispatchApiControllers(req, res, ctx, route) {
  const { parsedUrl, pathname, method } = route;
  if (await authController.handleAuthRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await coreController.handleCoreRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await skillsController.handleSkillsRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await sdlcController.handleSdlcRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await servicesController.handleServicesRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;

  const error_id = 'err_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return sendJson(res, 404, {
    status: 404, code: 'NOT_FOUND',
    message: `API endpoint '${method} ${pathname}' not found.`,
    error: `API endpoint '${method} ${pathname}' not found.`,
    error_id
  });
}

async function handleWebServerRequest(req, res, ctx) {
  req._res = res;
  const { port, host, sessionToken, getSvelteKitHandler } = ctx;
  const parsedUrl = new URL(req.url, 'http://' + host + ':' + port);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const rawCl = req.headers['content-length'];
    if (rawCl !== undefined && parseInt(rawCl, 10) > MAX_BODY_BYTES) {
      return sendJson(res, 413, { error: 'Request body exceeds 1 MiB limit' });
    }
  }

  const hostWithoutPort = _extractHostWithoutPort(req.headers['host']);
  if (!_isHostAllowed(hostWithoutPort)) {
    return sendJson(res, 403, { error: 'Forbidden: Invalid or untrusted Host header' });
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Konoha-Web-Token, Authorization'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    const apiAuth = _verifyApiAuthentication(req, pathname, method, sessionToken);
    if (!apiAuth.ok) {
      const payload = { error: apiAuth.error };
      if (apiAuth.requires_login) payload.requires_login = true;
      if (apiAuth.requires_password_change) payload.requires_password_change = true;
      return sendJson(res, apiAuth.status, payload);
    }
    return await _dispatchApiControllers(req, res, ctx, { parsedUrl, pathname, method });
  }

  if (pathname.startsWith('/assets/') && _serveAssetFile(res, pathname)) return;

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

  _serveDistFile(res, pathname, port);
}

function _resolveSessionToken(customToken) {
  if (customToken) return customToken;
  const tokenFile = path.join(SKILLS_DB_DIR, 'web_token');
  try {
    if (fs.existsSync(tokenFile)) {
      const stat = fs.statSync(tokenFile);
      if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
        const cached = fs.readFileSync(tokenFile, 'utf8').trim();
        if (cached && cached.length >= 16) return cached;
      }
    }
  } catch (_) { /* ignore */ }

  const generated = crypto.randomBytes(16).toString('hex');
  try {
    if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
    fs.writeFileSync(tokenFile, generated, { encoding: 'utf8', mode: 0o600 });
  } catch (_) { /* ignore */ }
  return generated;
}

async function _loadSvelteKitModule(handlerPath) {
  try {
    const buildDir = path.dirname(handlerPath);
    const buildPkgPath = path.join(buildDir, 'package.json');
    if (!fs.existsSync(buildPkgPath)) fs.writeFileSync(buildPkgPath, '{\n  "type": "module"\n}\n');
    const appWebDir = path.dirname(buildDir);
    const appWebPkg = path.join(appWebDir, 'package.json');
    if (!fs.existsSync(appWebPkg)) fs.writeFileSync(appWebPkg, '{\n  "name": "konoha-web",\n  "type": "module",\n  "private": true\n}\n');
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(handlerPath).href);
    return mod.handler;
  } catch (_) {
    return null;
  }
}

function _onServerError(err, res) {
  process.stderr.write(`[konoha web] Unhandled error: ${err.message}\n`);
  if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

function _broadcastSseEvent(sseClients, type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
}

function _startServer(server, port, host, sessionToken, instance) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve({
        port,
        host,
        token: sessionToken,
        url: `http://${host}:${port}?token=${sessionToken}`,
        server,
        instance,
        stop: instance ? instance.stop : () => new Promise(r => server.close(r))
      });
    });
    server.on('error', reject);
  });
}

function createWebServer(options = {}) {
  const port = options.port !== undefined ? options.port : 1404;
  const host = options.host || '127.0.0.1';
  const sessionToken = _resolveSessionToken(options.token);
  const sseClients = new Set();
  const systemMetrics = { _lastCpuTimes: null, _lastCpuUsage: null, _lastHrtime: process.hrtime.bigint() };

  const broadcastEvent = (type, data) => _broadcastSseEvent(sseClients, type, data);

  let svelteKitHandler = null;

  async function getSvelteKitHandler() {
    if (svelteKitHandler) return svelteKitHandler;
    const resolvedWebDir = deployUtils.resolveWebUiDir() || WEB_UI_DIR;
    const svelteKitHandlerPath = path.join(resolvedWebDir, 'build', 'handler.js');
    if (fs.existsSync(svelteKitHandlerPath) && process.env.KONOHA_UI_ROUTER !== 'legacy') {
      svelteKitHandler = await _loadSvelteKitModule(svelteKitHandlerPath);
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
    SERVER_VERSION: options.version || 'v2.2.11',
    PORT: port,
    getSvelteKitHandler
  };

  const server = http.createServer((req, res) => {
    handleWebServerRequest(req, res, ctx).catch(err => _onServerError(err, res));
  });

  const instance = {
    server,
    port,
    host,
    token: sessionToken,
    broadcastEvent,
    start: () => _startServer(server, port, host, sessionToken, instance),
    stop: () => new Promise(resolve => server.close(resolve))
  };
  return instance;
}

function startWebServer(options = {}) {
  const instance = createWebServer(options);
  return instance.start();
}

module.exports = {
  createWebServer,
  startWebServer,
  getDistDir,
  handleWebServerRequest
};

if (require.main === module) {
  const port = parseInt(process.env.PORT || '1404', 10);
  const host = process.env.HOST || '127.0.0.1';
  startWebServer({ port, host }).then(({ url }) => {
    process.stdout.write(`[konoha web] Listening on ${url}\n`);
  }).catch(err => {
    process.stderr.write(`[konoha web] Failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
