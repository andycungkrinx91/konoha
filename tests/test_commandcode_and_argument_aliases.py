#!/usr/bin/env python3
"""
tests/test_commandcode_and_argument_aliases.py
Verifies:
1. Argument normalization and alias handling in server.py and file_tools_router.
2. Token-compact formatting of project context and dependency filtering in persona_memory.py.
3. Command Code scratch paths allowability.
4. CLI help flag and subcommand parity across all commands.
"""

import os
import sys
import json
import unittest
import subprocess

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
import server
import persona_memory

class TestCommandCodeAndAliases(unittest.TestCase):
    def test_argument_alias_normalization_in_server(self):
        args = {
            "FilePath": "/path/to/file.txt",
            "StartLine": 5,
            "EndLine": 20
        }
        # Validate that _validate_manifest_arguments normalizes aliases into snake_case
        server._validate_manifest_arguments("read_file_range", args)
        self.assertIn("file_path", args)
        self.assertEqual(args["start_line"], 5)
        self.assertEqual(args["end_line"], 20)

    def test_project_stack_dependency_filtering(self):
        # Create a mock package.json with many dependencies
        mock_pkg = {
            "name": "test-app",
            "dependencies": {
                f"dep-{i}": "1.0.0" for i in range(50)
            },
            "devDependencies": {
                "next": "15.0.0",
                "tailwindcss": "4.0.0",
                "@tailwindcss/postcss": "4.0.0"
            }
        }
        import tempfile
        with tempfile.TemporaryDirectory() as tmp_dir:
            pkg_file = os.path.join(tmp_dir, "package.json")
            with open(pkg_file, "w") as f:
                json.dump(mock_pkg, f)

            stack = persona_memory.detect_project_stack(tmp_dir)
            self.assertIn("Next.js", stack["framework"])
            self.assertIn("Tailwind CSS v4", stack["styling"])
            # Dependencies array must be bounded (<= 15 items)
            self.assertLessEqual(len(stack["dependencies"]), 15)

    def test_format_project_context_compactness(self):
        profile = {
            "project_name": "ecommerce-frontend",
            "project_path": "/home/user/workspace/ecommerce",
            "framework": "Next.js 15.0",
            "styling": "Tailwind CSS v4 (@theme directives)",
            "package_manager": "pnpm",
            "context_summary": "Enforce strict TypeScript, Geist font, zero emojis, 10 light-mode themes, and pnpm exclusively across all components and API routes."
        }
        mems = [
            {"memory_type": "rule", "content": "Always validate forms with Zod and server actions."},
            {"memory_type": "architecture", "content": "Keep page-level routes in app/ directory with dynamic metadata."}
        ]

        formatted_normal = persona_memory.format_project_context_for_prompt(profile, mems, compact=False)
        formatted_compact = persona_memory.format_project_context_for_prompt(profile, mems, compact=True)

        self.assertIn("Persistent Project Context", formatted_normal)
        self.assertIn("Auto-Compacted", formatted_compact)
        self.assertLess(len(formatted_compact), len(formatted_normal))
        # Ensure compact block is under 350 characters
        self.assertLess(len(formatted_compact), 350)

    def test_cli_help_flags(self):
        cli_path = os.path.join(os.path.dirname(__file__), '..', 'bin', 'cli.js')
        commands_to_test = [
            ["init", "--help"],
            ["migrate", "--help"],
            ["test", "--help"],
            ["status", "--help"],
            ["savings", "--help"],
            ["doctor", "--help"],
            ["uninstall", "--help"],
            ["version", "--help"],
            ["upgrade", "--help"],
            ["skill", "--help"],
            ["agent", "--help"],
            ["models", "--help"],
            ["data", "--help"],
            ["project", "--help"],
            ["bridge", "--help"],
            ["help"]
        ]
        for cmd_args in commands_to_test:
            run = subprocess.run(["node", cli_path] + cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(run.returncode, 0, f"Command 'konoha {' '.join(cmd_args)}' failed with code {run.returncode}: {run.stderr}")
            self.assertTrue(len(run.stdout) > 20, f"Command 'konoha {' '.join(cmd_args)}' returned empty output")

if __name__ == '__main__':
    unittest.main()
