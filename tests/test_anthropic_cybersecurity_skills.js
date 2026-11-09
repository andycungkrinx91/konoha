/**
 * Test Suite: cyber pack opt-in boundary.
 *
 * The pack is not shipped. Default install indexes zero cyber rows; opting in
 * indexes exactly 817 under akatsuki-skill and zero under anbu-skill.
 *
 * The opt-in half runs against a locally built archive when one exists
 * (`dist/akatsuki-cyber-pack-<version>.tar.zst`); otherwise it is skipped and
 * reported, never silently passed.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACK_ASSET_DIR = 'anthropic-cybersecurity-skills-assets';
const CYBER_ROW_MATCH = `%${PACK_ASSET_DIR}%`;
const PACK_ROW_MATCH = '%cyber-pack%skills%';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-cyber-test-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'test.db');

const db = require('../src/db');
const conn = db.getConnection();
db.setupSchema(conn);

const migrate = require('../src/migrate');
const skillsModule = require('../src/mcp/skills');
const cyberPack = require('../src/cyber_pack');

function cyberRows(skillName) {
  return conn.prepare(
    'SELECT COUNT(*) n FROM skills WHERE skill_name = ? AND (file_path LIKE ? OR file_path LIKE ?)'
  ).get(skillName, CYBER_ROW_MATCH, PACK_ROW_MATCH).n;
}

function assertDefaultInstallClean() {
  assert.strictEqual(cyberPack.getState(), 'absent', 'Default install must not be opted in');
  assert.strictEqual(cyberRows('akatsuki-skill'), 0, 'Default install must index 0 cyber rows under akatsuki-skill');
  assert.strictEqual(cyberRows('anbu-skill'), 0, 'Default install must index 0 cyber rows under anbu-skill');
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, 'src', 'templates', 'skills', 'akatsuki-skill', 'references', PACK_ASSET_DIR)),
    'The pack must not be tracked in the repo'
  );
}

function assertAnbuStillWorks() {
  const anbuCount = migrate.migrateSingleSkill('anbu-skill', 'src/templates/skills');
  assert.ok(anbuCount > 0, `ANBU must still migrate without the pack (got ${anbuCount})`);
  const anbu = skillsModule.getSkill('anbu-skill', 'anbu');
  assert.ok(!anbu.includes('"error"'), 'ANBU skill must load without the pack');
}

async function assertOptInIndexesExactly817() {
  const version = require('../package.json').version;
  const archivePath = path.join(REPO_ROOT, 'dist', `akatsuki-cyber-pack-${version}.tar.zst`);
  const manifestPath = path.join(REPO_ROOT, 'dist', 'manifest.json');
  if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
    console.log(`  ⏭ opt-in half skipped: no local archive at ${archivePath}`);
    return false;
  }

  await cyberPack.install({ confirm: true, archivePath, manifestPath, conn });
  assert.strictEqual(cyberPack.getState(), 'opted-in', 'Install must record opt-in state');

  const count = migrate.migrateSingleSkill('akatsuki-skill', 'src/templates/skills');
  assert.ok(count >= 817, `Opted-in migration must index the pack (got ${count})`);
  assert.strictEqual(cyberRows('akatsuki-skill'), 817, 'Opt-in must index exactly 817 skills under akatsuki-skill');
  assert.strictEqual(cyberRows('anbu-skill'), 0, 'ANBU must never receive cyber rows');

  const findDpapi = JSON.parse(skillsModule.findSkill('dpapi', 5, 'akatsuki'));
  assert.ok(findDpapi.found > 0, 'Must find dpapi skills once opted in');
  const dpapiSkill = findDpapi.results.find((r) => r.name.includes('dpapi'));
  assert.ok(dpapiSkill, 'Results must contain a dpapi skill');
  assert.strictEqual(dpapiSkill.name, 'akatsuki-skill/abusing-dpapi-for-credential-access');

  const findMitre = JSON.parse(skillsModule.findSkill('T1555', 5, 'akatsuki'));
  assert.ok(findMitre.found > 0, 'Must find skills matching MITRE ATT&CK technique T1555');

  const fullSkillRes = skillsModule.getSkill('akatsuki-skill/abusing-dpapi-for-credential-access', 'akatsuki');
  assert.ok(!fullSkillRes.includes('"error"'), 'Full canonical lookup must succeed');
  assert.ok(fullSkillRes.includes('T1555.004'), 'Must contain MITRE ATT&CK mapping');

  // Red gate still holds for the opted-in content.
  const denied = skillsModule.getSkill('akatsuki-skill/abusing-dpapi-for-credential-access', '@kage');
  assert.ok(denied.includes('SKILL_AUTHORIZATION_DENIED'), 'Non-red identity must be denied');

  const removed = cyberPack.remove({ conn });
  assert.ok(removed.removedRows >= 817, `Remove must delete the indexed rows (got ${removed.removedRows})`);
  assert.strictEqual(cyberRows('akatsuki-skill'), 0, 'Remove must leave 0 cyber rows');
  assert.strictEqual(cyberPack.getState(conn), 'removed', 'Remove must record the removed state');
  return true;
}

function assertPathTraversalRejected() {
  assert.strictEqual(skillsModule.findInMirror('../../etc/passwd'), null, 'Must reject path traversal with ..');
  assert.strictEqual(skillsModule.findInMirror('/etc/shadow'), null, 'Must reject absolute path');
  assert.strictEqual(skillsModule.findInMirror('C:\\Windows\\cmd.exe'), null, 'Must reject Windows absolute drive path');
  const traversalSkillRes = skillsModule.getSkill('../../etc/passwd');
  assert.ok(traversalSkillRes.includes('"error"') || traversalSkillRes.includes('not found'), 'Must not resolve traversed file');
}

async function runTests() {
  console.log('Running test_anthropic_cybersecurity_skills.js...');

  assertDefaultInstallClean();
  assertAnbuStillWorks();
  const optedIn = await assertOptInIndexesExactly817();
  assertPathTraversalRejected();

  try {
    conn.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* best effort */ }

  console.log(`✓ Cyber pack boundary verified (opt-in half ${optedIn ? 'executed' : 'skipped: no local archive'}).`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
