/**
 * src/workflow/kage-reviewer/sdlc_manager.js — Konoha Native Medium-Weight SDLC Governance Layer.
 *
 * Implements PLAN_NATIVE_SDLC.md:
 * 1. GateLevel policy constants (advisory, soft-mandatory, hard-mandatory).
 * 2. SQLite persistence for sdlc_tasks table.
 * 3. Definition-of-Readiness (DoR) checkReadiness() pre-dispatch heuristic gate.
 * 4. Cross-provider second-opinion review detection (isCrossProvider).
 * 5. Two-step Anti-slop Gate & Kage->Anbu remediation loop helpers.
 */

'use strict';

const db = require('../../db');
const personaMemory = require('../../persona_memory');

// Quality Gate Levels

const GateLevel = Object.freeze({
  ADVISORY: 'advisory',
  SOFT_MANDATORY: 'soft-mandatory',
  HARD_MANDATORY: 'hard-mandatory'
});

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
    try { conn.exec("ALTER TABLE projects ADD COLUMN hitl_mode TEXT DEFAULT 'enabled';"); } catch (_) { /* column already exists */ }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  return conn;
}

function generateTaskId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `task_${ts}_${rand}`;
}

function safeJsonParse(str, fallback = {}) {
  if (str === null || str === undefined || str === '') {
    return fallback;
  }
  if (typeof str === 'object') {
    return str;
  }
  let parsed = null;
  let parseErr = null;
  try {
    parsed = JSON.parse(str);
  } catch (err) {
    parseErr = err;
  }
  if (parseErr) {
    process.stderr.write(`[sdlc] safeJson: parse failed: ${parseErr.message}\n`);
    return fallback;
  }
  return (parsed !== null && typeof parsed === 'object') ? parsed : fallback;
}

function _resolveSessionId(data, projectPath) {
  if (data.session_id) return data.session_id;
  try {
    const cd = require('../../mcp/client_detection');
    return cd.getActiveSessionId(projectPath) || '';
  } catch (_) {
    return '';
  }
}

function _resolveClient(data) {
  if (data.client) return data.client;
  try {
    const cd = require('../../mcp/client_detection');
    return cd.getActiveClient() || cd.detectActiveClient() || '';
  } catch (_) {
    return '';
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
    const sessionId = _resolveSessionId(data, projectPath);
    const client = _resolveClient(data);
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

function _applyReconcileUpdates(conn, staleRows, maxAgeMs) {
  const now = new Date().toISOString();
  const updateStmt = conn.prepare(`
    UPDATE sdlc_tasks SET status = 'timed_out', evidence = ?, updated_at = ? WHERE id = ?
  `);
  const reconciledIds = [];
  for (const row of staleRows) {
    const ev = safeJsonParse(row.evidence, {});
    ev.reconciliation = {
      previous_status: row.status,
      reconciled_at: now,
      reason: `Task lease expired (inactivity > ${Math.round(maxAgeMs / 60000)}m)`,
      last_heartbeat_at: row.updated_at
    };
    updateStmt.run(JSON.stringify(ev), now, row.id);
    reconciledIds.push(row.id);
  }
  return reconciledIds;
}

function reconcileStaleTasks(options = {}, dbPath = null) {
  const maxAgeMs = typeof options === 'number' ? options : (options.maxAgeMs || 30 * 60 * 1000);
  const conn = getDbConn(dbPath);
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const staleRows = conn.prepare(`
      SELECT id, status, evidence, updated_at FROM sdlc_tasks
      WHERE status IN ('in_progress', 'remediating', 'pending_plan_approval') AND updated_at < ?
    `).all(cutoff);

    const reconciledIds = staleRows.length > 0 ? _applyReconcileUpdates(conn, staleRows, maxAgeMs) : [];
    return { reconciled_count: reconciledIds.length, reconciled_ids: reconciledIds };
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
  }
}

function restartTask(taskId, options = {}, dbPath = null) {
  const conn = getDbConn(dbPath);
  try {
    const task = conn.prepare('SELECT * FROM sdlc_tasks WHERE id = ?').get(taskId);
    if (!task) return null;
    const now = new Date().toISOString();
    const ev = safeJsonParse(task.evidence, {});
    ev.restarts = (ev.restarts || 0) + 1;
    ev.last_restart_at = now;
    const newStatus = options.status || 'in_progress';
    conn.prepare('UPDATE sdlc_tasks SET status = ?, evidence = ?, updated_at = ? WHERE id = ?').run(
      newStatus,
      JSON.stringify(ev),
      now,
      taskId
    );
    return getTask(taskId, dbPath);
  } finally {
    try { conn.close(); } catch (_) { /* ignore */ }
  }
}

/**
 * Lists SDLC tasks with optional filters.
 */
function listTasks({ projectPath = null, sessionId = null, client = null, status = null, limit = 50 } = {}, dbPath = null) {
  try { reconcileStaleTasks({}, dbPath); } catch (_) { /* ignore */ }
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
  const envHitl = process.env.KONOHA_HITL_MODE;
  if (!projectPath) {
    return { dor_mode: 'advisory', review_mode: 'self', hitl_mode: envHitl || 'enabled' };
  }
  const conn = getDbConn(dbPath);
  try {
    const row = conn.prepare(`
      SELECT dor_mode, review_mode, hitl_mode FROM projects
      WHERE project_path = ? OR project_hash = ?
      LIMIT 1
    `).get(projectPath, projectPath);

    return {
      dor_mode: row && row.dor_mode ? row.dor_mode : 'advisory',
      review_mode: row && row.review_mode ? row.review_mode : 'self',
      hitl_mode: envHitl || (row && row.hitl_mode ? row.hitl_mode : 'enabled')
    };
  } catch (_) {
    return { dor_mode: 'advisory', review_mode: 'self', hitl_mode: envHitl || 'enabled' };
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

function setProjectSdlcConfig(projectPath, { dor_mode = null, review_mode = null, hitl_mode = null }, dbPath = null) {
  if (!projectPath) {
    throw new Error('Project path is required to set SDLC configuration.');
  }
  const conn = getDbConn(dbPath);
  try {
    let row = conn.prepare('SELECT project_hash, dor_mode, review_mode, hitl_mode FROM projects WHERE project_path = ? OR project_hash = ?').get(projectPath, projectPath);
    if (!row) {
      personaMemory.saveOrUpdateProject(projectPath, '', null, dbPath || db.DB_PATH);
      row = conn.prepare('SELECT project_hash, dor_mode, review_mode, hitl_mode FROM projects WHERE project_path = ? OR project_hash = ?').get(projectPath, projectPath);
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

    if (hitl_mode !== null) {
      const normalizedHitl = (hitl_mode === 'disabled' || hitl_mode === 'autonomous') ? 'disabled' : 'enabled';
      updates.push('hitl_mode = ?');
      params.push(normalizedHitl);
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

const {
  checkReadiness,
  detectReviewIndependence,
  evaluateAntiSlopDeliveryGate,
  generateSlopFixTask
} = require('./sdlc_readiness');

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
  reconcileStaleTasks,
  restartTask,
  safeJsonParse
};
