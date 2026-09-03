"""
Canonical database access layer for Konoha (skills.db).
Owns DB_PATH, connection pragmas, vector extension loading, and the unified schema.
"""

import os
import sqlite3
from typing import Optional

# Single canonical declaration of DB_PATH
DB_PATH = os.path.normpath(os.path.expanduser("~/.konoha/skills.db"))


def get_connection(db_path: Optional[str] = None, load_vector: bool = True) -> sqlite3.Connection:
    """
    Opens connection, sets row_factory = sqlite3.Row,
    PRAGMA journal_mode=WAL, PRAGMA foreign_keys=ON, PRAGMA busy_timeout=5000,
    and conditionally loads the sqlite-vector extension if present.
    """
    target_path = os.path.normpath(db_path if db_path is not None else DB_PATH)
    os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
    conn = sqlite3.connect(target_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA synchronous=NORMAL;")

    if load_vector:
        try:
            import vector_search
            if vector_search.is_semantic_search_enabled():
                vector_search.load_vector_extension(conn)
        except Exception:
            pass

    return conn


def setup_schema(conn: sqlite3.Connection) -> sqlite3.Connection:
    """
    Single canonical executescript() containing every table, virtual table,
    trigger, and index for Konoha (including vector search skill_chunks).
    """
    conn.executescript("""
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
    """)

    # Column additions / migration guards for existing databases
    for col_sql in (
        "ALTER TABLE tool_calls ADD COLUMN agent TEXT;",
        "ALTER TABLE tool_calls ADD COLUMN client TEXT;",
        "ALTER TABLE persona_memories ADD COLUMN project_hash TEXT DEFAULT '';",
    ):
        try:
            conn.execute(col_sql)
        except sqlite3.OperationalError:
            pass

    # Performance indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(type);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_skills_skill_name ON skills(skill_name);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_skill_chunks_skill ON skill_chunks(skill_name);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tool_calls_client ON tool_calls(client);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_agent ON persona_memories(agent_name);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_type ON persona_memories(memory_type);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_project ON persona_memories(project_hash);")

    conn.commit()

    return conn
