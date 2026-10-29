'use strict';

const sdlcManager = require('../../workflow/kage-reviewer/sdlc_manager');
const {
  sendJson,
  parseBody,
  isClientConfigured
} = require('./common');

function _handleListTasks(res, parsedUrl) {
  try {
    const status = parsedUrl.searchParams.get('status') || null;
    const project = parsedUrl.searchParams.get('project') || null;
    const limitParam = parseInt(parsedUrl.searchParams.get('limit'), 10);
    const tasks = sdlcManager.listTasks({
      projectPath: project,
      status,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50
    });
    return sendJson(res, 200, { tasks, count: tasks.length });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleGetTask(res, pathname) {
  try {
    const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
    const taskId = decodeURIComponent(pathname.slice(prefix.length));
    if (!taskId) return sendJson(res, 400, { error: 'SDLC task id is required.' });
    const task = sdlcManager.getTask(taskId);
    if (!task) return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
    return sendJson(res, 200, { task });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleDeleteTasks(res, parsedUrl, broadcastEvent) {
  try {
    const all = parsedUrl.searchParams.get('all') === 'true';
    const status = parsedUrl.searchParams.get('status') || null;
    const project = parsedUrl.searchParams.get('project') || null;
    const session = parsedUrl.searchParams.get('session') || null;
    const result = sdlcManager.deleteTasks({ projectPath: project, sessionId: session, status, all });
    broadcastEvent('sdlc_tasks_updated', { action: 'delete_many', ...result });
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleDeleteSingleTask(res, pathname, broadcastEvent) {
  try {
    const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
    const taskId = decodeURIComponent(pathname.slice(prefix.length));
    if (!taskId) return sendJson(res, 400, { error: 'SDLC task id is required.' });
    const deleted = sdlcManager.deleteTask(taskId);
    if (!deleted) return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
    broadcastEvent('sdlc_tasks_updated', { action: 'delete', id: taskId });
    return sendJson(res, 200, { ok: true, id: taskId });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleCheckReadiness(req, res) {
  try {
    const body = await parseBody(req);
    const taskText = (body.task || body.description || '').trim();
    if (!taskText) return sendJson(res, 400, { error: 'Task text is required for a readiness check.' });
    const projectPath = body.project_path || body.projectPath || process.cwd();
    const dor = sdlcManager.checkReadiness(taskText, projectPath);
    return sendJson(res, 200, { ...dor, project_path: projectPath });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleRestartTask(res, pathname, broadcastEvent) {
  try {
    const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
    const taskId = decodeURIComponent(pathname.slice(prefix.length).replace(/\/restart$/, ''));
    if (!taskId) return sendJson(res, 400, { error: 'SDLC task id is required.' });
    const task = sdlcManager.restartTask(taskId);
    if (!task) return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
    broadcastEvent('sdlc_tasks_updated', { action: 'restart', taskId });
    return sendJson(res, 200, { ok: true, task });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleSdlcConfig(req, res, method, parsedUrl, broadcastEvent) {
  if (method === 'GET') {
    try {
      const projectPath = parsedUrl.searchParams.get('project') || process.cwd();
      const config = sdlcManager.getProjectSdlcConfig(projectPath);
      return sendJson(res, 200, { project_path: projectPath, ...config });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  try {
    const body = await parseBody(req);
    const projectPath = body.project_path || body.projectPath || process.cwd();
    let hitlMode = body.hitl_mode !== undefined ? body.hitl_mode : null;
    if (hitlMode === null && body.mode !== undefined) {
      const mv = String(body.mode).toLowerCase();
      if (mv === 'yolo' || mv === 'autonomous' || mv === 'disabled') hitlMode = 'disabled';
      else if (mv === 'hitl' || mv === 'safe' || mv === 'enabled') hitlMode = 'enabled';
    }
    const config = sdlcManager.setProjectSdlcConfig(projectPath, {
      dor_mode: body.dor_mode !== undefined ? body.dor_mode : null,
      review_mode: body.review_mode !== undefined ? body.review_mode : null,
      hitl_mode: hitlMode
    });
    broadcastEvent('sdlc_config_updated', { project_path: projectPath, ...config });
    return sendJson(res, 200, { project_path: projectPath, ...config });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _executeClientSetup(clientName) {
  if (clientName === 'antigravity') require('../../antigravity_manager').ensureAntigravitySetup({ silent: true });
  if (clientName === 'cursor') require('../../cursor_manager').ensureCursorSetup({ silent: true });
  if (clientName === 'claude') require('../../mcp_clients_manager').ensureClaudeCodeSetup({ silent: true });
  if (clientName === 'commandcode') require('../../mcp_clients_manager').ensureCommandCodeSetup({ silent: true });
  if (clientName === 'opencode') require('../../opencode_manager').ensureOpenCodeSetup({ silent: true });
  if (clientName === 'codex') require('../../codex_manager').ensureCodexSetup({ silent: true });
  if (clientName === 'pi') require('../../pi_manager').ensurePiSetup({ silent: true });
  if (clientName === 'omp') require('../../omp_manager').ensureOmpSetup({ silent: true });
}

function _executeClientRemove(clientName) {
  if (clientName === 'antigravity') require('../../antigravity_manager').removeAntigravityConfig(true);
  if (clientName === 'cursor') require('../../cursor_manager').removeCursorConfig(true);
  if (clientName === 'claude') require('../../mcp_clients_manager').removeClaudeCodeConfig(true);
  if (clientName === 'commandcode') require('../../mcp_clients_manager').removeCommandCodeConfig(true);
  if (clientName === 'opencode') require('../../opencode_manager').removeOpenCodeConfig(true);
  if (clientName === 'codex') require('../../codex_manager').removeCodexConfig(true);
  if (clientName === 'pi') require('../../pi_manager').removePiMcp(true);
  if (clientName === 'omp') require('../../omp_manager').removeOmpConfig(true);
}

function _handleClients(res, pathname, method, broadcastEvent) {
  if (method === 'GET') {
    const clientsList = [
      { id: 'antigravity', name: 'Antigravity IDE / CLI', configPath: '~/.gemini/config/mcp_config.json', configured: isClientConfigured('antigravity') },
      { id: 'cursor', name: 'Cursor IDE / CLI', configPath: '~/.cursor/mcp.json', configured: isClientConfigured('cursor') },
      { id: 'claude', name: 'Claude Code CLI', configPath: '~/.claude.json', configured: isClientConfigured('claude') },
      { id: 'opencode', name: 'OpenCode IDE', configPath: '~/.config/opencode/opencode.json', configured: isClientConfigured('opencode') },
      { id: 'commandcode', name: 'Command Code CLI', configPath: '~/.commandcode/mcp.json', configured: isClientConfigured('commandcode') },
      { id: 'codex', name: 'Codex IDE / CLI', configPath: '~/.codex/config.toml', configured: isClientConfigured('codex') },
      { id: 'pi', name: 'Pi (pi.dev)', configPath: '~/.pi/agent/mcp.json', configured: isClientConfigured('pi') },
      { id: 'omp', name: 'OMP Agent', configPath: '~/.omp/agent/mcp.json', configured: isClientConfigured('omp') }
    ];
    return sendJson(res, 200, clientsList);
  }
  const isSetup = pathname.endsWith('/setup');
  const clientName = pathname.split('/')[4];
  try {
    if (isSetup) _executeClientSetup(clientName);
    else _executeClientRemove(clientName);
    broadcastEvent('clients_updated', { client: clientName, action: isSetup ? 'setup' : 'remove' });
    return sendJson(res, 200, { ok: true, client: clientName });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function handleSdlcRoutes(req, res, ctx, parsedUrl, ...rest) {
  const [pathname, method] = rest;
  const { broadcastEvent } = ctx;

  if (method === 'GET' && (pathname === '/api/v1/sdlc/tasks' || pathname === '/api/v1/tasks')) {
    return _handleListTasks(res, parsedUrl);
  }
  if (method === 'GET' && (pathname.startsWith('/api/v1/sdlc/tasks/') || pathname.startsWith('/api/v1/tasks/'))) {
    return _handleGetTask(res, pathname);
  }
  if (method === 'DELETE' && (pathname === '/api/v1/sdlc/tasks' || pathname === '/api/v1/sdlc/tasks/' || pathname === '/api/v1/tasks' || pathname === '/api/v1/tasks/')) {
    return _handleDeleteTasks(res, parsedUrl, broadcastEvent);
  }
  if (method === 'DELETE' && (pathname.startsWith('/api/v1/sdlc/tasks/') || pathname.startsWith('/api/v1/tasks/'))) {
    return _handleDeleteSingleTask(res, pathname, broadcastEvent);
  }
  if (method === 'POST' && pathname === '/api/v1/sdlc/check-readiness') {
    return await _handleCheckReadiness(req, res);
  }
  if (method === 'POST' && (pathname === '/api/v1/sdlc/tasks/reconcile' || pathname === '/api/v1/tasks/reconcile')) {
    try {
      const result = sdlcManager.reconcileStaleTasks();
      broadcastEvent('sdlc_tasks_updated', { action: 'reconcile', ...result });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'POST' && (pathname.startsWith('/api/v1/sdlc/tasks/') || pathname.startsWith('/api/v1/tasks/')) && pathname.endsWith('/restart')) {
    return _handleRestartTask(res, pathname, broadcastEvent);
  }
  if (pathname === '/api/v1/sdlc/config') {
    return await _handleSdlcConfig(req, res, method, parsedUrl, broadcastEvent);
  }
  if (pathname === '/api/v1/clients' || (pathname.startsWith('/api/v1/clients/') && (pathname.endsWith('/setup') || pathname.endsWith('/remove')))) {
    return _handleClients(res, pathname, method, broadcastEvent);
  }
  return false;
}

module.exports = {
  handleSdlcRoutes
};
