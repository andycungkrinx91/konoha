'use strict';

/**
 * src/web/controllers/browser_controller.js — Authenticated Web UI REST & Live
 * Viewing interface for Konoha's Docker Headed Browser Workspaces.
 */

const webAuth = require('../../auth');
const { defaultBrowserSessionManager } = require('../../workflow/qa-automation/browser_session_manager');
const qaTools = require('../../workflow/qa-automation/qa_tools');
const { sendJson, parseBody, getClientSessionId } = require('./common');

function _escHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _isAuthenticatedViewer(req, ctx, parsedUrl) {
  const sessId = getClientSessionId(req);
  if (sessId && webAuth.getSession(sessId)) return true;
  const headerTok = req.headers['x-konoha-web-token'] || parsedUrl.searchParams.get('token');
  const remoteIp = req.socket?.remoteAddress || '';
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIp);
  return Boolean(isLoopback && headerTok && headerTok === ctx.sessionToken);
}

async function handleBrowserApiRoutes(req, res, ctx, reqMeta) {
  const { parsedUrl, pathname, method } = reqMeta;
  const mgr = ctx.browserSessionManager || defaultBrowserSessionManager;

  if (method === 'GET' && pathname === '/api/v1/browser/sessions') {
    const includeStopped = parsedUrl.searchParams.get('all') === 'true';
    const sessions = mgr.listSessions({ includeStopped });
    return sendJson(res, 200, {
      docker: mgr.isDockerAvailable(),
      sessions,
      count: sessions.length
    });
  }

  if (method === 'POST' && pathname === '/api/v1/browser/sessions') {
    try {
      const body = await parseBody(req);
      const session = await mgr.createSession({
        sessionId: body.sessionId || body.session_id,
        purpose: body.purpose || 'frontend-dev',
        projectPath: body.projectPath || body.project_path || null,
        targetUrl: body.targetUrl || body.target_url || '',
        buildId: body.buildId || body.build_id || '',
        workspaceMount: body.workspaceMount || null,
        playwrightUi: Boolean(body.playwrightUi || body.playwright_ui),
        reuse: body.reuse !== false,
        forceNew: Boolean(body.forceNew),
        autoBuild: Boolean(body.autoBuild),
        waitForViewer: body.waitForViewer !== false
      });
      return sendJson(res, 201, { ok: true, session });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/browser/cleanup') {
    const resCleanup = mgr.cleanupStaleSessions();
    return sendJson(res, 200, { ok: true, ...resCleanup });
  }

  if (method === 'POST' && pathname === '/api/v1/browser/qa') {
    try {
      const body = await parseBody(req);
      const qaRes = await qaTools.qaE2eRunAsync({
        project_path: body.project_path || body.projectPath || process.cwd(),
        grep: body.grep,
        last_failed: Boolean(body.last_failed),
        max_failures: body.max_failures,
        headed: body.headed !== false,
        live: body.live !== false,
        playwright_ui: Boolean(body.playwright_ui),
        sessionManager: mgr
      });
      return sendJson(res, 200, qaRes);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  const match = pathname.match(/^\/api\/v1\/browser\/sessions\/([^/]+)(?:\/(logs|interact|cancel))?$/);
  if (!match) return false;
  const sessionId = decodeURIComponent(match[1]);
  const sub = match[2] || null;

  if (!sub && method === 'GET') {
    const session = mgr.getSession(sessionId);
    if (!session) return sendJson(res, 404, { error: `Browser session '${sessionId}' not found.` });
    return sendJson(res, 200, { session });
  }

  if (!sub && method === 'DELETE') {
    const stopped = await mgr.stopSession(sessionId, { reason: 'api_delete' });
    if (!stopped.found) return sendJson(res, 404, { error: `Browser session '${sessionId}' not found.` });
    return sendJson(res, 200, stopped);
  }

  if (sub === 'logs' && method === 'GET') {
    const tail = parseInt(parsedUrl.searchParams.get('tail') || '100', 10);
    const logs = mgr.getSessionLogs(sessionId, { tail });
    if (!logs) return sendJson(res, 404, { error: `Browser session '${sessionId}' not found.` });
    return sendJson(res, 200, logs);
  }

  if (sub === 'interact' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const result = await mgr.interact(sessionId, body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (sub === 'cancel' && method === 'POST') {
    const resCancel = await mgr.cancelSession(sessionId, 'api_cancel');
    if (!resCancel.found) return sendJson(res, 404, { error: `Browser session '${sessionId}' not found.` });
    return sendJson(res, 200, resCancel);
  }

  return false;
}

function handleBrowserViewerPage(req, res, ctx, parsedUrl) {
  if (!_isAuthenticatedViewer(req, ctx, parsedUrl)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Unauthorized: authenticate via Konoha Web UI or provide X-Konoha-Web-Token.');
  }

  const mgr = ctx.browserSessionManager || defaultBrowserSessionManager;
  const reqId = parsedUrl.searchParams.get('session');
  const sessions = mgr.listSessions();
  const active = reqId ? mgr.getSession(reqId) : (sessions[0] || null);

  if (!active) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(
      '<!DOCTYPE html><html><head><title>Konoha Live Browser Workspace</title></head>' +
      '<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;">' +
      '<h1>Konoha Live Browser Workspace</h1><p>No active headed browser session.</p></body></html>'
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Konoha Live Browser — ${_escHtml(active.session_id)}</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; height: 100vh; }
    header { display: flex; gap: 16px; align-items: center; padding: 10px 16px; background: #1e293b; border-bottom: 1px solid #334155; font-size: 13px; }
    .badge { padding: 2px 8px; border-radius: 999px; background: #065f46; color: #a7f3d0; font-weight: 600; }
    iframe { flex: 1; border: 0; width: 100%; background: #020617; }
    code { color: #38bdf8; }
  </style>
</head>
<body>
  <header>
    <span class="badge">LIVE SESSION</span>
    <span>Session: <code>${_escHtml(active.session_id)}</code></span>
    <span>Build: <code>${_escHtml(active.build_id)}</code></span>
    <span>Target: <code>${_escHtml(active.target_url || 'about:blank')}</code></span>
    <span>VNC Password: <code>${_escHtml(active.vnc_password)}</code></span>
  </header>
  <iframe title="Live Headed Browser Display" src="${_escHtml(active.viewer_url)}"></iframe>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(html);
}

module.exports = {
  handleBrowserApiRoutes,
  handleBrowserViewerPage
};
