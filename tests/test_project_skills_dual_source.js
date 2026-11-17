#!/usr/bin/env node
'use strict';

/**
 * A project's own skills must be served even when they were never migrated into
 * the Konoha database. The database is an index of the project tree, not a
 * replacement for it, so an unmigrated project skill still has to answer
 * find_skill, get_skill, and list_skills.
 *
 * "Not migrated" is simulated honestly: KONOHA_DB_PATH points at a directory, so
 * opening the database throws exactly as it would when no database exists yet.
 * Migration is best-effort and swallows that failure, leaving the disk as the
 * only source of the project skill.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-project-skills-'));
const home = path.join(sandbox, 'home');
const project = path.join(sandbox, 'project');
const skillDir = path.join(project, '.agents', 'skills', 'project-only-skill');
fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(home, { recursive: true });

const SKILL_BODY = [
  '---',
  'name: project-only-skill',
  'description: Skill that exists only in this project tree.',
  '---',
  '',
  '# Project-only skill',
  '',
  'Marker line: PROJECT_ONLY_SKILL_BODY_7f3a.',
  ''
].join('\n');
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_BODY, 'utf8');

process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.KONOHA_WORKSPACE = project;
process.env.WORKSPACE_ROOT = project;
// A directory cannot be opened as a database, so nothing can be migrated.
process.env.KONOHA_DB_PATH = sandbox;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

const skillsCommon = require('../src/mcp/skills_common');
const skillsSearch = require('../src/mcp/skills_search');
const skillsRetrieval = require('../src/mcp/skills_retrieval');

console.log('project skills without migration:');

check('project skill roots include the workspace tree', () => {
  const roots = skillsCommon.getProjectSkillRoots();
  assert.ok(roots.includes(path.join(project, '.agents', 'skills')), `roots were ${JSON.stringify(roots)}`);
});

check('findInMirror resolves an unmigrated project skill', () => {
  const hit = skillsCommon.findInMirror('project-only-skill');
  assert.ok(hit, 'expected a mirror hit');
  assert.strictEqual(path.resolve(hit.filePath), path.resolve(skillDir, 'SKILL.md'));
});

check('find_skill returns the project skill with the database unavailable', () => {
  const res = JSON.parse(skillsSearch.findSkill('project-only', 3, 'sannin'));
  assert.ok(res.found >= 1, `found=${res.found}`);
  assert.ok(res.results.some(r => r.name === 'project-only-skill'), 'project skill missing from results');
});

check('get_skill loads the project skill with the database unavailable', () => {
  const res = JSON.parse(skillsRetrieval.getSkill('project-only-skill'));
  assert.ok(res.content && res.content.includes('PROJECT_ONLY_SKILL_BODY_7f3a'), `body not served: ${JSON.stringify(res).slice(0, 200)}`);
});

check('list_skills includes the project skill with the database unavailable', () => {
  const res = JSON.parse(skillsSearch.listSkills('sannin'));
  assert.ok(res.skills.some(s => s.name === 'project-only-skill'), 'project skill missing from list');
});

fs.rmSync(sandbox, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ Project skills are served without migration.');
