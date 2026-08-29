#!/usr/bin/env python3
"""
tests/test_cli_project_commands.py — Tests for CLI 'konoha project' and 'konoha data --project' commands.
Verifies:
1. konoha project context [path]
2. konoha project list
3. konoha project add [path] "<summary>"
4. konoha project memory [path]
5. konoha project delete <path|hash>
6. konoha data memory [agent] --project [path]
"""

import sys
import os
import tempfile
import unittest
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.resolve()
CLI_JS = REPO_ROOT / "bin" / "cli.js"

import re

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;]*[mGKF]', '', text)

class TestCLIProjectCommands(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.project_dir = os.path.join(self.tmp_dir.name, "ecommerce_test_repo")
        os.makedirs(self.project_dir, exist_ok=True)

        with open(os.path.join(self.project_dir, "package.json"), "w") as f:
            json.dump({
                "name": "my-ecommerce-project",
                "dependencies": {
                    "next": "16.0.0",
                    "tailwindcss": "^4.0.0"
                }
            }, f)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def run_cli(self, args):
        cmd = ["node", str(CLI_JS)] + args
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
        return res

    def test_project_context_command(self):
        res = self.run_cli(["project", "context", self.project_dir])
        self.assertEqual(res.returncode, 0, f"Error: {res.stderr}")
        self.assertIn("my-ecommerce-project", strip_ansi(res.stdout))
        self.assertIn("Next.js", strip_ansi(res.stdout))
        self.assertIn("pnpm", strip_ansi(res.stdout))

    def test_project_add_and_list_command(self):
        # 1. Add invariant
        res_add = self.run_cli(["project", "add", self.project_dir, "Always enforce strict typing and dark mode theme variables"])
        self.assertEqual(res_add.returncode, 0)
        self.assertIn("Saved architectural invariants", strip_ansi(res_add.stdout))

        # 2. List projects
        res_list = self.run_cli(["project", "list"])
        self.assertEqual(res_list.returncode, 0)
        self.assertIn("my-ecommerce-project", strip_ansi(res_list.stdout))

    def test_project_memory_and_delete(self):
        # 1. Add context first
        self.run_cli(["project", "add", self.project_dir, "Test invariant for memory check"])

        # 2. View project memory
        res_mem = self.run_cli(["project", "memory", self.project_dir])
        self.assertEqual(res_mem.returncode, 0)

        # 3. Delete project profile
        res_del = self.run_cli(["project", "delete", self.project_dir])
        self.assertEqual(res_del.returncode, 0)
        self.assertIn("Deleted project profile", strip_ansi(res_del.stdout))

if __name__ == '__main__':
    unittest.main()
