#!/usr/bin/env python3
"""
Agent and model storage management for Konoha via SQLite (skills.db).
Replaces or backs up ~/.agents/agents.yaml using SQLite persistence.
"""

import sys
import os
import json
import sqlite3
import re

DB_PATH = os.path.expanduser("~/.konoha/skills.db")
AGENTS_YAML_PATH = os.path.expanduser("~/.agents/agents.yaml")

def parse_yaml(yaml_content):
    agents = []
    current_agent = None
    current_key = None
    multiline_val = None
    multiline_indent = None
    list_key = None
    list_val = []

    lines = yaml_content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip empty lines and comments (except in multiline block)
        if not stripped or stripped.startswith("#"):
            if current_key and multiline_val is not None:
                if not stripped:
                    multiline_val.append("")
                else:
                    indent = len(line) - len(line.lstrip(' '))
                    if indent >= multiline_indent:
                        multiline_val.append(line[multiline_indent:])
                    else:
                        current_agent[current_key] = "\n".join(multiline_val)
                        current_key = None
                        multiline_val = None
                        multiline_indent = None
                        continue
            i += 1
            continue

        indent = len(line) - len(line.lstrip(' '))

        if current_key and multiline_val is not None:
            if indent >= multiline_indent:
                multiline_val.append(line[multiline_indent:])
                i += 1
                continue
            else:
                current_agent[current_key] = "\n".join(multiline_val)
                current_key = None
                multiline_val = None
                multiline_indent = None
                continue

        if list_key and stripped.startswith("- "):
            val = stripped[2:].strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            list_val.append(val)
            i += 1
            continue
        elif list_key:
            current_agent[list_key] = list_val
            list_key = None
            list_val = []
            continue

        if stripped.startswith("-"):
            if current_agent is not None:
                agents.append(current_agent)
            current_agent = {}
            
            rest = stripped[1:].strip()
            if not rest:
                i += 1
                continue
            else:
                stripped = rest

        if ":" in stripped:
            parts = stripped.split(":", 1)
            key = parts[0].strip()
            val = parts[1].strip()

            if val == "|":
                current_key = key
                multiline_val = []
                next_line_idx = i + 1
                while next_line_idx < len(lines) and not lines[next_line_idx].strip():
                    next_line_idx += 1
                if next_line_idx < len(lines):
                    multiline_indent = len(lines[next_line_idx]) - len(lines[next_line_idx].lstrip(' '))
                else:
                    multiline_indent = indent + 4
            elif not val:
                list_key = key
                list_val = []
            else:
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                elif val.startswith("[") and val.endswith("]"):
                    inner = val[1:-1].strip()
                    if not inner:
                        val = []
                    else:
                        val = [item.strip().strip('"').strip("'") for item in inner.split(",")]
                elif val.lower() == "true":
                    val = True
                elif val.lower() == "false":
                    val = False
                elif val.lower() in ("null", "none"):
                    val = None
                elif val.isdigit():
                    val = int(val)
                current_agent[key] = val
        
        i += 1

    if current_key and multiline_val is not None:
        current_agent[current_key] = "\n".join(multiline_val)
    if list_key:
        current_agent[list_key] = list_val
    if current_agent is not None:
        agents.append(current_agent)

    return agents


def serialize_yaml(data):
    lines = []
    for item in data:
        name = item.get("name", "")
        # Ensure we always keep the mcp_ prefix
        lines.append(f"- name: {name}")
        for k, v in item.items():
            if k == "name":
                continue
            if v is None:
                lines.append(f"  {k}: null")
            elif isinstance(v, bool):
                lines.append(f"  {k}: {str(v).lower()}")
            elif isinstance(v, (int, float)):
                lines.append(f"  {k}: {v}")
            elif isinstance(v, list):
                lines.append(f"  {k}:")
                for elem in v:
                    lines.append(f"    - {elem}")
            elif isinstance(v, str):
                if "\n" in v:
                    lines.append(f"  {k}: |")
                    for line in v.splitlines():
                        lines.append(f"    {line}")
                else:
                    if ":" in v or "#" in v or v.startswith("-") or v.startswith(" ") or v.strip() in ("true", "false", "null", "none"):
                        escaped = v.replace('"', '\\"')
                        lines.append(f'  {k}: "{escaped}"')
                    else:
                        lines.append(f"  {k}: {v}")
    return "\n".join(lines) + "\n"


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
            cursor_fallback_model TEXT,
            enable_mcp_tools INTEGER NOT NULL DEFAULT 1
        );
    """)
    conn.commit()
    return conn

def auto_migrate_yaml_to_db(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as cnt FROM agents")
    row = cursor.fetchone()
    # If DB already has data, we do not overwrite it with file content
    if row and row["cnt"] > 0:
        return

    if os.path.exists(AGENTS_YAML_PATH):
        try:
            with open(AGENTS_YAML_PATH, "r", encoding="utf-8") as f:
                content = f.read()
                data = parse_yaml(content)
                if isinstance(data, list):
                    for a in data:
                        name = a.get("name")
                        if not name:
                            continue
                        skills_str = json.dumps(a.get("skills", []))
                        cursor.execute("""
                            INSERT OR REPLACE INTO agents (
                                name, icon, title, purpose, skills, delegate_when,
                                constraints_text, workflow, description, instructions, delegation_keywords,
                                enable_mcp_tools
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            name,
                            a.get("icon"),
                            a.get("title"),
                            a.get("purpose"),
                            skills_str,
                            a.get("delegateWhen") or a.get("delegate_when"),
                            a.get("constraints") or a.get("constraints_text"),
                            a.get("workflow"),
                            a.get("description"),
                            a.get("instructions"),
                            a.get("delegationKeywords") or a.get("delegation_keywords"),
                            1 if a.get("enable_mcp_tools", True) else 0,
                        ))
                    conn.commit()
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to migrate agents.yaml to SQLite: {str(e)}\n")
            sys.stderr.flush()

def sync_db_to_yaml(conn):
    """Write sqlite agents data back to agents.yaml to keep external clients / hooks synchronized."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name, icon, title, purpose, skills, delegate_when,
               constraints_text, workflow, description, instructions, delegation_keywords,
               enable_mcp_tools
        FROM agents
    """)
    rows = cursor.fetchall()
    agents_list = []
    for r in rows:
        try:
            skills = json.loads(r["skills"]) if r["skills"] else []
        except Exception:
            skills = []

        name = r["name"]

        agents_list.append({
            "name": name,
            "icon": r["icon"],
            "title": r["title"],
            "purpose": r["purpose"],
            "skills": skills,
            "delegateWhen": r["delegate_when"],
            "constraints": r["constraints_text"],
            "workflow": r["workflow"],
            "description": r["description"],
            "instructions": r["instructions"],
            "delegationKeywords": r["delegation_keywords"],
            "enable_mcp_tools": bool(r["enable_mcp_tools"]),
        })

    os.makedirs(os.path.dirname(AGENTS_YAML_PATH), exist_ok=True)
    with open(AGENTS_YAML_PATH, "w", encoding="utf-8") as f:
        f.write(serialize_yaml(agents_list))

def list_agents():
    conn = get_db_connection()
    auto_migrate_yaml_to_db(conn)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name, icon, title, purpose, skills, delegate_when,
               constraints_text, workflow, description, instructions, delegation_keywords,
               enable_mcp_tools
        FROM agents
    """)
    rows = cursor.fetchall()
    result = []
    for r in rows:
        try:
            skills = json.loads(r["skills"]) if r["skills"] else []
        except Exception:
            skills = []
        
        name = r["name"]

        result.append({
            "name": name,
            "icon": r["icon"],
            "title": r["title"],
            "purpose": r["purpose"],
            "skills": skills,
            "delegateWhen": r["delegate_when"],
            "constraints": r["constraints_text"],
            "workflow": r["workflow"],
            "description": r["description"],
            "instructions": r["instructions"],
            "delegationKeywords": r["delegation_keywords"],
            "enable_mcp_tools": bool(r["enable_mcp_tools"]),
        })
    conn.close()
    return result

def upsert_agent(agent_dict):
    conn = get_db_connection()
    auto_migrate_yaml_to_db(conn)
    cursor = conn.cursor()

    name = agent_dict.get("name")
    if not name:
        conn.close()
        raise ValueError("Agent name is required")


    skills_str = json.dumps(agent_dict.get("skills", []))
    cursor.execute("""
        INSERT OR REPLACE INTO agents (
            name, icon, title, purpose, skills, delegate_when,
            constraints_text, workflow, description, instructions, delegation_keywords,
            enable_mcp_tools
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        name,
        agent_dict.get("icon"),
        agent_dict.get("title"),
        agent_dict.get("purpose"),
        skills_str,
        agent_dict.get("delegateWhen") or agent_dict.get("delegate_when"),
        agent_dict.get("constraints") or agent_dict.get("constraints_text"),
        agent_dict.get("workflow"),
        agent_dict.get("description"),
        agent_dict.get("instructions"),
        agent_dict.get("delegationKeywords") or agent_dict.get("delegation_keywords"),
        1 if agent_dict.get("enable_mcp_tools", True) else 0,
    ))
    conn.commit()
    sync_db_to_yaml(conn)
    conn.close()

def delete_agent(name):
    conn = get_db_connection()
    auto_migrate_yaml_to_db(conn)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM agents WHERE name = ?", (name,))
    conn.commit()
    sync_db_to_yaml(conn)
    conn.close()

def import_yaml_to_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    data = None
    if os.path.exists(AGENTS_YAML_PATH):
        try:
            with open(AGENTS_YAML_PATH, "r", encoding="utf-8") as f:
                content = f.read()
                payload = parse_yaml(content)
                if isinstance(payload, list) and len(payload) > 0:
                    data = payload
        except Exception as e:
            sys.stderr.write(f"Error: Failed to read agents.yaml: {str(e)}\n")
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
                    name, icon, title, purpose, skills, delegate_when,
                    constraints_text, workflow, description, instructions, delegation_keywords,
                    enable_mcp_tools
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name,
                a.get("icon"),
                a.get("title"),
                a.get("purpose"),
                skills_str,
                a.get("delegateWhen") or a.get("delegate_when"),
                a.get("constraints") or a.get("constraints_text"),
                a.get("workflow"),
                a.get("description"),
                a.get("instructions"),
                a.get("delegationKeywords") or a.get("delegation_keywords"),
                1 if a.get("enable_mcp_tools", True) else 0,
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
                name, icon, title, purpose, skills, delegate_when,
                constraints_text, workflow, description, instructions, delegation_keywords,
                enable_mcp_tools
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            name,
            a.get("icon"),
            a.get("title"),
            a.get("purpose"),
            skills_str,
            a.get("delegateWhen") or a.get("delegate_when"),
            a.get("constraints") or a.get("constraints_text"),
            a.get("workflow"),
            a.get("description"),
            a.get("instructions"),
            a.get("delegationKeywords") or a.get("delegation_keywords"),
            1 if a.get("enable_mcp_tools", True) else 0,
        ))
    conn.commit()
    sync_db_to_yaml(conn)
    conn.close()


def main():
    if len(sys.argv) < 2:
        print(json.dumps(list_agents()))
        return

    cmd = sys.argv[1]
    if cmd == "--list" or cmd == "list":
        print(json.dumps(list_agents()))
    elif cmd == "--list-compact" or cmd == "list-compact":
        agents = list_agents()
        for a in agents:
            for k in ("instructions", "constraints", "workflow", "description", "constraints_text"):
                if a.get(k):
                    a[k] = ""
                if a.get(k) is None:
                    continue
                    continue
        print(json.dumps(agents, separators=(",", ":")))
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
        auto_migrate_yaml_to_db(conn)
        sync_db_to_yaml(conn)
        conn.close()
        print(json.dumps({"ok": True}))
    elif cmd == "--import" or cmd == "import":
        import_yaml_to_db()
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps(list_agents()))

if __name__ == "__main__":
    main()
