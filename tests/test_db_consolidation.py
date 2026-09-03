#!/usr/bin/env python3
"""Tests for Part 1: Single-DB Access Layer Consolidation."""
import os
import sys
import tempfile
import unittest
import sqlite3
import subprocess
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import db
import server
import migrate
import db_agents
import db_bridges
import persona_memory


class TestDBConsolidation(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_db = os.path.join(self.tmp_dir.name, "skills_test.db")
        self.orig_db_path = db.DB_PATH
        self.orig_server_db = server.DB_PATH
        self.orig_migrate_db = migrate.DB_PATH
        self.orig_persona_db = persona_memory.DB_PATH

        db.DB_PATH = self.test_db
        server.DB_PATH = self.test_db
        migrate.DB_PATH = self.test_db
        persona_memory.DB_PATH = self.test_db

    def tearDown(self):
        db.DB_PATH = self.orig_db_path
        server.DB_PATH = self.orig_server_db
        migrate.DB_PATH = self.orig_migrate_db
        persona_memory.DB_PATH = self.orig_persona_db
        self.tmp_dir.cleanup()

    def test_canonical_db_path_ownership(self):
        """Assert db.DB_PATH is canonical and imported across modules."""
        self.assertEqual(server.DB_PATH, self.test_db)
        self.assertEqual(migrate.DB_PATH, self.test_db)
        self.assertEqual(persona_memory.DB_PATH, self.test_db)

    def test_skills_table_column_set_regression(self):
        """Assert the skills table has the full canonical column set without drift."""
        conn = db.get_connection(self.test_db)
        db.setup_schema(conn)

        cur = conn.cursor()
        cur.execute("PRAGMA table_info(skills);")
        columns = {row["name"] for row in cur.fetchall()}
        conn.close()

        expected_columns = {
            "name", "skill_name", "type", "tags",
            "content", "file_path", "byte_size", "line_count"
        }
        self.assertEqual(columns, expected_columns, "Skills table columns do not match canonical schema")

    def test_wal_journal_mode_across_entrypoints(self):
        """Assert PRAGMA journal_mode reports 'wal' across all public module entrypoints."""
        entrypoints = [
            ("db.get_connection", lambda p: db.get_connection(p)),
            ("server.get_db", lambda p: server.get_db()),
            ("migrate.setup_db", lambda p: migrate.setup_db(p)),
            ("db_agents.get_db_connection", lambda p: db_agents.get_db_connection(p)),
            ("db_bridges.get_db_connection", lambda p: db_bridges.get_db_connection(p)),
            ("persona_memory.get_db", lambda p: persona_memory.get_db(p)),
        ]

        for name, fn in entrypoints:
            sub_db = os.path.join(self.tmp_dir.name, f"{name.replace('.', '_')}.db")
            if name == "server.get_db":
                server.DB_PATH = sub_db
            conn = fn(sub_db)
            try:
                row = conn.execute("PRAGMA journal_mode;").fetchone()
                mode = row[0].lower()
                self.assertEqual(mode, "wal", f"{name} did not set WAL mode (got {mode})")
            finally:
                conn.close()

    def test_db_stats_standalone_uses_canonical_schema(self):
        """Assert db_stats.py works with canonical schema and returns valid JSON."""
        conn = db.get_connection(self.test_db)
        db.setup_schema(conn)
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("test-skill", "test-skill", "skill", "test", "content", "path", 100, 10)
        )
        conn.commit()
        conn.close()

        stats_script = os.path.join(os.path.dirname(__file__), "..", "src", "db_stats.py")
        res = subprocess.run([sys.executable, stats_script, self.test_db], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"db_stats.py failed: {res.stderr}")
        data = json.loads(res.stdout)
        self.assertEqual(data.get("total"), 1)
        self.assertEqual(data.get("skills"), 1)
        self.assertEqual(data.get("bytes"), 100)


if __name__ == "__main__":
    unittest.main()
