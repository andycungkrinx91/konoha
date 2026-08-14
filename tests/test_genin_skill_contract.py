#!/usr/bin/env python3
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_migrate():
    spec = importlib.util.spec_from_file_location("konoha_migrate", ROOT / "src" / "migrate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestGeninSkillContract(unittest.TestCase):
    def test_shipped_skill_metadata_is_canonical(self):
        copies = [
            ROOT / "src" / "templates" / "skills" / "genin-skill",
            ROOT / ".agents" / "skills" / "genin-skill",
            ROOT / ".cursor" / "skills" / "genin-skill",
        ]
        for skill_dir in copies:
            self.assertTrue((skill_dir / "SKILL.md").is_file(), skill_dir)
            self.assertIn("name: genin-skill", (skill_dir / "SKILL.md").read_text(encoding="utf-8"))
            for metadata in (skill_dir / "agents").glob("*.yaml"):
                content = metadata.read_text(encoding="utf-8")
                self.assertIn("name: genin-skill", content, metadata)
                self.assertNotIn("name: deep-code-explorer", content, metadata)

        self.assertNotIn(
            "deep-code-explorer",
            (ROOT / ".agents" / "skills" / "kage-skill" / "SKILL.md").read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "deep-code-explorer",
            (ROOT / ".cursor" / "skills" / "kage-skill" / "SKILL.md").read_text(encoding="utf-8"),
        )

    def test_legacy_rows_canonicalize_with_canonical_precedence(self):
        migrate = load_migrate()
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "skills.db"
            original = migrate.DB_PATH
            migrate.DB_PATH = str(db_path)
            try:
                conn = migrate.setup_db()
                conn.execute(
                    "INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)",
                    ("genin-skill", "genin-skill", "skill", "canonical"),
                )
                conn.execute(
                    "INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)",
                    ("deep-code-explorer", "deep-code-explorer", "skill", "legacy"),
                )
                conn.execute(
                    "INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)",
                    ("deep-code-explorer/code-review", "deep-code-explorer", "reference", "legacy ref"),
                )
                conn.commit()
                migrated, removed = migrate.normalize_legacy_skill_names(conn)
                conn.commit()
                self.assertEqual(migrated, 1)
                self.assertEqual(removed, 1)
                names = {row[0] for row in conn.execute("SELECT name FROM skills")}
                self.assertEqual(names, {"genin-skill", "genin-skill/code-review"})
                conn.close()
            finally:
                migrate.DB_PATH = original

    def test_clean_migration_requires_genin_skill(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp) / "skills"
            skill_dir = skills_dir / "genin-skill"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: genin-skill\ndescription: test\n---\n# Genin\n",
                encoding="utf-8",
            )
            db_path = Path(tmp) / "skills.db"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "src" / "migrate.py"),
                    "--clean",
                    "--skills-dir",
                    str(skills_dir),
                    "--skills",
                    "genin-skill",
                    "--db-path",
                    str(db_path),
                    "--require-skill",
                    "genin-skill",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            conn = sqlite3.connect(db_path)
            self.assertIsNotNone(conn.execute("SELECT 1 FROM skills WHERE name = 'genin-skill'").fetchone())
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM skills WHERE name LIKE 'deep-code-explorer%'").fetchone()[0],
                0,
            )
            conn.close()


if __name__ == "__main__":
    unittest.main()
