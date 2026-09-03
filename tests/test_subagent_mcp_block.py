#!/usr/bin/env python3
"""Tests for the subagent MCP block injection and tool boundaries."""
import os
import sys
import unittest
import json
import tempfile

# Add src to path
src_path = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, src_path)
import server

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


class TestSubagentMCPBlock(unittest.TestCase):
    """Test that the MCP tools block is correctly injected into subagent prompts."""

    SUBAGENTS = ["genin", "chunin", "kage", "jonin", "anbu", "tokubetsu-jonin"]

    def setUp(self):
        self.task_dir = tempfile.mkdtemp()
        with open(os.path.join(self.task_dir, "delegate.md"), "w") as f:
            f.write("Analyze this codebase and improve it.")

    def _invoke(self, agent_name):
        """Invoke an agent and return the instructions string."""
        res = json.loads(server.run_mcp_agent(agent_name=agent_name, task_dir=self.task_dir))
        return res.get("instructions", "")

    def test_block_appears_before_task_instructions(self):
        """The MCP block must appear before the TASK INSTRUCTIONS section."""
        text = self._invoke("kage")
        block_idx = text.find("MCP Tools Available To You")
        task_idx = text.find("## TASK INSTRUCTIONS")
        self.assertGreater(block_idx, -1, "block missing")
        self.assertGreater(task_idx, -1, "task section missing")
        self.assertLess(block_idx, task_idx,
                        "MCP block must appear before TASK INSTRUCTIONS")

    def test_core_mcp_tools_shared_across_subagents(self):
        """All subagents must receive the core Konoha and Semble tools."""
        for a in self.SUBAGENTS:
            text = self._invoke(a)
            self.assertIn("mcp__konoha__sannin", text)
            self.assertIn("mcp__konoha__find_skill", text)
            self.assertIn("mcp__konoha__get_skill", text)
            self.assertIn("mcp__semble__search", text)
            self.assertIn("mcp__semble__find_related", text)

    def test_routing_rules_present(self):
        """The MCP block should mention routing rules for subagents."""
        text = self._invoke("kage")
        self.assertIn("mcp__konoha__sannin", text)
        self.assertIn("mcp__konoha__find_skill", text)

    def test_genin_and_kage_cannot_reach_aislop_fix(self):
        """Genin and Kage get aislop_scan/aislop_why, but never aislop_fix/aislop_baseline."""
        for role in ("genin", "kage"):
            text = self._invoke(role)
            tools_section = text[text.find("## MCP Tools Available To You"):text.find("### Strict Tool Boundaries")]
            self.assertIn("aislop_scan", tools_section, f"{role} should have aislop_scan")
            self.assertIn("aislop_why", tools_section, f"{role} should have aislop_why")
            self.assertNotIn("aislop_fix", tools_section, f"{role} must not have aislop_fix")
            self.assertNotIn("aislop_baseline", tools_section, f"{role} must not have aislop_baseline")

    def test_anbu_and_jonin_can_reach_aislop_fix(self):
        """Jonin and Anbu (execution agents) get aislop_fix for remediation."""
        for role in ("jonin", "anbu"):
            text = self._invoke(role)
            tools_section = text[text.find("## MCP Tools Available To You"):text.find("### Strict Tool Boundaries")]
            self.assertIn("aislop_scan", tools_section, f"{role} should have aislop_scan")
            self.assertIn("aislop_why", tools_section, f"{role} should have aislop_why")
            self.assertIn("aislop_fix", tools_section, f"{role} should have aislop_fix")
            self.assertNotIn("aislop_baseline", tools_section, f"{role} must not have aislop_baseline")


if __name__ == "__main__":
    unittest.main()
