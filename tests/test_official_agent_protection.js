'use strict';

const assert = require('assert');
const agentManager = require('../src/agent_manager');

console.log('Running test_official_agent_protection.js...');

const officialRoster = [
  'sannin',
  'kage',
  'jonin',
  'anbu',
  'chunin',
  'genin',
  'tokubetsu-jonin',
  'mcp_sannin',
  'mcp_kage',
  'mcp_jonin'
];

for (const name of officialRoster) {
  let threw = false;
  try {
    agentManager.deleteAgent(name);
  } catch (err) {
    threw = true;
    assert.ok(
      err.message.includes('protected official Konoha ninja agent') || err.message.includes('cannot be deleted'),
      `Error message for ${name} must indicate protection: ${err.message}`
    );
  }
  assert.strictEqual(threw, true, `Deleting official subagent "${name}" must be blocked and throw an error`);

  let updateThrew = false;
  try {
    agentManager.updateAgent(name, { title: 'Hacked Title' });
  } catch (err) {
    updateThrew = true;
    assert.ok(
      err.message.includes('protected official Konoha ninja agent') || err.message.includes('cannot be modified'),
      `Update error message for ${name} must indicate protection: ${err.message}`
    );
  }
  assert.strictEqual(updateThrew, true, `Updating official subagent "${name}" must be blocked and throw an error`);
}

// Verify custom subagent can be created, updated, and deleted
const customName = 'test_temp_ninja';
try { agentManager.deleteAgent(customName); } catch (_) {}

try {
  const created = agentManager.createSubagent(customName, {
    manual: true,
    title: 'Test Temp Ninja',
    purpose: 'Testing CRUD',
    description: 'Temporary testing agent'
  });
  assert.ok(created, 'Custom agent must be created');
  assert.strictEqual(created.name, 'test_temp_ninja', 'Custom agent name matches');

  const updated = agentManager.updateAgent('test_temp_ninja', {
    title: 'Updated Temp Ninja Title',
    purpose: 'Updated purpose'
  });
  assert.strictEqual(updated.title, 'Updated Temp Ninja Title', 'Custom agent title updated');

  const deleted = agentManager.deleteAgent('test_temp_ninja');
  assert.strictEqual(deleted, true, 'Custom agent deleted successfully');
} finally {
  try { agentManager.deleteAgent(customName); } catch (_) {}
}

console.log('✓ All official ninja agent deletion and update protection checks passed cleanly.');
