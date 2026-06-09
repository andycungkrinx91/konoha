#!/usr/bin/env python3
"""Helper script to query agent tool call statistics as JSON."""
import sqlite3
import json
import sys
import os

db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.gemini/skills-db/skills.db")

# Check for prune command
if len(sys.argv) > 3 and sys.argv[2] == "--prune":
    agent_to_prune = sys.argv[3]
    try:
        if not os.path.exists(db_path):
            print(json.dumps({"error": f"Database not found at {db_path}"}))
            sys.exit(1)
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tool_calls WHERE LOWER(agent) = LOWER(?)", (agent_to_prune,))
        conn.commit()
        deleted_count = cursor.rowcount
        conn.close()
        print(json.dumps({"success": True, "deleted_count": deleted_count}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

try:
    if not os.path.exists(db_path):
        print(json.dumps({"error": f"Database not found at {db_path}"}))
        sys.exit(1)
        
    conn = sqlite3.connect(db_path)
    
    # Ensure table exists (safeguard)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            tool TEXT NOT NULL,
            query TEXT,
            returned_bytes INTEGER,
            total_library_bytes INTEGER,
            bytes_saved INTEGER,
            tokens_saved INTEGER,
            agent TEXT
        );
    """)
    
    # Run query
    query = """
        SELECT 
            agent,
            COUNT(CASE WHEN date(timestamp, 'localtime') >= date('now', 'localtime') THEN 1 END) as today,
            COUNT(CASE WHEN date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime') THEN 1 END) as last7days,
            COUNT(*) as alltime
        FROM tool_calls
        GROUP BY agent
    """
    
    rows = conn.execute(query).fetchall()
    conn.close()
    
    results = {}
    for row in rows:
        agent_name = row[0] if row[0] else "(direct)"
        results[agent_name] = {
            "today": row[1],
            "last7days": row[2],
            "alltime": row[3]
        }
        
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
