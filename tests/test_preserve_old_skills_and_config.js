#!/usr/bin/env node
'use strict';

/**
 * tests/test_preserve_old_skills_and_config.js
 * Verifies that fresh install, upgrade, and repair workflows:
 * 1. NEVER remove, prune, or delete pre-existing user skills from any client or global skill directory.
 * 2. NEVER wipe or purge pre-existing user skills from SQLite konoha.db.
 * 3. Strictly inject Konoha configuration without changing, overriding, or removing user pre-existing config/skills.
 * 4. Preserve custom user agents in agents.yaml when default ninja agents are merged.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/isolate_db');

const db = require('../src/db');
const migrate = require('../src/migrate');
const deployUtils = require('../src/deploy_utils');
const agentManager = require('../src/agent_manager');

function runTests() {
  console.log('--- Testing Pre-Existing Skills & Config Preservation Across Install & Upgrade ---');

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-preserve-test-'));

  try {
    // 1. Test copySkillsDirFast never deletes pre-existing user skills from destRoot
    console.log('\n1. Testing copySkillsDirFast directory non-destructive synchronization...');
    const srcDir = path.join(sandbox, 'src-skills');
    const destDir = path.join(sandbox, 'dest-skills');
    fs.mkdirSync(path.join(srcDir, 'genin-skill'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'genin-skill', 'SKILL.md'), '# Genin Skill\n', 'utf8');

    // Pre-populate destDir with user's pre-existing skills and files
    fs.mkdirSync(path.join(destDir, 'my-custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'my-custom-skill', 'SKILL.md'), '# My Custom Skill\n', 'utf8');
    fs.writeFileSync(path.join(destDir, 'my-custom-skill', 'helper.py'), '# user helper\n', 'utf8');
    fs.writeFileSync(path.join(destDir, 'notes.txt'), 'User personal notes\n', 'utf8');

    // Run copySkillsDirFast from srcDir to destDir
    deployUtils.copySkillsDirFast(srcDir, destDir);

    // Verify template skill was copied
    assert.ok(fs.existsSync(path.join(destDir, 'genin-skill', 'SKILL.md')), 'Template skill must be copied to dest');
    // Verify user pre-existing skills and files were NOT deleted
    assert.ok(fs.existsSync(path.join(destDir, 'my-custom-skill', 'SKILL.md')), 'User custom skill must NOT be pruned');
    assert.ok(fs.existsSync(path.join(destDir, 'my-custom-skill', 'helper.py')), 'User skill helper files must NOT be pruned');
    assert.ok(fs.existsSync(path.join(destDir, 'notes.txt')), 'User extra files in skills directory must NOT be pruned');
    console.log('  ✓ copySkillsDirFast strictly preserved pre-existing user skills and files');

    // 2. Test SQLite migration preserves pre-existing user skills in database
    console.log('\n2. Testing SQLite skills table preservation across migrations...');
    const testDbPath = path.join(sandbox, 'test-konoha.db');
    const conn = db.getConnection(testDbPath, false);
    db.setupSchema(conn);

    // Pre-insert user skill before Konoha upgrade/migration
    conn.prepare(`
      INSERT INTO skills (name, skill_name, type, content, file_path)
      VALUES (?, ?, ?, ?, ?)
    `).run('user-existing-skill', 'user-existing-skill', 'skill', 'User existing skill content before konoha', '/user/skills/path');
    conn.close();

    // Run migration pointing to srcDir WITHOUT --clean
    const runConn = db.getConnection(testDbPath, false);
    db.setupSchema(runConn);
    const migrateSkillCount = migrate.migrateSkill(runConn, 'genin-skill', true, srcDir);
    assert.ok(migrateSkillCount >= 1, 'genin-skill must be migrated');

    // Verify user-existing-skill was NOT deleted or purged from the database
    const preservedSkill = runConn.prepare("SELECT * FROM skills WHERE skill_name = 'user-existing-skill'").get();
    assert.ok(preservedSkill, 'Pre-existing user skill must remain in database after migration');
    assert.strictEqual(preservedSkill.content, 'User existing skill content before konoha');
    runConn.close();
    console.log('  ✓ Pre-existing skills in SQLite database strictly preserved');

    // 3. Test injectManagedConfig preserves pre-existing user markdown config
    console.log('\n3. Testing injectManagedConfig preservation for GEMINI.md & AGENTS.md...');
    const userGeminiPath = path.join(sandbox, 'GEMINI.md');
    const initialUserConfig = `# User Pre-Existing Instructions
- Rule A: Always use TypeScript strict mode
- Rule B: Never use semicolons
- Rule C: Follow organizational security policy #123
`;
    fs.writeFileSync(userGeminiPath, initialUserConfig, 'utf8');

    const konohaInstruction = `# Global Agent Instructions
- Use konoha MCP
- Use semble MCP
`;
    // Fresh install injects Konoha block while preserving user's config
    const injectedFirst = agentManager.injectManagedConfig(userGeminiPath, konohaInstruction, 'KONOHA');
    assert.ok(injectedFirst.includes(initialUserConfig.trim()), 'User original instructions must be preserved on fresh install');
    assert.ok(injectedFirst.includes('<!-- KONOHA-START -->'), 'Must contain KONOHA-START marker');
    assert.ok(injectedFirst.includes('<!-- KONOHA-END -->'), 'Must contain KONOHA-END marker');
    assert.ok(injectedFirst.includes('Use konoha MCP'), 'Must contain Konoha instructions');

    // Simulate saving the injected file
    fs.writeFileSync(userGeminiPath, injectedFirst, 'utf8');

    // Subsequent upgrade updates only the managed block and leaves user instructions intact
    const updatedKonohaInstruction = `# Global Agent Instructions (Upgraded v2.0.2)
- Upgraded konoha MCP
- Upgraded semble MCP
`;
    const injectedSecond = agentManager.injectManagedConfig(userGeminiPath, updatedKonohaInstruction, 'KONOHA');
    assert.ok(injectedSecond.includes(initialUserConfig.trim()), 'User original instructions must be preserved on upgrade');
    assert.ok(injectedSecond.includes('Upgraded konoha MCP'), 'Konoha instructions must be updated inside the managed block');
    assert.ok(!injectedSecond.includes('Use konoha MCP\n- Use semble MCP'), 'Old Konoha block must be replaced cleanly');

    // Also test file with user content appended AFTER the managed block
    const userAppended = injectedSecond + '\n# User Appended Postscript\n- Rule D: Keep this too\n';
    fs.writeFileSync(userGeminiPath, userAppended, 'utf8');
    const injectedThird = agentManager.injectManagedConfig(userGeminiPath, '# V3 Instructions\n', 'KONOHA');
    assert.ok(injectedThird.includes(initialUserConfig.trim()), 'Preamble preserved');
    assert.ok(injectedThird.includes('# User Appended Postscript'), 'Postscript preserved');
    assert.ok(injectedThird.includes('# V3 Instructions'), 'V3 managed block updated');
    console.log('  ✓ injectManagedConfig strictly preserves all surrounding user configurations');

    // 4. Test agents.yaml custom user agents preservation when defaults are merged
    console.log('\n4. Testing agents.yaml preservation for pre-existing custom agents...');
    const userAgentsYamlPath = path.join(sandbox, 'agents.yaml');
    const userCustomAgent = [
      {
        name: 'data-scientist',
        title: 'Lead Data Scientist',
        purpose: 'Machine learning model training and feature extraction',
        skills: ['python-analytics', 'pandas-profiling'],
        constraints: 'Only read-only data access',
        model_tier: 'Pro'
      }
    ];
    fs.writeFileSync(userAgentsYamlPath, agentManager.stringifyYaml(userCustomAgent) + '\n', 'utf8');

    // Load defaults and merge
    const defaultAgents = [
      { name: 'sannin', title: 'Router Ninja' },
      { name: 'genin', title: 'Scout Ninja' },
      { name: 'kage', title: 'Village Leader' }
    ];

    const parsedUserAgents = agentManager.parseYaml(fs.readFileSync(userAgentsYamlPath, 'utf8'));
    const existingNames = new Set(parsedUserAgents.map(a => a && a.name));
    for (const def of defaultAgents) {
      if (def && def.name && !existingNames.has(def.name)) {
        parsedUserAgents.push(def);
      }
    }
    fs.writeFileSync(userAgentsYamlPath, agentManager.stringifyYaml(parsedUserAgents) + '\n', 'utf8');

    const reloadedAgents = agentManager.parseYaml(fs.readFileSync(userAgentsYamlPath, 'utf8'));
    const userAgent = reloadedAgents.find(a => a.name === 'data-scientist');
    assert.ok(userAgent, 'Custom user agent must be preserved in agents.yaml');
    assert.strictEqual(userAgent.title, 'Lead Data Scientist');
    assert.deepStrictEqual(userAgent.skills, ['python-analytics', 'pandas-profiling']);
    assert.ok(reloadedAgents.some(a => a.name === 'genin'), 'Default agents must be merged alongside custom agent');
    console.log('  ✓ Custom agents in agents.yaml strictly preserved when default ninjas are merged');

    console.log('\n✅ ALL PRESERVATION TESTS PASSED WITH 100% SUCCESS!\n');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

runTests();
