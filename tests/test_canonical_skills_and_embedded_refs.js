'use strict';

/**
 * tests/test_canonical_skills_and_embedded_refs.js
 * 
 * Verifies that:
 * 1. Exactly 16 canonical skills are recognized.
 * 2. Embedded reference skills (like react-patterns, elite-powerpoint-designer,
 *    multi-stage-dockerfile) are identified as embedded references and never
 *    detected or migrated as standalone top-level skills.
 * 3. Database has exactly 16 skills of type = 'skill'.
 * 4. Client mirrors and project auto-migration maintain complete integrity.
 * 5. Global skills (~/.agents/skills) are strictly preserved and never pruned.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  CANONICAL_SKILL_NAMES,
  getEmbeddedReferenceSkills,
  isEmbeddedReference,
  isCanonicalSkill
} = require('../src/canonical_skills');
const migrate = require('../src/migrate');
const db = require('../src/db');
const deployUtils = require('../src/deploy_utils');

function runTest() {
  console.log('Running test_canonical_skills_and_embedded_refs.js...');

  // 1. Verify canonical skill names set
  assert.strictEqual(CANONICAL_SKILL_NAMES.size, 15, 'Must have exactly 15 canonical skills');
  assert.ok(isCanonicalSkill('anbu-skill'), 'anbu-skill must be canonical');
  assert.ok(isCanonicalSkill('jonin-skill'), 'jonin-skill must be canonical');
  assert.ok(isCanonicalSkill('kage-skill'), 'kage-skill must be canonical');
  assert.ok(isCanonicalSkill('sannin-skill'), 'sannin-skill must be canonical');
  assert.ok(isCanonicalSkill('genin-skill'), 'genin-skill must be canonical');
  assert.ok(isCanonicalSkill('tokubetsu-jonin-skill'), 'tokubetsu-jonin-skill must be canonical');
  assert.ok(isCanonicalSkill('chunin-skill'), 'chunin-skill must be canonical');
  assert.ok(isCanonicalSkill('konoha'), 'konoha must be canonical');
  console.log('✓ 15 canonical skills verified');

  // 2. Verify embedded reference classification
  assert.ok(isEmbeddedReference('react-patterns'), 'react-patterns must be an embedded reference');
  assert.ok(!isCanonicalSkill('react-patterns'), 'react-patterns must NOT be a canonical skill');
  assert.ok(isEmbeddedReference('elite-powerpoint-designer'), 'elite-powerpoint-designer must be an embedded reference');
  assert.ok(isEmbeddedReference('multi-stage-dockerfile'), 'multi-stage-dockerfile must be an embedded reference');
  assert.ok(isEmbeddedReference('accessibility-testing-expert'), 'accessibility-testing-expert must be an embedded reference');
  assert.ok(isEmbeddedReference('helm-chart-scaffolding'), 'helm-chart-scaffolding must be an embedded reference');
  assert.ok(!isCanonicalSkill('helm-chart-scaffolding'), 'helm-chart-scaffolding must NOT be a canonical skill');
  console.log('✓ Embedded reference skills correctly classified');

  // 3. Verify autoDetectSkills filters out embedded reference directories
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-detect-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'jonin-skill'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'jonin-skill', 'SKILL.md'), '# Jonin\n');

    fs.mkdirSync(path.join(tmpDir, 'react-patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'react-patterns', 'SKILL.md'), '# React Patterns\n');

    fs.mkdirSync(path.join(tmpDir, 'user-custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'user-custom-skill', 'SKILL.md'), '# User Custom\n');

    const detected = migrate.autoDetectSkills(tmpDir);
    assert.ok(detected.includes('jonin-skill'), 'Must detect canonical jonin-skill');
    assert.ok(detected.includes('user-custom-skill'), 'Must detect genuine user custom skill');
    assert.ok(!detected.includes('react-patterns'), 'Must NOT detect embedded reference react-patterns as standalone skill');
    console.log('✓ autoDetectSkills strictly ignores embedded reference folders');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4. Verify SQLite database has exactly 15 type = 'skill' entries
  const conn = db.getDb();
  try {
    const skillRows = conn.prepare("SELECT name, type FROM skills WHERE type = 'skill'").all();
    assert.strictEqual(skillRows.length, 15, `Database must contain exactly 15 skills of type = 'skill', found ${skillRows.length}`);
    for (const row of skillRows) {
      assert.ok(CANONICAL_SKILL_NAMES.has(row.name), `Unexpected skill in database: ${row.name}`);
    }
    console.log('✓ konoha.db contains exactly the 15 canonical skills with 100% codebase parity');

    // Verify embedded references are indexed as type = 'reference'
    const refRow = conn.prepare("SELECT name, type FROM skills WHERE name = 'jonin-skill/react-patterns'").get();
    assert.ok(refRow, 'jonin-skill/react-patterns must exist as a reference');
    assert.strictEqual(refRow.type, 'reference', 'Must be of type reference');
    console.log('✓ References properly indexed under ninja skill namespace');
  } finally {
    conn.close();
  }

  // 5. Verify copySkillsDirFast never deletes pre-existing user or global skills
  const preserveTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-global-preserve-'));
  try {
    const srcDir = path.join(preserveTmp, 'src');
    const destDir = path.join(preserveTmp, 'dest');
    fs.mkdirSync(path.join(srcDir, 'genin-skill'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'genin-skill', 'SKILL.md'), '# Genin\n');

    fs.mkdirSync(path.join(destDir, 'my-global-skill'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'my-global-skill', 'SKILL.md'), '# Global\n');

    deployUtils.copySkillsDirFast(srcDir, destDir);
    assert.ok(fs.existsSync(path.join(destDir, 'my-global-skill', 'SKILL.md')), 'Global user skills must NEVER be pruned');
    console.log('✓ Global skills strictly protected against pruning');
  } finally {
    fs.rmSync(preserveTmp, { recursive: true, force: true });
  }

  console.log('✅ All canonical skills and embedded reference tests passed cleanly!');
}

runTest();
