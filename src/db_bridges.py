#!/usr/bin/env python3
"""
Bridge storage management for Konoha via SQLite (skills.db).
Replaces legacy bridges.json storage with SQLite persistence.
"""

import sys
import os
import json
import sqlite3
from urllib.parse import urlparse

DB_PATH = os.path.expanduser("~/.konoha/skills.db")
BRIDGES_JSON_PATH = os.path.expanduser("~/.konoha/bridges.json")

DEFAULT_BRIDGES = []
EXTERNAL_ANTIGRAVITY_PROVIDER = "antigravity-extension"
EXTERNAL_ANTIGRAVITY_PORT = 1313
EXTERNAL_ANTIGRAVITY_URL = "http://127.0.0.1:1313"

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bridges (
            name TEXT PRIMARY KEY,
            port INTEGER NOT NULL,
            provider TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            target_url TEXT,
            api_key TEXT
        );
    """)
    conn.commit()
    return conn

def auto_migrate_json_if_needed(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as cnt FROM bridges")
    row = cursor.fetchone()
    if row and row["cnt"] > 0:
        return

    bridges_to_insert = []
    if os.path.exists(BRIDGES_JSON_PATH):
        try:
            with open(BRIDGES_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    bridges_to_insert = data
        except Exception:
            pass

    if not bridges_to_insert:
        bridges_to_insert = DEFAULT_BRIDGES

    for b in bridges_to_insert:
        name = b.get("name")
        if not name:
            continue
        provider = b.get("provider", "openai")
        is_external_antigravity = provider == EXTERNAL_ANTIGRAVITY_PROVIDER
        port = int(b.get("port", EXTERNAL_ANTIGRAVITY_PORT if is_external_antigravity else 11435))
        if is_external_antigravity and port != EXTERNAL_ANTIGRAVITY_PORT:
            continue
        enabled_default = False if is_external_antigravity else True
        enabled = 1 if b.get("enabled", enabled_default) else 0
        target_url = b.get("targetUrl") or b.get("target_url")
        if is_external_antigravity and not target_url:
            target_url = EXTERNAL_ANTIGRAVITY_URL
        if is_external_antigravity:
            parsed = urlparse(target_url)
            if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
                continue
        api_key = b.get("apiKey") or b.get("api_key")
        cursor.execute("""
            INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, port, provider, enabled, target_url, api_key))
    conn.commit()

def list_bridges():
    conn = get_db_connection()
    auto_migrate_json_if_needed(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT name, port, provider, enabled, target_url, api_key FROM bridges")
    rows = cursor.fetchall()
    result = []
    for r in rows:
        item = {
            "name": r["name"],
            "port": r["port"],
            "provider": r["provider"],
            "enabled": bool(r["enabled"]),
        }
        if r["target_url"]:
            item["targetUrl"] = r["target_url"]
        if r["api_key"]:
            item["apiKey"] = r["api_key"]
        result.append(item)
    conn.close()
    return result

def upsert_bridge(bridge_dict):
    conn = get_db_connection()
    name = bridge_dict.get("name")
    if not name:
        conn.close()
        raise ValueError("Bridge name is required")
    provider = bridge_dict.get("provider", "openai")
    is_external_antigravity = provider == EXTERNAL_ANTIGRAVITY_PROVIDER
    port = int(bridge_dict.get("port", EXTERNAL_ANTIGRAVITY_PORT if is_external_antigravity else 11435))
    if is_external_antigravity and port != EXTERNAL_ANTIGRAVITY_PORT:
        raise ValueError(f"{EXTERNAL_ANTIGRAVITY_PROVIDER} must use port {EXTERNAL_ANTIGRAVITY_PORT}")
    enabled_default = False if is_external_antigravity else True
    enabled = 1 if bridge_dict.get("enabled", enabled_default) else 0
    target_url = bridge_dict.get("targetUrl") or bridge_dict.get("target_url")
    if is_external_antigravity and not target_url:
        target_url = EXTERNAL_ANTIGRAVITY_URL
    if is_external_antigravity:
        parsed = urlparse(target_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError(f"{EXTERNAL_ANTIGRAVITY_PROVIDER} targetUrl must be a loopback http URL")
    api_key = bridge_dict.get("apiKey") or bridge_dict.get("api_key")

    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (name, port, provider, enabled, target_url, api_key))
    conn.commit()
    conn.close()

def delete_bridge(name):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM bridges WHERE name = ?", (name,))
    conn.commit()
    conn.close()

def set_enabled(name, enabled_bool):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE bridges SET enabled = ? WHERE name = ?", (1 if enabled_bool else 0, name))
    conn.commit()
    conn.close()

def main():
    if len(sys.argv) < 2:
        print(json.dumps(list_bridges()))
        return

    cmd = sys.argv[1]
    if cmd == "--list" or cmd == "list":
        # If called by an interactive/stdio MCP server (not the background KONOHA_DAEMON),
        # return empty list so the MCP server never binds HTTP bridge ports or steals them from daemon.
        is_daemon = os.environ.get("KONOHA_DAEMON") == "true"
        try:
            ppid = os.getppid()
            with open(f"/proc/{ppid}/cmdline", "rb") as f:
                pcmd = f.read().decode("utf-8", errors="ignore")
                if "file_tools_mcp.js" in pcmd and not is_daemon:
                    print("[]")
                    return
        except Exception:
            pass
        print(json.dumps(list_bridges()))
    elif cmd == "--upsert" or cmd == "upsert":
        if len(sys.argv) < 3:
            sys.exit(1)
        b = json.loads(sys.argv[2])
        upsert_bridge(b)
        print(json.dumps({"ok": True}))
    elif cmd == "--delete" or cmd == "delete":
        if len(sys.argv) < 3:
            sys.exit(1)
        delete_bridge(sys.argv[2])
        print(json.dumps({"ok": True}))
    elif cmd == "--enable" or cmd == "enable":
        if len(sys.argv) < 3:
            sys.exit(1)
        set_enabled(sys.argv[2], True)
        print(json.dumps({"ok": True}))
    elif cmd == "--disable" or cmd == "disable":
        if len(sys.argv) < 3:
            sys.exit(1)
        set_enabled(sys.argv[2], False)
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps(list_bridges()))

if __name__ == "__main__":
    main()
