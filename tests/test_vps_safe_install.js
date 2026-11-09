/**
 * Test Suite: VPS-safe default install and cyber-pack opt-in boundary.
 *
 * Verifies a fresh install in an empty HOME contains no pack files, indexes
 * zero cyber rows, keeps ANBU working and routable, and that unauthenticated
 * red-team reads still fail closed. Opt-in lifecycle lives in
 * tests/test_cyber_pack_opt_in.js.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-vps-test-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, '.konoha', 'konoha.db');
process.env.KONOHA_AKATSUKI_LAB_DB = path.join(tmpRoot, '.konoha', 'akatsuki-lab', 'lab.db');
fs.mkdirSync(path.join(tmpRoot, '.konoha'), { recursive: true });

const PACK_ASSET_DIR = 'anthropic-cybersecurity-skills-assets';
const REPO_ROOT = path.resolve(__dirname, '..');
const PACK_ROW_WHERE = 'file_path LIKE ? OR file_path LIKE ?';
const PACK_ROW_ARGS = [`%${PACK_ASSET_DIR}%`, '%cyber-pack%skills%'];

const db = require('../src/db');
const cyberPack = require('../src/cyber_pack');
const migrate = require('../src/migrate');
const skillsModule = require('../src/mcp/skills');

const conn = db.getConnection();
db.setupSchema(conn);

function cyberRowCount(skillName = null) {
  const filter = skillName ? 'AND skill_name = ?' : '';
  const args = skillName ? [...PACK_ROW_ARGS, skillName] : PACK_ROW_ARGS;
  return conn
    .prepare(`SELECT COUNT(*) n FROM skills WHERE (${PACK_ROW_WHERE}) ${filter}`)
    .get(...args).n;
}

function packFilesOnDisk() {
  const roots = [
    path.join(tmpRoot, '.konoha'),
    path.join(tmpRoot, '.omp'),
    path.join(tmpRoot, '.agents'),
    path.join(REPO_ROOT, 'src', 'templates', 'skills', 'akatsuki-skill', 'references')
  ];
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.includes(PACK_ASSET_DIR) || entry.name === 'cyber-pack') hits.push(full);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
    }
  };
  for (const root of roots) walk(root);
  return hits;
}

function assertDefaultInstallClean() {
  assert.deepStrictEqual(packFilesOnDisk(), [], 'Fresh install must contain zero pack paths on disk');
  assert.strictEqual(cyberRowCount(), 0, 'Fresh install must index zero cyber rows');
  assert.strictEqual(cyberPack.getState(conn), 'absent', 'Fresh install must be absent, not opted in');
}

function assertAnbuIntact() {
  const anbuDir = path.join(REPO_ROOT, 'src', 'templates', 'skills', 'anbu-skill');
  assert.ok(fs.existsSync(path.join(anbuDir, 'SKILL.md')), 'ANBU SKILL.md must ship');

  const count = migrate.migrateSingleSkill('anbu-skill', 'src/templates/skills');
  assert.ok(count > 0, `ANBU must migrate without the pack (got ${count})`);

  const loaded = skillsModule.getSkill('anbu-skill', 'anbu');
  assert.ok(!loaded.includes('"error"'), 'ANBU must load without the pack');
  assert.ok(loaded.includes('SOP 5: Basic Security Hygiene'), 'ANBU must keep its hygiene SOP');

  const routed = skillsModule.findSkill('backend devops bug fix', 5, 'anbu');
  const parsed = JSON.parse(routed);
  assert.ok(parsed.found > 0, 'ANBU must be routable for backend work');
  assert.ok(
    parsed.results.some((r) => r.name.startsWith('anbu-skill/')),
    'Backend routing must resolve to anbu-skill'
  );
  assert.strictEqual(cyberRowCount('anbu-skill'), 0, 'ANBU must never own cyber rows');
}

function assertRedGateFailsClosed() {
  const denied = skillsModule.getSkill('akatsuki-skill/abusing-dpapi-for-credential-access', '@kage');
  assert.ok(denied.includes('SKILL_AUTHORIZATION_DENIED'), 'Non-red identity must be denied');
  const absent = skillsModule.getSkill('akatsuki-skill/abusing-dpapi-for-credential-access', '@akatsuki');
  assert.ok(absent.includes('"error"') || absent.includes('not found'), 'Denied path must not leak content');
}

async function runTests() {
  console.log('Running test_vps_safe_install.js...');

  assertDefaultInstallClean();
  assertAnbuIntact();
  assertRedGateFailsClosed();

  conn.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('✓ VPS-safe default install verified: 0 pack paths, 0 cyber rows, ANBU intact, red gate closed.');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});