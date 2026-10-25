'use strict';

const crypto = require('crypto');
const webAuth = require('../../auth');
const tunnelSecurity = require('../../tunnel/security');
const {
  sendJson,
  parseBody,
  getTrustedClientIp,
  getClientSessionId
} = require('./common');

async function handleAuthRoutes(req, res, ctx, parsedUrl, pathname, method) {
  const { sessionToken, broadcastEvent } = ctx;

  if (method === 'POST' && pathname === '/api/v1/auth/pin') {
    const clientIp = getTrustedClientIp(req);
    const rate = tunnelSecurity.checkPinRateLimit(clientIp);
    if (!rate.allowed) {
      return sendJson(res, 429, { error: `Too many failed attempts. Try again in ${rate.waitSec}s.` });
    }
    try {
      const body = await parseBody(req);
      const pin = String(body.pin || '').trim();
      const tunnelCfg = require('../../tunnel/config');
      const cfg = tunnelCfg.getTunnelConfig();
      let isPinValid = false;
      if (cfg.auth_pin && pin) {
        const pinBuf = Buffer.from(pin);
        const expectedBuf = Buffer.from(String(cfg.auth_pin).trim());
        if (pinBuf.length === expectedBuf.length && crypto.timingSafeEqual(pinBuf, expectedBuf)) {
          isPinValid = true;
        }
      }
      if (isPinValid) {
        tunnelSecurity.resetPinFailure(clientIp);
        res.setHeader('Set-Cookie', `konoha_pin=${encodeURIComponent(pin)}; Path=/; Max-Age=604800; SameSite=Lax; HttpOnly; Secure`);
        return sendJson(res, 200, { ok: true, token: sessionToken });
      } else {
        tunnelSecurity.recordPinFailure(clientIp);
        return sendJson(res, 401, { error: 'Invalid access PIN' });
      }
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/auth/login') {
    const clientIp = getTrustedClientIp(req);
    try {
      const body = await parseBody(req);
      const password = body && typeof body === 'object' && typeof body.password === 'string' ? body.password : '';
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

  if (method === 'GET' && (pathname === '/api/v1/auth/status' || pathname === '/api/v1/auth/session')) {
    const sessionId = getClientSessionId(req);
    const status = webAuth.getAuthStatus(sessionId);
    return sendJson(res, 200, {
      ok: true,
      ...status
    });
  }

  if (method === 'POST' && pathname === '/api/v1/auth/change-password') {
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

  if (method === 'POST' && pathname === '/api/v1/auth/reset-password') {
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

  if (method === 'POST' && pathname === '/api/v1/auth/logout') {
    const sessionId = getClientSessionId(req);
    if (sessionId) {
      webAuth.destroySession(sessionId);
    }
    res.setHeader('Set-Cookie', 'konoha_session=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly');
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

module.exports = {
  handleAuthRoutes
};
