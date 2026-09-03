#!/usr/bin/env python3
"""Helper script to print database stats as JSON."""
import json
import os
import sys

# Ensure src/ is on path for db import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

db_path = sys.argv[1] if len(sys.argv) > 1 else db.DB_PATH

try:
    conn = db.get_connection(db_path)
    db.setup_schema(conn)
    total = conn.execute("SELECT COUNT(*) FROM skills").fetchone()[0]
    skills = conn.execute("SELECT COUNT(*) FROM skills WHERE type='skill'").fetchone()[0]
    refs = conn.execute("SELECT COUNT(*) FROM skills WHERE type='reference'").fetchone()[0]
    total_bytes = conn.execute("SELECT SUM(byte_size) FROM skills").fetchone()[0] or 0
    conn.close()
    print(json.dumps({"total": total, "skills": skills, "refs": refs, "bytes": total_bytes}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
