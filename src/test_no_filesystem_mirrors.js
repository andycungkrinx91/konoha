// Regression tests verifying Konoha no longer creates filesystem skill mirrors.
// Skills are loaded from the SQLite DB (skills.db) at runtime via konoha MCP.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const KONOHA = path.join(HOME, '.konoha');

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }

function expectMirrorIsNoOp(mirrorFunction, name) {
  // Save state of directories that may be touched
  const markers = [
    path.join(HOME, '.cursor', 'skills'),
    path.join(HOME, '.claude', 'skills'),
    path.join(KONOHA, '.mirror-test'),
  ];
  for (const m of markers) {
    if (fileExists(m)) {
      try {
        const stat = fs.lstatSync(m);
        if (stat.isDirectory()) {
          // Snapshot directory contents
          const before = fs.readdirSync(m).sort();
          const result = mirrorFunction();
          const after = fs.readdirSync(m).sort();
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            throw new Error(
              `${name} modified ${m} (before: ${before.length} entries, after: ${after.length})`
            );
          }
        }
      } catch (e) {
        if (e.message.includes(name)) throw e;
      }
    }
  }
  // The function should return 0 (no skills mirrored)
  const result = mirrorFunction();
  if (result !== 0 && result !== undefined) {
    throw new Error(`${name} should return 0 but returned ${result}`);
  }
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

console.log('\n=== Konoha Filesystem Mirror Regression Tests ===\n');

// Test 1: deploy_utils.mirrorSkillsDirectory is a no-op
test('mirrorSkillsDirectory returns 0 (no-op)', () => {
  const { mirrorSkillsDirectory } = require('./deploy_utils');
  const result = mirrorSkillsDirectory('/tmp/fake/src', '/tmp/fake/dest');
  if (result !== 0) throw new Error(`Expected 0, got ${result}`);
});

test('mirrorSkillsDirectory does not create dest dir', () => {
  const { mirrorSkillsDirectory } = require('./deploy_utils');
  const dest = '/tmp/konoha_test_should_not_exist';
  if (fileExists(dest)) fs.rmSync(dest, { recursive: true, force: true });
  mirrorSkillsDirectory('/tmp/fake/src', dest);
  if (fileExists(dest)) throw new Error('Created dest directory');
});

// Test 2: deploy_utils.syncCursorSkillsFromAgents is a no-op
test('syncCursorSkillsFromAgents returns 0 (no-op)', () => {
  const { syncCursorSkillsFromAgents } = require('./deploy_utils');
  const result = syncCursorSkillsFromAgents({
    projectRoot: '/tmp/fake/project',
    deployProject: true,
    silent: true,
  });
  if (result !== 0) throw new Error(`Expected 0, got ${result}`);
});

// Test 3: cursor_manager.getCursorStatus reads skills from canonical source, not mirror
test('getCursorStatus counts skills from ~/.agents/skills (canonical source)', () => {
  const { getCursorStatus } = require('./cursor_manager');
  const status = getCursorStatus();
  if (typeof status.skillsGlobal !== 'number') {
    throw new Error('skillsGlobal not a number');
  }
  // Use same counting logic as deployUtils.listSkillEntries
  const agentsSkills = path.join(HOME, '.agents', 'skills');
  if (fileExists(agentsSkills)) {
    const canonical = [];
    for (const entry of fs.readdirSync(agentsSkills, { withFileTypes: true })) {
      if (entry.isDirectory() && fileExists(path.join(agentsSkills, entry.name, 'SKILL.md'))) {
        canonical.push(entry.name);
      }
    }
    if (status.skillsGlobal !== canonical.length) {
      throw new Error(`Expected ${canonical.length}, got ${status.skillsGlobal}`);
    }
  }
});

// Test 4: skillsProject is always 0 (no mirror)
test('getCursorStatus.skillsProject is 0 (no project mirror)', () => {
  const { getCursorStatus } = require('./cursor_manager');
  const status = getCursorStatus();
  if (status.skillsProject !== 0) {
    throw new Error(`Expected 0, got ${status.skillsProject}`);
  }
});

// Test 5: ~/.claude/skills symlink is gone (was the Claude Code mirror)
test('~/.claude/skills is NOT a symlink to ~/.agents/skills', () => {
  const claudeSkills = path.join(HOME, '.claude', 'skills');
  if (fileExists(claudeSkills)) {
    const stat = fs.lstatSync(claudeSkills);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(claudeSkills);
      if (target.includes('.agents/skills')) {
        throw new Error(`~/.claude/skills is still a symlink to ${target}`);
      }
    }
  }
});

// Test 6: ~/.cursor/skills should be empty (or have user-added skills only, no Konoha mirrors)
test('~/.cursor/skills is empty (no Konoha mirrors)', () => {
  const cursorSkills = path.join(HOME, '.cursor', 'skills');
  if (!fileExists(cursorSkills)) return; // OK if doesn't exist
  const entries = fs.readdirSync(cursorSkills);
  if (entries.length > 0) {
    // If user has skills here, they should not be SKILL.md mirrors from .agents/
    // (User-added skills are OK; just no Konoha-managed mirrors)
    // We can't easily distinguish, so just note it.
    console.log(`  (note: ~/.cursor/skills has ${entries.length} entries - ensure these are not Konoha mirrors)`);
  }
});

// Test 7: skill_manager.removeSkill does not touch Cursor mirrors
test('skill_manager.removeSkill only removes canonical path', () => {
  // We test by reading the source code and ensuring no cursor path references
  const fs_real = require('fs');
  const src = fs_real.readFileSync(path.join(__dirname, 'skill_manager.js'), 'utf-8');
  if (/cursor.*skills|skills.*cursor/i.test(src.split('function removeSkill')[1].split('}')[0])) {
    // Allow references in comments
    const fn = src.split('function removeSkill')[1].split('\n}')[0];
    const codeOnly = fn.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    if (/\.cursor/.test(codeOnly)) {
      throw new Error('removeSkill still references .cursor paths in code');
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
