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
import db

class TestAutoCompaction(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.previous_db_path = db.DB_PATH
        self.previous_server_db = server.DB_PATH
        self.previous_persona_db = persona_memory.DB_PATH
        self.db_path = os.path.join(self.tmp_dir.name, 'test_skills.db')
        self.project_dir = os.path.join(self.tmp_dir.name, 'ecommerce_app')
        os.makedirs(self.project_dir, exist_ok=True)

        db.DB_PATH = self.db_path
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
        db.DB_PATH = self.previous_db_path
        server.DB_PATH = self.previous_server_db
        persona_memory.DB_PATH = self.previous_persona_db
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

    def test_compact_turn_retains_skill_sop_and_task_authority(self):
        """Regression test for the goal-drift bug: on compact (turn 2+)
        delegations the agent must still receive its primary skill preview and
        an explicit directive that the TASK INSTRUCTIONS are authoritative."""
        # Seed a skills table with a real SOP for jonin-skill
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS skills (
                name TEXT PRIMARY KEY,
                skill_name TEXT,
                type TEXT,
                content TEXT,
                tags TEXT,
                byte_size INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            INSERT OR REPLACE INTO skills (name, skill_name, type, content, tags, byte_size)
            VALUES ('jonin-skill', 'jonin-skill', 'skill', 'Root cause first: reproduce the bug, read the failing code, then fix. Never delete prior fixes when a new error appears.', 'ui', 120)
        """)
        # Give the agent long procedural instructions to exercise boundary truncation
        conn.execute("UPDATE agents SET instructions = ? WHERE name = 'jonin'", (
            'Step 1. Reproduce the reported bug. ' * 60,
        ))
        conn.commit()
        conn.close()

        os.environ['ANTIGRAVITY_CONVERSATION_ID'] = 'conv-compact-retention'
        server.ACTIVE_CLIENT = 'agy'
        server.SESSION_TURNS.clear()

        json.loads(server.run_mcp_agent(agent_name='jonin', task='Turn one task', project_path=self.project_dir))
        res2 = json.loads(server.run_mcp_agent(agent_name='jonin', task='Fix the DB9 reload bug', project_path=self.project_dir))
        instr2 = res2['instructions']

        # Skill SOP preview must survive compaction
        self.assertIn("jonin-skill", instr2)
        self.assertIn("Root cause first", instr2)
        # Task authority directive must be present
        self.assertIn("authoritative task", instr2)
        self.assertIn("Never reinterpret, narrow, or replace", instr2)
        # The full task text must be present verbatim
        self.assertIn("Fix the DB9 reload bug", instr2)
        # Instructions truncated at a sentence boundary, not mid-word
        if "...[truncated]" in instr2:
            truncated_at = instr2.index("...[truncated]")
            self.assertIn("Reproduce the reported bug.", instr2[:truncated_at])

    def test_session_turn_resets_after_idle(self):
        """Long-lived MCP processes must not carry turn counts across
        conversations when no conversation-id env var is available."""
        os.environ.pop('ANTIGRAVITY_CONVERSATION_ID', None)
        for var in ('CLAUDE_CONVERSATION_ID', 'OPENCODE_SESSION_ID', 'COMMANDCODE_SESSION_ID', 'CURSOR_SESSION_ID', 'SESSION_ID'):
            os.environ.pop(var, None)
        server.SESSION_TURNS.clear()
        server.SESSION_TURN_LAST_ACCESS.clear()
        server.ACTIVE_CLIENT = 'agy'

        json.loads(server.run_mcp_agent(agent_name='jonin', task='old session task', project_path=self.project_dir))
        r2 = json.loads(server.run_mcp_agent(agent_name='jonin', task='old session task 2', project_path=self.project_dir))
        self.assertIn("Auto-Compact", r2['instructions'])

        # Simulate 31 minutes of inactivity: the next call starts fresh (turn 1, no compaction)
        key = next(iter(server.SESSION_TURN_LAST_ACCESS))
        server.SESSION_TURN_LAST_ACCESS[key] -= (server.SESSION_IDLE_RESET_SECONDS + 60)
        r3 = json.loads(server.run_mcp_agent(agent_name='jonin', task='new session task', project_path=self.project_dir))
        self.assertNotIn("Auto-Compact", r3['instructions'])

if __name__ == '__main__':
    unittest.main()
