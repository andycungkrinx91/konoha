#!/usr/bin/env node
'use strict';

/**
 * tests/test_init_embeds_by_default.js — `konoha init` must leave skill search
 * semantic out of the box. Regression target: init used to hardcode
 * `--skip-embeddings` and then tell the user to run `konoha embed` by hand.
 *
 * Asserted behaviourally through the exported arg builder, so re-adding the
 * hardcoded skip fails here instead of passing a source-text grep.
 */

const assert = require('assert');
const { buildInitMigrationArgs } = require('../bin/commands/init');

console.log('Running test_init_embeds_by_default.js...');

const SKILLS = ['anbu-skill', 'kage-skill'];

// Default init requests embeddings.
const def = buildInitMigrationArgs({ pkgSkillsDir: '/pkg/skills', skills: SKILLS });
assert.ok(!def.includes('--skip-embeddings'), 'default init must not skip embeddings');
assert.deepStrictEqual(def.slice(0, 4), ['--skills-dir', '/pkg/skills', '--skills', 'anbu-skill']);
assert.deepStrictEqual(def.slice(4), ['kage-skill'], 'every canonical skill must be seeded');

// --no-embed is the explicit opt-out and still seeds skills.
const off = buildInitMigrationArgs({ pkgSkillsDir: '/pkg/skills', skills: SKILLS, skipEmbed: true });
assert.ok(off.includes('--skip-embeddings'), '--no-embed must pass --skip-embeddings');
assert.ok(off.includes('kage-skill'), '--no-embed must still seed skills');

// The skip flag must never be present on the embedding path.
assert.strictEqual(def.indexOf('--skip-embeddings'), -1);

for (const arg of def) assert.strictEqual(typeof arg, 'string', 'every migration arg must be a string');

console.log('\u2713 test_init_embeds_by_default.js passed cleanly.');
