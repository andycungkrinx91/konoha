#!/usr/bin/env python3
import json
import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import server


class TestBuildWorkflows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.previous_root = server.WORKSPACE_ROOT
        server.WORKSPACE_ROOT = str(self.root)

    def tearDown(self):
        server.WORKSPACE_ROOT = self.previous_root
        self.tmp.cleanup()

    def test_text_contract_covers_all_frameworks(self):
        for framework in ("nextjs", "nuxt", "sveltekit", "angular"):
            result = json.loads(server.build_from_text("demo-app", "Premium dashboard", framework, taste_dials={"design_variance": 9, "motion_intensity": 8, "visual_density": 4}))
            self.assertEqual(result["status"], "success")
            self.assertEqual(result["framework"], framework)
            self.assertEqual(result["archetype"], "dashboard")
            self.assertEqual(result["taste_dials"], {"design_variance": 9, "motion_intensity": 8, "visual_density": 4})
            self.assertEqual(result["design_tokens"]["hero_autoplay"], "6000ms")
            self.assertIn("em_dash", result["taste_skill_audits"])
            self.assertTrue(result["embedded_skill_content"])
            self.assertTrue(result["validation_commands"])
            self.assertTrue(any("pnpm" in directive for directive in result["directives"]))

    def test_text_build_only_adds_commerce_features_for_commerce(self):
        landing = json.loads(server.build_from_text("landing", "A one-page marketing landing page", "nextjs"))
        self.assertEqual(landing["archetype"], "landing")
        landing_directives = " ".join(landing["directives"])
        self.assertNotIn("50-item production catalog", landing_directives)
        commerce = json.loads(server.build_from_text("store", "An e-commerce online store with checkout", "nextjs"))
        self.assertEqual(commerce["archetype"], "commerce")
        self.assertIn("50-item production catalog", " ".join(commerce["directives"]))

    def test_source_contract_detects_framework_files_without_writing(self):
        source = self.root / "source"
        source.mkdir()
        (source / "page.vue").write_text("<script setup>definePageMeta({ layout: 'default' })</script><template><main /></template>", encoding="utf-8")
        (source / "page.svelte").write_text("<script>import { goto } from '$app/navigation';</script><main>hello</main>", encoding="utf-8")
        (source / "page.tsx").write_text("export default function Page() { return <main aria-label='page' /> }", encoding="utf-8")
        (source / "app.component.ts").write_text("@Component({ standalone: true }) export class AppComponent { value = signal(1); }", encoding="utf-8")
        before = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*"))
        result = json.loads(server.build_from_source("demo-app", str(source), "nuxt", taste_dials={"design_variance": 7}))
        after = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*"))
        self.assertEqual(result["status"], "success")
        self.assertEqual(before, after)
        sources = {item["filename"]: item for item in result["detected_sources"]}
        self.assertIn("page.vue", sources)
        self.assertIn("nuxt", sources["page.vue"]["framework_hints"])
        self.assertIn("sveltekit", sources["page.svelte"]["framework_hints"])
        self.assertIn("nextjs", sources["page.tsx"]["framework_hints"])
        self.assertIn("angular", sources["app.component.ts"]["framework_hints"])
        self.assertTrue(sources["page.tsx"]["content_excerpt"])
        self.assertEqual(len(sources["page.tsx"]["sha256"]), 64)
        self.assertTrue(result["source_fidelity"])
        self.assertIn("do not inject generic", result["premium_effects_policy"])
        self.assertIn("DESIGN_VARIANCE=7/10", "\n".join(result["directives"]))

    def test_invalid_framework_and_dials_are_rejected(self):
        self.assertIn("framework must be one of", json.loads(server.build_from_text("demo", "x", "solid"))["error"])
        self.assertIn("design_variance", json.loads(server.build_from_text("demo", "x", "next", taste_dials={"design_variance": 11}))["error"])

    def test_source_path_cannot_escape_workspace(self):
        outside = tempfile.TemporaryDirectory()
        try:
            result = json.loads(server.build_from_source("demo", outside.name, "next"))
            self.assertIn("outside workspace", result["error"])
        finally:
            outside.cleanup()


if __name__ == "__main__":
    unittest.main()
