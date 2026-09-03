"""
Unit tests for Embedding Feature Deduplication, Persona & Project Context Memory Deduplication,
Token-Efficiency, and Anti-Hallucination guarantees.
"""

import os
import sys
import tempfile
import unittest
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

import db
import persona_memory
import vector_search


class TestEmbeddingAndMemoryDeduplication(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, "test_dedup.db")
        self.conn = db.get_connection(self.db_path, load_vector=False)
        db.setup_schema(self.conn)

    def tearDown(self):
        self.conn.close()
        self.tmp_dir.cleanup()

    def test_chunk_document_deduplication(self):
        """Verifies chunk_document eliminates duplicate content chunks."""
        markdown = """# Section 1
This is repeated content.

# Section 2
This is unique content.

# Section 1
This is repeated content.
"""
        chunks = vector_search.chunk_document(markdown)
        # Should contain only 2 unique chunks despite 3 sections
        self.assertEqual(len(chunks), 2)
        texts = [c[1] for c in chunks]
        self.assertTrue(any("Section 1" in t for t in texts))
        self.assertTrue(any("Section 2" in t for t in texts))

    def test_embed_cache_deduplication(self):
        """Verifies in-memory _EMBED_CACHE serves cached embeddings for identical normalized text."""
        t1 = "Deterministic embedding test for caching."
        t2 = "  Deterministic   embedding test for caching.  "

        # Mock vector to avoid full ONNX inference in unit test
        mock_vec = np.ones(384, dtype=np.float32)
        norm_val = np.linalg.norm(mock_vec)
        mock_vec = mock_vec / norm_val

        import hashlib
        norm_key = " ".join(t1.strip().split())
        h = hashlib.sha256(norm_key.encode("utf-8")).hexdigest()
        vector_search._EMBED_CACHE[h] = mock_vec

        res1 = vector_search.embed_text(t1)
        res2 = vector_search.embed_text(t2)

        np.testing.assert_array_equal(res1, mock_vec)
        np.testing.assert_array_equal(res2, mock_vec)

    def test_db_level_embedding_blob_reuse(self):
        """Verifies identical chunk text reuses existing embedding blob in skill_chunks."""
        # Insert base skill row
        self.conn.execute(
            "INSERT INTO skills (name, skill_name, type, content) VALUES ('skill-base', 'skill-base', 'skill', 'base content')"
        )
        self.conn.execute(
            "INSERT INTO skills (name, skill_name, type, content) VALUES ('skill-derived', 'skill-derived', 'skill', 'derived content')"
        )

        existing_text = "Universal layout invariant: brand logo on the far left."
        mock_blob = np.full(384, 0.5, dtype=np.float32).tobytes()

        self.conn.execute(
            "INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)",
            ("skill-base", 0, existing_text, mock_blob)
        )
        self.conn.commit()

        # Index another skill that contains the exact same text
        content = existing_text
        vector_search.index_single_skill_chunks(self.conn, "skill-derived", content)

        row = self.conn.execute(
            "SELECT embedding FROM skill_chunks WHERE skill_name = 'skill-derived' AND chunk_text = ?",
            (existing_text,)
        ).fetchone()

        self.assertIsNotNone(row)
        # The pre-existing blob was reused without re-running embedding
        self.assertEqual(row[0], mock_blob)

    def test_persona_memory_deduplication(self):
        """Verifies saving duplicate memory content updates the existing row instead of duplicating."""
        agent = "anbu"
        content = "Always enforce database migrations before starting service."

        mem_id_1 = persona_memory.save_memory(
            agent_name=agent,
            content=content,
            title="Migration rule",
            importance=2,
            db_path=self.db_path
        )

        # Save again with higher importance and updated title
        mem_id_2 = persona_memory.save_memory(
            agent_name=agent,
            content=content,
            title="Updated migration rule",
            importance=5,
            db_path=self.db_path
        )

        # Should return identical ID
        self.assertEqual(mem_id_1, mem_id_2)

        # Table count should be exactly 1
        count = persona_memory.count_memories(agent_name=agent, db_path=self.db_path)
        self.assertEqual(count, 1)

        # Updated importance should be 5
        mems = persona_memory.list_memories(agent_name=agent, db_path=self.db_path)
        self.assertEqual(mems[0]["importance"], 5)

    def test_prompt_context_token_efficiency_and_anti_hallucination(self):
        """Verifies memory prompt formatting is token-efficient and strictly anti-hallucination."""
        profile = {
            "project_name": "ecommerce-frontend",
            "project_path": "/var/app/ecommerce",
            "framework": "Next.js 16",
            "styling": "Tailwind CSS v4",
            "package_manager": "pnpm",
            "context_summary": "E-commerce platform with 10 light-mode themes and server actions."
        }
        memories = [
            {"memory_type": "rule", "content": "Always place brand logo on far-left."},
            {"memory_type": "rule", "content": "Always place brand logo on far-left."},  # duplicate
            {"memory_type": "decision", "content": "Use Zustand for lightweight local cart state."}
        ]

        # 1. Non-compact (Turn 1)
        full_block = persona_memory.format_project_context_for_prompt(profile, memories, max_memories=2, compact=False)
        self.assertIn("Next.js 16", full_block)
        self.assertIn("Tailwind CSS v4", full_block)
        # Should not duplicate the first rule
        self.assertEqual(full_block.count("Always place brand logo on far-left"), 1)
        # Character length bounded
        self.assertLess(len(full_block), 800)

        # 2. Auto-compact (Turn >= 2)
        compact_block = persona_memory.format_project_context_for_prompt(profile, memories, compact=True)
        self.assertIn("Project Context Memory (Auto-Compacted)", compact_block)
        self.assertIn("`ecommerce-frontend` (Next.js 16 • Tailwind CSS v4 • pnpm)", compact_block)
        # Highly compact: less than 350 characters (< 80 tokens)
        self.assertLess(len(compact_block), 350)


if __name__ == "__main__":
    unittest.main()
