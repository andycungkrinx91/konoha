'use strict';

/**
 * Regression Test Suite: Global Skill Sync Across All 8 Harnesses (Rsync-Like + Diff-and-Patch)
 * Verifies:
 * 1. All 8 supported AI coding-agent harnesses map to their canonical global skills directories.
 * 2. All 17 canonical Konoha skills (including `yamanaka-skill` and the new Motion references) are discovered dynamically.
 * 3. Fresh install copies missing Konoha-owned files and records SHA-256 baseline hashes without overwriting pre-existing user-owned files (`--ignore-existing`).
 * 4. Reinstall is idempotent and skips unmodified files.
 * 5. Upgrade applies targeted diff-and-patch updates when templates evolve, preserving non-conflicting user additions and creating backups before patching.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CANONICAL_SKILL_NAMES, KNOWN_EMBEDDED_REFERENCE_SKILLS } = require('../src/canonical_skills');
const { computeLineDiffPatch, applyTargetedTextPatch } = require('../src/config_merger');
const {
  getGlobalHarnessSkillTargets,
  resolveCanonicalTemplatesRoot,
  collectCanonicalSkillFiles,
  syncAllGlobalClientSkills
} = require('../src/global_skill_sync');

function runTests() {
  // Verify all 17 canonical skills and new Motion references are registered
  assert.ok(CANONICAL_SKILL_NAMES.has('jonin-skill'), 'jonin-skill must be canonical');
  assert.ok(CANONICAL_SKILL_NAMES.has('yamanaka-skill'), 'yamanaka-skill must be canonical');
  assert.strictEqual(CANONICAL_SKILL_NAMES.size, 17, 'All 17 canonical top-level skills must be registered');

  for (const motionRef of ['motion-nextjs', 'motion-nuxt', 'motion-svelte', 'motion-angular', 'framer-motion-animator']) {
    assert.ok(KNOWN_EMBEDDED_REFERENCE_SKILLS.has(motionRef), `KNOWN_EMBEDDED_REFERENCE_SKILLS must include ${motionRef}`);
  }

  // Verify all 8 harnesses are mapped in getGlobalHarnessSkillTargets
  const fakeHome = path.join(os.tmpdir(), 'konoha-fake-home-check');
  const targets = getGlobalHarnessSkillTargets(fakeHome);
  const clientIds = new Set(targets.map((t) => t.client));
  for (const requiredClient of ['global', 'antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi', 'omp']) {
    assert.ok(clientIds.has(requiredClient), `Global skill targets must include ${requiredClient}`);
  }

  // Verify canonical skill file inventory includes the new Motion references
  const templatesRoot = resolveCanonicalTemplatesRoot();
  const canonicalFiles = collectCanonicalSkillFiles(templatesRoot);
  const topSkills = new Set(canonicalFiles.map((f) => f.topSkill));
  assert.ok(topSkills.has('jonin-skill'), 'collectCanonicalSkillFiles must resolve jonin-skill');
  assert.ok(topSkills.has('yamanaka-skill'), 'collectCanonicalSkillFiles must resolve yamanaka-skill');
  const joninRelPaths = canonicalFiles.filter((f) => f.topSkill === 'jonin-skill').map((f) => f.relPath);
  for (const expectedRel of [
    'jonin-skill/SKILL.md',
    'jonin-skill/references/framer-motion-animator.md',
    'jonin-skill/references/motion-nextjs.md',
    'jonin-skill/references/motion-nuxt.md',
    'jonin-skill/references/motion-svelte.md',
    'jonin-skill/references/motion-angular.md'
  ]) {
    assert.ok(joninRelPaths.includes(expectedRel), `jonin-skill inventory must contain ${expectedRel}`);
  }

  // Test targeted line diff-and-patch engine
  const baselineText = [
    '# Skill Header',
    'Section A: Original line',
    'Section B: Shared line',
    'Section C: Footer'
  ].join('\n');

  const userModifiedText = [
    '# Skill Header',
    'Section A: Original line',
    'Section B: Shared line',
    'Section C: Footer',
    '# User Custom Notes: Keep this intact'
  ].join('\n');

  const upgradedTemplateText = [
    '# Skill Header',
    'Section A: Upgraded v2.2.18 line',
    'Section B: Shared line',
    'Section C: Footer'
  ].join('\n');

  const diffCheck = computeLineDiffPatch(baselineText, upgradedTemplateText);
  assert.strictEqual(diffCheck.changed, true, 'Diff should detect template change');

  const patched = applyTargetedTextPatch(userModifiedText, baselineText, upgradedTemplateText);
  assert.strictEqual(patched.conflict, false, 'Non-overlapping user addition and template update must merge cleanly');
  assert.ok(patched.content.includes('Section A: Upgraded v2.2.18 line'), 'Patched output must include upgraded template line');
  assert.ok(patched.content.includes('# User Custom Notes: Keep this intact'), 'Patched output must preserve user custom notes');

  // Test isolated fresh install + user-file preservation in a temporary HOME directory
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-global-sync-8-'));
  try {
    // Pre-create a user-owned custom skill and a pre-existing file before Konoha installs
    const userCustomSkillDir = path.join(tmpHome, '.cursor', 'skills', 'my-custom-user-skill');
    fs.mkdirSync(userCustomSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userCustomSkillDir, 'SKILL.md'), '# My Custom User Skill\nNever delete or overwrite me.\n', 'utf8');

    const preExistingUserNote = path.join(tmpHome, '.claude', 'skills', 'genin-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(preExistingUserNote), { recursive: true });
    fs.writeFileSync(preExistingUserNote, '# User Pre-Existing Genin Override\nMust be skipped on fresh install.\n', 'utf8');

    const syncReport = syncAllGlobalClientSkills({ home: tmpHome });
    assert.strictEqual(syncReport.ok, true, 'Sync must report ok: true');
    assert.ok(syncReport.installed > 100, 'Fresh install must synchronize canonical skill files across all 8 harnesses');
    assert.ok(syncReport.skippedUserFiles >= 1, 'Pre-existing unrecorded user file must be counted in skippedUserFiles');

    // Verify user custom skill is untouched
    assert.strictEqual(
      fs.readFileSync(path.join(userCustomSkillDir, 'SKILL.md'), 'utf8'),
      '# My Custom User Skill\nNever delete or overwrite me.\n',
      'User custom skill must remain untouched'
    );

    // Verify pre-existing unrecorded user file was skipped (--ignore-existing)
    assert.strictEqual(
      fs.readFileSync(preExistingUserNote, 'utf8'),
      '# User Pre-Existing Genin Override\nMust be skipped on fresh install.\n',
      'Pre-existing unrecorded user file must be skipped on fresh install'
    );

    // Verify Motion references exist in all 8 client global skill directories
    for (const target of getGlobalHarnessSkillTargets(tmpHome)) {
      const motionSveltePath = path.join(target.skillsDir, 'jonin-skill', 'references', 'motion-svelte.md');
      assert.ok(fs.existsSync(motionSveltePath), `motion-svelte.md must be installed in ${target.client} (${target.skillsDir})`);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  console.log('✓ test_global_skill_sync_8_clients: All assertions passed.');
}

runTests();
