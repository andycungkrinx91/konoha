#!/usr/bin/env python3
"""Test Konoha Bridge Router database schemas and model prefix resolution."""
import os
import sqlite3
import unittest
from unittest.mock import patch, MagicMock

DB_PATH = os.path.expanduser("~/.konoha/skills.db")

class TestBridgeGateway(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.path.exists(DB_PATH), "Database missing. Run migration first.")

    def test_bridges_schema(self):
        """Verify the bridges table has the correct structure."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(bridges);")
        columns = {row[1]: row[2] for row in cursor.fetchall()}
        conn.close()

        expected_columns = ["name", "port", "provider", "enabled", "target_url", "api_key"]
        for col in expected_columns:
            self.assertIn(col, columns, f"Column '{col}' is missing from bridges table.")

    def test_bridge_creation_and_retrieval(self):
        """Test database bridge insertion and retrieval operations."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Insert a dummy bridge
        try:
            cursor.execute(
                "INSERT OR REPLACE INTO bridges (name, port, provider, enabled, target_url, api_key) "
                "VALUES ('test_bridge', 12345, 'openai', 1, 'http://localhost:12345', 'dummy_key');"
            )
            conn.commit()

            cursor.execute("SELECT port, provider FROM bridges WHERE name='test_bridge';")
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], 12345)
            self.assertEqual(row[1], "openai")

            # Clean up test bridge
            cursor.execute("DELETE FROM bridges WHERE name='test_bridge';")
            conn.commit()
        except sqlite3.Error as e:
            self.fail(f"Bridge insert/delete test failed: {e}")
        finally:
            conn.close()

if __name__ == "__main__":
    unittest.main()
