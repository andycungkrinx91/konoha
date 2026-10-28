'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../db');
const {
  sendJson,
  parseBody,
  isDeleteConfirmed
} = require('./common');

async function _handleVectorRoutes(res, pathname, method, parsedUrl, broadcastEvent) {
  if (method === 'GET' && pathname === '/api/v1/vectors/stats') {
    try {
      const conn = db.getConnection(null, false);
      const totalChunks = conn.prepare('SELECT count(*) as c FROM skill_chunks').get().c;
      const totalEmbedded = conn.prepare('SELECT count(*) as c FROM skill_chunks WHERE embedding IS NOT NULL').get().c;
      const skillsCount = conn.prepare('SELECT count(DISTINCT skill_name) as c FROM skill_chunks').get().c;
      conn.close();
      return sendJson(res, 200, {
        model: 'IBM Granite Multilingual (384-dim)',
        dimension: 384,
        total_chunks: totalChunks,
        embedded_chunks: totalEmbedded,
        vectorized_skills: skillsCount,
        reranker: 'Neural Cross-Encoder (MS MARCO MiniLM) + Reciprocal Rank Fusion (RRF, k=60)'
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && (pathname === '/api/v1/skills/reembed' || pathname === '/api/v1/vectors/reembed')) {
    try {
      const vectorSearch = require('../../vector_search');
      const conn = db.getConnection(null, false);
      try {
        const force = parsedUrl.searchParams.get('force') !== '0';
        const chunks = await vectorSearch.backfillAllEmbeddings(conn, force);
        broadcastEvent('skills_updated', { action: 'reembed', chunks });
        return sendJson(res, 200, {
          ok: true,
          vectorized_chunks: chunks,
          message: `Neural vector embedding successfully completed for ${chunks} chunks.`
        });
      } finally {
        conn.close();
      }
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  return false;
}

async function _handleGetSkills(res, parsedUrl) {
  const q = (parsedUrl.searchParams.get('q') || '').trim();
  const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
  try {
    const conn = db.getConnection(null, false);
    try {
      const vectorSearch = require('../../vector_search');
      if (q) {
        return sendJson(res, 200, await vectorSearch.findSkillHybrid(conn, q, { topK: limit }));
      }
      const allRows = conn.prepare(
        'SELECT name, skill_name, type, tags, byte_size, line_count FROM skills ORDER BY name ASC LIMIT ?'
      ).all(limit);
      return sendJson(res, 200, allRows.map(r => ({ ...r, engine: 'all', score: 1.0, similarity: null })));
    } finally {
      conn.close();
    }
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleInstallSkill(req, res, broadcastEvent) {
  try {
    const body = await parseBody(req);
    let repoUrl = (body.repo_url || body.repoUrl || '').trim();
    const skillName = (body.skill_name || body.skillName || body.name || '').trim();
    const nameOrUrl = (body.name_or_url || repoUrl || skillName || '').trim();

    if (!nameOrUrl) return sendJson(res, 400, { error: 'Missing skill name or repository URL.' });

    if (repoUrl && !repoUrl.startsWith('https://') && !repoUrl.startsWith('git@') && !repoUrl.startsWith('http://') && !repoUrl.startsWith('file://')) {
      if (repoUrl.includes('/') && !repoUrl.includes(' ')) repoUrl = `https://github.com/${repoUrl}`;
    }

    const skillManager = require('../../skill_manager');
    const installedPath = (repoUrl && skillName)
      ? await skillManager.addSkillDirect(repoUrl, skillName)
      : await skillManager.addSkill(nameOrUrl, skillName || undefined);

    broadcastEvent('skills_updated', { action: 'install', name: skillName || nameOrUrl });
    return sendJson(res, 200, { ok: true, skill_name: skillName || nameOrUrl, installed_path: installedPath || null });
  } catch (err) {
    const isGuardianBlock = err.message?.includes('BLOCKED by Guardian');
    return sendJson(res, isGuardianBlock ? 422 : 500, { ok: false, error: err.message, guardian_blocked: isGuardianBlock });
  }
}

function _writeNewSkillFile(name, description, tags, content) {
  const tagsList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  let fullContent = '---\n' + `name: ${name}\n` + `description: ${description}\n`;
  if (tagsList.length > 0) {
    fullContent += 'tags:\n' + tagsList.map(t => `  - ${t}\n`).join('');
  }
  fullContent += '---\n\n' + `# ${name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}\n\n` + (content || `${description}\n`);

  const projectSkillsDir = path.resolve(__dirname, '..', '..', '..', '.agents', 'skills', name);
  const globalSkillsDir = path.join(os.homedir(), '.agents', 'skills', name);
  const targetDir = fs.existsSync(path.resolve(__dirname, '..', '..', '..', '.agents', 'skills')) ? projectSkillsDir : globalSkillsDir;

  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(targetFile, fullContent, 'utf8');
  return { targetDir, targetFile };
}

async function _handleCreateSkill(req, res, broadcastEvent) {
  try {
    const body = await parseBody(req);
    const name = (body.name || '').trim().toLowerCase();
    const description = (body.description || '').trim();
    if (!name || !/^[a-z0-9_-]+$/.test(name)) {
      return sendJson(res, 400, { error: 'Invalid skill name. Only lowercase letters, numbers, hyphens, and underscores are allowed.' });
    }
    if (!description) return sendJson(res, 400, { error: 'Skill description is required.' });

    const { targetDir, targetFile } = _writeNewSkillFile(name, description, (body.tags || '').trim(), (body.content || '').trim());

    const migrate = require('../../migrate');
    const conn = db.getConnection(null, false);
    const migrated = migrate.migrateSkill(conn, name, false, path.dirname(targetDir));
    conn.close();

    let embedded = false;
    const embedAgent = (body.embed_agent || body.embedAgent || '').trim();
    if (embedAgent) {
      try {
        const skillManager = require('../../skill_manager');
        embedded = skillManager.embedSkillInAgent(name, embedAgent);
      } catch (_) { /* ignore */ }
    }

    broadcastEvent('skills_updated', { action: 'create', name });
    return sendJson(res, 201, { ok: true, name, file_path: targetFile, migrated: migrated > 0, embedded_in: embedded ? embedAgent : null });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleEmbedSkillInAgent(req, res, pathname, broadcastEvent) {
  try {
    const isEmbed = pathname.endsWith('/embed');
    const skillName = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseBody(req);
    const agentName = (body.agent || body.agent_name || '').trim();
    if (!agentName) return sendJson(res, 400, { error: 'Agent name is required' });

    const skillManager = require('../../skill_manager');
    const result = isEmbed ? skillManager.embedSkillInAgent(skillName, agentName) : skillManager.unembedSkillFromAgent(skillName, agentName);
    broadcastEvent('skills_updated', { action: isEmbed ? 'embed' : 'unembed', skill: skillName, agent: agentName });
    return sendJson(res, 200, { ok: true, skill: skillName, agent: agentName, [isEmbed ? 'embedded' : 'unembedded']: result });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _parseSkillChunks(conn, skillName) {
  try {
    const chunkRows = conn.prepare('SELECT id, chunk_index, chunk_text, embedding FROM skill_chunks WHERE skill_name = ? ORDER BY chunk_index ASC').all(skillName);
    return chunkRows.map(c => {
      let vectorSample = [];
      if (c.embedding && c.embedding.length >= 20) {
        const f32 = new Float32Array(c.embedding.buffer, c.embedding.byteOffset, Math.min(8, Math.floor(c.embedding.byteLength / 4)));
        vectorSample = Array.from(f32).map(v => Number(v.toFixed(4)));
      }
      return {
        id: c.id, chunk_index: c.chunk_index, chunk_text: c.chunk_text,
        has_embedding: Boolean(c.embedding), embedding_dim: c.embedding ? Math.floor(c.embedding.byteLength / 4) : 0,
        vector_sample: vectorSample
      };
    });
  } catch (_) {
    return [];
  }
}

function _handleGetSingleSkill(res, pathname) {
  const skillName = decodeURIComponent(pathname.slice('/api/v1/skills/'.length));
  try {
    const conn = db.getConnection(null, false);
    const skill = conn.prepare('SELECT * FROM skills WHERE name = ?').get(skillName);
    if (!skill) {
      conn.close();
      return sendJson(res, 404, { error: 'Skill not found' });
    }
    skill.chunks = _parseSkillChunks(conn, skillName);
    skill.chunks_count = skill.chunks.length;
    conn.close();
    return sendJson(res, 200, skill);
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function _handleDeleteSingleSkill(res, pathname, broadcastEvent) {
  try {
    const skillName = decodeURIComponent(pathname.slice('/api/v1/skills/'.length));
    const skillManager = require('../../skill_manager');
    try { skillManager.removeSkill(skillName); } catch (_) { /* ignore */ }
    const conn = db.getConnection(null, false);
    conn.prepare('DELETE FROM skill_chunks WHERE skill_name = ?').run(skillName);
    conn.prepare('DELETE FROM skills WHERE name = ? OR skill_name = ?').run(skillName, skillName);
    conn.close();
    broadcastEvent('skills_updated', { action: 'delete', name: skillName });
    return sendJson(res, 200, { ok: true, name: skillName });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleSkillRoutes(req, res, route, broadcastEvent) {
  const { pathname, method, parsedUrl } = route;
  if (method === 'GET' && pathname === '/api/v1/skills') {
    return await _handleGetSkills(res, parsedUrl);
  }
  if (method === 'GET' && pathname === '/api/v1/skills/registry') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q) return sendJson(res, 200, { results: [] });
    try {
      const skillManager = require('../../skill_manager');
      const results = await skillManager.searchRegistry(q);
      return sendJson(res, 200, { results: Array.isArray(results) ? results : [] });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'POST' && pathname === '/api/v1/skills/install') {
    return await _handleInstallSkill(req, res, broadcastEvent);
  }
  if (method === 'POST' && pathname === '/api/v1/skills') {
    return await _handleCreateSkill(req, res, broadcastEvent);
  }
  if (method === 'POST' && pathname === '/api/v1/skills/reindex') {
    try {
      const { spawnSync } = require('child_process');
      const cliPath = path.join(__dirname, '..', '..', '..', 'bin', 'cli.js');
      const run = spawnSync(process.execPath || 'node', [cliPath, 'migrate'], { encoding: 'utf8', windowsHide: true });
      broadcastEvent('skills_updated', { action: 'reindex' });
      return sendJson(res, 200, { ok: true, output: (run.stdout || '').trim() });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }
  if (method === 'POST' && pathname.startsWith('/api/v1/skills/') && (pathname.endsWith('/embed') || pathname.endsWith('/unembed'))) {
    return await _handleEmbedSkillInAgent(req, res, pathname, broadcastEvent);
  }
  if (method === 'GET' && pathname.startsWith('/api/v1/skills/')) {
    return _handleGetSingleSkill(res, pathname);
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/skills/')) {
    return _handleDeleteSingleSkill(res, pathname, broadcastEvent);
  }
  return false;
}

function _handleGetSoul(res, parsedUrl) {
  try {
    const personaMemory = require('../../persona_memory');
    const agentFilter = parsedUrl.searchParams.get('agent') || null;
    const raw = parsedUrl.searchParams.get('raw') === 'true';
    const projectPath = parsedUrl.searchParams.get('project') || null;
    const soul = personaMemory.getSoul({ agentName: agentFilter, projectPath, raw });
    if (raw) {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(soul.raw_markdown || '');
      return;
    }
    return sendJson(res, 200, { ok: true, soul });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handlePersonaRoutes(req, res, route, broadcastEvent) {
  const { pathname, method, parsedUrl } = route;
  if (method === 'GET' && pathname === '/api/v1/soul') return _handleGetSoul(res, parsedUrl);

  const personaMemory = require('../../persona_memory');
  if (method === 'GET' && pathname === '/api/v1/persona') {
    try {
      const agentFilter = parsedUrl.searchParams.get('agent') || null;
      const memoryType = parsedUrl.searchParams.get('type') || null;
      const search = parsedUrl.searchParams.get('search') || null;
      const projectPath = parsedUrl.searchParams.get('projectPath') || parsedUrl.searchParams.get('project_path') || null;
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
      const memories = search
        ? personaMemory.queryMemories({ agentName: agentFilter || 'global', query: search, memoryType: memoryType || undefined, projectPath, allSessions: true, limit })
        : personaMemory.listMemories({ agentName: agentFilter, memoryType: memoryType || undefined, projectPath, allSessions: true, limit });
      return sendJson(res, 200, { memories: memories || [], total: (memories || []).length });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/persona') {
    try {
      const body = await parseBody(req);
      if (!body.agentName || !body.content) return sendJson(res, 400, { error: 'Missing required fields: agentName, content' });
      const id = personaMemory.saveMemory({ agentName: body.agentName, content: body.content, title: body.title || '', memoryType: body.memoryType || 'rule', tags: body.tags || '', importance: parseInt(body.importance || 1, 10), projectPath: body.projectPath || null });
      broadcastEvent('persona_updated', { action: 'create', id, agent: body.agentName });
      return sendJson(res, 201, { id, ok: true });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/persona/')) {
    try {
      const memId = pathname.split('/')[4];
      personaMemory.deleteMemory(memId);
      broadcastEvent('persona_updated', { action: 'delete', id: memId });
      return sendJson(res, 200, { ok: true, id: memId });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && pathname === '/api/v1/persona/prune') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const resPrune = personaMemory.pruneMemories(body);
      broadcastEvent('persona_updated', { action: 'prune', ...resPrune });
      return sendJson(res, 200, { ok: true, ...resPrune });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

function _processWorkspaceRow(r, workspaceMap, personaMemory) {
  let pRoot = r.workspace_root;
  if (!pRoot || typeof pRoot !== 'string') return;
  try { pRoot = path.resolve(path.normalize(pRoot)); } catch (_) { /* ignore */ }
  const normKey = process.platform === 'win32' ? pRoot.toLowerCase() : pRoot;
  const clientName = (r.client || 'generic').toLowerCase();

  if (!workspaceMap.has(normKey)) {
    let prof = personaMemory.getProjectProfile(pRoot);
    if (!prof && fs.existsSync(pRoot)) {
      const pHash = personaMemory.saveOrUpdateProject(pRoot, '', null);
      prof = personaMemory.getProjectProfile(pHash);
    }
    workspaceMap.set(normKey, {
      workspace_root: pRoot,
      project_name: prof?.project_name || path.basename(pRoot),
      project_hash: prof?.project_hash || '',
      framework: prof?.framework || 'General',
      styling: prof?.styling || 'CSS',
      package_manager: prof?.package_manager || 'pnpm',
      last_active_at: r.last_active_at,
      clients: [clientName],
      client: clientName
    });
  } else {
    const existing = workspaceMap.get(normKey);
    if (!existing.clients.includes(clientName)) existing.clients.push(clientName);
    if (new Date(r.last_active_at) > new Date(existing.last_active_at)) {
      existing.last_active_at = r.last_active_at;
    }
    existing.client = existing.clients.join(', ');
  }
}

function _collectActiveWorkspaces(personaMemory) {
  const activeWorkspaces = [];
  try {
    const conn = db.getConnection();
    try {
      const rows = conn.prepare(`
        SELECT client, workspace_root, MAX(last_active_at) AS last_active_at
        FROM active_sessions
        WHERE workspace_root IS NOT NULL AND workspace_root != 'unknown' AND workspace_root != ''
        GROUP BY client, workspace_root
        ORDER BY last_active_at DESC
        LIMIT 25
      `).all();
      const workspaceMap = new Map();
      for (const r of rows) _processWorkspaceRow(r, workspaceMap, personaMemory);
      activeWorkspaces.push(...workspaceMap.values());
    } finally {
      conn.close();
    }
  } catch (_) { /* ignore */ }
  return activeWorkspaces;
}

function _resolveTargetProjectPath(initialPath, activeWorkspaces) {
  if (initialPath?.trim()) return initialPath;
  if (activeWorkspaces.length > 0) return activeWorkspaces[0].workspace_root;
  try {
    const wsRoot = require('../../mcp/runtime_state').getWorkspaceRoot();
    if (wsRoot && fs.existsSync(wsRoot)) return wsRoot;
  } catch (_) { /* ignore */ }
  return process.cwd();
}

function _handleGetActiveProjects(res, parsedUrl) {
  try {
    const personaMemory = require('../../persona_memory');
    const activeWorkspaces = _collectActiveWorkspaces(personaMemory);
    const targetPath = _resolveTargetProjectPath(parsedUrl.searchParams.get('path'), activeWorkspaces);

    let profile = personaMemory.getProjectProfile(targetPath);
    if (!profile) {
      const pHash = personaMemory.saveOrUpdateProject(targetPath, '', null);
      profile = personaMemory.getProjectProfile(pHash);
    }
    const mems = personaMemory.listMemories({ projectPath: targetPath, allSessions: true, limit: 50 });
    return sendJson(res, 200, { profile: profile || {}, memories: mems || [], active_workspaces: activeWorkspaces });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

async function _handleProjectRoutes(req, res, route, broadcastEvent) {
  const { pathname, method, parsedUrl } = route;
  const personaMemory = require('../../persona_memory');
  if (method === 'GET' && pathname === '/api/v1/projects') {
    try { return sendJson(res, 200, { projects: personaMemory.listProjects(50) || [] }); } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'GET' && (pathname === '/api/v1/projects/current' || pathname === '/api/v1/projects/active')) {
    return _handleGetActiveProjects(res, parsedUrl);
  }
  if (method === 'POST' && pathname === '/api/v1/projects') {
    try {
      const body = await parseBody(req);
      const pPath = body.projectPath || process.cwd();
      const hash = personaMemory.saveOrUpdateProject(pPath, body.contextSummary || '', body.techStack || null);
      broadcastEvent('projects_updated', { action: 'update', hash, path: pPath });
      return sendJson(res, 200, { ok: true, project_hash: hash, project_path: pPath });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/projects/') && pathname.includes('/memories/')) {
    try {
      const parts = pathname.split('/');
      const deleted = personaMemory.deleteMemory(parts[6]);
      broadcastEvent('projects_updated', { action: 'memory_delete', hash: parts[4], memId: parts[6] });
      broadcastEvent('persona_updated', { action: 'delete', id: parts[6] });
      return sendJson(res, 200, { ok: true, deleted, id: parts[6], project_hash: parts[4] });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'POST' && ((pathname.startsWith('/api/v1/projects/') && pathname.endsWith('/prune')) || pathname === '/api/v1/projects/prune')) {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const parts = pathname.split('/');
      const projectHash = (pathname !== '/api/v1/projects/prune') ? parts[4] : (body.projectHash || body.projectPath || process.cwd());
      const result = personaMemory.pruneProjectMemories(projectHash, body);
      broadcastEvent('projects_updated', { action: 'prune', ...result });
      broadcastEvent('persona_updated', { action: 'prune', ...result });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'DELETE' && (pathname === '/api/v1/projects' || pathname === '/api/v1/projects/')) {
    try {
      if (!(await isDeleteConfirmed(req, parsedUrl))) return sendJson(res, 400, { error: 'Confirmation required: body must contain { confirm: true } to delete all projects' });
      const result = personaMemory.pruneAllProjects({ keepCurrent: parsedUrl.searchParams.get('keepCurrent') === 'true', currentHash: parsedUrl.searchParams.get('currentHash') || '' });
      broadcastEvent('projects_updated', { action: 'prune_all', ...result });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  if (method === 'DELETE' && pathname.startsWith('/api/v1/projects/')) {
    try {
      if (!(await isDeleteConfirmed(req, parsedUrl))) return sendJson(res, 400, { error: 'Confirmation required: request must provide ?confirm=true or body { confirm: true } to delete project' });
      const hash = pathname.split('/')[4];
      personaMemory.deleteProject(hash);
      broadcastEvent('projects_updated', { action: 'delete', hash });
      return sendJson(res, 200, { ok: true, hash });
    } catch (err) { return sendJson(res, 500, { error: err.message }); }
  }
  return false;
}

async function handleSkillsRoutes(req, res, ctx, parsedUrl, ...rest) {
  const [pathname, method] = rest;
  const { broadcastEvent } = ctx;

  const vectorRes = await _handleVectorRoutes(res, pathname, method, parsedUrl, broadcastEvent);
  if (vectorRes !== false) return vectorRes;

  const route = { pathname, method, parsedUrl };

  const skillRes = await _handleSkillRoutes(req, res, route, broadcastEvent);
  if (skillRes !== false) return skillRes;

  const personaRes = await _handlePersonaRoutes(req, res, route, broadcastEvent);
  if (personaRes !== false) return personaRes;

  const projectRes = await _handleProjectRoutes(req, res, route, broadcastEvent);
  if (projectRes !== false) return projectRes;

  return false;
}

module.exports = {
  handleSkillsRoutes
};
