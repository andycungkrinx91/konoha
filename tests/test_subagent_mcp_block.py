#!/usr/bin/env python3
"""Tests for the subagent MCP block injection."""
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

    SUBAGENTS = ["mcp_genin", "mcp_chunin", "mcp_kage", "mcp_jonin", "mcp_anbu", "mcp_tokubetsu-jonin"]

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
        text = self._invoke("mcp_kage")
        block_idx = text.find("MCP Tools Available To You")
        task_idx = text.find("## TASK INSTRUCTIONS")
        self.assertGreater(block_idx, -1, "block missing")
        self.assertGreater(task_idx, -1, "task section missing")
        self.assertLess(block_idx, task_idx,
                        "MCP block must appear before TASK INSTRUCTIONS")

    def test_block_is_shared_across_subagents(self):
        """The MCP block is the shared preamble injected by
        build_subagent_mcp_block(). It starts at "MCP Tools Available
        To You" and ends at the "### Strict Tool Boundaries" section.
        """
        import re

        def block(text):
            start = text.find("MCP Tools Available To You")
            self.assertGreater(start, -1, "block start missing")
            after = text[start + 1:]
            # Find the end of the MCP block (before subagent-specific content)
            m = re.search(r"\n### Strict Tool Boundaries", after)
            if m:
                return after[:m.start()]
            # Fallback: return everything after start
            return after

        seen = {block(self._invoke(a)) for a in self.SUBAGENTS}
        self.assertEqual(
            len(seen), 1,
            f"Expected identical MCP block across subagents, got {len(seen)} variants",
        )

    def test_routing_rules_present(self):
        """The MCP block should mention routing rules for subagents."""
        text = self._invoke("mcp_kage")
        # Check that the block mentions key routing tools
        self.assertIn("mcp__konoha__mcp_sannin", text)
        self.assertIn("mcp__konoha__find_skill", text)


if __name__ == "__main__":
    unittest.main()
