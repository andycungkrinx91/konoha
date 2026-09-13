#!/usr/bin/env node
'use strict';

/**
 * tests/test_i_have_adhd_skill.js — Verifies the i-have-adhd skill contract:
 * mapped to exactly genin, jonin, anbu, tokubetsu-jonin, chunin (never sannin/kage),
 * shipped byte-identical across all four skill trees, with the full 10-rule body.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TREES = [
  path.join(ROOT, 'src', 'templates', 'skills'),
  path.join(ROOT, '.agents', 'skills'),
  path.join(ROOT, '.cursor', 'skills'),
  path.join(ROOT, '.gemini', 'skills')
];
const SKILL_REL = path.join('i-have-adhd', 'SKILL.md');

const AGENT_SKILLS = {
  genin: path.join(ROOT, 'src', 'templates', 'skills', 'genin-skill', 'SKILL.md'),
  jonin: path.join(ROOT, 'src', 'templates', 'skills', 'jonin-skill', 'SKILL.md'),
  anbu: path.join(ROOT, 'src', 'templates', 'skills', 'anbu-skill', 'SKILL.md'),
  chunin: path.join(ROOT, 'src', 'templates', 'skills', 'chunin-skill', 'SKILL.md'),
  'tokubetsu-jonin': path.join(ROOT, 'src', 'templates', 'skills', 'tokubetsu-jonin-skill', 'SKILL.md'),
  sannin: path.join(ROOT, 'src', 'templates', 'skills', 'sannin-skill', 'SKILL.md'),
  kage: path.join(ROOT, 'src', 'templates', 'skills', 'kage-skill', 'SKILL.md')
};

const REQUIRED_RULE_STRINGS = [
  'Lead with the next action',
  'Number multi-step tasks',
  'one concrete next action',
  'Suppress tangents',
  'Restate state every turn',
  'specific time estimates',
  'Make completed work visible',
  'Matter-of-fact tone for errors',
  'Cap lists to 5 items',
  'No preamble, no recap, no closing pleasantries'
];

function parseAgentBlocks(yamlPath) {
  const content = fs.readFileSync(yamlPath, 'utf-8');
  const blocks = {};
  let current = null;
  for (const line of content.split('\n')) {
    const nameMatch = /^- name: (\S+)\s*$/.exec(line);
    if (nameMatch) {
      current = nameMatch[1];
      blocks[current] = [];
      continue;
    }
    if (current && /^\s+- i-have-adhd\s*$/.test(line)) {
      blocks[current].push('i-have-adhd');
    }
  }
  return blocks;
}

async function run() {
  console.log('Running test_i_have_adhd_skill tests...');

  // 1. SKILL.md exists in all four trees and copies are byte-identical
  const reference = fs.readFileSync(path.join(TREES[0], SKILL_REL));
  for (const tree of TREES) {
    const p = path.join(tree, SKILL_REL);
    assert.ok(fs.existsSync(p), `${path.relative(ROOT, p)} must exist`);
    const buf = fs.readFileSync(p);
    assert.ok(reference.equals(buf), `${path.relative(ROOT, p)} must be byte-identical to the template copy`);
  }
  console.log('✓ i-have-adhd SKILL.md shipped byte-identical in all 4 trees');

  const skillContent = reference.toString('utf-8');

  // 2. Frontmatter and attribution
  assert.ok(skillContent.includes('name: i-have-adhd'), 'frontmatter must contain name: i-have-adhd');
  assert.ok(skillContent.includes('ayghri'), 'attribution to upstream author ayghri must be present');
  assert.ok(skillContent.includes('github.com/ayghri/i-have-adhd'), 'upstream source URL must be present');
  console.log('✓ Frontmatter and upstream attribution passed');

  // 3. All 10 rules present
  const missingRules = REQUIRED_RULE_STRINGS.filter(r => !skillContent.includes(r));
  assert.deepStrictEqual(missingRules, [], `missing rule strings: ${missingRules.join(', ')}`);
  console.log('✓ All 10 ADHD output rules present');

  // 4. agents.yaml maps i-have-adhd to exactly the 5 target agents
  const blocks = parseAgentBlocks(path.join(ROOT, 'src', 'templates', 'agents.yaml'));
  const expectedAgents = ['genin', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const agent of expectedAgents) {
    assert.ok(blocks[agent] && blocks[agent].includes('i-have-adhd'), `agents.yaml: ${agent} must list i-have-adhd`);
  }
  for (const forbidden of ['sannin', 'kage']) {
    assert.ok(!blocks[forbidden] || !blocks[forbidden].includes('i-have-adhd'),
      `agents.yaml: ${forbidden} must NOT list i-have-adhd`);
  }
  assert.strictEqual(
    Object.values(blocks).filter(list => list.includes('i-have-adhd')).length,
    expectedAgents.length,
    `agents.yaml: i-have-adhd must map to exactly ${expectedAgents.length} agents`
  );
  console.log('✓ agents.yaml maps i-have-adhd to exactly genin, jonin, anbu, tokubetsu-jonin, chunin');

  // 5. AGENTS.md and GEMINI.md templates reference the skill for the 5 agents, never kage
  for (const tpl of ['AGENTS.md', 'GEMINI.md']) {
    const content = fs.readFileSync(path.join(ROOT, 'src', 'templates', tpl), 'utf-8');
    assert.ok(content.includes('i-have-adhd'), `${tpl} must reference i-have-adhd`);

    const lines = content.split('\n');
    const kageTableRows = lines.filter(l => /\|\s*`?kage`?\s*\|/.test(l) && l.includes('|'));
    for (const row of kageTableRows) {
      assert.ok(!row.includes('i-have-adhd'), `${tpl}: kage routing row must not include i-have-adhd`);
    }
    const sanninRows = lines.filter(l => /sannin/i.test(l));
    for (const row of sanninRows) {
      assert.ok(!row.includes('i-have-adhd'), `${tpl}: sannin must not be attributed i-have-adhd`);
    }
  }
  console.log('✓ AGENTS.md and GEMINI.md reference i-have-adhd without kage/sannin attribution');

  // 6. The 5 agent skills route to i-have-adhd; sannin-skill and kage-skill do not
  for (const agent of expectedAgents) {
    const content = fs.readFileSync(AGENT_SKILLS[agent], 'utf-8');
    assert.ok(content.includes('`i-have-adhd`'), `${agent}-skill SKILL.md must reference i-have-adhd`);
  }
  for (const forbidden of ['sannin', 'kage']) {
    const content = fs.readFileSync(AGENT_SKILLS[forbidden], 'utf-8');
    assert.ok(!content.includes('i-have-adhd'), `${forbidden}-skill SKILL.md must NOT reference i-have-adhd`);
  }
  console.log('✓ Router references present in the 5 agent skills, absent from sannin-skill and kage-skill');

  // 7. Mirror copies of the 5 modified agent skills stay byte-identical
  for (const agent of expectedAgents) {
    const rel = path.join(`${agent}-skill`, 'SKILL.md');
    const srcBuf = fs.readFileSync(path.join(TREES[0], rel));
    for (const tree of TREES.slice(1)) {
      const buf = fs.readFileSync(path.join(tree, rel));
      assert.ok(srcBuf.equals(buf), `${tree}/${rel} must be byte-identical to the template copy`);
    }
  }
  console.log('✓ Modified agent skill copies are byte-identical across trees');

  console.log('\nAll test_i_have_adhd_skill tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
