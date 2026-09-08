#!/usr/bin/env node
'use strict';

/**
 * tests/test_genin_skill_contract.js — Verifies Genin skill naming and migration contracts.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../src/db');
const migrate = require('../src/migrate');

const ROOT = path.resolve(__dirname, '..');

async function run() {
  console.log('Running test_genin_skill_contract tests...');

  // 1. Shipped skill metadata is canonical
  const copies = [
    path.join(ROOT, 'src', 'templates', 'skills', 'genin-skill'),
    path.join(ROOT, '.agents', 'skills', 'genin-skill'),
    path.join(ROOT, '.cursor', 'skills', 'genin-skill')
  ];
  for (const skillDir of copies) {
    const skillMd = path.join(skillDir, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd), `${skillMd} must exist`);
    const content = fs.readFileSync(skillMd, 'utf-8');
    assert.ok(content.includes('name: genin-skill'), `name: genin-skill must be in ${skillMd}`);

    const agentsDir = path.join(skillDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      const yamls = fs.readdirSync(agentsDir).filter(f => f.endsWith('.yaml'));
      for (const y of yamls) {
        const yContent = fs.readFileSync(path.join(agentsDir, y), 'utf-8');
        assert.ok(yContent.includes('name: genin-skill'), `name: genin-skill must be in ${y}`);
        assert.ok(!yContent.includes('name: deep-code-explorer'), `deep-code-explorer must not be in ${y}`);
      }
    }
  }

  const kageSkillMd1 = path.join(ROOT, '.agents', 'skills', 'kage-skill', 'SKILL.md');
  const kageSkillMd2 = path.join(ROOT, '.cursor', 'skills', 'kage-skill', 'SKILL.md');
  assert.ok(!fs.readFileSync(kageSkillMd1, 'utf-8').includes('deep-code-explorer'));
  assert.ok(!fs.readFileSync(kageSkillMd2, 'utf-8').includes('deep-code-explorer'));
  console.log('✓ Shipped skill metadata is canonical passed');

  // 2. Legacy rows canonicalize with canonical precedence
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genin_contract_'));
  const testDbPath = path.join(tmpDir, 'skills.db');

  try {
    const conn = db.getDb(testDbPath);
    migrate.setupDb(conn);

    conn.prepare('INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)').run(
      'genin-skill', 'genin-skill', 'skill', 'canonical'
    );
    conn.prepare('INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)').run(
      'deep-code-explorer', 'deep-code-explorer', 'skill', 'legacy'
    );
    conn.prepare('INSERT INTO skills (name, skill_name, type, content) VALUES (?, ?, ?, ?)').run(
      'deep-code-explorer/code-review', 'deep-code-explorer', 'reference', 'legacy ref'
    );

    const { migrated, removed } = migrate.normalizeLegacySkillNames(conn);
    assert.strictEqual(migrated, 1);
    assert.strictEqual(removed, 1);

    const names = new Set(conn.prepare('SELECT name FROM skills').all().map(r => r.name));
    assert.deepStrictEqual(names, new Set(['genin-skill', 'genin-skill/code-review']));
    conn.close();
    console.log('✓ Legacy rows canonicalize with canonical precedence passed');

    // 3. Clean migration requires genin-skill
    const skillsDir = path.join(tmpDir, 'skills');
    const geninDir = path.join(skillsDir, 'genin-skill');
    fs.mkdirSync(geninDir, { recursive: true });
    fs.writeFileSync(path.join(geninDir, 'SKILL.md'), '---\nname: genin-skill\ndescription: test\n---\n# Genin\n');

    const migrateDbPath = path.join(tmpDir, 'clean_migrate.db');
    execSync(
      `node "${path.join(ROOT, 'src', 'migrate.js')}" --clean --skills-dir "${skillsDir}" --skills genin-skill --db-path "${migrateDbPath}" --require-skill genin-skill --skip-embeddings`,
      { cwd: ROOT, stdio: 'pipe' }
    );

    const conn2 = db.getDb(migrateDbPath);
    const hasGenin = conn2.prepare("SELECT 1 FROM skills WHERE name = 'genin-skill'").get();
    assert.ok(hasGenin, 'genin-skill must exist in clean migration db');

    const legacyCount = conn2.prepare("SELECT COUNT(*) as count FROM skills WHERE name LIKE 'deep-code-explorer%'").get().count;
    assert.strictEqual(legacyCount, 0, 'No deep-code-explorer rows should exist');
    conn2.close();
    console.log('✓ Clean migration requires genin-skill passed');

    console.log('\nAll test_genin_skill_contract tests passed!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
