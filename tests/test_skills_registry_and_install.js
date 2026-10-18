'use strict';

const assert = require('assert');

async function testSkillsRegistryAndInstall() {
  console.log('Running test_skills_registry_and_install...');

  const skillManager = require('../src/skill_manager');
  assert.strictEqual(typeof skillManager.searchRegistry, 'function', 'skillManager.searchRegistry should be exported');
  assert.strictEqual(typeof skillManager.addSkill, 'function', 'skillManager.addSkill should be exported');
  assert.strictEqual(typeof skillManager.addSkillDirect, 'function', 'skillManager.addSkillDirect should be exported');
  assert.strictEqual(typeof skillManager.validateInputs, 'function', 'skillManager.validateInputs should be exported');
  console.log('✓ skillManager exports verified');

  // Verify URL scheme validation: file:// allowed, ftp:// and path traversal rejected
  assert.doesNotThrow(() => {
    skillManager.validateInputs('file:///tmp/local-skill-repo', 'my-local-skill');
  }, 'file:// repository URLs must be accepted for local/air-gapped environments');

  assert.doesNotThrow(() => {
    skillManager.validateInputs('https://github.com/example/skill', 'valid-skill-name');
  }, 'https:// repository URLs must be accepted');

  assert.doesNotThrow(() => {
    skillManager.validateInputs('git@github.com:example/skill.git', 'git-ssh-skill');
  }, 'git@ repository URLs must be accepted');

  assert.throws(() => {
    skillManager.validateInputs('ftp://example.com/skill', 'ftp-skill');
  }, /Invalid repository URL/, 'ftp:// URLs must be rejected');

  assert.throws(() => {
    skillManager.validateInputs('file:///tmp/repo', '../traversal-skill');
  }, /Invalid skill name/, 'Path traversal in skill name must be rejected');

  assert.throws(() => {
    skillManager.validateInputs('file:///tmp/repo', 'nested/slash/skill');
  }, /Invalid skill name/, 'Slashes in skill name must be rejected');

  console.log('✓ file:// acceptance, ftp:// rejection, and path-traversal guardrails verified');

  try {
    const results = await skillManager.searchRegistry('docker');
    assert(Array.isArray(results), 'searchRegistry should return an array');
    if (results.length > 0) {
      const first = results[0];
      assert(first.skillId || first.name, 'first result should have skillId or name');
      console.log(`✓ skills.sh live query verified: found ${results.length} results (e.g. ${first.skillId || first.name})`);
    }
  } catch (err) {
    if (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || (err.message && err.message.includes('skills.sh'))) {
      console.log(`⚠ skills.sh network query skipped due to network unreachable/timeout (${err.message})`);
    } else {
      throw err;
    }
  }

  const vectorSearch = require('../src/vector_search');
  assert.strictEqual(typeof vectorSearch.backfillAllEmbeddings, 'function', 'backfillAllEmbeddings must exist');
  console.log('✓ vectorSearch methods verified');

  console.log('✅ All skills registry & install tests passed cleanly!');
}

testSkillsRegistryAndInstall().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
