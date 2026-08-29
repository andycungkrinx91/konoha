#!/usr/bin/env python3
"""Cross-client RTK verification test across all 5 clients:
Antigravity, Claude Code, Cursor, OpenCode, and CommandCode.
"""
import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path.home()

class TestRtkCrossClient(unittest.TestCase):
    def test_rtk_binary_detection_and_path(self):
        """Verify rtk binary is detected via Node platform_utils."""
        cmd = [
            "node",
            "-e",
            """
            const { getRtkCommand, isRtkInstalled } = require('./src/platform_utils');
            const rtkCmd = getRtkCommand();
            const installed = isRtkInstalled();
            if (!installed || !rtkCmd) {
                console.error('RTK not detected');
                process.exit(1);
            }
            console.log('RTK detected:', rtkCmd);
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"RTK detection failed: {res.stderr}")
        self.assertIn("RTK detected:", res.stdout)

    def test_rtk_deployment_antigravity(self):
        """Verify RTK deployment to Antigravity CLI and IDE."""
        cmd = [
            "node",
            "-e",
            """
            const { deployAntigravityRtkRule } = require('./src/antigravity_manager');
            const res = deployAntigravityRtkRule(true);
            if (!res.ok) {
                console.error('Antigravity RTK deployment failed:', res);
                process.exit(1);
            }
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        
        # Check rule files exist
        self.assertTrue((HOME / ".gemini" / "antigravity-cli" / "rules" / "rtk.md").exists())
        self.assertTrue((HOME / ".gemini" / "antigravity-ide" / "rules" / "rtk.md").exists())

    def test_rtk_deployment_claude_code(self):
        """Verify RTK deployment and hook registration for Claude Code."""
        cmd = [
            "node",
            "-e",
            """
            const { deployClaudeCodeRtkRule, initRtkHook } = require('./src/mcp_clients_manager');
            const r1 = deployClaudeCodeRtkRule(true);
            const r2 = initRtkHook(true);
            if (!r1.ok || !r2.ok) {
                console.error('Claude Code RTK deployment failed:', r1, r2);
                process.exit(1);
            }
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue((HOME / ".claude" / "rules" / "rtk.md").exists())

    def test_rtk_deployment_cursor(self):
        """Verify RTK deployment for Cursor."""
        cmd = [
            "node",
            "-e",
            """
            const { deployCursorRtkRule } = require('./src/cursor_manager');
            const res = deployCursorRtkRule(true);
            if (!res.ok) {
                console.error('Cursor RTK deployment failed:', res);
                process.exit(1);
            }
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue((HOME / ".cursor" / "rules" / "rtk.mdc").exists())

    def test_rtk_deployment_opencode(self):
        """Verify RTK deployment for OpenCode."""
        cmd = [
            "node",
            "-e",
            """
            const { deployOpenCodeRtkRule } = require('./src/opencode_manager');
            const res = deployOpenCodeRtkRule(true);
            if (!res.ok) {
                console.error('OpenCode RTK deployment failed:', res);
                process.exit(1);
            }
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        opencode_rule = (HOME / ".config" / "opencode" / "rules" / "rtk.md")
        if not opencode_rule.exists():
            opencode_rule = (HOME / ".opencode" / "rules" / "rtk.md")
        self.assertTrue(opencode_rule.exists())

    def test_rtk_deployment_commandcode(self):
        """Verify RTK deployment and permissions for CommandCode."""
        cmd = [
            "node",
            "-e",
            """
            const { deployCommandCodeRtkRule, registerCommandCodePermissions } = require('./src/mcp_clients_manager');
            const r1 = deployCommandCodeRtkRule(true);
            registerCommandCodePermissions(true);
            if (!r1.ok) {
                console.error('CommandCode RTK deployment failed:', r1);
                process.exit(1);
            }
            """
        ]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue((HOME / ".commandcode" / "rules" / "rtk.md").exists())

    def test_rtk_contract_in_rules_and_prompts(self):
        """Verify contract rules require RTK prefixing across rule templates."""
        gemini_rule = (ROOT / "GEMINI.md").read_text(encoding="utf-8")
        self.assertIn("RTK is mandatory for commands", gemini_rule)
        self.assertIn("prefix shell/command execution with `rtk`", gemini_rule)

if __name__ == "__main__":
    unittest.main()
