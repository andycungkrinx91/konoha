#!/usr/bin/env node
'use strict';

/**
 * tests/test_dev_skill_routing.js — The maintainer skill must be reachable by the
 * MCP lookup path, and it must be unreachable by the deployment path.
 *
 * Those two requirements pull in opposite directions, which is exactly why this
 * needs a test: `get_skill('konoha-maintenance')` resolves only because
 * `.agents/dev-skills` is a project skill root, while `sync_skills.js` walks
 * `src/templates/skills` only. Widen the deploy source and the maintainer
 * reference leaks to every client; drop the read root and the skill becomes
 * dead weight no agent can load.
 *
 * `findInMirror` is the resolution primitive `get_skill` falls back to, so it is
 * exercised directly here rather than through a database round trip.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Resolution is workspace-scoped: pin it to this repo before loading the module,
// because the roots are computed from the workspace root at call time.
process.env.KONOHA_WORKSPACE = ROOT;
process.chdir(ROOT);

const skillsCommon = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));
const DEV_SKILL = path.join(ROOT, '.agents', 'dev-skills', 'konoha-maintenance');

function run() {
  console.log('Running test_dev_skill_routing tests...');

  // ── Reachable by lookup: a maintainer can actually load it. ─────────────────
  const roots = skillsCommon.getProjectSkillRoots().map((p) => path.relative(ROOT, p));
  assert.ok(roots.includes(path.join('.agents', 'dev-skills')), `.agents/dev-skills must be a project skill root, got ${roots.join(', ')}`);

  const entry = skillsCommon.findInMirror('konoha-maintenance');
  assert.ok(entry, 'get_skill fallback must resolve konoha-maintenance');
  assert.strictEqual(
    path.resolve(entry.filePath),
    path.join(DEV_SKILL, 'SKILL.md'),
    'konoha-maintenance must resolve to the repo-only dev skill'
  );

  const ref = skillsCommon.findInMirror('konoha-maintenance/invariants');
  assert.strictEqual(
    path.resolve(ref.filePath),
    path.join(DEV_SKILL, 'references', 'invariants.md'),
    'konoha-maintenance references must resolve through the same root'
  );
  console.log('✓ konoha-maintenance and its references resolve from the repo root');

  // ── Unreachable by deploy: sync_skills walks src/templates/skills only. ─────
  const syncSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'sync_skills.js'), 'utf8');
  assert.ok(/TEMPLATES_DIR/.test(syncSrc), 'sync_skills.js must deploy from TEMPLATES_DIR');
  assert.ok(!/dev-skills/.test(syncSrc), 'sync_skills.js must not know about .agents/dev-skills');
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'src', 'templates', 'skills', 'konoha-maintenance')),
    'konoha-maintenance must never appear in src/templates/skills (the deploy source)'
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, '.agents', 'skills', 'konoha-maintenance')),
    'konoha-maintenance must never appear in .agents/skills (a published subset)'
  );
  console.log('✓ konoha-maintenance is excluded from the deploy source');

  // The shipped skill points at the dev path, so a maintainer reading the deployed
  // copy learns where the guidance went instead of hunting for it.
  const shipped = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'skills', 'konoha', 'SKILL.md'), 'utf8');
  assert.ok(
    shipped.includes('.agents/dev-skills/konoha-maintenance'),
    'the shipped konoha skill must point maintainers at the dev skill location'
  );
  console.log('✓ shipped skill points maintainers at the dev skill');

  console.log('\nAll test_dev_skill_routing tests passed!');
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

module.exports = { run };
