#!/usr/bin/env python3
"""
src/persona_memory.py — Embedding-Free Persona & Project Memory Manager for Konoha.
Persists agent rules, preferences, project invariants, and episodic learnings directly
in SQLite (~/.konoha/skills.db) with SQLite FTS5 full-text indexing and project scoping.
"""

import os
import sys
import sqlite3
import json
import time
import uuid
import re
import hashlib
from typing import List, Dict, Any, Optional

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


def get_db(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Get SQLite database connection with WAL mode enabled."""
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def compute_project_hash(project_path: Optional[str]) -> str:
    """Compute a deterministic 12-char SHA-256 hash for a project path."""
    if not project_path or not project_path.strip():
        return ""
    try:
        canonical = os.path.realpath(os.path.abspath(os.path.expanduser(project_path.strip())))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
    except Exception:
        return hashlib.sha256(project_path.strip().encode("utf-8")).hexdigest()[:12]


def detect_project_stack(workspace_path: Optional[str]) -> Dict[str, Any]:
    """
    Analyzes project root files to detect framework, styling tools, package manager, and dependencies.
    Runs locally with zero external network or token overhead.
    """
    stack_info = {
        "project_name": "",
        "framework": "Unknown",
        "styling": "Standard CSS",
        "package_manager": "pnpm",
        "language": "TypeScript / JavaScript",
        "dependencies": []
    }
    if not workspace_path or not os.path.isdir(workspace_path):
        return stack_info

    canonical = os.path.realpath(os.path.abspath(os.path.expanduser(workspace_path)))
    stack_info["project_name"] = os.path.basename(canonical)

    # Detect package manager
    if os.path.exists(os.path.join(canonical, "pnpm-lock.yaml")):
        stack_info["package_manager"] = "pnpm"
    elif os.path.exists(os.path.join(canonical, "bun.lockb")) or os.path.exists(os.path.join(canonical, "bun.lock")):
        stack_info["package_manager"] = "bun"
    elif os.path.exists(os.path.join(canonical, "yarn.lock")):
        stack_info["package_manager"] = "yarn"
    elif os.path.exists(os.path.join(canonical, "package-lock.json")):
        stack_info["package_manager"] = "npm"

    # Analyze package.json if present
    pkg_json_path = os.path.join(canonical, "package.json")
    if os.path.exists(pkg_json_path):
        try:
            with open(pkg_json_path, "r", encoding="utf-8") as f:
                pkg_data = json.load(f)
                if pkg_data.get("name"):
                    stack_info["project_name"] = pkg_data["name"]

                all_deps = {}
                all_deps.update(pkg_data.get("dependencies", {}))
                all_deps.update(pkg_data.get("devDependencies", {}))

                # Filter dependencies to relevant frameworks/libraries to avoid context bloat
                relevant_keywords = ('react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'tailwind',
                                     'prisma', 'drizzle', 'fastapi', 'flask', 'express', 'hono', 'zod',
                                     'trpc', 'lucide', 'motion', 'three', 'vitest', 'jest', 'playwright')
                filtered_deps = [k for k in all_deps.keys() if any(kw in k.lower() for kw in relevant_keywords)]
                stack_info["dependencies"] = filtered_deps[:15] if filtered_deps else list(all_deps.keys())[:10]

                # Framework detection
                if "next" in all_deps:
                    ver = all_deps.get("next", "")
                    stack_info["framework"] = f"Next.js ({ver})" if ver else "Next.js"
                elif "@sveltejs/kit" in all_deps or "svelte" in all_deps:
                    stack_info["framework"] = "SvelteKit"
                elif "nuxt" in all_deps or "nuxt3" in all_deps:
                    stack_info["framework"] = "Nuxt 3"
                elif "@angular/core" in all_deps:
                    stack_info["framework"] = "Angular"
                elif "astro" in all_deps:
                    stack_info["framework"] = "Astro"
                elif "vue" in all_deps:
                    stack_info["framework"] = "Vue"
                elif "react" in all_deps:
                    stack_info["framework"] = "React"
                elif "express" in all_deps:
                    stack_info["framework"] = "Express.js"
                elif "hono" in all_deps:
                    stack_info["framework"] = "Hono"

                # Styling detection
                if "tailwindcss" in all_deps:
                    tw_ver = all_deps.get("tailwindcss", "")
                    if "@tailwindcss/postcss" in all_deps or tw_ver.startswith("^4") or tw_ver.startswith("4."):
                        stack_info["styling"] = "Tailwind CSS v4 (@theme directives)"
                    else:
                        stack_info["styling"] = "Tailwind CSS"
                elif "@emotion/react" in all_deps or "@emotion/styled" in all_deps:
                    stack_info["styling"] = "Emotion CSS"
                elif "styled-components" in all_deps:
                    stack_info["styling"] = "Styled Components"
                elif "unocss" in all_deps:
                    stack_info["styling"] = "UnoCSS"
        except Exception:
            pass

    # Python stack detection
    if os.path.exists(os.path.join(canonical, "pyproject.toml")) or os.path.exists(os.path.join(canonical, "requirements.txt")):
        stack_info["language"] = "Python"
        if stack_info["framework"] == "Unknown":
            req_path = os.path.join(canonical, "requirements.txt")
            if os.path.exists(req_path):
                try:
                    with open(req_path, "r", encoding="utf-8") as f:
                        content = f.read().lower()
                        if "fastapi" in content:
                            stack_info["framework"] = "FastAPI"
                        elif "django" in content:
                            stack_info["framework"] = "Django"
                        elif "flask" in content:
                            stack_info["framework"] = "Flask"
                except Exception:
                    pass

    return stack_info


def init_memory_tables(conn: sqlite3.Connection):
    """Initializes persona memory, project workspace tables, and FTS5 search index."""
    # 1. Projects metadata table
    conn.execute("""
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
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(project_path);")

    # 2. Persona memories table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS persona_memories (
            id TEXT PRIMARY KEY,
            project_hash TEXT DEFAULT '',
            agent_name TEXT NOT NULL,
            memory_type TEXT NOT NULL, -- 'rule', 'preference', 'episodic', 'pattern', 'architecture', 'project_context'
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

    # Safe schema migration for existing databases missing project_hash
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(persona_memories);")
        columns = [row["name"] for row in cur.fetchall()]
        if "project_hash" not in columns:
            conn.execute("ALTER TABLE persona_memories ADD COLUMN project_hash TEXT DEFAULT '';")
    except Exception:
        pass

    conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_project ON persona_memories(project_hash);")

    # 3. FTS5 virtual table for fast full-text keyword retrieval without embeddings
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS persona_memories_fts USING fts5(
            id UNINDEXED,
            project_hash,
            agent_name,
            title,
            content,
            tags,
            content='persona_memories',
            content_rowid='rowid'
        )
    """)
    conn.commit()


def save_or_update_project(
    project_path: str,
    context_summary: str = "",
    tech_stack: Optional[Dict[str, Any]] = None,
    db_path: str = DB_PATH
) -> str:
    """
    Saves or refreshes project workspace metadata and context invariants in SQLite.
    Returns the project_hash.
    """
    if not project_path or not project_path.strip():
        return ""

    canonical = os.path.realpath(os.path.abspath(os.path.expanduser(project_path.strip())))
    p_hash = compute_project_hash(canonical)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    detected = detect_project_stack(canonical)
    if tech_stack:
        detected.update(tech_stack)

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        existing = conn.execute("SELECT * FROM projects WHERE project_hash = ?", (p_hash,)).fetchone()
        if existing:
            new_summary = context_summary.strip() if context_summary else existing["context_summary"]
            conn.execute("""
                UPDATE projects
                SET project_path = ?, project_name = ?, framework = ?, styling = ?, package_manager = ?,
                    context_summary = ?, tech_stack = ?, updated_at = ?
                WHERE project_hash = ?
            """, (
                canonical,
                detected.get("project_name", existing["project_name"]),
                detected.get("framework", existing["framework"]),
                detected.get("styling", existing["styling"]),
                detected.get("package_manager", existing["package_manager"]),
                new_summary,
                json.dumps(detected),
                now,
                p_hash
            ))
        else:
            conn.execute("""
                INSERT INTO projects (project_hash, project_path, project_name, framework, styling, package_manager, context_summary, tech_stack, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p_hash,
                canonical,
                detected.get("project_name", os.path.basename(canonical)),
                detected.get("framework", "Unknown"),
                detected.get("styling", "Standard CSS"),
                detected.get("package_manager", "pnpm"),
                context_summary.strip(),
                json.dumps(detected),
                now,
                now
            ))
        conn.commit()
        return p_hash
    finally:
        conn.close()


def get_project_profile(project_path_or_hash: str, db_path: str = DB_PATH) -> Optional[Dict[str, Any]]:
    """Retrieves project profile by path or 12-char hash."""
    if not project_path_or_hash or not project_path_or_hash.strip():
        return None

    target = project_path_or_hash.strip()
    p_hash = compute_project_hash(target) if (os.sep in target or os.path.exists(target)) else target

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        row = conn.execute("SELECT * FROM projects WHERE project_hash = ? OR project_path = ?", (p_hash, target)).fetchone()
        if row:
            res = dict(row)
            try:
                res["tech_stack"] = json.loads(res.get("tech_stack", "{}"))
            except Exception:
                pass
            return res
        return None
    finally:
        conn.close()


def list_projects(limit: int = 50, db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    """List all tracked project workspaces."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["tech_stack"] = json.loads(d.get("tech_stack", "{}"))
            except Exception:
                pass
            result.append(d)
        return result
    finally:
        conn.close()


def delete_project(project_path_or_hash: str, delete_associated_memories: bool = True, db_path: str = DB_PATH) -> bool:
    """Deletes a tracked project profile and optionally its scoped memories."""
    if not project_path_or_hash:
        return False
    target = project_path_or_hash.strip()
    p_hash = compute_project_hash(target) if (os.sep in target or os.path.exists(target)) else target

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM projects WHERE project_hash = ? OR project_path = ?", (p_hash, target))
        deleted = cur.rowcount > 0
        if delete_associated_memories:
            cur.execute("DELETE FROM persona_memories WHERE project_hash = ?", (p_hash,))
            try:
                cur.execute("DELETE FROM persona_memories_fts WHERE project_hash = ?", (p_hash,))
            except Exception:
                pass
        conn.commit()
        return deleted
    finally:
        conn.close()


def save_memory(
    agent_name: str,
    content: str,
    title: str = "",
    memory_type: str = "rule",
    tags: str = "",
    importance: int = 1,
    project_path: Optional[str] = None,
    project_hash: Optional[str] = None,
    db_path: str = DB_PATH
) -> str:
    """
    Save or update a persona memory / rule for an agent with optional project scoping.
    Returns the generated memory ID.
    """
    if not content or not content.strip():
        raise ValueError("Memory content cannot be empty.")

    clean_agent = agent_name.lower().strip()
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]

    p_hash = ""
    if project_hash:
        p_hash = project_hash.strip()
    elif project_path:
        p_hash = compute_project_hash(project_path)
        # Ensure project profile is registered
        try:
            save_or_update_project(project_path, db_path=db_path)
        except Exception:
            pass

    if not title:
        # Generate title from first line / 60 characters of content
        first_line = content.strip().split("\n")[0].lstrip("#*- ").strip()
        title = first_line[:60] if first_line else f"{clean_agent} memory"

    mem_id = str(uuid.uuid4())[:8]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        conn.execute("""
            INSERT INTO persona_memories (id, project_hash, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (mem_id, p_hash, clean_agent, memory_type, title, content.strip(), tags, importance, now, now))

        # Synchronize FTS5 virtual index
        try:
            conn.execute("""
                INSERT INTO persona_memories_fts (id, project_hash, agent_name, title, content, tags)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (mem_id, p_hash, clean_agent, title, content.strip(), tags))
        except Exception:
            pass

        conn.commit()
    finally:
        conn.close()

    return mem_id


def memory_content_exists(
    content: str,
    agent_name: Optional[str] = None,
    project_path: Optional[str] = None,
    project_hash: Optional[str] = None,
    db_path: str = DB_PATH
) -> bool:
    """Check whether an identical memory content already exists for the agent
    (optionally project-scoped). Used to dedupe learnings before persisting."""
    content = (content or "").strip()
    if not content:
        return False

    clean_agent = agent_name.lower().strip() if agent_name else ""
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]

    p_hash = ""
    if project_hash:
        p_hash = project_hash.strip()
    elif project_path:
        p_hash = compute_project_hash(project_path)

    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        if clean_agent:
            row = conn.execute(
                "SELECT 1 FROM persona_memories WHERE agent_name = ? AND content = ? LIMIT 1",
                (clean_agent, content)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT 1 FROM persona_memories WHERE content = ? LIMIT 1",
                (content,)
            ).fetchone()
        return row is not None
    finally:
        conn.close()


def query_memories(
    agent_name: Optional[str] = None,
    query: str = "",
    memory_type: Optional[str] = None,
    project_path: Optional[str] = None,
    project_hash: Optional[str] = None,
    limit: int = 5,
    db_path: str = DB_PATH
) -> List[Dict[str, Any]]:
    """
    Query saved persona memories by agent, keyword, and project scope using FTS5 with fallback.
    If project_path or project_hash is provided, project-scoped memories are prioritized.
    """
    clean_agent = agent_name.lower().strip() if agent_name else ""
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]
    is_all = (not clean_agent or clean_agent == "all" or clean_agent == "global")

    p_hash = ""
    if project_hash:
        p_hash = project_hash.strip()
    elif project_path:
        p_hash = compute_project_hash(project_path)

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

                    if p_hash:
                        sql += " AND (m.project_hash = ? OR m.project_hash = '')"
                        params.append(p_hash)

                    if memory_type:
                        sql += " AND m.memory_type = ?"
                        params.append(memory_type)

                    # Project-scoped memories take highest precedence, then importance, then recency
                    sql += " ORDER BY (CASE WHEN m.project_hash = ? THEN 2 ELSE 1 END) DESC, m.importance DESC, m.updated_at DESC LIMIT ?"
                    params.extend([p_hash, limit])

                    rows = conn.execute(sql, params).fetchall()
                    if rows:
                        return [dict(r) for r in rows]
                except Exception:
                    pass

        # Fallback: Top memories ordered by project scope and importance
        if is_all:
            sql = "SELECT * FROM persona_memories WHERE 1=1"
            params = []
        else:
            sql = "SELECT * FROM persona_memories WHERE (agent_name = ? OR agent_name = 'global')"
            params = [clean_agent]

        if p_hash:
            sql += " AND (project_hash = ? OR project_hash = '')"
            params.append(p_hash)

        if memory_type:
            sql += " AND memory_type = ?"
            params.append(memory_type)

        sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, importance DESC, updated_at DESC LIMIT ?"
        params.extend([p_hash, limit])

        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def list_memories(
    agent_name: Optional[str] = None,
    memory_type: Optional[str] = None,
    project_path: Optional[str] = None,
    project_hash: Optional[str] = None,
    limit: int = 50,
    db_path: str = DB_PATH
) -> List[Dict[str, Any]]:
    """List stored persona memories across agents with optional type and project filter."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        sql = "SELECT * FROM persona_memories WHERE 1=1"
        params = []

        if agent_name and agent_name.lower().strip() not in ("all", "global", ""):
            clean = agent_name.lower().strip()
            if clean.startswith("mcp_"):
                clean = clean[4:]
            sql += " AND (agent_name = ? OR agent_name = 'global')"
            params.append(clean)

        p_hash = ""
        if project_hash:
            p_hash = project_hash.strip()
        elif project_path:
            p_hash = compute_project_hash(project_path)

        if p_hash:
            sql += " AND (project_hash = ? OR project_hash = '')"
            params.append(p_hash)

        if memory_type:
            sql += " AND memory_type = ?"
            params.append(memory_type)

        sql += " ORDER BY (CASE WHEN project_hash = ? THEN 2 ELSE 1 END) DESC, agent_name ASC, importance DESC, updated_at DESC LIMIT ?"
        params.extend([p_hash, limit])

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


def count_memories(agent_name: Optional[str] = None, project_path: Optional[str] = None, project_hash: Optional[str] = None, db_path: str = DB_PATH) -> int:
    """Return count of stored memories with optional agent and project filtering."""
    conn = get_db(db_path)
    try:
        init_memory_tables(conn)
        sql = "SELECT COUNT(*) FROM persona_memories WHERE 1=1"
        params = []

        if agent_name:
            clean = agent_name.lower().strip()
            if clean.startswith("mcp_"):
                clean = clean[4:]
            sql += " AND (agent_name = ? OR agent_name = 'global')"
            params.append(clean)

        p_hash = ""
        if project_hash:
            p_hash = project_hash.strip()
        elif project_path:
            p_hash = compute_project_hash(project_path)

        if p_hash:
            sql += " AND (project_hash = ? OR project_hash = '')"
            params.append(p_hash)

        row = conn.execute(sql, params).fetchone()
        return row[0] if row else 0
    except Exception:
        return 0
    finally:
        conn.close()


def format_memories_for_prompt(memories: List[Dict[str, Any]], max_items: int = 2) -> str:
    """Formats a list of memory dicts into a token-compact markdown prompt block."""
    if not memories:
        return ""
    lines = ["### Agent Persona Memory & Learned Rules:"]
    for m in memories[:max_items]:
        mtype = m.get("memory_type", "rule").upper()
        content = m.get("content", "").strip()
        short_c = content[:120] + ("..." if len(content) > 120 else "")
        scope_badge = " [PROJECT]" if m.get("project_hash") else ""
        lines.append(f"- [{mtype}{scope_badge}] {short_c}")
    return "\n".join(lines) + "\n\n"


def format_project_context_for_prompt(project_profile: Optional[Dict[str, Any]], memories: Optional[List[Dict[str, Any]]] = None, max_memories: int = 2, compact: bool = False) -> str:
    """Formats project profile and invariants into a token-compact, anti-hallucination context block."""
    if not project_profile and not memories:
        return ""

    header = "### 🧠 Project Context Memory (Auto-Compacted):" if compact else "### 🏢 Persistent Project Context & Invariants:"
    lines = [header]
    if project_profile:
        name = project_profile.get("project_name", "Project")
        path = project_profile.get("project_path", "")
        fw = project_profile.get("framework", "Unknown")
        styling = project_profile.get("styling", "Standard CSS")
        pm = project_profile.get("package_manager", "pnpm")
        summary = (project_profile.get("context_summary") or "").strip()

        if compact:
            lines.append(f"- **Stack**: `{name}` ({fw} • {styling} • {pm})")
            if summary:
                short_s = summary[:100] + ("..." if len(summary) > 100 else "")
                lines.append(f"- **Invariants**: {short_s}")
        else:
            lines.append(f"- **Stack**: {name} (`{path}`) | Framework: `{fw}` | Styling: `{styling}` | PM: `{pm}`")
            if summary:
                short_s = summary[:120] + ("..." if len(summary) > 120 else "")
                lines.append(f"- **Invariants**: {short_s}")

    if memories:
        seen = set()
        unique_mems = []
        for m in memories:
            c = m.get("content", "").strip()
            if c and c not in seen:
                seen.add(c)
                unique_mems.append(m)
        max_items = 1 if compact else max_memories
        for m in unique_mems[:max_items]:
            mtype = m.get("memory_type", "rule").upper()
            content = m.get("content", "").strip()
            max_char = 80 if compact else 100
            short_c = content[:max_char] + ("..." if len(content) > max_char else "")
            lines.append(f"- [{mtype}] {short_c}")

    return "\n".join(lines) + "\n\n"
