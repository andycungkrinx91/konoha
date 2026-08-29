"""
Integration test for the full delegation chain:
  Sannin (routing) -> Agent tool (persona/skills from SQLite) -> Result (completion).

All delegation is via MCP JSON-RPC over stdin/stdout — no filesystem mirrors.
"""

import json
import os
import subprocess
import sys
import tempfile
import shutil
import unittest


# Helper to read a response from the MCP server
def _send_and_read(proc, msg):
    payload = json.dumps(msg) + "\n"
    proc.stdin.write(payload)
    proc.stdin.flush()
    return json.loads(proc.stdout.readline())


class TestDelegationChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_proc = subprocess.Popen(
            [sys.executable, "server.py"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        import time
        time.sleep(0.5)
        initialized = _send_and_read(cls.server_proc, {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "delegation-chain-test"}},
        })
        if "result" not in initialized:
            raise RuntimeError(f"MCP initialization failed: {initialized}")

    @classmethod
    def tearDownClass(cls):
        cls.server_proc.terminate()
        cls.server_proc.wait()

    def _call(self, tool_name, arguments, req_id=1):
        return _send_and_read(self.server_proc, {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        })

    def _unwrap(self, resp):
        """Return (result_dict, has_error). result_dict is the parsed inner JSON."""
        if "error" in resp:
            return {"status": "transport_error", "message": resp["error"]["message"]}, True
        text = resp["result"]["content"][0]["text"]
        try:
            return json.loads(text), False
        except json.JSONDecodeError:
            return {"raw": text}, False

    # ------------------------------------------------------------------ #
    # ROUTING TESTS
    # ------------------------------------------------------------------ #

    def test_sannin_no_prompt_returns_error(self):
        td = tempfile.mkdtemp()
        try:
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertTrue(err or resp.get("status") == "error")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_jonin_frontend(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Build a responsive SvelteKit dashboard page with Tailwind CSS")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "jonin")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_anbu_backend(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Debug the API endpoint middleware error handling")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "anbu")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_chunin_research(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Research the latest web search best practices for evidence synthesis")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "chunin")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_kage_architecture(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Security audit and architecture risk assessment of the auth system")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "kage")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_default_kage_no_keywords(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("do something complicated with no keywords")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "kage")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_tokubetsu_jonin_docs(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Write a PRD and technical documentation for the new feature")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "tokubetsu_jonin")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_route_genin_explore(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("explore the codebase trace the auth flow find call graph")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertEqual(resp.get("selected_agent"), "genin")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    # ------------------------------------------------------------------ #
    # DELEGATION: AGENT TOOLS
    # ------------------------------------------------------------------ #

    def test_agent_requires_delegate_md(self):
        td = tempfile.mkdtemp()
        try:
            resp, err = self._unwrap(self._call("kage", {"task_dir": td}))
            self.assertTrue(err or resp.get("status") == "error")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_agent_loads_persona_from_db(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "delegate.md"), "w") as f:
                f.write("---\ntitle: Test\n---\nAnalyze database migration.")
            resp, err = self._unwrap(self._call("kage", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("status"), "ready")
            self.assertIn("kage", resp.get("agent", ""))
            instructions = resp.get("instructions", "")
            self.assertIn("Instructions:", instructions)
            self.assertIn("Village Leader", instructions)
            # No filesystem mirror paths
            self.assertNotIn(".cursor/skills", instructions)
            self.assertNotIn(".claude/skills", instructions)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_anbu_loads_skills_from_sqlite(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "delegate.md"), "w") as f:
                f.write("Implement database migration.")
            resp, err = self._unwrap(self._call("anbu", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("status"), "ready")
            instructions = resp.get("instructions", "")
            # Anbu has skills loaded from agents.skills → appears in instructions
            self.assertIn("Available Skills", instructions)
            # Skills come from DB, not filesystem mirrors
            self.assertNotIn(".cursor/skills", instructions)
            self.assertNotIn(".claude/skills", instructions)
            self.assertNotIn("~/.agents/skills", instructions)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_agent_returns_long_enriched_instructions(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "delegate.md"), "w") as f:
                f.write("Fix the login endpoint bug.")
            resp, err = self._unwrap(self._call("anbu", {"task_dir": td}))
            instructions = resp.get("instructions", "")
            self.assertGreater(len(instructions), 500,
                               f"Instructions too short: {len(instructions)}")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_genin_reads_from_skills_db(self):
        """Genin agent should also get skills from DB."""
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "delegate.md"), "w") as f:
                f.write("Explore the auth flow codebase.")
            resp, err = self._unwrap(self._call("genin", {"task_dir": td}))
            self.assertFalse(err)
            instructions = resp.get("instructions", "")
            # Genin has skill references from the DB
            self.assertNotIn(".cursor/skills", instructions)
            self.assertNotIn(".claude/skills", instructions)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    # ------------------------------------------------------------------ #
    # SANNIN COMPLETION PHASE
    # ------------------------------------------------------------------ #

    def test_sannin_result_phase(self):
        td = tempfile.mkdtemp()
        try:
            with open(os.path.join(td, "result.md"), "w") as f:
                f.write("# Done\n\nFixed the bug.")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("status"), "completed")
            self.assertEqual(resp.get("phase"), "result")
            self.assertIn("Fixed the bug", resp.get("result", ""))
        finally:
            shutil.rmtree(td, ignore_errors=True)

    # ------------------------------------------------------------------ #
    # WEB SEARCH (Chunin tool)
    # ------------------------------------------------------------------ #

    def test_web_search_basic(self):
        resp, err = self._unwrap(self._call("web_search", {
            "query": "testing",
            "num_results": 2,
            "search_depth": "standard",
        }))
        self.assertFalse(err)
        self.assertEqual(resp.get("status"), "success")
        self.assertIsInstance(resp.get("results"), list)

    # ------------------------------------------------------------------ #
    # SKILLS MANAGEMENT
    # ------------------------------------------------------------------ #

    def test_get_skill_from_db(self):
        resp, err = self._unwrap(self._call("find_skill", {"keyword": "migration"}))
        self.assertFalse(err)
        # find_skill should return results
        results = resp.get("results", resp.get("content", resp.get("raw", "")))
        self.assertIsNotNone(results)
        self.assertGreater(len(str(results)), 0)

    # ------------------------------------------------------------------ #
    # FULL CHAIN END-TO-END
    # ------------------------------------------------------------------ #

    def test_full_delegation_chain(self):
        """Sannin routes → Anbu executes → Sannin completes."""
        td = tempfile.mkdtemp()
        try:
            # Step 1: Sannin routes
            with open(os.path.join(td, "prompt.md"), "w") as f:
                f.write("Fix the database migration schema error in production deployment.")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("selected_agent"), "anbu")

            # Step 2: Anbu enriches from DB
            with open(os.path.join(td, "delegate.md"), "w") as f:
                f.write("Fix the database migration by adding rollback support.")
            resp, err = self._unwrap(self._call("anbu", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("status"), "ready")
            self.assertGreater(len(resp.get("instructions", "")), 500)
            self.assertNotIn(".cursor/skills", resp.get("instructions", ""))

            # Step 3: Sannin returns result
            with open(os.path.join(td, "result.md"), "w") as f:
                f.write("# Migration Fix Applied\n\nAdded rollback support.")
            resp, err = self._unwrap(self._call("sannin", {"task_dir": td}))
            self.assertFalse(err)
            self.assertEqual(resp.get("status"), "completed")
            self.assertIn("Migration Fix", resp.get("result", ""))
        finally:
            shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
