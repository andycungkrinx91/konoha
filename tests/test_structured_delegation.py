#!/usr/bin/env python3
"""
tests/test_structured_delegation.py — E2E Unit & Integration tests for Structured MCP Tool Delegation.
Verifies:
1. Direct structured arguments (task, context, constraints, taste_dials) without reading disk files.
2. Ingestion of Project Context & stack metadata into subagent prompts.
3. Taste-Skill directives injection in Jonin.
4. Structured report_from_agent execution and auto-checkpointing into project memory.
5. Backward compatibility with task_dir/delegate.md.
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

class TestStructuredDelegation(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, 'test_skills.db')
        self.project_dir = os.path.join(self.tmp_dir.name, 'test_project')
        os.makedirs(self.project_dir, exist_ok=True)

        # Set DB_PATH in server & persona_memory
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
        conn.execute("""
            INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
            VALUES ('anbu', 'Anbu Black Ops', 'Backend & Security', '[]', 'Zero CVEs', 'Write secure APIs', 'Pro')
        """)
        conn.commit()
        conn.close()

        # Initialize project stack
        with open(os.path.join(self.project_dir, 'package.json'), 'w') as f:
            json.dump({
                'name': 'konoha-showroom',
                'dependencies': {
                    'next': '16.0.0',
                    'tailwindcss': '^4.0.0'
                }
            }, f)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_direct_structured_delegation_jonin(self):
        # Call run_mcp_agent with direct structured arguments (0 file reading required!)
        res_json = server.run_mcp_agent(
            agent_name='jonin',
            task='Build a responsive showroom header with Geist typography',
            context='File path: src/components/Header.tsx',
            constraints='Must use Tailwind v4 and light mode',
            taste_dials={'design_variance': 9, 'motion_intensity': 8, 'visual_density': 6},
            project_path=self.project_dir
        )
        res = json.loads(res_json)
        self.assertEqual(res['status'], 'ready')
        self.assertEqual(res['agent'], 'jonin')
        self.assertIn('Build a responsive showroom header', res['instructions'])
        self.assertIn('Geist typography', res['instructions'])
        self.assertIn('Persistent Project Context', res['instructions'])
        self.assertIn('Taste-Skill Design Engine Directives', res['instructions'])
        self.assertIn('DESIGN_VARIANCE=9/10', res['instructions'])

    def test_direct_structured_delegation_anbu(self):
        res_json = server.run_mcp_agent(
            agent_name='anbu',
            task='Implement SQLite connection pool and safe migration',
            project_path=self.project_dir
        )
        res = json.loads(res_json)
        self.assertEqual(res['status'], 'ready')
        self.assertEqual(res['agent'], 'anbu')
        self.assertIn('SQLite connection pool', res['instructions'])
        self.assertIn('Persistent Project Context', res['instructions'])

    def test_report_from_agent_and_auto_checkpointing(self):
        rep_json = server.report_from_agent(
            agent_name='jonin',
            summary='Completed showroom filter bar with 3D perspective cards',
            status='completed',
            files_created=['src/components/FilterBar.tsx'],
            files_modified=['src/app/page.tsx'],
            learnings=[
                'Showroom uses CSS Grid 12-column layout with max-w-[1400px]',
                'Primary brand color is Emerald 600 with slate backdrop'
            ],
            validation=['pnpm run build exited 0', 'vitest: 12 passed'],
            project_path=self.project_dir
        )
        rep = json.loads(rep_json)
        self.assertEqual(rep['status'], 'recorded')
        self.assertEqual(rep['task_status'], 'completed')
        self.assertTrue(rep.get('verified', True))
        self.assertEqual(rep['learnings_saved_count'], 2)

        # Verify learnings are now in project memory!
        mems = persona_memory.list_memories(project_path=self.project_dir, db_path=self.db_path)
        self.assertEqual(len(mems), 2)
        contents = [m['content'] for m in mems]
        self.assertIn('Showroom uses CSS Grid 12-column layout with max-w-[1400px]', contents)

        # Reporting the same learnings again must not duplicate them.
        rep_dup_json = server.report_from_agent(
            agent_name='jonin',
            summary='Re-report with identical learnings',
            status='completed',
            learnings=[
                'Showroom uses CSS Grid 12-column layout with max-w-[1400px]',
                'Primary brand color is Emerald 600 with slate backdrop'
            ],
            validation=['pnpm run build exited 0'],
            project_path=self.project_dir
        )
        rep_dup = json.loads(rep_dup_json)
        self.assertEqual(rep_dup['learnings_saved_count'], 0)
        mems_after = persona_memory.list_memories(project_path=self.project_dir, db_path=self.db_path)
        self.assertEqual(len(mems_after), 2)

    def test_unverified_report_defers_learnings(self):
        """A completion claim without validation evidence must be recorded as
        unverified and must NOT persist learnings into project memory."""
        rep_json = server.report_from_agent(
            agent_name='jonin',
            summary='Claimed completion without evidence',
            status='completed',
            learnings=['DB9 is caused by the collections Map mismatch'],
            project_path=self.project_dir
        )
        rep = json.loads(rep_json)
        self.assertEqual(rep['status'], 'recorded')
        self.assertEqual(rep['task_status'], 'unverified')
        self.assertFalse(rep['verified'])
        self.assertIn('remediation', rep)
        self.assertEqual(rep['learnings_saved_count'], 0)
        mems = persona_memory.list_memories(project_path=self.project_dir, db_path=self.db_path)
        self.assertEqual(len(mems), 0)

    def test_bare_claim_validation_is_insufficient(self):
        """Bare 'pass' claims are not real evidence — only command/exit-code
        style evidence verifies a task."""
        rep_json = server.report_from_agent(
            agent_name='anbu',
            summary='Fixed bug',
            status='completed',
            learnings=['learned something'],
            validation=['pass'],
            project_path=self.project_dir
        )
        rep = json.loads(rep_json)
        self.assertEqual(rep['task_status'], 'unverified')
        self.assertFalse(rep['verified'])

    def test_backward_compatibility_with_task_dir(self):
        task_dir = os.path.join(self.tmp_dir.name, 'legacy_task')
        os.makedirs(task_dir, exist_ok=True)
        with open(os.path.join(task_dir, 'delegate.md'), 'w') as f:
            f.write("# Legacy Task\nRefactor backend auth controller.")

        res_json = server.run_mcp_agent(
            agent_name='anbu',
            task_dir=task_dir,
            project_path=self.project_dir
        )
        res = json.loads(res_json)
        self.assertEqual(res['status'], 'ready')
        self.assertIn('Refactor backend auth controller', res['instructions'])

if __name__ == '__main__':
    unittest.main()
