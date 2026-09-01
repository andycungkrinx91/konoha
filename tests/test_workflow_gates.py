#!/usr/bin/env python3
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import server


class TestWorkflowGates(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="konoha_gate_")
        self.previous_root = server.WORKSPACE_ROOT
        server.WORKSPACE_ROOT = self.root

    def tearDown(self):
        server.WORKSPACE_ROOT = self.previous_root
        shutil.rmtree(self.root, ignore_errors=True)

    def _write(self, name, value):
        Path(self.root, name).write_text(value, encoding="utf-8")

    def _advance_to_plan(self):
        self._write("prompt.md", "Implement a small backend fix")
        first = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(first["phase"], "explore")
        self._write("findings.md", "The backend fix is isolated.")
        self._write("result.md", "Genin completed exploration.")
        second = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(second["phase"], "plan")
        return second

    def test_stale_result_does_not_complete_new_dispatch(self):
        self._write("prompt.md", "Implement a fix")
        first = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(first["phase"], "explore")
        before = json.loads(Path(self.root, "status.json").read_text())
        second = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(second["phase"], "explore")
        after = json.loads(Path(self.root, "status.json").read_text())
        self.assertEqual(before["current_dispatch"]["id"], after["current_dispatch"]["id"])
        self.assertEqual(after["completed_dispatches"], [])

    def test_duplicate_agent_tasks_remain_unique(self):
        self._advance_to_plan()
        self._write("plan.md", "- [anbu]: Fix the API\n- [anbu]: Add the regression test\n")
        self._write("result.md", "Kage approved two separate tasks.")
        execute = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(execute["phase"], "execute")
        status = json.loads(Path(self.root, "status.json").read_text())
        self.assertEqual([task["id"] for task in status["tasks"]], ["task-1", "task-2"])
        self.assertEqual([task["task"] for task in status["tasks"]], ["Fix the API", "Add the regression test"])

    def test_kage_review_blocks_then_approves_delivery(self):
        self._advance_to_plan()
        self._write("plan.md", "- [anbu]: Fix the API\n")
        self._write("result.md", "Kage approved the implementation plan.")
        execute = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(execute["agent"], "anbu")
        self._write("result.md", "API fixed.")
        document = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(document["phase"], "document")
        self._write("result.md", "Documentation complete.")
        review = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(review["phase"], "review")
        self._write("result.md", "Review rejected because validation is missing.")
        blocked = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(blocked["status"], "blocked")
        self._write("kage_review.json", json.dumps({"approved": True, "verified_task_ids": ["task-1"], "validation": ["all configured checks passed"], "security_reviewed": True, "rollback_reviewed": True, "findings": []}))
        self._write("result.md", "Kage approved all work.")
        approved = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(approved["phase"], "done")
        self.assertTrue(Path(self.root, "final_report.md").exists())
        delivered = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(delivered["phase"], "done")

    def test_structured_report_completes_active_task(self):
        self._advance_to_plan()
        self._write("plan.md", "- [anbu]: Fix the API\n")
        self._write("result.md", "Kage approved the implementation plan.")
        execute = json.loads(server.run_mcp_workflow(self.root))
        report = json.loads(server.report_from_agent(
            "anbu", "API fixed", task_dir=self.root,
            dispatch_id=execute["dispatch_id"], validation=["npm run build exited 0"],
        ))
        self.assertEqual(report["status"], "recorded")
        self.assertTrue(report["verified"])
        status = json.loads(Path(self.root, "status.json").read_text())
        self.assertEqual(status["tasks"][0]["status"], "completed")
        self.assertTrue(status["tasks"][0]["verified"])
        next_state = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(next_state["phase"], "document")

    def test_unverified_report_blocks_task_completion(self):
        """A report without real validation evidence must not complete the
        task — the workflow re-dispatches instead of advancing."""
        self._advance_to_plan()
        self._write("plan.md", "- [anbu]: Fix the API\n")
        self._write("result.md", "Kage approved the implementation plan.")
        execute = json.loads(server.run_mcp_workflow(self.root))
        report = json.loads(server.report_from_agent(
            "anbu", "API fixed (claimed)", task_dir=self.root,
            dispatch_id=execute["dispatch_id"], validation=["pass"],
        ))
        self.assertEqual(report["status"], "recorded")
        self.assertFalse(report["verified"])
        self.assertEqual(report["task_status"], "unverified")
        self.assertIn("remediation", report)
        status = json.loads(Path(self.root, "status.json").read_text())
        self.assertEqual(status["tasks"][0]["status"], "unverified")
        self.assertFalse(status["tasks"][0]["verified"])
        next_state = json.loads(server.run_mcp_workflow(self.root))
        self.assertEqual(next_state["phase"], "execute")


if __name__ == "__main__":
    unittest.main()
