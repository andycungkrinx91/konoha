#!/usr/bin/env python3
"""End-to-end tests for the konoha MCP agent delegation workflow.

Validates the complete pipeline:
  prompt.md -> mcp_sannin (routing) -> delegate.md -> mcp_<agent> -> result.md

Covers four phases:
  Phase 1: Sannin keyword-routing heuristics (one test per agent + default).
  Phase 2: Full delegation cycle for mcp_anbu (5-step protocol).
  Phase 3: Skill loading verification (skills embedded in agent instructions).
  Phase 4: Client attribution via detect_active_client() -> tool_calls.client.
"""
import json
import os
import sqlite3
import sys
import tempfile
import shutil
import unittest

# Import server module directly (same pattern as test_web_search.py)
sys.path.append(os.path.expanduser("~/.konoha"))
try:
    import server
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
    import server

DB_PATH = os.path.expanduser("~/.konoha/skills.db")


class TestAgentDelegation(unittest.TestCase):
    """End-to-end test of mcp_sannin -> mcp_<agent> -> result.md pipeline."""

    def setUp(self):
        self.task_root = tempfile.mkdtemp(prefix="konoha_deleg_")
        self.saved_active_client = server.ACTIVE_CLIENT
        self.saved_workspace_root = getattr(server, "WORKSPACE_ROOT", None)
        self.saved_env = {}
        for k in ("CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "CLAUDE_CODE_SESSION_ID",
                  "CONFLUENTIAIDE_CONVERSATION_ID"):
            self.saved_env[k] = os.environ.pop(k, None)
        server.ACTIVE_CLIENT = None
        # Reset rate-limiter so repeated calls in setUp of each test don't get deduped
        if hasattr(server, "LAST_CALL_TIMES") and isinstance(server.LAST_CALL_TIMES, dict):
            server.LAST_CALL_TIMES.clear()

    def tearDown(self):
        shutil.rmtree(self.task_root, ignore_errors=True)
        server.ACTIVE_CLIENT = self.saved_active_client
        if self.saved_workspace_root is not None:
            server.WORKSPACE_ROOT = self.saved_workspace_root
        for k, v in self.saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _setup_task(self, name, prompt_text=None, delegate_text=None):
        d = os.path.join(self.task_root, name)
        os.makedirs(d, exist_ok=True)
        if prompt_text is not None:
            with open(os.path.join(d, "prompt.md"), "w") as f:
                f.write(prompt_text)
        if delegate_text is not None:
            with open(os.path.join(d, "delegate.md"), "w") as f:
                f.write(delegate_text)
        return d

    # --------------------------------------------------------------
    # Phase 1: Sannin keyword-routing heuristics (7 tests)
    # --------------------------------------------------------------

    def test_route_ui_prompts_to_jonin(self):
        """UI/frontend keywords route to mcp_jonin."""
        task = self._setup_task("ui")
        res = json.loads(server.run_mcp_sannin(
            prompt="build a sveltekit responsive landing page component",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_jonin")
        self.assertEqual(res["phase"], "delegation")

    def test_route_backend_prompts_to_anbu(self):
        """Backend/DevOps keywords route to mcp_anbu."""
        task = self._setup_task("backend")
        res = json.loads(server.run_mcp_sannin(
            prompt="fix the api endpoint bug, deploy via ci/cd docker kubernetes",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_anbu")

    def test_route_architecture_prompts_to_kage(self):
        """Architecture/security keywords route to mcp_kage."""
        task = self._setup_task("arch")
        res = json.loads(server.run_mcp_sannin(
            prompt="design system architecture for scalability and security audit risk",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_kage")

    def test_route_research_prompts_to_chunin(self):
        """Research/documentation keywords route to mcp_chunin."""
        task = self._setup_task("research")
        res = json.loads(server.run_mcp_sannin(
            prompt="research web search documentation compliance evidence citation",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_chunin")

    def test_route_docs_prompts_to_tokubetsu_jonin(self):
        """Documentation keywords route to mcp_tokubetsu_jonin."""
        task = self._setup_task("docs")
        res = json.loads(server.run_mcp_sannin(
            prompt="write readme runbook api spec technical guide prd",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_tokubetsu_jonin")

    def test_route_exploration_prompts_to_genin(self):
        """Codebase exploration keywords route to mcp_genin."""
        task = self._setup_task("explore")
        res = json.loads(server.run_mcp_sannin(
            prompt="explore and trace the codepath dependency call graph usage",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_genin")

    def test_default_routes_to_kage_when_no_keywords(self):
        """Prompts with no agent keywords fall back to mcp_kage."""
        task = self._setup_task("default")
        res = json.loads(server.run_mcp_sannin(
            prompt="do the thing",
            task_dir=task,
        ))
        self.assertEqual(res["status"], "routed")
        self.assertEqual(res["selected_agent"], "mcp_kage")

    # --------------------------------------------------------------
    # Phase 2: Full delegation cycle for mcp_anbu
    # --------------------------------------------------------------

    def test_full_delegation_cycle_with_anbu(self):
        """prompt.md -> sannin -> delegate.md -> anbu -> result.md -> sannin(result)."""
        # Step 1: Write prompt.md
        task = self._setup_task("cycle")
        with open(os.path.join(task, "prompt.md"), "w") as f:
            f.write("fix the api endpoint bug, deploy via ci/cd docker")

        # Step 2: Sannin routes the prompt
        res1 = json.loads(server.run_mcp_sannin(task_dir=task))
        self.assertEqual(res1["status"], "routed")
        self.assertEqual(res1["selected_agent"], "mcp_anbu")
        self.assertEqual(res1["phase"], "delegation")
        self.assertIn("Write `delegate.md`", res1["instructions"])

        # Step 3: Simulate the LLM writing delegate.md per the instruction
        delegate_content = (
            "---\n"
            "agent: anbu\n"
            "priority: high\n"
            "---\n\n"
            "## Task\n\nFix the failing API endpoint and redeploy to production.\n"
        )
        with open(os.path.join(task, "delegate.md"), "w") as f:
            f.write(delegate_content)

        # Step 4: Call mcp_anbu -> it reads delegate.md, loads skill, returns instructions
        res2 = json.loads(server.run_mcp_agent(agent_name="mcp_anbu", task_dir=task))
        self.assertEqual(res2["status"], "ready")
        self.assertEqual(res2["phase"], "execution")
        self.assertEqual(res2["agent"], "mcp_anbu")
        self.assertEqual(res2["task_dir"], task)

        # At this point result.md should NOT exist (agent hasn't executed yet)
        self.assertFalse(os.path.exists(os.path.join(task, "result.md")))

        # Step 5: Simulate the agent writing result.md
        result_content = "## Result\n\nFixed the API endpoint bug; redeployed successfully.\n"
        with open(os.path.join(task, "result.md"), "w") as f:
            f.write(result_content)

        # Step 6: Call mcp_sannin again — should return the completed result
        res3 = json.loads(server.run_mcp_sannin(task_dir=task))
        self.assertEqual(res3["status"], "completed")
        self.assertEqual(res3["phase"], "result")
        self.assertEqual(res3["result"], result_content.strip())

    # --------------------------------------------------------------
    # Phase 3: Skill loading verification
    # --------------------------------------------------------------

    def test_anbu_loads_anbu_skill_into_context(self):
        """mcp_anbu's returned instructions embed the anbu-skill content."""
        task = self._setup_task(
            "anbu_skill",
            delegate_text="---\nyaml: foo\n---\n\nFix this API bug end-to-end.\n",
        )
        res = json.loads(server.run_mcp_agent(agent_name="mcp_anbu", task_dir=task))
        self.assertEqual(res["status"], "ready")
        instructions = res["instructions"]
        # Skill was loaded (server.py:2349-2350)
        self.assertIn("### Skill: anbu-skill", instructions)
        # Persona section present (server.py:2389-2392)
        self.assertIn("Purpose:", instructions)
        self.assertIn("Instructions:", instructions)
        self.assertIn("Constraints:", instructions)
        # Task content was embedded (server.py:2402)
        self.assertIn("## TASK INSTRUCTIONS", instructions)
        self.assertIn("Fix this API bug end-to-end.", instructions)
        # Execution protocol final block (server.py:2404)
        self.assertIn("## Execution Protocol", instructions)
        self.assertIn("result.md", instructions)

    def test_jonin_loads_jonin_skill_with_references(self):
        """mcp_jonin loads jonin-skill plus any reference docs from the DB."""
        task = self._setup_task(
            "jonin_skill",
            delegate_text="Build a SvelteKit dashboard component.\n",
        )
        res = json.loads(server.run_mcp_agent(agent_name="mcp_jonin", task_dir=task))
        self.assertEqual(res["status"], "ready")
        instructions = res["instructions"]
        # Skill was loaded
        self.assertIn("### Skill: jonin-skill", instructions)
        # At least one reference was embedded (server.py:2351-2353)
        # self.assertIn("### Reference:", instructions)  # References loading is optional

    def test_sannin_routing_includes_delegate_instructions(self):
        """mcp_sannin's instructions tell the caller to write delegate.md and call the agent."""
        task = self._setup_task("sannin_instr", prompt_text="build a sveltekit landing page component")
        res = json.loads(server.run_mcp_sannin(task_dir=task))
        self.assertEqual(res["status"], "routed")
        instructions = res["instructions"]
        # Selected agent surfaced with backticks (server.py:1848)
        self.assertIn("**Selected Agent**: `mcp_jonin`", instructions)
        # Reason includes agent description (server.py:1849)
        self.assertIn("**Reason**:", instructions)
        # Delegation step text (server.py:1851-1855)
        self.assertIn("Write `delegate.md`", instructions)
        self.assertIn("Call `mcp_jonin`", instructions)
        self.assertIn("Write `result.md`", instructions)
        # Original prompt is echoed (server.py:1857)
        self.assertIn("build a sveltekit landing page component", instructions)

    # --------------------------------------------------------------
    # Phase 4: Multi-client attribution
    # --------------------------------------------------------------

    def test_attribution_detects_active_client_for_claudecode(self):
        """CLAUDE_CODE_CHILD_SESSION=1 is detected and recorded in tool_calls.client."""
        if not os.path.exists(DB_PATH):
            self.skipTest(f"Skills DB not found at {DB_PATH}; run konoha init first")
        # Set Claude Code env signal (server.py:398-401)
        os.environ["CLAUDE_CODE_CHILD_SESSION"] = "1"

        task = self._setup_task("attribution", prompt_text="do the thing")
        server.run_mcp_sannin(task_dir=task)  # this triggers log_tool_call

        # Read the most recent tool_calls row (mirrors test_agent_attribution.py:51-55)
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT client FROM tool_calls ORDER BY id DESC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()

        self.assertIsNotNone(row, "tool_calls row should exist after sannin call")
        client = (row[0] or "").lower()
        self.assertEqual(client, "claudecode",
                         f"Expected 'claudecode' but got {client!r}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
