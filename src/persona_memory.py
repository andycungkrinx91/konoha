#!/usr/bin/env python3
"""
src/persona_memory.py — Embedding-Free Persona & Memory Manager for Konoha.
Persists agent rules, preferences, patterns, and episodic learnings directly
in SQLite (~/.konoha/skills.db) with SQLite FTS5 full-text indexing.
"""

import os
import sys
import sqlite3
import json
import time
import uuid
import re
from typing import List, Dict, Any, Optional

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


def get_db(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Get SQLite database connection with WAL mode enabled."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def init_memory_tables(conn: sqlite3.Connection):
    """Initializes persona memory tables and FTS5 search index."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS persona_memories (
            id TEXT PRIMARY KEY,
            agent_name TEXT NOT NULL,
            memory_type TEXT NOT NULL, -- 'rule', 'preference', 'episodic', 'pattern', 'architecture'
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            importance INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_agent ON persona_memories(agent_name);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_type ON persona_memories(memory_type);")

    # FTS5 virtual table for fast full-text keyword retrieval without embeddings
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS persona_memories_fts USING fts5(
            id UNINDEXED,
            agent_name,
            title,
            content,
            tags,
            content='persona_memories',
            content_rowid='rowid'
        )
    """)
    conn.commit()


def save_memory(
    agent_name: str,
    content: str,
    title: str = "",
    memory_type: str = "rule",
    tags: str = "",
    importance: int = 1,
    db_path: str = DB_PATH
) -> str:
    """
    Save or update a persona memory / rule for an agent.
    Returns the generated memory ID.
    """
    if not content or not content.strip():
        raise ValueError("Memory content cannot be empty.")

    clean_agent = agent_name.lower().strip()
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]

    if not title:
        # Generate title from first line / 50 characters of content
        first_line = content.strip().split("\n")[0].lstrip("#*- ").strip()
        title = first_line[:60] if first_line else f"{clean_agent} memory"

    mem_id = str(uuid.uuid4())[:8]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        conn.execute("""
            INSERT INTO persona_memories (id, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (mem_id, clean_agent, memory_type, title, content.strip(), tags, importance, now, now))

        # Synchronize FTS5 virtual index
        conn.execute("""
            INSERT INTO persona_memories_fts (id, agent_name, title, content, tags)
            VALUES (?, ?, ?, ?, ?)
        """, (mem_id, clean_agent, title, content.strip(), tags))
        conn.commit()
    finally:
        conn.close()

    return mem_id


def query_memories(
    agent_name: Optional[str] = None,
    query: str = "",
    memory_type: Optional[str] = None,
    limit: int = 5,
    db_path: str = DB_PATH
) -> List[Dict[str, Any]]:
    """
    Query saved persona memories by agent and keyword using FTS5 with fallback.
    If agent_name is None, empty, or 'all', searches across all agents.
    """
    clean_agent = agent_name.lower().strip() if agent_name else ""
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]
    is_all = (not clean_agent or clean_agent == "all" or clean_agent == "global")

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)

        if query and query.strip():
            # Sanitize search tokens to prevent FTS5 syntax errors, stripping all punctuation/backslashes
            clean_q = re.sub(r'[^\w\s]', ' ', query, flags=re.UNICODE)
            tokens = [t.strip() for t in clean_q.split() if len(t.strip()) > 1 and t.lower() not in ('and', 'or', 'not')]
            if tokens:
                fts_expr = " OR ".join(f'"{t}"' for t in tokens)
                try:
                    if is_all:
                        sql = """
                            SELECT m.* FROM persona_memories m
                            JOIN persona_memories_fts f ON m.id = f.id
                            WHERE persona_memories_fts MATCH ?
                        """
                        params = [fts_expr]
                    else:
                        sql = """
                            SELECT m.* FROM persona_memories m
                            JOIN persona_memories_fts f ON m.id = f.id
                            WHERE (m.agent_name = ? OR m.agent_name = 'global')
                            AND persona_memories_fts MATCH ?
                        """
                        params = [clean_agent, fts_expr]

                    if memory_type:
                        sql += " AND m.memory_type = ?"
                        params.append(memory_type)
                    sql += " ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?"
                    params.append(limit)

                    rows = conn.execute(sql, params).fetchall()
                    if rows:
                        return [dict(r) for r in rows]
                except Exception:
                    pass

        # Fallback: Top memories ordered by importance
        if is_all:
            sql = "SELECT * FROM persona_memories WHERE 1=1"
            params = []
        else:
            sql = "SELECT * FROM persona_memories WHERE (agent_name = ? OR agent_name = 'global')"
            params = [clean_agent]

        if memory_type:
            sql += " AND memory_type = ?"
            params.append(memory_type)
        sql += " ORDER BY importance DESC, updated_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def list_memories(
    agent_name: Optional[str] = None,
    memory_type: Optional[str] = None,
    limit: int = 50,
    db_path: str = DB_PATH
) -> List[Dict[str, Any]]:
    """List stored persona memories with optional filtering."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        sql = "SELECT * FROM persona_memories WHERE 1=1"
        params = []
        if agent_name:
            clean = agent_name.lower().strip()
            if clean.startswith("mcp_"):
                clean = clean[4:]
            sql += " AND (agent_name = ? OR agent_name = 'global')"
            params.append(clean)
        if memory_type:
            sql += " AND memory_type = ?"
            params.append(memory_type)
        sql += " ORDER BY agent_name ASC, importance DESC, updated_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_memory(memory_id: str, db_path: str = DB_PATH) -> bool:
    """Delete a memory item by ID."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM persona_memories WHERE id = ?", (memory_id,))
        deleted = cur.rowcount > 0
        if deleted:
            try:
                conn.execute("DELETE FROM persona_memories_fts WHERE id = ?", (memory_id,))
            except Exception:
                pass
            conn.commit()
        return deleted
    finally:
        conn.close()


def count_memories(agent_name: Optional[str] = None, db_path: str = DB_PATH) -> int:
    """Return count of stored memories."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        if agent_name:
            clean = agent_name.lower().strip()
            if clean.startswith("mcp_"):
                clean = clean[4:]
            row = conn.execute("SELECT COUNT(*) FROM persona_memories WHERE agent_name = ? OR agent_name = 'global'", (clean,)).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) FROM persona_memories").fetchone()
        return row[0] if row else 0
    except Exception:
        return 0
    finally:
        conn.close()


def format_memories_for_prompt(memories: List[Dict[str, Any]]) -> str:
    """Formats a list of memory dicts into a markdown prompt block."""
    if not memories:
        return ""
    lines = ["### Agent Persona Memory & Learned Rules:"]
    for m in memories:
        mtype = m.get("memory_type", "rule").upper()
        content = m.get("content", "").strip()
        lines.append(f"- [{mtype}] {content}")
    return "\n".join(lines) + "\n\n"
