#!/usr/bin/env python3
"""Regression test: konoha must NEVER write scratch/task files inside the user's project.

The old behavior was `<workspace>/scratch/tasks/<task_id>/` which lives in the
project root, so a developer running `git add .` could accidentally commit a
transient delegate.md or result.md. This test asserts that
`get_resolved_task_dir()` always returns a path under `~/.konoha/tmp/<client>/...`
(or the /tmp fallback), never under WORKSPACE_ROOT.
"""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.append(os.path.expanduser("~/.konoha"))
try:
    import server
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
    import server


class TestScratchPathOutOfWorkspace(unittest.TestCase):
    def setUp(self):
        self.saved_active_client = server.ACTIVE_CLIENT
        self.saved_workspace_root = server.WORKSPACE_ROOT
        self.fake_workspace = tempfile.mkdtemp(prefix="konoha_scratch_test_workspace_")
        server.WORKSPACE_ROOT = self.fake_workspace
        server.ACTIVE_CLIENT = "claudecode"

    def tearDown(self):
        server.ACTIVE_CLIENT = self.saved_active_client
        server.WORKSPACE_ROOT = self.saved_workspace_root
        shutil.rmtree(self.fake_workspace, ignore_errors=True)

    def test_default_task_dir_lives_outside_workspace(self):
        td = server.get_resolved_task_dir()
        self.assertFalse(
            td.startswith(self.fake_workspace),
            f"task_dir {td!r} must not be inside workspace {self.fake_workspace!r}",
        )

    def test_default_task_dir_lives_under_konoha_tmp(self):
        td = server.get_resolved_task_dir()
        expected_root = os.path.expanduser("~/.konoha/tmp")
        self.assertTrue(
            td.startswith(expected_root) or td.startswith("/tmp/konoha-"),
            f"task_dir {td!r} should be under ~/.konoha/tmp or /tmp fallback",
        )

    def test_default_task_dir_uses_client_and_session_subdirs(self):
        td = server.get_resolved_task_dir()
        # Layout: ~/.konoha/tmp/<client>/<session|default>/scratch/tasks/<leaf>
        normalized = os.path.normpath(td)
        self.assertIn("konoha", normalized)
        # The active client "claudecode" should appear in the path
        self.assertIn("claudecode", td)

    def test_relative_task_dir_resolves_outside_workspace(self):
        td = server.get_resolved_task_dir(task_dir="my-task")
        self.assertFalse(
            td.startswith(self.fake_workspace),
            f"relative task_dir resolved to {td!r} which is inside workspace",
        )

    def test_existing_filesystem_does_not_get_task_dir_under_workspace(self):
        """If the legacy scratch dir somehow exists in workspace, we must NOT
        pick a subdir of it — the new resolver always builds a fresh path."""
        legacy = os.path.join(self.fake_workspace, "scratch", "tasks", "leftover")
        os.makedirs(legacy, exist_ok=True)
        td = server.get_resolved_task_dir()
        self.assertFalse(
            td.startswith(self.fake_workspace),
            f"resolver reused legacy workspace scratch dir: {td!r}",
        )

    def test_no_scratch_today_dir_created_under_workspace(self):
        """Calling the resolver must not create any scratch dir inside the
        workspace — only under ~/.konoha/tmp/..."""
        before = set()
        for root, dirs, _files in os.walk(self.fake_workspace):
            for d in dirs:
                before.add(os.path.join(root, d))
        _ = server.get_resolved_task_dir()
        after = set()
        for root, dirs, _files in os.walk(self.fake_workspace):
            for d in dirs:
                after.add(os.path.join(root, d))
        new_dirs = after - before
        self.assertEqual(
            new_dirs, set(),
            f"resolver created dirs inside workspace: {new_dirs}",
        )


if __name__ == "__main__":
    unittest.main()
