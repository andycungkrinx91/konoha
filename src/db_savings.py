#!/usr/bin/env python3
"""Helper script to query token savings and tool call statistics as JSON."""
import sqlite3
import json
import sys
import os

db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.gemini/skills-db/skills.db")

def query_stats(conn, time_filter=None):
    """Query statistics based on a SQL time filter."""
    where_clause = ""
    if time_filter == "today":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', 'localtime')"
    elif time_filter == "7days":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime')"
        
    query = f"""
        SELECT 
            COUNT(*) as calls,
            COALESCE(SUM(bytes_saved), 0) as bytes,
            COALESCE(SUM(tokens_saved), 0) as tokens,
            COALESCE(SUM(total_library_bytes), 0) as total_bytes
        FROM tool_calls
        {where_clause}
    """
    row = conn.execute(query).fetchone()
    total_bytes = row[3]
    pct = round((row[1] / total_bytes * 100)) if total_bytes > 0 else 0
    return {
        "calls": row[0],
        "bytes": row[1],
        "tokens": row[2],
        "pct": pct
    }

try:
    if not os.path.exists(db_path):
        print(json.dumps({"error": f"Database not found at {db_path}"}))
        sys.exit(1)
        
    conn = sqlite3.connect(db_path)
    
    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            tool TEXT NOT NULL,
            query TEXT,
            returned_bytes INTEGER,
            total_library_bytes INTEGER,
            bytes_saved INTEGER,
            tokens_saved INTEGER
        );
    """)
    
    stats_today = query_stats(conn, "today")
    stats_7days = query_stats(conn, "7days")
    stats_all = query_stats(conn, "all")
    
    conn.close()
    
    print(json.dumps({
        "today": stats_today,
        "last7days": stats_7days,
        "alltime": stats_all
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
