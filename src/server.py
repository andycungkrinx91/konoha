#!/usr/bin/env python3
"""
skills-db MCP Server
SQLite FTS5-backed skill content server for Antigravity IDE/CLI.
Serves agent skill content on-demand via keyword search instead of
loading entire SKILL.md files into context.

Protocol: MCP stdio (JSON-RPC 2.0 over stdin/stdout)
"""

import sqlite3
import json
import sys
import os
from urllib.parse import urlparse, unquote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DB_PATH = os.path.expanduser("~/.gemini/skills-db/skills.db")
WORKSPACE_ROOT = None


def uri_to_path(uri):
    """Convert a file:// URI to a local absolute path."""
    if not uri:
        return None
    try:
        if uri.startswith("file://"):
            path = unquote(uri[7:])
            # On Windows, strip leading slash from /C:/path
            if os.name == 'nt' and path.startswith('/') and len(path) > 2 and path[2] == ':':
                path = path[1:]
            return os.path.normpath(path)
    except Exception:
        pass
    return None

# Max chars to return in find_skill previews (saves tokens)
PREVIEW_LIMIT = 4000


def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def is_path_visible(file_path):
    """
    Check if a skill path is visible to the current session / workspace.
    A path is visible if it resides in the global ~/.agents/ or ~/.gemini/ directories,
    or within the current working directory (current workspace root).
    """
    if not file_path:
        return True  # Fallback if file_path is empty
    
    # Normalize paths (resolve symlinks, remove relative segments, lowercase drive letters on Windows)
    norm_fp = os.path.normcase(os.path.realpath(file_path))
    
    global_agents = os.path.normcase(os.path.realpath(os.path.expanduser("~/.agents")))
    global_gemini = os.path.normcase(os.path.realpath(os.path.expanduser("~/.gemini")))
    
    # Use captured WORKSPACE_ROOT if available, otherwise fallback to os.getcwd()
    workspace = WORKSPACE_ROOT if WORKSPACE_ROOT else os.getcwd()
    current_workspace = os.path.normcase(os.path.realpath(workspace))
    
    home_dir = os.path.normcase(os.path.realpath(os.path.expanduser("~")))
    
    # Check if workspace is home or root (too generic, ignore to prevent exposing all files in home/root)
    is_generic_workspace = (
        current_workspace == home_dir or 
        current_workspace == os.path.normcase(os.path.realpath("/")) or
        (os.name == 'nt' and len(current_workspace) <= 3)
    )
    
    # Check prefix matching with folder separators
    if norm_fp.startswith(global_agents + os.sep) or norm_fp == global_agents:
        return True
    if norm_fp.startswith(global_gemini + os.sep) or norm_fp == global_gemini:
        return True
        
    if not is_generic_workspace:
        if norm_fp.startswith(current_workspace + os.sep) or norm_fp == current_workspace:
            return True
        
    return False


def log_tool_call(tool_name, query_str, returned_content):
    """Log the tool call and calculate token savings."""
    try:
        conn = get_db()
        
        # Get total library size
        row = conn.execute("SELECT SUM(byte_size) FROM skills").fetchone()
        total_library_bytes = row[0] if (row and row[0]) else 550000
        
        returned_bytes = len(returned_content)
        bytes_saved = max(total_library_bytes - returned_bytes, 0)
        tokens_saved = int(bytes_saved / 4) # Approximation: 4 chars/bytes per token
        
        conn.execute("""
            INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (tool_name, query_str, returned_bytes, total_library_bytes, bytes_saved, tokens_saved))
        
        conn.commit()
        conn.close()
    except Exception:
        # Fail silently to avoid breaking the MCP stdio protocol
        pass


def find_skill(keyword, limit=3):
    """
    Search skills using FTS5 full-text search with bm25 ranking.
    Returns top matches with content previews.
    """
    sys.stderr.write(f"[mcp skills-db] tool_call: find_skill(keyword='{keyword}', limit={limit})\n")
    sys.stderr.flush()
    conn = get_db()

    # Try FTS5 search first (with bm25 ranking), retrieving a larger set to filter in Python
    try:
        rows = conn.execute("""
            SELECT s.name, s.skill_name, s.type, s.tags,
                   s.content, s.byte_size, s.line_count, s.file_path,
                   bm25(skills_fts) AS rank
            FROM skills_fts
            JOIN skills s ON skills_fts.rowid = s.rowid
            WHERE skills_fts MATCH ?
            ORDER BY rank
            LIMIT 50
        """, (keyword,)).fetchall()
    except Exception:
        rows = []

    # Fallback: LIKE search on tags and name
    if not rows:
        rows = conn.execute("""
            SELECT name, skill_name, type, tags,
                   content, byte_size, line_count, file_path,
                   0 AS rank
            FROM skills
            WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
            ORDER BY byte_size ASC
            LIMIT 50
        """, (f"%{keyword}%", f"%{keyword}%", f"%{keyword}%")).fetchall()

    conn.close()

    # Filter by visibility/workspace scoping
    visible_rows = []
    for row in rows:
        if is_path_visible(row["file_path"]):
            visible_rows.append(row)
        if len(visible_rows) >= limit:
            break
    rows = visible_rows

    if not rows:
        sys.stderr.write(f"  → 0 skills found\n")
        sys.stderr.flush()
        res = json.dumps({
            "found": 0,
            "query": keyword,
            "message": f"No skills found for '{keyword}'. Use list_skills to see available skills."
        })
        log_tool_call("find_skill", keyword, res)
        return res

    results = []
    sys.stderr.write(f"  → Found {len(rows)} matching skill/reference entries:\n")
    for row in rows:
        sys.stderr.write(f"    - {row['name']} ({row['type']}, {row['byte_size']} bytes)\n")
        content = row["content"]
        is_truncated = len(content) > PREVIEW_LIMIT
        
        results.append({
            "name": row["name"],
            "skill_name": row["skill_name"],
            "type": row["type"],
            "tags": row["tags"],
            "content": content[:PREVIEW_LIMIT] if is_truncated else content,
            "truncated": is_truncated,
            "full_size": row["byte_size"],
            "line_count": row["line_count"],
            "hint": f"Use get_skill('{row['name']}') for full content" if is_truncated else None
        })
    sys.stderr.flush()

    res = json.dumps({"found": len(results), "query": keyword, "results": results}, indent=2)
    log_tool_call("find_skill", keyword, res)
    return res


def list_skills():
    """List all indexed skills with their metadata."""
    sys.stderr.write(f"[mcp skills-db] tool_call: list_skills()\n")
    sys.stderr.flush()
    conn = get_db()
    rows = conn.execute("""
        SELECT name, skill_name, type, tags, byte_size, line_count, file_path
        FROM skills
        ORDER BY skill_name, type DESC, name
    """).fetchall()
    conn.close()

    skills = []
    for row in rows:
        if is_path_visible(row["file_path"]):
            skills.append({
                "name": row["name"],
                "skill_name": row["skill_name"],
                "type": row["type"],
                "tags": row["tags"],
                "size": row["byte_size"],
                "lines": row["line_count"]
            })

    sys.stderr.write(f"  → Total indexed & visible: {len(skills)} entries\n")
    sys.stderr.flush()

    res = json.dumps({
        "total": len(skills),
        "skills": skills
    }, indent=2)
    log_tool_call("list_skills", "", res)
    return res


def get_skill(name):
    """Get the full content of a specific skill or reference by exact name."""
    sys.stderr.write(f"[mcp skills-db] tool_call: get_skill(name='{name}')\n")
    sys.stderr.flush()
    conn = get_db()
    row = conn.execute("""
        SELECT name, skill_name, type, tags, content, byte_size, line_count, file_path
        FROM skills
        WHERE name = ?
    """, (name,)).fetchone()
    conn.close()

    if not row or not is_path_visible(row["file_path"]):
        sys.stderr.write(f"  → Skill '{name}' NOT found or access restricted\n")
        sys.stderr.flush()
        res = json.dumps({
            "error": f"Skill '{name}' not found. Use list_skills or find_skill to discover available skills."
        })
        log_tool_call("get_skill", name, res)
        return res

    sys.stderr.write(f"  → Retrieved {row['name']} ({row['byte_size']} bytes)\n")
    sys.stderr.flush()

    res = json.dumps({
        "name": row["name"],
        "skill_name": row["skill_name"],
        "type": row["type"],
        "tags": row["tags"],
        "content": row["content"],
        "byte_size": row["byte_size"],
        "line_count": row["line_count"]
    }, indent=2)
    log_tool_call("get_skill", name, res)
    return res


def handle_request(req):
    """Handle a single JSON-RPC request."""
    method = req.get("method")
    rid = req.get("id")

    # Notifications (no id) — acknowledge silently
    if rid is None and method not in ("initialize",):
        return None

    if method == "initialize":
        global WORKSPACE_ROOT
        params = req.get("params", {})
        
        # 1. Try rootUri
        root_uri = params.get("rootUri")
        if root_uri:
            WORKSPACE_ROOT = uri_to_path(root_uri)
            
        # 2. Try workspaceFolders fallback
        if not WORKSPACE_ROOT:
            folders = params.get("workspaceFolders", [])
            if folders and isinstance(folders, list):
                first_folder = folders[0]
                if isinstance(first_folder, dict):
                    uri = first_folder.get("uri")
                    if uri:
                        WORKSPACE_ROOT = uri_to_path(uri)
                        
        if WORKSPACE_ROOT:
            sys.stderr.write(f"[mcp skills-db] Initialized with workspace root: {WORKSPACE_ROOT}\n")
            sys.stderr.flush()
        else:
            sys.stderr.write(f"[mcp skills-db] Initialized with no workspace root; using cwd: {os.getcwd()}\n")
            sys.stderr.flush()

        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "skills-db", "version": "1.0.0"}
            }
        }

    elif method == "notifications/initialized":
        # Client acknowledgment — no response needed
        return None

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "tools": [
                    {
                        "name": "find_skill",
                        "description": "Search skills by keyword using full-text search. Returns top matching skill/reference contents ranked by relevance. Use this FIRST to find relevant skill content for any task.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "keyword": {
                                    "type": "string",
                                    "description": "Search keyword(s) for the task. Examples: 'terraform aws', 'sveltekit components', 'code review security', 'helm kubernetes'"
                                },
                                "limit": {
                                    "type": "integer",
                                    "description": "Max results to return (default 3, max 5)",
                                    "default": 3
                                }
                            },
                            "required": ["keyword"]
                        }
                    },
                    {
                        "name": "list_skills",
                        "description": "List all indexed skills and references with metadata (name, type, tags, size). Use to discover what skills are available.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "get_skill",
                        "description": "Get the full content of a specific skill or reference by exact name. Use after find_skill returns a truncated preview.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Exact name of the skill/reference (from find_skill or list_skills results)"
                                }
                            },
                            "required": ["name"]
                        }
                    }
                ]
            }
        }

    elif method == "tools/call":
        params = req.get("params", {})
        tool_name = params.get("name")
        args = params.get("arguments", {})

        if tool_name == "find_skill":
            keyword = args.get("keyword", "")
            limit = min(args.get("limit", 3), 5)
            result_text = find_skill(keyword, limit)
        elif tool_name == "list_skills":
            result_text = list_skills()
        elif tool_name == "get_skill":
            name = args.get("name", "")
            result_text = get_skill(name)
        else:
            result_text = json.dumps({"error": f"Unknown tool: {tool_name}"})

        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "content": [{"type": "text", "text": result_text}]
            }
        }

    else:
        # Unknown method — return empty result if it has an id
        if rid is not None:
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {}
            }
        return None


def main():
    """Main loop: read JSON-RPC messages from stdin, write responses to stdout."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
            response = handle_request(req)
            if response is not None:
                print(json.dumps(response), flush=True)
        except json.JSONDecodeError as e:
            error_resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {str(e)}"}
            }
            print(json.dumps(error_resp), flush=True)
        except Exception as e:
            error_resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": f"Internal error: {str(e)}"}
            }
            print(json.dumps(error_resp), flush=True)


if __name__ == "__main__":
    main()
