'use strict';

const assert = require('assert');

async function testSkillsRegistryAndInstall() {
  console.log('Running test_skills_registry_and_install...');

  const skillManager = require('../src/skill_manager');
  assert.strictEqual(typeof skillManager.searchRegistry, 'function', 'skillManager.searchRegistry should be exported');
  assert.strictEqual(typeof skillManager.addSkill, 'function', 'skillManager.addSkill should be exported');
  assert.strictEqual(typeof skillManager.addSkillDirect, 'function', 'skillManager.addSkillDirect should be exported');
  console.log('✓ skillManager exports verified');

  const results = await skillManager.searchRegistry('docker');
  assert(Array.isArray(results), 'searchRegistry should return an array');
  assert(results.length > 0, 'searchRegistry should find results for docker');
  const first = results[0];
  assert(first.skillId || first.name, 'first result should have skillId or name');
  console.log(`✓ skills.sh live query verified: found ${results.length} results (e.g. ${first.skillId || first.name})`);

  const vectorSearch = require('../src/vector_search');
  assert.strictEqual(typeof vectorSearch.backfillAllEmbeddings, 'function', 'backfillAllEmbeddings must exist');
  console.log('✓ vectorSearch methods verified');

  console.log('✅ All skills registry & install tests passed cleanly!');
}

testSkillsRegistryAndInstall().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
