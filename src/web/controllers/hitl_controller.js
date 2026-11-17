'use strict';

/**
 * src/web/controllers/hitl_controller.js — Interactive HITL picker over HTTP.
 *
 * Two routes:
 *
 *   GET  /api/v1/hitl/picker?task_dir=…&sig=…  → the picker page for the pending gate
 *   POST /api/v1/hitl/verdict                  → `{ task_dir, choice, refinement, sig }`
 *
 * Both authenticate with a per-gate capability signature — an HMAC of the task
 * directory keyed by the persisted session token — because the human opening a
 * link has no cookie jar, and handing them the master token would put it in
 * every transcript and gate payload. The signature is scoped to one directory,
 * so one gate's URL cannot approve another. Both routes are exempted from the
 * cookie check in `src/web_server.js` for that reason; the check happens here.
 *
 * The verdict path is `runSannin`, the same resume entry every other transport
 * uses, so a click and a typed reply land in exactly one place.
 */

const fs = require('fs');
const path = require('path');
const { buildGate1Prompt, buildGate2Prompt, parseGateChoice } = require('../../mcp/workflow_gates');
const { renderPickerPage, verifyTaskDirSignature, VERDICT_ENDPOINT } = require('../../mcp/hitl_picker');
const { loadWorkflowStatus } = require('../../mcp/workflow_common');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    // The URL carries a capability signature, so nothing may leak it onward.
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function resolveTaskDir(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return null;
  const resolved = path.resolve(raw);
  // A verdict endpoint that accepts any path is a way to make the server read
  // arbitrary workflow state; only directories that actually hold a status file
  // are gates.
  if (!fs.existsSync(path.join(resolved, 'status.json'))) return null;
  return resolved;
}

function _statusFor(taskDir) {
  const loaded = loadWorkflowStatus(taskDir);
  return loaded && typeof loaded === 'object' ? loaded : null;
}

function _pendingPrompt(status, taskDir) {
  const taskId = path.basename(taskDir);
  // The LangGraph nodes record the gate in `hitl_gate` and leave `phase` at the
  // node that raised it (`plan`, `review`), so keying off `phase` alone makes
  // every graph-driven gate answer 409 and the picker never renders.
  const pending = status.hitl_gate || status.status;
  if (pending === 'pending_human_signoff' || status.phase === 'delivery_signoff') {
    return JSON.parse(buildGate2Prompt(status, taskDir, taskId, { confidence: status.confidence || 100, report: status.report }));
  }
  if (pending === 'pending_plan_approval' || status.phase === 'plan_approval') {
    return JSON.parse(buildGate1Prompt(status, taskDir, taskId, status.plan));
  }
  return null;
}

function _gateSecrets(ctx) {
  if (!ctx) return [];
  const grace = ctx.previousTokenExpiresAt && ctx.previousTokenExpiresAt > Date.now();
  return [ctx.sessionToken, grace ? ctx.previousSessionToken : null].filter(Boolean);
}

async function handleHitlRoutes(req, res, ctx, route) {
  const { parsedUrl, pathname, method } = route;
  if (pathname === '/api/v1/hitl/picker' && method === 'GET') {
    const taskDir = resolveTaskDir(parsedUrl.searchParams.get('task_dir'));
    if (!taskDir) { sendJson(res, 404, { error: 'No pending gate for that task directory.' }); return true; }
    if (!verifyTaskDirSignature(taskDir, parsedUrl.searchParams.get('sig'), _gateSecrets(ctx))) {
      sendJson(res, 403, { error: 'Forbidden: the picker link is missing or has a stale signature.' });
      return true;
    }
    const status = _statusFor(taskDir);
    const prompt = status ? _pendingPrompt(status, taskDir) : null;
    if (!prompt) { sendJson(res, 409, { error: 'That task has no pending HITL gate.' }); return true; }
    sendHtml(res, 200, renderPickerPage(prompt.interactive_prompt, { taskDir }));
    return true;
  }

  if (pathname === VERDICT_ENDPOINT && method === 'POST') {
    const body = await readBody(req);
    const taskDir = resolveTaskDir(body.task_dir);
    if (!taskDir) { sendJson(res, 400, { error: 'task_dir must name a task holding a pending gate.' }); return true; }
    if (!verifyTaskDirSignature(taskDir, body.sig, _gateSecrets(ctx))) {
      sendJson(res, 403, { error: 'Forbidden: this verdict was not submitted from a signed picker page.' });
      return true;
    }
    const choice = parseGateChoice(body.choice, body.refinement);
    if (!choice) { sendJson(res, 400, { error: 'choice is required; submit one of the rendered option labels.' }); return true; }

    // `executeTool` is the graph-aware resume: it applies the verdict and runs
    // on until the workflow parks on the next gate or completes. The synchronous
    // `runSannin` only answers with routing metadata, so a click would leave the
    // workflow frozen and the human staring at a stale page.
    const { executeTool } = require('../../mcp/tool_dispatch');
    let payload = {};
    try {
      const raw = await executeTool('sannin', {
        task_dir: taskDir,
        choice: body.choice,
        refinement: body.refinement
      });
      payload = JSON.parse(raw);
    } catch (err) {
      sendJson(res, 500, { error: `Gate verdict failed: ${err.message}` });
      return true;
    }
    sendJson(res, 200, { ok: true, verdict: choice.action, result: payload });
    return true;
  }

  return false;
}

module.exports = { handleHitlRoutes };
