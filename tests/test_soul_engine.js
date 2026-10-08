#!/usr/bin/env node
'use strict';

/**
 * test_soul_engine.js
 * Comprehensive verification of the Konoha Soul Engine:
 * 1. SOUL.md existence and integrity in src/templates and .agents
 * 2. Multi-client synchronization via scripts/sync_skills.js
 * 3. personaMemory.getSoul API (structured, archetype filter, raw mode)
 * 4. MCP tool dispatch via executeToolSync('get_soul', ...)
 * 5. CLI execution via bin/cli.js soul
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const personaMemory = require('../src/persona_memory');
const { dispatchTool } = require('../src/file_tools_router');
const { syncSoul } = require('../scripts/sync_skills');

console.log('Running test_soul_engine.js...');

// 1. Template and .agents SOUL.md existence
const templatePath = path.join(ROOT, 'src', 'templates', 'SOUL.md');
const agentsSoulPath = path.join(ROOT, '.agents', 'SOUL.md');

assert.ok(fs.existsSync(templatePath), 'src/templates/SOUL.md must exist');
assert.ok(fs.existsSync(agentsSoulPath), '.agents/SOUL.md must exist');

const templateContent = fs.readFileSync(templatePath, 'utf8');
const agentsContent = fs.readFileSync(agentsSoulPath, 'utf8');
assert.strictEqual(templateContent, agentsContent, 'src/templates/SOUL.md and .agents/SOUL.md must be identical');
console.log('  ✓ Authoritative SOUL.md files exist and are synchronized.');

// 2. Client mirror tree synchronization
const syncResult = syncSoul();
assert.ok(typeof syncResult === 'number', 'syncSoul() must return number of updated files');

const clientMirrors = [
  path.join(ROOT, '.cursor', 'SOUL.md'),
  path.join(ROOT, '.gemini', 'SOUL.md'),
  path.join(ROOT, '.commandcode', 'SOUL.md'),
  path.join(ROOT, '.claude', 'SOUL.md'),
  path.join(ROOT, '.agents', 'SOUL.md')
];

for (const mirror of clientMirrors) {
  assert.ok(fs.existsSync(mirror), `Mirror ${mirror} must exist`);
  assert.strictEqual(fs.readFileSync(mirror, 'utf8'), templateContent, `Mirror ${mirror} must match authoritative template`);
}
console.log('  ✓ SOUL.md synchronized to all client mirror trees (.cursor, .gemini, .commandcode, .claude, .agents).');

// 3. personaMemory.getSoul() general query
const soul = personaMemory.getSoul({ projectPath: ROOT });
assert.ok(soul, 'getSoul must return a valid object');
assert.ok(soul.title.includes('Soul of Konoha'), 'title must contain Soul of Konoha');
assert.ok(soul.will_of_fire.includes('Where tree leaves dance'), 'will_of_fire quote must be present');
assert.strictEqual(soul.tenets.length, 5, 'must include exactly 5 universal tenets');

const expectedArchetypes = ['sannin', 'kage', 'jonin', 'anbu', 'genin', 'chunin', 'tokubetsu-jonin'];
for (const arch of expectedArchetypes) {
  assert.ok(soul.archetypes[arch], `archetype ${arch} must exist in soul`);
  assert.ok(soul.archetypes[arch].name, `${arch} must have a name`);
  assert.ok(soul.archetypes[arch].role, `${arch} must have a role`);
  assert.ok(soul.archetypes[arch].voice, `${arch} must have a voice/creed`);
  assert.ok(soul.archetypes[arch].calling, `${arch} must have a calling`);
  assert.ok(soul.archetypes[arch].adhd_shaping, `${arch} must enforce i-have-adhd shaping standard`);
  assert.ok(Array.isArray(soul.archetypes[arch].antislop_skills), `${arch} must have antislop_skills array`);
  assert.ok(soul.archetypes[arch].antislop_skills.includes('antislop'), `${arch} must include antislop core`);
}
assert.ok(soul.universal_adhd_standard.includes('i-have-adhd'), 'universal_adhd_standard must reference i-have-adhd');
assert.ok(soul.tenets[1].summary.includes('i-have-adhd'), 'tenet 2 must mandate i-have-adhd');
console.log('  ✓ personaMemory.getSoul() returns valid doctrine, 5 tenets, and i-have-adhd standard on all 7 spirits.');

// 4. personaMemory.getSoul() with archetype filtering
const joninSoul = personaMemory.getSoul({ agentName: 'jonin', projectPath: ROOT });
assert.ok(joninSoul.archetype, 'jonin query must return archetype object');
assert.strictEqual(joninSoul.archetype.name, '♦ Jonin', 'jonin name must be ♦ Jonin');
assert.strictEqual(joninSoul.archetype.role, 'The Elite Artisan (Frontend Master)', 'jonin role must match');
assert.ok(joninSoul.archetype.antislop_skills.includes('antislop-ui'), 'jonin must have antislop-ui');
assert.ok(joninSoul.archetype.antislop_skills.includes('antislop-layoutmobile'), 'jonin must have antislop-layoutmobile');

const tokubetsuSoul = personaMemory.getSoul({ agentName: 'tokubetsu_jonin', projectPath: ROOT });
assert.ok(tokubetsuSoul.archetype, 'tokubetsu_jonin underscore query must normalize and return archetype object');
assert.strictEqual(tokubetsuSoul.archetype.name, '⬡ Tokubetsu-Jonin');
assert.ok(tokubetsuSoul.archetype.antislop_skills.includes('antislop-copywriting'), 'tokubetsu-jonin must have antislop-copywriting');
const sanninSoul = personaMemory.getSoul({ agentName: 'sannin', projectPath: ROOT });
assert.strictEqual(sanninSoul.archetype.antislop_skills.length, 1, 'sannin must have only antislop core');
assert.strictEqual(sanninSoul.archetype.antislop_skills.includes('antislop-code'), false, 'sannin must exclude antislop-code');
console.log('  ✓ personaMemory.getSoul() archetype filtering and normalization work correctly.');

// 5. personaMemory.getSoul() with raw mode
const rawSoul = personaMemory.getSoul({ raw: true, projectPath: ROOT });
assert.ok(rawSoul.raw_markdown, 'raw mode must return raw_markdown');
assert.ok(rawSoul.raw_markdown.includes('The Soul of Konoha'), 'raw_markdown must contain Soul of Konoha header');
console.log('  ✓ personaMemory.getSoul({ raw: true }) returns raw markdown document.');

// 6. MCP tool dispatch via dispatchTool('get_soul', ...)
const mcpGeneral = dispatchTool('get_soul', {}, ROOT);
assert.strictEqual(mcpGeneral.isError, false, 'get_soul MCP tool must succeed');
const mcpParsed = JSON.parse(mcpGeneral.text);
assert.strictEqual(mcpParsed.tenets.length, 5, 'MCP get_soul output must have 5 tenets');

const mcpFiltered = dispatchTool('get_soul', { agent_name: 'kage' }, ROOT);
assert.strictEqual(mcpFiltered.isError, false, 'get_soul MCP tool with agent_name must succeed');
const mcpKage = JSON.parse(mcpFiltered.text);
assert.strictEqual(mcpKage.archetype.name, '◎ Kage', 'MCP get_soul kage archetype must match');

const mcpRaw = dispatchTool('get_soul', { raw: true }, ROOT);
assert.strictEqual(mcpRaw.isError, false, 'get_soul MCP tool with raw mode must succeed');
assert.ok(mcpRaw.text.includes('The Soul of Konoha'), 'MCP raw output must contain document title');
console.log('  ✓ dispatchTool("get_soul", ...) handles general, filtered, and raw invocations.');

// 7. CLI execution via bin/cli.js soul
const cliGeneral = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'soul'], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.strictEqual(cliGeneral.status, 0, `konoha soul must exit 0: ${cliGeneral.stderr}`);
assert.ok(cliGeneral.stdout.includes('The Soul of Konoha — Will of Fire'), 'konoha soul stdout must contain header');
assert.ok(cliGeneral.stdout.includes('Universal i-have-adhd Standard:'), 'konoha soul stdout must announce universal i-have-adhd standard');
assert.ok(cliGeneral.stdout.includes('Universal Tenets:'), 'konoha soul stdout must list tenets');
assert.ok(cliGeneral.stdout.includes('Ninja Archetype Spirits (7 Specialists):'), 'konoha soul stdout must list archetypes');

const cliJson = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'soul', '--json'], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.strictEqual(cliJson.status, 0, `konoha soul --json must exit 0: ${cliJson.stderr}`);
const cliParsed = JSON.parse(cliJson.stdout.trim());
assert.strictEqual(cliParsed.tenets.length, 5, 'konoha soul --json must parse with 5 tenets');
assert.ok(cliParsed.universal_adhd_standard.includes('i-have-adhd'), 'json output must include universal_adhd_standard');

const cliJonin = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'cli.js'), 'soul', 'jonin'], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.strictEqual(cliJonin.status, 0, `konoha soul jonin must exit 0: ${cliJonin.stderr}`);
assert.ok(cliJonin.stdout.includes('Soul of ♦ Jonin'), 'konoha soul jonin stdout must contain Soul of ♦ Jonin');
assert.ok(cliJonin.stdout.includes('ADHD Standard:'), 'konoha soul jonin stdout must display ADHD Standard');

console.log('  ✓ CLI commands "konoha soul", "konoha soul --json", and "konoha soul jonin" exit with code 0.');

console.log('All tests in test_soul_engine.js passed cleanly!');
