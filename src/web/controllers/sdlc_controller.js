'use strict';

const sdlcManager = require('../../sdlc_manager');
const {
  sendJson,
  parseBody,
  isClientConfigured
} = require('./common');

async function handleSdlcRoutes(req, res, ctx, parsedUrl, pathname, method) {
  const { broadcastEvent } = ctx;

  if (method === 'GET' && (pathname === '/api/v1/sdlc/tasks' || pathname === '/api/v1/tasks')) {
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

  if (method === 'GET' && (pathname.startsWith('/api/v1/sdlc/tasks/') || pathname.startsWith('/api/v1/tasks/'))) {
    try {
      const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
      const taskId = decodeURIComponent(pathname.slice(prefix.length));
      if (!taskId) {
        return sendJson(res, 400, { error: 'SDLC task id is required.' });
      }
      const task = sdlcManager.getTask(taskId);
      if (!task) {
        return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
      }
      return sendJson(res, 200, { task });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'DELETE' && (pathname === '/api/v1/sdlc/tasks' || pathname === '/api/v1/sdlc/tasks/' || pathname === '/api/v1/tasks' || pathname === '/api/v1/tasks/')) {
    try {
      const all = parsedUrl.searchParams.get('all') === 'true';
      const status = parsedUrl.searchParams.get('status') || null;
      const project = parsedUrl.searchParams.get('project') || null;
      const session = parsedUrl.searchParams.get('session') || null;
      const result = sdlcManager.deleteTasks({
        projectPath: project,
        sessionId: session,
        status,
        all
      });
      broadcastEvent('sdlc_tasks_updated', { action: 'delete_many', ...result });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'DELETE' && (pathname.startsWith('/api/v1/sdlc/tasks/') || pathname.startsWith('/api/v1/tasks/'))) {
    try {
      const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
      const taskId = decodeURIComponent(pathname.slice(prefix.length));
      if (!taskId) {
        return sendJson(res, 400, { error: 'SDLC task id is required.' });
      }
      const deleted = sdlcManager.deleteTask(taskId);
      if (!deleted) {
        return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
      }
      broadcastEvent('sdlc_tasks_updated', { action: 'delete', id: taskId });
      return sendJson(res, 200, { ok: true, id: taskId });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/sdlc/check-readiness') {
    try {
      const body = await parseBody(req);
      const taskText = (body.task || body.description || '').trim();
      if (!taskText) {
        return sendJson(res, 400, { error: 'Task text is required for a readiness check.' });
      }
      const projectPath = body.project_path || body.projectPath || process.cwd();
      const dor = sdlcManager.checkReadiness(taskText, projectPath);
      return sendJson(res, 200, { ...dor, project_path: projectPath });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
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
    try {
      const prefix = pathname.startsWith('/api/v1/sdlc/tasks/') ? '/api/v1/sdlc/tasks/' : '/api/v1/tasks/';
      const taskId = decodeURIComponent(pathname.slice(prefix.length).replace(/\/restart$/, ''));
      if (!taskId) {
        return sendJson(res, 400, { error: 'SDLC task id is required.' });
      }
      const task = sdlcManager.restartTask(taskId);
      if (!task) {
        return sendJson(res, 404, { error: `SDLC task '${taskId}' not found.` });
      }
      broadcastEvent('sdlc_tasks_updated', { action: 'restart', taskId });
      return sendJson(res, 200, { ok: true, task });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/v1/sdlc/config') {
    try {
      const projectPath = parsedUrl.searchParams.get('project') || process.cwd();
      const config = sdlcManager.getProjectSdlcConfig(projectPath);
      return sendJson(res, 200, { project_path: projectPath, ...config });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if ((method === 'PATCH' || method === 'POST') && pathname === '/api/v1/sdlc/config') {
    try {
      const body = await parseBody(req);
      const projectPath = body.project_path || body.projectPath || process.cwd();
      const config = sdlcManager.setProjectSdlcConfig(projectPath, {
        dor_mode: body.dor_mode !== undefined ? body.dor_mode : null,
        review_mode: body.review_mode !== undefined ? body.review_mode : null,
        hitl_mode: body.hitl_mode !== undefined ? body.hitl_mode : null
      });
      broadcastEvent('sdlc_config_updated', { project_path: projectPath, ...config });
      return sendJson(res, 200, { project_path: projectPath, ...config });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/v1/clients') {
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

  if (method === 'POST' && pathname.startsWith('/api/v1/clients/') && pathname.endsWith('/setup')) {
    const clientName = pathname.split('/')[4];
    try {
      if (clientName === 'antigravity') require('../../antigravity_manager').ensureAntigravitySetup({ silent: true });
      if (clientName === 'cursor') require('../../cursor_manager').ensureCursorSetup({ silent: true });
      if (clientName === 'claude') require('../../mcp_clients_manager').ensureClaudeCodeSetup({ silent: true });
      if (clientName === 'commandcode') require('../../mcp_clients_manager').ensureCommandCodeSetup({ silent: true });
      if (clientName === 'opencode') require('../../opencode_manager').ensureOpenCodeSetup({ silent: true });
      if (clientName === 'codex') require('../../codex_manager').ensureCodexSetup({ silent: true });
      if (clientName === 'pi') require('../../pi_manager').ensurePiSetup({ silent: true });
      if (clientName === 'omp') require('../../omp_manager').ensureOmpSetup({ silent: true });
      broadcastEvent('clients_updated', { client: clientName, action: 'setup' });
      return sendJson(res, 200, { ok: true, client: clientName });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname.startsWith('/api/v1/clients/') && pathname.endsWith('/remove')) {
    const clientName = pathname.split('/')[4];
    try {
      if (clientName === 'antigravity') require('../../antigravity_manager').removeAntigravityConfig(true);
      if (clientName === 'cursor') require('../../cursor_manager').removeCursorConfig(true);
      if (clientName === 'claude') require('../../mcp_clients_manager').removeClaudeCodeConfig(true);
      if (clientName === 'commandcode') require('../../mcp_clients_manager').removeCommandCodeConfig(true);
      if (clientName === 'opencode') require('../../opencode_manager').removeOpenCodeConfig(true);
      if (clientName === 'codex') require('../../codex_manager').removeCodexConfig(true);
      if (clientName === 'pi') require('../../pi_manager').removePiMcp(true);
      if (clientName === 'omp') require('../../omp_manager').removeOmpConfig(true);
      broadcastEvent('clients_updated', { client: clientName, action: 'remove' });
      return sendJson(res, 200, { ok: true, client: clientName });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  return false;
}

module.exports = {
  handleSdlcRoutes
};
