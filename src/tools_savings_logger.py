#!/usr/bin/env python3
"""Lightweight tool-call logger for non-server tool paths (file router, file_tools_mcp.js).

Inserts a row into the `tool_calls` table inside the same SQLite database the
konoha MCP server writes to. The DB lives at ~/.konoha/skills.db.

Usage:
    python3 tools_savings_logger.py <tool_name> <query_json> <returned_bytes>
"""
import sys
import os
import sqlite3
import glob

HOME = os.path.expanduser("~")
DB_PATH = os.path.join(HOME, ".konoha", "skills.db")

DEFAULT_BASELINE = 550000  # ~140k tokens — matches server.py fallback

# Path constants matching server.py for client detection
ANTIGRAVITY_CLI_BRAIN = os.path.join(HOME, ".gemini", "antigravity-cli", "brain")
ANTIGRAVITY_IDE_BRAIN = os.path.join(HOME, ".gemini", "antigravity-ide", "brain")
CURSOR_PROJECTS = os.path.join(HOME, ".cursor", "projects")
CLAUDE_PROJECTS = os.path.join(HOME, ".claude", "projects")


def detect_active_client():
    """Detect which MCP client invoked this tool (mimics server.py logic)."""
    try:
        # Check environment variable first to distinguish CLI (agy) vs IDE (antigravity)
        conv_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID")
        if conv_id:
            cli_dir = os.path.join(ANTIGRAVITY_CLI_BRAIN, conv_id)
            if os.path.isdir(cli_dir):
                return "agy"
            ide_dir = os.path.join(ANTIGRAVITY_IDE_BRAIN, conv_id)
            if os.path.isdir(ide_dir):
                return "antigravity"

        if os.environ.get("OPENCODE_CLIENT") == "1" or os.environ.get("OPENCODE_SESSION") == "1":
            return "opencode"

        if os.environ.get("COMMANDCODE_CLIENT") == "1" or os.environ.get("COMMANDCODE_SESSION") == "1":
            return "commandcode"

        if os.environ.get("CLAUDE_CODE_CHILD_SESSION") == "1":
            return "claudecode"

        if conv_id:
            return "antigravity"

        brain_dirs = [
            ANTIGRAVITY_IDE_BRAIN,
            ANTIGRAVITY_CLI_BRAIN,
            CURSOR_PROJECTS,
            CLAUDE_PROJECTS,
        ]
        COMMANDCODE_PROJECTS = os.path.join(HOME, ".commandcode", "projects")
        if os.path.isdir(COMMANDCODE_PROJECTS):
            brain_dirs.append(COMMANDCODE_PROJECTS)

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
        elif "commandcode" in most_recent.lower():
            return "commandcode"
        elif "claudecode" in most_recent.lower() or "claude" in most_recent.lower():
            return "claudecode"
        elif "antigravity-cli" in most_recent:
            return "agy"
        else:
            return "antigravity"
    except Exception:
        pass
    return "antigravity"


def log(tool: str, query: str, returned_bytes: int, client: str = None) -> None:
    """Insert a single tool_calls row.

    baseline = sum of all skill byte sizes (proxy for "library would have
    been loaded"). Saving = baseline - returned_bytes. Always writes the
    actual returned_bytes so the dashboard shows real numbers, not zeros.
    """
    if client is None:
        client = detect_active_client()

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        baseline = DEFAULT_BASELINE
        try:
            row = cur.execute("SELECT SUM(byte_size) FROM skills").fetchone()
            if row and row[0]:
                baseline = int(row[0])
        except Exception:
            pass

        bytes_saved = max(baseline - returned_bytes, 0)
        tokens_saved = bytes_saved // 4

        cur.execute(
            """INSERT INTO tool_calls
               (tool, query, returned_bytes, total_library_bytes,
                bytes_saved, tokens_saved, client)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (tool[:200], query[:2000], returned_bytes,
             baseline, bytes_saved, tokens_saved, client),
        )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write(
            "usage: tools_savings_logger.py <tool> <query> <returned_bytes> [client]\n"
        )
        sys.exit(1)
    try:
        client = sys.argv[4] if len(sys.argv) > 4 else None
        log(sys.argv[1], sys.argv[2], int(sys.argv[3]), client)
    except Exception as exc:
        # Never crash the caller — the router wraps us in try/ignore.
        sys.stderr.write(f"[tools_savings_logger] {exc}\n")
        sys.exit(0)
