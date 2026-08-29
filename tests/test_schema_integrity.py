#!/usr/bin/env python3
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class TestSchemaIntegrity(unittest.TestCase):
    def test_migration_creates_runtime_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "skills.db"
            skills = Path(tmp) / "skills"
            skill = skills / "genin-skill"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text("---\nname: genin-skill\ndescription: exploration\n---\n# Scout\n", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "src" / "migrate.py"), "--db-path", str(db), "--skills-dir", str(skills), "--require-skill", "genin-skill"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            conn = sqlite3.connect(db)
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
            self.assertTrue({"skills", "skills_fts", "tool_calls", "active_sessions", "agents", "bridges"}.issubset(tables))
            agent_columns = {row[1] for row in conn.execute("PRAGMA table_info(agents)")}
            self.assertIn("model_tier", agent_columns)
            self.assertTrue(conn.execute("SELECT 1 FROM skills WHERE name = 'genin-skill'").fetchone())
            conn.close()

    def test_agent_import_and_bulk_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "HOME": tmp}
            agents_dir = Path(tmp) / ".agents"
            agents_dir.mkdir()
            (agents_dir / "agents.yaml").write_text("- name: jonin\n  skills:\n    - jonin-skill\n", encoding="utf-8")
            script = str(ROOT / "src" / "db_agents.py")
            for args in (("import",), ("--bulk-import", json.dumps([{"name": "anbu", "skills": ["anbu-skill"]}])),):
                result = subprocess.run([sys.executable, script, *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run([sys.executable, script, "list"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            names = {item["name"] for item in json.loads(result.stdout)}
            self.assertEqual(names, {"anbu", "jonin"})


if __name__ == "__main__":
    unittest.main()
