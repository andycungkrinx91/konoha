#!/usr/bin/env python3
"""End-to-end tests for the mcp_workflow orchestrator.

Validates the complete multi-agent loop:
  route -> explore (genin) -> plan (kage) -> [research (chunin)] -> execute (anbu/jonin)
  -> document (tokubetsu-jonin) -> synthesize (sannin) -> done

Each test simulates ONE agent completing per call. After each call, the test
writes the artifact the next phase expects to find, then calls run_mcp_workflow
again.

Tests:
  T01: Missing prompt.md returns error
  T02: Route phase advances to explore (first call)
  T03: Explore phase dispatches genin with proper delegate.md
  T04: After genin result.md, next call dispatches kage
  T05: Kage plan with needs_research:true routes to chunin
  T06: After chunin result, next call re-dispatches kage
  T07: Kage plan with needs_research:false routes to execute
  T08: Execute phase dispatches first pending agent (anbu)
  T09: Execute phase dispatches next pending agent after first done
  T10: After all executors done, document phase dispatches tokubetsu-jonin
  T11: Synthesize phase writes final_report.md and sets done
  T12: Done phase returns completed status
  T13: status.json persists across calls
"""
import json
import os
import sys
import tempfile
import shutil
import unittest

# Import server module
sys.path.append(os.path.expanduser("~/.konoha"))
try:
    import server
except ImportError:
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
    import server


class TestWorkflowLoop(unittest.TestCase):
    """End-to-end tests for the mcp_workflow orchestrator."""

    def setUp(self):
        self.task_root = tempfile.mkdtemp(prefix="konoha_wf_")
        self.saved_active_client = server.ACTIVE_CLIENT
        server.ACTIVE_CLIENT = None
        if hasattr(server, "LAST_CALL_TIMES") and isinstance(server.LAST_CALL_TIMES, dict):
            server.LAST_CALL_TIMES.clear()

    def tearDown(self):
        shutil.rmtree(self.task_root, ignore_errors=True)
        server.ACTIVE_CLIENT = self.saved_active_client

    def _setup_task(self, name, prompt_text=None):
        """Create an empty task directory and optionally write prompt.md."""
        d = os.path.join(self.task_root, name)
        os.makedirs(d, exist_ok=True)
        if prompt_text is not None:
            with open(os.path.join(d, "prompt.md"), "w") as f:
                f.write(prompt_text)
        return d

    def _write_result(self, task, agent_name, summary):
        """Simulate agent completion: writes result.md + result_<agent>.md."""
        with open(os.path.join(task, "result.md"), "w") as f:
            f.write(f"## {agent_name} Output\n\n{summary}\n")
        with open(os.path.join(task, f"result_{agent_name}.md"), "w") as f:
            f.write(f"## {agent_name} Detail\n\n{summary}\n")

    def _write_findings(self, task, content):
        with open(os.path.join(task, "findings.md"), "w") as f:
            f.write(content)

    def _write_plan(self, task, content):
        with open(os.path.join(task, "plan.md"), "w") as f:
            f.write(content)

    def _write_research(self, task, content):
        with open(os.path.join(task, "research_results.json"), "w") as f:
            f.write(content)

    # --------------------------------------------------------------
    # T01: Missing prompt.md returns error
    # --------------------------------------------------------------

    def test_missing_prompt_returns_error(self):
        """Workflow should fail gracefully when no prompt.md is found."""
        task = self._setup_task("empty")
        res = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res["status"], "error")
        self.assertIn("No prompt.md", res.get("message", ""))
        self.assertEqual(res["phase"], "route")

    # --------------------------------------------------------------
    # T02: Route phase advances to explore (first call)
    # --------------------------------------------------------------

    def test_route_phase_advances_to_explore(self):
        """First call with route phase should advance to explore."""
        task = self._setup_task("route_explore", prompt_text="Refactor auth to use JWT")
        res = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res["status"], "ready")
        self.assertEqual(res["phase"], "explore")
        self.assertEqual(res["agent"], "genin")

        # Verify status.json persisted
        with open(os.path.join(task, "status.json")) as f:
            status = json.load(f)
        self.assertEqual(status["phase"], "explore")
        self.assertEqual(status["assigned_agent"], "genin")

    # --------------------------------------------------------------
    # T03: Explore phase dispatches genin
    # --------------------------------------------------------------

    def test_explore_dispatches_genin(self):
        """Exploration phase should dispatch genin with correct delegate.md content."""
        task = self._setup_task("explore_genin", prompt_text="Trace the API authentication flow end-to-end")
        res = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res["status"], "ready")
        self.assertEqual(res["phase"], "explore")
        self.assertEqual(res["agent"], "genin")

        # Verify delegate.md was written with genin frontmatter
        delegate_path = os.path.join(task, "delegate.md")
        self.assertTrue(os.path.exists(delegate_path))
        with open(delegate_path) as f:
            delegate_text = f.read()
        self.assertIn("agent: genin", delegate_text)
        self.assertIn("Phase: Explore", delegate_text)
        self.assertIn("Trace the API authentication flow end-to-end", delegate_text)
        # result.md should NOT exist yet (genin hasn't run)
        result_path = os.path.join(task, "result.md")
        self.assertFalse(os.path.exists(result_path))

    # --------------------------------------------------------------
    # T04: After genin result.md, next call dispatches kage
    # --------------------------------------------------------------

    def test_after_genin_plan_dispatches_kage(self):
        """Once genin writes result.md, next call should dispatch kage for planning."""
        task = self._setup_task("genin_plan", prompt_text="Redesign the payment module")

        # First call: route -> explore -> dispatch genin
        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        # Simulate genin completing its work
        self._write_findings(task, "# Findings\n\nPayment uses Stripe API, handled in payments/service.py\n")
        self._write_result(task, "genin", "Mapped payment module successfully.")

        # Second call: sees genin done, advances to plan, dispatches kage
        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["status"], "ready")
        self.assertEqual(r2["phase"], "plan")
        self.assertEqual(r2["agent"], "kage")

        # Verify delegate.md targets kage with findings context
        with open(os.path.join(task, "delegate.md")) as f:
            delegate_text = f.read()
        self.assertIn("agent: kage", delegate_text)
        self.assertIn("Payment uses Stripe API", delegate_text)

    # --------------------------------------------------------------
    # T05: Kage with research routes to chunin
    # --------------------------------------------------------------

    def test_kage_needs_research_routed_to_chunin(self):
        """When plan has needs_research:true, workflow dispatches chunin."""
        task = self._setup_task("plan_research", prompt_text="Implement OAuth2 flow")

        # Drive through route -> explore -> plan
        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nNo OAuth2 support currently.\n")
        self._write_result(task, "genin", "Mapped codebase.")

        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")  # kage dispatch
        self.assertEqual(r2["agent"], "kage")

        # Simulate kage producing a plan that requests research
        self._write_plan(task, "needs_research: true\nresearch_query: OAuth2 PKCE best practices\n")
        self._write_result(task, "kage", "Requires OAuth2 research.")

        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["status"], "ready")
        self.assertEqual(r3["phase"], "research")
        self.assertEqual(r3["agent"], "chunin")

    # --------------------------------------------------------------
    # T06: After chunin result, plan phase re-dispatches kage
    # --------------------------------------------------------------

    def test_after_research_plan_re_dispatches_kage(self):
        """After chunin writes result.md, plan phase should re-dispatch kage."""
        task = self._setup_task("research_plan2", prompt_text="Implement OAuth2")

        # Drive through route -> explore -> plan -> research
        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nNo OAuth2.\n")
        self._write_result(task, "genin", "Mapped.")
        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        self._write_plan(task, "needs_research: true\nresearch_query: OAuth2 PKCE\n")
        self._write_result(task, "kage", "Requires research.")
        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["phase"], "research")

        # Verify chunin dispatch details
        with open(os.path.join(task, "delegate.md")) as f:
            dtext = f.read()
        self.assertIn("agent: chunin", dtext)
        self.assertIn("OAuth2 PKCE", dtext)

        # Chunin completes -> back to plan, dispatch kage again
        self._write_research(task, '{"findings": ["PKCE recommended"], "synthesis": "Use auth code+PKCE"}')
        self._write_result(task, "chunin", "Research complete.")

        r4 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r4["status"], "ready")
        self.assertEqual(r4["phase"], "plan")
        self.assertEqual(r4["agent"], "kage")

    # --------------------------------------------------------------
    # T07: Kage without research routes to execute
    # --------------------------------------------------------------

    def test_kage_no_research_routes_to_execute(self):
        """When plan has no needs_research line, workflow goes to execute phase."""
        task = self._setup_task("plan_execute", prompt_text="Fix a CSS bug")

        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nCSS in styles/app.css line 42.\n")
        self._write_result(task, "genin", "Found CSS location.")

        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        # Plan without needs_research
        self._write_plan(task, "## Plan\n\nFix the CSS bug at line 42.\n")
        self._write_result(task, "kage", "Plan ready.")

        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["status"], "ready")
        self.assertEqual(r3["phase"], "execute")
        # First executor dispatched
        self.assertIsNotNone(r3["agent"])

    # --------------------------------------------------------------
    # T08: Execute phase dispatches first pending agent (anbu)
    # --------------------------------------------------------------

    def test_execute_dispatches_first_pending_agent(self):
        """Execute phase dispatches the first pending executor agent (anbu)."""
        task = self._setup_task("execute_anbu", prompt_text="Fix API bug")

        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nBug in api/handler.py\n")
        self._write_result(task, "genin", "Mapped.")
        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        self._write_plan(task, """## Plan

- [anbu]: Fix authentication middleware in api/handler.py
- [jonin]: Update the login form styling
""")
        self._write_result(task, "kage", "Plan ready.")

        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["status"], "ready")
        self.assertEqual(r3["phase"], "execute")
        self.assertEqual(r3["agent"], "anbu")
        # Verify delegate.md mentions anbu with task
        with open(os.path.join(task, "delegate.md")) as f:
            dtext = f.read()
        self.assertIn("agent: anbu", dtext)
        self.assertIn("authentication middleware", dtext)

    # --------------------------------------------------------------
    # T09: Execute phase dispatches second agent after first finishes
    # --------------------------------------------------------------

    def test_execute_dispatches_second_after_first_done(self):
        """After anbu finishes, execute phase dispatches jonin."""
        task = self._setup_task("execute_multi", prompt_text="Fix bug and update UI")

        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nBackend and frontend affected.\n")
        self._write_result(task, "genin", "Mapped.")
        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        self._write_plan(task, """## Plan

- [anbu]: Fix the API bug
- [jonin]: Update the login form
""")
        self._write_result(task, "kage", "Plan ready.")

        # First execute call: dispatch anbu
        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["phase"], "execute")
        self.assertEqual(r3["agent"], "anbu")

        # Simulate anbu completing
        self._write_result(task, "anbu", "API bug fixed.")

        # Second execute call: dispatch jonin
        r4 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r4["status"], "ready")
        self.assertEqual(r4["phase"], "execute")
        self.assertEqual(r4["agent"], "jonin")

    # --------------------------------------------------------------
    # T10: After all executors done, document phase dispatches tokubetsu
    # --------------------------------------------------------------

    def test_document_phase_dispatches_tokubetsu(self):
        """After all executor tasks done, workflow moves to document phase."""
        task = self._setup_task("document_phase", prompt_text="Complete feature")

        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        self._write_findings(task, "# Findings\n\nMapped.\n")
        self._write_result(task, "genin", "Mapped.")
        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        self._write_plan(task, """## Plan

- [anbu]: Build the API
- [jonin]: Build the UI
""")
        self._write_result(task, "kage", "Plan ready.")

        # execute -> anbu -> jonin
        r3 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r3["phase"], "execute")
        self.assertEqual(r3["agent"], "anbu")

        self._write_result(task, "anbu", "API built.")
        r4 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r4["phase"], "execute")
        self.assertEqual(r4["agent"], "jonin")

        self._write_result(task, "jonin", "UI built.")

        # Next call advances to document
        r5 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r5["status"], "ready")
        self.assertEqual(r5["phase"], "document")
        self.assertEqual(r5["agent"], "tokubetsu-jonin")

    # --------------------------------------------------------------
    # T11: Synthesize phase writes final_report.md and sets done
    # --------------------------------------------------------------

    def test_synthesize_writes_final_report(self):
        """Synthesize phase aggregates all outputs into final_report.md."""
        task = self._setup_task("synthesize_phase", prompt_text="Build feature X")

        # Fast-forward: set status to synthesize with executed agents
        status_path = os.path.join(task, "status.json")
        with open(status_path, "w") as f:
            json.dump({
                "phase": "synthesize",
                "assigned_agent": "sannin",
                "executed": {
                    "anbu": {"task": "Build backend", "result": "Backend complete.", "iterations": 1},
                    "jonin": {"task": "Build frontend", "result": "Frontend complete.", "iterations": 1},
                },
                "history": [],
            }, f)
        # Write plan, findings, and explicit Kage approval so synthesis can proceed.
        self._write_findings(task, "# Findings\n\nMapped.\n")
        with open(os.path.join(task, "kage_review.json"), "w") as f:
            json.dump({"approved": True, "verified_task_ids": ["anbu", "jonin"], "validation": ["all configured checks passed"], "security_reviewed": True, "rollback_reviewed": True, "ai_slop_findings": 0, "ai_slop_clean": True, "findings": []}, f)
        self._write_plan(task, "## Plan\n\nDo everything.\n")
        self._write_research(task, '{"query": "X best practices", "findings": []}')
        with open(os.path.join(task, "final_docs.md"), "w") as f:
            f.write("# Final Documentation\n\nAll compiled.")

        res = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["phase"], "done")
        self.assertIn("final_report_path", res)
        self.assertTrue(os.path.exists(os.path.join(task, "final_report.md")))

        with open(os.path.join(task, "final_report.md")) as f:
            report = f.read()
        self.assertIn("Build feature X", report)
        self.assertIn("Backend complete.", report)
        self.assertIn("Frontend complete.", report)

    # --------------------------------------------------------------
    # T12: Done phase returns completed status
    # --------------------------------------------------------------

    def test_done_phase_returns_completed(self):
        """Once phase is done, repeated calls return same completed status."""
        task = self._setup_task("done_phase", prompt_text="Some task")
        # Manually set status to done
        with open(os.path.join(task, "status.json"), "w") as f:
            json.dump({"phase": "done", "history": []}, f)

        res1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res1["status"], "completed")
        self.assertEqual(res1["phase"], "done")

        # Second call should return same
        res2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(res2["status"], "completed")
        self.assertEqual(res2["phase"], "done")

    # --------------------------------------------------------------
    # T13: status.json persists across calls
    # --------------------------------------------------------------

    def test_status_json_survives_across_calls(self):
        """Workflow state in status.json must be readable on subsequent calls."""
        task = self._setup_task("persistence", prompt_text="Test persistence")

        # First call: route -> explore
        r1 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r1["phase"], "explore")

        # Read status.json directly and verify phase
        with open(os.path.join(task, "status.json")) as f:
            status = json.load(f)
        self.assertEqual(status["phase"], "explore")
        self.assertIsNotNone(status.get("created_at"))

        # Simulate Genin done, advance to plan
        self._write_findings(task, "# Findings\n\nMapped.\n")
        self._write_result(task, "genin", "Done.")

        r2 = json.loads(server.run_mcp_workflow(task_dir=task))
        self.assertEqual(r2["phase"], "plan")

        # Verify status.json updated
        with open(os.path.join(task, "status.json")) as f:
            status = json.load(f)
        self.assertEqual(status["phase"], "plan")
        self.assertEqual(status["assigned_agent"], "kage")
        # History should have entries
        self.assertGreaterEqual(len(status.get("history", [])), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)