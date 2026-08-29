#!/usr/bin/env python3
"""
tests/test_kage_reviewer_workflow.py — Verifies Kage as mandatory Reviewer before final delivery.
Verifies:
1. Workflow transitions through: route -> explore (genin) -> plan (kage) -> execute (anbu/jonin) -> document (tokubetsu) -> review (kage).
2. Kage verifies that all tasks are 100% completed.
3. Kage rejects approval if any task is incomplete, has validation errors, or fails security checks.
4. Kage approves valid execution, enabling advancement to synthesize (sannin) -> done.
"""

import sys
import os
import tempfile
import unittest
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
import server

class TestKageReviewerWorkflow(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.task_dir = self.tmp_dir.name

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_kage_review_dispatch_when_in_review_phase(self):
        # Setup workflow in review phase
        status = {
            "phase": "review",
            "tasks": [
                {"id": "task-1", "agent": "anbu", "task": "Build backend", "status": "completed", "result": "Done", "validation": ["pass"]}
            ],
            "executed": {
                "task-1": {"agent": "anbu", "task": "Build backend", "result": "Done", "validation": ["pass"]}
            }
        }
        server._save_workflow_status(self.task_dir, status)

        # 1. Run workflow loop: Should dispatch Kage as reviewer
        res_json = server.run_mcp_workflow(task_dir=self.task_dir)
        res = json.loads(res_json)
        self.assertEqual(res["status"], "ready")
        self.assertEqual(res["phase"], "review")
        self.assertEqual(res["agent"], "kage")
        self.assertTrue(os.path.exists(os.path.join(self.task_dir, "delegate.md")))

    def test_kage_review_rejection_on_validation_errors(self):
        # 1. Dispatch Kage
        status = {
            "phase": "review",
            "tasks": [
                {"id": "task-1", "agent": "anbu", "task": "Build backend", "status": "completed", "result": "Done", "validation": ["pass"]}
            ]
        }
        server._save_workflow_status(self.task_dir, status)
        server.run_mcp_workflow(task_dir=self.task_dir)

        # 2. Write review with validation failure and result.md
        review_artifact = {
            "approved": False,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "validation": ["FAIL: CVE vulnerability in dependency"]
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Review completed with failures.")

        # 3. Advance workflow: Must be blocked
        res_json = server.run_mcp_workflow(task_dir=self.task_dir)
        res = json.loads(res_json)
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["phase"], "review")
        self.assertIn("Kage review", res["message"])

    def test_kage_review_rejection_on_low_confidence(self):
        # 1. Dispatch Kage
        status = {
            "phase": "review",
            "tasks": [
                {"id": "task-1", "agent": "anbu", "task": "Build backend", "status": "completed", "result": "Done", "validation": ["pass"]}
            ]
        }
        server._save_workflow_status(self.task_dir, status)
        server.run_mcp_workflow(task_dir=self.task_dir)

        # 2. Write review with low confidence (85% < 90%)
        review_artifact = {
            "approved": True,
            "confidence": 85,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "validation": ["all tests passed"]
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Review completed with 85% confidence.")

        # 3. Advance workflow: Must be blocked because confidence < 90%
        res_json = server.run_mcp_workflow(task_dir=self.task_dir)
        res = json.loads(res_json)
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["phase"], "review")

    def test_kage_review_approval_advances_to_synthesize(self):
        # 1. Dispatch Kage
        status = {
            "phase": "review",
            "tasks": [
                {"id": "task-1", "agent": "anbu", "task": "Build backend", "status": "completed", "result": "Done", "validation": ["pass"]}
            ],
            "executed": {
                "task-1": {"agent": "anbu", "task": "Build backend", "result": "Done", "validation": ["pass"]}
            }
        }
        server._save_workflow_status(self.task_dir, status)
        server.run_mcp_workflow(task_dir=self.task_dir)

        # Create a transient debug script to verify cleanup
        debug_script = os.path.join(self.task_dir, "debug_check.py")
        with open(debug_script, "w") as f:
            f.write("# temp debug script")

        # 2. Write clean approved review with 95% confidence and result.md
        review_artifact = {
            "approved": True,
            "confidence": 95,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "validation": ["all 10 tests passed successfully"]
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Kage review verified all tasks and security requirements.")

        # 3. Advance workflow: Must transition to synthesize (sannin)
        res_json = server.run_mcp_workflow(task_dir=self.task_dir)
        res = json.loads(res_json)
        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["phase"], "done")
        self.assertTrue(os.path.exists(os.path.join(self.task_dir, "final_report.md")))
        # Verify transient debug file was cleaned up
        self.assertFalse(os.path.exists(debug_script))

if __name__ == '__main__':
    unittest.main()
