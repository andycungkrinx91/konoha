'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.agents', 'skills');

const CORE_NINJA_SKILLS = [
  'anbu-skill',
  'chunin-skill',
  'genin-skill',
  'jonin-skill',
  'kage-skill',
  'konoha',
  'sannin-skill',
  'tokubetsu-jonin-skill',
];

const CANONICAL_SKILLS = fs.existsSync(AGENTS_DIR)
  ? fs.readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  : CORE_NINJA_SKILLS;

const CLIENT_DIRS = [
  path.join(ROOT, '.cursor', 'skills'),
  path.join(ROOT, '.gemini', 'skills'),
  path.join(ROOT, '.commandcode', 'skills'),
  path.join(ROOT, '.claude', 'skills'),
  path.join(ROOT, 'src', 'templates', 'skills'),
];

async function testClientSkillsSync() {
  console.log('Running test_client_skills_sync...');

  // 1. Verify canonical .agents/skills has all core ninja skills
  assert.ok(fs.existsSync(AGENTS_DIR), '.agents/skills must exist');
  for (const skill of CORE_NINJA_SKILLS) {
    const skillMd = path.join(AGENTS_DIR, skill, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd), `Core skill ${skill}/SKILL.md must exist in .agents/skills`);
  }
  console.log('✓ Canonical .agents/skills verified with all core ninja skills');

  // 2. Verify scripts/sync_skills.js runs cleanly and enforces complete parity
  const { syncSkills } = require('../scripts/sync_skills');
  assert.strictEqual(typeof syncSkills, 'function', 'syncSkills must be a function');
  syncSkills();
  console.log('✓ scripts/sync_skills.js executed cleanly');

  // 3. Verify all client mirror trees have all canonical skills and zero stray files
  for (const cDir of CLIENT_DIRS) {
    assert.ok(fs.existsSync(cDir), `Mirror directory ${cDir} must exist`);
    const entries = fs.readdirSync(cDir, { withFileTypes: true });

    // Check all canonical skills are present
    const dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const skill of CANONICAL_SKILLS) {
      assert.ok(dirNames.includes(skill), `Mirror directory ${cDir} must contain canonical skill ${skill}`);
      const skillMd = path.join(cDir, skill, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `${cDir}/${skill}/SKILL.md must exist`);
    }

    // Check zero broken symlinks and zero stray files (.claude, .cursor, CLAUDE.md)
    for (const e of entries) {
      assert.ok(!e.isSymbolicLink(), `Mirror directory ${cDir} must not contain symlink: ${e.name}`);
      assert.notStrictEqual(e.name, '.claude', `Mirror directory ${cDir} must not contain stray .claude`);
      assert.notStrictEqual(e.name, '.cursor', `Mirror directory ${cDir} must not contain stray .cursor`);
      assert.notStrictEqual(e.name, 'CLAUDE.md', `Mirror directory ${cDir} must not contain stray CLAUDE.md`);
      if (e.name !== '.ignore' && !e.name.endsWith('.fingerprint')) {
        assert.ok(CANONICAL_SKILLS.includes(e.name), `Unexpected top-level entry in ${cDir}: ${e.name}`);
      }
    }
    console.log(`✓ Mirror directory ${path.relative(ROOT, cDir)} verified in 100% parity`);
  }

  // 4. Verify skill_manager.syncAllClientSkills supports .commandcode and .claude in projectRoot
  const skillManager = require('../src/skill_manager');
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-sync-test-'));
  try {
    fs.mkdirSync(path.join(tmpProject, '.commandcode'), { recursive: true });
    fs.mkdirSync(path.join(tmpProject, '.claude'), { recursive: true });
    const syncRes = skillManager.syncAllClientSkills({ projectRoot: tmpProject, silent: true });
    assert.ok(syncRes.synced >= 9, `Expected at least 9 synced targets, got ${syncRes.synced}`);
    assert.ok(fs.existsSync(path.join(tmpProject, '.commandcode', 'skills', 'konoha', 'SKILL.md')), 'Project .commandcode/skills must be populated');
    assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'skills', 'konoha', 'SKILL.md')), 'Project .claude/skills must be populated');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
  console.log('✓ skillManager.syncAllClientSkills project-level client synchronization verified');

  // 5. Verify database FTS5 and vector chunks referential integrity
  const db = require('../src/db');
  const conn = db.getDb();
  const ftsRow = conn.prepare('SELECT COUNT(*) as c FROM skills_fts').get();
  assert.ok(ftsRow && ftsRow.c > 0, 'skills_fts must contain indexed skills');
  
  const orphanedChunks = conn.prepare('SELECT COUNT(*) as c FROM skill_chunks WHERE skill_name NOT IN (SELECT name FROM skills)').get();
  assert.strictEqual(orphanedChunks.c, 0, 'skill_chunks must have 0 orphaned chunks');
  console.log(`✓ Database FTS5 (${ftsRow.c} entries) and Vector Chunks referential integrity verified (0 orphans)`);

  console.log('✅ All client skills sync tests passed cleanly!');
}

testClientSkillsSync().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
