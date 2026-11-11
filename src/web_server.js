'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webAuth = require('./auth');
const deployUtils = require('./deploy_utils');
const { SKILLS_DB_DIR, UI_PORT } = require('../bin/lib/paths');
const authController = require('./web/controllers/auth_controller');
const coreController = require('./web/controllers/core_controller');
const activityController = require('./web/controllers/activity_controller');
const skillsController = require('./web/controllers/skills_controller');
const sdlcController = require('./web/controllers/sdlc_controller');
const servicesController = require('./web/controllers/services_controller');
let _model3DController = null;
let _model3DRefineController = null;
function getModel3DController() {
  if (!_model3DController) _model3DController = require('./web/controllers/model_3d_controller');
  return _model3DController;
}
function getModel3DRefineController() {
  if (!_model3DRefineController) _model3DRefineController = require('./web/controllers/model3d_refine_controller');
  return _model3DRefineController;
}
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

function _verifyApiAuthentication(req, pathname, method, ctx) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname.startsWith('/api/v1/')) {
    if (pathname !== '/api/v1/auth/login' && pathname !== '/api/v1/auth/logout') {
      const tokenHeader = req.headers['x-konoha-web-token'];
      if (!tokenHeader || !isValidSessionToken(tokenHeader, ctx)) {
        return { ok: false, status: 403, error: 'Forbidden: Invalid or missing X-Konoha-Web-Token CSRF header' };
      }
    }
  }

  // setup-password is the only credential write reachable without a session; it is a
  // no-op (403) unless is_bootstrap is true (src/auth.js#setupInitialPassword).
  const isPublicApi = ['/api/v1/health', '/api/v1/csrf', '/api/v1/token', '/api/v1/auth/login', '/api/v1/auth/status', '/api/v1/auth/session', '/api/v1/auth/setup-password'].includes(pathname);
  if (!pathname.startsWith('/api/v1/') || isPublicApi) return { ok: true };

  const sessionId = getClientSessionId(req);
  const session = sessionId ? webAuth.getSession(sessionId) : null;
  const hasMasterToken = isValidSessionToken(req.headers['x-konoha-web-token'], ctx);
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
  if (await activityController.handleActivityRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await skillsController.handleSkillsRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await sdlcController.handleSdlcRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (await servicesController.handleServicesRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
  if (pathname.startsWith('/api/v1/3d') || pathname.startsWith('/api/v1/model3d')) {
    if (await getModel3DController().handleModel3DRoutes(req, res, ctx, parsedUrl, pathname, method)) return true;
    if (await getModel3DRefineController().routeRefineForkRequests(req, res, ctx, pathname, method)) return true;
  }

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
    resolveOrRotateTokenState(ctx);
    const apiAuth = _verifyApiAuthentication(req, pathname, method, ctx);
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

const TOKEN_FILE_NAME = 'web_token';
const TOKEN_ROTATION_TTL_MS = Number.parseInt(process.env.KONOHA_WEB_TOKEN_TTL_MS || '', 10) || (12 * 60 * 60 * 1000);
const TOKEN_GRACE_WINDOW_MS = Number.parseInt(process.env.KONOHA_WEB_TOKEN_GRACE_MS || '', 10) || (5 * 60 * 1000);

function getTokenFilePath() {
  return path.join(SKILLS_DB_DIR, TOKEN_FILE_NAME);
}

function generateSessionToken() {
  return crypto.randomBytes(16).toString('hex');
}

function persistSessionToken(token) {
  const tokenFile = getTokenFilePath();
  try {
    if (!fs.existsSync(SKILLS_DB_DIR)) fs.mkdirSync(SKILLS_DB_DIR, { recursive: true });
    fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function readPersistedTokenAgeMs() {
  try {
    const tokenFile = getTokenFilePath();
    if (!fs.existsSync(tokenFile)) return null;
    const cached = fs.readFileSync(tokenFile, 'utf8').trim();
    if (!cached || cached.length < 16) return null;
    return { token: cached, ageMs: Date.now() - fs.statSync(tokenFile).mtimeMs };
  } catch {
    return null;
  }
}

function resolveInitialTokenState(customToken, explicitToken) {
  if (explicitToken) {
    persistSessionToken(customToken);
    return { sessionToken: customToken, tokenRotatedAt: Date.now(), previousSessionToken: null, previousTokenExpiresAt: 0 };
  }
  const persisted = readPersistedTokenAgeMs();
  if (persisted && persisted.ageMs < TOKEN_ROTATION_TTL_MS) {
    return { sessionToken: persisted.token, tokenRotatedAt: Date.now() - persisted.ageMs, previousSessionToken: null, previousTokenExpiresAt: 0 };
  }
  const generated = generateSessionToken();
  persistSessionToken(generated);
  return { sessionToken: generated, tokenRotatedAt: Date.now(), previousSessionToken: null, previousTokenExpiresAt: 0 };
}

function rotateSessionToken(state) {
  const nextToken = generateSessionToken();
  state.previousSessionToken = state.sessionToken;
  state.previousTokenExpiresAt = Date.now() + TOKEN_GRACE_WINDOW_MS;
  state.sessionToken = nextToken;
  state.tokenRotatedAt = Date.now();
  persistSessionToken(nextToken);
  return nextToken;
}

function resolveOrRotateTokenState(state) {
  if (!state || !state.sessionToken) return state;
  if (Date.now() - state.tokenRotatedAt < TOKEN_ROTATION_TTL_MS) return state;
  rotateSessionToken(state);
  if (typeof state.onTokenRotated === 'function') {
    try { state.onTokenRotated(state.sessionToken); } catch { /* broadcast is best-effort */ }
  }
  return state;
}

function isValidSessionToken(candidate, ctx) {
  if (!candidate || typeof candidate !== 'string') return false;
  const state = ctx || {};
  if (candidate === state.sessionToken) return true;
  return Boolean(state.previousSessionToken)
    && candidate === state.previousSessionToken
    && Date.now() < (state.previousTokenExpiresAt || 0);
}

function scheduleTokenRotation(ctx) {
  const intervalMs = Math.min(TOKEN_ROTATION_TTL_MS, 30 * 60 * 1000);
  const timer = setInterval(() => resolveOrRotateTokenState(ctx), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
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
  const port = options.port !== undefined ? options.port : UI_PORT;
  const host = options.host || '127.0.0.1';
  const tokenState = resolveInitialTokenState(options.token, Boolean(options.token));
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

  let serverVersion = '2.2.20';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg && pkg.version) serverVersion = pkg.version;
  } catch (_) { /* intentional fallback */ }
  if (options.version) serverVersion = options.version;
  serverVersion = String(serverVersion).replace(/^v+/, '');

  const ctx = {
    port,
    host,
    sessionToken: tokenState.sessionToken,
    tokenRotatedAt: tokenState.tokenRotatedAt,
    previousSessionToken: tokenState.previousSessionToken,
    previousTokenExpiresAt: tokenState.previousTokenExpiresAt,
    tokenTtlMs: TOKEN_ROTATION_TTL_MS,
    onTokenRotated: (nextToken) => {
      ctx.sessionToken = nextToken;
      broadcastEvent('token_rotated', { token: nextToken, ttl_ms: TOKEN_ROTATION_TTL_MS, rotated_at: new Date().toISOString() });
    },
    sseClients,
    systemMetrics,
    broadcastEvent,
    SERVER_VERSION: serverVersion,
    PORT: port,
    getSvelteKitHandler
  };

  resolveOrRotateTokenState(ctx);
  scheduleTokenRotation(ctx);

  const server = http.createServer((req, res) => {
    handleWebServerRequest(req, res, ctx).catch(err => _onServerError(err, res));
  });

  const instance = {
    server,
    port,
    host,
    token: ctx.sessionToken,
    getToken: () => ctx.sessionToken,
    broadcastEvent,
    ctx,
    start: () => _startServer(server, port, host, ctx.sessionToken, instance),
    stop: () => new Promise(resolve => {
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(resolve);
    })
  };
  return instance;
}

function recoverAbandonedGenerationJobs() {
  let conn = null;
  try {
    const { getConnection } = require('./db');
    const { recoverOrphanedJobs } = require('./mcp/three_asset/storage_manager');
    conn = getConnection();
    const recovered = recoverOrphanedJobs(conn);
    if (recovered.length > 0) {
      process.stdout.write(`[konoha web] Recovered ${recovered.length} abandoned 3D generation job(s): ${recovered.join(', ')}\n`);
    }
  } catch (err) {
    process.stderr.write(`[konoha web] 3D job recovery skipped: ${err.message}\n`);
  } finally {
    // Windows locks the database file while a handle is open, so callers that
    // delete their temp directory afterwards fail with EPERM. Release it here.
    try { if (conn) conn.close(); } catch (_) { /* best-effort */ }
  }
}

function startWebServer(options = {}) {
  const instance = createWebServer(options);
  recoverAbandonedGenerationJobs();
  return instance.start();
}

module.exports = {
  createWebServer,
  startWebServer,
  getDistDir,
  handleWebServerRequest
};

if (require.main === module) {
  const port = parseInt(process.env.PORT || String(UI_PORT), 10);
  const host = process.env.HOST || '127.0.0.1';
  startWebServer({ port, host }).then(({ url }) => {
    process.stdout.write(`[konoha web] Listening on ${url}\n`);
  }).catch(err => {
    process.stderr.write(`[konoha web] Failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
