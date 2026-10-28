'use strict';

const webAuth = require('../../auth');
const {
  sendJson,
  parseBody,
  getTrustedClientIp,
  getClientSessionId
} = require('./common');

async function _handleLoginAuth(req, res, sessionToken) {
  const clientIp = getTrustedClientIp(req);
  try {
    const body = await parseBody(req);
    const password = typeof body?.password === 'string' ? body.password : '';
    const result = webAuth.authenticate(password, clientIp);
    if (!result.success) {
      return sendJson(res, result.rateLimited ? 429 : 401, { error: result.error });
    }
    res.setHeader('Set-Cookie', [
      `konoha_session=${encodeURIComponent(result.sessionId)}; Path=/; SameSite=Strict; HttpOnly`,
      `konoha-web-token=${sessionToken}; Path=/; SameSite=Strict; HttpOnly`
    ]);
    return sendJson(res, 200, {
      ok: true,
      sessionId: result.sessionId,
      token: sessionToken,
      is_bootstrap: result.isBootstrap,
      requires_password_change: result.requiresPasswordChange
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleChangePassword(req, res, broadcastEvent) {
  const sessionId = getClientSessionId(req);
  try {
    const body = await parseBody(req);
    const payload = body && typeof body === 'object' ? body : {};
    const result = webAuth.updatePassword(sessionId, payload.current_password, payload.new_password);
    if (!result.success) {
      return sendJson(res, result.status || 400, { error: result.error });
    }
    res.setHeader('Set-Cookie', 'konoha_session=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly');
    broadcastEvent('auth_state_changed', { action: 'password_changed', requires_login: true });
    return sendJson(res, 200, { ok: true, message: result.message, requires_login: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleResetPassword(req, res, broadcastEvent) {
  const sessionId = getClientSessionId(req);
  try {
    const body = await parseBody(req);
    const payload = body && typeof body === 'object' ? body : {};
    const result = webAuth.resetPasswordToDefault(sessionId, payload.current_password);
    if (!result.success) {
      return sendJson(res, result.status || 400, { error: result.error });
    }
    res.setHeader('Set-Cookie', 'konoha_session=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly');
    broadcastEvent('auth_state_changed', { action: 'password_reset', requires_login: true });
    return sendJson(res, 200, { ok: true, message: result.message, requires_login: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleLogout(req, res) {
  const sessionId = getClientSessionId(req);
  if (sessionId) webAuth.destroySession(sessionId);
  res.setHeader('Set-Cookie', 'konoha_session=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly');
  return sendJson(res, 200, { ok: true });
}

async function handleAuthRoutes(req, res, ctx, _parsedUrl, ...rest) {
  const [pathname, method] = rest;
  const { sessionToken, broadcastEvent } = ctx;

  if (method === 'POST' && pathname === '/api/v1/auth/login') {
    return await _handleLoginAuth(req, res, sessionToken);
  }
  if (method === 'GET' && (pathname === '/api/v1/auth/status' || pathname === '/api/v1/auth/session')) {
    const sessionId = getClientSessionId(req);
    return sendJson(res, 200, { ok: true, ...webAuth.getAuthStatus(sessionId) });
  }
  if (method === 'POST' && pathname === '/api/v1/auth/change-password') {
    return await _handleChangePassword(req, res, broadcastEvent);
  }
  if (method === 'POST' && pathname === '/api/v1/auth/reset-password') {
    return await _handleResetPassword(req, res, broadcastEvent);
  }
  if (method === 'POST' && pathname === '/api/v1/auth/logout') {
    return _handleLogout(req, res);
  }
  return false;
}

module.exports = {
  handleAuthRoutes
};
