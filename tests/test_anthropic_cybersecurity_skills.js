/**
 * Test Suite: Anthropic Cybersecurity Skills & Red-Team Knowledge Graph Integration
 * Verifies that all 817 structured skills and MITRE ATT&CK mappings in
 * anthropic-cybersecurity-skills-assets can be discovered, searched, and loaded
 * properly by Anbu and Konoha subagents.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate test database
const tmpDir = path.join(os.tmpdir(), `konoha-cyber-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, 'test.db');
process.env.KONOHA_DB_PATH = testDbPath;

const db = require('../src/db');
const conn = db.getConnection();
db.setupSchema(conn);

const migrate = require('../src/migrate');
const skillsModule = require('../src/mcp/skills');

async function runTests() {
  console.log('Running test_anthropic_cybersecurity_skills.js...');

  // 1. Run migration for anbu-skill
  const count = migrate.migrateSingleSkill('anbu-skill', 'src/templates/skills');
  assert.ok(count >= 850, `Must migrate anbu-skill and its cyber assets (got ${count})`);

  // 2. Verify total cyber skill rows in database
  const cyberRows = conn.prepare(`
    SELECT COUNT(*) as cnt
    FROM skills
    WHERE skill_name = 'anbu-skill' AND file_path LIKE '%anthropic-cybersecurity-skills-assets%'
  `).get();
  assert.strictEqual(cyberRows.cnt, 817, 'Database must contain exactly 817 anthropic cybersecurity skills');

  // 3. Test find_skill by technique name (DPAPI)
  const findDpapi = JSON.parse(skillsModule.findSkill('dpapi', 5));
  assert.ok(findDpapi.found > 0, 'Must find dpapi skills');
  const dpapiSkill = findDpapi.results.find(r => r.name.includes('dpapi'));
  assert.ok(dpapiSkill, 'Results must contain a dpapi skill');
  assert.strictEqual(dpapiSkill.name, 'anbu-skill/abusing-dpapi-for-credential-access', 'Must match exact dpapi skill ID');

  // 4. Test find_skill by MITRE ATT&CK ID (T1555)
  const findMitre = JSON.parse(skillsModule.findSkill('T1555', 5));
  assert.ok(findMitre.found > 0, 'Must find skills matching MITRE ATT&CK technique T1555');

  // 5. Test find_skill by domain / red team topic
  const findAD = JSON.parse(skillsModule.findSkill('active directory', 5));
  assert.ok(findAD.found > 0, 'Must find Active Directory attack/defense skills');

  const findPrivesc = JSON.parse(skillsModule.findSkill('privilege escalation', 5));
  assert.ok(findPrivesc.found > 0, 'Must find privilege escalation skills');

  // 6. Test get_skill with full canonical name
  const fullSkillRes = skillsModule.getSkill('anbu-skill/abusing-dpapi-for-credential-access');
  assert.ok(!fullSkillRes.includes('"error"'), 'Full canonical lookup must succeed');
  assert.ok(fullSkillRes.includes('Abusing DPAPI for Credential Access'), 'Must contain skill title');
  assert.ok(fullSkillRes.includes('T1555.004'), 'Must contain MITRE ATT&CK mapping');
  assert.ok(fullSkillRes.includes('SharpDPAPI'), 'Must contain tool procedures');

  // 7. Test get_skill with short unprefixed name
  const shortSkillRes = skillsModule.getSkill('abusing-dpapi-for-credential-access');
  assert.ok(!shortSkillRes.includes('"error"'), 'Short unprefixed lookup must succeed');
  assert.ok(shortSkillRes.includes('Abusing DPAPI for Credential Access'), 'Short lookup must return exact skill content');

  // 8. Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('✓ All Anthropic Cybersecurity Skills & Red-Team tests passed cleanly.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
