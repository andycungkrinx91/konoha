'use strict';

// Core canonical-table DDL extracted from setupSchema so db_schema.js stays under the 700-line cap.

const CORE_SCHEMA_DDL = `
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

    -- Soul-bound archetype directives: every ninja soul served from SQLite,
    -- never from raw Markdown reads at dispatch time.
    CREATE TABLE IF NOT EXISTS soul_archetypes (
        agent_name TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        voice TEXT NOT NULL,
        calling TEXT NOT NULL,
        antislop_skills TEXT NOT NULL DEFAULT '[]',
        adhd_shaping TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'sqlite',
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        mode TEXT CHECK (mode IN ('one_way', 'two_way')) DEFAULT 'one_way',
        transport TEXT CHECK (transport IN ('polling')) DEFAULT 'polling',
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

    CREATE TABLE IF NOT EXISTS lg_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB,
        metadata BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    );

    CREATE TABLE IF NOT EXISTS lg_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_path TEXT NOT NULL DEFAULT '',
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
    );
  `;

module.exports = { CORE_SCHEMA_DDL };
