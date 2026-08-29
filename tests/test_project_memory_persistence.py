#!/usr/bin/env python3
"""
tests/test_project_memory_persistence.py — E2E Unit & Integration tests for Project-Scoped Memory.
"""

import sys
import os
import tempfile
import unittest
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
import persona_memory

class TestProjectMemoryPersistence(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, 'test_skills.db')
        self.project_a = os.path.join(self.tmp_dir.name, 'project_a')
        self.project_b = os.path.join(self.tmp_dir.name, 'project_b')
        os.makedirs(self.project_a, exist_ok=True)
        os.makedirs(self.project_b, exist_ok=True)

        # Mock package.json for project_a (Next.js + Tailwind v4)
        with open(os.path.join(self.project_a, 'package.json'), 'w') as f:
            json.dump({
                'name': 'frontend-app-a',
                'dependencies': {
                    'next': '16.0.0',
                    'react': '^19.0.0',
                    'tailwindcss': '^4.0.0',
                    '@tailwindcss/postcss': '^4.0.0'
                }
            }, f)
        with open(os.path.join(self.project_a, 'pnpm-lock.yaml'), 'w') as f:
            f.write('# pnpm lockfile')

        # Mock package.json for project_b (SvelteKit + UnoCSS)
        with open(os.path.join(self.project_b, 'package.json'), 'w') as f:
            json.dump({
                'name': 'svelte-app-b',
                'dependencies': {
                    '@sveltejs/kit': '^2.0.0',
                    'svelte': '^5.0.0',
                    'unocss': '^0.58.0'
                }
            }, f)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_project_stack_detection(self):
        stack_a = persona_memory.detect_project_stack(self.project_a)
        self.assertEqual(stack_a['project_name'], 'frontend-app-a')
        self.assertIn('Next.js', stack_a['framework'])
        self.assertEqual(stack_a['package_manager'], 'pnpm')
        self.assertIn('Tailwind CSS v4', stack_a['styling'])

        stack_b = persona_memory.detect_project_stack(self.project_b)
        self.assertEqual(stack_b['project_name'], 'svelte-app-b')
        self.assertEqual(stack_b['framework'], 'SvelteKit')
        self.assertEqual(stack_b['styling'], 'UnoCSS')

    def test_project_scoped_memory_isolation(self):
        # Save memory specifically for Project A
        mem_a = persona_memory.save_memory(
            agent_name='jonin',
            title='Project A Design Decision',
            content='Project A uses Emerald theme and Geist font for headlines.',
            memory_type='architecture',
            project_path=self.project_a,
            db_path=self.db_path
        )
        self.assertTrue(mem_a)

        # Save memory specifically for Project B
        mem_b = persona_memory.save_memory(
            agent_name='jonin',
            title='Project B Design Decision',
            content='Project B uses Ruby Red theme with Satoshi typography.',
            memory_type='architecture',
            project_path=self.project_b,
            db_path=self.db_path
        )
        self.assertTrue(mem_b)

        # Query memories for Project A — must prioritize Project A and not return Project B
        results_a = persona_memory.query_memories(
            agent_name='jonin',
            query='theme and font typography',
            project_path=self.project_a,
            db_path=self.db_path
        )
        self.assertGreaterEqual(len(results_a), 1)
        self.assertEqual(results_a[0]['id'], mem_a)
        self.assertIn('Emerald', results_a[0]['content'])
        self.assertNotIn('Ruby Red', [r['content'] for r in results_a])

        # Query memories for Project B
        results_b = persona_memory.query_memories(
            agent_name='jonin',
            query='theme and font typography',
            project_path=self.project_b,
            db_path=self.db_path
        )
        self.assertGreaterEqual(len(results_b), 1)
        self.assertEqual(results_b[0]['id'], mem_b)
        self.assertIn('Ruby Red', results_b[0]['content'])

    def test_project_context_formatting(self):
        persona_memory.save_or_update_project(
            self.project_a,
            context_summary='High performance e-commerce showroom',
            db_path=self.db_path
        )
        profile = persona_memory.get_project_profile(self.project_a, db_path=self.db_path)
        self.assertIsNotNone(profile)
        self.assertEqual(profile['framework'], 'Next.js (16.0.0)')

        mem = persona_memory.save_memory(
            agent_name='kage',
            content='Always use server actions for checkout mutation',
            project_path=self.project_a,
            db_path=self.db_path
        )
        mems = persona_memory.list_memories(project_path=self.project_a, db_path=self.db_path)

        prompt_block = persona_memory.format_project_context_for_prompt(profile, mems)
        self.assertIn('Persistent Project Context', prompt_block)
        self.assertIn('frontend-app-a', prompt_block)
        self.assertIn('Tailwind CSS v4', prompt_block)
        self.assertIn('server actions', prompt_block)

if __name__ == '__main__':
    unittest.main()
