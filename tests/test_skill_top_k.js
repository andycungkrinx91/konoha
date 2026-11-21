#!/usr/bin/env node
// Issue #34: the hybrid skill path fell back to semantic_top_k (10) whenever a
// caller passed no topK, so skill retrieval could return twice the top-5 the
// skill contract guarantees. SKILL_TOP_K (5) was read but never used there.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../src/db');
const vector_search = require('../src/vector_search');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-skill-topk-'));

function seedSkills(conn, count) {
  const insert = conn.prepare(`
    INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < count; i += 1) {
    const name = `skill-${String(i).padStart(2, '0')}-security`;
    const content = `# Security Hardening ${i}\n\nsecurity hardening guidance for audit ${i}.\n`;
    insert.run(name, name, 'skill', 'security, audit', content, `/path/${name}/SKILL.md`, content.length, 5);
  }
}

async function main() {
  const testDb = path.join(tmp, 'skills_topk.db');
  const conn = db.getConnection(testDb);
  db.setupSchema(conn);

  // More matching skills than either width, so a wrong fallback is visible.
  seedSkills(conn, 12);

  const capped = await vector_search.findSkillHybrid(conn, 'security hardening');
  assert.ok(capped.length > 0, 'the hybrid path must return matches for a matching query');
  assert.ok(
    capped.length <= 5,
    `no topK must cap skill retrieval at 5, got ${capped.length}`
  );
  console.log(`  ok   no topK returns ${capped.length} result(s), capped at 5`);

  // Descending by score, so trimming at 5 keeps the best five rather than an
  // arbitrary five.
  const scores = capped.map((r) => Number(r.score || 0));
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(
      scores[i - 1] >= scores[i],
      `results must be ordered by descending score, ${scores[i - 1]} then ${scores[i]}`
    );
  }
  console.log('  ok   results are ordered by descending score');

  // An explicit width still wins, so callers are not clamped to the cap.
  const narrow = await vector_search.findSkillHybrid(conn, 'security hardening', { topK: 2 });
  assert.strictEqual(narrow.length, 2, `an explicit topK of 2 must return 2, got ${narrow.length}`);
  console.log('  ok   an explicit topK overrides the default');

  // The failure case: a query nothing matches must return nothing rather than
  // padding to the cap.
  const none = await vector_search.findSkillHybrid(conn, 'quantum chromodynamics recipe');
  assert.strictEqual(none.length, 0, `an unmatched query must return 0, got ${none.length}`);
  console.log('  ok   an unmatched query returns nothing instead of padding');

  conn.close();
  console.log('\nAll test_skill_top_k checks passed successfully!');
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
