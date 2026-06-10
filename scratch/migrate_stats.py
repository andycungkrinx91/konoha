import sqlite3
import os

db_path = os.path.expanduser("~/.gemini/skills-db/skills.db")
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    # 1. Update get_skill calls
    conn.execute("""
        UPDATE tool_calls 
        SET bytes_saved = 0, 
            tokens_saved = 0, 
            total_library_bytes = returned_bytes 
        WHERE tool = 'get_skill'
    """)
    # 2. Update other calls to use a realistic 25 KB baseline
    conn.execute("""
        UPDATE tool_calls 
        SET total_library_bytes = 25000, 
            bytes_saved = CASE WHEN 25000 - returned_bytes > 0 THEN 25000 - returned_bytes ELSE 0 END, 
            tokens_saved = CASE WHEN (25000 - returned_bytes) / 4 > 0 THEN (25000 - returned_bytes) / 4 ELSE 0 END 
        WHERE tool != 'get_skill'
    """)
    conn.commit()
    conn.close()
    print("Database stats migrated successfully.")
else:
    print("Database not found to migrate.")
