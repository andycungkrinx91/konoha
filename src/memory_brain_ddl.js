'use strict';

/**
 * src/memory_brain_ddl.js — Schema v8 DDL and additive migration helpers
 * for Konoha's provenance-aware native knowledge brain.
 */

const PERSONA_MEMORY_V8_COLUMNS = [
  ['domain', 'ALTER TABLE persona_memories ADD COLUMN domain TEXT NOT NULL DEFAULT \'persona\';'],
  ['source_type', 'ALTER TABLE persona_memories ADD COLUMN source_type TEXT NOT NULL DEFAULT \'agent\';'],
  ['source_ref', 'ALTER TABLE persona_memories ADD COLUMN source_ref TEXT NOT NULL DEFAULT \'\';'],
  ['creator_agent', 'ALTER TABLE persona_memories ADD COLUMN creator_agent TEXT NOT NULL DEFAULT \'\';'],
  ['confidence', 'ALTER TABLE persona_memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;'],
  ['verification_status', 'ALTER TABLE persona_memories ADD COLUMN verification_status TEXT NOT NULL DEFAULT \'confirmed\';'],
  ['lifecycle_status', 'ALTER TABLE persona_memories ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT \'active\';'],
  ['superseded_by', 'ALTER TABLE persona_memories ADD COLUMN superseded_by TEXT DEFAULT NULL;'],
  ['valid_from', 'ALTER TABLE persona_memories ADD COLUMN valid_from TEXT NOT NULL DEFAULT \'\';'],
  ['valid_until', 'ALTER TABLE persona_memories ADD COLUMN valid_until TEXT NOT NULL DEFAULT \'\';'],
  ['last_verified_at', 'ALTER TABLE persona_memories ADD COLUMN last_verified_at TEXT NOT NULL DEFAULT \'\';'],
  ['access_count', 'ALTER TABLE persona_memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;'],
  ['salience', 'ALTER TABLE persona_memories ADD COLUMN salience REAL NOT NULL DEFAULT 1.0;'],
  ['embedding', 'ALTER TABLE persona_memories ADD COLUMN embedding BLOB DEFAULT NULL;'],
  ['metadata_json', 'ALTER TABLE persona_memories ADD COLUMN metadata_json TEXT NOT NULL DEFAULT \'{}\';']
];

const MEMORY_BRAIN_V8_DDL = `
  CREATE TABLE IF NOT EXISTS memory_audit_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'system',
    reason TEXT NOT NULL DEFAULT '',
    evidence_ref TEXT NOT NULL DEFAULT '',
    previous_state TEXT NOT NULL DEFAULT '{}',
    new_state TEXT NOT NULL DEFAULT '{}',
    project_hash TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    reversible INTEGER NOT NULL DEFAULT 1,
    reverted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_relations (
    id TEXT PRIMARY KEY,
    source_memory_id TEXT NOT NULL,
    target_memory_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    evidence_ref TEXT NOT NULL DEFAULT '',
    evidence_type TEXT NOT NULL DEFAULT 'explicit',
    confidence REAL NOT NULL DEFAULT 1.0,
    verified INTEGER NOT NULL DEFAULT 1,
    project_hash TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'system',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (source_memory_id, target_memory_id, relation_type)
  );

  CREATE INDEX IF NOT EXISTS idx_mem_lifecycle ON persona_memories(lifecycle_status, verification_status);
  CREATE INDEX IF NOT EXISTS idx_mem_domain ON persona_memories(domain);
  CREATE INDEX IF NOT EXISTS idx_memory_audit_mem ON memory_audit_events(memory_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_memory_audit_proj ON memory_audit_events(project_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_memory_relations_src ON memory_relations(source_memory_id, status);
  CREATE INDEX IF NOT EXISTS idx_memory_relations_dst ON memory_relations(target_memory_id, status);
  CREATE INDEX IF NOT EXISTS idx_memory_relations_proj ON memory_relations(project_hash, session_id);
`;

function _getColumnNames(conn, tableName) {
  try {
    return new Set(conn.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name));
  } catch (_) {
    return new Set();
  }
}

function hasCanonicalMemoryBrainLayout(conn) {
  try {
    const tables = new Set(
      conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    if (!tables.has('persona_memories') || !tables.has('memory_audit_events') || !tables.has('memory_relations')) {
      return false;
    }
    const cols = _getColumnNames(conn, 'persona_memories');
    return PERSONA_MEMORY_V8_COLUMNS.every(([name]) => cols.has(name));
  } catch (_) {
    return false;
  }
}

function applyMemoryBrainAdditiveColumns(conn) {
  const existing = _getColumnNames(conn, 'persona_memories');
  if (existing.size === 0) return;
  for (const [col, alterSql] of PERSONA_MEMORY_V8_COLUMNS) {
    if (!existing.has(col)) {
      conn.exec(alterSql);
    }
  }
}

function backfillExistingPersonaMemories(conn) {
  const existing = _getColumnNames(conn, 'persona_memories');
  if (!existing.has('creator_agent') || !existing.has('domain')) return;

  conn.exec(`
    UPDATE persona_memories
    SET
      domain = CASE
        WHEN domain != 'persona' THEN domain
        WHEN memory_type = 'knowledge' THEN 'knowledge'
        WHEN memory_type = 'episodic' AND session_id IS NOT NULL AND session_id != '' THEN 'session'
        WHEN memory_type = 'episodic' THEN 'episodic'
        WHEN project_hash IS NOT NULL AND project_hash != '' THEN 'project'
        ELSE 'persona'
      END,
      creator_agent = CASE WHEN creator_agent = '' THEN agent_name ELSE creator_agent END,
      valid_from = CASE WHEN valid_from = '' THEN created_at ELSE valid_from END,
      last_verified_at = CASE WHEN last_verified_at = '' THEN updated_at ELSE last_verified_at END,
      salience = CASE WHEN salience = 1.0 AND importance > 1 THEN MIN(5.0, CAST(importance AS REAL)) ELSE salience END
    WHERE creator_agent = '' OR valid_from = '' OR last_verified_at = '';
  `);
}

function applyMemoryBrainMigration(conn) {
  conn.exec('SAVEPOINT konoha_memory_brain_v8');
  try {
    applyMemoryBrainAdditiveColumns(conn);
    conn.exec(MEMORY_BRAIN_V8_DDL);
    backfillExistingPersonaMemories(conn);
    conn.exec('RELEASE konoha_memory_brain_v8');
  } catch (err) {
    try {
      conn.exec('ROLLBACK TO konoha_memory_brain_v8; RELEASE konoha_memory_brain_v8;');
    } catch (_) { /* ignore nested rollback failure */ }
    throw new Error(`MEMORY_BRAIN_MIGRATION_FAILED: ${err.message}`);
  }
}

module.exports = {
  PERSONA_MEMORY_V8_COLUMNS,
  MEMORY_BRAIN_V8_DDL,
  hasCanonicalMemoryBrainLayout,
  applyMemoryBrainAdditiveColumns,
  backfillExistingPersonaMemories,
  applyMemoryBrainMigration
};
