"""
Verify every mcp_<agent> subagent prompt explicitly advertises the konoha +
semble MCP tools it has access to. Before this fix, subagents received a
prompt that listed persona/constraints/skills but never told them which MCP
tools were wired up, so they would fall back to (forbidden) built-in tools.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest


SERVER_DIR = os.path.dirname(os.path.abspath(__file__))


def _send_and_read(stdin, reader, msg, expect_reply=True):
    """Write a JSON-RPC request via `stdin` and (optionally) read one reply via `reader`."""
    payload = (json.dumps(msg) + "\n").encode("utf-8")
    stdin.write(payload)
    stdin.flush()
    if not expect_reply:
        return None
    line = reader.readline()
    if not line:
        raise RuntimeError("server.py closed stdout before responding")
    return json.loads(line.decode("utf-8"))


class _LineReader:
    """Drain an os-level pipe into newline-delimited chunks via a worker thread."""

    def __init__(self, stream):
        self._stream = stream
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._eof = False
        self._notified = threading.Event()
        self._thread = threading.Thread(target=self._drain, daemon=True)
        self._thread.start()

    def _drain(self):
        try:
            while True:
                chunk = self._stream.read(8192)
                if not chunk:
                    with self._lock:
                        self._eof = True
                    self._notified.set()
                    return
                with self._lock:
                    self._buf.extend(chunk)
                self._notified.set()
        except Exception:
            with self._lock:
                self._eof = True
            self._notified.set()

    def readline(self):
        while True:
            with self._lock:
                idx = self._buf.find(b"\n")
                if idx >= 0:
                    line = bytes(self._buf[:idx])
                    del self._buf[: idx + 1]
                    return line
                eof = self._eof
            if eof:
                with self._lock:
                    if self._buf:
                        line = bytes(self._buf)
                        self._buf.clear()
                        return line
                    return b""
            self._notified.wait(timeout=30)
            self._notified.clear()


class TestSubagentMCPBlock(unittest.TestCase):
    SUBAGENTS = [
        "mcp_kage", "mcp_jonin", "mcp_anbu",
        "mcp_chunin", "mcp_genin", "mcp_tokubetsu_jonin",
    ]

    REQUIRED_TOOLS = [
        "mcp__semble__search",
        "mcp__semble__find_related",
        "mcp__konoha__find_skill",
        "mcp__konoha__get_skill",
        "mcp__konoha__read_file_range",
        "mcp__konoha__read_file_head",
        "mcp__konoha__get_resolved_task_dir",
        "mcp__konoha__mcp_sannin",
    ]

    REQUIRED_PHRASES = [
        "MCP Tools Available To You",
        "Codebase search",
        "Skill lookup",
        "Never use",
    ]

    @classmethod
    def setUpClass(cls):
        cls._stderr_log = tempfile.NamedTemporaryFile(
            prefix="konoha-mcpblock-stderr-", suffix=".log", delete=False
        )
        # pytest captures stdout via fd redirection; large server replies
        # (>1MB per call) overflow pytest's capture buffer and deadlock the
        # subprocess. Use a raw os.pipe() so pytest never sees server stdout.
        r_fd, w_fd = os.pipe()
        cls.proc = subprocess.Popen(
            [sys.executable, "server.py"],
            stdin=subprocess.PIPE,
            stdout=w_fd,
            stderr=cls._stderr_log,
            cwd=SERVER_DIR,
        )
        os.close(w_fd)  # close our copy; subprocess holds the other end
        cls._reader = _LineReader(os.fdopen(r_fd, "rb", buffering=0))
        _send_and_read(cls.proc.stdin, cls._reader, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "claude-code-test", "version": "1.0"},
            },
        })
        _send_and_read(cls.proc.stdin, cls._reader, {
            "jsonrpc": "2.0", "method": "notifications/initialized",
        }, expect_reply=False)
        cls._next_id = 10
        cls._ta_dir = tempfile.mkdtemp(prefix="konoha-mcpblock-")
        with open(os.path.join(cls._ta_dir, "delegate.md"), "w") as f:
            f.write("---\nskills: []\n---\nDo the thing.\n")

    @classmethod
    def tearDownClass(cls):
        try:
            cls.proc.terminate()
            cls.proc.wait(timeout=5)
        except Exception:
            try:
                cls.proc.kill()
            except Exception:
                pass

    def _invoke(self, agent):
        self._next_id += 1
        resp = _send_and_read(self.proc.stdin, self._reader, {
            "jsonrpc": "2.0",
            "id": self._next_id,
            "method": "tools/call",
            "params": {"name": agent, "arguments": {"task_dir": self._ta_dir}},
        })
        assert isinstance(resp, dict)
        self.assertNotIn("error", resp, f"{agent}: {resp.get('error')}")
        text = resp["result"]["content"][0]["text"]
        result = json.loads(text)
        self.assertEqual(result.get("status"), "ready", result)
        return result["instructions"]

    def test_block_present_for_every_subagent(self):
        for agent in self.SUBAGENTS:
            with self.subTest(agent=agent):
                instructions = self._invoke(agent)
                for tool in self.REQUIRED_TOOLS:
                    self.assertIn(tool, instructions,
                                  f"{agent} prompt missing tool: {tool}")

    def test_routing_rules_present(self):
        for agent in self.SUBAGENTS:
            with self.subTest(agent=agent):
                instructions = self._invoke(agent)
                for phrase in self.REQUIRED_PHRASES:
                    self.assertIn(phrase, instructions,
                                  f"{agent} prompt missing phrase: {phrase!r}")

    def test_block_appears_before_task_instructions(self):
        instructions = self._invoke("mcp_kage")
        block_idx = instructions.find("MCP Tools Available To You")
        task_idx = instructions.find("## TASK INSTRUCTIONS")
        self.assertGreater(block_idx, -1, "block missing")
        self.assertGreater(task_idx, -1, "task section missing")
        self.assertLess(block_idx, task_idx,
                        "MCP block must appear before TASK INSTRUCTIONS")

    def test_block_is_shared_across_subagents(self):
        # The MCP block is the shared preamble injected by
        # build_subagent_mcp_block(). It starts at "MCP Tools Available
        # To You" and ends at the "No shell grep/rg/find/cat/head..."
        # line — anything past that is subagent-specific (research
        # findings, skills, diff-marker instructions, etc.).
        import re

        def block(text):
            start = text.find("MCP Tools Available To You")
            self.assertGreater(start, -1, "block start missing")
            after = text[start + 1:]
            m = re.search(r"\n- \*\*No shell grep/rg/find/cat/head\.[^\n]*\n", after)
            assert m is not None, "block end anchor missing"
            return after[: m.end()]

        seen = {block(self._invoke(a)) for a in self.SUBAGENTS}
        self.assertEqual(
            len(seen), 1,
            f"Expected identical MCP block across subagents, got {len(seen)} variants",
        )


if __name__ == "__main__":
    unittest.main()