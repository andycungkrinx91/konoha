#!/usr/bin/env python3
"""Tests for fuzzy skill resolution and prompt-driven skill auto-loading.

Two layers:
  1. Fuzzy match — when an agent lists a skill_name like "devsecops-engineer"
     but the DB has "devsecops-engineering", Levenshtein fallback picks it up.
  2. Prompt autoload — when an agent has no explicit skills list, the prompt
     is scanned for tokens matching skill_name or content, and top matches are
     loaded.
"""
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.append(os.path.expanduser("~/.konoha"))
try:
    import server
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
    import server

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


class TestFuzzySkillResolution(unittest.TestCase):
    """Direct tests of _fuzzy_resolve_skill and _levenshtein."""

    def test_levenshtein_basic(self):
        self.assertEqual(server._levenshtein("abc", "abc"), 0)
        self.assertEqual(server._levenshtein("abc", "abd"), 1)
        self.assertEqual(server._levenshtein("abc", ""), 3)
        self.assertEqual(server._levenshtein("", "abc"), 3)
        self.assertEqual(server._levenshtein("kitten", "sitting"), 3)

    def test_fuzzy_resolves_typo_in_skill_name(self):
        # Insert a known skill, ask for a typo. Skills table schema:
        # (name PRIMARY KEY, skill_name, type, content, ...)
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO skills (name, skill_name, type, content) "
                "VALUES (?, ?, ?, ?)",
                ("devsecops-engineer-test-typo", "devsecops-engineer", "skill",
                 "Best practices for DevSecOps workflows, Docker, Kubernetes."),
            )
            conn.commit()
            resolved = server._fuzzy_resolve_skill("devsecops-enginer", conn)
            self.assertEqual(resolved, "devsecops-engineer")
        finally:
            conn.close()

    def test_fuzzy_returns_none_for_distant_typo(self):
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO skills (name, skill_name, type, content) "
                "VALUES (?, ?, ?, ?)",
                ("alpha-typo-test", "alpha", "skill", "x"),
            )
            conn.commit()
            # Too far away: edit distance > 3
            resolved = server._fuzzy_resolve_skill("zxcvbnmlkjhgfdsa", conn)
            self.assertIsNone(resolved)
        finally:
            conn.close()


class TestPromptAutoload(unittest.TestCase):
    """Verify _autoload_skills_from_prompt matches by name and content."""

    def setUp(self):
        # Use a separate in-memory DB to avoid polluting the global one
        self._orig_db_path = server.DB_PATH
        self.tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp_db.close()
        server.DB_PATH = self.tmp_db.name
        conn = sqlite3.connect(self.tmp_db.name)
        conn.execute(
            "CREATE TABLE skills (name TEXT PRIMARY KEY, skill_name TEXT, "
            "type TEXT, content TEXT)"
        )
        conn.execute(
            "INSERT INTO skills VALUES (?, ?, 'skill', ?)",
            ("docker-best-practices-test", "docker-best-practices",
             "How to write production-grade Dockerfiles, multi-stage builds, layer caching."),
        )
        conn.execute(
            "INSERT INTO skills VALUES (?, ?, 'skill', ?)",
            ("kubernetes-deployment-test", "kubernetes-deployment",
             "Deployments, services, ingress, helm charts for production clusters."),
        )
        conn.execute(
            "INSERT INTO skills VALUES (?, ?, 'skill', ?)",
            ("react-frontend-test", "react-frontend",
             "Component patterns, hooks, server components, suspense for React apps."),
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        server.DB_PATH = self._orig_db_path
        os.unlink(self.tmp_db.name)

    def test_autoload_picks_docker_skill_for_docker_prompt(self):
        conn = sqlite3.connect(self.tmp_db.name)
        try:
            matches = server._autoload_skills_from_prompt(
                "Help me optimize my docker build for a smaller image", conn
            )
            self.assertIn("docker-best-practices", matches)
        finally:
            conn.close()

    def test_autoload_picks_kubernetes_skill_for_cluster_prompt(self):
        conn = sqlite3.connect(self.tmp_db.name)
        try:
            matches = server._autoload_skills_from_prompt(
                "How should I structure helm charts for production deployment?", conn
            )
            self.assertIn("kubernetes-deployment", matches)
        finally:
            conn.close()

    def test_autoload_returns_empty_for_unrelated_prompt(self):
        conn = sqlite3.connect(self.tmp_db.name)
        try:
            matches = server._autoload_skills_from_prompt(
                "Tell me about the renaissance painting style", conn
            )
            self.assertEqual(matches, [])
        finally:
            conn.close()

    def test_autoload_empty_prompt_returns_empty(self):
        conn = sqlite3.connect(self.tmp_db.name)
        try:
            self.assertEqual(server._autoload_skills_from_prompt("", conn), [])
            self.assertEqual(server._autoload_skills_from_prompt("hi", conn), [])
        finally:
            conn.close()

    def test_autoload_caps_matches(self):
        conn = sqlite3.connect(self.tmp_db.name)
        try:
            # A prompt that could match all three skills
            matches = server._autoload_skills_from_prompt(
                "docker kubernetes react deployment production image component", conn,
                max_matches=1,
            )
            self.assertEqual(len(matches), 1)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
