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

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_) {
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

function ingestClientTasks({ dbPath = null, force = false, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const nowMs = Date.now();
  if (!force && (nowMs - lastIngestTime < INGEST_MEMO_MS)) {
    return { ingested_count: 0, closed_count: 0, memoized: true };
  }
  lastIngestTime = nowMs;

  let conn = null;
  try {
    conn = dbmod.getConnection(dbPath, false);

    // Check if tables exist
    const hasActiveSessions = conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'active_sessions'"
    ).get();
    const hasSdlcTasks = conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sdlc_tasks'"
    ).get();

    if (!hasActiveSessions || !hasSdlcTasks) {
      return { ingested_count: 0, closed_count: 0, skipped: true };
    }

    const cols = conn.prepare("PRAGMA table_info(active_sessions)").all().map((c) => c.name);
    let timeExpr = "datetime('now')";
    if (cols.includes('last_active_at') && cols.includes('updated_at')) {
      timeExpr = 'COALESCE(last_active_at, updated_at)';
    } else if (cols.includes('last_active_at')) {
      timeExpr = 'last_active_at';
    } else if (cols.includes('updated_at')) {
      timeExpr = 'updated_at';
    }

    const wsCol = cols.includes('workspace_root') ? 'workspace_root' : (cols.includes('project_path') ? 'project_path' : "''");
    const sessions = conn.prepare(`
      SELECT client, ${wsCol} AS workspace_root, session_id, ${timeExpr} AS active_time
      FROM active_sessions
    `).all();

    const liveSessionIds = new Set();
    const liveSessions = [];

    for (const s of sessions) {
      const activeMs = parseActiveTime(s.active_time);
      if (nowMs - activeMs <= maxAgeMs) {
        liveSessionIds.add(s.session_id);
        liveSessions.push(s);
      }
    }

    let ingestedCount = 0;
    const nowIso = new Date(nowMs).toISOString();

    const checkKonohaStmt = conn.prepare(`
      SELECT id FROM sdlc_tasks
      WHERE session_id = ? AND id NOT LIKE 'session:%'
      LIMIT 1
    `);
    const checkTaskStmt = conn.prepare('SELECT id, status, evidence FROM sdlc_tasks WHERE id = ?');
    const insertTaskStmt = conn.prepare(`
      INSERT INTO sdlc_tasks (id, description, status, project_path, session_id, client, evidence, created_at, updated_at)
      VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?)
    `);
    const updateTaskStmt = conn.prepare(`
      UPDATE sdlc_tasks SET status = ?, evidence = ?, updated_at = ? WHERE id = ?
    `);

    for (const s of liveSessions) {
      const existingKonoha = checkKonohaStmt.get(s.session_id);
      if (existingKonoha) continue;

      const taskId = `session:${s.session_id}`;
      const projectBase = path.basename(s.workspace_root || '') || 'workspace';
      const desc = `Active ${s.client || 'client'} session in ${projectBase}`;
      const existingTask = checkTaskStmt.get(taskId);

      if (!existingTask) {
        insertTaskStmt.run(
          taskId,
          desc,
          s.workspace_root || '',
          s.session_id,
          s.client || '',
          JSON.stringify({ source: 'session', last_heartbeat_at: s.active_time || nowIso }),
          nowIso,
          nowIso
        );
        ingestedCount += 1;
      } else if (existingTask.status !== 'in_progress') {
        const ev = safeJsonParse(existingTask.evidence, {});
        ev.source = 'session';
        ev.last_heartbeat_at = s.active_time || nowIso;
        updateTaskStmt.run('in_progress', JSON.stringify(ev), nowIso, taskId);
        ingestedCount += 1;
      } else {
        const ev = safeJsonParse(existingTask.evidence, {});
        ev.source = 'session';
        ev.last_heartbeat_at = s.active_time || nowIso;
        conn.prepare('UPDATE sdlc_tasks SET evidence = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(ev),
          nowIso,
          taskId
        );
      }
    }

    // Auto-close disappeared or stale session tasks
    const activeTasks = conn.prepare(`
      SELECT id, session_id, evidence FROM sdlc_tasks
      WHERE id LIKE 'session:%' AND status = 'in_progress'
    `).all();

    let closedCount = 0;
    for (const task of activeTasks) {
      if (!liveSessionIds.has(task.session_id)) {
        const ev = safeJsonParse(task.evidence, {});
        ev.source = 'session';
        ev.closed_at = nowIso;
        ev.close_reason = 'session_inactivity';
        updateTaskStmt.run('completed', JSON.stringify(ev), nowIso, task.id);
        closedCount += 1;
      }
    }

    return { ingested_count: ingestedCount, closed_count: closedCount };
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  }
}

function resetIngestMemo() {
  lastIngestTime = 0;
}

module.exports = {
  ingestClientTasks,
  resetIngestMemo
};
