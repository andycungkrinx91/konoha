#!/usr/bin/env python3
"""Test database schema, FTS5 full-text index, and migration integrity."""
import os
import sqlite3
import subprocess
import sys
import unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import db

DB_PATH = db.DB_PATH
MIGRATE_SCRIPT = os.path.expanduser("~/.konoha/migrate.py")

class TestDatabaseMigration(unittest.TestCase):
    def setUp(self):
        # Database must exist
        self.assertTrue(os.path.exists(DB_PATH), f"Database not found at {DB_PATH}. Run migration first.")

    def test_schema_tables(self):
        """Verify that all core tables exist in the SQLite database."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = {row[0] for row in cursor.fetchall()}
        conn.close()
        
        expected_tables = {"skills", "tool_calls", "agents", "bridges", "skill_chunks"}
        for t in expected_tables:
            self.assertIn(t, tables, f"Table '{t}' is missing from schema.")

    def test_fts5_indexing(self):
        """Verify that the FTS5 virtual table matches the search pattern."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Test basic match query
        try:
            cursor.execute("SELECT name, content FROM skills_fts WHERE content MATCH 'security' LIMIT 1;")
            result = cursor.fetchone()
            if result:
                self.assertIsNotNone(result[0])
                self.assertIsNotNone(result[1])
        except sqlite3.OperationalError as e:
            self.fail(f"FTS5 MATCH query failed: {e}")
        finally:
            conn.close()

    def test_migration_execution(self):
        """Verify that the production migration script executes cleanly in isolation."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            temp_db = os.path.join(tmp, "konoha-test-migrate.db")
            skills_dir = os.path.join(tmp, "skills", "genin-skill")
            os.makedirs(skills_dir)
            with open(os.path.join(skills_dir, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write("---\nname: genin-skill\ndescription: exploration\n---\n# Scout\n")
            proc = subprocess.run(
                [sys.executable, MIGRATE_SCRIPT, "--db-path", temp_db, "--skills-dir", os.path.dirname(skills_dir), "--require-skill", "genin-skill"],
                capture_output=True,
                text=True,
                timeout=25
            )
            self.assertEqual(proc.returncode, 0, f"Migration script execution failed: {proc.stderr}\nStdout: {proc.stdout}")

if __name__ == "__main__":
    unittest.main()
