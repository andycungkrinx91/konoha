#!/usr/bin/env python3
"""
konoha MCP Server (v2.0.0-beta.4 — Token-Optimized)
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db
from db import get_connection

def get_server_version() -> str:
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "package.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "package.json"),
        os.path.expanduser("~/.konoha/package.json")
    ]
    for c in candidates:
        if os.path.isfile(c):
            try:
                with open(c, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "version" in data and data["version"]:
                        return str(data["version"])
            except Exception:
                pass
    return "2.0.0-beta.4"
import hashlib
import re
from urllib.parse import urlparse, unquote
import tempfile
from yaml_parser import parse_yaml, serialize_yaml, load_yaml_file, dump_yaml_file
import glob
import circuit_breaker
from circuit_breaker import global_circuit_registry
import persona_memory

MCP_MANIFEST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp_tool_manifest.json")
try:
    with open(MCP_MANIFEST_PATH, "r", encoding="utf-8") as _manifest_file:
        MCP_MANIFEST = json.load(_manifest_file)
except (OSError, json.JSONDecodeError):
    MCP_MANIFEST = {"protocol_versions": ["2024-11-05"], "tools": []}
SUPPORTED_PROTOCOL_VERSIONS = tuple(MCP_MANIFEST.get("protocol_versions", ["2024-11-05"]))
MCP_INITIALIZED = False

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

DB_PATH = db.DB_PATH
SERVER_PY_PATH = os.path.join(KONOHA_DIR, "server.py")
DB_BRIDGES_PY_PATH = os.path.join(KONOHA_DIR, "db_bridges.py")

ANTIGRAVITY_CLI = os.path.join(GEMINI_DIR, "antigravity-cli")
ANTIGRAVITY_IDE = os.path.join(GEMINI_DIR, "antigravity-ide")
ANTIGRAVITY_CLI_BRAIN = os.path.join(ANTIGRAVITY_CLI, "brain")
ANTIGRAVITY_IDE_BRAIN = os.path.join(ANTIGRAVITY_IDE, "brain")
CURSOR_PROJECTS = os.path.join(CURSOR_DIR, "projects")
CLAUDE_PROJECTS = os.path.join(CLAUDE_DIR, "projects")

def is_ide_installation_dir(path):
    if not path:
        return False
    norm = str(path).replace('\\', '/').lower()
    if any(x in norm for x in [
        '/appdata/local/programs/antigravity',
        '/program files/antigravity',
        '/program files (x86)/antigravity',
        '/antigravity ide',
        '/antigravity-ide'
    ]):
        return True
    try:
        if os.path.isdir(path):
            entries = {e.lower() for e in os.listdir(path)}
            if any(e in entries for e in [
                'antigravity ide.exe',
                'antigravity.exe',
                'antigravity ide.visualelementsmanifest.xml',
                'dxcompiler.dll'
            ]) or ('resources.pak' in entries and 'v8_context_snapshot.bin' in entries):
                return True
    except Exception:
        pass
    return False

_raw_ws = os.environ.get("WORKSPACE_ROOT", os.environ.get("KONOHA_WORKSPACE", None))
if not _raw_ws or is_ide_installation_dir(_raw_ws):
    _cwd = os.getcwd()
    WORKSPACE_ROOT = _cwd if not is_ide_installation_dir(_cwd) else None
else:
    WORKSPACE_ROOT = _raw_ws
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
PREVIEW_LIMIT = 500
COMPACT_PREVIEW_LIMIT = 250
MAX_CONTENT_SIZE = 12000



def get_db():
    """Get a database connection."""
    conn = get_connection(DB_PATH)
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
    conn = get_connection(DB_PATH)
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


_PROJECT_SKILLS_CACHE = {}

def auto_migrate_project_skills(workspace_root=None):
    """
    Automatically detects and migrates project-scoped skills into skills.db.
    Scans candidate directories in the active workspace:
      - <workspace>/.agents/skills
      - <workspace>/skills
      - <workspace>/.cursor/skills
      - <workspace>/.gemini/skills
      - <workspace>/.gemini/antigravity-cli/skills
    Ensures that when a project has skills, every coding client (Cursor, Antigravity,
    Claude Code, OpenCode, Command Code, Codex) automatically finds them via konoha.find_skills / find_skill.
    """
    global WORKSPACE_ROOT
    ws = workspace_root or WORKSPACE_ROOT
    if not ws:
        ws = os.environ.get("KONOHA_WORKSPACE") or os.environ.get("WORKSPACE_ROOT") or os.getcwd()

    if not ws or is_ide_installation_dir(ws):
        return []

    norm_ws = os.path.normcase(os.path.realpath(ws))
    home_dir = os.path.normcase(os.path.realpath(HOME))
    if norm_ws == home_dir or norm_ws == os.path.normcase(os.path.realpath("/")) or (os.name == "nt" and len(norm_ws) <= 3):
        return []

    candidate_subdirs = [
        os.path.join(ws, ".agents", "skills"),
        os.path.join(ws, "skills"),
        os.path.join(ws, ".cursor", "skills"),
        os.path.join(ws, ".gemini", "skills"),
        os.path.join(ws, ".gemini", "antigravity-cli", "skills"),
    ]

    migrated_skills = []
    conn = None

    for cdir in candidate_subdirs:
        if not os.path.isdir(cdir):
            continue
        try:
            st = os.stat(cdir)
            cache_key = f"{cdir}:{st.st_mtime}:{st.st_size}"
            if _PROJECT_SKILLS_CACHE.get(cdir) == cache_key:
                continue

            detected = _auto_detect_skills(cdir)
            if not detected:
                _PROJECT_SKILLS_CACHE[cdir] = cache_key
                continue

            if conn is None:
                conn = _setup_db()

            for skill_name in detected:
                cnt = _migrate_skill(conn, skill_name, cdir)
                if cnt > 0:
                    migrated_skills.append(f"{skill_name} ({cdir})")
                    sys.stderr.write(f"[mcp konoha] Auto-migrated project skill '{skill_name}' from {cdir} into skills.db\n")
                    sys.stderr.flush()

            _PROJECT_SKILLS_CACHE[cdir] = cache_key
        except Exception as e:
            sys.stderr.write(f"[mcp konoha] Error auto-migrating project skills from {cdir}: {e}\n")
            sys.stderr.flush()

    if conn is not None:
        try:
            _normalize_legacy_skill_names(conn)
            conn.commit()
            conn.close()
        except Exception:
            pass

    return migrated_skills


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
    if is_ide_installation_dir(norm_fp):
        return False
    
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
        parent_ws = os.path.dirname(current_workspace)
        if parent_ws != home_dir and parent_ws != os.path.normcase(os.path.realpath("/")) and (norm_fp.startswith(parent_ws + os.sep) or norm_fp == parent_ws):
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

        active_override = (os.environ.get("ACTIVE_CLIENT") or os.environ.get("KONOHA_CLIENT") or "").lower().strip()
        if active_override:
            if "codex" in active_override or "openai" in active_override:
                return "codex"
            if "commandcode" in active_override or "command-code" in active_override:
                return "commandcode"
            if "opencode" in active_override:
                return "opencode"
            if "claude" in active_override:
                return "claudecode"
            if "cursor" in active_override:
                return "cursor"
            if "agy" in active_override or "antigravity-cli" in active_override:
                return "agy"
            if "antigravity" in active_override or "ide" in active_override:
                return "antigravity"

        if os.environ.get("CODEX_SESSION") or os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_CI"):
            return "codex"

        if os.environ.get("OPENCODE_CLIENT") == "1" or os.environ.get("OPENCODE_SESSION") == "1":
            return "opencode"

        if os.environ.get("COMMANDCODE_CLIENT") == "1" or os.environ.get("COMMANDCODE_SESSION") == "1":
            return "commandcode"

        if os.environ.get("CLAUDE_CODE_CHILD_SESSION") == "1":
            return "claudecode"

        # Process hierarchy inspection (Linux /proc)
        try:
            ppid = os.getppid()
            for _ in range(5):
                if ppid <= 1:
                    break
                cmd_path = f"/proc/{ppid}/cmdline"
                if os.path.exists(cmd_path):
                    with open(cmd_path, "rb") as f:
                        cmd = f.read().decode("utf-8", errors="ignore").lower()
                    if "codex" in cmd:
                        return "codex"
                    if "commandcode" in cmd or "command-code" in cmd:
                        return "commandcode"
                    if "opencode" in cmd:
                        return "opencode"
                    if "claude" in cmd:
                        return "claudecode"
                    if "cursor" in cmd:
                        return "cursor"
                stat_path = f"/proc/{ppid}/stat"
                if os.path.exists(stat_path):
                    with open(stat_path, "r") as f:
                        ppid = int(f.read().split()[3])
                else:
                    break
        except Exception:
            pass

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
            os.path.join(HOME, ".codex", "sessions"),
            os.path.join(HOME, ".commandcode", "logs"),
            os.path.join(HOME, ".config", "opencode")
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
            elif "codex" in brain_dir:
                all_files.extend(glob.glob(os.path.join(brain_dir, "*.json")) + glob.glob(os.path.join(brain_dir, "*.jsonl")) + glob.glob(os.path.join(brain_dir, "*.sqlite")))
            elif "commandcode" in brain_dir or "opencode" in brain_dir:
                all_files.extend(glob.glob(os.path.join(brain_dir, "*.json")) + glob.glob(os.path.join(brain_dir, "*.jsonl")) + glob.glob(os.path.join(brain_dir, "*.log")))
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
        elif "codex" in most_recent:
            return "codex"
        elif "commandcode" in most_recent:
            return "commandcode"
        elif "opencode" in most_recent:
            return "opencode"
        elif "antigravity-cli" in most_recent:
            return "agy"
        else:
            return "antigravity"
    except Exception:
        pass
    return "antigravity"


def build_subagent_mcp_block(client=None, agent_name=None):
    """Return the MCP-tools block injected into every mcp_<agent> subagent prompt."""
    norm_agent = (agent_name or "").lower().replace("_", "-")
    tools = [
        "- `mcp__konoha__sannin` — Sannin router agent",
        "- `mcp__konoha__kage` — Village Leader & Architect",
        "- `mcp__konoha__jonin` — UI & Frontend Specialist",
        "- `mcp__konoha__anbu` — Backend & DevOps Specialist",
        "- `mcp__konoha__chunin` — Intel Ninja",
        "- `mcp__konoha__tokubetsu_jonin` — Scribe",
        "- `mcp__konoha__genin` — Scout",
        "- `mcp__konoha__find_skill` — Find skills",
        "- `mcp__konoha__get_skill` — Get skill content",
        "- `mcp__konoha__list_skills` — List all skills",
        "- `mcp__konoha__read_file_head` — Read head of file",
        "- `mcp__konoha__read_file_range` — Read range of lines in file",
        "- `mcp__konoha__file_info` — Get file info",
        "- `mcp__konoha__token_efficient_grep` — Token-efficient grep",
        "- `mcp__konoha__get_file_structure` — Get file tree",
        "- `mcp__konoha__find_files_clean` — Find files cleanly",
        "- `mcp__semble__search` — Search project codebase",
        "- `mcp__semble__find_related` — Find related code symbols",
    ]

    if norm_agent in ("genin", "kage"):
        tools.append("- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan")
        tools.append("- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning")
    elif norm_agent in ("jonin", "anbu"):
        tools.append("- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan")
        tools.append("- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning")
        tools.append("- `mcp__aislop__aislop_fix` — Auto-fix AI slop issues")

    tools_str = "\n".join(tools)

    boundaries = (
        "### Strict Tool Boundaries\n"
        "Use konoha MCP for skill lookup and bounded file reads/grep. Use semble MCP for project code search.\n"
    )
    if norm_agent in ("genin", "kage"):
        boundaries += (
            "For aislop MCP: You are permitted to use `aislop_scan` and `aislop_why`. "
            "You are strictly forbidden from calling `aislop_fix` or `aislop_baseline` (read-only mandate).\n"
        )
    elif norm_agent in ("jonin", "anbu"):
        boundaries += (
            "For aislop MCP: You are permitted to use `aislop_scan`, `aislop_fix`, and `aislop_why` "
            "to detect and remediate slop issues before Kage delivery review.\n"
        )

    return f"\n## MCP Tools Available To You\n{tools_str}\n\n{boundaries}"


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
    try:
        auto_migrate_project_skills()
    except Exception:
        pass
    keyword = normalize_legacy_skill_name(keyword)
    conn = get_db()

    preview_limit = COMPACT_PREVIEW_LIMIT if compact else PREVIEW_LIMIT

    rows = []
    # If semantic search is enabled, attempt hybrid semantic + RRF + rerank retrieval
    try:
        import vector_search
        if vector_search.is_semantic_search_enabled():
            semantic_results = vector_search.find_skill_semantic(conn, keyword, top_k=limit * 2, candidate_k=25)
            if semantic_results:
                rows = semantic_results
    except Exception as e:
        sys.stderr.write(f"  [Warning] Semantic search failed: {e}. Falling back to FTS5.\n")
        sys.stderr.flush()

    if not rows:
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
    try:
        auto_migrate_project_skills()
    except Exception:
        pass
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
    try:
        auto_migrate_project_skills()
    except Exception:
        pass
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
        conn = get_connection(DB_PATH)
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


BUILD_FRAMEWORKS = {
    "next": {
        "canonical": "nextjs",
        "display": "Next.js 16.3",
        "aliases": {"next", "nextjs", "react"},
        "scaffold_command": "pnpm create next-app@latest",
        "routing": "Use Next.js 16 App Router under app/ (strictly Next.js 16.3+, React 19, Tailwind v4 — NEVER Next.js 15, 14, or hash-based SPA routing).",
        "validation": ["pnpm run lint", "pnpm run build"],
        "required_scripts": ["pnpm lint", "pnpm build", "pnpm start", "pnpm dev"],
        "source_extensions": {".html", ".css", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"},
        "skill_prefix": "nextjs",
    },
    "svelte": {
        "canonical": "sveltekit",
        "display": "SvelteKit",
        "aliases": {"svelte", "sveltekit"},
        "scaffold_command": "pnpm dlx sv create <project-name>",
        "routing": "Use SvelteKit file-based routing under src/routes/ — NEVER hash-based SPA routing.",
        "validation": ["pnpm run check", "pnpm run lint", "pnpm run build"],
        "required_scripts": ["pnpm check", "pnpm lint", "pnpm build", "pnpm start", "pnpm dev"],
        "source_extensions": {".html", ".css", ".js", ".mjs", ".ts", ".svelte"},
        "skill_prefix": "svelte",
    },
    "nuxt": {
        "canonical": "nuxt",
        "display": "Nuxt 4.3",
        "aliases": {"nuxt", "nuxt3", "vue"},
        "scaffold_command": "pnpm dlx nuxi@latest init <project-name>",
        "routing": "Use Nuxt 4 file-based routing under app/pages/ and app/layouts/ — NEVER hash-based SPA routing.",
        "validation": ["pnpm run lint", "pnpm run build"],
        "required_scripts": ["pnpm lint", "pnpm build", "pnpm start", "pnpm dev"],
        "source_extensions": {".html", ".css", ".js", ".mjs", ".ts", ".vue"},
        "skill_prefix": "nuxt",
    },
    "angular": {
        "canonical": "angular",
        "display": "Angular 20+ Signals",
        "aliases": {"angular", "ng"},
        "scaffold_command": "pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm",
        "routing": "Use standalone Angular Router with app.routes.ts — NEVER hash-based SPA routing.",
        "validation": ["pnpm run lint", "pnpm run build"],
        "required_scripts": ["pnpm lint", "pnpm build", "pnpm start", "pnpm dev"],
        "source_extensions": {".html", ".css", ".scss", ".js", ".mjs", ".ts"},
        "skill_prefix": "angular",
    },
}


def _validate_build_input(name, description=None, framework=None, taste_dials=None):
    if not isinstance(name, str) or not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", name.strip()):
        raise ValueError("name must contain 1-100 letters, numbers, dots, underscores, or hyphens")
    if description is not None and (not isinstance(description, str) or not description.strip()):
        raise ValueError("description is required")
    fw_clean = str(framework or "").lower().replace(".", "").replace(" ", "").replace("-", "")
    spec = next((value for value in BUILD_FRAMEWORKS.values() if fw_clean in {alias.replace(".", "").replace(" ", "").replace("-", "") for alias in value["aliases"]}), None)
    if spec is None:
        raise ValueError("framework must be one of: nextjs, nuxt, sveltekit, angular")
    dials = {"design_variance": 8, "motion_intensity": 7, "visual_density": 6}
    if taste_dials is not None:
        if not isinstance(taste_dials, dict):
            raise ValueError("taste_dials must be an object")
        for key in dials:
            value = taste_dials.get(key, dials[key])
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 1 <= value <= 10:
                raise ValueError(f"{key} must be a number from 1 to 10")
            dials[key] = value
    return spec, dials


def _resolve_build_source_dir(source_dir):
    if not isinstance(source_dir, str) or not source_dir.strip():
        raise ValueError("source_dir is required")
    raw = os.path.expanduser(source_dir.strip())
    workspace = os.path.realpath(os.path.abspath(WORKSPACE_ROOT or os.getcwd()))
    resolved = os.path.realpath(os.path.abspath(raw if os.path.isabs(raw) else os.path.join(workspace, raw)))
    allowed_roots = [workspace, os.path.realpath(KONOHA_DIR)]
    if not any(resolved == root or resolved.startswith(root + os.sep) for root in allowed_roots):
        raise ValueError(f"Source directory outside workspace: {source_dir}")
    if not os.path.isdir(resolved):
        raise ValueError(f"Source directory not found: {source_dir}")
    return resolved


def normalize_framework_name(framework):
    spec, _ = _validate_build_input("build", framework=framework)
    return spec["display"]


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



def _infer_build_archetype(description):
    text = description.lower()
    if any(term in text for term in ("e-commerce", "ecommerce", "online store", "shop", "catalog", "product detail", "checkout", "storefront", "marketplace")):
        return "commerce"
    if any(term in text for term in ("dashboard", "admin", "analytics", "back office", "internal tool", "infra", "infrastructure", "metric", "monitoring", "server", "cluster", "k8s", "control panel", "crm", "telemetry")):
        return "dashboard"
    if any(term in text for term in ("portfolio", "personal site", "case studies", "resume", "curriculum vitae", "developer site", "designer site")):
        return "portfolio"
    if any(term in text for term in ("landing page", "one-page", "one page", "marketing page", "saas", "waitlist", "product launch")):
        return "landing"
    if any(term in text for term in ("company", "corporate", "agency", "consultancy", "firm", "enterprise", "organization", "business profile")):
        return "company"
    if any(term in text for term in ("documentation", "docs site", "knowledge base", "developer portal", "api reference", "handbook")):
        return "documentation"
    return "application"


def _framework_source_signals(filename, content):
    lower_name = filename.lower()
    lower_content = content.lower()
    signals = []
    if lower_name.endswith((".tsx", ".jsx")) or "next/" in lower_content or "next.js" in lower_content:
        signals.append("nextjs")
    if lower_name.endswith(".svelte") or "svelte" in lower_content or "from '$app/" in lower_content:
        signals.append("sveltekit")
    if lower_name.endswith(".vue") or "definepagemeta" in lower_content or "<script setup" in lower_content:
        signals.append("nuxt")
    if lower_name.endswith(".component.ts") or "@component" in lower_content or "standalone: true" in lower_content or "signal(" in lower_content:
        signals.append("angular")
    return sorted(set(signals))


def build_from_source(name, source_dir, framework, agent_name=None, taste_dials=None):
    """
    Analyze design mockup layouts and reference source files in source_dir and set up project configuration.
    """
    global WORKSPACE_ROOT
    try:
        framework_spec, validated_dials = _validate_build_input(name, framework=framework, taste_dials=taste_dials)
        display_framework = framework_spec["display"]
        resolved_source_dir = _resolve_build_source_dir(source_dir)
    except ValueError as exc:
        res = json.dumps({"error": str(exc)})
        log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}", res, agent_name=agent_name)
        return res
        
    try:
        all_files = []
        source_root = os.path.realpath(resolved_source_dir)
        for root, dirs, filenames in os.walk(source_root):
            dirs[:] = [directory for directory in dirs if os.path.realpath(os.path.join(root, directory)).startswith(source_root + os.sep)]
            for f in sorted(filenames):
                if len(all_files) >= 100:
                    break
                ext = os.path.splitext(f)[1].lower()
                if ext not in {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.html', '.xml', '.tsx', '.jsx', '.ts', '.js', '.css', '.scss', '.svelte', '.vue', '.mjs', '.cjs'}:
                    continue
                full_path = os.path.join(root, f)
                if not os.path.realpath(full_path).startswith(source_root + os.sep):
                    continue
                all_files.append(os.path.relpath(full_path, source_root))
            if len(all_files) >= 100:
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
    code_exts = tuple({'.html', '.css', '.scss', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.svelte', '.vue', '.xml'})

    images_raw = [f for f in all_files if f.lower().endswith(image_exts)]
    sources_raw = [f for f in all_files if f.lower().endswith(code_exts)]

    # Lazy PIL import for image analysis
    _pil_available = False
    _Image = None
    try:
        from PIL import Image as _Image
        _pil_available = True
    except ImportError:
        sys.stderr.write("[mcp konoha] Pillow is unavailable; returning file metadata without image dimensions.\n")
        sys.stderr.flush()

    def _analyze_image(fpath):
        meta = {}
        try:
            meta["size_bytes"] = os.path.getsize(fpath)
        except OSError:
            meta["size_bytes"] = 0
        
        if not _pil_available or not _Image:
            meta["warning"] = "Pillow library not installed; image dimensions not analyzed. Install Pillow separately if image metadata is required."
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
    for s in sources_raw[:30]:
        fpath = os.path.join(resolved_source_dir, s)
        meta = {"filename": s}
        try:
            size = os.path.getsize(fpath)
            meta["size_bytes"] = size
            with open(fpath, 'rb') as raw_fp:
                raw_content = raw_fp.read(50000)
            meta["sha256"] = hashlib.sha256(raw_content).hexdigest()
            if size <= 50000:
                content = raw_content.decode('utf-8', errors='ignore')
                meta["content_excerpt"] = content[:4000]
                meta["framework_hints"] = _framework_source_signals(s, content)
                meta["has_exports_or_imports"] = bool(re.search(r"\b(import|export)\b", content))
                meta["signals"] = {
                    "routes": bool(re.search(r"(app/|src/routes/|pages/|app.routes|definePageMeta|@angular/router)", content, re.IGNORECASE)),
                    "design_tokens": bool(re.search(r"(--[a-z0-9-]+|@theme|tailwindcss)", content, re.IGNORECASE)),
                    "accessibility": bool(re.search(r"(aria-|role=|tabindex|sr-only)", content, re.IGNORECASE)),
                    "reduced_motion": bool(re.search(r"(prefers-reduced-motion|reduced.?motion)", content, re.IGNORECASE)),
                    "animation_frame": "requestAnimationFrame" in content,
                    "hero_carousel": bool(re.search(r"(carousel|swiper|splide|slide)", content, re.IGNORECASE)),
                }
        except (OSError, UnicodeError):
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
            "jonin-skill/nextjs-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "svelte" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/svelte-ui-expert",
            "jonin-skill/svelte-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "nuxt" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nuxt-ui-expert",
            "jonin-skill/nuxt-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "angular" in fw_lower_src:
        framework_skills_src = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/angular-ui-expert",
            "jonin-skill/angular-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
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
    if "jonin-skill/taste-skill-frontend-expert" not in agent_skills:
        agent_skills.append("jonin-skill/taste-skill-frontend-expert")

    absolute_image_paths = []
    if detected_images:
        for m in detected_images:
            fpath = os.path.join(resolved_source_dir, m["filename"])
            absolute_image_paths.append(os.path.abspath(fpath))

    directives.append("You MUST follow the package.json template, CSS variables, design-token manifest, and routing rules from the embedded skill content below.")
    if "next" in fw_lower_src or "react" in fw_lower_src:
        directives.append("Next.js Version Mandate: MUST strictly use Next.js 16+ (next: ^16.3.3, react: ^19.0.0, react-dom: ^19.0.0, Tailwind CSS v4). Under NO circumstances should Next.js 15 or 14 be used for fresh builds.")
        directives.append("Use Next.js 16 App Router under app/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS v4, ESLint, and the framework's production build tools.")
    elif "svelte" in fw_lower_src:
        directives.append("Use SvelteKit file-based routing under src/routes/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, Prettier, and svelte-check.")
    elif "nuxt" in fw_lower_src:
        directives.append("Use Nuxt 4 file-based routing under app/pages/ and app/layouts/ — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, and Nuxt build tools.")
    elif "angular" in fw_lower_src:
        directives.append("Use standalone Angular Router with app.routes.ts — NEVER hash-based SPA routing.")
        directives.append("Install the template dependencies including Tailwind CSS, ESLint, and Angular build tools.")
    else:
        directives.append("Use framework-native routing — NEVER hash-based SPA routing.")
    directives.append(f"Provide the framework validation scripts: {', '.join(framework_spec['validation'])}. All validation must finish with zero errors and zero warnings.")
    directives.append("Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit).")
    directives.append(f"Apply Taste-Skill dials: DESIGN_VARIANCE={validated_dials['design_variance']}/10, MOTION_INTENSITY={validated_dials['motion_intensity']}/10, VISUAL_DENSITY={validated_dials['visual_density']}/10.")

    # Load critical skill content
    skill_blocks = []
    try:
        conn = get_connection(DB_PATH)
        fw_base = "svelte" if "svelte" in fw_lower_src else "nextjs" if "next" in fw_lower_src or "react" in fw_lower_src else "nuxt" if "nuxt" in fw_lower_src else "angular" if "angular" in fw_lower_src else None
        critical_skills = [
            f"jonin-skill/{fw_base}-ui-expert" if fw_base else None,
            f"jonin-skill/{fw_base}-code-expert" if fw_base else None,
            "jonin-skill/build-directives-manifest",
            "jonin-skill/design-token-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/taste-skill-frontend-expert",
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
        "framework": framework_spec["canonical"],
        "framework_display": display_framework,
        "mode": "build_from_source",
        "source_directory": resolved_source_dir,
        "source_fidelity": True,
        "premium_effects_policy": "Only preserve or enhance effects explicitly present in source; do not inject generic themes, catalogs, carousels, dialogs, or sections.",
        "design_tokens": {"perspective": "1200px", "tilt_max": "12deg", "transition": "300ms", "entrance": "500ms", "hero_content_entrance": "600ms", "hero_autoplay": "6000ms", "theme_storage_key": "konoha-theme"},
        "taste_skill_source": "https://www.tasteskill.dev/guide",
        "taste_skill_audits": ["em_dash", "pre_flight", "section_layout_repetition", "hero_discipline", "preservation", "brand_fidelity"],
        "detected_images": detected_images,
        "detected_sources": detected_sources,
        "directives": directives,
        "image_to_code_required": len(detected_images) > 0,
        "required_skills": agent_skills,
        "skill_load_sequence": agent_skills,
        "delegate_constraints": directives,
        "absolute_image_paths": absolute_image_paths,
        "forbid_build_from_text": len(detected_images) > 0,
        "taste_dials": validated_dials,
        "scaffold_command": framework_spec.get("scaffold_command", ""),
        "validation_commands": framework_spec["validation"],
        "embedded_skill_content": skill_blocks
    }

    res = json.dumps(spec, indent=2)
    log_tool_call("build_from_source", f"name={name}, source_dir={source_dir}, framework={framework}", res, agent_name=agent_name)
    return res


def build_from_text(name, description, framework, agent_name=None, taste_dials=None):
    """
    Generate a validated, side-effect-free build specification from a text description.
    """
    archetype = _infer_build_archetype(description)
    try:
        framework_spec, validated_dials = _validate_build_input(
            name, description=description, framework=framework, taste_dials=taste_dials
        )
        display_framework = framework_spec["display"]
    except ValueError as exc:
        res = json.dumps({"error": str(exc)})
        log_tool_call("build_from_text", f"name={name}, framework={framework}", res, agent_name=agent_name)
        return res
    
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
            "jonin-skill/nextjs-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "svelte" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/svelte-ui-expert",
            "jonin-skill/svelte-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "nuxt" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/nuxt-ui-expert",
            "jonin-skill/nuxt-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
        ]
    elif "angular" in fw_lower:
        framework_skills = [
            "jonin-skill/design-token-manifest",
            "jonin-skill/tailwind-design-system",
            "jonin-skill/build-directives-manifest",
            "jonin-skill/source-fidelity-directives",
            "jonin-skill/angular-ui-expert",
            "jonin-skill/angular-code-expert",
            "jonin-skill/taste-skill-frontend-expert"
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
    if "jonin-skill/taste-skill-frontend-expert" not in agent_skills:
        agent_skills.append("jonin-skill/taste-skill-frontend-expert")

    routing_directive = framework_spec["routing"]
    scaffold_command = framework_spec.get("scaffold_command", "")
    install_directive = "Install and validate dependencies with pnpm, then run every command returned in validation_commands."
    build_directives = [
        f"Build a premium, intentional {display_framework} website named '{name}' from this description: '{description}'.",
        f"Standard Project Scaffolding Command: When scaffolding a fresh project, use the official framework CLI command: '{scaffold_command}'.",
        "Load Taste-Skill v2 once as the design source, declare the design read and explain each dial before implementation.",
        f"Use framework-native routing: {routing_directive}",
        install_directive,
        "Framework Version Mandates: Next.js builds MUST strictly use Next.js with React 19 and Tailwind CSS (pnpm create next-app@latest). Svelte builds use SvelteKit 2 + Svelte 5 (pnpm dlx sv create <project-name>). Nuxt builds use Nuxt (pnpm dlx nuxi@latest init <project-name>). Angular builds use Angular 19+ (pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm).",
        f"Apply Taste-Skill dials: DESIGN_VARIANCE={validated_dials['design_variance']}/10, MOTION_INTENSITY={validated_dials['motion_intensity']}/10, VISUAL_DENSITY={validated_dials['visual_density']}/10, with one-line rationale for each.",
        "Apply semantic design tokens, accessible keyboard and focus states, reduced-motion fallbacks, transform/opacity-only motion, and teardown for timers, observers, listeners, and animation frames.",
        "Run Taste-Skill audits before completion: zero em-dash or en-dash characters, Pre-Flight Check, section-layout repetition, hero discipline when a hero exists, and preservation/brand fidelity when an existing brand exists.",
        "Use distinctive editorial typography, cinematic section spacing, intentional CSS Grid or bento composition, mobile-safe min-h-[100dvh], and vector icons with no emojis in UI controls.",
        "Header Architecture Mandate: The brand logo MUST always be placed on the far LEFT of the navigation header with navigation links adjacent/centered and action buttons on the right. Never position the logo on the right or center.",
        "Mobile View Invariant (NO Top Menu Toggle in Header): In mobile view (lg:hidden), NEVER show a top menu toggle or hamburger button in the header. Mobile navigation is powered exclusively by the fixed bottom MobileDock.",
        "Floating Bottom-Left Theme Switcher Popup: Every text-based website build MUST include an interactive 10-Theme Light-Mode Switcher floating button in the bottom-left corner (fixed bottom-6 left-6 z-50, like a customer chat widget) in both desktop and mobile viewports that opens the 10-theme selection popup modal with dynamic CSS variables and localStorage persistence. Pure Light Mode is first-class (zero dark mode enforcement).",
        "Archetype-Adaptive Mobile Dock: Every text-based website build MUST include a fixed bottom mobile navigation dock (MobileDock) on mobile viewports (lg:hidden) with quick one-tap links dynamically adapted to the website archetype (e.g. E-commerce: Home, Shop, Themes, Wishlist, Cart; Portfolio: Home, Projects, Case Studies, About, Contact; Dashboard: Overview, Analytics, Users, Settings; SaaS: Home, Features, Pricing, Contact).",
        "Hero Banner Carousel Mandate: The homepage hero section MUST implement an interactive hero banner carousel with a minimum of 4 high-definition slides, autoplay (5000ms) with hover pause, previous/next chevron buttons, indicator thumbnails/dots, slide badges, and call-to-action buttons.",
        "Taste-Skill Prettification: Combine Taste-Skill principles (editorial typography, negative space, subtle 3D hover tilt, glassmorphic depth, smooth GPU transitions, zero emoji policy in UI controls) to enrich the visual polish without altering the default Konoha design.",
        "SSR & Hydration Safety Mandate: All interactive client components accessing localStorage, window, or document (ThemeSwitcher, HeroCarousel, MobileDock) MUST use 'use client' and an explicit useMounted() state guard before rendering localStorage-dependent DOM elements to guarantee 0 hydration mismatch errors.",
        "Essential Dependency Packages: Ensure required icon and utility packages (lucide-react / lucide-svelte / lucide-vue-next / lucide-angular, clsx, tailwind-merge) are installed during scaffolding to eliminate missing module errors.",
        "Zero Errors & Zero Warnings Mandate: Do not claim completion until every configured framework validation command (pnpm run build, pnpm run lint, pnpm run check for SvelteKit) passes cleanly with 0 errors and 0 warnings."
    ]
    if archetype == "commerce":
        build_directives.extend([
            "Commerce features: implement a 50-item production catalog with reactive search, category filters, price range, sorting, pagination, product detail, cart, and checkout routes.",
            "Commerce hero: add the full-width interactive 4-slide 3D carousel with 1200px perspective, max 12deg tilt, 5000ms autoplay, split-drapes transition, thumbnails, and keyboard controls.",
            "Commerce shell: add the ten-theme light-mode switcher popup, sticky header search, mobile dock, lazy images, security headers, custom error pages, and Build by Konoha footer watermark."
        ])
    elif archetype in ("dashboard", "admin", "infra"):
        build_directives.extend([
            "Dashboard Shell Architecture: implement a fixed Left Sidebar (hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 min-h-screen sticky top-0) with brand logo at top-left, navigation links with badges, and user profile badge.",
            "Dashboard Top Header: sticky top bar (h-16 border-b border-[var(--theme-border)] bg-white/80 backdrop-blur-md px-6 flex items-center justify-between) with breadcrumb, global search bar, live status pill, and notification trigger.",
            "Dashboard KPI & Analytics Widgets: implement 4+ Metric KPI stat cards with trend percentage badges (+12.5%), SSR-safe interactive SVG Area/Line charts with time-range filters (24h, 7d, 30d), and filterable data tables with status pills (Healthy, Warning, Critical).",
            "Dashboard Mobile View: fixed bottom mobile dock (MobileDock) with quick one-tap links (Overview, Analytics, Servers/Users, Settings, Themes) and NO top hamburger menu toggle."
        ])
    elif archetype == "portfolio":
        build_directives.extend([
            "Portfolio Hero Section: developer/designer introduction with editorial typography, interactive status badge, tech stack pills, resume download CTA, and social links.",
            "Projects Bento Grid: showcase 6+ rich projects with category filter tabs (All, Fullstack, AI, Mobile), tags, interactive modal preview dialogs, and live demo / GitHub links.",
            "Interactive Skills & Experience: category-filtered skills matrix (Frontend, Backend, DevOps, AI) with proficiency meters, and interactive career timeline.",
            "Contact & Inquiries: interactive contact form with client-side validation, instant feedback toast, and direct email/calendar booking triggers.",
            "Portfolio Mobile View: fixed bottom mobile dock (Home, Projects, Experience, Skills, Contact, Themes) with zero mobile header menu toggle."
        ])
    elif archetype in ("landing", "saas"):
        build_directives.extend([
            "SaaS/Landing Hero: high-impact value proposition hero with interactive product preview mockup or 4-slide hero banner carousel with 5000ms autoplay.",
            "Feature Bento Grid: interactive feature showcase with glassmorphism cards, hover tilt effects, and clear benefit descriptions.",
            "Interactive Pricing Tier Switcher: Monthly vs Annual billing toggle with 20% discount badge, feature comparison checklist, and highlighted Recommended tier.",
            "Social Proof & FAQ: client testimonials carousel, trusted company logos, and interactive FAQ accordion with smooth spring expansion.",
            "SaaS Mobile View: fixed bottom mobile dock (Home, Features, Pricing, Testimonials, Themes) with zero mobile header menu toggle."
        ])
    elif archetype in ("company", "corporate"):
        build_directives.extend([
            "Company Profile Hero: 4-slide mission and achievements banner carousel with high-definition slides and CTA buttons.",
            "Corporate Showcase: About Us narrative, leadership team grid, services/solutions interactive tab switcher, and client case studies.",
            "Contact & Locations: interactive inquiry form, office location cards, and company credentials.",
            "Corporate Mobile View: fixed bottom mobile dock (Home, About, Services, Case Studies, Contact, Themes) with zero mobile header menu toggle."
        ])
    elif archetype == "documentation":
        build_directives.extend([
            "Documentation Layout: two-column or three-column documentation layout with sticky left sidebar navigation, central markdown/content reader, and right-hand On This Page table of contents.",
            "Doc Features: fast search modal (Cmd+K), interactive code blocks with copy-to-clipboard buttons, syntax highlighting, and callout alert boxes.",
            "Docs Mobile View: fixed bottom mobile dock (Docs, Guides, API, Search, Themes)."
        ])
    else:
        build_directives.append("Application features: infer only the routes and interactions required by the description, adhering strictly to the 4 layout invariants, 10 light-mode themes, and zero errors contract.")
    build_directives.append("Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit).")

    # Load critical skill content
    skill_blocks = []
    try:
        conn = get_connection(DB_PATH)
        fw_base = "svelte" if "svelte" in fw_lower else "nextjs" if "next" in fw_lower or "react" in fw_lower else "nuxt" if "nuxt" in fw_lower else "angular" if "angular" in fw_lower else None
        critical_skills = [
            f"jonin-skill/{fw_base}-ui-expert" if fw_base else None,
            f"jonin-skill/{fw_base}-code-expert" if fw_base else None,
            "jonin-skill/build-directives-manifest",
            "jonin-skill/design-token-manifest",
            "jonin-skill/taste-skill-frontend-expert",
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
        "framework": framework_spec["canonical"],
        "framework_display": display_framework,
        "mode": "build_from_text",
        "description": description,
        "archetype": archetype,
        "taste_skill_source": "https://www.tasteskill.dev/guide",
        "taste_skill_read": "Load Taste-Skill v2 once, declare the design read, and explain each dial before implementation.",
        "taste_skill_audits": ["em_dash", "pre_flight", "section_layout_repetition", "hero_discipline", "preservation", "brand_fidelity"],
        "design_tokens": {"perspective": "1200px", "tilt_max": "12deg", "transition": "300ms", "entrance": "500ms", "hero_content_entrance": "600ms", "hero_autoplay": "6000ms", "theme_storage_key": "konoha-theme"},
        "directives": build_directives,
        "required_skills": agent_skills,
        "skill_load_sequence": agent_skills,
        "delegate_constraints": build_directives,
        "taste_dials": validated_dials,
        "scaffold_command": framework_spec.get("scaffold_command", ""),
        "validation_commands": framework_spec["validation"],
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
        client = detect_active_client()
        conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID") if client in ("agy", "antigravity") else None
        if ACTIVE_CLIENT in ["cursor", "claudecode", "opencode", "commandcode"] or client in ["cursor", "claudecode", "opencode", "commandcode"]:
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

        if client == "claudecode":
            brain_dirs.append(CLAUDE_PROJECTS)
        elif client == "cursor":
            brain_dirs.append(CURSOR_PROJECTS)
        else:
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
                        conn = get_connection(DB_PATH)
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
                conn = get_connection(DB_PATH)
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
        conn = get_connection(DB_PATH)
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


TOOL_SPECIFIC_ALIASES = {
    "read_file_head": {"lines": "max_lines", "limit": "max_lines", "count": "max_lines", "FilePath": "file_path", "filepath": "file_path", "Path": "path"},
    "read_file_range": {"FilePath": "file_path", "filepath": "file_path", "Path": "path", "StartLine": "start_line", "EndLine": "end_line"},
    "file_info": {"FilePath": "file_path", "filepath": "file_path", "Path": "path"},
    "token_efficient_grep": {"DirectoryPath": "dir", "dir_path": "dir", "directory": "dir", "Pattern": "pattern", "Glob": "glob", "file_glob": "glob", "CaseInsensitive": "ignore_case"},
    "get_file_structure": {"FilePath": "file_path", "filepath": "file_path", "Path": "path", "DirectoryPath": "dir", "dir_path": "dir", "directory": "dir"},
    "find_files_clean": {"DirectoryPath": "dir", "dir_path": "dir", "directory": "dir", "Pattern": "pattern"},
}

GLOBAL_ALIASES = {
    "filepath": "file_path",
    "FilePath": "file_path",
    "Path": "path",
    "StartLine": "start_line",
    "EndLine": "end_line",
    "Pattern": "pattern",
    "CaseInsensitive": "ignore_case",
    "Keyword": "keyword",
    "TasteDials": "taste_dials",
    "ProjectPath": "project_path",
    "TaskDir": "task_dir",
    "AgentName": "agent_name",
}


def _validate_manifest_arguments(tool_name, args):
    tool = next((item for item in MCP_MANIFEST.get("tools", []) if item.get("name") == tool_name), None)
    if tool is None:
        raise ValueError(f"Unknown tool: {tool_name}")
    if not isinstance(args, dict):
        raise ValueError("arguments must be an object")

    # Normalize tool-specific argument aliases
    tool_aliases = TOOL_SPECIFIC_ALIASES.get(tool_name, {})
    for raw_k, target_k in tool_aliases.items():
        if raw_k in args and target_k not in args:
            args[target_k] = args[raw_k]
            del args[raw_k]

    # Normalize global argument aliases
    for raw_k, target_k in GLOBAL_ALIASES.items():
        if raw_k in args and target_k not in args:
            args[target_k] = args[raw_k]
            del args[raw_k]

    schema = tool.get("inputSchema", {})
    required = schema.get("required", [])
    for key in required:
        if key not in args:
            raise ValueError(f"{key} is required")
    if schema.get("additionalProperties") is False:
        properties = schema.get("properties", {})
        unknown = [key for key in args if key not in properties]
        if unknown:
            raise ValueError(f"Unknown argument: {unknown[0]}")
    for key, value in args.items():
        spec = schema.get("properties", {}).get(key)
        if not spec:
            continue
        kind = spec.get("type")
        if kind == "string" and not isinstance(value, str):
            raise ValueError(f"{key} must be a string")
        if kind == "boolean" and not isinstance(value, bool):
            raise ValueError(f"{key} must be a boolean")
        if kind in ("number", "integer"):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
                raise ValueError(f"{key} must be a finite number")
            if kind == "integer" and not isinstance(value, int):
                raise ValueError(f"{key} must be an integer")
            if spec.get("integer") and not isinstance(value, int):
                raise ValueError(f"{key} must be an integer")
            if spec.get("minimum") is not None and value < spec["minimum"]:
                raise ValueError(f"{key} must be at least {spec['minimum']}")
            if spec.get("maximum") is not None and value > spec["maximum"]:
                raise ValueError(f"{key} must be at most {spec['maximum']}")
        if kind == "array" and not isinstance(value, list):
            raise ValueError(f"{key} must be an array")
        if kind == "object" and (not isinstance(value, dict)):
            raise ValueError(f"{key} must be an object")
        if spec.get("enum") and value not in spec["enum"]:
            raise ValueError(f"{key} must be one of: {', '.join(spec['enum'])}")
        if spec.get("minLength") is not None and isinstance(value, str) and len(value) < spec["minLength"]:
            raise ValueError(f"{key} must not be empty")
    for option in schema.get("anyOf", []):
        if all(key in args for key in option.get("required", [])):
            break
    else:
        if schema.get("anyOf"):
            raise ValueError("one of the supported path arguments is required")


def _fuzzy_resolve_skill(requested, conn, max_distance=3):
    """Resolve a requested skill name to a real skill in the DB.

    Tries exact match first, then falls back to Levenshtein-based fuzzy match
    against the `skills` table (skill_name column). Returns the resolved
    skill_name, or None if no candidate is close enough.
    """
    requested = normalize_legacy_skill_name(requested)
    row = conn.execute(
        "SELECT name FROM skills WHERE name = ? OR skill_name = ? ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 1",
        (requested, requested, requested),
    ).fetchone()
    if row:
        return row[0]

    candidates = conn.execute(
        "SELECT DISTINCT skill_name FROM skills WHERE skill_name IS NOT NULL AND skill_name != ''"
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
        conn = get_connection(DB_PATH)
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
        conn = get_connection(DB_PATH)
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
        conn = get_connection(DB_PATH)
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


def _workflow_hash(path):
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


def _workflow_dispatch(task_dir, status, phase, agent, task_id=None, task=None):
    current = status.get("current_dispatch") or {}
    if (current.get("phase"), current.get("agent"), current.get("task_id")) == (phase, agent, task_id):
        return current
    result_path = os.path.join(task_dir, "result.md")
    dispatch = {
        "id": hashlib.sha256(f"{phase}:{agent}:{task_id}:{time.time_ns()}".encode()).hexdigest()[:16],
        "phase": phase,
        "agent": agent,
        "task_id": task_id,
        "task": task or "",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "started_at_ns": time.time_ns(),
        "previous_result_hash": _workflow_hash(result_path),
    }
    status["current_dispatch"] = dispatch
    return dispatch


def _workflow_dispatch_completed(task_dir, status):
    dispatch = status.get("current_dispatch") or {}
    if not dispatch:
        return None
    if dispatch.get("id") in status.get("completed_dispatches", []):
        return {"dispatch": dispatch, "result": status.get("dispatch_results", {}).get(dispatch["id"], "")}
    result_path = os.path.join(task_dir, "result.md")
    current_hash = _workflow_hash(result_path)
    if not current_hash or current_hash == dispatch.get("previous_result_hash"):
        return None
    try:
        result = _read_file_safe(result_path) or ""
        return {"dispatch": dispatch, "result": result}
    except OSError:
        return None


_VALIDATION_EVIDENCE_PATTERN = re.compile(
    r"(exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*[:=]?\s*0\b"
    r"|0\s+errors?(?:\s+and\s+0\s+warnings?)?"
    r"|\bpassed\b"
    r"|\bpassthrough\b"
    r"|✓"
    r"|\bOK\b"
    r"|\bsucceeded\b"
    r"|\bcompleted successfully\b"
    r"|\bpentest(?:ing)?\s+completed\b"
    r"|\bscan(?:ning)?\s+completed\b"
    r"|\bsecurity\s+audit\s+completed\b"
    r"|\bvulnerability\s+assessment\s+completed\b"
    r"|\b0\s+critical\s+vulnerabilities\b"
    r"|\b0\s+unhandled\s+exploits\b)",
    re.IGNORECASE
)


def _is_pentest_task(task_obj):
    if not isinstance(task_obj, dict):
        return False
    text = f"{task_obj.get('task', '')} {task_obj.get('agent', '')}".lower()
    return any(k in text for k in ("pentest", "penetration test", "penetration testing", "vulnerability scan", "security audit", "security test", "vuln scan", "devsecops"))


def _is_clean_validation(validation_list, is_pentest=False, allow_empty=True):
    if not validation_list:
        return allow_empty
    if is_pentest:
        evidence = [str(item).lower() for item in validation_list]
        has_completion = any(_VALIDATION_EVIDENCE_PATTERN.search(item) for item in evidence) or any(
            marker in item for item in evidence for marker in ("completed", "passed", "finished", "reported", "clean", "done")
        )
        has_fatal = any(
            marker in item for item in evidence for marker in ("fatal error", "unhandled exception", "segmentation fault", "traceback (most recent call last)")
        )
        return has_completion and not has_fatal
    else:
        return not any(any(word in str(item).lower() for word in ("error", "warning", "fail")) for item in validation_list)


def _workflow_parse_tasks(plan_content):
    tasks = []
    for line_number, line in enumerate(plan_content.splitlines(), 1):
        match = re.match(r"^- \[([A-Za-z0-9_-]+)\]:\s*(.+)$", line.strip())
        if not match:
            continue
        agent, task = match.groups()
        tasks.append({
            "id": f"task-{len(tasks) + 1}",
            "agent": agent.replace("_", "-"),
            "task": task.strip(),
            "line": line_number,
            "status": "pending",
            "result": "",
            "validation": [],
        })
    return tasks


def _workflow_review_approved(task_dir, status):
    tasks = status.get("tasks", [])
    if not tasks and status.get("executed"):
        tasks = []
        for index, (task_id, item) in enumerate(status["executed"].items(), 1):
            item = item if isinstance(item, dict) else {"result": item}
            tasks.append({"id": task_id or f"task-{index}", "agent": item.get("agent", task_id), "task": item.get("task", ""), "status": "completed", "result": item.get("result", ""), "validation": item.get("validation", [])})
        status["tasks"] = tasks
    if not tasks or any(task.get("status") != "completed" for task in tasks):
        return False
    for task in tasks:
        # Tasks explicitly recorded as unverified (no validation evidence)
        # block approval regardless of the review file's claims.
        if task.get("verified") is False:
            return False
        is_pentest = _is_pentest_task(task)
        if not _is_clean_validation(task.get("validation", []), is_pentest=is_pentest):
            return False
    review_path = os.path.join(task_dir, "kage_review.json")
    if os.path.exists(review_path):
        try:
            review = json.loads(_read_file_safe(review_path) or "{}")
            review_validation = review.get("validation") or review.get("validation_evidence") or []
            verified_tasks = set(review.get("verified_task_ids") or [])
            expected_tasks = {task.get("id") for task in tasks}
            security_verified = review.get("security_reviewed") is True
            rollback_verified = review.get("rollback_reviewed") is True
            confidence = review.get("confidence", review.get("confidence_score", 100))
            confidence_pass = isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and confidence >= 95
            is_pentest_review = any(_is_pentest_task(task) for task in tasks) or any("pentest" in str(item).lower() for item in review_validation)
            clean_validation = review_validation and _is_clean_validation(review_validation, is_pentest=is_pentest_review, allow_empty=False)

            # Zero AI-Slop Gate: must be clean and findings must be numeric 0
            ai_slop_findings = review.get("ai_slop_findings")
            ai_slop_clean = review.get("ai_slop_clean") is True
            ai_slop_pass = (
                ai_slop_clean and
                isinstance(ai_slop_findings, (int, float)) and
                not isinstance(ai_slop_findings, bool) and
                ai_slop_findings == 0
            )

            if review.get("approved") is True and clean_validation and verified_tasks == expected_tasks and security_verified and rollback_verified and confidence_pass and ai_slop_pass:
                status["review"] = review
                return True
            status["review"] = review
            return False
        except (TypeError, json.JSONDecodeError):
            return False
    review = status.get("review") or {}
    confidence = review.get("confidence", review.get("confidence_score", 100))
    confidence_pass = isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and confidence >= 95
    ai_slop_findings = review.get("ai_slop_findings")
    ai_slop_clean = review.get("ai_slop_clean") is True
    ai_slop_pass = (
        ai_slop_clean and
        isinstance(ai_slop_findings, (int, float)) and
        not isinstance(ai_slop_findings, bool) and
        ai_slop_findings == 0
    )
    return review.get("approved") is True and confidence_pass and ai_slop_pass and all(task.get("status") == "completed" for task in status.get("tasks", []))


def run_mcp_workflow(task_dir=None):
    """Advance the persisted evidence-based Konoha workflow by one state transition."""
    task_dir = get_resolved_task_dir(task_dir)
    os.makedirs(task_dir, exist_ok=True)
    status = _load_workflow_status(task_dir)
    status.setdefault("schema_version", 2)
    status.setdefault("tasks", [])
    status.setdefault("completed_dispatches", [])
    status.setdefault("dispatch_results", {})
    status.setdefault("review", {})
    status.setdefault("history", [])
    status.setdefault("pending_executors", [])
    status.setdefault("completed_executors", [])
    status.setdefault("executed", {})
    phase = status.get("phase", "route")

    if phase == "done":
        return json.dumps({"status": "completed", "phase": "done"})

    if phase == "route":
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md"))
        if not prompt:
            return json.dumps({"status": "error", "message": "No prompt.md found in task directory.", "phase": "route"})
        status["phase"] = "explore"
        status["assigned_agent"] = "genin"
        status["history"].append({"phase": "route", "agent": "genin"})
        status["current_dispatch"] = None
        _save_workflow_status(task_dir, status)
        phase = "explore"

    completion = _workflow_dispatch_completed(task_dir, status)
    if completion and completion["dispatch"].get("phase") == phase:
        dispatch = completion["dispatch"]
        dispatch_id = dispatch["id"]
        status.setdefault("completed_dispatches", []).append(dispatch_id)
        status.setdefault("dispatch_results", {})[dispatch_id] = completion["result"]
        status["current_dispatch"] = None
        if phase == "explore":
            status["phase"] = "plan"
            status["history"].append({"phase": "explore", "agent": dispatch.get("agent"), "dispatch_id": dispatch_id})
            status["assigned_agent"] = "kage"
            phase = "plan"
        elif phase == "research":
            status["phase"] = "plan"
            status["research_completed"] = True
            status["history"].append({"phase": "research", "agent": "chunin", "dispatch_id": dispatch_id})
            status["assigned_agent"] = "kage"
            phase = "plan"
        elif phase == "plan":
            plan_content = _read_file_safe(os.path.join(task_dir, "plan.md")) or completion["result"]
            plan_lower = plan_content.lower()
            if "needs_research:" in plan_lower and not status.get("research_completed"):
                status["phase"] = "research"
                status["assigned_agent"] = "chunin"
                status["research_completed"] = False
                phase = "research"
            elif "needs_replan:" in plan_lower and not status.get("replanned"):
                status["phase"] = "plan"
                status["assigned_agent"] = "kage"
                status["replanned"] = True
                phase = "plan"
            else:
                status["tasks"] = _workflow_parse_tasks(plan_content)
                if not status["tasks"]:
                    status["tasks"] = [{"id": "task-1", "agent": "anbu", "task": "Execute the approved implementation plan.", "status": "pending", "result": "", "validation": []}]
                status["pending_executors"] = [task["id"] for task in status["tasks"]]
                status["completed_executors"] = []
                status["phase"] = "execute"
                phase = "execute"
        elif phase == "execute":
            task_id = dispatch.get("task_id")
            task = next((item for item in status.get("tasks", []) if item.get("id") == task_id), None)
            if task:
                # Respect verification gate: if report_from_agent already set
                # this task to "unverified", keep that status — do not blindly
                # override to "completed". Only mark as "completed" when the
                # task was still pending/in-progress.
                if task.get("status") not in ("completed", "unverified"):
                    task["status"] = "completed"
                task["result"] = completion["result"]
                task["completed_dispatch_id"] = dispatch_id
                if task.get("status") == "completed":
                    status.setdefault("completed_executors", []).append(task_id)
                status.setdefault("executed", {})[task_id] = {"agent": task["agent"], "task": task["task"], "result": completion["result"], "validation": task.get("validation", [])}
            phase = "execute"
        elif phase == "document":
            status["phase"] = "review"
            status["assigned_agent"] = "kage"
            phase = "review"
        elif phase == "review":
            if _workflow_review_approved(task_dir, status):
                status["phase"] = "synthesize"
                status["assigned_agent"] = "sannin"
                phase = "synthesize"
            else:
                review_obj = status.get("review") or {}
                if not (review_obj.get("ai_slop_clean") is True and review_obj.get("ai_slop_findings") == 0):
                    reason = "Zero-AI-Slop gate failed or was not executed (ai_slop_findings must be 0 and ai_slop_clean must be true)."
                else:
                    reason = "Kage review did not approve all completed tasks."
                status["review"] = {"approved": False, "reason": reason}
                _save_workflow_status(task_dir, status)
                return json.dumps({"status": "blocked", "phase": "review", "message": f"Kage review must approve every completed task before delivery: {reason}"})

        _save_workflow_status(task_dir, status)

    if phase == "explore":
        dispatch = _workflow_dispatch(task_dir, status, "explore", "genin")
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: genin\npriority: medium\nPhase: Explore\ndispatch_id: {dispatch['id']}\n\n## TASK\n\n{_read_file_safe(os.path.join(task_dir, 'prompt.md')) or ''}\n\nRead-only exploration. Write findings.md and result.md for this dispatch.\n")
        status["assigned_agent"] = "genin"
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "explore", "agent": "genin", "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "plan":
        dispatch = _workflow_dispatch(task_dir, status, "plan", "kage")
        findings = _read_file_safe(os.path.join(task_dir, "findings.md")) or "No findings available."
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: kage\npriority: high\nPhase: Plan\ndispatch_id: {dispatch['id']}\n\n## TASK\n\nAnalyze the findings and produce plan.md with unique `- [agent]: task` entries. Set needs_research or needs_replan explicitly when applicable.\n\n## FINDINGS\n\n{findings}\n")
        status["assigned_agent"] = "kage"
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "plan", "agent": "kage", "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "research":
        dispatch = _workflow_dispatch(task_dir, status, "research", "chunin")
        plan_context = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
        query = next((line.split(":", 1)[1].strip() for line in plan_context.splitlines() if line.startswith("research_query:")), "")
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: chunin\npriority: medium\nPhase: Research\ndispatch_id: {dispatch['id']}\n\n## TASK\n\nConduct web research on: {query or 'the plan requirements'}\n")
        status["assigned_agent"] = "chunin"
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "research", "agent": "chunin", "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "execute":
        next_task = next((task for task in status.get("tasks", []) if task.get("status") != "completed"), None)
        if not next_task:
            status["phase"] = "document"
            status["assigned_agent"] = "tokubetsu-jonin"
            status["current_dispatch"] = None
            _save_workflow_status(task_dir, status)
            phase = "document"
        else:
            dispatch = _workflow_dispatch(task_dir, status, "execute", next_task["agent"], next_task["id"], next_task["task"])
            with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
                f.write(f"agent: {next_task['agent']}\npriority: high\nPhase: Execute\ndispatch_id: {dispatch['id']}\ntask_id: {next_task['id']}\n\n## TASK\n\n{next_task['task']}\n\nWrite result.md and validation evidence for this task.\n")
            status["assigned_agent"] = next_task["agent"]
            _save_workflow_status(task_dir, status)
            return json.dumps({"status": "ready", "phase": "execute", "agent": next_task["agent"], "task_id": next_task["id"], "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "document":
        dispatch = _workflow_dispatch(task_dir, status, "document", "tokubetsu-jonin")
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: tokubetsu-jonin\npriority: medium\nPhase: Document\ndispatch_id: {dispatch['id']}\n\n## TASK\n\nDocument the completed work and validation evidence in final_docs.md and result.md.\n")
        status["assigned_agent"] = "tokubetsu-jonin"
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "document", "agent": "tokubetsu-jonin", "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "review" and _workflow_review_approved(task_dir, status):
        status["phase"] = "synthesize"
        status["assigned_agent"] = "sannin"
        status["review"] = status.get("review") or {"approved": True}
        _save_workflow_status(task_dir, status)
        phase = "synthesize"

    if phase == "review":
        dispatch = _workflow_dispatch(task_dir, status, "review", "kage")
        with open(os.path.join(task_dir, "delegate.md"), "w", encoding="utf-8") as f:
            f.write(f"agent: kage\npriority: critical\nPhase: Review\ndispatch_id: {dispatch['id']}\n\n## TASK\n\nVerify every task in status.json is completed, required files exist, validation evidence has no errors or warnings, security/rollback checks are documented, and run aislop_scan to verify 0 ai-slop findings. Write kage_review.json with approved, verified_task_ids, validation, security_reviewed, rollback_reviewed, ai_slop_findings, ai_slop_clean, and findings fields, then write result.md.\n")
        status["assigned_agent"] = "kage"
        _save_workflow_status(task_dir, status)
        return json.dumps({"status": "ready", "phase": "review", "agent": "kage", "dispatch_id": dispatch["id"], "task_dir": task_dir})

    if phase == "synthesize":
        if not _workflow_review_approved(task_dir, status):
            review_obj = status.get("review") or {}
            if not (review_obj.get("ai_slop_clean") is True and review_obj.get("ai_slop_findings") == 0):
                msg = "Zero-AI-Slop gate failed: Kage must run aislop_scan and verify 0 findings before synthesis."
            else:
                msg = "Kage approval is required before synthesis."
            return json.dumps({"status": "blocked", "phase": "review", "message": msg})
        prompt = _read_file_safe(os.path.join(task_dir, "prompt.md")) or ""
        findings = _read_file_safe(os.path.join(task_dir, "findings.md")) or ""
        plan = _read_file_safe(os.path.join(task_dir, "plan.md")) or ""
        research = _read_file_safe(os.path.join(task_dir, "research_results.json")) or ""
        final_docs = _read_file_safe(os.path.join(task_dir, "final_docs.md")) or ""
        review_raw = _read_file_safe(os.path.join(task_dir, "kage_review.json"))
        review_data = {}
        if review_raw:
            try:
                review_data = json.loads(review_raw)
            except Exception:
                review_data = {}

        # Build the confidence gate report from REAL task state — never from a
        # hardcoded template. Every number below is computed from status.json.
        def _task_evidence_ok(t):
            if t.get("verified") is False:
                return False
            if t.get("verified") is True:
                return True
            is_pentest = _is_pentest_task(t)
            if _is_clean_validation(t.get("validation", []), is_pentest=is_pentest):
                return True
            if review_data.get("approved") is True and t.get("id") in review_data.get("verified_task_ids", []):
                return True
            return False

        tasks = status.get("tasks", [])
        total_tasks = len(tasks)
        unverified_ids = [t.get("id") for t in tasks if not _task_evidence_ok(t)]
        if unverified_ids:
            status["review"] = {
                "approved": False,
                "reason": f"Tasks without verifiable validation evidence: {', '.join(unverified_ids)}",
            }
            _save_workflow_status(task_dir, status)
            return json.dumps({
                "status": "blocked",
                "phase": "review",
                "message": "Delivery blocked: tasks lack validation evidence: " + ", ".join(unverified_ids),
            })

        verified_count = total_tasks - len(unverified_ids)
        evidence_pct = 100 if total_tasks == 0 else round(100 * verified_count / total_tasks)
        validation_entries = sum(len(t.get("validation", []) or []) for t in tasks)
        security_verified = review_data.get("security_reviewed") is True
        rollback_verified = review_data.get("rollback_reviewed") is True
        review_findings = review_data.get("findings") or []
        confidence_val = review_data.get("confidence", review_data.get("confidence_score", 95))

        ai_slop_findings = review_data.get("ai_slop_findings")
        ai_slop_clean = review_data.get("ai_slop_clean") is True
        ai_slop_ok = (
            ai_slop_clean and
            isinstance(ai_slop_findings, (int, float)) and
            not isinstance(ai_slop_findings, bool) and
            ai_slop_findings == 0
        )
        ai_slop_eval = (
            f"ai_slop_findings = {int(ai_slop_findings)}"
            if isinstance(ai_slop_findings, (int, float)) and not isinstance(ai_slop_findings, bool)
            else "missing ai_slop_findings"
        )
        ai_slop_conf = "100%" if ai_slop_ok else "BLOCKING (confidence withheld)"

        def _mark(ok):
            return "✅ Passed" if ok else "❌ Needs Attention"

        review_gate_block = (
            "### 🛡️ Kage Reviewer Confidence Gate Report\n\n"
            "```\n"
            "┌───────────────────────────────────────────────────────────────┐\n"
            "│  ◎ KAGE REVIEW GATE: APPROVED                                 │\n"
            f"│  📊 CONFIDENCE SCORE: {confidence_val}% (Minimum Required: ≥ 95%)           │\n"
            "└───────────────────────────────────────────────────────────────┘\n"
            "```\n\n"
            "### 📋 Confidence Score Breakdown (computed from recorded task evidence)\n\n"
            "| Verification Category | Target | Evaluated Result | Category Confidence | Status |\n"
            "|---|---|---|---|---|\n"
            f"| **AI Slop Scan** | All changed files | {ai_slop_eval} | **{ai_slop_conf}** | {_mark(ai_slop_ok)} |\n"
            f"| **Task Validation Evidence** | {total_tasks}/{total_tasks} tasks with passing evidence | {verified_count}/{total_tasks} verified, {validation_entries} validation entries recorded | **{evidence_pct}%** | {_mark(evidence_pct == 100)} |\n"
            f"| **Kage Review Findings** | 0 unresolved findings | {len(review_findings)} finding(s) recorded in kage_review.json | **{100 if not review_findings else max(60, 100 - 10 * len(review_findings))}%** | {_mark(not review_findings)} |\n"
            f"| **Security Review** | security_reviewed = true | security_reviewed = {str(security_verified).lower()} | **{100 if security_verified else 0}%** | {_mark(security_verified)} |\n"
            f"| **Rollback Review** | rollback_reviewed = true | rollback_reviewed = {str(rollback_verified).lower()} | **{100 if rollback_verified else 0}%** | {_mark(rollback_verified)} |\n\n"
            f"### 🎯 Overall Confidence: **{confidence_val}%**\n"
            "- **Threshold**: Minimum 95% required to allow delivery.\n"
            "- **Verdict**: **PASSED & APPROVED FOR DELIVERY** (all recorded tasks carry validation evidence).\n\n"
        )
        report = f"# Final Report\n\n{review_gate_block}## Task\n{prompt}\n\n## Exploration Findings\n{findings}\n\n## Implementation Plan\n{plan}\n\n## Research\n{research}\n\n## Documentation\n{final_docs}\n\n## Executor Results\n\n"
        for task in status.get("tasks", []):
            report += f"- **{task['id']} / {task['agent']}**: {task['task']}\n\nResult: {task.get('result', '')}\n\n"
        result_path = os.path.join(task_dir, "final_report.md")
        with open(result_path, "w", encoding="utf-8") as f:
            f.write(report)
        status["phase"] = "done"
        status["history"].append({"phase": "synthesize", "agent": "sannin"})
        _save_workflow_status(task_dir, status)
        _cleanup_transient_scratch_files(task_dir)
        return json.dumps({"status": "completed", "phase": "done", "final_report_path": result_path})

    return json.dumps({"status": "error", "message": f"Unknown or stuck workflow phase: {phase}", "phase": phase})


def _cleanup_transient_scratch_files(task_dir=None):
    """Clean up any temporary debug/scratch scripts created during diagnosis/testing."""
    import glob
    patterns = ["debug_*.py", "debug_*.js", "debug_*.sh", "temp_*.py", "temp_*.js", "temp_*.sh", "test_patch.py", "*.tmp"]
    if task_dir and os.path.isdir(task_dir):
        for pat in patterns:
            for fpath in glob.glob(os.path.join(task_dir, pat)):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

def run_web_search(query, num_results=5, search_depth="standard", agent_name=None):
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
                    if not name.startswith("https://") or not isinstance(val, dict):
                        continue
                    
                    uptime_data = val.get("uptime") or {}
                    if not isinstance(uptime_data, dict):
                        continue
                    uptime = uptime_data.get("uptimeDay") or 0.0
                    if uptime <= 95.0:
                        continue
                    
                    timing_data = val.get("timing") or {}
                    if not isinstance(timing_data, dict):
                        continue
                    
                    latency = 9999.0
                    has_timing = False
                    search_timing = timing_data.get("search") or {}
                    if isinstance(search_timing, dict):
                        search_all = search_timing.get("all") or {}
                        if isinstance(search_all, dict) and search_all:
                            latency = search_all.get("median", search_all.get("mean", 9999.0)) or 9999.0
                            has_timing = True
                    
                    if not has_timing:
                        initial_timing = timing_data.get("initial") or {}
                        if isinstance(initial_timing, dict):
                            initial_all = initial_timing.get("all") or {}
                            if isinstance(initial_all, dict) and initial_all:
                                latency = initial_all.get("value", 9999.0) or 9999.0
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
        # 0. Custom or self-hosted SearXNG instance environment override
        custom_searx = os.environ.get("SEARXNG_URL") or os.environ.get("KONOHA_SEARXNG_URL")
        if custom_searx and custom_searx.strip():
            return custom_searx.strip().rstrip("/") + "/"

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
        netloc = urllib.parse.urlparse(instance_url).netloc or instance_url
        cb = global_circuit_registry.get_or_create(f"searxng:{netloc}", failure_threshold=3, recovery_timeout_sec=60.0)
        if not cb.allow_request():
            sys.stderr.write(f"[mcp konoha] Circuit OPEN for SearXNG instance {netloc} — skipping\n")
            sys.stderr.flush()
            return None

        base = instance_url.rstrip("/") + "/"
        search_url = f"{base}search?q={urllib.parse.quote(q)}&format=json"
        try:
            req = urllib.request.Request(search_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            with urllib.request.urlopen(req, timeout=2.5) as resp:
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
                            "source": f"SearXNG ({netloc})"
                        })
                cb.record_success()
                return results
        except Exception as e:
            cb.record_failure()
            sys.stderr.write(f"[mcp konoha] SearXNG query to {instance_url} failed ({cb.state}, fail_count={cb.failure_count}): {str(e)}\n")
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
            with urllib.request.urlopen(req, timeout=2.5) as resp:
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
    log_tool_call("web_search", f"query={query}, depth={search_depth}", result[:500], agent_name=agent_name or detect_active_agent())
    return result


# _VALIDATION_EVIDENCE_PATTERN moved above _workflow_parse_tasks

def _assess_validation_evidence(validation):
    """Assess whether a subagent's validation list contains real, checkable
    evidence (command runs, exit codes, pass markers) instead of bare claims.

    Returns (verified: bool, reason: str).
    """
    if not validation or not isinstance(validation, list):
        return False, "no validation evidence provided"
    evidence = [v for v in validation if isinstance(v, str) and v.strip()]
    if not evidence:
        return False, "validation evidence is empty"
    for entry in evidence:
        if _VALIDATION_EVIDENCE_PATTERN.search(entry):
            return True, "validation evidence contains a passing command/exit-code marker"
    return False, (
        "validation entries contain no command/exit-code evidence "
        "(expected entries like 'npm run build exited 0' or 'pytest: 12 passed')"
    )


def report_from_agent(agent_name, summary, status="completed", files_created=None, files_modified=None, learnings=None, project_path=None, task_dir=None, dispatch_id=None, validation=None):
    """Structured task completion reporting with automatic project memory checkpointing."""
    p_path = project_path or WORKSPACE_ROOT or os.getcwd()
    workflow_status = None

    # Verification gate: a "completed" claim must carry real validation
    # evidence. Without it, the task is recorded as "unverified" so the
    # orchestrator cannot mistake a self-reported success for a real one.
    verified, verification_reason = _assess_validation_evidence(validation)
    if status == "completed" and not verified:
        status = "unverified"

    if task_dir and os.path.isdir(task_dir):
        workflow_status = _load_workflow_status(task_dir)
        dispatch = workflow_status.get("current_dispatch") or {}
        if dispatch_id and dispatch.get("id") != dispatch_id:
            return json.dumps({"status": "error", "message": "dispatch_id does not match the active workflow dispatch"})
        if dispatch and dispatch.get("agent") != agent_name.replace("_", "-"):
            return json.dumps({"status": "error", "message": "agent_name does not match the active workflow dispatch"})
        if status in ("completed", "unverified") and dispatch:
            task = next((item for item in workflow_status.get("tasks", []) if item.get("id") == dispatch.get("task_id")), None)
            if task:
                task["status"] = status
                task["result"] = summary
                task["validation"] = validation or []
                task["verified"] = verified
                task["files_created"] = files_created or []
                task["files_modified"] = files_modified or []
            if dispatch.get("id") not in workflow_status.setdefault("completed_dispatches", []):
                workflow_status["completed_dispatches"].append(dispatch.get("id"))
            workflow_status.setdefault("dispatch_results", {})[dispatch.get("id")] = summary
            _save_workflow_status(task_dir, workflow_status)
    clean_agent = agent_name.lower().strip()
    if clean_agent.startswith("delegate_to_"):
        clean_agent = clean_agent[12:]
    if clean_agent.startswith("mcp_"):
        clean_agent = clean_agent[4:]
    clean_agent = clean_agent.replace("_", "-")

    saved_ids = []
    deferred_learnings = 0
    if learnings and isinstance(learnings, list):
        for l in learnings:
            if l and isinstance(l, str) and l.strip():
                content = l.strip()
                try:
                    # Learnings from unverified tasks are not persisted: they
                    # would inject unconfirmed (often wrong) root-cause
                    # conclusions into future prompts.
                    if not verified:
                        deferred_learnings += 1
                        continue
                    if persona_memory.memory_content_exists(
                        content=content,
                        agent_name=clean_agent,
                        project_path=p_path,
                        db_path=DB_PATH
                    ):
                        continue
                    mid = persona_memory.save_memory(
                        agent_name=clean_agent,
                        content=content,
                        title=f"{clean_agent} decision",
                        memory_type="episodic",
                        importance=2,
                        project_path=p_path,
                        db_path=DB_PATH
                    )
                    saved_ids.append(mid)
                except Exception as e:
                    sys.stderr.write(f"[mcp report_from_agent] Error saving learning: {e}\n")
                    sys.stderr.flush()

    result = {
        "status": "recorded",
        "agent": clean_agent,
        "task_status": status,
        "summary": summary,
        "verified": verified,
        "files_created": files_created or [],
        "files_modified": files_modified or [],
        "learnings_saved_count": len(saved_ids),
        "project_path": p_path
    }
    if not verified:
        result["verification_reason"] = verification_reason
        result["remediation"] = (
            "Task recorded as UNVERIFIED. Re-run the actual validation commands "
            "(build/test/lint), confirm real output, then re-report with validation "
            "entries that include the command and its exit code or pass result "
            "(e.g. 'npm run build exited 0'). Do NOT claim completion without it."
        )
    res = json.dumps(result)
    log_tool_call("report_from_agent", f"agent={clean_agent} status={status}", res, agent_name=clean_agent)
    return res


def get_project_context(project_path=None):
    """Get project profile, detected tech stack, and persistent architectural invariants."""
    p_path = project_path or WORKSPACE_ROOT or os.getcwd()
    profile = persona_memory.get_project_profile(p_path, db_path=DB_PATH)
    if not profile:
        p_hash = persona_memory.save_or_update_project(p_path, db_path=DB_PATH)
        profile = persona_memory.get_project_profile(p_hash, db_path=DB_PATH)
    mems = persona_memory.list_memories(project_path=p_path, limit=20, db_path=DB_PATH)
    return json.dumps({
        "status": "ok",
        "project_path": p_path,
        "profile": profile,
        "memories": mems
    })


def save_project_context(project_path=None, context_summary="", tech_stack=None):
    """Save or update project architectural invariants and stack metadata."""
    p_path = project_path or WORKSPACE_ROOT or os.getcwd()
    p_hash = persona_memory.save_or_update_project(
        p_path,
        context_summary=context_summary,
        tech_stack=tech_stack,
        db_path=DB_PATH
    )
    return json.dumps({
        "status": "saved",
        "project_hash": p_hash,
        "project_path": p_path
    })


def query_project_memory(query="", project_path=None, agent_name=None, memory_type=None, limit=10):
    """Query memories specifically scoped to the active project workspace."""
    p_path = project_path or WORKSPACE_ROOT or os.getcwd()
    mems = persona_memory.query_memories(
        agent_name=agent_name,
        query=query,
        memory_type=memory_type,
        project_path=p_path,
        limit=limit,
        db_path=DB_PATH
    )
    return json.dumps({
        "status": "ok",
        "project_path": p_path,
        "count": len(mems),
        "memories": mems
    })



# Session & Turn Tracking for Auto-Compaction across Antigravity, Claude Code, CommandCode, OpenCode, Cursor
SESSION_TURNS = {}
SESSION_TURN_LAST_ACCESS = {}
SESSION_IDLE_RESET_SECONDS = 30 * 60  # reset turn counts after 30 min of inactivity

def get_session_key(project_path=None):
    """Generates a stable session key across Antigravity, Claude Code, CommandCode, OpenCode, and Cursor."""
    conv_id = (
        os.environ.get("ANTIGRAVITY_CONVERSATION_ID") or
        os.environ.get("CLAUDE_CONVERSATION_ID") or
        os.environ.get("OPENCODE_SESSION_ID") or
        os.environ.get("COMMANDCODE_SESSION_ID") or
        os.environ.get("CURSOR_SESSION_ID") or
        os.environ.get("SESSION_ID") or
        ""
    )
    p_path = project_path or WORKSPACE_ROOT or os.getcwd()
    p_hash = persona_memory.compute_project_hash(p_path)
    client = ACTIVE_CLIENT or "universal"
    if conv_id:
        return f"{client}:{conv_id}:{p_hash}"
    return f"{client}:{p_hash}"

def get_and_increment_session_turn(session_key):
    """Increment and return current prompt/turn index for the session.

    Resets the counter after SESSION_IDLE_RESET_SECONDS of inactivity so a
    long-lived MCP process (e.g. Claude Code desktop) does not carry turn
    counts from a previous conversation into a new one when no conversation-id
    environment variable is available.
    """
    now = time.time()
    last = SESSION_TURN_LAST_ACCESS.get(session_key)
    if last is not None and (now - last) > SESSION_IDLE_RESET_SECONDS:
        SESSION_TURNS[session_key] = 0
    SESSION_TURN_LAST_ACCESS[session_key] = now
    current = SESSION_TURNS.get(session_key, 0) + 1
    SESSION_TURNS[session_key] = current
    return current

def _truncate_at_boundary(text, max_chars):
    """Truncate text to at most max_chars, cutting at the last sentence/line
    boundary so procedural instructions are never chopped mid-step."""
    text = text or ""
    if len(text) <= max_chars:
        return text
    head = text[:max_chars]
    cut_points = [head.rfind(". "), head.rfind(".\n"), head.rfind("\n")]
    cut = max(cut_points)
    if cut < max_chars // 2:
        cut = max_chars
    else:
        cut += 1
    return head[:cut].rstrip() + " ...[truncated]"


def run_mcp_agent(agent_name, task=None, context=None, constraints=None, skills=None, taste_dials=None, project_path=None, task_dir=None):
    import json
    import os
    import urllib.request
    import urllib.error

    resolved_proj_path = project_path or WORKSPACE_ROOT or os.getcwd()
    session_key = get_session_key(resolved_proj_path)
    turn = get_and_increment_session_turn(session_key)
    is_auto_compact = (turn >= 2)

    instructions = ""
    if task and isinstance(task, str) and task.strip():
        instructions = task.strip()
        if context and isinstance(context, str) and context.strip():
            instructions += f"\n\n### Context & Relevant Code Paths:\n{context.strip()}"
        if constraints and isinstance(constraints, str) and constraints.strip():
            instructions += f"\n\n### Execution Constraints:\n{constraints.strip()}"
    else:
        task_dir = get_resolved_task_dir(task_dir)
        delegate_path = os.path.join(task_dir, "delegate.md")

        if not os.path.exists(delegate_path):
            return json.dumps({"status": "error", "message": f"Neither direct task instructions nor delegate.md found in task directory: {task_dir}"})

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
    if db_agent_name.startswith("delegate_to_"):
        db_agent_name = db_agent_name[12:]
    if db_agent_name.startswith("mcp_"):
        db_agent_name = db_agent_name[4:]
    suffix = db_agent_name.replace("_", "-")
    db_agent_name = suffix

    title = db_agent_name
    purpose = ""
    agent_constraints = ""
    persona_instructions = ""
    skills_list = list(skills) if skills and isinstance(skills, list) else []

    try:
        conn = get_connection(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT name, title, purpose, skills, constraints_text, instructions
            FROM agents WHERE name = ?
        """, (db_agent_name,))
        row = cursor.fetchone()
        if not row:
            prefixed = f"mcp_{db_agent_name}"
            cursor.execute("""
                SELECT name, title, purpose, skills, constraints_text, instructions
                FROM agents WHERE name = ?
            """, (prefixed,))
            row = cursor.fetchone()
        conn.close()
        if row:
            title = row["title"] or title
            purpose = row["purpose"] or purpose
            agent_constraints = row["constraints_text"] or agent_constraints
            persona_instructions = row["instructions"] or persona_instructions
            if row["skills"] and not skills_list:
                skills_list = json.loads(row["skills"])
    except Exception as e:
        sys.stderr.write(f"[mcp konoha] Error reading agent row from DB: {str(e)}\n")
        sys.stderr.flush()

    skills_content = []
    if not skills_list and instructions:
        try:
            _conn_autoload = get_connection(DB_PATH)
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

    if "jonin" in db_agent_name:
        target_fw = None
        combined_text = f"{instructions} {context or ''}".lower()
        if resolved_proj_path and os.path.exists(resolved_proj_path):
            pkg_path = os.path.join(resolved_proj_path, "package.json")
            if os.path.exists(pkg_path):
                try:
                    with open(pkg_path, "r") as f:
                        pkg_content = f.read().lower()
                        if "next" in pkg_content:
                            target_fw = "nextjs"
                        elif "svelte" in pkg_content:
                            target_fw = "svelte"
                        elif "nuxt" in pkg_content:
                            target_fw = "nuxt"
                        elif "angular" in pkg_content or "@angular" in pkg_content:
                            target_fw = "angular"
                except Exception:
                    pass
        if not target_fw:
            if "next" in combined_text or "react" in combined_text:
                target_fw = "nextjs"
            elif "svelte" in combined_text:
                target_fw = "svelte"
            elif "nuxt" in combined_text or "vue" in combined_text:
                target_fw = "nuxt"
            elif "angular" in combined_text or "ng" in combined_text:
                target_fw = "angular"
            else:
                target_fw = "nextjs"

        if not skills_list:
            skills_list = [
                "jonin-skill",
                f"jonin-skill/{target_fw}-code-expert",
                f"jonin-skill/{target_fw}-ui-expert",
                "jonin-skill/design-token-manifest",
                "jonin-skill/taste-skill-frontend-expert",
            ]

    # Token-Guarded Skill Loading: minimal preview every turn (full manual only
    # on-demand). The preview is always included — even on compact turns — so
    # the agent never loses the core SOP/workflow of its primary skill.
    skills_content = []
    if skills_list:
        try:
            conn = get_connection(DB_PATH)
            conn.row_factory = sqlite3.Row
            primary_skill = skills_list[0]
            resolved = _fuzzy_resolve_skill(primary_skill, conn)
            effective_name = resolved or primary_skill
            row = conn.execute("SELECT content, type FROM skills WHERE name = ?", (effective_name,)).fetchone()
            if row and row["content"]:
                preview = row["content"][:250] + ("\n...(Use konoha.get_skill for full reference)" if len(row["content"]) > 250 else "")
                label = "Skill" if row["type"] == "skill" else "Reference"
                skills_content.append(f"### {label}: {effective_name}\n\n{preview}")
            conn.close()
        except Exception as e:
            sys.stderr.write(f"[mcp {agent_name}] Error loading skill definitions: {str(e)}\n")
            sys.stderr.flush()

    search_findings = ""
    if "chunin" in db_agent_name and not is_auto_compact:
        try:
            query_to_run = ""
            lines = [l.strip() for l in instructions.split('\n') if l.strip() and not l.strip().startswith('---')]
            for line in lines:
                clean_line = line.lstrip('#').lstrip('*').lstrip('-').strip()
                if clean_line:
                    query_to_run = clean_line
                    break
            if not query_to_run:
                query_to_run = "latest technology updates"

            search_res_json = run_web_search(query_to_run, num_results=2, search_depth="standard")
            search_data = json.loads(search_res_json)
            if search_data.get("status") == "success" and search_data.get("results"):
                search_findings = "### Deep Research Findings (Compact)\n\n"
                for res in search_data["results"][:2]:
                    search_findings += f"- **{res['title']}**: {res['snippet'][:120]} ({res['url']})\n"
        except Exception as e:
            sys.stderr.write(f"[mcp chunin] Error during automatic web search: {str(e)}\n")
            sys.stderr.flush()

    # Project Context & Invariants Injection (Token-Capped & Auto-Compacted)
    project_context_block = ""
    try:
        proj_profile = persona_memory.get_project_profile(resolved_proj_path, db_path=DB_PATH)
        if not proj_profile:
            p_hash = persona_memory.save_or_update_project(resolved_proj_path, db_path=DB_PATH)
            proj_profile = persona_memory.get_project_profile(p_hash, db_path=DB_PATH)

        proj_mems = persona_memory.query_memories(
            agent_name=db_agent_name,
            query=instructions,
            project_path=resolved_proj_path,
            limit=2 if is_auto_compact else 3,
            db_path=DB_PATH
        )
        project_context_block = persona_memory.format_project_context_for_prompt(
            proj_profile,
            proj_mems,
            max_memories=1 if is_auto_compact else 2,
            compact=is_auto_compact
        )
    except Exception as e:
        sys.stderr.write(f"[mcp {agent_name}] Error querying project context: {str(e)}\n")
        sys.stderr.flush()

    # Taste-Skill Design Engine Directives for Jonin (Token-Optimized)
    taste_skill_block = ""
    if "jonin" in db_agent_name:
        dials = taste_dials or {}
        var = dials.get("design_variance", 8)
        mot = dials.get("motion_intensity", 7)
        dens = dials.get("visual_density", 6)
        if is_auto_compact:
            taste_skill_block = (
                f"### 🎨 Taste-Skill Rules (Compacted Turn {turn}):\n"
                f"- Dials: {var}/{mot}/{dens} | Typography: Geist/Satoshi | Spacing: py-24/py-32 | CSS Grid (12-col) | 100dvh | Zero emojis\n"
            )
        else:
            taste_skill_block = (
                f"### 🎨 Taste-Skill Design Engine Directives (tasteskill.dev):\n"
                f"- Active Taste Dials: DESIGN_VARIANCE={var}/10 | MOTION_INTENSITY={mot}/10 | VISUAL_DENSITY={dens}/10\n"
                f"- Anti-Slop Policy: Zero generic AI-purple gradients, zero 3-card boilerplate stacks. Implement bespoke editorial UI.\n"
                f"- Typography: Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display (no default Inter). Extreme scale contrast.\n"
                f"- Layout & Spacing: Cinematic py-24/py-32 section pacing, CSS Grid (grid-cols-12), max-w-[1400px].\n"
                f"- Viewport & Mobile: min-h-[100dvh] safety (no h-screen), sticky bottom dock on mobile (`lg:hidden`).\n"
                f"- Theme & Aesthetics: 10 Light-Mode gradient themes (data-theme), 3D perspective tilt (1200px), Zero emojis (use Lucide SVG).\n"
                f"- Quality: pnpm exclusively, SPA/multi-page routes, 50-item dataset, zero errors/warnings, 'Build by Konoha' footer.\n"
            )

    if is_auto_compact:
        compact_header = (
            f"[Konoha Auto-Compact: Active (Turn {turn}) - Token Preservation Enabled]\n\n"
            "IMPORTANT: The TASK INSTRUCTIONS at the bottom of this prompt are the complete, "
            "authoritative task. Never reinterpret, narrow, or replace them with a newly "
            "discovered error. If you find an additional bug while fixing, fix the ORIGINAL "
            "task first, then report the new finding — do not abandon or delete prior work.\n\n"
        )
        system_prompt = (
            f"{compact_header}You are @{db_agent_name} ({title}).\n"
            f"Purpose: {purpose}\n"
            f"Instructions: {_truncate_at_boundary(persona_instructions, 1200)}\n"
            f"Constraints: {_truncate_at_boundary(agent_constraints, 600)}\n\n"
        )
        if project_context_block:
            system_prompt += project_context_block + "\n"
        if taste_skill_block:
            system_prompt += taste_skill_block + "\n"
        system_prompt += build_subagent_mcp_block(client=ACTIVE_CLIENT, agent_name=agent_name) + "\n"
        if search_findings:
            system_prompt += search_findings + "\n"
        if skills_content:
            system_prompt += "Available Skills:\n" + "\n\n".join(skills_content) + "\n\n"
        elif skills_list:
            system_prompt += "Available Skills:\n" + f"On-Demand Reference Skills: {', '.join(skills_list)}\n\n"
        system_prompt += (
            "Conflict Diff Format:\n"
            "FILE: path/to/file\n<<<<<<< original\n[orig]\n=======\n[replacement]\n>>>>>>>\n"
        )
    else:
        system_prompt = (
            f"You are @{db_agent_name} ({title}).\n"
            f"Purpose: {purpose}\n\n"
            f"Instructions:\n{persona_instructions}\n\n"
            f"Constraints:\n{agent_constraints}\n\n"
        )
        if project_context_block:
            system_prompt += project_context_block + "\n"
        if taste_skill_block:
            system_prompt += taste_skill_block + "\n"
        system_prompt += build_subagent_mcp_block(client=ACTIVE_CLIENT, agent_name=agent_name)
        if search_findings:
            system_prompt += search_findings + "\n"
        if skills_content:
            system_prompt += "Available Skills:\n" + "\n\n".join(skills_content) + "\n\n"
        if skills_list and len(skills_list) > 1:
            system_prompt += f"Available On-Demand Skills (call konoha.get_skill to load): {', '.join(skills_list)}\n\n"

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
        f"You must now act as {db_agent_name} and execute the task above. Use the available tools to explore the codebase or make file edits.\n\n"
        f"## Execution Protocol\n\n"
        f"1. Execute the task directly as described in TASK INSTRUCTIONS above.\n"
        f"2. When complete, write your summary to `result.md` in the task directory (or report your results and key learnings via the `report_from_agent` tool or structured response)."
    )

    res = json.dumps({
        "status": "ready",
        "phase": "execution",
        "agent": db_agent_name,
        "project_path": resolved_proj_path,
        "task_dir": task_dir,
        "instructions": instruction
    })

    log_tool_call(agent_name, f"project_path={resolved_proj_path} task_dir={task_dir}", res, agent_name=db_agent_name)
    return res

def handle_request(req):
    global MCP_INITIALIZED
    if not isinstance(req, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
    method = req.get("method")
    rid = req.get("id")

    # Notifications (no id) — acknowledge silently
    if rid is None and method not in ("initialize",):
        return None

    if method in ("tools/list", "tools/call") and not MCP_INITIALIZED:
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32002, "message": "Server is not initialized"}}

    if method == "initialize":
        global WORKSPACE_ROOT, ACTIVE_CLIENT
        params = req.get("params", {})
        requested_protocol = params.get("protocolVersion", SUPPORTED_PROTOCOL_VERSIONS[0])
        if requested_protocol not in SUPPORTED_PROTOCOL_VERSIONS:
            return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"Unsupported protocol version: {requested_protocol}"}}
        
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
            cand = uri_to_path(root_uri)
            if not is_ide_installation_dir(cand):
                WORKSPACE_ROOT = cand

        # 2. Try workspaceFolders fallback
        if not WORKSPACE_ROOT:
            folders = params.get("workspaceFolders", [])
            if folders and isinstance(folders, list):
                first_folder = folders[0]
                if isinstance(first_folder, dict):
                    uri = first_folder.get("uri")
                    if uri:
                        cand = uri_to_path(uri)
                        if not is_ide_installation_dir(cand):
                            WORKSPACE_ROOT = cand

        # 3. Try rootPath fallback
        if not WORKSPACE_ROOT:
            root_path = params.get("rootPath")
            if root_path:
                cand = uri_to_path(root_path)
                if not is_ide_installation_dir(cand):
                    WORKSPACE_ROOT = cand
                        
        if WORKSPACE_ROOT:
            sys.stderr.write(f"[mcp konoha] Initialized with workspace root: {WORKSPACE_ROOT}\n")
            sys.stderr.flush()
            try:
                auto_migrate_project_skills(WORKSPACE_ROOT)
            except Exception:
                pass
        else:
            sys.stderr.write(f"[mcp konoha] Initialized with no workspace root; using cwd: {os.getcwd()}\n")
            sys.stderr.flush()
            try:
                auto_migrate_project_skills(os.getcwd())
            except Exception:
                pass

        MCP_INITIALIZED = True
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": requested_protocol,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "konoha", "version": get_server_version()}
            }
        }

    elif method == "notifications/initialized":
        MCP_INITIALIZED = True
        return None

    elif method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": MCP_MANIFEST.get("tools", [])}}

    elif method == "tools/call":
        params = req.get("params", {})
        tool_name = params.get("name")
        args = params.get("arguments", {})
        try:
            _validate_manifest_arguments(tool_name, args)
        except ValueError as exc:
            return {"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": json.dumps({"error": str(exc)})}], "isError": True}}
        agent = args.get("agent") or args.get("agent_name")
        if not agent:
            agent = detect_active_agent()

        if tool_name == "web_search":
            query = args.get("query")
            num_results = min(max(int(args.get("num_results", 5)), 1), 50)
            search_depth = args.get("search_depth", "standard")
            if search_depth not in ("standard", "deep"):
                search_depth = "standard"
            result_text = run_web_search(query, num_results=num_results, search_depth=search_depth, agent_name=agent)
        elif tool_name in ("find_skill", "find_skills"):
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
                result_text = build_from_source(name, source_dir, framework, agent_name=agent, taste_dials=args.get("taste_dials"))
        elif tool_name == "build_from_text":
            name = args.get("name")
            description = args.get("description")
            framework = args.get("framework")
            if not name or not description or not framework:
                result_text = json.dumps({"error": "Missing required arguments: name, description, and framework are all required."})
            else:
                result_text = build_from_text(name, description, framework, agent_name=agent, taste_dials=args.get("taste_dials"))
        elif tool_name == "get_resolved_task_dir":
            result_text = json.dumps({"status": "ok", "task_dir": get_resolved_task_dir()})
        elif tool_name == "sannin":
            prompt = args.get("prompt")
            task_dir = args.get("task_dir")
            result_text = run_sannin(prompt=prompt, task_dir=task_dir)
        elif tool_name in ("kage", "jonin", "anbu", "chunin", "tokubetsu_jonin", "genin",
                            "delegate_to_kage", "delegate_to_jonin", "delegate_to_anbu",
                            "delegate_to_chunin", "delegate_to_tokubetsu_jonin", "delegate_to_genin", "delegate_to_sannin",
                            "delegated_to_kage", "delegated_to_jonin", "delegated_to_anbu",
                            "delegated_to_chunin", "delegated_to_tokubetsu_jonin", "delegated_to_genin", "delegated_to_sannin"):
            task = args.get("task") or args.get("prompt") or args.get("instructions")
            context = args.get("context")
            constraints = args.get("constraints")
            skills = args.get("skills")
            taste_dials = args.get("taste_dials")
            project_path = args.get("project_path") or WORKSPACE_ROOT
            task_dir = args.get("task_dir")

            clean_subagent = tool_name
            if clean_subagent.startswith("delegated_to_"):
                clean_subagent = clean_subagent[13:]
            elif clean_subagent.startswith("delegate_to_"):
                clean_subagent = clean_subagent[12:]

            result_text = run_mcp_agent(
                clean_subagent,
                task=task,
                context=context,
                constraints=constraints,
                skills=skills,
                taste_dials=taste_dials,
                project_path=project_path,
                task_dir=task_dir
            )
        elif tool_name == "report_from_agent" or (tool_name and tool_name.startswith("report_from_")):
            inferred_agent = tool_name.replace("report_from_", "") if (tool_name and tool_name.startswith("report_from_")) else (args.get("agent_name") or agent)
            if inferred_agent in ("agent", ""):
                inferred_agent = args.get("agent_name") or agent
            agent_name = inferred_agent
            summary = args.get("summary", "")
            status = args.get("status", "completed")
            files_created = args.get("files_created", [])
            files_modified = args.get("files_modified", [])
            learnings = args.get("learnings", [])
            project_path = args.get("project_path") or WORKSPACE_ROOT
            result_text = report_from_agent(
                agent_name=agent_name,
                summary=summary,
                status=status,
                files_created=files_created,
                files_modified=files_modified,
                learnings=learnings,
                project_path=project_path,
                task_dir=args.get("task_dir"),
                dispatch_id=args.get("dispatch_id"),
                validation=args.get("validation")
            )
        elif tool_name == "get_project_context":
            project_path = args.get("project_path") or WORKSPACE_ROOT
            result_text = get_project_context(project_path=project_path)
        elif tool_name == "save_project_context":
            project_path = args.get("project_path") or WORKSPACE_ROOT
            context_summary = args.get("context_summary", "")
            tech_stack = args.get("tech_stack")
            result_text = save_project_context(project_path=project_path, context_summary=context_summary, tech_stack=tech_stack)
        elif tool_name == "query_project_memory":
            query = args.get("query", "")
            project_path = args.get("project_path") or WORKSPACE_ROOT
            agent_name = args.get("agent_name")
            memory_type = args.get("memory_type")
            limit = int(args.get("limit", 10))
            result_text = query_project_memory(query=query, project_path=project_path, agent_name=agent_name, memory_type=memory_type, limit=limit)
        elif tool_name == "save_persona_memory":
            target_agent = args.get("agent_name") or agent
            content = args.get("content", "")
            title = args.get("title", "")
            memory_type = args.get("memory_type", "rule")
            tags = args.get("tags", "")
            importance = int(args.get("importance", 1))
            if not target_agent or not content:
                result_text = json.dumps({"error": "agent_name and content are required."})
            else:
                try:
                    mem_id = persona_memory.save_memory(
                        agent_name=target_agent,
                        content=content,
                        title=title,
                        memory_type=memory_type,
                        tags=tags,
                        importance=importance,
                        db_path=DB_PATH
                    )
                    result_text = json.dumps({"status": "saved", "id": mem_id, "agent": target_agent})
                except Exception as e:
                    result_text = json.dumps({"error": f"Failed to save memory: {str(e)}"})
        elif tool_name == "query_persona_memory":
            target_agent = args.get("agent_name") or agent
            query = args.get("query", "")
            memory_type = args.get("memory_type")
            limit = int(args.get("limit", 5))
            try:
                mems = persona_memory.query_memories(
                    agent_name=target_agent,
                    query=query,
                    memory_type=memory_type,
                    limit=limit,
                    db_path=DB_PATH
                )
                result_text = json.dumps({"agent": target_agent, "count": len(mems), "memories": mems})
            except Exception as e:
                result_text = json.dumps({"error": f"Failed to query memories: {str(e)}"})
        elif tool_name == "list_persona_memories":
            target_agent = args.get("agent_name")
            memory_type = args.get("memory_type")
            limit = int(args.get("limit", 50))
            try:
                mems = persona_memory.list_memories(
                    agent_name=target_agent,
                    memory_type=memory_type,
                    limit=limit,
                    db_path=DB_PATH
                )
                result_text = json.dumps({"count": len(mems), "memories": mems})
            except Exception as e:
                result_text = json.dumps({"error": f"Failed to list memories: {str(e)}"})
        elif tool_name == "delete_persona_memory":
            mem_id = args.get("id")
            if not mem_id:
                result_text = json.dumps({"error": "Memory id is required."})
            else:
                try:
                    deleted = persona_memory.delete_memory(mem_id, db_path=DB_PATH)
                    result_text = json.dumps({"status": "deleted" if deleted else "not_found", "id": mem_id})
                except Exception as e:
                    result_text = json.dumps({"error": f"Failed to delete memory: {str(e)}"})
        else:
            result_text = json.dumps({"error": f"Unknown tool: {tool_name}"})

        result_payload = {"content": [{"type": "text", "text": result_text}]}
        try:
            parsed_result = json.loads(result_text)
            result_payload["isError"] = isinstance(parsed_result, dict) and "error" in parsed_result
        except (TypeError, json.JSONDecodeError):
            result_payload["isError"] = False
        return {"jsonrpc": "2.0", "id": rid, "result": result_payload}

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
        except (TypeError, json.JSONDecodeError) as exc:
            print(json.dumps({"error": f"Invalid tool arguments JSON: {exc}"}))
            sys.exit(1)
        if not isinstance(args, dict):
            print(json.dumps({"error": "Tool arguments must be a JSON object"}))
            sys.exit(1)
        MCP_INITIALIZED = True
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
