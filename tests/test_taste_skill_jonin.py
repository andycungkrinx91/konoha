#!/usr/bin/env python3
"""
tests/test_taste_skill_jonin.py — E2E Unit & Integration tests for Jonin + Taste-Skill.
Verifies:
1. Ingestion of Taste-Skill anti-slop directives into Jonin.
2. Enforcement of editorial typography (Geist, Cabinet Grotesk, Outfit, Satoshi).
3. CSS Grid layout and cinematic chapter spacing rules.
4. Mobile viewport stability (min-h-[100dvh]) and zero-emoji policy.
5. Tuning dials parameterization (design_variance, motion_intensity, visual_density).
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

class TestTasteSkillJonin(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, 'test_skills.db')
        self.project_dir = os.path.join(self.tmp_dir.name, 'frontend_repo')
        os.makedirs(self.project_dir, exist_ok=True)

        server.DB_PATH = self.db_path
        server.WORKSPACE_ROOT = self.tmp_dir.name
        persona_memory.DB_PATH = self.db_path

        # Setup minimal agent and skills in DB
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
            CREATE TABLE IF NOT EXISTS skills (
                name TEXT PRIMARY KEY,
                skill_name TEXT,
                description TEXT,
                content TEXT,
                type TEXT
            )
        """)
        conn.execute("""
            INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
            VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
        """)
        for s in ['jonin-skill/taste-skill-frontend-expert', 'jonin-skill/nextjs-code-expert', 'jonin-skill/svelte-code-expert', 'jonin-skill/nuxt-code-expert', 'jonin-skill/angular-code-expert', 'jonin-skill/build-directives-manifest', 'jonin-skill/design-token-manifest', 'jonin-skill/source-fidelity-directives']:
            conn.execute("INSERT OR REPLACE INTO skills (name, skill_name, description, content, type) VALUES (?, ?, ?, ?, 'reference')", (s, s, s, f'# Content for {s}'))
        conn.commit()
        conn.close()

        # Mock Next.js project
        with open(os.path.join(self.project_dir, 'package.json'), 'w') as f:
            json.dump({
                'name': 'luxury-ecommerce',
                'dependencies': {
                    'next': '16.0.0',
                    'tailwindcss': '^4.0.0'
                }
            }, f)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_taste_skill_directives_presence(self):
        res_json = server.run_mcp_agent(
            agent_name='jonin',
            task='Scaffold a high-converting hero section',
            project_path=self.project_dir
        )
        res = json.loads(res_json)
        instr = res['instructions']

        # Assert anti-slop directives
        self.assertIn('Taste-Skill Design Engine Directives', instr)
        self.assertIn('Geist', instr)
        self.assertIn('Cabinet Grotesk', instr)
        self.assertIn('py-24', instr)
        self.assertIn('grid-cols-12', instr)
        self.assertIn('min-h-[100dvh]', instr)
        self.assertTrue('zero emojis' in instr.lower())

    def test_custom_taste_dials(self):
        res_json = server.run_mcp_agent(
            agent_name='jonin',
            task='Build custom editorial portfolio grid',
            taste_dials={'design_variance': 10, 'motion_intensity': 9, 'visual_density': 4},
            project_path=self.project_dir
        )
        res = json.loads(res_json)
        instr = res['instructions']

        self.assertIn('DESIGN_VARIANCE=10/10', instr)
        self.assertIn('MOTION_INTENSITY=9/10', instr)
        self.assertIn('VISUAL_DENSITY=4/10', instr)

    def test_build_from_text_all_frameworks(self):
        frameworks = ['nextjs', 'sveltekit', 'nuxt', 'angular']
        for fw in frameworks:
            res_json = server.build_from_text(
                name=f'luxury-showcase-{fw}',
                description=f'A luxury showcase in {fw}',
                framework=fw
            )
            res = json.loads(res_json)
            self.assertEqual(res['status'], 'success')
            self.assertIn('jonin-skill/taste-skill-frontend-expert', res['required_skills'])
            directives_str = ' '.join(res['directives'])
            self.assertIn('Taste-Skill', directives_str)
            self.assertIn('reduced-motion', directives_str)
            self.assertIn('framework-native', directives_str)
            self.assertIn('design_tokens', res)
            self.assertEqual(res['design_tokens']['perspective'], '1200px')
            self.assertEqual(res['design_tokens']['tilt_max'], '12deg')
            self.assertEqual(res['design_tokens']['hero_autoplay'], '6000ms')
            self.assertIn('em_dash', res['taste_skill_audits'])

    def test_build_from_source_all_frameworks(self):
        source_dir = os.path.join(self.tmp_dir.name, 'mockups')
        os.makedirs(source_dir, exist_ok=True)
        with open(os.path.join(source_dir, 'design.svg'), 'w') as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>')
        
        frameworks = ['nextjs', 'sveltekit', 'nuxt', 'angular']
        for fw in frameworks:
            res_json = server.build_from_source(
                name=f'luxury-source-{fw}',
                source_dir=source_dir,
                framework=fw
            )
            res = json.loads(res_json)
            self.assertEqual(res['status'], 'success')
            self.assertIn('jonin-skill/taste-skill-frontend-expert', res['required_skills'])

    def test_invalid_dials_rejected(self):
        res_json = server.build_from_text(
            name='invalid-dials',
            description='Test invalid dials',
            framework='nextjs',
            taste_dials={'design_variance': 99}
        )
        res = json.loads(res_json)
        self.assertIn('error', res)

if __name__ == '__main__':
    unittest.main()
