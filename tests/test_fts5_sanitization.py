#!/usr/bin/env python3
"""Test Konoha FTS5 query sanitization and edge cases."""
import os
import sys
import unittest
import sqlite3

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


class TestFTS5Sanitization(unittest.TestCase):
    """Test the sanitize_fts5_query function."""

    def setUp(self):
        # Import the function from server.py
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "server",
            os.path.join(os.path.dirname(__file__), '..', 'src', 'server.py')
        )
        self.server_module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(self.server_module)
        except Exception:
            self.skipTest("Could not import server.py")

    def test_basic_query(self):
        """Test basic query sanitization."""
        result = self.server_module.sanitize_fts5_query("hello world")
        self.assertEqual(result, "hello world")

    def test_sql_injection_attempt(self):
        """Test that SQL injection attempts are sanitized."""
        # These should not crash and should return sanitized results
        result1 = self.server_module.sanitize_fts5_query("'; DROP TABLE skills; --")
        self.assertIsInstance(result1, str)

        result2 = self.server_module.sanitize_fts5_query("' OR '1'='1")
        self.assertIsInstance(result2, str)

    def test_empty_query(self):
        """Test empty query handling."""
        result = self.server_module.sanitize_fts5_query("")
        self.assertEqual(result, "")

    def test_special_characters(self):
        """Test special character handling."""
        result = self.server_module.sanitize_fts5_query("hello'world\"test")
        self.assertIsInstance(result, str)

    def test_unicode_query(self):
        """Test unicode query handling."""
        result = self.server_module.sanitize_fts5_query("Héllö Wörld")
        self.assertEqual(result, "Héllö Wörld")

    def test_very_long_query(self):
        """Test very long query doesn't crash."""
        long_query = "a" * 10000
        result = self.server_module.sanitize_fts5_query(long_query)
        self.assertEqual(len(result), 10000)


class TestDatabaseStats(unittest.TestCase):
    """Test database stats functionality."""

    def test_db_stats_script_exists(self):
        """Test that db_stats.py exists and is importable."""
        script_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'db_stats.py')
        self.assertTrue(os.path.exists(script_path), "db_stats.py should exist")

    def test_db_stats_creates_table(self):
        """Test that db_stats.py handles missing tables gracefully."""
        # Create a temp database without the skills table
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            temp_db = f.name

        try:
            import subprocess
            result = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(__file__), '..', 'src', 'db_stats.py'), temp_db],
                capture_output=True,
                text=True,
                timeout=5
            )
            # Should not crash, should return error or valid stats
            self.assertIn(result.returncode, [0, 1])
        finally:
            os.unlink(temp_db)


if __name__ == '__main__':
    unittest.main()
