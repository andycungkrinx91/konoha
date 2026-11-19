#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_pointer_budget.js — The konoha maintenance skill is a per-turn cost:
 * a harness that loads it pays every byte on every request. So the entry document stays
 * inside one `get_skill` digest and carries pointers instead of the whole rulebook.
 *
 * Two things break silently without this gate:
 *  - SKILL.md grows past MAX_CONTENT_SIZE and `smartTruncate` drops whole sections,
 *    so the caller pays for a document whose tail it never sees.
 *  - A pointer names a reference that was renamed or never written, and the agent that
 *    follows it gets a resolution error instead of the rule it needed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'src', 'templates', 'skills', 'konoha');
const MIRROR_DIR = path.join(ROOT, '.agents', 'skills', 'konoha');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');
const ENTRY_BUDGET_BYTES = 10000;
const { MAX_CONTENT_SIZE, smartTruncate } = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));

/** `konoha/<slug>` pointers, ignoring real filesystem paths like `~/.konoha/backups`. */
function pointers(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?<![.\w/-])konoha\/([a-z][a-z-]*)/g)) found.add(m[1]);
  return [...found].sort();
}

function run() {
  console.log('Running test_skill_pointer_budget tests...');

  const entry = fs.readFileSync(SKILL_PATH, 'utf8');
  const bytes = Buffer.byteLength(entry, 'utf8');
  assert.ok(bytes <= ENTRY_BUDGET_BYTES, `konoha/SKILL.md is ${bytes} B, over the ${ENTRY_BUDGET_BYTES} B entry budget`);
  console.log(`✓ entry document is ${bytes} B (budget ${ENTRY_BUDGET_BYTES} B)`);

  // The served digest caps at MAX_CONTENT_SIZE; a longer entry loses its tail without saying so.
  const digest = smartTruncate(entry, MAX_CONTENT_SIZE, 'konoha');
  assert.strictEqual(digest.truncated, false, `konoha/SKILL.md exceeds the ${MAX_CONTENT_SIZE} B served digest and would be truncated`);
  console.log(`✓ whole entry fits the ${MAX_CONTENT_SIZE} B served digest`);

  const slugs = pointers(entry);
  assert.ok(slugs.length >= 8, `entry must carry at least 8 on-demand pointers, found ${slugs.length}`);
  const missing = slugs.filter((slug) => !fs.existsSync(path.join(SKILL_DIR, 'references', `${slug}.md`)));
  assert.deepStrictEqual(missing, [], `pointers with no reference file: ${missing.join(', ')}`);
  console.log(`✓ ${slugs.length} pointer(s) all resolve to references/`);

  // Every reference must also be reachable from the entry, or it is dead weight nobody loads.
  const orphans = fs.readdirSync(path.join(SKILL_DIR, 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.basename(f, '.md'))
    .filter((slug) => !slugs.includes(slug));
  assert.deepStrictEqual(orphans, [], `reference(s) no pointer reaches: ${orphans.join(', ')}`);
  console.log('✓ every reference is reachable from the entry');

  // The rulebook did not shrink, it moved: all 29 invariants live in one loadable reference.
  const invariants = fs.readFileSync(path.join(SKILL_DIR, 'references', 'invariants.md'), 'utf8');
  const numbered = (invariants.match(/^\d+\. \*\*/gm) || []).length;
  assert.strictEqual(numbered, 29, `invariants.md must carry all 29 numbered rules, found ${numbered}`);
  console.log('✓ invariants.md carries all 29 numbered rules');

  // The published mirror is what a client's session actually reads.
  for (const rel of ['SKILL.md', 'references/invariants.md', 'references/codeintel-contracts.md', 'references/history.md']) {
    const a = path.join(SKILL_DIR, rel);
    const b = path.join(MIRROR_DIR, rel);
    assert.ok(fs.existsSync(b), `.agents/skills/konoha/${rel} must exist`);
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)), `.agents/skills/konoha/${rel} drifted from src/templates/skills`);
  }
  console.log('✓ published mirror is byte-identical');

  console.log('\nAll test_skill_pointer_budget tests passed!');
}

if (require.main === module) {
  run();
}

module.exports = { run, pointers };
