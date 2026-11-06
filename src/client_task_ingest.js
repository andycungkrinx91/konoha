'use strict';

/**
 * src/client_task_ingest.js — Ingest client-side active tasks into sdlc_tasks.
 *
 * Reads only Konoha-produced records in active_sessions (written by client_detection.js).
 * For each live session (<15m), upserts an sdlc_tasks row with:
 *   client=<client>, status='in_progress', id='session:'+session_id,
 *   description='Active <client> session in <project basename>', evidence={"source":"session"}
 * Auto-closes rows (status='completed') when session disappears or goes stale.
 */

const path = require('path');
const dbmod = require('./db');

let lastIngestTime = 0;
const INGEST_MEMO_MS = 10 * 1000;
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

function safeJsonParse(str, fallback, context = 'payload') {
  try {
    return JSON.parse(str);
  } catch (err) {
    console.warn(`[client_task_ingest] Unparseable ${context}; falling back to defaults: ${err.message}`);
    return fallback;
  }
}

function parseActiveTime(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  const str = String(t).trim();
  const iso = str.includes('T') ? str : str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function resolveTimeExpr(cols) {
  if (cols.includes('last_active_at') && cols.includes('updated_at')) return 'COALESCE(last_active_at, updated_at)';
  if (cols.includes('last_active_at')) return 'last_active_at';
  if (cols.includes('updated_at')) return 'updated_at';
  return "datetime('now')";
}

function splitLiveSessions(sessions, nowMs, maxAgeMs) {
  const liveSessionIds = new Set();
  const liveSessions = [];
  for (const s of sessions) {
    const activeMs = parseActiveTime(s.active_time);
    if (nowMs - activeMs <= maxAgeMs) {
      liveSessionIds.add(s.session_id);
      liveSessions.push(s);
    }
  }
  return { liveSessionIds, liveSessions };
}

function applyLiveSession(stmts, session, nowIso) {
  if (stmts.checkKonoha.get(session.session_id)) return 0;

  const taskId = `session:${session.session_id}`;
  const projectBase = path.basename(session.workspace_root || '') || 'workspace';
  const desc = `Active ${session.client || 'client'} session in ${projectBase}`;
  const existingTask = stmts.checkTask.get(taskId);

  if (!existingTask) {
    insertSessionTask(stmts, session, taskId, desc, nowIso);
    return 1;
  }

  const ev = safeJsonParse(existingTask.evidence, {}, 'session evidence');
  ev.source = 'session';
  ev.last_heartbeat_at = session.active_time || nowIso;

  if (existingTask.status !== 'in_progress') {
    stmts.updateTask.run('in_progress', JSON.stringify(ev), nowIso, taskId);
    return 1;
  }

  stmts.touchEvidence.run(JSON.stringify(ev), nowIso, taskId);
  return 0;
}

function insertSessionTask(stmts, session, taskId, desc, nowIso) {
  const evidence = JSON.stringify({ source: 'session', last_heartbeat_at: session.active_time || nowIso });
  stmts.insertTask.run(
    taskId,
    desc,
    session.workspace_root || '',
    session.session_id,
    session.client || '',
    evidence,
    nowIso,
    nowIso
  );
}

function applyLiveSessions(conn, sessions, nowIso) {
  const stmts = prepareTaskStatements(conn);
  let ingestedCount = 0;
  for (const session of sessions) {
    ingestedCount += applyLiveSession(stmts, session, nowIso);
  }
  return { ingestedCount, stmts };
}

function closeStaleSessionTasks(conn, stmts, liveSessionIds, nowIso) {
  const activeTasks = conn.prepare(`
    SELECT id, session_id, evidence FROM sdlc_tasks
    WHERE id LIKE 'session:%' AND status = 'in_progress'
  `).all();

  let closedCount = 0;
  for (const task of activeTasks) {
    if (liveSessionIds.has(task.session_id)) continue;
    const ev = safeJsonParse(task.evidence, {}, 'session evidence');
    ev.source = 'session';
    ev.closed_at = nowIso;
    ev.close_reason = 'session_inactivity';
    stmts.updateTask.run('completed', JSON.stringify(ev), nowIso, task.id);
    closedCount += 1;
  }
  return closedCount;
}

function prepareTaskStatements(conn) {
  return {
    checkKonoha: conn.prepare(`
      SELECT id FROM sdlc_tasks
      WHERE session_id = ? AND id NOT LIKE 'session:%'
      LIMIT 1
    `),
    checkTask: conn.prepare('SELECT id, status, evidence FROM sdlc_tasks WHERE id = ?'),
    insertTask: conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, project_path, session_id, client, evidence, created_at, updated_at)
      VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?)
    `),
    updateTask: conn.prepare(`
      UPDATE sdlc_tasks SET status = ?, evidence = ?, updated_at = ? WHERE id = ?
    `),
    touchEvidence: conn.prepare('UPDATE sdlc_tasks SET evidence = ?, updated_at = ? WHERE id = ?')
  };
}

function ingestClientTasks({ dbPath = null, force = false, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const nowMs = Date.now();
  if (!force && (nowMs - lastIngestTime < INGEST_MEMO_MS)) {
    return { ingested_count: 0, closed_count: 0, memoized: true };
  }
  lastIngestTime = nowMs;

  let conn = null;
  try {
    conn = dbmod.getConnection(dbPath, false);

    const hasActiveSessions = conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'active_sessions'"
    ).get();
    const hasSdlcTasks = conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sdlc_tasks'"
    ).get();

    if (!hasActiveSessions || !hasSdlcTasks) {
      return { ingested_count: 0, closed_count: 0, skipped: true };
    }

    const { liveSessionIds, liveSessions } = loadLiveSessions(conn, nowMs, maxAgeMs);
    const nowIso = new Date(nowMs).toISOString();
    const { ingestedCount, stmts } = applyLiveSessions(conn, liveSessions, nowIso);
    const closedCount = closeStaleSessionTasks(conn, stmts, liveSessionIds, nowIso);

    return { ingested_count: ingestedCount, closed_count: closedCount };
  } finally {
    if (conn) closeConnection(conn);
  }
}

function loadLiveSessions(conn, nowMs, maxAgeMs) {
  const cols = conn.prepare('PRAGMA table_info(active_sessions)').all().map((c) => c.name);
  const wsCol = cols.includes('workspace_root') ? 'workspace_root' : (cols.includes('project_path') ? 'project_path' : "''");
  const sessions = conn.prepare(`
    SELECT client, ${wsCol} AS workspace_root, session_id, ${resolveTimeExpr(cols)} AS active_time
    FROM active_sessions
  `).all();
  return splitLiveSessions(sessions, nowMs, maxAgeMs);
}

function closeConnection(conn) {
  try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
}

function resetIngestMemo() {
  lastIngestTime = 0;
}

module.exports = {
  ingestClientTasks,
  resetIngestMemo
};
