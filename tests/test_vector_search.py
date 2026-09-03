#!/usr/bin/env python3
"""Tests for Part 2: Vector Search & Multilingual Retrieval."""
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import db
import vector_search


class TestVectorSearch(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_db = os.path.join(self.tmp_dir.name, "skills_vector_test.db")
        self.orig_db = db.DB_PATH
        db.DB_PATH = self.test_db
        self.conn = db.get_connection(self.test_db, load_vector=False)
        db.setup_schema(self.conn)

    def tearDown(self):
        self.conn.close()
        db.DB_PATH = self.orig_db
        self.tmp_dir.cleanup()

    def test_rrf_deterministic_ordering(self):
        """Test Reciprocal Rank Fusion returns deterministic ordering given fixed inputs."""
        list1 = ["item-a", "item-b", "item-c"]
        list2 = ["item-b", "item-a", "item-d"]

        fused1 = vector_search.reciprocal_rank_fusion([list1, list2], k=60)
        fused2 = vector_search.reciprocal_rank_fusion([list1, list2], k=60)

        self.assertEqual(fused1, fused2, "RRF should be completely deterministic")
        top_keys = [k for k, _ in fused1]
        self.assertEqual(top_keys[0], "item-a")  # rank 0+1 vs 1+0 tie resolved or identical
        self.assertIn("item-b", top_keys[:2])
        self.assertIn("item-c", top_keys[2:])
        self.assertIn("item-d", top_keys[2:])

    def test_extension_load_unavailable_fallback(self):
        """Test that vector_search falls back gracefully when enable_load_extension raises."""
        class MockConn:
            def enable_load_extension(self, val):
                raise sqlite3.OperationalError("not authorized")

        res = vector_search.enable_load_extension_safe(MockConn())
        self.assertFalse(res, "Should return False when enable_load_extension fails")

    def test_chunk_backfill_idempotency(self):
        """Test chunk backfill idempotency (running twice does not duplicate chunks)."""
        content = """# Architecture Overview
This is the system architecture guide.

## Security Practices
Follow standard security hardening rules.
"""
        self.conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("kage-skill", "kage-skill", "skill", "architecture, security", content, "/path/SKILL.md", len(content), 10)
        )
        self.conn.commit()

        # Run backfill first time
        cnt1 = vector_search.backfill_all_embeddings(self.conn, force_rebuild=False)
        self.assertGreater(cnt1, 0, "Should have created chunks on first backfill")

        total_chunks_1 = self.conn.execute("SELECT COUNT(*) FROM skill_chunks WHERE skill_name = 'kage-skill'").fetchone()[0]

        # Run backfill second time without force_rebuild
        cnt2 = vector_search.backfill_all_embeddings(self.conn, force_rebuild=False)
        self.assertEqual(cnt2, 0, "Second incremental backfill should create 0 new chunks")

        total_chunks_2 = self.conn.execute("SELECT COUNT(*) FROM skill_chunks WHERE skill_name = 'kage-skill'").fetchone()[0]
        self.assertEqual(total_chunks_1, total_chunks_2, "Chunk count must remain identical")

    def test_skill_chunks_schema_and_columns(self):
        """Test skill_chunks table existence and column specifications."""
        cur = self.conn.cursor()
        cur.execute("PRAGMA table_info(skill_chunks);")
        columns = {row["name"] for row in cur.fetchall()}
        expected = {"id", "skill_name", "chunk_index", "chunk_text", "embedding"}
        self.assertTrue(expected.issubset(columns), f"skill_chunks missing required columns: {expected - columns}")

    def test_multilingual_indonesian_queries_top5(self):
        """
        Verify Indonesian queries retrieve the correct skills in the top-5.
        Validates cross-lingual shared vector space and CLS pooling.
        """
        # Connect to real indexed database for end-to-end retrieval validation
        real_db = os.path.expanduser("~/.konoha/skills.db")
        if not os.path.exists(real_db):
            self.skipTest("Real skills.db not found for integration test")

        real_conn = db.get_connection(real_db, load_vector=False)
        try:
            test_cases = [
                ("Bagaimana cara membuat styling antarmuka frontend yang modern dan rapi", "jonin-skill"),
                ("Deployment infrastruktur cloud dan perbaikan bug backend", "anbu-skill"),
                ("Keputusan arsitektur sistem dan audit keamanan kode", "kage-skill"),
                ("Mencari struktur kode dan pemetaan dependensi berkas", "genin-skill"),
                ("Menulis dokumentasi teknis panduan API dan README", "tokubetsu-jonin-skill"),
            ]

            for id_query, expected_skill in test_cases:
                results = vector_search.find_skill_semantic(real_conn, id_query, top_k=5, candidate_k=20)
                matched_names = [r["name"] for r in results]
                matched_skill_names = [r["skill_name"] for r in results]
                found = any(expected_skill in name or expected_skill in s_name
                            for name, s_name in zip(matched_names, matched_skill_names))
                self.assertTrue(found, f"Query '{id_query}' did not retrieve '{expected_skill}' in top-5: {matched_names}")
        finally:
            real_conn.close()


if __name__ == "__main__":
    unittest.main()
