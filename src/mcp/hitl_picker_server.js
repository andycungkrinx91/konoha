'use strict';

/**
 * src/mcp/hitl_picker_server.js — the picker page, served from the MCP process.
 *
 * The dashboard is manual-only (`konoha ui start`), and the MCP process is the
 * one thing a gate always runs inside. Without a listener here a `web_picker`
 * gate hands the human a URL to a port nobody is listening on, so the gate has
 * no control at all. This is the smallest server that makes that URL real: the
 * two capability-authenticated routes, no dashboard, no assets, no stdout.
 *
 * It deliberately does not start `src/web_server.js`: that server prints its
 * banner to stdout, which corrupts MCP stdio framing, and it owns token rotation
 * and 3D job recovery, neither of which a picker link needs.
 */

const http = require('http');

const CAPABILITY_ROUTES = new Set(['/api/v1/hitl/picker', '/api/v1/hitl/verdict']);
const servers = new Map();

function loadHitlController() {
  // Deferred on purpose: `hitl_controller` requires `workflow_gates`, which
  // requires `hitl_picker`, which requires this module.
  for (const candidate of ['../web/controllers/hitl_controller', '../src/web/controllers/hitl_controller']) {
    try {
      return require(candidate);
    } catch (_) { /* layout without that path */ }
  }
  throw new Error('web/controllers/hitl_controller is unreachable; the install is incomplete — re-run `konoha upgrade`.');
}

function ensureSessionToken() {
  const { readSessionToken } = require('./hitl_picker');
  if (readSessionToken()) return;
  // A machine that never ran `konoha ui` has no token file, so `signTaskDir`
  // returns null and every gate URL would be refused. Bootstrap one with the
  // dashboard's own helpers so both sides sign and verify with the same secret.
  // The flat install has no `~/.konoha/web/`, so `../web_server` there is a copy
  // whose own `./web/controllers/*` imports throw; `../src/web_server` is the one
  // with the tree beside it.
  let web = null;
  for (const candidate of ['../web_server', '../src/web_server']) {
    try {
      web = require(candidate);
      break;
    } catch (_) { /* layout without that path */ }
  }
  if (!web) throw new Error('web_server is unreachable; the install is incomplete — re-run `konoha upgrade`.');
  web.persistSessionToken(web.generateSessionToken());
}

function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, 'http://127.0.0.1');
  const route = { parsedUrl, pathname: parsedUrl.pathname, method: req.method.toUpperCase() };
  const notFound = () => {
    if (res.writableEnded) return;
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found.' }));
  };
  if (!CAPABILITY_ROUTES.has(route.pathname)) return notFound();

  // The token is re-read per request, so a rotation by a running dashboard is
  // honored instead of leaving the picker signing with a retired secret.
  const { readSessionToken } = require('./hitl_picker');
  const ctx = { sessionToken: readSessionToken(), previousSessionToken: null, previousTokenExpiresAt: 0 };
  return Promise.resolve(loadHitlController().handleHitlRoutes(req, res, ctx, route))
    .then((handled) => { if (!handled) notFound(); })
    .catch((err) => {
      if (res.writableEnded) return;
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Picker failed: ${err.message}` }));
    });
}

/**
 * One listener per host:port, created on first use.
 *
 * `EADDRINUSE` is the normal multi-process case, not a fault: a user runs
 * several clients, each with its own MCP process, and every one of them asks for
 * the same `ui_port + 1`. The first binds; the rest get this error and their
 * links still work, because the listener that won reads the same
 * `~/.konoha/web_token` and the same task directories on disk. Warning on it
 * would print once per gate forever. Any other bind error does mean the link is
 * dead, and stdout is MCP framing, so that one goes to stderr.
 */
function ensurePickerServer({ port, host = '127.0.0.1' } = {}) {
  // A privileged port cannot be bound by the process running Konoha, so trying
  // only produces an EACCES the caller cannot act on.
  if (!Number.isInteger(port) || port < 0 || (port > 0 && port < 1024)) return null;
  const key = `${host}:${port}`;
  const existing = servers.get(key);
  if (existing) return existing;
  ensureSessionToken();
  const server = http.createServer(handleRequest);
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') process.stderr.write(`[konoha picker] cannot serve ${host}:${port}: ${err.message}\n`);
  });
  // Never hold the MCP process open: the gate is answered by a tool call, not
  // by this listener, so an idle picker must not delay shutdown.
  server.unref();
  server.listen(port, host);
  servers.set(key, server);
  return server;
}

module.exports = { ensurePickerServer };
