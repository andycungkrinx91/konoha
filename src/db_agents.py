#!/usr/bin/env python3
"""
Agent and model storage management for Konoha via SQLite (skills.db).
Replaces or backs up ~/.agents/agents.json using SQLite persistence.
"""

import sys
import os
import json
import sqlite3

DB_PATH = os.path.expanduser("~/.konoha/skills.db")
AGENTS_JSON_PATH = os.path.expanduser("~/.agents/agents.json")

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("""
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
            cursor_model TEXT,
            cursor_fallback_model TEXT,
            enable_mcp_tools INTEGER NOT NULL DEFAULT 1,
            claude_model TEXT,
            opencode_model TEXT
        );
    """)
    conn.commit()
    return conn

def auto_migrate_json_to_db(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as cnt FROM agents")
    row = cursor.fetchone()
    # If DB already has data, we do not overwrite it with file content (DB is the source of truth)
    if row and row["cnt"] > 0:
        return

    if os.path.exists(AGENTS_JSON_PATH):
        try:
            with open(AGENTS_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for a in data:
                        name = a.get("name")
                        if not name:
                            continue
                        skills_str = json.dumps(a.get("skills", []))
                        cursor.execute("""
                            INSERT OR REPLACE INTO agents (
                                name, icon, title, model_tier, purpose, skills, delegate_when,
                                constraints_text, workflow, description, instructions, delegation_keywords,
                                cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            name,
                            a.get("icon"),
                            a.get("title"),
                            a.get("modelTier") or a.get("model_tier"),
                            a.get("purpose"),
                            skills_str,
                            a.get("delegateWhen") or a.get("delegate_when"),
                            a.get("constraints") or a.get("constraints_text"),
                            a.get("workflow"),
                            a.get("description"),
                            a.get("instructions"),
                            a.get("delegationKeywords") or a.get("delegation_keywords"),
                            a.get("cursorModel") or a.get("cursor_model"),
                            a.get("cursorFallbackModel") or a.get("cursor_fallback_model"),
                            1 if a.get("enable_mcp_tools", True) else 0,
                            a.get("claudeModel") or a.get("claude_model"),
                            a.get("opencodeModel") or a.get("opencode_model")
                        ))
                    conn.commit()
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to migrate agents.json to SQLite: {str(e)}\n")
            sys.stderr.flush()

def sync_db_to_json(conn):
    """Write sqlite agents data back to agents.json to keep external clients / hooks synchronized."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name, icon, title, model_tier, purpose, skills, delegate_when,
               constraints_text, workflow, description, instructions, delegation_keywords,
               cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
        FROM agents
    """)
    rows = cursor.fetchall()
    agents_list = []
    for r in rows:
        try:
            skills = json.loads(r["skills"]) if r["skills"] else []
        except Exception:
            skills = []
            
        agents_list.append({
            "name": r["name"],
            "icon": r["icon"],
            "title": r["title"],
            "modelTier": r["model_tier"],
            "purpose": r["purpose"],
            "skills": skills,
            "delegateWhen": r["delegate_when"],
            "constraints": r["constraints_text"],
            "workflow": r["workflow"],
            "description": r["description"],
            "instructions": r["instructions"],
            "delegationKeywords": r["delegation_keywords"],
            "cursorModel": r["cursor_model"],
            "cursorFallbackModel": r["cursor_fallback_model"],
            "enable_mcp_tools": bool(r["enable_mcp_tools"]),
            "claudeModel": r["claude_model"],
            "opencodeModel": r["opencode_model"]
        })
        
    os.makedirs(os.path.dirname(AGENTS_JSON_PATH), exist_ok=True)
    with open(AGENTS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(agents_list, f, indent=2)

def list_agents():
    conn = get_db_connection()
    auto_migrate_json_to_db(conn)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name, icon, title, model_tier, purpose, skills, delegate_when,
               constraints_text, workflow, description, instructions, delegation_keywords,
               cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
        FROM agents
    """)
    rows = cursor.fetchall()
    result = []
    for r in rows:
        try:
            skills = json.loads(r["skills"]) if r["skills"] else []
        except Exception:
            skills = []
        result.append({
            "name": r["name"],
            "icon": r["icon"],
            "title": r["title"],
            "modelTier": r["model_tier"],
            "purpose": r["purpose"],
            "skills": skills,
            "delegateWhen": r["delegate_when"],
            "constraints": r["constraints_text"],
            "workflow": r["workflow"],
            "description": r["description"],
            "instructions": r["instructions"],
            "delegationKeywords": r["delegation_keywords"],
            "cursorModel": r["cursor_model"],
            "cursorFallbackModel": r["cursor_fallback_model"],
            "enable_mcp_tools": bool(r["enable_mcp_tools"]),
            "claudeModel": r["claude_model"],
            "opencodeModel": r["opencode_model"]
        })
    conn.close()
    return result

def upsert_agent(agent_dict):
    conn = get_db_connection()
    auto_migrate_json_to_db(conn)
    cursor = conn.cursor()
    
    name = agent_dict.get("name")
    if not name:
        conn.close()
        raise ValueError("Agent name is required")
        
    skills_str = json.dumps(agent_dict.get("skills", []))
    cursor.execute("""
        INSERT OR REPLACE INTO agents (
            name, icon, title, model_tier, purpose, skills, delegate_when,
            constraints_text, workflow, description, instructions, delegation_keywords,
            cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        name,
        agent_dict.get("icon"),
        agent_dict.get("title"),
        agent_dict.get("modelTier") or agent_dict.get("model_tier"),
        agent_dict.get("purpose"),
        skills_str,
        agent_dict.get("delegateWhen") or agent_dict.get("delegate_when"),
        agent_dict.get("constraints") or agent_dict.get("constraints_text"),
        agent_dict.get("workflow"),
        agent_dict.get("description"),
        agent_dict.get("instructions"),
        agent_dict.get("delegationKeywords") or agent_dict.get("delegation_keywords"),
        agent_dict.get("cursorModel") or agent_dict.get("cursor_model"),
        agent_dict.get("cursorFallbackModel") or agent_dict.get("cursor_fallback_model"),
        1 if agent_dict.get("enable_mcp_tools", True) else 0,
        agent_dict.get("claudeModel") or agent_dict.get("claude_model"),
        agent_dict.get("opencodeModel") or agent_dict.get("opencode_model")
    ))
    conn.commit()
    sync_db_to_json(conn)
    conn.close()

def delete_agent(name):
    conn = get_db_connection()
    auto_migrate_json_to_db(conn)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM agents WHERE name = ?", (name,))
    conn.commit()
    sync_db_to_json(conn)
    conn.close()

def import_json_to_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    data = None
    if os.path.exists(AGENTS_JSON_PATH):
        try:
            with open(AGENTS_JSON_PATH, "r", encoding="utf-8") as f:
                payload = json.load(f)
                if isinstance(payload, list) and len(payload) > 0:
                    data = payload
        except Exception as e:
            sys.stderr.write(f"Error: Failed to read agents.json: {str(e)}\n")
            sys.stderr.flush()
    if data is not None:
        cursor.execute("DELETE FROM agents")
        for a in data:
            name = a.get("name")
            if not name:
                continue
            skills_str = json.dumps(a.get("skills", []))
            cursor.execute("""
                INSERT OR REPLACE INTO agents (
                    name, icon, title, model_tier, purpose, skills, delegate_when,
                    constraints_text, workflow, description, instructions, delegation_keywords,
                    cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name,
                a.get("icon"),
                a.get("title"),
                a.get("modelTier") or a.get("model_tier"),
                a.get("purpose"),
                skills_str,
                a.get("delegateWhen") or a.get("delegate_when"),
                a.get("constraints") or a.get("constraints_text"),
                a.get("workflow"),
                a.get("description"),
                a.get("instructions"),
                a.get("delegationKeywords") or a.get("delegation_keywords"),
                a.get("cursorModel") or a.get("cursor_model"),
                a.get("cursorFallbackModel") or a.get("cursor_fallback_model"),
                1 if a.get("enable_mcp_tools", True) else 0,
                a.get("claudeModel") or a.get("claude_model"),
                a.get("opencodeModel") or a.get("opencode_model")
            ))
        conn.commit()
    conn.close()

def bulk_import_agents(agents_list):
    """Insert or replace multiple agents in a single transaction."""
    conn = get_db_connection()
    cursor = conn.cursor()
    for a in agents_list:
        name = a.get("name")
        if not name:
            continue
        skills_str = json.dumps(a.get("skills", []))
        cursor.execute("""
            INSERT OR REPLACE INTO agents (
                name, icon, title, model_tier, purpose, skills, delegate_when,
                constraints_text, workflow, description, instructions, delegation_keywords,
                cursor_model, cursor_fallback_model, enable_mcp_tools, claude_model, opencode_model
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            name,
            a.get("icon"),
            a.get("title"),
            a.get("modelTier") or a.get("model_tier"),
            a.get("purpose"),
            skills_str,
            a.get("delegateWhen") or a.get("delegate_when"),
            a.get("constraints") or a.get("constraints_text"),
            a.get("workflow"),
            a.get("description"),
            a.get("instructions"),
            a.get("delegationKeywords") or a.get("delegation_keywords"),
            a.get("cursorModel") or a.get("cursor_model"),
            a.get("cursorFallbackModel") or a.get("cursor_fallback_model"),
            1 if a.get("enable_mcp_tools", True) else 0,
            a.get("claudeModel") or a.get("claude_model"),
            a.get("opencodeModel") or a.get("opencode_model")
        ))
    conn.commit()
    conn.close()


def main():
    if len(sys.argv) < 2:
        print(json.dumps(list_agents()))
        return

    cmd = sys.argv[1]
    if cmd == "--list" or cmd == "list":
        print(json.dumps(list_agents()))
    elif cmd == "--bulk-import":
        if len(sys.argv) < 3:
            sys.exit(1)
        agents = json.loads(sys.argv[2])
        if isinstance(agents, list):
            bulk_import_agents(agents)
            print(json.dumps({"ok": True}))
        else:
            sys.exit(1)
    elif cmd == "--upsert" or cmd == "upsert":
        if len(sys.argv) < 3:
            sys.exit(1)
        a = json.loads(sys.argv[2])
        upsert_agent(a)
        print(json.dumps({"ok": True}))
    elif cmd == "--delete" or cmd == "delete":
        if len(sys.argv) < 3:
            sys.exit(1)
        delete_agent(sys.argv[2])
        print(json.dumps({"ok": True}))
    elif cmd == "--sync" or cmd == "sync":
        conn = get_db_connection()
        auto_migrate_json_to_db(conn)
        sync_db_to_json(conn)
        conn.close()
        print(json.dumps({"ok": True}))
    elif cmd == "--import" or cmd == "import":
        import_json_to_db()
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps(list_agents()))

if __name__ == "__main__":
    main()
