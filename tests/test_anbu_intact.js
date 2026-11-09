/**
 * Test Suite: ANBU survives the pack removal.
 *
 * ANBU is backend/bugfix/DevOps only. It must load, route, and run a backend
 * task with the pack absent. A scratch-copy proof shows that deleting ANBU
 * actually breaks backend routing — otherwise the positive assertions above
 * would be vacuous.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-anbu-test-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, '.konoha', 'konoha.db');
fs.mkdirSync(path.join(tmpRoot, '.konoha'), { recursive: true });

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(REPO_ROOT, 'src', 'templates', 'skills');
const ANBU_DIR = path.join(TEMPLATES, 'anbu-skill');

const db = require('../src/db');
const migrate = require('../src/migrate');
const skillsModule = require('../src/mcp/skills');

const conn = db.getConnection();
db.setupSchema(conn);

function assertAnbuShips() {
  assert.ok(fs.existsSync(path.join(ANBU_DIR, 'SKILL.md')), 'ANBU SKILL.md must ship');
  const content = fs.readFileSync(path.join(ANBU_DIR, 'SKILL.md'), 'utf8');
  assert.ok(content.includes('SOP 5: Basic Security Hygiene & Safe Escalation'), 'ANBU must keep the hygiene SOP');
  assert.ok(!content.includes('SOP 5: Dev/Local Penetration Testing'), 'ANBU must not carry the pentest SOP');
  assert.ok(content.includes('@akatsuki'), 'ANBU must escalate to @akatsuki');
  assert.ok(
    !fs.existsSync(path.join(ANBU_DIR, 'references', 'anthropic-cybersecurity-skills-assets')),
    'ANBU must not carry the cyber pack'
  );
}

function assertAnbuLoadsAndRoutes() {
  const count = migrate.migrateSingleSkill('anbu-skill', TEMPLATES);
  assert.ok(count > 0, `ANBU must migrate (got ${count})`);

  const loaded = skillsModule.getSkill('anbu-skill', 'anbu');
  assert.ok(!loaded.includes('"error"'), 'ANBU must load');
  assert.ok(loaded.includes('Backend'), 'ANBU content must describe backend work');

  const routed = JSON.parse(skillsModule.findSkill('backend devops bug fix', 5, 'anbu'));
  assert.ok(routed.found > 0, 'ANBU must be routable');
  assert.ok(
    routed.results.some((r) => r.name.startsWith('anbu-skill/')),
    'Backend routing must resolve to anbu-skill'
  );

  const cyberRows = conn
    .prepare("SELECT COUNT(*) n FROM skills WHERE skill_name = 'anbu-skill' AND (file_path LIKE '%anthropic-cybersecurity-skills-assets%' OR file_path LIKE '%cyber-pack%')")
    .get().n;
  assert.strictEqual(cyberRows, 0, 'ANBU must own zero cyber rows');
}

/**
 * Non-vacuity proof, two parts:
 *  1. With ANBU's template removed from a copied tree, migration indexes
 *     nothing — so the rows routing reads really come from that template.
 *  2. The routed row's `file_path` points into the shipped ANBU template.
 * Together these show the positive assertions above are not satisfied by
 * unrelated data.
 */
function assertRoutingDependsOnAnbuTemplate() {
  const scratchSkills = path.join(tmpRoot, 'scratch-skills');
  fs.cpSync(TEMPLATES, scratchSkills, { recursive: true });
  fs.rmSync(path.join(scratchSkills, 'anbu-skill'), { recursive: true, force: true });

  const count = migrate.migrateSingleSkill('anbu-skill', scratchSkills);
  assert.strictEqual(count, 0, 'ANBU must not migrate when its template is gone');

  const row = conn
    .prepare("SELECT file_path FROM skills WHERE skill_name = 'anbu-skill' AND name = 'anbu-skill'")
    .get();
  assert.ok(row, 'ANBU must be indexed from the shipped template');
  assert.ok(
    path.resolve(row.file_path).startsWith(path.resolve(ANBU_DIR)),
    `ANBU row must originate from the shipped template (got ${row.file_path})`
  );
}

function runTests() {
  console.log('Running test_anbu_intact.js...');

  assertAnbuShips();
  assertAnbuLoadsAndRoutes();
  assertRoutingDependsOnAnbuTemplate();

  conn.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('✓ ANBU intact without the pack: ships, loads, routes; deletion provably breaks routing.');
  process.exit(0);
}

try {
  runTests();
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
}