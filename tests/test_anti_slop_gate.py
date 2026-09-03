#!/usr/bin/env python3
"""tests/test_anti_slop_gate.py — Verifies the Zero-AI-Slop Gate (aislop MCP Integration).

Covers Part D requirements from PLAN_FEATURE.md:
D.1 Gate-blocking tests (zero-slop verification, missing fields block, clean pass, report row)
D.2 Tool-boundary tests (Genin & Kage read-only, Anbu & Jonin execution auto-fix)
D.3 Config wiring smoke test (Antigravity, Cursor, Claude Code, Command Code, OpenCode, Codex)
D.4 Dispatch-instruction consistency test (kage delegate.md requires ai_slop_findings & ai_slop_clean)
"""

import sys
import os
import tempfile
import unittest
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import server

class TestAntiSlopGate(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.task_dir = self.tmp_dir.name

    def tearDown(self):
        self.tmp_dir.cleanup()

    # --- D.1 Gate-blocking tests ---

    def test_blocked_when_ai_slop_findings_nonzero(self):
        """Assert run_mcp_workflow returns status: blocked when ai_slop_findings > 0 even with 100% confidence."""
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

        # Write review with 100% confidence but 3 ai_slop findings
        review_artifact = {
            "approved": True,
            "confidence": 100,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "validation": ["all tests passed"],
            "ai_slop_findings": 3,
            "ai_slop_clean": False,
            "findings": []
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Review flagged AI-slop violations.")

        res = json.loads(server.run_mcp_workflow(task_dir=self.task_dir))
        self.assertEqual(res["status"], "blocked", "Non-zero ai_slop_findings must block workflow approval.")
        self.assertEqual(res["phase"], "review")

    def test_blocked_when_ai_slop_fields_missing(self):
        """Assert run_mcp_workflow blocks when ai_slop fields are omitted from kage_review.json."""
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

        # Review artifact without ai_slop fields at all
        review_artifact = {
            "approved": True,
            "confidence": 95,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "validation": ["all tests passed successfully"]
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Legacy review completed.")

        res = json.loads(server.run_mcp_workflow(task_dir=self.task_dir))
        self.assertEqual(res["status"], "blocked", "Missing ai_slop fields must block approval.")
        self.assertEqual(res["phase"], "review")

    def test_approved_when_ai_slop_clean(self):
        """Assert run_mcp_workflow approves and advances when ai_slop_findings == 0 and ai_slop_clean is True."""
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

        review_artifact = {
            "approved": True,
            "confidence": 98,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "ai_slop_findings": 0,
            "ai_slop_clean": True,
            "validation": ["all tests passed cleanly"],
            "findings": []
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Kage verified 0 AI-slop issues.")

        res = json.loads(server.run_mcp_workflow(task_dir=self.task_dir))
        self.assertEqual(res["status"], "completed", "Clean review must advance to completed phase.")
        self.assertEqual(res["phase"], "done")
        self.assertTrue(os.path.exists(os.path.join(self.task_dir, "final_report.md")))

    def test_confidence_gate_report_includes_ai_slop_row(self):
        """Assert the generated final report contains the AI Slop Scan row with evaluated findings."""
        status = {
            "phase": "review",
            "tasks": [
                {"id": "task-1", "agent": "jonin", "task": "Build UI", "status": "completed", "result": "Done", "validation": ["pass"]}
            ],
            "executed": {
                "task-1": {"agent": "jonin", "task": "Build UI", "result": "Done", "validation": ["pass"]}
            }
        }
        server._save_workflow_status(self.task_dir, status)
        server.run_mcp_workflow(task_dir=self.task_dir)

        review_artifact = {
            "approved": True,
            "confidence": 99,
            "verified_task_ids": ["task-1"],
            "security_reviewed": True,
            "rollback_reviewed": True,
            "ai_slop_findings": 0,
            "ai_slop_clean": True,
            "validation": ["all tests passed cleanly"],
            "findings": []
        }
        with open(os.path.join(self.task_dir, "kage_review.json"), "w") as f:
            json.dump(review_artifact, f)
        with open(os.path.join(self.task_dir, "result.md"), "w") as f:
            f.write("Review complete.")

        server.run_mcp_workflow(task_dir=self.task_dir)
        report_path = os.path.join(self.task_dir, "final_report.md")
        self.assertTrue(os.path.exists(report_path))
        with open(report_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("| **AI Slop Scan** | All changed files | ai_slop_findings = 0 | **100%** | ✅ Passed |", content)

    # --- D.2 Tool-boundary tests ---

    def test_genin_and_kage_cannot_reach_aislop_fix(self):
        """Genin and Kage subagents have aislop_scan/aislop_why but not aislop_fix/aislop_baseline."""
        with open(os.path.join(self.task_dir, "delegate.md"), "w") as f:
            f.write("Analyze and plan.")

        for role in ("genin", "kage"):
            res = json.loads(server.run_mcp_agent(agent_name=role, task_dir=self.task_dir))
            instructions = res.get("instructions", "")
            tools_section = instructions[instructions.find("## MCP Tools Available To You"):instructions.find("### Strict Tool Boundaries")]
            self.assertIn("aislop_scan", tools_section, f"{role} must have aislop_scan")
            self.assertIn("aislop_why", tools_section, f"{role} must have aislop_why")
            self.assertNotIn("aislop_fix", tools_section, f"{role} must NOT have aislop_fix")
            self.assertNotIn("aislop_baseline", tools_section, f"{role} must NOT have aislop_baseline")

    def test_anbu_and_jonin_can_reach_aislop_fix(self):
        """Jonin and Anbu execution agents have aislop_fix for code remediation."""
        with open(os.path.join(self.task_dir, "delegate.md"), "w") as f:
            f.write("Build and fix.")

        for role in ("jonin", "anbu"):
            res = json.loads(server.run_mcp_agent(agent_name=role, task_dir=self.task_dir))
            instructions = res.get("instructions", "")
            tools_section = instructions[instructions.find("## MCP Tools Available To You"):instructions.find("### Strict Tool Boundaries")]
            self.assertIn("aislop_scan", tools_section, f"{role} must have aislop_scan")
            self.assertIn("aislop_why", tools_section, f"{role} must have aislop_why")
            self.assertIn("aislop_fix", tools_section, f"{role} must have aislop_fix")
            self.assertNotIn("aislop_baseline", tools_section, f"{role} must NOT have aislop_baseline")

    # --- D.3 Config wiring smoke test ---

    def test_aislop_mcp_config_present(self):
        """Assert that aislop MCP configuration is properly defined and generated across client bootstrap templates."""
        import subprocess
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        js_code1 = "const { updateCodexTomlMcp } = require('./src/codex_manager'); console.log(updateCodexTomlMcp('', 'python3', '/path/to/server.py', 'uvx'));"
        out = subprocess.check_output(["node", "-e", js_code1], cwd=root_dir).decode("utf-8")
        self.assertIn("[mcp_servers.aislop]", out)
        self.assertIn("aislop_scan", out)
        self.assertIn("aislop_fix", out)

        # Test mcp_clients_manager (Claude & Command Code)
        js_code2 = "const { buildStdioMcpServers, KONOHA_MCP_NAMES } = require('./src/mcp_clients_manager'); const s = buildStdioMcpServers({}); console.log(JSON.stringify({names: KONOHA_MCP_NAMES, servers: s}));"
        out2 = json.loads(subprocess.check_output(["node", "-e", js_code2], cwd=root_dir).decode("utf-8"))
        self.assertIn("aislop", out2["names"])
        self.assertIn("aislop", out2["servers"])

        # Test project .aislop/config.yml exists
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.assertTrue(os.path.exists(os.path.join(project_root, ".aislop", "config.yml")))

    # --- D.4 Dispatch-instruction consistency test ---

    def test_kage_dispatch_prompt_mentions_ai_slop_fields(self):
        """Assert Kage review dispatch instruction in delegate.md explicitly requires ai_slop_findings and ai_slop_clean."""
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

        delegate_path = os.path.join(self.task_dir, "delegate.md")
        self.assertTrue(os.path.exists(delegate_path))
        with open(delegate_path, "r", encoding="utf-8") as f:
            prompt_text = f.read()

        self.assertIn("aislop_scan", prompt_text)
        self.assertIn("ai_slop_findings", prompt_text)
        self.assertIn("ai_slop_clean", prompt_text)


if __name__ == "__main__":
    unittest.main()
