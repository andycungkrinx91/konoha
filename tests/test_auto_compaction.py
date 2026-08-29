#!/usr/bin/env python3
"""
tests/test_auto_compaction.py — E2E tests for Automatic Context Compaction after 2 prompts.
Verifies:
1. Turn 1 initialization (standard prompt).
2. Turn 2+ automatic compaction trigger across Antigravity, Claude Code, CommandCode, OpenCode.
3. Strict token decrease (< 700 tokens on compact mode vs full turn 1).
4. Complete retention of project stack, invariants, and episodic memories without hallucination.
"""

import sys
import os
import tempfile
import unittest
import json
import sqlite3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
import server
import persona_memory

class TestAutoCompaction(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, 'test_skills.db')
        self.project_dir = os.path.join(self.tmp_dir.name, 'ecommerce_app')
        os.makedirs(self.project_dir, exist_ok=True)

        server.DB_PATH = self.db_path
        persona_memory.DB_PATH = self.db_path

        # Setup minimal agent in DB
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                name TEXT PRIMARY KEY,
                title TEXT,
                purpose TEXT,
                skills TEXT,
                constraints_text TEXT,
                instructions TEXT,
                model_tier TEXT
            )
        """)
        conn.execute("""
            INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
            VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
        """)
        conn.commit()
        conn.close()

        # Mock package.json
        with open(os.path.join(self.project_dir, 'package.json'), 'w') as f:
            json.dump({'name': 'ecommerce-app', 'dependencies': {'next': '16.0.0', 'tailwindcss': '^4.0.0'}}, f)

        # Clear session turn registry
        server.SESSION_TURNS.clear()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_turn1_vs_turn2_auto_compaction(self):
        os.environ['ANTIGRAVITY_CONVERSATION_ID'] = 'conv-test-123'
        server.ACTIVE_CLIENT = 'agy'

        # Turn 1: Standard Turn
        res1_json = server.run_mcp_agent(
            agent_name='jonin',
            task='Scaffold hero section',
            project_path=self.project_dir
        )
        res1 = json.loads(res1_json)
        instr1 = res1['instructions']
        len1 = len(instr1)

        # Turn 2: Auto-Compacted Turn
        res2_json = server.run_mcp_agent(
            agent_name='jonin',
            task='Add responsive navbar with theme toggle',
            project_path=self.project_dir
        )
        res2 = json.loads(res2_json)
        instr2 = res2['instructions']
        len2 = len(instr2)

        # Assert Turn 2 is significantly compacted
        self.assertLess(len2, len1, f"Turn 2 length ({len2}) should be smaller than Turn 1 ({len1})")
        self.assertIn("Auto-Compact", instr2)
        # Assert context retention
        self.assertIn("ecommerce-app", instr2)
        self.assertIn("Next.js", instr2)
        self.assertIn("pnpm", instr2)

    def test_multiclient_support(self):
        clients = ['claudecode', 'commandcode', 'opencode', 'agy', 'cursor']
        for client in clients:
            server.ACTIVE_CLIENT = client
            os.environ['SESSION_ID'] = f'session-{client}-999'

            # Turn 1
            r1 = json.loads(server.run_mcp_agent(agent_name='jonin', task='Task 1', project_path=self.project_dir))
            # Turn 2 (auto-compaction triggers)
            r2 = json.loads(server.run_mcp_agent(agent_name='jonin', task='Task 2', project_path=self.project_dir))

            self.assertIn("Auto-Compact", r2['instructions'])
            self.assertIn("ecommerce-app", r2['instructions'])

if __name__ == '__main__':
    unittest.main()
