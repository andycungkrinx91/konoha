#!/usr/bin/env python3
"""Test database schema, FTS5 full-text index, and migration integrity."""
import os
import sqlite3
import subprocess
import sys
import unittest

DB_PATH = os.path.expanduser("~/.konoha/skills.db")
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
        
        expected_tables = {"skills", "tool_calls", "agents", "bridges"}
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
        """Verify that the python migration script executes cleanly by creating a temp database."""
        if os.path.exists(MIGRATE_SCRIPT):
            temp_db = "/tmp/konoha-test-migrate.db"
            if os.path.exists(temp_db):
                try:
                    os.remove(temp_db)
                except:
                    pass
            # Run migration on temporary database
            proc = subprocess.run(
                [sys.executable, MIGRATE_SCRIPT, "--db-path", temp_db],
                capture_output=True,
                text=True,
                timeout=25
            )
            try:
                if os.path.exists(temp_db):
                    os.remove(temp_db)
            except:
                pass
            self.assertEqual(proc.returncode, 0, f"Migration script execution failed: {proc.stderr}\nStdout: {proc.stdout}")

if __name__ == "__main__":
    unittest.main()
