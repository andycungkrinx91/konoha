#!/usr/bin/env node
'use strict';

/*
 * Soul and skill provenance proof.
 * Verifies SQLite-first resolution for ninja souls and skill payloads,
 * plus the additive-only roster merge that keeps Akatsuki wired to i-have-adhd.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const { getCanonicalAgentNames } = require('../src/canonical_agents');
const NINJAS = getCanonicalAgentNames();

function freshDbPath(tag) {
  return path.join(os.tmpdir(), `konoha-prov-${tag}-${Date.now()}-${process.pid}.db`);
}

function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(p + suffix); } catch (_) { /* ignore */ }
  }
}

async function run() {
  console.log('Running test_soul_skill_provenance tests...');

  // Fresh-process souls without any prior setup call.
  const soulDb = freshDbPath('soul');
  process.env.KONOHA_DB_PATH = soulDb;
  try { delete require.cache[require.resolve('../src/db')]; } catch (_) { /* ignore */ }
  try { delete require.cache[require.resolve('../src/persona_memory_soul')]; } catch (_) { /* ignore */ }
  const { getSoul } = require('../src/persona_memory_soul');
  for (const agent of NINJAS) {
    const soul = getSoul({ agentName: agent });
    const src = soul.source || (soul.archetype && soul.archetype.source) || 'NONE';
    assert.strictEqual(src, 'sqlite', `${agent} soul must resolve from SQLite (got ${src})`);
    assert.ok(
      (soul.archetype && soul.archetype.adhd_shaping && soul.archetype.adhd_shaping.length > 0),
      `${agent} soul must carry DB-resolved ADHD shaping`
    );
  }
  console.log(`✓ All ${NINJAS.length} ninja souls resolve from SQLite on a fresh DB with ADHD shaping`);

  // Akatsuki directive stays security-flavored.
  const akatsukiSoul = getSoul({ agentName: 'akatsuki' });
  assert.ok(
    /PASS\/FAIL\/BLOCKED|security verdict/i.test(akatsukiSoul.archetype.adhd_shaping),
    'akatsuki soul must carry the security-verdict ADHD directive from SQLite'
  );
  console.log('✓ Akatsuki soul carries the security-verdict ADHD directive from SQLite');
  cleanup(soulDb);

  // Stale-roster regression through the real loader path in an isolated HOME:
  // a user YAML missing i-have-adhd for akatsuki must gain it while keeping
  // user-only skills untouched.
  const { execFileSync } = require('child_process');
  const staleHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-stale-home-'));
  const staleAgentsDir = path.join(staleHome, '.agents');
  fs.mkdirSync(staleAgentsDir, { recursive: true });
  const staleYaml = [
    '- name: akatsuki',
    '  icon: ⚔',
    '  title: Stale Akatsuki',
    '  purpose: stale fixture',
    '  skills:',
    '    - akatsuki-skill',
    '    - antislop',
    '    - my-custom-skill',
    '  enable_mcp_tools: true',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(staleAgentsDir, 'agents.yaml'), staleYaml);
  const staleDb = freshDbPath('staleroster');
  const mergedSkills = JSON.parse(execFileSync(process.execPath, ['-e',
    "const {loadAgents}=require('/home/andycungkrinx/experiment/portofolio/data/konoha/src/agent_manager.js');" +
    "const a=loadAgents(true,true).find(x=>x.name==='akatsuki');" +
    "console.log(JSON.stringify(a?a.skills:[]));"
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: staleHome, KONOHA_DB_PATH: staleDb },
    timeout: 120000
  }).trim());
  assert.ok(
    mergedSkills.includes('i-have-adhd'),
    `stale akatsuki roster must gain i-have-adhd through the loader (got ${JSON.stringify(mergedSkills)})`
  );
  assert.ok(
    mergedSkills.includes('my-custom-skill'),
    `stale akatsuki roster must keep user-only skills (got ${JSON.stringify(mergedSkills)})`
  );
  console.log('✓ Stale Akatsuki roster gains i-have-adhd and keeps user-only skills via loadAgents');
  fs.rmSync(staleHome, { recursive: true, force: true });
  cleanup(staleDb);
  const { parseYaml } = require('../bin/lib/yaml_utils');
  const templateAgents = parseYaml(fs.readFileSync(path.join(ROOT, 'src', 'templates', 'agents.yaml'), 'utf-8'));
  const templateAkatsuki = templateAgents.find(a => a && a.name === 'akatsuki');
  assert.ok(
    templateAkatsuki && Array.isArray(templateAkatsuki.skills) && templateAkatsuki.skills.includes('i-have-adhd'),
    'src/templates/agents.yaml must declare i-have-adhd for akatsuki'
  );
  console.log('✓ Template declares i-have-adhd for akatsuki; merge policy is additive-only (user skills preserved)');

  // Skill provenance distinguishes database rows from mirror fallback.
  const skillDb = freshDbPath('skill');
  const db = require('../src/db');
  db.DB_PATH = skillDb;
  const conn = db.getConnection(skillDb, false);
  db.setupSchema(conn);
  conn.prepare(
    "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run('i-have-adhd', 'i-have-adhd', 'skill', 'adhd', '# i-have-adhd\nDB copy', 'src/templates/skills/i-have-adhd/SKILL.md', 24, 2);
  conn.close();

  try { delete require.cache[require.resolve('../src/mcp/skills_retrieval')]; } catch (_) { /* ignore */ }
  const { getSkill, useSkills } = require('../src/mcp/skills_retrieval');
  const dbRes = JSON.parse(getSkill('i-have-adhd'));
  assert.strictEqual(dbRes.source, 'sqlite_fts5', `DB-resident skill must report sqlite_fts5 (got ${dbRes.source})`);
  console.log('✓ DB-resident skill reports source=sqlite_fts5 via get_skill');

  const batchRes = JSON.parse(useSkills(['i-have-adhd']));
  const batchItem = (batchRes.skills && batchRes.skills[0]) || batchRes;
  assert.strictEqual(batchItem.source, 'sqlite_fts5', `use_skills must preserve sqlite_fts5 (got ${batchItem.source})`);
  console.log('✓ use_skills preserves source=sqlite_fts5 for the DB-resident skill');

  const mirrorRes = JSON.parse(getSkill('antislop-human'));
  assert.ok(
    ['sqlite_fts5', 'mirror_fallback'].includes(mirrorRes.source),
    `fallback skill must report an explicit provenance (got ${mirrorRes.source})`
  );
  console.log(`✓ Fallback skill reports explicit source=${mirrorRes.source}`);
  db.DB_PATH = null;
  delete process.env.KONOHA_DB_PATH;
  cleanup(skillDb);

  console.log('\nAll test_soul_skill_provenance tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
