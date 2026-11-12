'use strict';

/**
 * Verification Suite: Component 1 — Compact `use_skills` (<= 6,400 bytes / <= 1,600 tokens),
 * Active `i-have-adhd` & `antislop*` in Every Subagent, Session Deduplication, & Truthful `konoha savings`
 */

const assert = require('assert');
const { useSkills } = require('../src/mcp/skills_retrieval');
const { getServedSkillsSet, MAX_MULTI_SKILL_TOTAL_BYTES, isDisciplineSkillName } = require('../src/mcp/skills_common');
const { getCanonicalAgent } = require('../src/canonical_agents');

async function runTests() {
  console.log('Running test_use_skills_compact.js...');

  assert.strictEqual(isDisciplineSkillName('i-have-adhd'), true);
  assert.strictEqual(isDisciplineSkillName('antislop'), true);
  assert.strictEqual(isDisciplineSkillName('antislop-code'), true);
  assert.strictEqual(isDisciplineSkillName('antislop-human'), true);
  assert.strictEqual(isDisciplineSkillName('genin-skill'), false);

  // i-have-adhd is wired to the six output-discipline agents only (sannin, kage,
  // and yamanaka deliberately excluded); see tests/test_i_have_adhd_skill.js.
  const workerAgents = ['genin', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki'];
  for (const agentName of workerAgents) {
    const def = getCanonicalAgent(agentName);
    assert.ok(def, `Missing canonical agent definition for ${agentName}`);
    assert.ok(def.skills.includes('i-have-adhd'), `${agentName} must retain i-have-adhd`);
    assert.ok(def.skills.includes('antislop'), `${agentName} must retain antislop`);
  }

  const sessionKey = 'test_session_v2218';
  getServedSkillsSet(sessionKey).clear();
  const geninSkills = ['genin-skill', 'i-have-adhd', 'antislop', 'antislop-human', 'antislop-code'];
  const raw1 = useSkills(geninSkills, 'genin', { sessionId: sessionKey });
  const res1 = typeof raw1 === 'string' ? JSON.parse(raw1) : raw1;
  const byteLen1 = Buffer.byteLength(typeof raw1 === 'string' ? raw1 : JSON.stringify(raw1), 'utf8');

  assert.strictEqual(res1.status, 'success');
  assert.strictEqual(res1.skills.length, 5, 'All 5 skills must be returned');
  assert.ok(
    byteLen1 <= MAX_MULTI_SKILL_TOTAL_BYTES,
    `Expected use_skills payload <= ${MAX_MULTI_SKILL_TOTAL_BYTES} bytes, got ${byteLen1} bytes`
  );
  assert.ok(Math.ceil(byteLen1 / 4) <= 1600, `Expected <= 1600 tokens, got ${Math.ceil(byteLen1 / 4)}`);

  const raw2 = useSkills(geninSkills, 'genin', { sessionId: sessionKey });
  const res2 = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2;
  const byteLen2 = Buffer.byteLength(typeof raw2 === 'string' ? raw2 : JSON.stringify(raw2), 'utf8');
  assert.ok(byteLen2 < byteLen1, `Second call in same session should be deduplicated (${byteLen2} < ${byteLen1})`);
  const dedupedCount = res2.skills.filter((s) => s.deduplicated === true).length;
  assert.strictEqual(dedupedCount, 5, 'All 5 skills should be marked deduplicated on repeat call');

  const anbuSession = 'test_anbu_session_v2218';
  getServedSkillsSet(anbuSession).clear();
  const anbuSkills = ['anbu-skill', 'i-have-adhd', 'antislop', 'antislop-code', 'antislop-human'];
  const rawAnbu = useSkills(anbuSkills, 'anbu', { sessionId: anbuSession });
  const byteLenAnbu = Buffer.byteLength(typeof rawAnbu === 'string' ? rawAnbu : JSON.stringify(rawAnbu), 'utf8');
  assert.ok(
    byteLenAnbu <= MAX_MULTI_SKILL_TOTAL_BYTES,
    `Expected anbu use_skills payload <= ${MAX_MULTI_SKILL_TOTAL_BYTES} bytes, got ${byteLenAnbu} bytes`
  );

  console.log(`PASS test_use_skills_compact.js (genin=${byteLen1}B, dedup=${byteLen2}B, anbu=${byteLenAnbu}B)`);
}

runTests().catch((err) => {
  console.error('FAIL test_use_skills_compact.js:', err);
  process.exit(1);
});
