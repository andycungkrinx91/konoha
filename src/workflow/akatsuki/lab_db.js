/**
 * Akatsuki Lab database connector.
 *
 * The lab DB is a physically separate SQLite file from the Konoha main DB.
 * Isolation is enforced structurally, not by configuration:
 *   - getLabDbPath() asserts the resolved path lives inside the lab root and
 *     is not the main DB path, throwing LAB_DB_ISOLATION_VIOLATION otherwise.
 *   - src/db.js#getConnection refuses any path isLabDbPath() accepts, so the
 *     main connector can never open the lab DB and this module never opens main.
 *   - KONOHA_DB_PATH is never consulted here.
 *   - Lab data is ephemeral: no backup, purge on confirmed teardown.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const authz = require('../../skill_authorization');
const dbModule = require('../../db');

const LAB_DB_ENV = 'KONOHA_AKATSUKI_LAB_DB';
const LAB_DB_FILENAME = 'lab.db';

function getLabDbPath() {
  const override = process.env[LAB_DB_ENV];
  const target = override && String(override).trim()
    ? path.resolve(override)
    : path.join(authz.getLabDbDir(), LAB_DB_FILENAME);
  authz.assertLabDbPath(target);
  return target;
}

function setupLabSchema(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS lab_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_name TEXT NOT NULL,
      engine TEXT NOT NULL,
      workflow TEXT NOT NULL,
      scope TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_status INTEGER,
      evidence_json TEXT
    );
    CREATE TABLE IF NOT EXISTS lab_tool_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES lab_runs(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      command TEXT NOT NULL,
      exit_status INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kali_tools (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      package TEXT,
      category TEXT,
      description TEXT,
      url TEXT
    );
    CREATE TABLE IF NOT EXISTS red_skill_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      run_id INTEGER REFERENCES lab_runs(id) ON DELETE SET NULL,
      skill_name TEXT NOT NULL,
      agent_name TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('allowed','denied')),
      code TEXT,
      reason TEXT,
      surface TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lab_kali_tools_slug ON kali_tools(slug);
    CREATE INDEX IF NOT EXISTS idx_red_skill_audit_at ON red_skill_audit(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_red_skill_audit_decision ON red_skill_audit(decision);
  `);
  return conn;
}

/**
 * Open the lab DB. Path-guarded, schema-initialized, no vector extension,
 * no legacy-skill migration, no KONOHA_DB_PATH inheritance.
 */
function openLabDb() {
  const conn = dbModule.openRawConnection(getLabDbPath());
  try {
    setupLabSchema(conn);
    require('./lab')._seedLabKaliTools(conn);
  } catch (err) {
    closeLabDb(conn);
    throw err;
  }
  return conn;
}

function closeLabDb(conn) {
  if (!conn || typeof conn.close !== 'function') return;
  try { conn.close(); } catch (_) { /* already closed */ }
}

/**
 * Open the lab DB for auditing only, without creating, migrating, or seeding it.
 *
 * Existing-file-only: SQLite's mode=rw fails on a missing file, so there is no
 * check-then-open window. Returns null when the store or the audit table is
 * absent — auditing must never conjure a lab DB into existence.
 */
function openLabAuditConnection() {
  let conn = null;
  try {
    conn = dbModule.openRawConnection(getLabDbPath(), { fileMustExist: true });
    const table = conn.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'red_skill_audit'"
    ).get();
    if (!table) {
      closeLabDb(conn);
      return null;
    }
    return conn;
  } catch (_) {
    closeLabDb(conn);
    return null;
  }
}

/**
 * Delete the lab DB file and its WAL sidecars. Only called after a confirmed
 * teardown; lab data is ephemeral by design.
 */
function purgeLabDb() {
  const target = getLabDbPath();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(target + suffix, { force: true }); } catch (_) { /* best effort */ }
  }
}

/**
 * Append one red-skill authorization decision to the lab audit trail.
 *
 * Lives in the lab DB only: red-skill activity never touches the main store.
 * Callers must pass an already-open lab connection; this never opens or creates
 * a lab DB, and auditing never alters the decision (best-effort, returns false).
 *
 * @param {{skillName?: string, agentName?: string|null, decision: 'allowed'|'denied',
 *          code?: string|null, reason?: string|null, surface?: string, runId?: number|null}} event
 * @param {import('node:sqlite').DatabaseSync} [conn] open lab connection
 * @returns {boolean} true when a row was written
 */
function recordRedSkillAudit(event, conn) {
  const e = event || {};
  if (!conn || typeof conn.prepare !== 'function') return false;
  try {
    conn.prepare(`INSERT INTO red_skill_audit
      (occurred_at, run_id, skill_name, agent_name, decision, code, reason, surface)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      new Date().toISOString(),
      Number.isInteger(e.runId) ? e.runId : null,
      String(e.skillName || ''),
      e.agentName ? String(e.agentName) : null,
      e.decision === 'allowed' ? 'allowed' : 'denied',
      e.code ? String(e.code) : null,
      e.reason ? String(e.reason) : null,
      e.surface ? String(e.surface) : null
    );
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  LAB_DB_ENV,
  getLabDbPath,
  openLabDb,
  openLabAuditConnection,
  closeLabDb,
  setupLabSchema,
  purgeLabDb,
  recordRedSkillAudit
};
