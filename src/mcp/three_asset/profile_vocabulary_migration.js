'use strict';

/**
 * Widens the `profile` CHECK vocabulary on generation_jobs and assets so the
 * renamed `production_pbr` key is accepted while rows persisted as
 * `enterprise_pbr` keep validating. SQLite cannot alter a CHECK in place, so
 * both tables are rebuilt from their own sqlite_master text.
 */

const crypto = require('crypto');

const PROFILE_VOCABULARY_MIGRATION_ID = '20261109_001_profile_vocabulary';
const PROFILE_CHECK = /profile TEXT NOT NULL CHECK \(profile IN \([^)]*\)\)/;
const PROFILE_WIDE =
  "profile TEXT NOT NULL CHECK (profile IN ('production_pbr', 'enterprise_pbr', 'realistic', 'premium_stylized', 'stylized', 'draft'))";
// SQLite cannot bind identifiers, so the rebuild statements are written out in
// full for the two tables this migration knows about. A table outside this map
// is a whitelist miss and aborts rather than reaching exec.
const REBUILD_SQL = Object.freeze({
  generation_jobs: Object.freeze({
    stage: 'generation_jobs__profile_stage',
    copyRows: 'INSERT INTO "generation_jobs__profile_stage" SELECT * FROM "generation_jobs";',
    dropTable: 'DROP TABLE "generation_jobs";',
    renameTable: 'ALTER TABLE "generation_jobs__profile_stage" RENAME TO "generation_jobs";',
  }),
  assets: Object.freeze({
    stage: 'assets__profile_stage',
    copyRows: 'INSERT INTO "assets__profile_stage" SELECT * FROM "assets";',
    dropTable: 'DROP TABLE "assets";',
    renameTable: 'ALTER TABLE "assets__profile_stage" RENAME TO "assets";',
  }),
});

const PROFILE_TABLES = Object.freeze(Object.keys(REBUILD_SQL));

// createSql is the table's own DDL from sqlite_master and the dependent DDL comes
// from the same catalog, so both are checked for the exact shapes SQLite emits
// before any of them reaches exec.
const CREATE_TABLE_DDL = /^CREATE TABLE /;
const DEPENDENT_DDL = /^(?:CREATE (?:UNIQUE )?INDEX|CREATE TRIGGER)\b/;

function rebuildTable(conn, step) {
  const statements = REBUILD_SQL[step.table];
  if (!CREATE_TABLE_DDL.test(step.createSql)) {
    throw new Error('[SCHEMA DRIFT]: ' + step.table + ' has no CREATE TABLE DDL');
  }
  conn.exec(step.createSql);
  conn.exec(statements.copyRows);
  conn.exec(statements.dropTable);
  conn.exec(statements.renameTable);
}

function rebuildDependent(conn, dependent) {
  if (!DEPENDENT_DDL.test(dependent.sql)) {
    throw new Error('[SCHEMA DRIFT]: unexpected dependent DDL for ' + dependent.tbl_name);
  }
  conn.exec(dependent.sql);
}

function _plan(conn) {
  const plan = [];
  for (const table of PROFILE_TABLES) {
    const row = conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!row || !row.sql) continue;
    const hits = row.sql.match(new RegExp(PROFILE_CHECK.source, 'g')) || [];
    if (hits.length === 0) {
      if (row.sql.includes('profile TEXT')) {
        throw new Error(`[SCHEMA DRIFT]: ${table} declares profile without the canonical CHECK shape`);
      }
      continue;
    }
    if (hits.length > 1) {
      throw new Error(`[SCHEMA DRIFT]: ${table} declares ${hits.length} profile constraints, expected one`);
    }
    if (hits[0].includes("'production_pbr'")) continue;
    const { stage } = REBUILD_SQL[table];
    // SQLite stores the name quoted after a rebuild, so accept both spellings.
    const createSql = row.sql
      .replace(PROFILE_CHECK, PROFILE_WIDE)
      .replace(
        new RegExp(`^(CREATE TABLE (?:IF NOT EXISTS )?)(?:"${table}"|${table})(?=\\s*\\()`),
        `$1"${stage}"`
      );
    if (createSql === row.sql) {
      throw new Error(`[SCHEMA DRIFT]: ${table} could not be staged for rebuild`);
    }
    plan.push({ table, createSql });
  }
  return plan;
}

function _dependents(conn) {
  const placeholders = PROFILE_TABLES.map(() => '?').join(', ');
  return conn
    .prepare(
      `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN (${placeholders}) AND type IN ('index', 'trigger')`
    )
    .all(...PROFILE_TABLES);
}

function _record(conn) {
  const hasTable = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasTable) return;
  const checksum = crypto.createHash('sha256').update('profile-vocabulary-v1').digest('hex');
  conn
    .prepare(
      'INSERT OR REPLACE INTO schema_migrations (migration_id, checksum_sha256, applied_at, execution_ms) VALUES (?, ?, ?, ?)'
    )
    .run(PROFILE_VOCABULARY_MIGRATION_ID, checksum, new Date().toISOString(), 0);
}

function applyProfileVocabularyMigration(conn) {
  if (!conn || typeof conn.prepare !== 'function') {
    throw new Error('Valid SQLite connection required for applyProfileVocabularyMigration');
  }
  const plan = _plan(conn);
  if (plan.length === 0) {
    _record(conn);
    return { applied: false, tables: [] };
  }
  const dependents = _dependents(conn);
  const fkRow = conn.prepare('PRAGMA foreign_keys').get();
  const fkWasOn = Boolean(fkRow && Object.values(fkRow)[0]);
  if (fkWasOn) conn.exec('PRAGMA foreign_keys = OFF;');
  const startMs = Date.now();
  try {
    const rebuild = () => {
      for (const step of plan) rebuildTable(conn, step);
      for (const dependent of dependents) rebuildDependent(conn, dependent);
    };
    if (typeof conn.transaction === 'function') {
      conn.transaction(rebuild)();
    } else {
      conn.exec('BEGIN IMMEDIATE;');
      try {
        rebuild();
        conn.exec('COMMIT;');
      } catch (err) {
        conn.exec('ROLLBACK;');
        throw err;
      }
    }
  } finally {
    if (fkWasOn) conn.exec('PRAGMA foreign_keys = ON;');
  }
  const violations = conn.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(`[FOREIGN KEY VIOLATION]: profile vocabulary rebuild produced ${violations.length} violations`);
  }
  _record(conn);
  return { applied: true, tables: plan.map((step) => step.table), execution_ms: Math.max(0, Date.now() - startMs) };
}

module.exports = {
  PROFILE_VOCABULARY_MIGRATION_ID,
  PROFILE_TABLES,
  PROFILE_WIDE,
  applyProfileVocabularyMigration
};
