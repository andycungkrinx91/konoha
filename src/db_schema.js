'use strict';

const fs = require('fs');

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

function setupSchema(conn, backupDatabaseFn = null) {
  const ftsSupported = hasFts5Support(conn);

  if (ftsSupported) {
    try {
      const legacyFtsCols = conn.prepare("PRAGMA table_info(persona_memories_fts)").all().map(c => c.name);
      if (legacyFtsCols.length > 0 && !legacyFtsCols.includes('project_hash')) {
        conn.exec('DROP TABLE persona_memories_fts');
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

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

    CREATE TABLE IF NOT EXISTS skill_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_name TEXT NOT NULL REFERENCES skills(name) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding BLOB
    );

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

    CREATE TABLE IF NOT EXISTS active_sessions (
        client TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_hash TEXT,
        transcript_path TEXT,
        last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client, workspace_root, session_id)
    );

    CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        icon TEXT,
        title TEXT,
        model TEXT,
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

    CREATE TABLE IF NOT EXISTS bridges (
        name TEXT PRIMARY KEY,
        port INTEGER NOT NULL,
        provider TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_url TEXT,
        api_key TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
        project_hash TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        project_name TEXT NOT NULL,
        framework TEXT DEFAULT 'Unknown',
        styling TEXT DEFAULT 'Standard CSS',
        package_manager TEXT DEFAULT 'pnpm',
        context_summary TEXT DEFAULT '',
        tech_stack TEXT DEFAULT '{}',
        dor_mode TEXT DEFAULT 'advisory',
        review_mode TEXT DEFAULT 'self',
        hitl_mode TEXT DEFAULT 'enabled',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS persona_memories (
        id TEXT PRIMARY KEY,
        project_hash TEXT DEFAULT NULL,
        session_id TEXT DEFAULT '',
        agent_name TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        importance INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_hash) REFERENCES projects(project_hash) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        mode TEXT CHECK (mode IN ('one_way', 'two_way')) DEFAULT 'one_way',
        transport TEXT CHECK (transport IN ('polling', 'cloudflare', 'ngrok')) DEFAULT 'polling',
        bot_token TEXT DEFAULT '',
        chat_id TEXT DEFAULT '',
        webhook_secret TEXT DEFAULT '',
        last_notified_at TEXT,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        auth_type TEXT CHECK (auth_type IN ('none', 'bearer', 'api_key', 'jwt', 'custom_header')) DEFAULT 'none',
        auth_token TEXT DEFAULT '',
        custom_header TEXT DEFAULT '',
        events TEXT DEFAULT 'all',
        last_status INTEGER DEFAULT NULL,
        last_delivered_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tunnel_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        provider TEXT CHECK (provider IN ('cloudflare', 'ngrok')) DEFAULT 'cloudflare',
        mode TEXT CHECK (mode IN ('ephemeral', 'named')) DEFAULT 'ephemeral',
        token TEXT DEFAULT '',
        custom_domain TEXT DEFAULT '',
        auth_pin TEXT DEFAULT '',
        public_url TEXT DEFAULT '',
        active_pid INTEGER DEFAULT 0,
        started_at TEXT,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_queue (
        id TEXT PRIMARY KEY,
        source TEXT CHECK (source IN ('web_ui', 'telegram', 'cli')) NOT NULL,
        sender_info TEXT DEFAULT '',
        prompt TEXT NOT NULL,
        status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
        session_id TEXT DEFAULT '',
        workspace_root TEXT DEFAULT '',
        client TEXT DEFAULT '',
        result_summary TEXT DEFAULT '',
        token_savings_percent REAL DEFAULT 0,
        kage_confidence_score INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        processed_at TEXT,
        completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_session_targets (
        chat_id TEXT PRIMARY KEY,
        client TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    const memFks = conn.prepare("PRAGMA foreign_key_list(persona_memories)").all();
    const hasProjectFk = memFks.some(fk => fk.table === 'projects');
    if (!hasProjectFk) {
      if (typeof backupDatabaseFn === 'function' && conn.name && conn.name !== ':memory:' && fs.existsSync(conn.name)) {
        try {
          backupDatabaseFn(null, conn.name);
        } catch (_) { /* backup helper fallback */ }
      }
      conn.exec(`
        BEGIN TRANSACTION;
        DELETE FROM persona_memories
        WHERE project_hash IS NOT NULL
          AND project_hash != ''
          AND project_hash NOT IN (SELECT project_hash FROM projects);

        CREATE TABLE IF NOT EXISTS persona_memories_migrated (
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
        COMMIT;
      `);
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    conn.exec("ALTER TABLE projects ADD COLUMN hitl_mode TEXT DEFAULT 'enabled';");
  } catch (_) { /* column already exists */ }

  try {
    const sessionCols = conn.prepare("PRAGMA table_info(active_sessions)").all();
    const hasProjectHash = sessionCols.some(c => c.name === 'project_hash');
    const pkCols = sessionCols.filter(c => c.pk > 0);
    const hasSessionIdPk = pkCols.some(c => c.name === 'session_id');

    if (!hasProjectHash || !hasSessionIdPk) {
      conn.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE IF NOT EXISTS active_sessions_migrated (
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
        COMMIT;
      `);
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const unhashedRows = conn.prepare("SELECT rowid, workspace_root FROM active_sessions WHERE project_hash IS NULL OR project_hash = ''").all();
    if (unhashedRows.length > 0) {
      const personaMemory = require('./persona_memory');
      const updateStmt = conn.prepare("UPDATE active_sessions SET project_hash = ? WHERE rowid = ?");
      for (const r of unhashedRows) {
        if (r.workspace_root) {
          const ph = personaMemory.computeProjectHash(r.workspace_root);
          if (ph) updateStmt.run(ph, r.rowid);
        }
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }

  if (ftsSupported) {
    try {
      conn.exec(`
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
    } catch (_) { /* intentional best-effort fallback if FTS5 creation fails */ }
  } else {
    try {
      conn.exec(`
        DROP TRIGGER IF EXISTS skills_ai;
        DROP TRIGGER IF EXISTS skills_ad;
        DROP TRIGGER IF EXISTS skills_au;
        DROP TRIGGER IF EXISTS persona_memories_ai;
        DROP TRIGGER IF EXISTS persona_memories_ad;
        DROP TRIGGER IF EXISTS persona_memories_au;
      `);
    } catch (_) { /* intentional best-effort fallback */ }
  }

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
  ];
  for (const sql of colSqls) {
    try {
      conn.exec(sql);
    } catch (_) {
      // Column already exists
    }
  }

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
    if (!queueCols.includes('workspace_root')) {
      conn.exec("ALTER TABLE prompt_queue ADD COLUMN workspace_root TEXT DEFAULT ''");
    }
    if (!queueCols.includes('client')) {
      conn.exec("ALTER TABLE prompt_queue ADD COLUMN client TEXT DEFAULT ''");
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const now = new Date().toISOString();
    conn.prepare("INSERT OR IGNORE INTO telegram_config (id, enabled, mode, transport, updated_at) VALUES (1, 0, 'one_way', 'polling', ?)").run(now);
    conn.prepare("INSERT OR IGNORE INTO tunnel_config (id, enabled, provider, mode, updated_at) VALUES (1, 0, 'cloudflare', 'ephemeral', ?)").run(now);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    conn.prepare("DELETE FROM agents WHERE name LIKE 'mcp_%'").run();
  } catch (_) { /* intentional best-effort fallback */ }

  if (ftsSupported) {
    try {
      conn.exec("INSERT INTO persona_memories_fts(persona_memories_fts) VALUES('rebuild')");
    } catch (_) { /* intentional best-effort fallback */ }
  }

  try {
    const agentCols = new Set(conn.prepare('PRAGMA table_info(agents)').all().map(c => c.name));
    for (const legacy of ['claude_model', 'cursor_model']) {
      if (agentCols.has(legacy)) {
        conn.prepare(`ALTER TABLE agents DROP COLUMN ${legacy}`).run();
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }

  return conn;
}

module.exports = {
  hasFts5Support,
  setupSchema
};
