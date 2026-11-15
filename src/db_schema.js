'use strict';

const {
  CODE_INTELLIGENCE_DDL,
  CODE_INTELLIGENCE_V7_DDL,
  CODE_INTELLIGENCE_FTS_DDL,
  applyV7AdditiveColumns,
  hasCanonicalCodeChunksLayout,
  ensureCodeChunksCanonicalLayout
} = require('./code_intel/ddl');
const { CORE_SCHEMA_DDL } = require('./schema_ddl');
const { createAndVerifyPreMigrationBackup } = require('./db_migration_safety');

const CURRENT_SCHEMA_VERSION = 7;
const _ensuredSchemaInodes = new Map();
const REQUIRED_FAST_SCHEMA_TABLES = [
  'skills', 'skills_fts', 'persona_memories', 'persona_memories_fts',
  'projects', 'active_sessions', 'tool_calls', 'agents',
  'bridges', 'sdlc_tasks', 'code_edges', 'assets', 'generation_jobs'
];

// Kept in sync with CORE_SCHEMA_DDL (`agents`) in src/schema_ddl.js so older
// databases missing evolved columns (e.g. `icon`, `model_tier`) get backfilled
// before INSERT ... ON CONFLICT(name) writes execute.
const AGENT_SCHEMA_COLUMNS = [
  ['name', 'ALTER TABLE agents ADD COLUMN name TEXT;'],
  ['icon', 'ALTER TABLE agents ADD COLUMN icon TEXT;'],
  ['title', 'ALTER TABLE agents ADD COLUMN title TEXT;'],
  ['model', 'ALTER TABLE agents ADD COLUMN model TEXT;'],
  ['model_tier', 'ALTER TABLE agents ADD COLUMN model_tier TEXT;'],
  ['purpose', 'ALTER TABLE agents ADD COLUMN purpose TEXT;'],
  ['skills', 'ALTER TABLE agents ADD COLUMN skills TEXT;'],
  ['delegate_when', 'ALTER TABLE agents ADD COLUMN delegate_when TEXT;'],
  ['constraints_text', 'ALTER TABLE agents ADD COLUMN constraints_text TEXT;'],
  ['workflow', 'ALTER TABLE agents ADD COLUMN workflow TEXT;'],
  ['description', 'ALTER TABLE agents ADD COLUMN description TEXT;'],
  ['instructions', 'ALTER TABLE agents ADD COLUMN instructions TEXT;'],
  ['delegation_keywords', 'ALTER TABLE agents ADD COLUMN delegation_keywords TEXT;'],
  ['cursor_fallback_model', 'ALTER TABLE agents ADD COLUMN cursor_fallback_model TEXT;'],
  ['enable_mcp_tools', 'ALTER TABLE agents ADD COLUMN enable_mcp_tools INTEGER NOT NULL DEFAULT 1;'],
];

function _hasUniqueIndexOn(conn, colName) {
  const indexes = conn.prepare('PRAGMA index_list(agents)').all();
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const cols = conn.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all();
    if (cols.length === 1 && cols[0].name === colName) return true;
  }
  return false;
}

function _hasRequiredAgentSchema(conn) {
  const colInfo = conn.prepare('PRAGMA table_info(agents)').all();
  const cols = new Set(colInfo.map((c) => c.name));
  if (!AGENT_SCHEMA_COLUMNS.every(([col]) => cols.has(col))) return false;
  return colInfo.some((c) => c.name === 'name' && c.pk > 0) || _hasUniqueIndexOn(conn, 'name');
}

function _ensureAgentsColumns(conn) {
  const colInfo = conn.prepare('PRAGMA table_info(agents)').all();
  const existing = new Set(colInfo.map((c) => c.name));
  for (const [col, alterSql] of AGENT_SCHEMA_COLUMNS) {
    if (!existing.has(col)) {
      conn.prepare(alterSql).run();
    }
  }
  // ON CONFLICT(name) in seedAgents/db_agents requires a PRIMARY KEY or UNIQUE index on name.
  const hasNamePk = colInfo.some((c) => c.name === 'name' && c.pk > 0);
  if (!hasNamePk && !_hasUniqueIndexOn(conn, 'name')) {
    conn.exec('DELETE FROM agents WHERE rowid NOT IN (SELECT MIN(rowid) FROM agents WHERE name IS NOT NULL GROUP BY name);');
    conn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name_unique ON agents(name);');
  }
}

function _getDbFileIdentity(dbPath) {
  if (!dbPath || dbPath === ':memory:') return null;
  const st = require('fs').statSync(dbPath, { throwIfNoEntry: false });
  if (!st || !st.isFile()) return null;
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}

function _hasAllRequiredTables(conn) {
  const rows = conn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all();
  const existing = new Set(rows.map((r) => r.name));
  if (!REQUIRED_FAST_SCHEMA_TABLES.every((t) => existing.has(t))) return false;
  if (existing.has('code_chunks') && !hasCanonicalCodeChunksLayout(conn)) return false;
  return _hasRequiredAgentSchema(conn);
}

function ensureSchema(conn, backupDatabaseFn = null) {
  const dbPath = conn && typeof conn.name === 'string' ? conn.name : null;
  const identity = _getDbFileIdentity(dbPath);
  if (identity && getCurrentUserVersion(conn) === CURRENT_SCHEMA_VERSION) {
    if (_ensuredSchemaInodes.get(dbPath) === identity) return;
    if (_hasAllRequiredTables(conn)) {
      if (_ensuredSchemaInodes.size >= 128) _ensuredSchemaInodes.clear();
      _ensuredSchemaInodes.set(dbPath, identity);
      return;
    }
  }
  setupSchema(conn, backupDatabaseFn);
  const updatedId = _getDbFileIdentity(dbPath);
  if (updatedId && getCurrentUserVersion(conn) === CURRENT_SCHEMA_VERSION) {
    if (_ensuredSchemaInodes.size >= 128) _ensuredSchemaInodes.clear();
    _ensuredSchemaInodes.set(dbPath, updatedId);
  }
}

function getCurrentUserVersion(conn) {
  try {
    const row = conn.prepare('PRAGMA user_version').get();
    return row ? (row.user_version !== undefined ? row.user_version : Object.values(row)[0] || 0) : 0;
  } catch (_) { return 0; }
}

function setUserVersion(conn, version) {
  conn.pragma(`user_version = ${version}`);
}

function verifyIntegrity(conn) {
  try {
    const row = conn.prepare('PRAGMA integrity_check').get();
    const val = row ? (row.integrity_check || Object.values(row)[0]) : null;
    return val === 'ok';
  } catch (_) { return false; }
}

function hasFts5Support(conn) {
  if (!conn || typeof conn.exec !== 'function') return false;
  if (conn._mockFts5Disabled === true || globalThis.__KONOHA_MOCK_FTS5_DISABLED === true) return false;
  try {
    conn.exec('DROP TABLE IF EXISTS temp._konoha_fts5_probe; CREATE VIRTUAL TABLE temp._konoha_fts5_probe USING fts5(x); DROP TABLE IF EXISTS temp._konoha_fts5_probe;');
    return true;
  } catch (_) {
    try {
      conn.exec('DROP TABLE IF EXISTS temp._konoha_fts5_probe;');
    } catch (_2) { /* intentional best-effort fallback */ }
    return false;
  }
}

function _dropLegacyPersonaMemoriesFts(conn) {
  try {
    const legacyFtsCols = conn.prepare("PRAGMA table_info(persona_memories_fts)").all().map(c => c.name);
    if (legacyFtsCols.length > 0 && !legacyFtsCols.includes('project_hash')) {
      conn.exec('DROP TABLE persona_memories_fts');
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function _migratePersonaMemoriesForeignKey(conn) {
  const tableExists = Boolean(
    conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'persona_memories'").get()
  );
  if (!tableExists) return;
  const memFks = conn.prepare("PRAGMA foreign_key_list(persona_memories)").all();
  const hasProjectFk = memFks.some(fk => fk.table === 'projects');
  if (hasProjectFk) return;

  conn.exec('SAVEPOINT konoha_persona_memories_fk');
  try {
    conn.exec(`
      DELETE FROM persona_memories
      WHERE project_hash IS NOT NULL
        AND project_hash != ''
        AND project_hash NOT IN (SELECT project_hash FROM projects);

      DROP TABLE IF EXISTS persona_memories_migrated;
      CREATE TABLE persona_memories_migrated (
          id TEXT PRIMARY KEY, project_hash TEXT DEFAULT NULL, session_id TEXT DEFAULT '',
          agent_name TEXT NOT NULL, memory_type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
          tags TEXT, importance INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (project_hash) REFERENCES projects(project_hash) ON DELETE CASCADE
      );
      INSERT INTO persona_memories_migrated (id, project_hash, session_id, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
      SELECT id,
             CASE WHEN project_hash = '' OR project_hash IS NULL THEN NULL ELSE project_hash END,
             session_id, agent_name, memory_type, title, content, tags, importance, created_at, updated_at
      FROM persona_memories;
      DROP TABLE persona_memories;
      ALTER TABLE persona_memories_migrated RENAME TO persona_memories;
    `);
    conn.exec('RELEASE konoha_persona_memories_fk');
  } catch (err) {
    try {
      conn.exec('ROLLBACK TO konoha_persona_memories_fk; RELEASE konoha_persona_memories_fk;');
    } catch (_) { /* ignore nested rollback failure */ }
    throw new Error(`PERSONA_MEMORIES_FK_MIGRATION_FAILED: ${err.message}`);
  }
}

function _purgeLegacyDbArtifacts(conn) {
  try {
    conn.exec(`
      DELETE FROM persona_memories
      WHERE content LIKE '%delegate.md%'
         OR content LIKE '%result.md%'
         OR content LIKE '%prompt.md%'
         OR content LIKE '%report.md%';
    `);
  } catch (_) { /* best-effort legacy memory purge */ }
  try {
    conn.exec(`
      UPDATE agents
      SET instructions = REPLACE(REPLACE(instructions, 'delegate.md', 'structured MCP arguments'), 'prompt.md', 'structured MCP arguments')
      WHERE instructions LIKE '%delegate.md%' OR instructions LIKE '%prompt.md%';
    `);
  } catch (_) { /* best-effort agent instruction cleanup */ }
}

function _backfillActiveSessionsProjectHash(conn) {
  try {
    const unhashedRows = conn.prepare("SELECT rowid, workspace_root FROM active_sessions WHERE project_hash IS NULL OR project_hash = ''").all();
    if (!unhashedRows.length) return;
    const personaMemory = require('./persona_memory');
    const updateStmt = conn.prepare("UPDATE active_sessions SET project_hash = ? WHERE rowid = ?");
    for (const r of unhashedRows) {
      if (!r.workspace_root) continue;
      const ph = personaMemory.computeProjectHash(r.workspace_root);
      if (ph) updateStmt.run(ph, r.rowid);
    }
  } catch (_) { /* intentional best-effort fallback */ }
}


/**
 * Applies the v6 -> v7 code-intelligence schema atomically.
 *
 * Uses SAVEPOINT rather than BEGIN IMMEDIATE: `setupSchema` is called from
 * several entry points (`src/db.js`, `src/migrate.js`, `bin/lib/install_lifecycle.js`)
 * and at least one of them may already hold a transaction. SAVEPOINT is atomic
 * on its own and also nests correctly, so one code path covers both cases.
 */
function _repairCodeChunksFts(conn) {
  if (!hasFts5Support(conn)) return;
  const hasCodeChunks = Boolean(
    conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'code_chunks'").get()
  );
  if (!hasCodeChunks) return;
  const { ensureCodeChunksFts } = require('./code_intel/ddl');
  ensureCodeChunksFts(conn);
}

function _applyCodeIntelligenceMigration(conn, ftsSupported = hasFts5Support(conn)) {
  if (getCurrentUserVersion(conn) >= CURRENT_SCHEMA_VERSION) {
    conn.exec(CODE_INTELLIGENCE_DDL);
    applyV7AdditiveColumns(conn);
    if (!hasCanonicalCodeChunksLayout(conn)) {
      conn.exec(CODE_INTELLIGENCE_V7_DDL);
      ensureCodeChunksCanonicalLayout(conn, ftsSupported);
    }
    _repairCodeChunksFts(conn);
    return;
  }
  conn.exec('SAVEPOINT konoha_code_intel_migration');
  try {
    conn.exec(CODE_INTELLIGENCE_DDL);
    if (ftsSupported) conn.exec(CODE_INTELLIGENCE_FTS_DDL);
    applyV7AdditiveColumns(conn);
    ensureCodeChunksCanonicalLayout(conn, ftsSupported);
    conn.exec(CODE_INTELLIGENCE_V7_DDL);
    const violations = conn.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`${violations.length} foreign key violation(s) introduced by the code-intelligence migration`);
    }
    conn.exec('RELEASE konoha_code_intel_migration');
  } catch (err) {
    try {
      conn.exec('ROLLBACK TO konoha_code_intel_migration');
      conn.exec('RELEASE konoha_code_intel_migration');
    } catch (_) { /* intentional best-effort fallback */ }
    throw new Error(`CODE_INTEL_MIGRATION_FAILED: ${err.message}`);
  }
}

function _migrateActiveSessionsPk(conn) {
  const sessionCols = conn.prepare("PRAGMA table_info(active_sessions)").all();
  if (sessionCols.length === 0) return;
  const hasProjectHash = sessionCols.some(c => c.name === 'project_hash');
  const pkCols = sessionCols.filter(c => c.pk > 0);
  const hasSessionIdPk = pkCols.some(c => c.name === 'session_id');
  if (hasProjectHash && hasSessionIdPk) return;

  conn.exec('SAVEPOINT konoha_active_sessions_mig');
  try {
    conn.exec(`
      DROP TABLE IF EXISTS active_sessions_migrated;
      CREATE TABLE active_sessions_migrated (
          client TEXT NOT NULL,
          workspace_root TEXT NOT NULL,
          session_id TEXT NOT NULL,
          project_hash TEXT,
          transcript_path TEXT,
          last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (client, workspace_root, session_id)
      );
      INSERT OR IGNORE INTO active_sessions_migrated (client, workspace_root, session_id, transcript_path, last_active_at)
      SELECT client, workspace_root, session_id, transcript_path, last_active_at
      FROM active_sessions;
      DROP TABLE active_sessions;
      ALTER TABLE active_sessions_migrated RENAME TO active_sessions;
    `);
    conn.exec('RELEASE konoha_active_sessions_mig');
  } catch (err) {
    try {
      conn.exec('ROLLBACK TO konoha_active_sessions_mig; RELEASE konoha_active_sessions_mig;');
    } catch (_) { /* ignore nested rollback failure */ }
    throw new Error(`ACTIVE_SESSIONS_MIGRATION_FAILED: ${err.message}`);
  }
}

function _tryExecSql(conn, sql) {
  try {
    conn.exec(sql);
  } catch (_) { /* intentional best-effort fallback */ }
}

function _syncCoreFts5(conn, ftsSupported) {
  if (!ftsSupported) {
    _tryExecSql(conn, `
      DROP TRIGGER IF EXISTS skills_ai;
      DROP TRIGGER IF EXISTS skills_ad;
      DROP TRIGGER IF EXISTS skills_au;
      DROP TRIGGER IF EXISTS persona_memories_ai;
      DROP TRIGGER IF EXISTS persona_memories_ad;
      DROP TRIGGER IF EXISTS persona_memories_au;
    `);
    return;
  }
  _tryExecSql(conn, `
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts
    USING fts5(
        name,
        skill_name,
        tags,
        content,
        content=skills,
        content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, skill_name, tags, content)
        VALUES (new.rowid, new.name, new.skill_name, new.tags, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, tags, content)
        VALUES('delete', old.rowid, old.name, old.skill_name, old.tags, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, tags, content)
        VALUES('delete', old.rowid, old.name, old.skill_name, old.tags, old.content);
        INSERT INTO skills_fts(rowid, name, skill_name, tags, content)
        VALUES (new.rowid, new.name, new.skill_name, new.tags, new.content);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS persona_memories_fts USING fts5(
        id UNINDEXED,
        project_hash,
        agent_name,
        title,
        content,
        tags,
        content='persona_memories',
        content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS persona_memories_ai AFTER INSERT ON persona_memories BEGIN
        INSERT INTO persona_memories_fts(rowid, id, project_hash, agent_name, title, content, tags)
        VALUES (new.rowid, new.id, new.project_hash, new.agent_name, new.title, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS persona_memories_ad AFTER DELETE ON persona_memories BEGIN
        INSERT INTO persona_memories_fts(persona_memories_fts, rowid, id, project_hash, agent_name, title, content, tags)
        VALUES('delete', old.rowid, old.id, old.project_hash, old.agent_name, old.title, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS persona_memories_au AFTER UPDATE ON persona_memories BEGIN
        INSERT INTO persona_memories_fts(persona_memories_fts, rowid, id, project_hash, agent_name, title, content, tags)
        VALUES('delete', old.rowid, old.id, old.project_hash, old.agent_name, old.title, old.content, old.tags);
        INSERT INTO persona_memories_fts(rowid, id, project_hash, agent_name, title, content, tags)
        VALUES (new.rowid, new.id, new.project_hash, new.agent_name, new.title, new.content, new.tags);
    END;
  `);
}

function _applyCoreColumnAndIndexMigrations(conn, ftsSupported) {
  const colSqls = [
    "ALTER TABLE tool_calls ADD COLUMN agent TEXT;",
    "ALTER TABLE tool_calls ADD COLUMN client TEXT;",
    "ALTER TABLE persona_memories ADD COLUMN project_hash TEXT DEFAULT '';",
    "ALTER TABLE persona_memories ADD COLUMN session_id TEXT DEFAULT '';",
    "ALTER TABLE sdlc_tasks ADD COLUMN session_id TEXT DEFAULT '';",
    "ALTER TABLE sdlc_tasks ADD COLUMN client TEXT DEFAULT '';",
    "ALTER TABLE agents ADD COLUMN model TEXT;",
    "ALTER TABLE projects ADD COLUMN dor_mode TEXT DEFAULT 'advisory';",
    "ALTER TABLE projects ADD COLUMN review_mode TEXT DEFAULT 'self';",
    "ALTER TABLE projects ADD COLUMN advisor_mode TEXT DEFAULT 'realtime-idle';",
    "ALTER TABLE projects ADD COLUMN advisor_max_tokens INTEGER DEFAULT 8192;",
    "ALTER TABLE projects ADD COLUMN agent_input_token_quota INTEGER DEFAULT 100000;",
    "ALTER TABLE tool_calls ADD COLUMN cached_tokens INTEGER;",
    "ALTER TABLE tool_calls ADD COLUMN input_tokens INTEGER;",
    "ALTER TABLE tool_calls ADD COLUMN output_tokens INTEGER;"
  ];
  for (const sql of colSqls) _tryExecSql(conn, sql);
  _ensureAgentsColumns(conn);

  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(type);
    CREATE INDEX IF NOT EXISTS idx_skills_skill_name ON skills(skill_name);
    CREATE INDEX IF NOT EXISTS idx_skill_chunks_skill ON skill_chunks(skill_name);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_client ON tool_calls(client);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path);
    CREATE INDEX IF NOT EXISTS idx_mem_agent ON persona_memories(agent_name);
    CREATE INDEX IF NOT EXISTS idx_mem_type ON persona_memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_mem_project ON persona_memories(project_hash);
    CREATE INDEX IF NOT EXISTS idx_mem_session ON persona_memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_status ON sdlc_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_project ON sdlc_tasks(project_path);
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_session ON sdlc_tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_client ON sdlc_tasks(client);
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_updated ON sdlc_tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_ws ON active_sessions(workspace_root);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_client ON active_sessions(client);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_last_active ON active_sessions(last_active_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_queue_status ON prompt_queue(status);
    CREATE INDEX IF NOT EXISTS idx_prompt_queue_created ON prompt_queue(created_at);
  `);

  try {
    const queueCols = conn.prepare("PRAGMA table_info(prompt_queue)").all().map(c => c.name);
    if (!queueCols.includes('workspace_root')) conn.exec("ALTER TABLE prompt_queue ADD COLUMN workspace_root TEXT DEFAULT ''");
    if (!queueCols.includes('client')) conn.exec("ALTER TABLE prompt_queue ADD COLUMN client TEXT DEFAULT ''");
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    conn.prepare("INSERT OR IGNORE INTO telegram_config (id, enabled, mode, transport, updated_at) VALUES (1, 0, 'one_way', 'polling', ?)").run(new Date().toISOString());
  } catch (_) { /* intentional best-effort fallback */ }

  _tryExecSql(conn, 'DROP TABLE IF EXISTS tunnel_config; DROP TABLE IF EXISTS persona_memories_migrated; DROP TABLE IF EXISTS active_sessions_migrated;');
  try { conn.prepare('DELETE FROM skill_chunks WHERE embedding IS NOT NULL AND length(embedding) != 1536').run(); } catch (_) { /* intentional best-effort fallback */ }
  try { conn.prepare("DELETE FROM agents WHERE name LIKE 'mcp_%'").run(); } catch (_) { /* intentional best-effort fallback */ }

  if (ftsSupported) {
    _tryExecSql(conn, "INSERT INTO skills_fts(skills_fts) VALUES('rebuild')");
    _tryExecSql(conn, "INSERT INTO persona_memories_fts(persona_memories_fts) VALUES('rebuild')");
  }

  try {
    const agentCols = new Set(conn.prepare('PRAGMA table_info(agents)').all().map(c => c.name));
    if (agentCols.has('claude_model')) conn.prepare('ALTER TABLE agents DROP COLUMN claude_model').run();
    if (agentCols.has('cursor_model')) conn.prepare('ALTER TABLE agents DROP COLUMN cursor_model').run();
  } catch (_) { /* intentional best-effort fallback */ }

  _tryExecSql(conn, `
    CREATE INDEX IF NOT EXISTS idx_sdlc_tasks_status_updated ON sdlc_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_persona_memories_agent_proj ON persona_memories(agent_name, project_hash);
  `);
}

function _verifyPostMigrationOrThrow(conn) {
  if (!verifyIntegrity(conn)) {
    let detail = 'unknown';
    try {
      const row = conn.prepare('PRAGMA integrity_check').get();
      detail = String(row ? (row.integrity_check !== undefined ? row.integrity_check : Object.values(row)[0]) : 'no result');
    } catch (_) { /* intentional best-effort fallback */ }
    throw new Error(`SCHEMA INTEGRITY FAILURE: PRAGMA integrity_check returned '${detail}'`);
  }
  const fkViolations = conn.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) {
    throw new Error(`FOREIGN KEY VIOLATION: ${fkViolations.length} constraint violation(s) remain after migration`);
  }
  const canonicalCheck = validateCanonicalSchema(conn);
  if (!canonicalCheck.valid) {
    throw new Error(`CANONICAL SCHEMA FAILURE: ${canonicalCheck.errors.join('; ')}`);
  }
}

function setupSchema(conn, backupDatabaseFn = null) {
  const ftsSupported = hasFts5Support(conn);
  const initialVersion = getCurrentUserVersion(conn);
  const backupInfo = createAndVerifyPreMigrationBackup(conn, backupDatabaseFn, {
    currentVersion: initialVersion,
    targetVersion: CURRENT_SCHEMA_VERSION
  });

  conn.exec('SAVEPOINT konoha_setup_schema');
  try {
    if (ftsSupported) _dropLegacyPersonaMemoriesFts(conn);
    conn.exec(CORE_SCHEMA_DDL);
    _migratePersonaMemoriesForeignKey(conn);
    _tryExecSql(conn, "ALTER TABLE projects ADD COLUMN hitl_mode TEXT DEFAULT 'enabled';");
    _migrateActiveSessionsPk(conn);
    _backfillActiveSessionsProjectHash(conn);
    _purgeLegacyDbArtifacts(conn);
    _syncCoreFts5(conn, ftsSupported);
    _applyCoreColumnAndIndexMigrations(conn, ftsSupported);

    // Yamanaka 3D Subsystem Canonical Schema & Legacy Table Purge
    const { purgeLegacy3DTables, verifyAndApplyCanonicalSchema, applyQualityLadderMigration, ensureAdditiveColumns } = require('./mcp/three_asset/db_3d_schema');
    const { applyProfileVocabularyMigration } = require('./mcp/three_asset/profile_vocabulary_migration');
    purgeLegacy3DTables(conn);
    verifyAndApplyCanonicalSchema(conn);
    applyQualityLadderMigration(conn);
    applyProfileVocabularyMigration(conn);
    // The ladder rebuild copies columns by position, so post-rebuild additive columns
    // (including the refine-fork lineage columns) are re-applied afterwards.
    ensureAdditiveColumns(conn);

    // Migration v6/v7: native code intelligence index + canonical layout verification.
    _applyCodeIntelligenceMigration(conn, ftsSupported);
    _verifyPostMigrationOrThrow(conn);

    setUserVersion(conn, CURRENT_SCHEMA_VERSION);
    conn.exec('RELEASE konoha_setup_schema');
  } catch (err) {
    try {
      conn.exec('ROLLBACK TO konoha_setup_schema; RELEASE konoha_setup_schema;');
    } catch (_) { /* ignore rollback error */ }
    if (backupInfo && backupInfo.backupPath && err && typeof err === 'object') {
      err.backupPath = backupInfo.backupPath;
    }
    throw err;
  }

  return conn;
}

/**
 * Seed Kali tools into SQLite table from local JSON catalog if empty.
 *
 * @param {Object} conn
 */
function _validateAgentsColumns(conn, errors) {
  const agentCols = new Set(conn.prepare('PRAGMA table_info(agents)').all().map(c => c.name));
  if (agentCols.has('claude_model')) errors.push("Legacy column 'agents.claude_model' must not exist");
  if (agentCols.has('cursor_model')) errors.push("Legacy column 'agents.cursor_model' must not exist");
  for (const [col] of AGENT_SCHEMA_COLUMNS) {
    if (!agentCols.has(col)) {
      errors.push(`Required column 'agents.${col}' is missing`);
    }
  }
}

/**
 * Validate that the database contains strictly canonical tables, columns,
 * vector dimensions (384 float32), and zero orphaned or duplicate records.
 *
 * @param {Object} conn
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCanonicalSchema(conn) {
  const errors = [];
  try {
    const tables = new Set(
      conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    );

    // Assert absence of legacy tables
    const forbiddenTables = ['tunnel_config', 'persona_memories_migrated', 'active_sessions_migrated', 'skills_legacy', 'model_assets', 'model_asset_chunks', 'yamanaka_models_old', 'three_assets_v1', 'mesh_cache_alias', 'roblox_models'];
    for (const forbidden of forbiddenTables) {
      if (tables.has(forbidden)) {
        errors.push(`Legacy table '${forbidden}' must not exist`);
      }
    }

    // Assert presence of mandatory canonical tables
    const requiredTables = [
      'skills', 'skill_chunks', 'tool_calls', 'active_sessions',
      'agents', 'bridges', 'projects', 'sdlc_tasks', 'persona_memories',
      'telegram_config', 'webhooks', 'prompt_queue', 'telegram_session_targets',
      'schema_migrations', 'generation_jobs', 'assets',
      'asset_files', 'validation_results', 'llm_requests_3d',
      'code_index_roots', 'code_files', 'code_symbols', 'code_refs', 'code_chunks',
      'code_edges'
    ];
    for (const req of requiredTables) {
      if (!tables.has(req)) {
        errors.push(`Required canonical table '${req}' is missing`);
      }
    }

    if (tables.has('agents')) {
      _validateAgentsColumns(conn, errors);
    }

    if (tables.has('code_chunks') && !hasCanonicalCodeChunksLayout(conn)) {
      errors.push("Canonical layout mismatch on 'code_chunks' columns");
    }

    // Assert vector chunk dimension (384 float32 = 1536 bytes)
    if (tables.has('skill_chunks')) {
      const invalidChunks = conn.prepare(
        'SELECT COUNT(*) as count FROM skill_chunks WHERE embedding IS NOT NULL AND length(embedding) != 1536'
      ).get();
      const count = invalidChunks ? (invalidChunks.count || 0) : 0;
      if (count > 0) {
        errors.push(`Found ${count} stale vector chunk(s) not matching 384 dimensions (1536 bytes)`);
      }
    }

    // Assert zero duplicate skill names
    if (tables.has('skills')) {
      const dupSkills = conn.prepare(
        'SELECT name, COUNT(*) as count FROM skills GROUP BY name HAVING COUNT(*) > 1'
      ).all();
      if (dupSkills.length > 0) {
        errors.push(`Found duplicate skill name(s): ${dupSkills.map(d => d.name).join(', ')}`);
      }
    }
  } catch (err) {
    errors.push(`Schema validation threw exception: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  getCurrentUserVersion,
  setUserVersion,
  verifyIntegrity,
  hasFts5Support,
  setupSchema,
  ensureSchema,
  validateCanonicalSchema
};
