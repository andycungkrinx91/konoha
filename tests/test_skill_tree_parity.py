#!/usr/bin/env python3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "templates" / "skills"
DEPLOYED = ROOT / ".agents" / "skills"
ALLOWED_DEPLOYED_ONLY = {Path("anbu-skill/devops-engineer.md")}


class TestSkillTreeParity(unittest.TestCase):
    def test_template_and_agents_deployment_text_files_match(self):
        source_files = {path.relative_to(SOURCE) for path in SOURCE.rglob("*") if path.is_file() and path.suffix.lower() in {".md", ".yaml", ".yml", ".json", ".py"}}
        deployed_files = {path.relative_to(DEPLOYED) for path in DEPLOYED.rglob("*") if path.is_file() and path.suffix.lower() in {".md", ".yaml", ".yml", ".json", ".py"}}
        self.assertEqual(deployed_files - source_files, ALLOWED_DEPLOYED_ONLY)
        self.assertEqual(source_files - ALLOWED_DEPLOYED_ONLY, deployed_files - ALLOWED_DEPLOYED_ONLY)
        for relative in source_files:
            self.assertEqual((SOURCE / relative).read_bytes(), (DEPLOYED / relative).read_bytes(), relative)
    
    def test_compatibility_files_are_not_deleted(self):
        for relative in ALLOWED_DEPLOYED_ONLY:
            self.assertTrue((DEPLOYED / relative).is_file(), relative)
            self.assertFalse((SOURCE / relative).exists(), relative)
        
        
    def test_cursor_runtime_mirror_is_not_required(self):
        self.assertFalse((ROOT / ".cursor" / "skills").is_symlink())


if __name__ == "__main__":
    unittest.main()
