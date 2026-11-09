'use strict';

/**
 * tests/test_akatsuki_red_root_names.js
 *
 * H. Root/suffix red-skill name forms and resolved-row authorization.
 *
 * The bypass this covers: `akatsuki-skill/<ref>`, `akatsuki-skill@global-<h>`,
 * `akatsuki-skill@proj-<hash>`, and `akatsuki-skill-fixture` are all red, but
 * only the bare name used to be recognized. A second gap: an alias row whose
 * `name` is innocuous while `skill_name` is `akatsuki-skill` served the red
 * body to any identity because authorization ran before row resolution.
 *
 * Split from test_akatsuki_skill_authz_db_isolation.js to keep both files
 * under the repo's 700-line limit.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-rednames-'));
const SKILLS_ROOT = path.join(TMP_ROOT, '.agents', 'skills');
const SECRET_MARKER = 'RED_ROOT_NAME_SECRET_BODY';
const RED_SKILL = 'akatsuki-skill';

process.env.KONOHA_LAB_DB_ROOT = path.join(TMP_ROOT, 'akatsuki-lab');
process.env.KONOHA_DB_PATH = path.join(TMP_ROOT, 'konoha.db');
process.env.HOME = TMP_ROOT;
process.env.USERPROFILE = TMP_ROOT;
process.env.KONOHA_HOME = path.join(TMP_ROOT, '.konoha');

let testsPassed = 0;

function runTest(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

const dbModule = require('../src/db');
const authz = require('../src/skill_authorization');
const toolDispatch = require('../src/mcp/tool_dispatch');
const { getSkill, useSkills } = require('../src/mcp/skills_retrieval');
const { findSkill } = require('../src/mcp/skills_search');

const RED_NAME_FORMS = [
  RED_SKILL,
  `${RED_SKILL}/abusing-dpapi-for-credential-access`,
  `${RED_SKILL}@global-omp`,
  `${RED_SKILL}@proj-2d06f9de96c6`,
  `${RED_SKILL}-fixture`
];

function writeSkillDir(name, body) {
  const dir = path.join(SKILLS_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function upsertSkill(row) {
  const conn = dbModule.getConnection();
  dbModule.setupSchema(conn);
  conn.prepare('INSERT OR REPLACE INTO skills (name, skill_name, type, tags, content, byte_size, line_count, file_path) VALUES (?,?,?,?,?,?,?,?)')
    .run(row.name, row.skill_name, 'skill', row.tags, row.content, row.content.length, row.content.split('\n').length, row.file_path);
  conn.close();
}

function seedRedRows() {
  // Rows must exist for the "akatsuki still receives" assertion; denial holds
  // on the pre-resolution name check even with no row at all.
  const body = `# red\n\n${SECRET_MARKER}\n`;
  const file = writeSkillDir('red-seed', body);
  for (const name of RED_NAME_FORMS) {
    upsertSkill({ name, skill_name: RED_SKILL, tags: 'red-team,pentest', content: body, file_path: file });
  }
}

console.log('Running Akatsuki Red Root-Name Authorization Suite...\n');

runTest('H1 all root/suffix name forms classify red', () => {
  for (const name of RED_NAME_FORMS) {
    const res = authz.classifySkill(name);
    assert.strictEqual(res.red, true, `${name} must classify red`);
    assert.strictEqual(res.requires_lab, true, `${name} must require the lab`);
  }
});

runTest('H2 every root/suffix form is denied on getSkill, useSkills, findSkill, and dispatch', () => {
  for (const name of RED_NAME_FORMS) {
    const surfaces = {
      getSkill: getSkill(name, 'kage'),
      useSkills: useSkills(name, 'kage'),
      findSkill: findSkill(name, { agentName: 'kage' }),
      dispatch: toolDispatch.executeToolSync('get_skill', { name, agent: 'kage' })
    };
    for (const [surface, raw] of Object.entries(surfaces)) {
      assert.ok(raw.includes('SKILL_AUTHORIZATION_DENIED'), `${surface} must deny ${name}`);
      assert.ok(!raw.includes(SECRET_MARKER), `${surface} must not leak ${name}`);
    }
  }
});

runTest('H3 @akatsuki still receives every root/suffix form (guard is not blanket denial)', () => {
  seedRedRows();
  for (const name of RED_NAME_FORMS) {
    assert.ok(getSkill(name, 'akatsuki', { tokenBudget: 50 }).includes(SECRET_MARKER), `akatsuki must receive ${name}`);
  }
});

runTest('H4 absent identity denies every root/suffix form', () => {
  for (const name of RED_NAME_FORMS) {
    assert.strictEqual(JSON.parse(getSkill(name, null)).code, 'SKILL_AUTHORIZATION_DENIED', name);
  }
});

runTest('H5 a blue-looking alias row resolving to a red skill is denied after resolution', () => {
  // The alias name passes the pre-resolution check (no red tag, no red root);
  // only the post-resolution check on row.skill_name stops it.
  const file = writeSkillDir('ops-helper', SECRET_MARKER);
  upsertSkill({ name: 'ops-helper', skill_name: RED_SKILL, tags: 'ops,helper', content: SECRET_MARKER, file_path: file });
  for (const raw of [getSkill('ops-helper', 'kage'), useSkills('ops-helper', 'kage')]) {
    assert.ok(raw.includes('SKILL_AUTHORIZATION_DENIED'), 'alias must be denied on every retrieval surface');
    assert.ok(!raw.includes(SECRET_MARKER), 'alias must not leak the red body');
  }
});

runTest('H6 the same alias is served to @akatsuki (resolution does not over-deny)', () => {
  assert.ok(getSkill('ops-helper', 'akatsuki').includes(SECRET_MARKER), 'akatsuki must receive the aliased red body');
});

runTest('H7 blue skills with a scoped suffix still serve to blue identities', () => {
  const file = writeSkillDir('anbu-skill', 'BACKEND_BLUE_BODY');
  upsertSkill({ name: 'anbu-skill@proj-deadbeef', skill_name: 'anbu-skill', tags: 'backend,devops', content: 'BACKEND_BLUE_BODY', file_path: file });
  const raw = getSkill('anbu-skill@proj-deadbeef', 'kage');
  assert.ok(raw.includes('BACKEND_BLUE_BODY'), 'blue scoped rows must keep serving');
  assert.ok(!raw.includes('SKILL_AUTHORIZATION_DENIED'));
});

cleanup();
console.log(`\n${testsPassed} test cases passed.`);