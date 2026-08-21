#!/usr/bin/env python3
"""
tests/test_persona_memory.py — Unit tests for Konoha persona and memory manager.
"""

import sys
import os
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import persona_memory


class TestPersonaMemory(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, "test_skills.db")

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_save_and_query_memory(self):
        mem_id = persona_memory.save_memory(
            agent_name="anbu",
            title="Postgres Connection Pooling",
            content="Always configure max_connections and keepalives for PostgreSQL connections.",
            memory_type="rule",
            tags="database,postgres",
            importance=2,
            db_path=self.db_path
        )
        self.assertTrue(mem_id)

        # Query by keyword matching FTS
        results = persona_memory.query_memories(
            agent_name="anbu",
            query="PostgreSQL keepalive configuration",
            db_path=self.db_path
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], mem_id)
        self.assertIn("PostgreSQL", results[0]["content"])

    def test_list_and_count_memories(self):
        persona_memory.save_memory("anbu", "Rule 1", db_path=self.db_path)
        persona_memory.save_memory("anbu", "Rule 2", db_path=self.db_path)
        persona_memory.save_memory("jonin", "UI Rule 1", db_path=self.db_path)

        count_all = persona_memory.count_memories(db_path=self.db_path)
        self.assertEqual(count_all, 3)

        count_anbu = persona_memory.count_memories("anbu", db_path=self.db_path)
        self.assertEqual(count_anbu, 2)

        anbu_list = persona_memory.list_memories(agent_name="anbu", db_path=self.db_path)
        self.assertEqual(len(anbu_list), 2)

    def test_delete_memory(self):
        mem_id = persona_memory.save_memory("kage", "Architectural Rule", db_path=self.db_path)
        self.assertEqual(persona_memory.count_memories(db_path=self.db_path), 1)

        deleted = persona_memory.delete_memory(mem_id, db_path=self.db_path)
        self.assertTrue(deleted)
        self.assertEqual(persona_memory.count_memories(db_path=self.db_path), 0)

    def test_format_memories_for_prompt(self):
        mems = [
            {"memory_type": "rule", "content": "Use strict typing."},
            {"memory_type": "preference", "content": "Light mode only."}
        ]
        block = persona_memory.format_memories_for_prompt(mems)
        self.assertIn("### Agent Persona Memory & Learned Rules:", block)
        self.assertIn("- [RULE] Use strict typing.", block)
        self.assertIn("- [PREFERENCE] Light mode only.", block)

    def test_backslashes_and_special_characters(self):
        # Test extreme backslashes and punctuation without SQL or FTS errors
        crazy_content = "Special path: C:\\\\\\\\Users\\\\Admin\\\\AppData\\\\Local\\\\temp AND quotes \"' ` and slashes ///"
        mem_id = persona_memory.save_memory(
            agent_name="anbu",
            title="Backslash Test",
            content=crazy_content,
            db_path=self.db_path
        )
        self.assertTrue(mem_id)

        # Query with extreme backslashes and punctuation
        crazy_query = "\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ Users Admin AppData \\\\\\\\\\\\"
        res = persona_memory.query_memories(
            agent_name="anbu",
            query=crazy_query,
            db_path=self.db_path
        )
        self.assertGreaterEqual(len(res), 1)
        self.assertEqual(res[0]["id"], mem_id)

    def test_fts5_boolean_operators_sanitization(self):
        persona_memory.save_memory("kage", "Rule about caching and invalidation", db_path=self.db_path)

        # Standalone boolean operators that would break raw FTS5 MATCH
        for bad_query in ["AND", "OR", "NOT", "AND OR NOT", "caching AND", "OR invalidation", "AND AND AND"]:
            res = persona_memory.query_memories(
                agent_name="kage",
                query=bad_query,
                db_path=self.db_path
            )
            # Should never raise sqlite3.OperationalError
            self.assertIsInstance(res, list)

    def test_db_schema_integrity(self):
        import sqlite3
        conn = sqlite3.connect(self.db_path)
        persona_memory.init_memory_tables(conn)

        # Check table columns
        cols = [r[1] for r in conn.execute("PRAGMA table_info(persona_memories)").fetchall()]
        expected_cols = ["id", "agent_name", "memory_type", "title", "content", "tags", "importance", "created_at", "updated_at"]
        for c in expected_cols:
            self.assertIn(c, cols)

        # Check virtual table
        fts_cols = [r[1] for r in conn.execute("PRAGMA table_info(persona_memories_fts)").fetchall()]
        self.assertIn("id", fts_cols)
        self.assertIn("content", fts_cols)
        conn.close()


if __name__ == "__main__":
    unittest.main()
