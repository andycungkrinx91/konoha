'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.agents', 'skills');

const CORE_NINJA_SKILLS = [
  'akatsuki-skill',
  'anbu-skill',
  'chunin-skill',
  'genin-skill',
  'jonin-skill',
  'kage-skill',
  'konoha',
  'sannin-skill',
  'tokubetsu-jonin-skill',
];

const CLIENT_DIRS = [
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

  // 3. Verify templates tree has all canonical skills and zero stray files, and client mirror trees do NOT exist
  for (const cDir of CLIENT_DIRS) {
    assert.ok(fs.existsSync(cDir), `Templates directory ${cDir} must exist`);
    const entries = fs.readdirSync(cDir, { withFileTypes: true });

    // Check all canonical skills are present
    const dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const skill of CORE_NINJA_SKILLS) {
      assert.ok(dirNames.includes(skill), `Templates directory ${cDir} must contain canonical skill ${skill}`);
      const skillMd = path.join(cDir, skill, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `${cDir}/${skill}/SKILL.md must exist`);
    }

    // Check zero broken symlinks and zero stray files (.claude, .cursor, CLAUDE.md)
    for (const e of entries) {
      assert.ok(!e.isSymbolicLink(), `Templates directory ${cDir} must not contain symlink: ${e.name}`);
      assert.notStrictEqual(e.name, '.claude', `Templates directory ${cDir} must not contain stray .claude`);
      assert.notStrictEqual(e.name, '.cursor', `Templates directory ${cDir} must not contain stray .cursor`);
      assert.notStrictEqual(e.name, 'CLAUDE.md', `Templates directory ${cDir} must not contain stray CLAUDE.md`);
    }
    console.log(`✓ Directory ${path.relative(ROOT, cDir)} verified in parity`);
  }

  // Verify client skill directories do not exist in the repo
  for (const clientName of ['.cursor', '.gemini', '.commandcode', '.claude', '.omp']) {
    const clientSkillsDir = path.join(ROOT, clientName, 'skills');
    assert.ok(!fs.existsSync(clientSkillsDir), `Client skill directory ${clientSkillsDir} must not exist`);
  }
  console.log('✓ Client mirror directories confirmed absent from workspace');

  // 4. Verify skill_manager.syncAllClientSkills synchronizes ONLY to ~/.agents/skills (never injecting into project)
  const skillManager = require('../src/skill_manager');
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-sync-test-'));
  try {
    fs.mkdirSync(path.join(tmpProject, '.commandcode'), { recursive: true });
    fs.mkdirSync(path.join(tmpProject, '.claude'), { recursive: true });
    const syncRes = skillManager.syncAllClientSkills({ projectRoot: tmpProject, silent: true });
    assert.strictEqual(syncRes.synced, 1, `Expected exactly 1 synced target (~/.agents/skills), got ${syncRes.synced}`);
    assert.ok(!fs.existsSync(path.join(tmpProject, '.commandcode', 'skills')), 'Project .commandcode/skills must NOT be created');
    assert.ok(!fs.existsSync(path.join(tmpProject, '.claude', 'skills')), 'Project .claude/skills must NOT be created');
  } finally {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
  console.log('✓ skillManager.syncAllClientSkills single-source synchronization verified');

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
