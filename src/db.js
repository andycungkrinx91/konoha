/**
 * Canonical database access layer for Konoha (skills.db) using better-sqlite3.
 * Owns DB_PATH, connection pragmas, vector extension loading, and the unified schema.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

// Single canonical declaration of DB_PATH
let currentDbPath = path.normalize(path.join(os.homedir(), '.konoha', 'konoha.db'));

/**
 * Opens connection, sets PRAGMA journal_mode=WAL, foreign_keys=ON, busy_timeout=5000,
 * synchronous=NORMAL, and conditionally loads sqlite-vector extension if present and enabled.
 */
function getConnection(dbPath = null, loadVector = true) {
  const targetPath = path.normalize(dbPath !== null ? dbPath : currentDbPath);
  const dir = path.dirname(path.resolve(targetPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Auto-migrate legacy skills.db to konoha.db if konoha.db does not exist yet
  if (!fs.existsSync(targetPath)) {
    const legacyPath = path.join(dir, 'skills.db');
    if (fs.existsSync(legacyPath)) {
      try {
        fs.copyFileSync(legacyPath, targetPath);
        if (fs.existsSync(legacyPath + '-wal')) {
          try { fs.copyFileSync(legacyPath + '-wal', targetPath + '-wal'); } catch (_) {}
        }
        if (fs.existsSync(legacyPath + '-shm')) {
          try { fs.copyFileSync(legacyPath + '-shm', targetPath + '-shm'); } catch (_) {}
        }
      } catch (_) {}
    }
  }

  const db = new Database(targetPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  if (loadVector) {
    try {
      const vectorSearch = require('./vector_search');
      if (vectorSearch.isSemanticSearchEnabled && vectorSearch.isSemanticSearchEnabled()) {
        if (typeof vectorSearch.loadVectorExtension === 'function') {
          vectorSearch.loadVectorExtension(db);
        }
      }
    } catch (_) {
      // Graceful fallback if vector_search is not yet loaded or fails
    }
  }

  return db;
}

/**
 * Single canonical executescript / exec containing every table, virtual table,
 * trigger, and index for Konoha (including vector search skill_chunks).
 */
function setupSchema(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT,
        content TEXT,
        file_path TEXT,
        byte_size INTEGER,
        line_count INTEGER
    );

    -- FTS5 virtual table for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts
    USING fts5(
        name,
        skill_name,
        tags,
        content,
        content=skills,
        content_rowid=rowid
    );

    -- Triggers to keep FTS index in sync
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

    -- Skill chunks table for semantic / vector search
    CREATE TABLE IF NOT EXISTS skill_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_name TEXT NOT NULL REFERENCES skills(name),
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding BLOB
    );

    -- Table to store tool call statistics and token savings
    CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tool TEXT NOT NULL,
        query TEXT,
        returned_bytes INTEGER,
        total_library_bytes INTEGER,
        bytes_saved INTEGER,
        tokens_saved INTEGER,
        agent TEXT,
        client TEXT
    );

    -- Table to store active sessions to prevent cross-session pollution
    CREATE TABLE IF NOT EXISTS active_sessions (
        client TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        session_id TEXT NOT NULL,
        transcript_path TEXT,
        last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client, workspace_root)
    );

    -- Agents table
    CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        icon TEXT,
        title TEXT,
        model_tier TEXT,
        purpose TEXT,
        skills TEXT,
        delegate_when TEXT,
        constraints_text TEXT,
        workflow TEXT,
        description TEXT,
        instructions TEXT,
        delegation_keywords TEXT,
        cursor_fallback_model TEXT,
        enable_mcp_tools INTEGER NOT NULL DEFAULT 1
    );

    -- Bridges table
    CREATE TABLE IF NOT EXISTS bridges (
        name TEXT PRIMARY KEY,
        port INTEGER NOT NULL,
        provider TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_url TEXT,
        api_key TEXT
    );

    -- Projects metadata table
    CREATE TABLE IF NOT EXISTS projects (
        project_hash TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        framework TEXT DEFAULT 'Unknown',
        styling TEXT DEFAULT 'Standard CSS',
        package_manager TEXT DEFAULT 'pnpm',
        context_summary TEXT DEFAULT '',
        tech_stack TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- Persona memories table
    CREATE TABLE IF NOT EXISTS persona_memories (
        id TEXT PRIMARY KEY,
        project_hash TEXT DEFAULT '',
        agent_name TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        importance INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- FTS5 virtual table for persona memories
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
  `);

  // Column additions / migration guards for existing databases
  const colSqls = [
    "ALTER TABLE tool_calls ADD COLUMN agent TEXT;",
    "ALTER TABLE tool_calls ADD COLUMN client TEXT;",
    "ALTER TABLE persona_memories ADD COLUMN project_hash TEXT DEFAULT '';",
  ];
  for (const sql of colSqls) {
    try {
      conn.exec(sql);
    } catch (_) {
      // Column already exists
    }
  }

  // Performance indexes
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
  `);

  // Purge any legacy mcp_* agents from authoritative database
  try {
    conn.prepare("DELETE FROM agents WHERE name LIKE 'mcp_%'").run();
  } catch (_) {}

  return conn;
}

function sanitizeFts5Query(query) {
  if (!query || typeof query !== 'string') return '';
  let q = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const nears = [];
  q = q.replace(/\bNEAR\s*\(([^)]*)\)/gi, (match) => {
    const validPattern = /^NEAR\(\s*[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)+(?:\s*,\s*\d+)?\s*\)$/i;
    if (validPattern.test(match)) {
      const innerMatch = match.match(/\(([^)]*)\)/);
      const innerCleaned = (innerMatch ? innerMatch[1] : '').trim().split(/\s+/).join(' ');
      const placeholder = `__NEAR_PLACEHOLDER_${nears.length}__`;
      nears.push(`NEAR(${innerCleaned})`);
      return placeholder;
    } else {
      const innerMatch = match.match(/\(([^)]*)\)/);
      const innerText = innerMatch ? innerMatch[1] : '';
      return `near ${innerText}`;
    }
  });

  q = q.replace(/[^\p{L}\p{N}_\s*()"]/gu, ' ');
  if ((q.match(/"/g) || []).length % 2 !== 0) {
    q = q.replace(/"/g, ' ');
  }
  if ((q.match(/\(/g) || []).length !== (q.match(/\)/g) || []).length) {
    q = q.replace(/[()]/g, ' ');
  }
  q = q.replace(/(?<![a-zA-Z0-9])\*/g, ' ');
  q = q.replace(/\*(?=[a-zA-Z0-9])/g, ' ');

  for (let i = 0; i < nears.length; i++) {
    q = q.replace(`__NEAR_PLACEHOLDER_${i}__`, nears[i]);
  }

  const words = q.trim().split(/\s+/).filter(Boolean);
  const sanitizedWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wUpper = w.toUpperCase();
    if (['AND', 'OR', 'NOT'].includes(wUpper)) {
      let isDangling = false;
      if (i === 0 || i === words.length - 1) {
        isDangling = true;
      } else {
        const prevW = words[i - 1].toUpperCase();
        const nextW = words[i + 1].toUpperCase();
        if (['AND', 'OR', 'NOT'].includes(prevW) || ['AND', 'OR', 'NOT'].includes(nextW)) {
          isDangling = true;
        }
      }
      if (isDangling) sanitizedWords.push(w.toLowerCase());
      else sanitizedWords.push(wUpper);
    } else if (wUpper === 'NEAR') {
      sanitizedWords.push(w.toLowerCase());
    } else {
      sanitizedWords.push(w);
    }
  }
  return sanitizedWords.join(' ');
}

module.exports = {
  get DB_PATH() { return currentDbPath; },
  set DB_PATH(val) { currentDbPath = val; },
  getConnection,
  get_connection: getConnection,
  getDb: getConnection,
  sanitizeFts5Query,
  sanitize_fts5_query: sanitizeFts5Query,
  setupSchema,
  setup_schema: setupSchema
};
