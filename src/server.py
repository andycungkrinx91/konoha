#!/usr/bin/env python3
"""
konoha MCP Server (v2.0.0 — Token-Optimized)
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
import tempfile
from yaml_parser import parse_yaml, serialize_yaml, load_yaml_file, dump_yaml_file
import glob
# PIL is NOT imported at module level to avoid crashing MCP on systems without Pillow.
# PIL is lazy-loaded inside build_from_source() for image analysis.

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ──────────────── Centralized paths (mirrors bin/lib/paths.js) ────────────────

HOME = os.path.expanduser("~")
KONOHA_DIR = os.path.join(HOME, ".konoha")
AGENTS_DIR = os.path.join(HOME, ".agents")
GEMINI_DIR = os.path.join(HOME, ".gemini")
CURSOR_DIR = os.path.join(HOME, ".cursor")
CLAUDE_DIR = os.path.join(HOME, ".claude")

DB_PATH = os.path.join(KONOHA_DIR, "skills.db")
SERVER_PY_PATH = os.path.join(KONOHA_DIR, "server.py")
DB_BRIDGES_PY_PATH = os.path.join(KONOHA_DIR, "db_bridges.py")

ANTIGRAVITY_CLI = os.path.join(GEMINI_DIR, "antigravity-cli")
ANTIGRAVITY_IDE = os.path.join(GEMINI_DIR, "antigravity-ide")
ANTIGRAVITY_CLI_BRAIN = os.path.join(ANTIGRAVITY_CLI, "brain")
ANTIGRAVITY_IDE_BRAIN = os.path.join(ANTIGRAVITY_IDE, "brain")
CURSOR_PROJECTS = os.path.join(CURSOR_DIR, "projects")
CLAUDE_PROJECTS = os.path.join(CLAUDE_DIR, "projects")

USER_AGENTS_YAML = os.path.join(AGENTS_DIR, "agents.yaml")

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", os.environ.get("KONOHA_WORKSPACE", os.getcwd()))
ACTIVE_CLIENT = os.environ.get("ACTIVE_CLIENT", os.environ.get("KONOHA_CLIENT", None))


def normalize_legacy_skill_name(skill):
    if not isinstance(skill, str):
        return skill
    if skill == "deep-code-explorer":
        return "genin-skill"
    if skill.startswith("deep-code-explorer/"):
        return "genin-skill/" + skill[len("deep-code-explorer/"):]
    return skill


def konoha_tmp(client: str, session_id: str) -> str:
    """Scratch dir under ~/.konoha/tmp/<client>/<session_id>/."""
    return os.path.join(KONOHA_DIR, "tmp", client, session_id)


def sanitize_fts5_query(query):
    """
    Sanitizes full-text search keywords to prevent FTS5 parser compilation syntax errors.
    Strips or escapes unmatched quotes, parens, dangling asterisks, carets, colons,
    and handles bare uppercase boolean operators (AND, OR, NOT).
    """
    if not query:
        return ""

    # Normalize unicode smart quotes to ASCII quote or single quote
    query = query.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
    
    # Extract and protect valid NEAR expressions
    nears = []
    def replace_near(match):
        full_expr = match.group(0)
        valid_pattern = r'^NEAR\(\s*[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)+(?:\s*,\s*\d+)?\s*\)$'
        if re.match(valid_pattern, full_expr, re.IGNORECASE):
            inner = re.search(r'\(([^)]*)\)', full_expr).group(1)
            inner_cleaned = " ".join(inner.split())
            placeholder = f"__NEAR_PLACEHOLDER_{len(nears)}__"
            nears.append(f"NEAR({inner_cleaned})")
            return placeholder
        else:
            inner = re.search(r'\(([^)]*)\)', full_expr)
            inner_text = inner.group(1) if inner else ""
            return f"near {inner_text}"
            
    query = re.sub(r'\bNEAR\s*\(([^)]*)\)', replace_near, query, flags=re.IGNORECASE)

    # Replace all punctuation/operators (including colons, carets, hyphens, slashes, commas) 
    # except alphanumeric, spaces, underscores, wildcards, quotes, and parentheses.
    query = re.sub(r'[^\w\s*()"]', ' ', query, flags=re.UNICODE)
    
    # Balance double quotes (strip all if odd count)
    if query.count('"') % 2 != 0:
        query = query.replace('"', ' ')
        
    # Balance parentheses (strip all if unbalanced)
    if query.count('(') != query.count(')'):
        query = query.replace('(', ' ').replace(')', ' ')
        
    # Strip dangling asterisks (asterisks must be at the end of alphanumeric word characters)
    query = re.sub(r'(?<![a-zA-Z0-9])\*', ' ', query)
    query = re.sub(r'\*(?=[a-zA-Z0-9])', ' ', query)

    # Restore protected NEAR expressions
    for i, near_val in enumerate(nears):
        query = query.replace(f"__NEAR_PLACEHOLDER_{i}__", near_val)
    
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
                sanitized_words.append(w_upper)
        elif w_upper == 'NEAR':
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
        (r'(?i)#+\s*@(self|genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b', '# [NEUTRALIZED] Subagent Spoof'),
        (r'(?i)At\s+the\s+START\s+of\s+every\s+session,\s+define\s+the\s+following', '[NEUTRALIZED ACTION] Define subagents'),
        (r'(?i)The\s+main agent\s+MUST\s+follow\s+this\s+workflow', '[NEUTRALIZED ACTION] Main agent workflow'),
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


# ──────────────── Migration helpers (mirrors migrate.py logic) ────────────────

def _extract_tags_from_frontmatter(content):
    match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return ""
    frontmatter = match.group(1)
    desc_match = re.search(r'description:\s*["\']?(.*?)["\']?\s*$', frontmatter, re.MULTILINE)
    if not desc_match:
        return ""
    description = desc_match.group(1)
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
        'it', 'its', 'use', 'used', 'using', 'when', 'what', 'how', 'which',
        'who', 'where', 'why', 'not', 'no', 'all', 'any', 'each', 'every',
        'such', 'than', 'too', 'very', 'just', 'only', 'also', 'into',
        'across', 'about', 'up', 'out', 'if', 'then', 'so', 'as',
    }
    words = re.findall(r'[a-zA-Z0-9_-]+', description.lower())
    keywords = [w for w in words if w not in stop_words and len(w) > 2]
    seen = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    return ",".join(unique[:30])


def _optimize_content(content):
    if not content:
        return ""
    content = re.sub(r'[ \t]+$', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n([ \t]*\n){2,}', '\n\n', content)
    content = shield_prompt_injection(content)
    return content.strip()


def _setup_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    conn.commit()
    return conn


def _auto_detect_skills(skills_dir):
    detected = []
    if not os.path.isdir(skills_dir):
        return detected
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if os.path.isdir(entry_path):
            skill_md = os.path.join(entry_path, "SKILL.md")
            if os.path.isfile(skill_md):
                detected.append(entry)
        elif os.path.isfile(entry_path) and entry.endswith("-skill.md"):
            detected.append(entry)
    return detected


def _migrate_skill(conn, skill_name, skills_dir):
    if skill_name.endswith(".md"):
        skill_name_clean = os.path.splitext(skill_name)[0]
        file_path = os.path.join(skills_dir, skill_name)
        if not os.path.isfile(file_path):
            return 0
        conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name_clean,))
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
        tags = _extract_tags_from_frontmatter(raw_content)
        content = _optimize_content(raw_content)
        byte_size = len(content.encode("utf-8"))
        line_count = content.count("\n") + 1
        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name_clean,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name_clean, skill_name_clean, "skill", tags, content, file_path, byte_size, line_count)
        )
        return 1

    skill_dir = os.path.join(skills_dir, skill_name)
    if not os.path.isdir(skill_dir):
        return 0

    conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name,))
    count = 0

    skill_md = os.path.join(skill_dir, "SKILL.md")
    if os.path.isfile(skill_md):
        with open(skill_md, "r", encoding="utf-8") as f:
            raw_content = f.read()
        tags = _extract_tags_from_frontmatter(raw_content)
        content = _optimize_content(raw_content)
        byte_size = len(content.encode("utf-8"))
        line_count = content.count("\n") + 1
        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name, skill_name, "skill", tags, content, skill_md, byte_size, line_count)
        )
        count += 1

    refs_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(refs_dir):
        for ref_path in sorted(glob.glob(os.path.join(refs_dir, "*.md"))):
            ref_name_raw = os.path.splitext(os.path.basename(ref_path))[0]
            ref_key = f"{skill_name}/{ref_name_raw}"
            with open(ref_path, "r", encoding="utf-8") as f:
                raw_content = f.read()
            tags = ",".join([skill_name] + ref_name_raw.split("-"))
            content = _optimize_content(raw_content)
            byte_size = len(content.encode("utf-8"))
            line_count = content.count("\n") + 1
            conn.execute("DELETE FROM skills WHERE name = ?", (ref_key,))
            conn.execute(
                "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (ref_key, skill_name, "reference", tags, content, ref_path, byte_size, line_count)
            )
            count += 1

    return count


def _normalize_legacy_skill_names(conn):
    rows = conn.execute(
        "SELECT name, skill_name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
    ).fetchall()
    for name, skill_name in rows:
        new_name = normalize_legacy_skill_name(name)
        new_skill_name = normalize_legacy_skill_name(skill_name)
        existing = conn.execute("SELECT 1 FROM skills WHERE name = ?", (new_name,)).fetchone()
        if existing:
            conn.execute("DELETE FROM skills WHERE name = ?", (name,))
        else:
            conn.execute(
                "UPDATE skills SET name = ?, skill_name = ? WHERE name = ?",
                (new_name, new_skill_name, name),
            )


def migrate_skills(force=False, skills=None, skills_dir=None):
    """Re-index all skills in ~/.agents/skills into the SQLite FTS5 database.
    Returns a summary of what was migrated."""
    sys.stderr.write(f"[mcp konoha] tool_call: migrate_skills(force={force}, skills={skills})\n")
    sys.stderr.flush()

    if skills_dir is None:
        skills_dir = os.path.expanduser("~/.agents/skills/")
    if skills:
        skills = [normalize_legacy_skill_name(skill) for skill in skills]
    if not os.path.isdir(skills_dir):
        return json.dumps({"status": "error", "message": f"Skills directory not found: {skills_dir}"})

    conn = _setup_db()

    if skills is None or len(skills) == 0:
        skills = _auto_detect_skills(skills_dir)

    total = 0
    migrated = []
    for skill_name in skills:
        count = _migrate_skill(conn, skill_name, skills_dir)
        total += count
        migrated.append(skill_name)

    _normalize_legacy_skill_names(conn)
    conn.commit()

    cursor = conn.execute("SELECT COUNT(*) FROM skills")
    count = cursor.fetchone()[0]
    conn.close()

    return json.dumps({
        "status": "ok",
        "migrated": migrated,
        "total_skills_migrated": total,
        "total_entries_in_db": count,
        "skills_dir": skills_dir
    })


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
    
    # Check if the path contains custom/workspace skills directories (.agents/skills, .cursor/skills, .gemini/skills, .konoha/skills, skills/, docs/skills)
    normalized_slash_path = norm_fp.replace(os.sep, "/")
    if ".agents/skills" in normalized_slash_path or ".cursor/skills" in normalized_slash_path or ".gemini/skills" in normalized_slash_path or ".konoha/skills" in normalized_slash_path or "/skills/" in normalized_slash_path or "/docs/skills" in normalized_slash_path:
        return True

    global_agents = os.path.normcase(os.path.realpath(AGENTS_DIR))
    global_gemini = os.path.normcase(os.path.realpath(GEMINI_DIR))
    global_konoha = os.path.normcase(os.path.realpath(KONOHA_DIR))

    # Use captured WORKSPACE_ROOT if available, otherwise fallback to os.getcwd()
    workspace = WORKSPACE_ROOT if WORKSPACE_ROOT else os.getcwd()
    current_workspace = os.path.normcase(os.path.realpath(workspace))

    home_dir = os.path.normcase(os.path.realpath(HOME))
    
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
    if norm_fp.startswith(global_konoha + os.sep) or norm_fp == global_konoha:
        return True
        
    if not is_generic_workspace:
        if norm_fp.startswith(current_workspace + os.sep) or norm_fp == current_workspace:
            return True
        
    return False


def content_hash(content):
    """Generate a short hash of content for cache-aware responses."""
    return hashlib.md5(content.encode('utf-8')).hexdigest()[:12]


import time

# Global variable to track the last tool call time per agent to group calls into turns/interactions.
# If an agent calls a tool within 60 seconds of its previous call, we consider it part of the same
# interaction turn. We only credit the baseline_bytes savings ONCE per interaction turn.
LAST_CALL_TIMES = {}


def detect_active_client():
    import glob
    try:
        global ACTIVE_CLIENT
        
        # Explicit ACTIVE_CLIENT override wins over detection heuristics
        if ACTIVE_CLIENT:
            return ACTIVE_CLIENT

        if os.environ.get("CLAUDE_CODE_CHILD_SESSION") == "1":
            return "claudecode"

        if os.environ.get("OPENCODE_CLIENT") == "1" or os.environ.get("OPENCODE_SESSION") == "1":
            return "opencode"

        if os.environ.get("COMMANDCODE_CLIENT") == "1" or os.environ.get("COMMANDCODE_SESSION") == "1":
            return "commandcode"

        # Check environment variable first to distinguish CLI (agy) vs IDE (antigravity)
        conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
        if conv_id:
            if os.environ.get("ANTIGRAVITY_LS_VERSION", "").startswith("cli"):
                return "agy"
            cli_dir = os.path.join(ANTIGRAVITY_CLI_BRAIN, conv_id)
            if os.path.isdir(cli_dir):
                return "agy"
            ide_dir = os.path.join(ANTIGRAVITY_IDE_BRAIN, conv_id)
            if os.path.isdir(ide_dir):
                return "antigravity"

        if conv_id:
            return "antigravity"

        brain_dirs = [
            ANTIGRAVITY_IDE_BRAIN,
            ANTIGRAVITY_CLI_BRAIN,
            CURSOR_PROJECTS,
            CLAUDE_PROJECTS,
        ]
        all_files = []
        for brain_dir in brain_dirs:
            if not os.path.isdir(brain_dir):
                continue
            if "cursor" in brain_dir:
                pattern_transcript = os.path.join(brain_dir, "*", "agent-transcripts", "*", "*.jsonl")
                all_files.extend(glob.glob(pattern_transcript))
            elif "claude" in brain_dir:
                pattern_transcript = os.path.join(brain_dir, "*", "*.jsonl")
                all_files.extend(glob.glob(pattern_transcript))
            else:
                pattern_prompt = os.path.join(brain_dir, "*", "prompt.md")
                pattern_transcript = os.path.join(brain_dir, "*", ".system_generated", "logs", "transcript.jsonl")
                all_files.extend(glob.glob(pattern_prompt) + glob.glob(pattern_transcript))
                
        if not all_files:
            return "antigravity"
            
        all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        most_recent = all_files[0]
        
        if "cursor" in most_recent:
            return "cursor"
        elif "claude" in most_recent:
            return "claudecode"
        elif "antigravity-cli" in most_recent:
            return "agy"
        else:
            return "antigravity"
    except Exception:
        pass
    return "antigravity"


def build_subagent_mcp_block(client=None):
    """Return the MCP-tools block injected into every mcp_<agent> subagent prompt from SQLite."""
    import sqlite3
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT content FROM skills WHERE name = ?", ("konoha/mcp-tools-block",)).fetchone()
        conn.close()
        if row and row[0]:
            return f"\n{row[0]}\n"
    except Exception:
        pass
    return "\n## MCP Tools Available To You\n[Check konoha/mcp-tools-block for available tools]\n"


def log_tool_call(tool_name, query_str, returned_content, agent_name=None):
    """Log the tool call and calculate token savings."""
    global LAST_CALL_TIMES
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
        
        current_time = time.time()
        agent_key = (agent_name or "direct").lower()
        last_time = LAST_CALL_TIMES.get(agent_key, 0)
        
        # Check if this tool call is part of a new interaction turn (more than 60s since last call)
        is_new_turn = (current_time - last_time) > 60
        LAST_CALL_TIMES[agent_key] = current_time
        
        if tool_name not in ("find_skill", "list_skills") or not is_new_turn:
            bytes_saved = 0
            tokens_saved = 0
            total_library_bytes = returned_bytes
        else:
            bytes_saved = max(baseline_bytes - returned_bytes, 0)
            tokens_saved = int(bytes_saved / 4)
            total_library_bytes = baseline_bytes
            
        client_name = detect_active_client()
        conn.execute("""
            INSERT INTO tool_calls (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, client)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (tool_name, query_str, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent_name, client_name))
        
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
    sys.stderr.write(f"[mcp konoha] tool_call: find_skill(keyword='{keyword}', limit={limit}, compact={compact})\n")
    sys.stderr.flush()
    keyword = normalize_legacy_skill_name(keyword)
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
        # Convert any punctuation to space, split, and join with % to match punctuated words (like jonin-skill)
        like_keyword = "%" + "%".join(re.sub(r'[^\w\s]', ' ', keyword).split()) + "%"
        rows = conn.execute("""
            SELECT name, skill_name, type, tags,
                   content, byte_size, line_count, file_path,
                   0 AS rank
            FROM skills
            WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
            ORDER BY byte_size ASC
            LIMIT 50
        """, (like_keyword, like_keyword, like_keyword)).fetchall()

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
    sys.stderr.write(f"[mcp konoha] tool_call: list_skills(fields={fields})\n")
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
    sys.stderr.write(f"[mcp konoha] tool_call: get_skill(name='{name}')\n")
    sys.stderr.flush()
    name = normalize_legacy_skill_name(name)
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
    sys.stderr.write(f"[mcp konoha] tool_call: optimize_report(keyword='{keyword}')\n")
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
            # Convert any punctuation to space, split, and join with % to match punctuated words (like jonin-skill)
            like_keyword = "%" + "%".join(re.sub(r'[^\w\s]', ' ', keyword).split()) + "%"
            rows = conn.execute("""
                SELECT name, skill_name, type, tags,
                       content, byte_size, line_count, file_path,
                       0 AS rank
                FROM skills
                WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ?
                ORDER BY byte_size ASC
                LIMIT 10
            """, (like_keyword, like_keyword, like_keyword)).fetchall()
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


def get_agent_skills(agent_name):
    """Read agent's skills list. Returns None if agent not found."""
    if not agent_name:
        return None
    try:
        # Check SQLite DB agents table first
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT skills FROM agents WHERE name = ?", (agent_name,))
        row = cursor.fetchone()
        conn.close()
        if row:
            skills_str = row["skills"]
            if skills_str:
                return json.loads(skills_str)
            return []
        
        # Fallback to agents.yaml
        agents_yaml_path = USER_AGENTS_YAML
        if os.path.exists(agents_yaml_path):
            with open(agents_yaml_path, 'r', encoding='utf-8') as f:
                content = f.read()
                agents = parse_yaml(content)
                for agent in agents:
                    name = agent.get("name")
                    if name == agent_name:
                        skills = agent.get("skills")
                        return list(skills) if skills is not None else []
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] Error reading agent skills: {str(e)}\n")
        sys.stderr.flush()
    return None


def normalize_framework_name(framework):
    if not framework:
        return "SvelteKit"
    fw_clean = str(framework).lower().replace(".", "").replace(" ", "").replace("-", "")
    if fw_clean in ("next", "nextjs", "react"):
        return "Next.js 16"
    elif fw_clean in ("svelte", "sveltekit"):
        return "SvelteKit"
    elif fw_clean in ("nuxt", "nuxt3", "vue"):
        return "Nuxt 3"
    elif fw_clean in ("angular", "ng"):
        return "Angular v19+ Signals"
    return framework


def _load_skill_content_for_build(skill_names, conn):
    """Load actual skill content from SQLite for embedding in build output."""
    blocks = []
    for name in skill_names:
        resolved = _fuzzy_resolve_skill(name, conn)
        effective = resolved or name
        try:
            row = conn.execute("SELECT content FROM skills WHERE name = ?", (effective,)).fetchone()
            if row and row[0]:
                blocks.append({"skill_name": effective, "content": row[0]})
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Error loading skill {effective}: {e}\n")
            pass
    return blocks



def build_from_source(name, source_dir, framework, agent_name=None):
    """
    Analyze design mockup layouts and reference source files in source_dir and set up project configuration.
    """
    global WORKSPACE_ROOT
    display_framework = normalize_framework_name(framework)
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
        import subprocess
        import sys
        sys.stderr.write("[mcp konoha] Pillow not found. Auto-installing Pillow...\n")
        sys.stderr.flush()
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "Pillow"], check=True)
            from PIL import Image as _Image
            _pil_available = True
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Failed to auto-install Pillow: {e}\n")
            sys.stderr.flush()

    def _analyze_image(fpath):
        meta = {}
        try:
            meta["size_bytes"] = os.path.getsize(fpath)
        except OSError:
            meta["size_bytes"] = 0
        
        if not _pil_available or not _Image:
            meta["warning"] = "Pillow library not installed; image dimensions not analyzed. Please run: pip install Pillow"
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
        f"Build a clean {display_framework} website named '{name}' based on the source design directory '{source_dir}'."
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

    # Read skills assigned to the active agent or default to the "jonin" agent's skill
    agent_skills = None
    if agent_name:
        agent_skills = get_agent_skills(agent_name)
    
    if agent_skills is None:
        # Fall back to "jonin" agent's skills dynamically
        agent_skills = get_agent_skills("jonin")
        
    if agent_skills is None:
        # Defaults based on standard agent roles if agents.json is not readable/found
        target_agent = agent_name if agent_name in ["jonin", "anbu", "kage", "genin", "chunin", "tokubetsu-jonin"] else "jonin"
        if target_agent == "jonin":
            agent_skills = ["jonin-skill"]
        elif target_agent == "anbu":
            agent_skills = ["anbu-skill"]
        elif target_agent == "kage":
            agent_skills = ["kage-skill"]
        elif target_agent == "genin":
            agent_skills = ["genin-skill"]
        elif target_agent == "chunin":
            agent_skills = ["chunin-skill"]
        elif target_agent == "tokubetsu-jonin":
            agent_skills = ["tokubetsu-jonin-skill"]
        else:
            agent_skills = []

    fw_lower_src = display_framework.lower()
    if "next" in fw_lower_src or "react" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nextjs-ui-expert",
            "jonin-skill/nextjs-code-expert"
        ]
    elif "svelte" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/svelte-ui-expert",
            "jonin-skill/svelte-code-expert"
        ]
    elif "nuxt" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nuxt-ui-expert",
            "jonin-skill/nuxt-code-expert"
        ]
    elif "angular" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/angular-ui-expert",
            "jonin-skill/angular-code-expert"
        ]
    else:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives"
        ]

    for fs in framework_skills_src:
        if fs not in agent_skills:
            agent_skills.append(fs)

    absolute_image_paths = []
    if detected_images:
        for m in detected_images:
            fpath = os.path.join(resolved_source_dir, m["filename"])
            absolute_image_paths.append(os.path.abspath(fpath))

    directives.append("You MUST follow the package.json template, CSS variables, design-token manifest, and routing rules from the embedded skill content below.")
    if "next" in fw_lower_src or "react" in fw_lower_src:
        directives.append("Use Next.js App Router under app/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, and the framework's production build tools.")
    elif "svelte" in fw_lower_src:
        directives.append("Use SvelteKit file-based routing under src/routes/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, Prettier, and svelte-check.")
    elif "nuxt" in fw_lower_src:
        directives.append("Use Nuxt file-based routing under pages/ and layouts/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, and Nuxt build tools.")
    elif "angular" in fw_lower_src:
        directives.append("Use standalone Angular Router with app.routes.ts — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, and Angular build tools.")
    else:
        directives.append("Use framework-native routing — NEVER hash-based SPA routing.")
    directives.append("Provide pnpm run lint and pnpm run build scripts; SvelteKit must also provide pnpm run check. All validation must finish with zero errors and zero warnings.")

    # Load critical skill content
    skill_blocks = []
    try:
        conn = sqlite3.connect(DB_PATH)
        fw_base = "svelte" if "svelte" in fw_lower_src else "nextjs" if "next" in fw_lower_src or "react" in fw_lower_src else "nuxt" if "nuxt" in fw_lower_src else "angular" if "angular" in fw_lower_src else None
        critical_skills = [
            f"jonin-skill/{fw_base}-code-expert" if fw_base else None,
            "jonin-skill/build-directives-manifest",
            "jonin-skill/design-token-manifest",
        ]
        critical_skills = [s for s in critical_skills if s]
        skill_blocks = _load_skill_content_for_build(critical_skills, conn)
        conn.close()
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] Error loading skill content for build_from_source: {e}\n")
        sys.stderr.flush()

    spec = {
        "status": "success",
        "project_name": name,
        "framework": framework,
        "mode": "build_from_source",
        "source_directory": resolved_source_dir,
        "detected_images": detected_images,
        "detected_sources": detected_sources,
        "directives": directives,
        "image_to_code_required": len(detected_images) > 0,
        "required_skills": agent_skills,
        "skill_load_sequence": agent_skills,
        "delegate_constraints": directives,
        "absolute_image_paths": absolute_image_paths,
        "forbid_build_from_text": len(detected_images) > 0,
        "embedded_skill_content": skill_blocks
    }

    res = json.dumps(spec, indent=2)
    log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}, framework={framework}", res, agent_name=agent_name)
    return res


def build_from_text(name, description, framework, agent_name=None):
    """
    Generate structure and instructions from description, automatically including
    the default premium templates and visual effects.
    """
    display_framework = normalize_framework_name(framework)
    
    # Read skills assigned to the active agent or default to the "jonin" agent's skill
    agent_skills = None
    if agent_name:
        agent_skills = get_agent_skills(agent_name)
    
    if agent_skills is None:
        # Fall back to "jonin" agent's skills dynamically
        agent_skills = get_agent_skills("jonin")
        
    if agent_skills is None:
        # Defaults based on standard agent roles if agents.json is not readable/found
        target_agent = agent_name if agent_name in ["jonin", "anbu", "kage", "genin", "chunin", "tokubetsu-jonin"] else "jonin"
        if target_agent == "jonin":
            agent_skills = ["jonin-skill"]
        elif target_agent == "anbu":
            agent_skills = ["anbu-skill"]
        elif target_agent == "kage":
            agent_skills = ["kage-skill"]
        elif target_agent == "genin":
            agent_skills = ["genin-skill"]
        elif target_agent == "chunin":
            agent_skills = ["chunin-skill"]
        elif target_agent == "tokubetsu-jonin":
            agent_skills = ["tokubetsu-jonin-skill"]
        else:
            agent_skills = []

    fw_lower = display_framework.lower()
    if "next" in fw_lower or "react" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nextjs-ui-expert",
            "jonin-skill/nextjs-code-expert"
        ]
    elif "svelte" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/svelte-ui-expert",
            "jonin-skill/svelte-code-expert"
        ]
    elif "nuxt" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nuxt-ui-expert",
            "jonin-skill/nuxt-code-expert"
        ]
    elif "angular" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/angular-ui-expert",
            "jonin-skill/angular-code-expert"
        ]
    else:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives"
        ]

    for fs in framework_skills:
        if fs not in agent_skills:
            agent_skills.append(fs)

    if "next" in fw_lower or "react" in fw_lower:
        routing_directive = "Use Next.js App Router with the `app/` directory. NEVER use hash-based SPA routing."
        install_directive = "Install ALL packages from the template package.json including Tailwind V4, SweetAlert2, and ESLint."
    elif "svelte" in fw_lower:
        routing_directive = "Use SvelteKit file-based routing (src/routes/) — NEVER hash-based SPA routing."
        install_directive = "Install ALL packages from the template package.json including Tailwind V4, SweetAlert2, and svelte-check."
    elif "nuxt" in fw_lower:
        routing_directive = "Use Nuxt file-based routing (pages/ directory) — NEVER hash-based SPA routing."
        install_directive = "Install ALL packages from the template package.json including Tailwind V4, SweetAlert2, and @nuxt/eslint."
    elif "angular" in fw_lower:
        routing_directive = "Use Angular Router with the standard `app.routes.ts` config — NEVER hash-based SPA routing."
        install_directive = "Install ALL packages from the template package.json including Tailwind V4, SweetAlert2, and Angular CLI build tools."
    else:
        routing_directive = "Use framework-native file-based routing — NEVER hash-based SPA routing."
        install_directive = "Install ALL packages from the template package.json including Tailwind V4 and SweetAlert2."

    build_directives = [
        f"Build a premium, elegant {display_framework} website named '{name}' based on the description: '{description}'.",
        "You MUST follow the package.json template, CSS variables, and routing rules from the embedded skill content below.",
        routing_directive,
        install_directive
    ]

    # Load critical skill content
    skill_blocks = []
    try:
        conn = sqlite3.connect(DB_PATH)
        fw_base = "svelte" if "svelte" in fw_lower else "nextjs" if "next" in fw_lower or "react" in fw_lower else "nuxt" if "nuxt" in fw_lower else "angular" if "angular" in fw_lower else None
        critical_skills = [
            f"jonin-skill/{fw_base}-code-expert" if fw_base else None,
            "jonin-skill/build-directives-manifest",
            "jonin-skill/design-token-manifest",
        ]
        critical_skills = [s for s in critical_skills if s]
        skill_blocks = _load_skill_content_for_build(critical_skills, conn)
        conn.close()
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] Error loading skill content for build_from_text: {e}\n")
        sys.stderr.flush()

    spec = {
        "status": "success",
        "project_name": name,
        "framework": framework,
        "mode": "build_from_text",
        "description": description,
        "directives": build_directives,
        "required_skills": agent_skills,
        "skill_load_sequence": agent_skills,
        "delegate_constraints": build_directives,
        "embedded_skill_content": skill_blocks
    }
    res = json.dumps(spec, indent=2)
    log_tool_call("build_from_text", f"name={name}, description={description}, framework={framework}", res, agent_name=agent_name)
    return res


def detect_active_agent():
    import glob
    import json
    import re
    import sqlite3
    global WORKSPACE_ROOT, ACTIVE_CLIENT
    try:
        conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
        if ACTIVE_CLIENT in ["cursor", "claudecode"]:
            conv_id = None

        brain_dirs = []
        if conv_id:
            brain_dirs = [
                os.path.join(ANTIGRAVITY_IDE_BRAIN, conv_id),
                os.path.join(ANTIGRAVITY_CLI_BRAIN, conv_id),
            ]
        slug = ""
        if WORKSPACE_ROOT:
            normalized_path = os.path.normpath(WORKSPACE_ROOT).strip("/")
            slug = normalized_path.replace("/", "-")

        if CURSOR_PROJECTS not in brain_dirs:
            brain_dirs.append(CURSOR_PROJECTS)
        if CLAUDE_PROJECTS not in brain_dirs:
            brain_dirs.append(CLAUDE_PROJECTS)
        if ANTIGRAVITY_IDE_BRAIN not in brain_dirs:
            brain_dirs.append(ANTIGRAVITY_IDE_BRAIN)
        if ANTIGRAVITY_CLI_BRAIN not in brain_dirs:
            brain_dirs.append(ANTIGRAVITY_CLI_BRAIN)

        all_files = []
        for brain_dir in brain_dirs:
            if not os.path.isdir(brain_dir):
                continue

            if "cursor" in brain_dir:
                # Cursor paths: ~/.cursor/projects/*/agent-transcripts/*/*.jsonl or local workspace match
                if WORKSPACE_ROOT and brain_dir.endswith(slug):
                    pattern_transcript = os.path.join(brain_dir, "agent-transcripts", "*", "*.jsonl")
                else:
                    pattern_transcript = os.path.join(brain_dir, "*", "agent-transcripts", "*", "*.jsonl")
                all_files.extend(glob.glob(pattern_transcript))
            elif "claude" in brain_dir:
                # Claude Code paths: ~/.claude/projects/*/*.jsonl or local workspace match
                if WORKSPACE_ROOT and brain_dir.endswith("-" + slug):
                    pattern_transcript = os.path.join(brain_dir, "*.jsonl")
                else:
                    pattern_transcript = os.path.join(brain_dir, "*", "*.jsonl")
                all_files.extend(glob.glob(pattern_transcript))
            elif conv_id and ("antigravity-ide" in brain_dir or "antigravity-cli" in brain_dir):
                # Session-isolated Antigravity paths
                pattern_prompt = os.path.join(brain_dir, "prompt.md")
                pattern_transcript = os.path.join(brain_dir, ".system_generated", "logs", "transcript.jsonl")
                all_files.extend(glob.glob(pattern_prompt) + glob.glob(pattern_transcript))
            else:
                # Antigravity paths
                pattern_prompt = os.path.join(brain_dir, "*", "prompt.md")
                pattern_transcript = os.path.join(brain_dir, "*", ".system_generated", "logs", "transcript.jsonl")
                all_files.extend(glob.glob(pattern_prompt) + glob.glob(pattern_transcript))

        # Filter only existing files to prevent FileNotFoundError during sort if concurrently deleted
        all_files = [f for f in all_files if os.path.exists(f)]
        
        detected = None
        visited_dirs = set()
        fallback_agent = None

        if all_files:
            all_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)

            for fpath in all_files:
                if fpath.endswith("prompt.md"):
                    conv_dir = os.path.dirname(fpath)
                elif "agent-transcripts" in fpath:
                    # For Cursor: .cursor/projects/<project>/agent-transcripts/xyz.jsonl
                    conv_dir = os.path.dirname(os.path.dirname(fpath))
                elif "claude" in fpath:
                    # For Claude: ~/.claude/projects/<project>/<sessionId>.jsonl
                    conv_dir = os.path.dirname(fpath)
                else:
                    conv_dir = os.path.dirname(os.path.dirname(os.path.dirname(fpath)))

                conv_dir = os.path.normpath(conv_dir)
                if conv_dir in visited_dirs:
                    continue
                visited_dirs.add(conv_dir)

                # 1. Try prompt.md first (guaranteed to be written/created before subagent starts)
                prompt_path = os.path.join(conv_dir, "prompt.md")
                if os.path.exists(prompt_path):
                    try:
                        with open(prompt_path, "r", encoding="utf-8") as f:
                            prompt_content = f.read()

                        # Search for [Icon Agent] active
                        if "[konoha] orchestrator active" in prompt_content.lower() or "[konoha] active" in prompt_content.lower() or "orchestrator active" in prompt_content.lower():
                            detected = "orchestrator"
                        else:
                            match = re.search(r"\[([^\]]+)\]\s+active", prompt_content)
                            if match:
                                agent_name = match.group(1).split()[-1].lower()
                                if agent_name in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                                    detected = agent_name
                                elif agent_name in ["antigravity", "orchestrator"]:
                                    detected = "orchestrator"

                        if not detected:
                            # Search for explicit "You are the X agent" or "Log: ... X ... active"
                            for candidate in ["anbu", "genin", "chunin", "tokubetsu-jonin", "jonin", "kage"]:
                                if re.search(rf"\b{candidate}\b", prompt_content, re.IGNORECASE):
                                    if re.search(rf"you\s+are\s+(?:the|a)\s+{candidate}\s+(?:agent|subagent|scout|builder|intel|scribe|leader)", prompt_content, re.IGNORECASE):
                                        detected = candidate
                                        break
                                    if re.search(rf"Log:\s*\"\[.*{candidate}.*\]\s*active\"", prompt_content, re.IGNORECASE):
                                        detected = candidate
                                        break
                    except Exception:
                        pass

                # 2. Try transcript.jsonl (Antigravity or Cursor)
                if not detected:
                    if ("agent-transcripts" in fpath or "claude" in fpath) and fpath.endswith(".jsonl"):
                        transcript_path = fpath
                    else:
                        transcript_path = os.path.join(conv_dir, ".system_generated", "logs", "transcript.jsonl")

                    if os.path.exists(transcript_path):
                        try:
                            with open(transcript_path, "r", encoding="utf-8") as f:
                                lines = f.readlines()
                            for line in reversed(lines):
                                try:
                                    data = json.loads(line)
                                    content = ""

                                    # Extract content from Cursor format
                                    if isinstance(data, dict) and "message" in data:
                                        message = data.get("message", {})
                                        if isinstance(message, dict):
                                            content_list = message.get("content", [])
                                            if isinstance(content_list, list):
                                                for block in content_list:
                                                    if isinstance(block, dict):
                                                        if block.get("type") == "text":
                                                            content += " " + block.get("text", "")
                                                        elif block.get("type") == "tool_use" and block.get("name") == "Task":
                                                            tool_input = block.get("input", {})
                                                            if isinstance(tool_input, dict) and "subagent_type" in tool_input:
                                                                detected = tool_input["subagent_type"]
                                                                break
                                                if detected:
                                                    break

                                    # Extract content from standard format
                                    if not content and isinstance(data, dict):
                                        content = data.get("content", "")

                                    if not content:
                                        continue

                                    if "[konoha] orchestrator active" in content.lower() or "[konoha] active" in content.lower() or "orchestrator active" in content.lower():
                                        detected = "orchestrator"
                                        break

                                    match = re.search(r"\[([^\]]+)\]\s+active", content)
                                    if match:
                                        agent_name = match.group(1).split()[-1].lower()
                                        # Agent names are now bare (no mcp_ prefix)
                                        agent_name = agent_name.replace("_", "-")
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
                    # Save active session mapping to SQLite database
                    try:
                        conn = sqlite3.connect(DB_PATH)
                        conn.execute("""
                            CREATE TABLE IF NOT EXISTS active_sessions (
                                client TEXT NOT NULL,
                                workspace_root TEXT NOT NULL,
                                session_id TEXT NOT NULL,
                                transcript_path TEXT,
                                last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                PRIMARY KEY (client, workspace_root)
                            );
                        """)
                        sess_id = conv_id
                        if not sess_id:
                            parts = os.path.normpath(fpath).split(os.sep)
                            if "agent-transcripts" in parts:
                                idx = parts.index("agent-transcripts")
                                if idx + 1 < len(parts):
                                    sess_id = parts[idx+1]
                            elif "claude" in parts:
                                sess_id = os.path.splitext(os.path.basename(fpath))[0]
                        
                        if sess_id:
                            conn.execute("""
                                INSERT OR REPLACE INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
                                VALUES (?, ?, ?, ?, datetime('now'))
                            """, (ACTIVE_CLIENT or "unknown", WORKSPACE_ROOT or "unknown", sess_id, fpath))
                            conn.commit()
                        conn.close()
                    except Exception as err:
                        sys.stderr.write(f"  [Warning] Failed to write active session: {str(err)}\n")
                        sys.stderr.flush()
                    return detected

                # Check up to 15 most recent folders to find a subagent
                if len(visited_dirs) >= 15:
                    break

        # Fallback to database query if no active session files were found
        if WORKSPACE_ROOT:
            try:
                conn = sqlite3.connect(DB_PATH)
                row = conn.execute("""
                    SELECT session_id, transcript_path FROM active_sessions
                    WHERE client = ? AND workspace_root = ?
                """, (ACTIVE_CLIENT or "unknown", WORKSPACE_ROOT)).fetchone()
                conn.close()
                if row:
                    sess_id, tx_path = row
                    if tx_path and os.path.exists(tx_path):
                        try:
                            with open(tx_path, "r", encoding="utf-8") as f:
                                lines = f.readlines()
                            for line in reversed(lines):
                                data = json.loads(line)
                                content = ""
                                if isinstance(data, dict) and "message" in data:
                                    message = data.get("message", {})
                                    if isinstance(message, dict):
                                        content_list = message.get("content", [])
                                        if isinstance(content_list, list):
                                            for block in content_list:
                                                if isinstance(block, dict) and block.get("type") == "text":
                                                    content += " " + block.get("text", "")
                                if not content and isinstance(data, dict):
                                    content = data.get("content", "")
                                if content:
                                    match = re.search(r"\[([^\]]+)\]\s+active", content)
                                    if match:
                                        agent_name = match.group(1).split()[-1].lower()
                                        # Agent names are now bare (no mcp_ prefix)
                                        agent_name = agent_name.replace("_", "-")
                                        if agent_name in ["anbu", "genin", "chunin", "jonin", "kage", "tokubetsu-jonin"]:
                                            return agent_name
                        except Exception:
                            pass
            except Exception:
                pass  # per-branch failures are non-fatal; continue searching

        sys.stderr.write(f"[mcp konoha] detect_active_agent: no agent detected, returning {fallback_agent!r}\n")
        sys.stderr.flush()
        return fallback_agent
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] detect_active_agent: fatal error: {e}\n")
        sys.stderr.flush()
    return None

def get_active_session_id():
    conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
    if conv_id:
        return conv_id
        
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("""
            SELECT session_id FROM active_sessions
            WHERE client = ? AND workspace_root = ?
        """, (ACTIVE_CLIENT or "unknown", WORKSPACE_ROOT or "unknown")).fetchone()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
        
    return ""

def get_konoha_tmp_root():
    """Return the canonical scratch root outside the user's workspace.

    Layout: ~/.konoha/tmp/<client>/<session_id>/scratch/tasks
    Falls back to /tmp/konoha-<pid>-<ts>/scratch/tasks if ~/.konoha is not writable.
    Never returns a path inside the user's project directory, so accidental
    `git add` of transient agent files is impossible.
    """
    client = ACTIVE_CLIENT
    if not client:
        client = detect_active_client()
    if not client:
        client = "unknown"
    sess = ""
    try:
        sess = get_active_session_id()
    except Exception:
        sess = ""
    if not sess:
        sess = "default"

    konoha_root = KONOHA_DIR
    try:
        target = os.path.join(konoha_root, "tmp", client, sess)
        os.makedirs(target, exist_ok=True)
        # Probe writability
        probe = os.path.join(target, ".write_probe")
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
        return target
    except Exception:
        pass

    fallback = os.path.join(tempfile.gettempdir(), f"konoha-{os.getpid()}-{int(os.environ.get('KONOHA_TS', '0') or 0) or 'x'}")
    try:
        os.makedirs(fallback, exist_ok=True)
        return fallback
    except Exception:
        return tempfile.gettempdir()


def _levenshtein(a, b):
    """Compute Levenshtein edit distance between two strings."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(
                cur[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + (0 if ca == cb else 1),
            )
        prev = cur
    return prev[-1]


def _autoload_skills_from_prompt(prompt, conn, max_matches=3):
    """Scan prompt for keyword matches against the skills table.

    Returns a list of skill_name strings whose name or content (truncated)
    contains prompt tokens. Falls back to scanning all skill_name + first
    200 chars of content per skill. Used when an agent has no explicit skills
    list, so e.g. a prompt about "docker" auto-loads the docker skill.
    """
    if not prompt or not prompt.strip():
        return []
    prompt_lower = prompt.lower()
    tokens = [t for t in prompt_lower.replace("\n", " ").split() if len(t) > 3]
    if not tokens:
        return []

    rows = conn.execute(
        "SELECT skill_name, content FROM skills WHERE type = 'skill'"
    ).fetchall()
    scored = []
    for name, content in rows:
        haystack = (name + " " + (content or "")[:200]).lower()
        score = sum(1 for t in tokens if t in haystack)
        if score > 0:
            scored.append((score, name))
    scored.sort(key=lambda x: -x[0])
    return [name for _, name in scored[:max_matches]]


def _fuzzy_resolve_skill(requested, conn, max_distance=3):
    """Resolve a requested skill name to a real skill in the DB.

    Tries exact match first, then falls back to Levenshtein-based fuzzy match
    against the `skills` table (skill_name column). Returns the resolved
    skill_name, or None if no candidate is close enough.
    """
    requested = normalize_legacy_skill_name(requested)
    row = conn.execute(
        "SELECT content FROM skills WHERE skill_name = ? AND type = 'skill'",
        (requested,),
    ).fetchone()
    if row:
        return requested

    candidates = conn.execute(
        "SELECT DISTINCT skill_name FROM skills WHERE type = 'skill'"
    ).fetchall()
    best_name, best_dist = None, max_distance + 1
    for (name,) in candidates:
        d = _levenshtein(requested.lower(), name.lower())
        if d < best_dist:
            best_dist = d
            best_name = name
    return best_name


def get_resolved_task_dir(task_dir=None):
    # Task dirs MUST live outside the workspace to avoid accidental commits.
    # New layout: <konoha_tmp_root>/scratch/tasks[/<name>]
    tmp_root = get_konoha_tmp_root()
    tasks_dir = os.path.join(tmp_root, "scratch", "tasks")
    if not task_dir:
        if os.path.isdir(tasks_dir):
            subdirs = [os.path.join(tasks_dir, d) for d in os.listdir(tasks_dir)
                       if os.path.isdir(os.path.join(tasks_dir, d))]
            if subdirs:
                return max(subdirs, key=os.path.getmtime)
        return os.path.join(tasks_dir, "default")
    if not os.path.isabs(task_dir):
        task_dir = os.path.abspath(os.path.join(tasks_dir, task_dir))
    return task_dir

def get_main_model():
    try:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT model_tier FROM agents WHERE name = ?", ("sannin",)).fetchone()
        if row and row[0]:
            conn.close()
            return row[0]
        row = conn.execute("SELECT model_tier FROM agents WHERE name = ?", ("kage",)).fetchone()
        if row and row[0]:
            conn.close()
            return row[0]
        conn.close()
    except Exception:
        pass
    return "Gemini 3.1 Pro (High)"

def apply_file_edits(content):
    workspace = WORKSPACE_ROOT if WORKSPACE_ROOT else os.getcwd()
    pattern = r"(?i)FILE:\s*(.*?)\n<<<<<<<\s*original\n(.*?)\n=======\n(.*?)\n>>>>>>>"
    matches = re.finditer(pattern, content, re.DOTALL)
    for match in matches:
        file_path = match.group(1).strip()
        original = match.group(2)
        replacement = match.group(3)
        
        if not os.path.isabs(file_path):
            file_path = os.path.abspath(os.path.join(workspace, file_path))
            
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        if not original.strip():
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(replacement)
        else:
            if os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    file_content = f.read()
                if original in file_content:
                    new_content = file_content.replace(original, replacement, 1)
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                else:
                    original_lf = original.replace("\r\n", "\n")
                    file_content_lf = file_content.replace("\r\n", "\n")
                    if original_lf in file_content_lf:
                        new_content = file_content_lf.replace(original_lf, replacement, 1)
                        with open(file_path, "w", encoding="utf-8") as f:
                            f.write(new_content)

def run_sannin(prompt=None, task_dir=None):
    import json
    import os
    import urllib.request
    import urllib.error

    task_dir = get_resolved_task_dir(task_dir)
    os.makedirs(task_dir, exist_ok=True)

    result_path = os.path.join(task_dir, "result.md")
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                result = f.read().strip()
            res = json.dumps({"status": "completed", "phase": "result", "result": result, "task_dir": task_dir})
            log_tool_call("sannin", f"task_dir={task_dir}", res, agent_name="sannin")
            return res
        except Exception as e:
            return json.dumps({"status": "error", "message": f"Failed to read result.md: {str(e)}"})

    if not prompt:
        prompt_path = os.path.join(task_dir, "prompt.md")
        if os.path.exists(prompt_path):
            try:
                with open(prompt_path, "r", encoding="utf-8") as f:
                    prompt = f.read().strip()
            except Exception as e:
                return json.dumps({"status": "error", "message": f"Failed to read prompt.md: {str(e)}"})
        else:
            return json.dumps({"status": "error", "message": "No prompt provided and prompt.md not found in task directory."})

    # Auto-route by keywords
    selected_agent_suffix = _route_by_keywords_with_prompt(task_dir, prompt)
    # Strip mcp_ prefix from DB agent name to produce bare tool name.
    if selected_agent_suffix.startswith("mcp_"):
        selected_agent = selected_agent_suffix[4:]
    else:
        selected_agent = selected_agent_suffix

    import sqlite3
    agent_descriptions = {}
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT name, title, purpose FROM agents")
        for row in cursor.fetchall():
            name = row[0]
            # Provide description from DB; key by both prefixed and bare form.
            desc = row[2] if row[2] else row[1]
            agent_descriptions[name] = desc
            if name.startswith("mcp_"):
                agent_descriptions[name[4:]] = desc
        conn.close()
    except Exception:
        pass
    description = agent_descriptions.get(selected_agent, "general-purpose delegation")

    instruction = (
        f"**Selected Agent**: `{selected_agent}`\n"
        f"**Reason**: {description}\n\n"
        f"Task directory: `{task_dir}`\n\n"
        f"## Delegation Steps\n\n"
        f"1. Write `delegate.md` in the task directory with the frontmatter (agent name, priority) and the task instructions.\n"
        f"2. Call `{selected_agent}` with `task_dir={task_dir}` — it will read delegate.md and prepare the task for execution.\n"
        f"3. The agent will execute the task and write `result.md` to the same task directory (Write `result.md`).\n"
        f"4. After `result.md` exists, call `sannin` again with `task_dir={task_dir}` to receive the final result.\n\n"
        f"## Original Prompt\n\n{prompt}"
    )

    res = json.dumps({
        "status": "routed",
        "selected_agent": selected_agent,
        "phase": "delegation",
        "instructions": instruction,
        "task_dir": task_dir,
    })
    log_tool_call("sannin", f"task_dir={task_dir}", res, agent_name="sannin")
    return res


def _load_workflow_status(task_dir):
    status_path = os.path.join(task_dir, "status.json")
    if os.path.exists(status_path):
        try:
            with open(status_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "phase": "route",
        "assigned_agent": None,
        "executed": {},
        "pending_executors": [],
        "completed_executors": [],
        "history": [],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _save_workflow_status(task_dir, status):
    status_path = os.path.join(task_dir, "status.json")
    with open(status_path, "w", encoding="utf-8") as f:
        json.dump(status, f, indent=2)


def _read_file_safe(path):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
    except Exception:
        pass
    return None


def _route_by_keywords_with_prompt(task_dir, prompt=""):
    """Route to the best agent based on delegation_keywords from the DB.

    Uses the explicit prompt when provided; otherwise falls back to prompt.md
    in task_dir. Returns the agent suffix without the mcp_ prefix.

    Scoring:
      - Each comma-separated keyword phrase contributes points based on how
        many of its individual tokens appear in the prompt (after lowercasing).
      - Full phrase match (the entire phrase appears verbatim) is weighted
        extra so multi-word phrases still win ties against loose single-token
        overlap from competitors.
    """
    if not prompt:
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md")) or ""
    if not prompt:
        return "kage"

    prompt_lower = prompt.lower()
    best_score = 0
    best_agent = None

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        agents = conn.execute(
            "SELECT name, delegation_keywords FROM agents "
            "WHERE delegation_keywords IS NOT NULL AND delegation_keywords != ''"
        ).fetchall()
        conn.close()

        for agent in agents:
            kw_text = agent["delegation_keywords"].lower()
            agent_score = 0
            for kw in kw_text.split(","):
                kw = kw.strip()
                if not kw:
                    continue
                # Full phrase match: high-weight hit
                if kw in prompt_lower:
                    agent_score += (kw.count(" ") + 1) * 2
                    continue
                # Token-level match: each token of the phrase that appears in
                # the prompt contributes a single point. This catches prompts
                # that rephrase keywords (e.g. "trace the auth flow" for the
                # keyword "trace flows").
                tokens = [t for t in kw.split() if t]
                if not tokens:
                    continue
                hits = sum(1 for t in tokens if t in prompt_lower)
                if hits == tokens:
                    # All tokens present but not contiguous — still strong signal
                    agent_score += hits
                elif hits > 0:
                    # Partial match: small contribution, only if any other
                    # competitor has zero hits we still want some signal.
                    agent_score += hits * 0.5

            if agent_score > best_score:
                best_score = agent_score
                best_agent = agent["name"]
    except Exception:
        pass

    if not best_agent:
        best_agent = "kage"

    # Tiebreak / override: PRD and technical documentation writing should route
    # to tokubetsu_jonin (writer), not chunin (researcher), even if
    # both have a same-scoring "documentation" match.
    write_signals = ("prd", "write a prd", "technical doc", "write the doc",
                     "draft the doc", "write docs", "author", "write a spec")
    if any(sig in prompt_lower for sig in write_signals):
        best_agent = "tokubetsu_jonin"

    return best_agent


def _route_by_keywords(task_dir):
    """Route to the best agent based on delegation_keywords from the DB.

    Reads prompt.md from task_dir if no explicit prompt is given.
    Delegates to _route_by_keywords_with_prompt.
    """
    return _route_by_keywords_with_prompt(task_dir, prompt="")


def run_mcp_workflow(task_dir=None):
    """Multi-agent workflow orchestrator.

    Phases: route -> explore -> plan -> [research] -> execute -> document -> synthesize -> done

    Each call processes one advancement and returns the next phase/agent to dispatch.
    Status is persisted in status.json within task_dir.
    """
    task_dir = get_resolved_task_dir(task_dir)
    os.makedirs(task_dir, exist_ok=True)

    status = _load_workflow_status(task_dir)
    phase = status.get("phase", "route")

    # --- DONE: return completed ---
    if phase == "done":
        return json.dumps({"status": "completed", "phase": "done"})

    # --- ROUTE: auto-route and advance to explore ---
    if phase == "route":
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md"))
        if not prompt:
            return json.dumps({
                "status": "error",
                "message": "No prompt.md found in task directory.",
                "phase": "route",
            })
        agent = _route_by_keywords(task_dir)
        status["phase"] = "explore"
        status["assigned_agent"] = agent
        status["history"].append({"phase": "route", "agent": agent})
        _save_workflow_status(task_dir, status)
        phase = "explore"

    # --- Check if explore agent (genin) is done, advance to plan ---
    if (status.get("assigned_agent") == "genin" and
            os.path.exists(os.path.join(task_dir, "result.md"))):
        status["phase"] = "plan"
        status["history"].append({"phase": "explore", "agent": "genin"})
        _save_workflow_status(task_dir, status)
        phase = "plan"

    # --- EXPLORE: dispatch genin (only if not already done) ---
    if phase == "explore":
        agent = "genin"
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md")) or ""
        delegate = (
            f"agent: genin\n"
            f"priority: medium\n"
            f"Phase: Explore\n\n"
            f"## TASK\n\n{prompt}\n\n"
            f"Read-only exploration. Map the codebase and write your findings to findings.md.\n"
            f"Then write your results to result.md."
        )
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(delegate)
        status["assigned_agent"] = agent
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "explore", "agent": agent, "task_dir": task_dir})

    # --- Check if plan agent (kage) is done, advance to execute/research ---
    if (status.get("assigned_agent") == "kage" and
            os.path.exists(os.path.join(task_dir, "result.md"))):
        plan_content = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
        if not plan_content:
            plan_content = _read_file_safe(os.path.join(task_dir, "result.md")) or ""
        status["history"].append({"phase": "plan", "agent": "kage"})
        _save_workflow_status(task_dir, status)
        if "needs_research:" in plan_content.lower():
            status["phase"] = "research"
            _save_workflow_status(task_dir, status)
            phase = "research"
        else:
            import re
            executors = []
            for line in plan_content.split("\n"):
                m2 = re.match(r'^- \[(\w+)\]: (.+)', line.strip())
                if m2:
                    executors.append({"agent": m2.group(1), "task": m2.group(2)})
            status["pending_executors"] = [e["agent"] for e in executors] if executors else ["genin"]
            status["phase"] = "execute"
            _save_workflow_status(task_dir, status)
            phase = "execute"

    # --- Check if research agent (chunin) is done, advance to plan ---
    # This must be BEFORE dispatch kage because it changes phase to "plan"
    if (status.get("assigned_agent") == "chunin" and
            os.path.exists(os.path.join(task_dir, "result.md"))):
        status["phase"] = "plan"
        status["history"].append({"phase": "research", "agent": "chunin"})
        _save_workflow_status(task_dir, status)
        phase = "plan"

    # --- PLAN: dispatch kage (only if not already done) ---
    if phase == "plan":
        agent = "kage"
        findings = _read_file_safe(os.path.join(task_dir, "findings.md")) or "No findings available."
        delegate = (
            f"agent: kage\n"
            f"priority: high\n"
            f"Phase: Plan\n\n"
            f"## TASK\n\n"
            f"Analyze the codebase and produce a detailed implementation plan.\n\n"
            f"## FINDINGS\n\n{findings}"
        )
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(delegate)
        status["assigned_agent"] = agent
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "plan", "agent": agent, "task_dir": task_dir})

    # --- RESEARCH: dispatch chunin (only if not already done) ---
    if phase == "research":
        agent = "chunin"
        # Read research context from plan for the research_query
        plan_context = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
        findings = _read_file_safe(os.path.join(task_dir, "findings.md")) or ""

        research_query = ""
        for line in plan_context.split("\n"):
            if line.startswith("research_query:") or line.startswith("research_query :"):
                research_query = line.split(":", 1)[1].strip()
                break

        task_desc = f"Conduct web research based on the plan requirements."
        if research_query:
            task_desc = f"Conduct web research on: {research_query}"

        delegate = (
            f"agent: chunin\n"
            f"priority: medium\n"
            f"Phase: Research\n\n"
            f"## TASK\n\n{task_desc}\n\n"
            f"## CONTEXT\n\n{findings}"
        )
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(delegate)
        status["assigned_agent"] = agent
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "research", "agent": agent, "task_dir": task_dir})

    # --- EXECUTE: check if current execute agent is done, mark completed ---
    if (status.get("phase") == "execute" and
            status.get("assigned_agent") and
            status.get("assigned_agent") not in ("genin", "kage", "chunin", "tokubetsu-jonin") and
            os.path.exists(os.path.join(task_dir, "result.md"))):
        agent_name = status["assigned_agent"]
        if agent_name and agent_name not in status.get("completed_executors", []):
            status.setdefault("completed_executors", []).append(agent_name)
        _save_workflow_status(task_dir, status)

    # --- EXECUTE: check if all executors already done, advance ---
    if phase == "execute":
        if status.get("pending_executors"):
            remaining = [a for a in status["pending_executors"]
                         if a not in status.get("completed_executors", [])]
            if not remaining:
                status["phase"] = "document"
                _save_workflow_status(task_dir, status)
                phase = "document"

    # --- EXECUTE: dispatch next pending agent (only if not already done) ---
    if phase == "execute":
        if not status.get("pending_executors"):
            status["phase"] = "document"
            _save_workflow_status(task_dir, status)
            phase = "document"
        else:
            # Find first not-yet-completed agent
            next_agent = None
            for a in status["pending_executors"]:
                if a not in status.get("completed_executors", []):
                    next_agent = a
                    break

            if next_agent:
                plan_content = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
                if not plan_content:
                    plan_content = _read_file_safe(os.path.join(task_dir, "result.md")) or ""

                delegate = (
                    f"agent: {next_agent}\n"
                    f"priority: high\n"
                    f"Phase: Execute\n\n"
                    f"## TASK\n\n{plan_content}\n\n"
                    f"Execute your part of the implementation. Write results to result.md."
                )
                with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
                    f.write(delegate)
                status["assigned_agent"] = next_agent
                _save_workflow_status(task_dir, status)
                return json.dumps({"status": "ready", "phase": "execute", "agent": next_agent, "task_dir": task_dir})
            else:
                # All pending executors already completed
                status["phase"] = "document"
                _save_workflow_status(task_dir, status)
                phase = "document"

    # --- DOCUMENT: check if tokubetsu-jonin already done, advance ---
    if (status.get("assigned_agent") == "tokubetsu-jonin" and
            os.path.exists(os.path.join(task_dir, "result.md"))):
        status["phase"] = "synthesize"
        status["history"].append({"phase": "document", "agent": "tokubetsu-jonin"})
        _save_workflow_status(task_dir, status)
        phase = "synthesize"

    # --- DOCUMENT: dispatch tokubetsu-jonin (only if not already done) ---
    if phase == "document":
        agent = "tokubetsu-jonin"
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: tokubetsu-jonin\npriority: medium\nPhase: Document\n\n## TASK\n\nWrite comprehensive documentation for the completed work.\n")
        status["assigned_agent"] = agent
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "document", "agent": agent, "task_dir": task_dir})

    # --- SYNTHESIZE: aggregate all outputs ---
    if phase == "synthesize":
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md")) or ""
        findings = _read_file_safe(os.path.join(task_dir, "findings.md")) or ""
        plan = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
        research = _read_file_safe(os.path.join(task_dir, "research_results.json")) or ""
        final_docs = _read_file_safe(os.path.join(task_dir, "final_docs.md")) or ""

        report = f"# Final Report\n\n## Task\n{prompt}\n\n"
        if findings:
            report += f"## Exploration Findings\n{findings}\n\n"
        if plan:
            report += f"## Implementation Plan\n{plan}\n\n"
        if research:
            report += f"## Research\n{research}\n\n"
        if final_docs:
            report += f"## Documentation\n{final_docs}\n\n"

        # Include executor results from status (fallback when result files aren't available)
        executed = status.get("executed", {})
        if executed:
            report += "## Executor Results\n\n"
            for agent_name, exec_info in executed.items():
                task_desc = ""
                result = ""
                if isinstance(exec_info, dict):
                    task_desc = exec_info.get("task", "")
                    result = exec_info.get("result", "")
                elif isinstance(exec_info, str):
                    result = exec_info
                if task_desc:
                    report += f"- **{agent_name}**: {task_desc}\n\n"
                report += f"Result: {result}\n\n"

        result_path = os.path.join(task_dir, "final_report.md")
        with open(result_path, "w", encoding="utf-8") as f:
            f.write(report)

        status["phase"] = "done"
        status["history"].append({"phase": "synthesize", "agent": "sannin"})
        _save_workflow_status(task_dir, status)
        return json.dumps({
            "status": "completed",
            "phase": "done",
            "final_report_path": result_path,
        })

    # --- FALLBACK: error ---
    return json.dumps({
        "status": "error",
        "message": f"Unknown or stuck workflow phase: {phase}",
        "phase": phase,
    })

def run_web_search(query, num_results=5, search_depth="standard"):
    """Enterprise-grade web search with multi-query decomposition and source ranking."""
    import json
    import os
    import urllib.request
    import urllib.error
    import urllib.parse
    import time
    import re
    import sys

    if not query or not query.strip():
        return json.dumps({"status": "error", "message": "Query is required."})

    # Setup directories and cache files
    konoha_dir = KONOHA_DIR
    searxng_dir = os.path.join(konoha_dir, "searxng")
    os.makedirs(searxng_dir, exist_ok=True)

    INSTANCES_CACHE_PATH = os.path.join(searxng_dir, "instances_cache.json")
    BEST_INSTANCE_PATH = os.path.join(searxng_dir, "best_instance.json")
    SEARCH_LOG_PATH = os.path.join(searxng_dir, "search.log")

    def log_search_activity(source, q, count):
        try:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(SEARCH_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(f"[{timestamp}] SOURCE: {source} | QUERY: {q} | COUNT: {count}\n")
        except Exception:
            pass

    def get_candidate_instances():
        # Check cache (24h TTL)
        if os.path.exists(INSTANCES_CACHE_PATH):
            try:
                mtime = os.path.getmtime(INSTANCES_CACHE_PATH)
                if time.time() - mtime < 24 * 3600:
                    with open(INSTANCES_CACHE_PATH, "r", encoding="utf-8") as f:
                        return json.load(f)
            except Exception:
                pass

        sys.stderr.write("[mcp konoha] Refreshing SearXNG public instances list...\n")
        sys.stderr.flush()
        try:
            req = urllib.request.Request("https://searx.space/data/instances.json", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                instances = data.get("instances", {})
                candidates = []
                for name, val in instances.items():
                    if not name.startswith("https://"):
                        continue
                    
                    uptime = val.get("uptime", {}).get("uptimeDay", 0.0)
                    if uptime <= 95.0:
                        continue
                    
                    timing = val.get("timing", {})
                    latency = 9999.0
                    has_timing = False
                    if "search" in timing and "all" in timing["search"]:
                        latency = timing["search"]["all"].get("median", timing["search"]["all"].get("mean", 9999.0))
                        has_timing = True
                    elif "initial" in timing and "all" in timing["initial"]:
                        latency = timing["initial"]["all"].get("value", 9999.0)
                        has_timing = True
                    
                    if has_timing:
                        candidates.append({
                            "url": name,
                            "uptime": uptime,
                            "latency": latency
                        })
                
                # Sort: uptime desc, latency asc
                candidates.sort(key=lambda x: (-x["uptime"], x["latency"]))
                
                with open(INSTANCES_CACHE_PATH, "w", encoding="utf-8") as f:
                    json.dump(candidates, f)
                return candidates
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Failed to fetch instances.json: {str(e)}\n")
            sys.stderr.flush()
            if os.path.exists(INSTANCES_CACHE_PATH):
                try:
                    with open(INSTANCES_CACHE_PATH, "r", encoding="utf-8") as f:
                        return json.load(f)
                except Exception:
                    pass
            return []

    def resolve_best_instance(candidates):
        # Check best instance cache (1h TTL)
        if os.path.exists(BEST_INSTANCE_PATH):
            try:
                mtime = os.path.getmtime(BEST_INSTANCE_PATH)
                if time.time() - mtime < 3600:
                    with open(BEST_INSTANCE_PATH, "r", encoding="utf-8") as f:
                        cached = json.load(f)
                        if cached.get("url"):
                            return cached["url"]
            except Exception:
                pass

        sys.stderr.write("[mcp konoha] Resolving best public SearXNG instance...\n")
        sys.stderr.flush()
        
        test_candidates = candidates[:15]
        if not test_candidates:
            return None

        best_url = None
        for c in test_candidates[:5]:
            url = c["url"].rstrip("/") + "/"
            test_url = f"{url}search?q=test&format=json"
            try:
                req = urllib.request.Request(test_url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                })
                with urllib.request.urlopen(req, timeout=3) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    if "results" in res_data:
                        best_url = url
                        break
            except Exception:
                continue

        if best_url:
            try:
                with open(BEST_INSTANCE_PATH, "w", encoding="utf-8") as f:
                    json.dump({"url": best_url, "resolved_at": time.time()}, f)
            except Exception:
                pass
            return best_url
        
        for c in test_candidates[5:15]:
            url = c["url"]
            test_url = f"{url}search?q=test&format=json"
            try:
                req = urllib.request.Request(test_url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                })
                with urllib.request.urlopen(req, timeout=3) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    if "results" in res_data:
                        best_url = url
                        break
            except Exception:
                continue

        if best_url:
            try:
                with open(BEST_INSTANCE_PATH, "w", encoding="utf-8") as f:
                    json.dump({"url": best_url, "resolved_at": time.time()}, f)
            except Exception:
                pass
            return best_url

        return None

    def query_searxng(instance_url, q, num):
        base = instance_url.rstrip("/") + "/"
        search_url = f"{base}search?q={urllib.parse.quote(q)}&format=json"
        try:
            req = urllib.request.Request(search_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = []
                for item in data.get("results", [])[:num]:
                    title = item.get("title", "")
                    link = item.get("url", "")
                    content = item.get("content", item.get("snippet", ""))
                    if link and title:
                        results.append({
                            "title": title,
                            "url": link,
                            "snippet": content,
                            "source": f"SearXNG ({urllib.parse.urlparse(instance_url).netloc})"
                        })
                return results
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] SearXNG query to {instance_url} failed: {str(e)}\n")
            sys.stderr.flush()
            try:
                if os.path.exists(BEST_INSTANCE_PATH):
                    os.remove(BEST_INSTANCE_PATH)
            except Exception:
                pass
            return None

    def query_duckduckgo(q, num):
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(q)}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
            })
            with urllib.request.urlopen(req, timeout=6) as resp:
                html = resp.read().decode("utf-8")
                blocks = re.findall(r'<div class="result[^"]*"[^>]*>(.*?)</div>\s*</div>\s*</div>', html, re.DOTALL)
                if not blocks:
                    blocks = re.findall(r'<div class="[^"]*web-result[^"]*"[^>]*>(.*?)</div>\s*</div>', html, re.DOTALL)
                
                results = []
                for b in blocks[:num]:
                    title_m = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', b, re.DOTALL)
                    snippet_m = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', b, re.DOTALL)
                    if title_m:
                        raw_url = title_m.group(1)
                        title = re.sub(r'<[^>]+>', '', title_m.group(2)).strip()
                        snippet = ""
                        if snippet_m:
                            snippet = re.sub(r'<[^>]+>', '', snippet_m.group(1)).strip()
                        
                        parsed = urllib.parse.urlparse(raw_url)
                        qs = urllib.parse.parse_qs(parsed.query)
                        url_val = qs.get("uddg", [raw_url])[0]
                        results.append({
                            "title": title,
                            "url": url_val,
                            "snippet": snippet,
                            "source": "DuckDuckGo"
                        })
                return results
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] DuckDuckGo query failed: {str(e)}\n")
            sys.stderr.flush()
            return None

    def query_startpage(q, num):
        url = f"https://www.startpage.com/sp/search?query={urllib.parse.quote(q)}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
            })
            with urllib.request.urlopen(req, timeout=6) as resp:
                html = resp.read().decode("utf-8")
                urls = re.findall(r'<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"', html)
                titles = re.findall(r'<h2[^>]*class="[^"]*wgl-title[^"]*"[^>]*>(.*?)</h2>', html, re.DOTALL)
                snippets = re.findall(r'<p[^>]*class="[^"]*description[^"]*"[^>]*>(.*?)</p>', html, re.DOTALL)
                
                results = []
                for idx in range(min(len(urls), len(titles), len(snippets)))[:num]:
                    url_val = urls[idx]
                    title = re.sub(r'<[^>]+>', '', titles[idx]).strip()
                    snippet = re.sub(r'<[^>]+>', '', snippets[idx]).strip()
                    results.append({
                        "title": title,
                        "url": url_val,
                        "snippet": snippet,
                        "source": "Startpage"
                    })
                return results
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Startpage query failed: {str(e)}\n")
            sys.stderr.flush()
            return None

    def query_wikipedia(q, num):
        try:
            search_terms = q.split()
            for i in range(min(3, len(search_terms))):
                term = " ".join(search_terms[:len(search_terms) - i])
                if len(term.strip()) < 3:
                    continue
                encoded_term = urllib.parse.quote(term)
                url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={encoded_term}&limit={num}&format=json"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    wiki_data = json.loads(resp.read().decode("utf-8"))
                    if len(wiki_data) >= 4 and wiki_data[1]:
                        titles = wiki_data[1]
                        descriptions = wiki_data[2]
                        urls = wiki_data[3]
                        results = []
                        for idx in range(len(titles)):
                            results.append({
                                "title": titles[idx],
                                "url": urls[idx],
                                "snippet": descriptions[idx] or f"Wikipedia page for {titles[idx]}.",
                                "source": "Wikipedia"
                            })
                        return results
            return []
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Wikipedia fallback query failed: {str(e)}\n")
            sys.stderr.flush()
            return []

    # Support search_depth: "standard" or "deep"
    queries = [query.strip()]
    if search_depth == "deep":
        base = query.strip()
        queries = [
            base,
            f"{base} best practices 2024 2025 2026",
            f"{base} comparison alternatives",
        ]

    all_results = []
    seen_urls = set()

    for q in queries:
        current_results = []
        
        # Helper to query with smart query simplification
        def simplify_and_search(search_func, base_q, max_results):
            terms = base_q.split()
            for i in range(min(3, len(terms))):
                simp_q = " ".join(terms[:len(terms) - i])
                if len(simp_q.strip()) < 3:
                    continue
                res = search_func(simp_q, max_results)
                if res:
                    return res, simp_q
            return [], base_q

        # 1. Primary: Public SearXNG
        candidates = get_candidate_instances()
        best_instance = resolve_best_instance(candidates)
        if best_instance:
            res, resolved_q = simplify_and_search(lambda query, limit: query_searxng(best_instance, query, limit), q, num_results)
            if res:
                current_results = res
                log_search_activity(f"SearXNG ({urllib.parse.urlparse(best_instance).netloc})", resolved_q, len(res))

        # 2. Secondary: DuckDuckGo HTML
        if not current_results:
            res, resolved_q = simplify_and_search(lambda query, limit: query_duckduckgo(query, limit), q, num_results)
            if res:
                current_results = res
                log_search_activity("DuckDuckGo HTML", resolved_q, len(res))

        # 3. Tertiary: Startpage Scraper
        if not current_results:
            res = query_startpage(q, num_results)
            if res:
                current_results = res
                log_search_activity("Startpage", q, len(res))

        # 4. Final Fallback: Wikipedia OpenSearch
        if not current_results:
            res = query_wikipedia(q, num_results)
            if res:
                current_results = res
                log_search_activity("Wikipedia OpenSearch", q, len(res))

        for r in current_results:
            r_url = r["url"]
            if r_url not in seen_urls:
                seen_urls.add(r_url)
                all_results.append(r)

    if not all_results:
        return json.dumps({
            "status": "success",
            "query": query,
            "search_depth": search_depth,
            "results_count": 0,
            "results": [],
            "note": "No results found across SearXNG, DuckDuckGo, Startpage, or Wikipedia fallbacks."
        })

    # Rank results: prioritize authoritative domains
    authority_domains = [
        "github.com", "stackoverflow.com", "docs.google.com", "developer.mozilla.org",
        "learn.microsoft.com", "docs.python.org", "nodejs.org", "npmjs.com",
        "vercel.com", "nextjs.org", "svelte.dev", "tailwindcss.com",
        "kubernetes.io", "terraform.io", "aws.amazon.com", "cloud.google.com",
    ]

    def rank_score(r):
        score = 0
        src = r.get("source", "").lower()
        url = r.get("url", "").lower()
        for ad in authority_domains:
            if ad in url or ad in src:
                score += 10
                break
        if r.get("snippet"):
            score += min(len(r["snippet"]) // 50, 5)
        return score

    all_results.sort(key=rank_score, reverse=True)

    formatted = []
    # Cap total results at num_results regardless of search_depth (deep aggregates more but limits display)
    for i, r in enumerate(all_results[:num_results], 1):
        formatted.append({
            "citation_id": i,
            "title": r["title"],
            "url": r["url"],
            "snippet": r["snippet"],
            "source": r["source"],
        })

    result = json.dumps({
        "status": "success",
        "query": query,
        "search_depth": search_depth,
        "results_count": len(formatted),
        "results": formatted,
    })
    log_tool_call("web_search", f"query={query}, depth={search_depth}", result[:500], agent_name="web_search")
    return result


def run_mcp_agent(agent_name, task_dir=None):
    import json
    import os
    import urllib.request
    import urllib.error
    
    task_dir = get_resolved_task_dir(task_dir)
    delegate_path = os.path.join(task_dir, "delegate.md")
    
    if not os.path.exists(delegate_path):
        return json.dumps({"status": "error", "message": f"delegate.md not found in task directory: {task_dir}"})
        
    try:
        with open(delegate_path, "r", encoding="utf-8") as f:
            delegate_content = f.read()
    except Exception as e:
        return json.dumps({"status": "error", "message": f"Failed to read delegate.md: {str(e)}"})
        
    instructions = delegate_content
    if instructions.startswith("---"):
        parts = instructions.split("---", 2)
        if len(parts) >= 3:
            instructions = parts[2].strip()
            
    db_agent_name = agent_name
    # Normalize internal underscores to hyphens (e.g. tokubetsu_jonin -> tokubetsu-jonin)
    suffix = db_agent_name.replace("_", "-")
    db_agent_name = suffix

    # Try both prefixed and bare DB names (DB may have mcp_ prefix or bare name)
    title = db_agent_name
    purpose = ""
    constraints = ""
    persona_instructions = ""
    model_tier = "Gemini 3.1 Pro (High)"
    skills_list = []
    
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Try bare name first (new convention); fall back to mcp_ prefixed name (legacy).
        cursor.execute("""
            SELECT name, title, purpose, skills, constraints_text, instructions, model_tier
            FROM agents WHERE name = ?
        """, (db_agent_name,))
        row = cursor.fetchone()
        if not row:
            prefixed = f"mcp_{db_agent_name}"
            cursor.execute("""
                SELECT name, title, purpose, skills, constraints_text, instructions, model_tier
                FROM agents WHERE name = ?
            """, (prefixed,))
            row = cursor.fetchone()
        conn.close()
        if row:
            title = row["title"] or title
            purpose = row["purpose"] or purpose
            constraints = row["constraints_text"] or constraints
            persona_instructions = row["instructions"] or persona_instructions
            model_tier = row["model_tier"] or model_tier
            if row["skills"]:
                skills_list = json.loads(row["skills"])
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] Error reading agent row from DB: {str(e)}\n")
        sys.stderr.flush()
        
    skills_content = []
    if not skills_list and instructions:
        try:
            _conn_autoload = sqlite3.connect(DB_PATH)
            auto = _autoload_skills_from_prompt(instructions, _conn_autoload)
            _conn_autoload.close()
            if auto:
                skills_list = auto
                sys.stderr.write(
                    f"[mcp {agent_name}] auto-loaded skills from prompt: {auto}\n"
                )
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[mcp {agent_name}] prompt-skill autoload failed: {e}\n")
            sys.stderr.flush()

    if skills_list:
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            for skill_name in skills_list:
                resolved = _fuzzy_resolve_skill(skill_name, conn)
                effective_name = resolved or skill_name
                if resolved and resolved != skill_name:
                    sys.stderr.write(
                        f"[mcp {agent_name}] fuzzy-resolved skill {skill_name!r} -> {resolved!r}\n"
                    )
                    sys.stderr.flush()
                row = conn.execute("SELECT content, type FROM skills WHERE name = ?", (effective_name,)).fetchone()
                if row and row["content"]:
                    label = "Skill" if row["type"] == "skill" else "Reference"
                    skills_content.append(f"### {label}: {effective_name}\n\n{row['content']}")
            conn.close()
        except Exception as e:
            sys.stderr.write(f"[mcp {agent_name}] Error loading skill definitions: {str(e)}\n")
            sys.stderr.flush()

    search_findings = ""
    if "chunin" in db_agent_name:
        try:
            # Automatically run deep research query extracted from task instructions
            query_to_run = ""
            lines = [l.strip() for l in instructions.split('\n') if l.strip() and not l.strip().startswith('---')]
            for line in lines:
                clean_line = line.lstrip('#').lstrip('*').lstrip('-').strip()
                if clean_line:
                    query_to_run = clean_line
                    break
            if not query_to_run:
                query_to_run = "latest technology updates"
            
            sys.stderr.write(f"[mcp chunin] Automatically running deep research web_search for: {query_to_run}\n")
            sys.stderr.flush()
            
            search_res_json = run_web_search(query_to_run, num_results=5, search_depth="deep")
            search_data = json.loads(search_res_json)
            if search_data.get("status") == "success" and search_data.get("results"):
                search_findings = "### Deep Research Web Search Findings\n\n"
                for res in search_data["results"]:
                    search_findings += f"**[{res['citation_id']}] {res['title']}**\n"
                    search_findings += f"Source: {res['source']} | URL: {res['url']}\n"
                    search_findings += f"Snippet: {res['snippet']}\n\n"
        except Exception as e:
            sys.stderr.write(f"[mcp chunin] Error during automatic web search: {str(e)}\n")
            sys.stderr.flush()
            
    system_prompt = (
        f"You are @{db_agent_name} ({title}).\n"
        f"Purpose: {purpose}\n\n"
        f"Instructions:\n{persona_instructions}\n\n"
        f"Constraints:\n{constraints}\n\n"
    )
    system_prompt += build_subagent_mcp_block(client=ACTIVE_CLIENT)
    if search_findings:
        system_prompt += search_findings + "\n"
    if skills_content:
        system_prompt += "Available Skills and Reference guides:\n" + "\n\n".join(skills_content) + "\n\n"
        
    system_prompt += (
        "You can make file creations/edits directly by outputting conflict diff markers in your response.\n"
        "To write a new file or edit an existing file, include this exact block in your response:\n"
        "FILE: path/to/file\n"
        "<<<<<<< original\n"
        "[exact original code snippet to replace, leave empty for new files]\n"
        "=======\n"
        "[exact replacement code block]\n"
        ">>>>>>>\n\n"
        "Make sure to output the complete conflict diff block. You can output multiple diff blocks for multiple edits."
    )
    
    instruction = (
        f"{system_prompt}\n\n"
        f"## TASK INSTRUCTIONS\n\n{instructions}\n\n"
        f"You must now act as {agent_name} and execute the task above. Use the available tools to explore the codebase or make file edits.\n\n"
        f"## Execution Protocol\n\n"
        f"1. Execute the task as described in TASK INSTRUCTIONS above.\n"
        f"2. When you have finished, you MUST write your final response and findings to: `{os.path.join(task_dir, 'result.md')}`.\n"
        f"3. After creating `result.md`, you MUST call the `mcp__konoha__sannin` tool passing `task_dir` so it can return the result to complete the workflow."
    )
    
    res = json.dumps({
        "status": "ready",
        "phase": "execution",
        "agent": agent_name,
        "task_dir": task_dir,
        "instructions": instruction
    })
    
    log_tool_call(agent_name, f"task_dir={task_dir}", res, agent_name=agent_name)
    return res


def handle_request(req):
    method = req.get("method")
    rid = req.get("id")

    # Notifications (no id) — acknowledge silently
    if rid is None and method not in ("initialize",):
        return None

    if method == "initialize":
        global WORKSPACE_ROOT, ACTIVE_CLIENT
        params = req.get("params", {})
        
        # Detect active client from clientInfo
        client_info = params.get("clientInfo", {})
        client_name = (client_info.get("name") or "").lower()
        if "cursor" in client_name:
            ACTIVE_CLIENT = "cursor"
        elif "claude" in client_name:
            ACTIVE_CLIENT = "claudecode"
        elif "opencode" in client_name:
            ACTIVE_CLIENT = "opencode"
        elif "commandcode" in client_name:
            ACTIVE_CLIENT = "commandcode"
        elif "antigravity-cli" in client_name or "agy" in client_name:
            ACTIVE_CLIENT = "agy"
        elif "antigravity" in client_name or "ide" in client_name:
            conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
            if conv_id:
                if os.environ.get("ANTIGRAVITY_LS_VERSION", "").startswith("cli"):
                    ACTIVE_CLIENT = "agy"
                elif os.path.isdir(os.path.join(ANTIGRAVITY_CLI_BRAIN, conv_id)):
                    ACTIVE_CLIENT = "agy"
                else:
                    ACTIVE_CLIENT = "antigravity"
            else:
                ACTIVE_CLIENT = "antigravity"
        else:
            # Fallback to file detection
            ACTIVE_CLIENT = detect_active_client()
        
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
            sys.stderr.write(f"[mcp konoha] Initialized with workspace root: {WORKSPACE_ROOT}\n")
            sys.stderr.flush()
        else:
            sys.stderr.write(f"[mcp konoha] Initialized with no workspace root; using cwd: {os.getcwd()}\n")
            sys.stderr.flush()

        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "konoha", "version": "2.0.0"}
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
                        "name": "build_with_image_design",
                        "description": "Compatibility alias for image/mockup-driven builds. Analyzes a source directory and preserves source fidelity without applying the default text-build theme template.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Name of the project to build."},
                                "source_dir": {"type": "string", "description": "Relative or absolute path to the image/design source directory."},
                                "framework": {"type": "string", "description": "The target framework (e.g. 'nextjs' or 'svelte')."},
                                "agent": {"type": "string", "description": "Name of the calling agent."}
                            },
                            "required": ["name", "source_dir", "framework"]
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
                    },
                    {
                        "name": "sannin",
                        "description": "Sannin router agent. Resolves the task prompt, chooses the best subagent to run, and triggers it.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "prompt": {
                                    "type": "string",
                                    "description": "The task prompt. If not provided, reads from prompt.md in task_dir."
                                },
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "kage",
                        "description": "Village Leader & Architect subagent. Focuses on architecture decisions, security audits, and critical problem solving.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "jonin",
                        "description": "UI & Frontend Specialist subagent. Focuses on UI components, SvelteKit, Next.js, and visual excellence.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "anbu",
                        "description": "Backend & DevOps Specialist subagent. Focuses on backend logic, bug fixes, database schema, CI/CD, and infra.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "chunin",
                        "description": "Intel & Research subagent. Focuses on web research, documentation lookup, compliance, and evidence synthesis.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "tokubetsu_jonin",
                        "description": "Technical Writer & Scribe subagent. Focuses on README, API specs, diagrams, specs, and documentation.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "genin",
                        "description": "Codebase Scout subagent. Focuses on read-only codebase navigation, symbol tracing, and dependency mapping.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "task_dir": {
                                    "type": "string",
                                    "description": "Task workspace directory."
                                }
                            }
                        }
                    },
                    {
                        "name": "web_search",
                        "description": "Enterprise-grade web search with multi-query decomposition, authoritative domain ranking, and citations.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "The search query."
                                },
                                "num_results": {
                                    "type": "integer",
                                    "description": "Number of results to return (1–50, default: 5).",
                                    "default": 5
                                },
                                "search_depth": {
                                    "type": "string",
                                    "description": "Search depth: 'standard' (single query) or 'deep' (multi-query decomposition).",
                                    "enum": ["standard", "deep"],
                                    "default": "standard"
                                }
                            },
                            "required": ["query"]
                        }
                    },
                    {
                        "name": "get_resolved_task_dir",
                        "description": "Resolve the absolute scratch directory path for Konoha task execution. Returns the most recently modified task directory under ~/.konoha/tmp/<client>/<session>/scratch/tasks/, or creates a default one if none exist. Never returns paths inside the project workspace to prevent accidental commits.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "migrate_skills",
                        "description": "Re-index all skills from ~/.agents/skills/ (or a custom skills_dir) into the SQLite FTS5 database. Use this to add new skills to the search index or refresh stale indexes. Optionally pass a list of specific skill names to migrate only those. Returns a summary of what was migrated.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "force": {
                                    "type": "boolean",
                                    "description": "If true, purge existing skills from the database before migrating.",
                                    "default": None
                                },
                                "skills": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Specific skill names to migrate (default: auto-detect all from skills_dir)"
                                },
                                "skills_dir": {
                                    "type": "string",
                                    "description": "Path to skills directory (default: ~/.agents/skills/)"
                                }
                            }
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

        if tool_name == "web_search":
            query = args.get("query")
            num_results = min(max(int(args.get("num_results", 5)), 1), 50)
            search_depth = args.get("search_depth", "standard")
            if search_depth not in ("standard", "deep"):
                search_depth = "standard"
            result_text = run_web_search(query, num_results=num_results, search_depth=search_depth)
        elif tool_name == "find_skill":
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
        elif tool_name in ("build_with_image_design", "build_from_source"):
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
        elif tool_name == "get_resolved_task_dir":
            result_text = json.dumps({"status": "ok", "task_dir": get_resolved_task_dir()})
        elif tool_name == "sannin":
            prompt = args.get("prompt")
            task_dir = args.get("task_dir")
            result_text = run_sannin(prompt=prompt, task_dir=task_dir)
        elif tool_name in ("kage", "jonin", "anbu", "chunin", "tokubetsu_jonin", "genin"):
            task_dir = args.get("task_dir")
            result_text = run_mcp_agent(agent_name=tool_name, task_dir=task_dir)
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
        # Unknown method — per JSON-RPC 2.0 spec (section 2.2.3.13)
        if rid is not None:
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": f"Method not found: {method}"}
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
    if len(sys.argv) > 2 and sys.argv[1] == "--tool":
        tool_name = sys.argv[2]
        raw_args = sys.argv[3] if len(sys.argv) > 3 else "{}"
        try:
            args = json.loads(raw_args)
        except Exception:
            args = {}
        fake_req = {
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": args},
            "id": 1
        }
        resp = handle_request(fake_req)
        if resp and "result" in resp and "content" in resp["result"]:
            print(resp["result"]["content"][0]["text"])
        else:
            print(json.dumps({"error": "Failed to execute tool"}))
        sys.exit(0)
    main()
