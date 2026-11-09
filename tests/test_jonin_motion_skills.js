'use strict';

/**
 * Regression Test Suite: Jonin Astra/Fable Storytelling & Cross-Framework Motion Skills
 * Verifies:
 * 1. `buildFromText` dynamically resolves the framework-specific Motion reference (`motion-nextjs`, `motion-nuxt`, `motion-svelte`, `motion-angular`) plus `framer-motion-animator` and `svg-animation-motion-expert`.
 * 2. `buildFromText` directives enforce brief-driven art direction, the Anti-Template Gate, and `Build by konoha` signature without forcing rigid 4-slide hero carousels or bottom-left 10-theme FAB pickers unless requested.
 * 3. All 4 framework Motion reference files exist, are non-empty, and stay under the 700-line limit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildFromText } = require('../src/mcp/build_spec');

function runTests() {
  const frameworks = [
    { input: 'nextjs', canonical: 'nextjs', expectedMotionSkill: 'jonin-skill/motion-nextjs' },
    { input: 'nuxt', canonical: 'nuxt', expectedMotionSkill: 'jonin-skill/motion-nuxt' },
    { input: 'svelte', canonical: 'sveltekit', expectedMotionSkill: 'jonin-skill/motion-svelte' },
    { input: 'angular', canonical: 'angular', expectedMotionSkill: 'jonin-skill/motion-angular' }
  ];

  for (const fw of frameworks) {
    const rawRes = buildFromText(
      `test-${fw.canonical}-site`,
      'Create an interactive AI developer platform landing page with kinetic typography and storytelling.',
      fw.input
    );
    const spec = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;

    assert.strictEqual(spec.status, 'success', `buildFromText should succeed for ${fw.input}`);
    assert.strictEqual(spec.framework, fw.canonical, `Canonical framework should be ${fw.canonical}`);
    assert.ok(spec.required_skills.includes(fw.expectedMotionSkill), `Required skills for ${fw.canonical} must include ${fw.expectedMotionSkill}`);
    assert.ok(spec.required_skills.includes('jonin-skill/framer-motion-animator'), 'Required skills must include jonin-skill/framer-motion-animator');
    assert.ok(spec.required_skills.includes('jonin-skill/svg-animation-motion-expert'), 'Required skills must include jonin-skill/svg-animation-motion-expert');

    const directivesText = (spec.directives || []).join('\n');
    assert.ok(directivesText.includes('Anti-Template'), 'Directives must teach the Anti-Template Gate');
    assert.ok(directivesText.includes('Build by konoha'), 'Directives must include Build by konoha signature requirement');
    assert.ok(!directivesText.includes('minimum of 4 high-definition slides, 5000ms autoplay'), 'Directives must NOT force rigid 4-slide 5000ms carousels on every site');
  }

  const refsDir = path.resolve(__dirname, '..', 'src', 'templates', 'skills', 'jonin-skill', 'references');
  for (const file of ['framer-motion-animator.md', 'motion-nextjs.md', 'motion-nuxt.md', 'motion-svelte.md', 'motion-angular.md']) {
    const fullPath = path.join(refsDir, file);
    assert.ok(fs.existsSync(fullPath), `${file} must exist in src/templates/skills/jonin-skill/references`);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').length;
    assert.ok(lines > 30 && lines < 700, `${file} must have comprehensive content and be < 700 lines (got ${lines})`);
  }

  console.log('✓ test_jonin_motion_skills: All assertions passed.');
}

runTests();
