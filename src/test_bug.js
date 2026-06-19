const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const USER_AGENTS_JSON_PATH = path.join(os.homedir(), '.agents', 'agents.json');
const backupPath = USER_AGENTS_JSON_PATH + '.bak';

console.log('Backing up agents.json...');
fs.copyFileSync(USER_AGENTS_JSON_PATH, backupPath);

try {
  // Let's modify the agents.json file to add a custom skill
  const agents = JSON.parse(fs.readFileSync(USER_AGENTS_JSON_PATH, 'utf-8'));
  const jonin = agents.find(a => a.name === 'jonin');
  if (!jonin) throw new Error('jonin agent not found in agents.json');
  
  // Add a custom skill to jonin
  jonin.skills = ['jonin-skill', 'websearch-deep'];
  fs.writeFileSync(USER_AGENTS_JSON_PATH, JSON.stringify(agents, null, 2), 'utf-8');
  console.log('Modified agents.json with custom skill.');

  // Clear module cache to load fresh file
  delete require.cache[require.resolve('./agent_manager.js')];
  const agentManager = require('./agent_manager.js');

  const loadedAgents = agentManager.loadAgents();
  const loadedJonin = loadedAgents.find(a => a.name === 'jonin');
  console.log('Loaded jonin skills:', loadedJonin.skills);
  
  assert.ok(loadedJonin.skills.includes('websearch-deep'), 'Custom skill "websearch-deep" should be preserved!');
  assert.ok(loadedJonin.skills.includes('jonin-skill'), 'Default skill "jonin-skill" should be preserved!');
  console.log('✅ TEST PASSED: Custom skill preserved when loaded.');

} catch (e) {
  console.error('❌ TEST FAILED:', e);
  process.exit(1);
} finally {
  console.log('Restoring agents.json backup...');
  fs.copyFileSync(backupPath, USER_AGENTS_JSON_PATH);
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}
