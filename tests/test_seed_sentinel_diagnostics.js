#!/usr/bin/env node
// Guards the golden-seed diagnostic. A seed that fails must name the sentinel it
// is missing: the gate previously reported only the init exit status, which stays
// 0 even when init skips work, so CI failures were undiagnosable.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SEED_SENTINELS,
  seedIsComplete,
  describeMissingSentinels,
  describeSeedContents
} = require('./helpers/seed_sentinels');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-seed-sentinels-'));

function touch(rel, body = 'x') {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

try {
  assert.strictEqual(SEED_SENTINELS.length, 4, 'four sentinels gate a seed');
  const flat = SEED_SENTINELS.map((parts) => parts.join('/'));
  assert.ok(flat.includes('.konoha/server.js'), 'server.js is a sentinel (lost by a refused symlink swap)');
  assert.ok(flat.includes('.agents/skills/konoha/SKILL.md'), 'the deployed skill is a sentinel');

  // Empty directory: every sentinel missing, nothing present.
  assert.strictEqual(seedIsComplete(tmp), false, 'an empty directory is not a seed');
  assert.deepStrictEqual(describeMissingSentinels(tmp), flat, 'all four are reported missing');
  const emptyContents = describeSeedContents(tmp);
  assert.ok(emptyContents.includes('.konoha=<absent>'), 'absent .konoha is named as absent');
  assert.ok(emptyContents.includes('.agents=<absent>'), 'absent .agents is named as absent');

  // Partial seed: only the present ones are omitted from the missing list.
  touch('.konoha/konoha.db');
  touch('.konoha/server.js');
  assert.strictEqual(seedIsComplete(tmp), false, 'two of four is incomplete');
  assert.deepStrictEqual(
    describeMissingSentinels(tmp),
    ['.konoha/.autosetup-done', '.agents/skills/konoha/SKILL.md'],
    'the report names exactly the two that are absent'
  );
  const partial = describeSeedContents(tmp);
  assert.ok(partial.includes('.konoha=[konoha.db,server.js]'), `contents list what is present, got: ${partial}`);
  assert.ok(partial.includes('.agents=<absent>'), 'still reports .agents as absent');

  // Complete seed: no missing entries, so the message is only built on failure.
  touch('.konoha/.autosetup-done');
  touch('.agents/skills/konoha/SKILL.md', '---\nname: konoha\n---\n');
  assert.strictEqual(seedIsComplete(tmp), true, 'all four present is complete');
  assert.deepStrictEqual(describeMissingSentinels(tmp), [], 'a complete seed reports nothing missing');

  console.log('All test_seed_sentinel_diagnostics checks passed successfully!');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
