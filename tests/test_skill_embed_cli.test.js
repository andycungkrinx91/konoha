#!/usr/bin/env node
/**
 * tests/test_skill_embed_cli.test.js
 * Verifies that:
 * 1. agentManager.embedSkill and agentManager.unembedSkill properly persist to SQLite and YAML.
 * 2. "konoha skill <skillname> embed <agentname>" embeds the skill.
 * 3. "konoha skill embed <skillname> <agentname>" alias embeds the skill.
 * 4. "konoha skill <skillname> unembed <agentname>" removes the embedded skill.
 * 5. "konoha skill unembed <skillname> <agentname>" removes the embedded skill.
 * 6. "konoha agent skill <agentname>" in non-interactive mode outputs skills status table.
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const agentManager = require('../src/agent_manager');

const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

// Ensure clean test baseline
agentManager.unembedSkill('anbu', 'test-helm-skill-unit');
agentManager.unembedSkill('anbu', 'test-cli-skill');
agentManager.unembedSkill('anbu', 'test-alias-skill');

console.log('--- 1. Testing agentManager.embedSkill & unembedSkill ---');
const testSkillName = 'test-helm-skill-unit';

// Test embed
const embedRes = agentManager.embedSkill('anbu', testSkillName);
assert.strictEqual(embedRes, true, 'embedSkill should return true for newly embedded skill');

// Verify persistence
const agentsAfterEmbed = agentManager.loadAgents(true);
const anbuAfterEmbed = agentsAfterEmbed.find(a => a.name === 'anbu');
assert.ok(anbuAfterEmbed, 'Subagent anbu must exist');
assert.ok(anbuAfterEmbed.skills.includes(testSkillName), 'anbu.skills must include testSkillName after embed');

// Second embed should return false (already embedded)
const embedDuplicateRes = agentManager.embedSkill('anbu', testSkillName);
assert.strictEqual(embedDuplicateRes, false, 'embedSkill should return false when skill is already embedded');

// Test unembed
const unembedRes = agentManager.unembedSkill('anbu', testSkillName);
assert.strictEqual(unembedRes, true, 'unembedSkill should return true for removed skill');

// Verify persistence after unembed
const agentsAfterUnembed = agentManager.loadAgents(true);
const anbuAfterUnembed = agentsAfterUnembed.find(a => a.name === 'anbu');
assert.ok(!anbuAfterUnembed.skills.includes(testSkillName), 'anbu.skills must not include testSkillName after unembed');

console.log('✓ agentManager API passed');

console.log('--- 2. Testing CLI: konoha skill <skillname> embed <agentname> ---');
const cliEmbed = spawnSync(process.execPath, [cliPath, 'skill', 'test-cli-skill', 'embed', 'anbu'], { encoding: 'utf8' });
assert.strictEqual(cliEmbed.status, 0, `CLI embed should exit with 0: ${cliEmbed.stderr}`);
const embedOut = stripAnsi(cliEmbed.stdout);
assert.ok(embedOut.includes('Successfully embedded skill "test-cli-skill" into @anbu'), 'CLI output should confirm embed: ' + embedOut);

let agents = agentManager.loadAgents(true);
let anbu = agents.find(a => a.name === 'anbu');
assert.ok(anbu.skills.includes('test-cli-skill'), 'CLI embed must persist in agent skills');

console.log('--- 3. Testing CLI: konoha skill <skillname> unembed <agentname> ---');
const cliUnembed = spawnSync(process.execPath, [cliPath, 'skill', 'test-cli-skill', 'unembed', 'anbu'], { encoding: 'utf8' });
assert.strictEqual(cliUnembed.status, 0, `CLI unembed should exit with 0: ${cliUnembed.stderr}`);
const unembedOut = stripAnsi(cliUnembed.stdout);
assert.ok(unembedOut.includes('Successfully removed skill "test-cli-skill" from @anbu'), 'CLI output should confirm removal: ' + unembedOut);

agents = agentManager.loadAgents(true);
anbu = agents.find(a => a.name === 'anbu');
assert.ok(!anbu.skills.includes('test-cli-skill'), 'CLI unembed must remove skill from agent');

console.log('--- 4. Testing CLI Alias: konoha skill embed <skillname> <agentname> ---');
const cliAliasEmbed = spawnSync(process.execPath, [cliPath, 'skill', 'embed', 'test-alias-skill', 'anbu'], { encoding: 'utf8' });
assert.strictEqual(cliAliasEmbed.status, 0, `CLI alias embed should exit with 0: ${cliAliasEmbed.stderr}`);
const aliasEmbedOut = stripAnsi(cliAliasEmbed.stdout);
assert.ok(aliasEmbedOut.includes('Successfully embedded skill "test-alias-skill" into @anbu'), 'CLI output should confirm alias embed: ' + aliasEmbedOut);

agents = agentManager.loadAgents(true);
anbu = agents.find(a => a.name === 'anbu');
assert.ok(anbu.skills.includes('test-alias-skill'), 'CLI alias embed must persist in agent skills');

console.log('--- 5. Testing CLI Alias: konoha skill unembed <skillname> <agentname> ---');
const cliAliasUnembed = spawnSync(process.execPath, [cliPath, 'skill', 'unembed', 'test-alias-skill', 'anbu'], { encoding: 'utf8' });
assert.strictEqual(cliAliasUnembed.status, 0, `CLI alias unembed should exit with 0: ${cliAliasUnembed.stderr}`);
const aliasUnembedOut = stripAnsi(cliAliasUnembed.stdout);
assert.ok(aliasUnembedOut.includes('Successfully removed skill "test-alias-skill" from @anbu'), 'CLI output should confirm alias removal: ' + aliasUnembedOut);

agents = agentManager.loadAgents(true);
anbu = agents.find(a => a.name === 'anbu');
assert.ok(!anbu.skills.includes('test-alias-skill'), 'CLI alias unembed must remove skill from agent');

console.log('--- 6. Testing Non-interactive: konoha agent skill anbu ---');
const nonInteractiveRun = spawnSync(process.execPath, [cliPath, 'agent', 'skill', 'anbu'], {
  input: '',
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe']
});
assert.strictEqual(nonInteractiveRun.status, 0, 'Non-interactive agent skill should exit 0');
const nonIntOut = stripAnsi(nonInteractiveRun.stdout);
assert.ok(nonIntOut.includes('Skills Status for @anbu'), 'Should output skills status table');
assert.ok(nonIntOut.includes('Tip: Run interactively in a TTY'), 'Should provide helpful tip');

console.log('--- 7. Testing Help text: konoha skill --help ---');
const helpRun = spawnSync(process.execPath, [cliPath, 'skill', '--help'], { encoding: 'utf8' });
assert.strictEqual(helpRun.status, 0, 'Help should exit 0');
const helpOut = stripAnsi(helpRun.stdout);
assert.ok(helpOut.includes('embed <agent>'), 'Help should document embed');
assert.ok(helpOut.includes('unembed <agent>'), 'Help should document unembed');

console.log('\nAll skill embed CLI unit tests PASSED cleanly (100% OK).');
