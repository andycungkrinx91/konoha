#!/usr/bin/env python3
"""
skills-db MCP Server (v1.1.5 — Token-Optimized)
SQLite FTS5-backed skill content server for Antigravity IDE/CLI.
Serves agent skill content on-demand via keyword search instead of
loading entire SKILL.md files into context.

Protocol: MCP stdio (JSON-RPC 2.0 over stdin/stdout)

v1.1.0 changes:
- Added `compact` mode to find_skill (returns 500-char previews)
- Smart section-aware truncation in get_skill
- Added `fields` parameter to list_skills
- Added content_hash to responses
- Added optimize_report tool for token-efficient skill discovery
"""

import sqlite3
import json
import sys
import os
import hashlib
import re
from urllib.parse import urlparse, unquote
import subprocess
import tempfile
# PIL is NOT imported at module level to avoid crashing MCP on systems without Pillow.
# PIL is lazy-loaded inside build_from_source() for image analysis.

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DB_PATH = os.path.expanduser("~/.gemini/skills-db/skills.db")
WORKSPACE_ROOT = None


def sanitize_fts5_query(query):
    """
    Sanitizes full-text search keywords to prevent FTS5 parser compilation syntax errors.
    Strips or escapes unmatched quotes, parens, dangling asterisks, carets, colons,
    and handles bare uppercase boolean operators (AND, OR, NOT).
    """
    if not query:
        return ""
    
    # 1. Preprocess NEAR(...) expressions to ensure they are validly formatted
    def replace_near(match):
        full_expr = match.group(0)
        # Valid NEAR syntax: NEAR(term1 term2 ... [, distance]) where terms are alphanumeric words
        valid_pattern = r'^NEAR\(\s*[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)+(?:\s*,\s*\d+)?\s*\)$'
        if re.match(valid_pattern, full_expr, re.IGNORECASE):
            inner = re.search(r'\(([^)]*)\)', full_expr).group(1)
            inner_cleaned = " ".join(inner.split())
            return f"NEAR({inner_cleaned})"
        else:
            # Malformed: strip parentheses and make it lowercase near
            inner = re.search(r'\(([^)]*)\)', full_expr)
            inner_text = inner.group(1) if inner else ""
            return f"near {inner_text}"
            
    query = re.sub(r'\bNEAR\s*\(([^)]*)\)', replace_near, query, flags=re.IGNORECASE)

    # Remove caret (^) and colon (:)
    query = re.sub(r'[\^:]', ' ', query)
    
    # Balance double quotes (strip all if odd count)
    if query.count('"') % 2 != 0:
        query = query.replace('"', ' ')
        
    # Balance parentheses (strip all if unbalanced)
    if query.count('(') != query.count(')'):
        query = query.replace('(', ' ').replace(')', ' ')
        
    # Strip dangling asterisks (asterisks must be at the end of alphanumeric word characters)
    query = re.sub(r'(?<![a-zA-Z0-9])\*', ' ', query)
    query = re.sub(r'\*(?=[a-zA-Z0-9])', ' ', query)
    
    # Handle bare/dangling operators AND, OR, NOT
    words = query.split()
    sanitized_words = []
    for i, w in enumerate(words):
        w_upper = w.upper()
        if w_upper in ('AND', 'OR', 'NOT'):
            is_dangling = False
            if i == 0 or i == len(words) - 1:
                is_dangling = True
            else:
                prev_w = words[i-1].upper()
                next_w = words[i+1].upper()
                if prev_w in ('AND', 'OR', 'NOT') or next_w in ('AND', 'OR', 'NOT'):
                    is_dangling = True
            
            if is_dangling:
                sanitized_words.append(w.lower())
            else:
                # Keep operator only if it is not dangling and surrounded by parenthesis or grouping
                sanitized_words.append(w_upper)
        elif w_upper == 'NEAR':
            # Bare NEAR without parenthesis
            sanitized_words.append(w.lower())
        else:
            sanitized_words.append(w)
            
    return " ".join(sanitized_words)


def shield_prompt_injection(content):
    """
    Neutralizes role-mimicking structural headings and instructions trying to spoof
    system configurations, subagent instructions, or user rules.
    """
    if not content:
        return ""
        
    rules = [
        (r'(?i)#+\s*Global\s+Agent\s+Instructions', '# [NEUTRALIZED] Global Agent Instructions'),
        (r'(?i)#+\s*User\s+Rules', '# [NEUTRALIZED] User Rules'),
        (r'(?i)#+\s*Session\s+Startup\s*—\s*Auto-Initialize\s+Team', '# [NEUTRALIZED] Session Startup'),
        (r'(?i)#+\s*Subagent\s+Definitions', '# [NEUTRALIZED] Subagent Definitions'),
        (r'(?i)#+\s*Auto-Delegation', '# [NEUTRALIZED] Auto-Delegation'),
        (r'(?i)#+\s*Tools\s+&\s+Guardrails', '# [NEUTRALIZED] Tools & Guardrails'),
        (r'(?i)#+\s*@(orchestrator|genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b', '# [NEUTRALIZED] Subagent Spoof'),
        (r'(?i)At\s+the\s+START\s+of\s+every\s+session,\s+define\s+the\s+following', '[NEUTRALIZED ACTION] Define subagents'),
        (r'(?i)The\s+orchestrator\s+MUST\s+follow\s+this\s+workflow', '[NEUTRALIZED ACTION] Orchestrator workflow'),
        (r'(?i)Every\s+response\s+MUST\s+start\s+with\s+a\s+log\s+line', '[NEUTRALIZED RULE] Start response log'),
    ]
    
    sanitized = content
    for pattern, replacement in rules:
        sanitized = re.sub(pattern, replacement, sanitized)
        
    return sanitized



def uri_to_path(uri):
    """Convert a file:// URI or raw path to a local absolute path."""
    if not uri:
        return None
    try:
        if uri.startswith("file://"):
            path = unquote(uri[7:])
        elif uri.startswith("file:/"):
            path = unquote(uri[5:])
        else:
            path = unquote(uri)
        # On Windows, strip leading slash from /C:/path
        if os.name == 'nt' and path.startswith('/') and len(path) > 2 and path[2] == ':':
            path = path[1:]
        return os.path.normpath(path)
    except Exception:
        pass
    return None

# Max chars to return in find_skill previews (saves tokens)
PREVIEW_LIMIT = 1500
COMPACT_PREVIEW_LIMIT = 500
MAX_CONTENT_SIZE = 12000



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
    or within the current working directory (current workspace root),
    or if it is a custom/workspace skill path containing .agents/skills or .gemini/skills.
    """
    if not file_path:
        return True  # Fallback if file_path is empty
    
    # Normalize paths (resolve symlinks, remove relative segments, lowercase drive letters on Windows)
    norm_fp = os.path.normcase(os.path.realpath(file_path))
    
    # Check if the path contains custom/workspace skills directories (.agents/skills or .gemini/skills)
    normalized_slash_path = norm_fp.replace(os.sep, "/")
    if ".agents/skills" in normalized_slash_path or ".gemini/skills" in normalized_slash_path:
        return True

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


def content_hash(content):
    """Generate a short hash of content for cache-aware responses."""
    return hashlib.md5(content.encode('utf-8')).hexdigest()[:12]


def log_tool_call(tool_name, query_str, returned_content, agent_name=None):
    """Log the tool call and calculate token savings."""
    try:
        conn = get_db()
        
        # Calculate baseline as the sum of all skills in the database (or default to 550000)
        baseline_bytes = 550000
        try:
            row = conn.execute("SELECT SUM(byte_size) FROM skills").fetchone()
            if row and row[0] is not None:
                baseline_bytes = row[0]
        except Exception:
            pass
        
        returned_bytes = len(returned_content)
        if tool_name == "get_skill":
            bytes_saved = 0
            tokens_saved = 0
            total_library_bytes = returned_bytes
        else:
            bytes_saved = max(baseline_bytes - returned_bytes, 0)
            tokens_saved = int(bytes_saved / 4)
            total_library_bytes = baseline_bytes
            
        conn.execute("""
            INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (tool_name, query_str, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent_name))
        
        conn.commit()
        conn.close()
    except Exception:
        # Fail silently to avoid breaking the MCP stdio protocol
        pass


def smart_truncate(content, max_size, name=None):
    """
    Section-aware truncation that preserves heading structure.
    Cuts at section boundaries instead of mid-paragraph for coherent content.
    """
    if not content or len(content) <= max_size:
        return content, False
    
    # Find section boundaries (markdown headings)
    lines = content.split('\n')
    current_size = 0
    last_good_boundary = 0
    
    for i, line in enumerate(lines):
        line_size = len(line) + 1  # +1 for newline
        if current_size + line_size > max_size:
            break
        current_size += line_size
        # Track heading boundaries for clean cuts
        if line.startswith('#') or line.strip() == '':
            last_good_boundary = i
    
    # Cut at the last clean section boundary if reasonable (at least 60% of max)
    if last_good_boundary > 0 and current_size > max_size * 0.6:
        truncated = '\n'.join(lines[:last_good_boundary])
    else:
        truncated = content[:max_size]
    
    if name:
        truncated += f"\n\n... [Truncated at {len(truncated)} chars. Use get_skill('{name}') for full content.]"
    else:
        truncated += f"\n\n... [Content truncated at {len(truncated)} characters to save tokens.]"
    return truncated, True


def find_skill(keyword, limit=3, agent_name=None, compact=False):
    """
    Search skills using FTS5 full-text search with bm25 ranking.
    Returns top matches with content previews.
    compact=True returns smaller previews (500 chars) for initial discovery.
    """
    sys.stderr.write(f"[mcp skills-db] tool_call: find_skill(keyword='{keyword}', limit={limit}, compact={compact})\n")
    sys.stderr.flush()
    conn = get_db()

    preview_limit = COMPACT_PREVIEW_LIMIT if compact else PREVIEW_LIMIT

    # Try FTS5 search first (with bm25 ranking), retrieving a larger set to filter in Python
    sanitized_keyword = sanitize_fts5_query(keyword)
    try:
        rows = conn.execute("""
            SELECT s.name, s.skill_name, s.type, s.tags,
                   s.content, s.byte_size, s.line_count, s.file_path,
                   bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) AS rank
            FROM skills_fts
            JOIN skills s ON skills_fts.rowid = s.rowid
            WHERE skills_fts MATCH ?
            ORDER BY rank
            LIMIT 50
        """, (sanitized_keyword,)).fetchall()
    except Exception as e:
        sys.stderr.write(f"  [Warning] FTS5 search failed for keyword '{keyword}' (sanitized: '{sanitized_keyword}'): {str(e)}. Falling back to LIKE search.\n")
        sys.stderr.flush()
        rows = []

    # Fallback: LIKE search on tags and name
    if not rows:
        like_keyword = re.sub(r'[^\w\s]', '', sanitized_keyword)
        rows = conn.execute("""
            SELECT name, skill_name, type, tags,
                   content, byte_size, line_count, file_path,
                   0 AS rank
            FROM skills
            WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
            ORDER BY byte_size ASC
            LIMIT 50
        """, (f"%{like_keyword}%", f"%{like_keyword}%", f"%{like_keyword}%")).fetchall()

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
        log_tool_call("find_skill", keyword, res, agent_name=agent_name)
        return res

    results = []
    sys.stderr.write(f"  → Found {len(rows)} matching skill/reference entries:\n")
    for row in rows:
        sys.stderr.write(f"    - {row['name']} ({row['type']}, {row['byte_size']} bytes)\n")
        raw_content = row["content"]
        # Apply prompt injection shield
        shielded_content = shield_prompt_injection(raw_content)
        is_truncated = len(shielded_content) > preview_limit
        preview = shielded_content[:preview_limit] if is_truncated else shielded_content
        
        entry = {
            "name": row["name"],
            "type": row["type"],
            "content": preview,
            "truncated": is_truncated,
            "hash": content_hash(shielded_content),
        }
        if is_truncated:
            entry["hint"] = f"Use get_skill('{row['name']}') for full content"
        
        results.append(entry)
    sys.stderr.flush()

    res = json.dumps({"found": len(results), "query": keyword, "results": results})
    log_tool_call("find_skill", keyword, res, agent_name=agent_name)
    return res


def list_skills(agent_name=None, fields=None):
    """
    List all indexed skills with their metadata.
    fields: optional list of fields to include (e.g. ["name","type"]) to reduce payload.
    """
    sys.stderr.write(f"[mcp skills-db] tool_call: list_skills(fields={fields})\n")
    sys.stderr.flush()
    conn = get_db()
    rows = conn.execute("""
        SELECT name, skill_name, type, tags, byte_size, line_count, file_path
        FROM skills
        ORDER BY skill_name, type DESC, name
    """).fetchall()
    conn.close()

    # Default fields if not specified
    if not fields:
        fields = ["name", "type", "size"]

    skills = []
    for row in rows:
        if is_path_visible(row["file_path"]):
            entry = {}
            if "name" in fields:
                entry["name"] = row["name"]
            if "type" in fields:
                entry["type"] = row["type"]
            if "size" in fields:
                entry["size"] = row["byte_size"]
            if "tags" in fields:
                entry["tags"] = row["tags"]
            if "lines" in fields:
                entry["lines"] = row["line_count"]
            if "skill_name" in fields:
                entry["skill_name"] = row["skill_name"]
            skills.append(entry)

    sys.stderr.write(f"  → Total indexed & visible: {len(skills)} entries\n")
    sys.stderr.flush()

    res = json.dumps({
        "total": len(skills),
        "skills": skills
    })
    log_tool_call("list_skills", "", res, agent_name=agent_name)
    return res


def get_skill(name, agent_name=None):
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
        log_tool_call("get_skill", name, res, agent_name=agent_name)
        return res

    sys.stderr.write(f"  → Retrieved {row['name']} ({row['byte_size']} bytes)\n")
    sys.stderr.flush()

    raw_content = row["content"]
    # Shield against prompt injection
    shielded_content = shield_prompt_injection(raw_content)
    content = shielded_content
    truncated = False
    
    if len(content) > MAX_CONTENT_SIZE:
        content, truncated = smart_truncate(content, MAX_CONTENT_SIZE, name=row["name"])

    res = json.dumps({
        "name": row["name"],
        "type": row["type"],
        "content": content,
        "byte_size": len(content.encode('utf-8')),
        "line_count": content.count('\n') + 1,
        "truncated": truncated,
        "hash": content_hash(shielded_content)
    })
    log_tool_call("get_skill", name, res, agent_name=agent_name)
    return res


def optimize_report(keyword=None, agent_name=None):
    """
    Return a token-optimized summary of matching skills.
    Instead of full content, returns:
    - Skill name and type
    - Key section headings (TOC)
    - Estimated token cost
    - Compact summary (~200 chars)
    
    This lets agents make informed decisions about whether to call get_skill for full content.
    """
    sys.stderr.write(f"[mcp skills-db] tool_call: optimize_report(keyword='{keyword}')\n")
    sys.stderr.flush()
    conn = get_db()
    
    rows = []
    if keyword:
        sanitized_keyword = sanitize_fts5_query(keyword)
        try:
            rows = conn.execute("""
                SELECT s.name, s.skill_name, s.type, s.tags,
                       s.content, s.byte_size, s.line_count, s.file_path,
                       bm25(skills_fts, 10.0, 5.0, 8.0, 1.0) AS rank
                FROM skills_fts
                JOIN skills s ON skills_fts.rowid = s.rowid
                WHERE skills_fts MATCH ?
                ORDER BY rank
                LIMIT 10
            """, (sanitized_keyword,)).fetchall()
        except Exception as e:
            sys.stderr.write(f"  [Warning] FTS5 optimize_report query failed for keyword '{keyword}' (sanitized: '{sanitized_keyword}'): {str(e)}. Falling back to LIKE search.\n")
            sys.stderr.flush()
            rows = []
        
        if not rows:
            like_keyword = re.sub(r'[^\w\s]', '', sanitized_keyword)
            rows = conn.execute("""
                SELECT name, skill_name, type, tags,
                       content, byte_size, line_count, file_path,
                       0 AS rank
                FROM skills
                WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
                ORDER BY byte_size ASC
                LIMIT 10
            """, (f"%{like_keyword}%", f"%{like_keyword}%", f"%{like_keyword}%")).fetchall()
    else:
        rows = conn.execute("""
            SELECT name, skill_name, type, tags,
                   content, byte_size, line_count, file_path,
                   0 AS rank
            FROM skills
            ORDER BY skill_name, type DESC
            LIMIT 20
        """).fetchall()
    
    conn.close()
    
    # Filter by visibility
    visible_rows = [r for r in rows if is_path_visible(r["file_path"])]
    
    reports = []
    for row in visible_rows:
        raw_content = row["content"] or ""
        # Apply prompt injection shield
        shielded_content = shield_prompt_injection(raw_content)
        content = shielded_content
        
        # Extract section headings (TOC)
        headings = []
        for line in content.split('\n'):
            stripped = line.strip()
            if stripped.startswith('#'):
                # Clean the heading
                heading = stripped.lstrip('#').strip()
                if heading and len(heading) > 2:
                    level = len(stripped) - len(stripped.lstrip('#'))
                    headings.append(f"{'  ' * (level - 1)}- {heading}")
        
        # Generate compact summary (first meaningful paragraph)
        summary = ""
        for line in content.split('\n'):
            stripped = line.strip()
            if stripped and not stripped.startswith('#') and not stripped.startswith('```') and not stripped.startswith('|') and not stripped.startswith('-'):
                summary = stripped[:200]
                break
        
        # Token cost estimate
        byte_size = len(content.encode('utf-8'))
        estimated_tokens = byte_size // 4
        
        reports.append({
            "name": row["name"],
            "type": row["type"],
            "byte_size": byte_size,
            "estimated_tokens": estimated_tokens,
            "headings": headings[:15],  # Cap at 15 headings
            "summary": summary,
            "hash": content_hash(content)
        })
    
    res = json.dumps({
        "found": len(reports),
        "query": keyword or "(all)",
        "reports": reports
    })
    log_tool_call("optimize_report", keyword or "", res, agent_name=agent_name)
    return res


def build_from_source(name, source_dir, framework, agent_name=None):
    """
    Analyze design mockup layouts and reference source files in source_dir and set up project configuration.
    """
    global WORKSPACE_ROOT
    resolved_source_dir = source_dir
    if not os.path.isabs(resolved_source_dir):
        workspace = WORKSPACE_ROOT if WORKSPACE_ROOT else os.getcwd()
        resolved_source_dir = os.path.abspath(os.path.join(workspace, resolved_source_dir))
        
    if not os.path.exists(resolved_source_dir) or not os.path.isdir(resolved_source_dir):
        res = json.dumps({"error": f"Source directory not found: {source_dir}"})
        log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}", res, agent_name=agent_name)
        return res
        
    try:
        all_files = []
        for root, _, filenames in os.walk(resolved_source_dir):
            for f in filenames:
                ext = os.path.splitext(f)[1].lower()
                if ext in ('.png', '.jpg', '.jpeg', '.webp', '.svg', '.html', '.xml', '.tsx', '.jsx', '.ts', '.js', '.css'):
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, resolved_source_dir)
                    all_files.append(rel_path)
                    # Avoid traversing extremely large directories
                    if len(all_files) > 100:
                        break
            if len(all_files) > 100:
                break
    except Exception as e:
        res = json.dumps({"error": f"Failed to list source directory: {str(e)}"})
        log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}", res, agent_name=agent_name)
        return res

    if not all_files:
        res = json.dumps({"error": f"No supported design images or source files found in {source_dir}."})
        log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}", res, agent_name=agent_name)
        return res

    image_exts = ('.png', '.jpg', '.jpeg', '.webp', '.svg')
    code_exts = ('.html', '.xml', '.tsx', '.jsx', '.ts', '.js', '.css')

    images_raw = [f for f in all_files if f.lower().endswith(image_exts)]
    sources_raw = [f for f in all_files if f.lower().endswith(code_exts)]

    # Lazy PIL import for image analysis
    _pil_available = False
    _Image = None
    try:
        from PIL import Image as _Image
        _pil_available = True
    except ImportError:
        pass

    def _analyze_image(fpath):
        meta = {}
        try:
            meta["size_bytes"] = os.path.getsize(fpath)
        except OSError:
            meta["size_bytes"] = 0
        
        if not _pil_available or not _Image:
            return meta
        
        lower = fpath.lower()
        if lower.endswith(('.svg', '.html', '.htm')):
            return meta
        
        try:
            with _Image.open(fpath) as img:
                w, h = img.size
                meta["width"] = w
                meta["height"] = h
                meta["aspect_ratio"] = round(w / h, 2) if h > 0 else 0
                meta["orientation"] = "landscape" if w > h else ("portrait" if h > w else "square")
                meta["format"] = img.format or "unknown"
                
                try:
                    sample = img.convert("RGB")
                    sample.thumbnail((50, 50))
                    pixels = list(sample.getdata())
                    if pixels:
                        from collections import Counter
                        color_counts = Counter(pixels)
                        top_colors = color_counts.most_common(5)
                        meta["dominant_colors"] = [
                            {"rgb": list(c[0]), "hex": "#{:02x}{:02x}{:02x}".format(*c[0]), "frequency": c[1]}
                            for c in top_colors
                        ]
                except Exception:
                    pass
        except Exception:
            pass
        return meta

    detected_images = []
    for m in images_raw:
        fpath = os.path.join(resolved_source_dir, m)
        meta = _analyze_image(fpath)
        if meta.get("size_bytes", 0) == 0:
            continue
        meta["filename"] = m
        detected_images.append(meta)

    detected_sources = []
    for s in sources_raw[:30]:  # limit peeking to 30 files
        fpath = os.path.join(resolved_source_dir, s)
        meta = {"filename": s}
        try:
            size = os.path.getsize(fpath)
            meta["size_bytes"] = size
            if size < 50000:
                with open(fpath, 'r', encoding='utf-8', errors='ignore') as fp:
                    content = fp.read()
                    if "import " in content or "export " in content:
                        meta["has_exports_or_imports"] = True
                    if "react" in content.lower():
                        meta["framework_hints"] = "react"
                    elif "svelte" in content.lower():
                        meta["framework_hints"] = "svelte"
        except Exception:
            pass
        detected_sources.append(meta)

    layout_hints = []
    if _pil_available:
        for m in detected_images:
            if "width" in m and "height" in m:
                orient = m.get("orientation", "unknown")
                layout_hints.append(f"{m['filename']} ({m['width']}x{m['height']}, {orient})")

    directives = [
        f"Build a clean {framework} storefront named '{name}' based on the source design directory '{source_dir}'.",
        "You MUST read and analyze the provided reference source files and design mockup images to guide your construction.",
        "DO NOT implement the default visual effects template (such as the 10-theme switcher, 3D carousel hero, 3D interactive carousels, 3D GPU card hovers, 3D SweetAlert2 modal dialogs, or watermark) UNLESS they are explicitly requested or depicted in the source files/mockup images."
    ]

    if detected_images:
        directives.append(f"Detected design mockups: {', '.join([m['filename'] for m in detected_images])}. Translate these layouts directly into component structure with high visual fidelity.")
    if layout_hints:
        directives.append(f"Image layout analysis: {'; '.join(layout_hints)}. Use these dimensions to guide responsive breakpoints and aspect ratios.")
    if detected_sources:
        directives.append(f"Detected source code reference files: {', '.join([s['filename'] for s in detected_sources])}. Reconstruct or migrate component structure and logic from these files.")
    
    if any("dominant_colors" in m for m in detected_images):
        all_colors = []
        for m in detected_images:
            for c in m.get("dominant_colors", [])[:3]:
                if c["hex"] not in all_colors:
                    all_colors.append(c["hex"])
        if all_colors:
            directives.append(f"Detected color palette from mockups: {', '.join(all_colors[:10])}. Use these colors as the primary design palette.")

    spec = {
        "status": "success",
        "project_name": name,
        "framework": framework,
        "mode": "build_from_source",
        "source_directory": resolved_source_dir,
        "detected_images": detected_images,
        "detected_sources": detected_sources,
        "directives": directives
    }

    res = json.dumps(spec, indent=2)
    log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}, framework={framework}", res, agent_name=agent_name)
    return res


def build_from_text(name, description, framework, agent_name=None):
    """
    Generate structure and instructions from description, automatically including
    the default premium templates and visual effects.
    """
    spec = {
        "status": "success",
        "project_name": name,
        "framework": framework,
        "mode": "build_from_text",
        "description": description,
        "directives": [
            f"Build a premium {framework} storefront named '{name}' based on the description: '{description}'.",
            "You MUST implement all the required visual effects from the default premium template:",
            "  1. 10-Theme Switcher (Nebula, Aurora, Sunset, Ocean, Forest, Volcano, Sakura, Cyberpunk, Midnight, Gold) persisted in localStorage.",
            "  2. Full-width homepage hero banner with GPU-accelerated 3D transition carousel slider (minimum 4 images).",
            "  3. Minimum of 5 interactive 3D carousels (hero, category showcase, featured items, customer lookbook, testimonials).",
            "  4. 3D GPU card hover & radial mouse-tracking glow effects on all card components.",
            "  5. Custom 3D entrance transition SweetAlert2 modal dialogs matching active theme gradients.",
            "  6. Inline SVG/CSS custom branded logo and the footer watermark: 'Build with Antigravity and Konoha agentic AI'."
        ]
    }
    res = json.dumps(spec, indent=2)
    log_tool_call("build_from_text", f"name={name}, description={description}, framework={framework}", res, agent_name=agent_name)
    return res


def detect_active_agent():
    import glob
    import json
    import re
    try:
        brain_dirs = [
            os.path.expanduser("~/.gemini/antigravity-ide/brain"),
            os.path.expanduser("~/.gemini/antigravity-cli/brain"),
        ]
        all_files = []
        for brain_dir in brain_dirs:
            if not os.path.isdir(brain_dir):
                continue
            pattern_prompt = os.path.join(brain_dir, "*", "prompt.md")
            pattern_transcript = os.path.join(brain_dir, "*", ".system_generated", "logs", "transcript.jsonl")
            all_files.extend(glob.glob(pattern_prompt) + glob.glob(pattern_transcript))
        if not all_files:
            return None
            
        all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        
        visited_dirs = set()
        fallback_agent = None
        
        for fpath in all_files:
            if fpath.endswith("prompt.md"):
                conv_dir = os.path.dirname(fpath)
            else:
                conv_dir = os.path.dirname(os.path.dirname(os.path.dirname(fpath)))
                
            conv_dir = os.path.normpath(conv_dir)
            if conv_dir in visited_dirs:
                continue
            visited_dirs.add(conv_dir)
            
            detected = None
            
            # 1. Try prompt.md first (guaranteed to be written/created before subagent starts)
            prompt_path = os.path.join(conv_dir, "prompt.md")
            if os.path.exists(prompt_path):
                try:
                    with open(prompt_path, "r", encoding="utf-8") as f:
                        prompt_content = f.read()
                    
                    # Search for [Icon Agent] active
                    match = re.search(r"\[([^\]]+)\]\s+active", prompt_content)
                    if match:
                        agent_name = match.group(1).split()[-1].lower()
                        if agent_name in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                            detected = agent_name
                        elif agent_name in ["antigravity", "orchestrator"]:
                            detected = "orchestrator"
                            
                    if not detected:
                        # Search for explicit "You are the X agent" or "Log: ... X ... active"
                        for candidate in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                            if re.search(rf"\b{candidate}\b", prompt_content, re.IGNORECASE):
                                if re.search(rf"you\s+are\s+(?:the|a)\s+{candidate}\s+(?:agent|subagent|scout|builder|intel|scribe|leader)", prompt_content, re.IGNORECASE):
                                    detected = candidate
                                    break
                                if re.search(rf"Log:\s*\"\[.*{candidate}.*\]\s*active\"", prompt_content, re.IGNORECASE):
                                    detected = candidate
                                    break
                except Exception:
                    pass
                    
            # 2. Try transcript.jsonl
            if not detected:
                transcript_path = os.path.join(conv_dir, ".system_generated", "logs", "transcript.jsonl")
                if os.path.exists(transcript_path):
                    try:
                        with open(transcript_path, "r", encoding="utf-8") as f:
                            lines = f.readlines()
                        for line in reversed(lines):
                            try:
                                data = json.loads(line)
                                content = data.get("content", "")
                                if not content:
                                    continue
                                match = re.search(r"\[([^\]]+)\]\s+active", content)
                                if match:
                                    agent_name = match.group(1).split()[-1].lower()
                                    if agent_name in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                                        detected = agent_name
                                        break
                                    elif agent_name in ["antigravity", "orchestrator"]:
                                        detected = "orchestrator"
                                        break
                            except Exception:
                                pass
                    except Exception:
                        pass
            
            if detected:
                if detected in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                    return detected
                elif detected == "orchestrator" and not fallback_agent:
                    fallback_agent = "orchestrator"
                    
            # Check up to 15 most recent folders to find a subagent
            if len(visited_dirs) >= 15:
                break
        return fallback_agent
    except Exception:
        pass
    return None


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
                        
        # 3. Try rootPath fallback
        if not WORKSPACE_ROOT:
            root_path = params.get("rootPath")
            if root_path:
                WORKSPACE_ROOT = uri_to_path(root_path)
                        
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
                "serverInfo": {"name": "skills-db", "version": "1.1.5"}
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
                                    "description": "Search keyword(s) for the task. Examples: 'terraform aws', 'sveltekit components', 'code review security'"
                                },
                                "limit": {
                                    "type": "integer",
                                    "description": "Max results (default 3, max 5)",
                                    "default": 3
                                },
                                "compact": {
                                    "type": "boolean",
                                    "description": "If true, returns smaller 500-char previews for quick discovery. Default false.",
                                    "default": False
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": ["keyword"]
                        }
                    },
                    {
                        "name": "list_skills",
                        "description": "List all indexed skills and references with metadata. Use to discover what skills are available.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "fields": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Fields to include: 'name','type','size','tags','lines','skill_name'. Default: ['name','type','size']."
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": []
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
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": ["name"]
                        }
                    },
                    {
                        "name": "optimize_report",
                        "description": "Get token-optimized summary of skills: headings (TOC), estimated token cost, and compact summary. Use to decide whether to call get_skill for full content.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "keyword": {
                                    "type": "string",
                                    "description": "Search keyword(s) to filter skills. Omit to get report on all skills."
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": []
                        }
                    },
                    {
                        "name": "build_from_source",
                        "description": "Initialize and build a project using existing source files (HTML, XML, TSX, JS, CSS, etc.) or design mockup images in a source directory. Skips default visual effects templates.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Name of the project to build."
                                },
                                "source_dir": {
                                    "type": "string",
                                    "description": "Relative or absolute path to the source/design directory containing mockup images or template files."
                                },
                                "framework": {
                                    "type": "string",
                                    "description": "The target framework (e.g. 'nextjs' or 'svelte')."
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": ["name", "source_dir", "framework"]
                        }
                    },
                    {
                        "name": "build_from_text",
                        "description": "Initialize and build a project from a textual description/prompt, automatically including the default premium visual effects template (e.g., 10-theme switcher, 3D interactive carousels, 3D GPU card hovers, 3D SweetAlert2 modal dialogs, and watermark).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Name of the project to build."
                                },
                                "description": {
                                    "type": "string",
                                    "description": "The text description/prompt detailing the storefront features and requirements."
                                },
                                "framework": {
                                    "type": "string",
                                    "description": "The target framework (e.g. 'nextjs' or 'svelte')."
                                },
                                "agent": {
                                    "type": "string",
                                    "description": "Name of the calling agent."
                                }
                            },
                            "required": ["name", "description", "framework"]
                        }
                    }
                ]
            }
        }

    elif method == "tools/call":
        params = req.get("params", {})
        tool_name = params.get("name")
        args = params.get("arguments", {})
        agent = args.get("agent") or args.get("agent_name")
        if not agent:
            agent = detect_active_agent()

        if tool_name == "find_skill":
            keyword = args.get("keyword", "")
            limit = min(args.get("limit", 3), 5)
            compact = args.get("compact", False)
            result_text = find_skill(keyword, limit, agent_name=agent, compact=compact)
        elif tool_name == "list_skills":
            fields = args.get("fields")
            result_text = list_skills(agent_name=agent, fields=fields)
        elif tool_name == "get_skill":
            name = args.get("name", "")
            result_text = get_skill(name, agent_name=agent)
        elif tool_name == "optimize_report":
            keyword = args.get("keyword")
            result_text = optimize_report(keyword=keyword, agent_name=agent)
        elif tool_name == "build_from_source":
            name = args.get("name")
            source_dir = args.get("source_dir")
            framework = args.get("framework")
            if not name or not source_dir or not framework:
                result_text = json.dumps({"error": "Missing required arguments: name, source_dir, and framework are all required."})
            else:
                result_text = build_from_source(name, source_dir, framework, agent_name=agent)
        elif tool_name == "build_from_text":
            name = args.get("name")
            description = args.get("description")
            framework = args.get("framework")
            if not name or not description or not framework:
                result_text = json.dumps({"error": "Missing required arguments: name, description, and framework are all required."})
            else:
                result_text = build_from_text(name, description, framework, agent_name=agent)
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
