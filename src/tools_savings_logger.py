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

HOME = os.path.expanduser("~")
DB_PATH = os.path.join(HOME, ".konoha", "skills.db")

DEFAULT_BASELINE = 550000  # ~140k tokens — matches server.py fallback


def log(tool: str, query: str, returned_bytes: int) -> None:
    """Insert a single tool_calls row.

    baseline = sum of all skill byte sizes (proxy for "library would have
    been loaded"). Saving = baseline - returned_bytes. Always writes the
    actual returned_bytes so the dashboard shows real numbers, not zeros.
    """
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
                bytes_saved, tokens_saved)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (tool[:200], query[:2000], returned_bytes,
             baseline, bytes_saved, tokens_saved),
        )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write(
            "usage: tools_savings_logger.py <tool> <query> <returned_bytes>\n"
        )
        sys.exit(1)
    try:
        log(sys.argv[1], sys.argv[2], int(sys.argv[3]))
    except Exception as exc:
        # Never crash the caller — the router wraps us in try/ignore.
        sys.stderr.write(f"[tools_savings_logger] {exc}\n")
        sys.exit(0)
