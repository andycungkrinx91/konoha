#!/usr/bin/env node
'use strict';

/**
 * tests/test_skill_pointer_budget.js — Two entries are paid for by different people:
 * the shipped `konoha` skill (loaded by client sessions, so a per-turn cost) and the
 * repo-only `konoha-maintenance` skill (read by maintainers, never deployed).
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
const MAINT_DIR = path.join(ROOT, '.agents', 'dev-skills', 'konoha-maintenance');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');
const ENTRY_BUDGET_BYTES = 10000;
const { MAX_CONTENT_SIZE, smartTruncate } = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));

/** `konoha/<slug>` pointers, ignoring real filesystem paths like `~/.konoha/backups`. */
function pointers(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?<![.\w/-])konoha\/([a-z][a-z-]*)/g)) found.add(m[1]);
  return [...found].sort();
}

/** Markdown link targets under `references/`, used by the repo-only maintenance skill. */
function referenceLinks(text) {
  const found = new Set();
  for (const m of text.matchAll(/\]\(references\/([a-z][a-z-]*)\.md\)/g)) found.add(m[1]);
  return [...found].sort();
}

function assertResolvable(dir, slugs, label) {
  const missing = slugs.filter((slug) => !fs.existsSync(path.join(dir, 'references', `${slug}.md`)));
  assert.deepStrictEqual(missing, [], `${label}: pointers with no reference file: ${missing.join(', ')}`);
}

function assertNoOrphans(dir, slugs, label) {
  const orphans = fs.readdirSync(path.join(dir, 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.basename(f, '.md'))
    .filter((slug) => !slugs.includes(slug));
  assert.deepStrictEqual(orphans, [], `${label}: reference(s) no pointer reaches: ${orphans.join(', ')}`);
}

function run() {
  console.log('Running test_skill_pointer_budget tests...');

  // ── Shipped runtime skill: every byte is paid by a client session. ──────────
  const entry = fs.readFileSync(SKILL_PATH, 'utf8');
  const bytes = Buffer.byteLength(entry, 'utf8');
  assert.ok(bytes <= ENTRY_BUDGET_BYTES, `konoha/SKILL.md is ${bytes} B, over the ${ENTRY_BUDGET_BYTES} B entry budget`);
  console.log(`✓ shipped entry is ${bytes} B (budget ${ENTRY_BUDGET_BYTES} B)`);

  const digest = smartTruncate(entry, MAX_CONTENT_SIZE, 'konoha');
  assert.strictEqual(digest.truncated, false, `konoha/SKILL.md exceeds the ${MAX_CONTENT_SIZE} B served digest and would be truncated`);
  console.log(`✓ whole shipped entry fits the ${MAX_CONTENT_SIZE} B served digest`);

  const slugs = pointers(entry);
  const shippedRefs = fs.readdirSync(path.join(SKILL_DIR, 'references')).filter((f) => f.endsWith('.md'));
  assert.ok(slugs.length >= shippedRefs.length, `shipped entry must point at all ${shippedRefs.length} shipped references, found ${slugs.length}`);
  assertResolvable(SKILL_DIR, slugs, 'konoha');
  assertNoOrphans(SKILL_DIR, slugs, 'konoha');
  console.log(`✓ ${slugs.length} shipped pointer(s) all resolve, no orphan references`);

  // ── Repo-only maintenance skill: never deployed, so no per-turn budget. ─────
  const maintEntry = fs.readFileSync(path.join(MAINT_DIR, 'SKILL.md'), 'utf8');
  const maintSlugs = referenceLinks(maintEntry);
  assert.ok(maintSlugs.length >= 8, `konoha-maintenance must point at all its references, found ${maintSlugs.length}`);
  assertResolvable(MAINT_DIR, maintSlugs, 'konoha-maintenance');
  assertNoOrphans(MAINT_DIR, maintSlugs, 'konoha-maintenance');
  console.log(`✓ ${maintSlugs.length} maintenance pointer(s) all resolve, no orphan references`);

  // The rulebook did not shrink, it moved: every invariant lives in one loadable reference.
  const invariants = fs.readFileSync(path.join(MAINT_DIR, 'references', 'invariants.md'), 'utf8');
  const numbered = (invariants.match(/^\d+\. \*\*/gm) || []).length;
  // The count grows as shipped traps are added; it must never shrink, because a
  // missing rule means a known regression lost its guard.
  assert.strictEqual(numbered, 35, `invariants.md must carry all 35 numbered rules, found ${numbered}`);
  console.log('✓ invariants.md carries all 35 numbered rules');

  // Maintenance material must never reach a deployment target.
  assert.ok(
    !fs.existsSync(path.join(SKILL_DIR, 'references', 'invariants.md')),
    'invariants.md must not live in the shipped template tree'
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, '.agents', 'skills', 'konoha-maintenance')),
    'konoha-maintenance must not live under .agents/skills (it is a deployment target)'
  );
  console.log('✓ maintenance material is excluded from shipped and deployable trees');

  // The published mirror is what a client's session actually reads.
  for (const rel of ['SKILL.md', 'references/task-format.md', 'references/mcp-tools-block.md', 'references/contract.md']) {
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
