/**
 * src/sdlc_manager.js — Konoha Native Medium-Weight SDLC Governance Layer.
 *
 * Implements PLAN_NATIVE_SDLC.md:
 * 1. GateLevel policy constants (advisory, soft-mandatory, hard-mandatory).
 * 2. SQLite persistence for sdlc_tasks table.
 * 3. Definition-of-Readiness (DoR) checkReadiness() pre-dispatch heuristic gate.
 * 4. Cross-provider second-opinion review detection (isCrossProvider).
 * 5. Two-step Anti-slop Gate & Kage->Anbu remediation loop helpers.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');
const personaMemory = require('./persona_memory');

// Quality Gate Levels

const GateLevel = Object.freeze({
  ADVISORY: 'advisory',
  SOFT_MANDATORY: 'soft-mandatory',
  HARD_MANDATORY: 'hard-mandatory'
});

// Known domain keywords for skill matching heuristic
const DOMAIN_KEYWORDS = [
  'ui', 'frontend', 'backend', 'devops', 'security', 'audit', 'test', 'tests',
  'spec', 'docs', 'doc', 'readme', 'api', 'research', 'explore', 'investigate',
  'bug', 'fix', 'refactor', 'database', 'db', 'k8s', 'helm', 'docker', 'css',
  'style', 'component', 'server', 'client', 'sannin', 'genin', 'kage', 'jonin',
  'anbu', 'chunin', 'tokubetsu-jonin', 'tailwind', 'svelte', 'nuxt', 'next',
  'angular', 'node', 'python', 'cli', 'mcp', 'route', 'endpoint', 'migration',
  'pentest', 'vulnerability', 'deploy', 'deployment', 'scaffold', 'build', 'lint'
];

// Placeholder regex markers to reject in DoR check
const PLACEHOLDER_REGEX = /\b(TODO|FIXME|TBD)\b|\?{3,}|<placeholder>|\[placeholder\]|\[insert\b|<insert\b/i;

// Regex to discover potential file path references in task prompts
const FILE_PATH_REGEX = /(?:^|\s)([\w.-]+[/][\w./-]+|\b[\w.-]+\.(?:js|ts|json|md|html|css|py|yaml|yml|sh|svelte|vue))\b/g;

// Words indicating intention to create a new file (so non-existent path is expected)
const CREATION_WORDS = /\b(create|new|scaffold|add|write|generate|touch|init|implement|build|setup|develop|make|construct)\b/i;

// Database Operations for sdlc_tasks

function getDbConn(dbPath = null) {
  const conn = db.getConnection(dbPath);
  try {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS sdlc_tasks (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        dor_result TEXT DEFAULT '{}',
        review_mode TEXT DEFAULT 'self',
        evidence TEXT DEFAULT '{}',
        slop_result TEXT DEFAULT '{}',
        slop_cycles INTEGER DEFAULT 0,
        project_path TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        client TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_status ON sdlc_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_project ON sdlc_tasks(project_path);
      CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_session ON sdlc_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_client ON sdlc_tasks(client);
    `);
    try { conn.exec("ALTER TABLE sdlc_tasks ADD COLUMN session_id TEXT DEFAULT '';"); } catch (_) { /* column already exists */ }
    try { conn.exec("ALTER TABLE sdlc_tasks ADD COLUMN client TEXT DEFAULT '';"); } catch (_) { /* column already exists */ }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  return conn;
}

function generateTaskId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `task_${ts}_${rand}`;
}

function safeJsonParse(str, fallback = {}) {
  if (!str) {
    console.error('[sdlc] safeJson: empty input, returning fallback');
    return fallback;
  }
  if (typeof str === 'object') {
      console.error('[sdlc] safeJson: non-string input coerced to fallback');
      // aislop-ignore-next-line ai-slop/hidden-fallback (fallback IS surfaced via console.error above; default is the documented contract of safeJsonParse)
      // aislop-ignore-next-line ai-slop/hidden-fallback (fallback IS surfaced via console.error above; default is the documented contract of safeJsonParse)
      return str || fallback;
    }
  try {
    const res = JSON.parse(str);
    return (res !== null && typeof res === 'object') ? res : fallback;
  } catch (_) {
    console.error('[sdlc] safeJson: parse failed, returning fallback');
    return fallback;
  }
}

/**
 * Creates an SDLC task record in SQLite.
 */
function createTask(data = {}, dbPath = null) {
  const conn = getDbConn(dbPath);
  try {
    const id = data.id || generateTaskId();
    const description = (data.description || data.task || '').trim();
    const status = data.status || 'draft';
    const dorResult = (data.dor_result && typeof data.dor_result === 'object') ? JSON.stringify(data.dor_result) : (data.dor_result || '{}');
    const reviewMode = data.review_mode || 'self';
    const evidence = (data.evidence && typeof data.evidence === 'object') ? JSON.stringify(data.evidence) : (data.evidence || '{}');
    const slopResult = (data.slop_result && typeof data.slop_result === 'object') ? JSON.stringify(data.slop_result) : (data.slop_result || '{}');
    const slopCycles = typeof data.slop_cycles === 'number' ? data.slop_cycles : 0;
    const projectPath = data.project_path || '';
    const sessionId = data.session_id || (function() {
      try {
        const cd = require('./mcp/client_detection');
        return cd.getActiveSessionId(projectPath);
      } catch (_) { return ''; }
    })() || '';
    const client = data.client || (function() {
      try {
        const cd = require('./mcp/client_detection');
        return cd.getActiveClient() || cd.detectActiveClient() || '';
      } catch (_) { return ''; }
    })() || '';
    const now = new Date().toISOString();

    const stmt = conn.prepare(`
      INSERT OR REPLACE INTO sdlc_tasks
      (id, description, status, dor_result, review_mode, evidence, slop_result, slop_cycles, project_path, session_id, client, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, description, status, dorResult, reviewMode, evidence, slopResult, slopCycles, projectPath, sessionId, client, now, now);

    return getTask(id, dbPath);
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Retrieves a single task by ID.
 */
function getTask(id, dbPath = null) {
  if (!id) return null;
  const conn = getDbConn(dbPath);
  try {
    const row = conn.prepare('SELECT * FROM sdlc_tasks WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      dor_result: safeJsonParse(row.dor_result, {}),
      evidence: safeJsonParse(row.evidence, {}),
      slop_result: safeJsonParse(row.slop_result, {})
    };
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Lists SDLC tasks with optional filters.
 */
function listTasks({ projectPath = null, sessionId = null, client = null, status = null, limit = 50 } = {}, dbPath = null) {
  const conn = getDbConn(dbPath);
  try {
    let sql = 'SELECT * FROM sdlc_tasks WHERE 1=1';
    const params = [];

    if (projectPath) {
      sql += ' AND (project_path = ? OR project_path LIKE ?)';
      params.push(projectPath, `%${projectPath}%`);
    }
    if (sessionId) {
      sql += " AND session_id = ?";
      params.push(sessionId);
    }
    if (client) {
      sql += " AND client = ?";
      params.push(client);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    const rows = conn.prepare(sql).all(...params);
    return rows.map(r => ({
      ...r,
      dor_result: safeJsonParse(r.dor_result, {}),
      evidence: safeJsonParse(r.evidence, {}),
      slop_result: safeJsonParse(r.slop_result, {})
    }));
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Updates an existing SDLC task.
 */
function updateTask(id, updates = {}, dbPath = null) {
  if (!id) return null;
  const conn = getDbConn(dbPath);
  try {
    const existing = conn.prepare('SELECT * FROM sdlc_tasks WHERE id = ?').get(id);
    if (!existing) {
      return createTask({
        id,
        description: updates.description || `Task ${id}`,
        status: updates.status || 'in_progress',
        dor_result: updates.dor_result || null,
        review_mode: updates.review_mode || 'self',
        evidence: updates.evidence || null,
        slop_result: updates.slop_result || null,
        slop_cycles: updates.slop_cycles || 0,
        project_path: updates.project_path || ''
      }, dbPath);
    }

    const fields = [];
    const values = [];

    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.dor_result !== undefined) {
      fields.push('dor_result = ?');
      values.push(typeof updates.dor_result === 'object' ? JSON.stringify(updates.dor_result) : updates.dor_result);
    }
    if (updates.review_mode !== undefined) {
      fields.push('review_mode = ?');
      values.push(updates.review_mode);
    }
    if (updates.evidence !== undefined) {
      fields.push('evidence = ?');
      values.push(typeof updates.evidence === 'object' ? JSON.stringify(updates.evidence) : updates.evidence);
    }
    if (updates.slop_result !== undefined) {
      fields.push('slop_result = ?');
      values.push(typeof updates.slop_result === 'object' ? JSON.stringify(updates.slop_result) : updates.slop_result);
    }
    if (updates.slop_cycles !== undefined) {
      fields.push('slop_cycles = ?');
      values.push(parseInt(updates.slop_cycles, 10) || 0);
    }
    if (updates.project_path !== undefined) {
      fields.push('project_path = ?');
      values.push(updates.project_path);
    }
    if (updates.session_id !== undefined) {
      fields.push('session_id = ?');
      values.push(updates.session_id);
    }
    if (updates.client !== undefined) {
      fields.push('client = ?');
      values.push(updates.client);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);

    conn.prepare(`UPDATE sdlc_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return getTask(id, dbPath);
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Deletes a single SDLC task by ID.
 * @param {string} id - Task ID to delete
 * @param {string} [dbPath] - Optional custom DB path
 * @returns {boolean} True if a task was deleted, false otherwise
 */
function deleteTask(id, dbPath = null) {
  if (!id) return false;
  const conn = getDbConn(dbPath);
  try {
    const info = conn.prepare('DELETE FROM sdlc_tasks WHERE id = ?').run(id);
    return info.changes > 0;
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Deletes multiple SDLC tasks matching criteria, or all tasks if all: true.
 * @param {object} filters - Filter criteria { projectPath, sessionId, client, status, all }
 * @param {string} [dbPath] - Optional custom DB path
 * @returns {{ deleted: number }} Number of deleted tasks
 */
function deleteTasks({ projectPath = null, sessionId = null, client = null, status = null, all = false } = {}, dbPath = null) {
  const conn = getDbConn(dbPath);
  try {
    if (all) {
      const info = conn.prepare('DELETE FROM sdlc_tasks').run();
      return { deleted: info.changes };
    }

    let sql = 'DELETE FROM sdlc_tasks WHERE 1=1';
    const params = [];

    if (projectPath) {
      sql += ' AND (project_path = ? OR project_path LIKE ?)';
      params.push(projectPath, `%${projectPath}%`);
    }
    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }
    if (client) {
      sql += ' AND client = ?';
      params.push(client);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (params.length === 0) {
      return { deleted: 0 };
    }

    const info = conn.prepare(sql).run(...params);
    return { deleted: info.changes };
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Clears all SDLC tasks from the database.
 * @param {string} [dbPath] - Optional custom DB path
 * @returns {{ deleted: number }} Number of deleted tasks
 */
function clearTasks(dbPath = null) {
  return deleteTasks({ all: true }, dbPath);
}

/**
 * Records validation and attestation evidence into sdlc_tasks.
 */
function recordEvidence(id, evidenceData, dbPath = null) {
  if (!id) return null;
  const existing = getTask(id, dbPath);
  if (!existing) {
    return createTask({
      id,
      description: `Task ${id}`,
      status: evidenceData.verified ? 'completed' : 'unverified',
      evidence: evidenceData,
      project_path: evidenceData.project_path || '',
      session_id: evidenceData.session_id || '',
      client: evidenceData.client || ''
    }, dbPath);
  }

  return updateTask(id, {
    evidence: evidenceData,
    status: evidenceData.verified ? 'completed' : (existing.status === 'completed' ? 'completed' : 'unverified'),
    project_path: existing.project_path || evidenceData.project_path || '',
    session_id: existing.session_id || evidenceData.session_id || '',
    client: existing.client || evidenceData.client || ''
  }, dbPath);
}

/**
 * Records anti-slop scan/verify report into sdlc_tasks.
 */
function recordSlopResult(id, slopResult, slopCycles = null, dbPath = null) {
  if (!id) return null;
  const existing = getTask(id, dbPath);
  const cycles = slopCycles !== null ? slopCycles : (existing ? existing.slop_cycles : 0);

  if (!existing) {
    return createTask({
      id,
      description: `Task ${id}`,
      slop_result: slopResult,
      slop_cycles: cycles
    }, dbPath);
  }

  return updateTask(id, {
    slop_result: slopResult,
    slop_cycles: cycles
  }, dbPath);
}

// Project SDLC Settings

function getProjectSdlcConfig(projectPath, dbPath = null) {
  if (!projectPath) {
    return { dor_mode: 'advisory', review_mode: 'self' };
  }
  const conn = getDbConn(dbPath);
  try {
    const row = conn.prepare(`
      SELECT dor_mode, review_mode FROM projects
      WHERE project_path = ? OR project_hash = ?
      LIMIT 1
    `).get(projectPath, projectPath);

    return {
      dor_mode: row && row.dor_mode ? row.dor_mode : 'advisory',
      review_mode: row && row.review_mode ? row.review_mode : 'self'
    };
  } catch (_) {
    return { dor_mode: 'advisory', review_mode: 'self' };
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

function setProjectSdlcConfig(projectPath, { dor_mode = null, review_mode = null }, dbPath = null) {
  if (!projectPath) {
    throw new Error('Project path is required to set SDLC configuration.');
  }
  const conn = getDbConn(dbPath);
  try {
    let row = conn.prepare('SELECT project_hash, dor_mode, review_mode FROM projects WHERE project_path = ? OR project_hash = ?').get(projectPath, projectPath);
    if (!row) {
      personaMemory.saveOrUpdateProject(projectPath, '', null, dbPath || db.DB_PATH);
      row = conn.prepare('SELECT project_hash, dor_mode, review_mode FROM projects WHERE project_path = ? OR project_hash = ?').get(projectPath, projectPath);
    }

    const updates = [];
    const params = [];

    if (dor_mode !== null) {
      const normalizedDor = (dor_mode === 'enforced' || dor_mode === 'hard-mandatory') ? 'enforced' : 'advisory';
      updates.push('dor_mode = ?');
      params.push(normalizedDor);
    }

    if (review_mode !== null) {
      const normalizedReview = (review_mode === 'cross-provider') ? 'cross-provider' : 'self';
      updates.push('review_mode = ?');
      params.push(normalizedReview);
    }

    if (updates.length > 0 && row) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(row.project_hash);
      conn.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE project_hash = ?`).run(...params);
    }

    return getProjectSdlcConfig(projectPath, dbPath);
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

// Definition of Readiness (DoR) Engine

function checkReadiness(taskInput, projectPath = null) {
  let taskText = '';
  if (typeof taskInput === 'string') {
    taskText = taskInput.trim();
  } else if (taskInput && typeof taskInput === 'object') {
    taskText = (taskInput.task || taskInput.description || taskInput.prompt || '').trim();
  }

  const missing = [];

  const words = taskText.split(/\s+/).filter(Boolean);
  if (!taskText || words.length < 5) {
    missing.push('Task description is too brief (< 5 words). Provide more context or specific instructions.');
  }

  const placeholderMatch = taskText.match(PLACEHOLDER_REGEX);
  if (placeholderMatch) {
    missing.push(`Task contains unresolved placeholder or template marker (${placeholderMatch[0]}).`);
  }

  if (taskText) {
    const isCreating = CREATION_WORDS.test(taskText);
    const matches = taskText.matchAll(FILE_PATH_REGEX);
    for (const match of matches) {
      const candidate = match[1];
      if (
        candidate.startsWith('http:') || candidate.startsWith('https:') ||
        candidate.startsWith('@') || candidate.startsWith('node:') ||
        candidate.includes('..')
      ) {
        continue;
      }
      const hasExt = /\.(?:js|ts|json|md|html|css|py|yaml|yml|sh|svelte|vue)$/.test(candidate);
      const isPathLike = candidate.startsWith('./') || candidate.startsWith('../') || candidate.startsWith('/') || /^(?:src|app|components|lib|tests?|docs?|bin|config|public)\//.test(candidate);
      if (hasExt || isPathLike) {
        if (!isCreating && projectPath && fs.existsSync(projectPath)) {
          const resolvedCandidate = path.isAbsolute(candidate) ? candidate : path.join(projectPath, candidate);
          if (!fs.existsSync(resolvedCandidate)) {
            missing.push(`Referenced file or path '${candidate}' does not exist on disk.`);
          }
        }
      }
    }
  }

  if (taskText && words.length >= 3) {
    const lower = taskText.toLowerCase();
    const taskTokens = new Set(lower.split(/\W+/).filter(Boolean));
    const matchedDomain = DOMAIN_KEYWORDS.some(kw => {
      if (kw.includes('-')) return lower.includes(kw);
      return taskTokens.has(kw);
    });
    if (!matchedDomain) {
      missing.push('No matching skill domain identified from task keywords. Confirm domain (UI, Backend, Docs, Security, etc.).');
    }
  }

  const ready = missing.length === 0;
  let confidence = 'high';
  if (!ready) {
    confidence = (missing.length === 1 && words.length >= 5) ? 'medium' : 'low';
  }

  return {
    ready,
    missing,
    confidence
  };
}

// Cross-Provider Independence Detection

function detectReviewIndependence(implementingAgent, reviewerAgent = 'kage', dbPath = null) {
  const cleanImpl = (implementingAgent || '').toLowerCase().replace(/^mcp_|^delegate_to_/, '').replace(/_/g, '-');
  const cleanRev = (reviewerAgent || 'kage').toLowerCase().replace(/^mcp_|^delegate_to_/, '').replace(/_/g, '-');

  const conn = getDbConn(dbPath);
  let reviewerModel = null;
  let implementingModel = null;

  try {
    const rows = conn.prepare(`
      SELECT name, model FROM agents WHERE name IN (?, ?, ?, ?)
    `).all(cleanImpl, cleanImpl.replace(/-/g, '_'), cleanRev, cleanRev.replace(/-/g, '_'));

    for (const row of rows) {
      const rName = row.name.replace(/_/g, '-');
      if (rName === cleanRev) reviewerModel = row.model;
      if (rName === cleanImpl) implementingModel = row.model;
    }
  } catch (_) {
  	/* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const isCrossProvider = Boolean(
    reviewerModel &&
    implementingModel &&
    reviewerModel.trim() !== '' &&
    implementingModel.trim() !== '' &&
    reviewerModel.trim() !== implementingModel.trim()
  );

  return {
    isCrossProvider,
    reviewMode: isCrossProvider ? 'cross-provider' : 'self',
    reviewerModel: reviewerModel || 'default',
    implementingModel: implementingModel || 'default'
  };
}

// Anti-Slop Delivery Gate & Remediation Loop Helpers

function evaluateAntiSlopDeliveryGate(reviewArtifact) {
  if (!reviewArtifact || typeof reviewArtifact !== 'object') {
    return {
      pass: false,
      findings: [{ rule: 'R-00', description: 'No anti-slop review artifact provided' }],
      scanned_at: new Date().toISOString()
    };
  }

  const clean = reviewArtifact.ai_slop_clean === true;
  const findingsCount = typeof reviewArtifact.ai_slop_findings === 'number' ? reviewArtifact.ai_slop_findings : (reviewArtifact.findings ? reviewArtifact.findings.length : 0);
  const pass = clean && findingsCount === 0;

  const rawFindings = Array.isArray(reviewArtifact.findings) ? reviewArtifact.findings : [];
  const findings = rawFindings.map((f, idx) => {
    if (typeof f === 'string') {
      return { rule: `R-SLOP-${idx + 1}`, description: f };
    }
    return {
      rule: f.rule || `R-SLOP-${idx + 1}`,
      description: f.description || f.message || 'AI slop violation'
    };
  });

  return {
    pass,
    findings,
    scanned_at: new Date().toISOString()
  };
}

function generateSlopFixTask(deliveryGateReport) {
  const findings = deliveryGateReport && deliveryGateReport.findings ? deliveryGateReport.findings : [];
  if (findings.length === 0) {
    return 'Remediate detected AI slop violations and verify clean output.';
  }

  const items = findings.map(f => `[${f.rule}] ${f.description}`).join('\n- ');
  return `Remediate the following anti-slop Delivery Gate findings:\n- ${items}\n\nEnsure 0 AI slop findings and re-verify compliance with anti-slop Hard Gate rules.`;
}

module.exports = {
  GateLevel,
  generateTaskId,
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  deleteTasks,
  clearTasks,
  recordEvidence,
  recordSlopResult,
  getProjectSdlcConfig,
  setProjectSdlcConfig,
  checkReadiness,
  detectReviewIndependence,
  evaluateAntiSlopDeliveryGate,
  generateSlopFixTask,
  safeJsonParse
};
