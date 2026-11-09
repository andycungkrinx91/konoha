'use strict';

/**
 * Widens the `profile` CHECK vocabulary on generation_jobs and assets so the
 * renamed `production_pbr` key is accepted while rows persisted as
 * `enterprise_pbr` keep validating. SQLite cannot alter a CHECK in place, so
 * both tables are rebuilt from their own sqlite_master text.
 */

const crypto = require('crypto');

const PROFILE_VOCABULARY_MIGRATION_ID = '20261109_001_profile_vocabulary';
const PROFILE_TABLES = Object.freeze(['generation_jobs', 'assets']);
const PROFILE_CHECK = /profile TEXT NOT NULL CHECK \(profile IN \([^)]*\)\)/;
const PROFILE_WIDE =
  "profile TEXT NOT NULL CHECK (profile IN ('production_pbr', 'enterprise_pbr', 'realistic', 'premium_stylized', 'stylized', 'draft'))";
const STAGE_SUFFIX = '__profile_stage';
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeIdent(name) {
  const value = String(name);
  if (!SAFE_IDENTIFIER.test(value)) throw new Error('Unsafe SQL identifier: ' + value);
  return value;
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
    const stage = `${table}${STAGE_SUFFIX}`;
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
    plan.push({ table, stage, createSql });
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
      for (const step of plan) {
        const table = safeIdent(step.table);
        const stage = safeIdent(step.stage);
        conn.exec(step.createSql);
        conn.exec(`INSERT INTO ${stage} SELECT * FROM ${table};`);
        conn.exec(`DROP TABLE ${table};`);
        conn.exec(`ALTER TABLE ${stage} RENAME TO ${table};`);
      }
      for (const dependent of dependents) conn.exec(dependent.sql);
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
