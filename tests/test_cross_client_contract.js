#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contract = require('../src/agent_contract');
const agentManager = require('../src/agent_manager');
const antigravity = require('../src/antigravity_manager');
const cursor = require('../src/cursor_manager');
const clients = require('../src/mcp_clients_manager');
const opencode = require('../src/opencode_manager');
const codex = require('../src/codex_manager');

const agents = [
  'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'
].map((name) => ({
  name,
  description: `${name} agent`,
  purpose: 'test coverage',
  title: `${name} title`,
  delegateWhen: 'test coverage',
  constraints: 'use Konoha and Semble',
  workflow: 'find skill, search, delegate',
  skills: [`${name}-skill`],
  instructions: `You are the ${name} agent. Use Konoha and Semble.`
}));

const generated = {
  antigravityMain: antigravity.buildAgentJson(agents[0]).config.customAgent.systemPromptSections[0].content,
  antigravityArgs: antigravity.buildDefineSubagentArgs(agents[0]).system_prompt,
  cursorMain: cursor.generateCursorRule(agents),
  cursorSubagent: cursor.generateCursorSubagent(agents[0]),
  claudeMain: agentManager.generateClaudeCodeMd(agents),
  claudeSubagent: clients.generateClaudeCodeSubagent(agents[0]),
  geminiMain: agentManager.generateGeminiMd(agents),
  agentsMain: agentManager.generateAgentsMd(agents),
  commandRule: contract.buildMainAgentContract('commandcode'),
  openCodeRule: contract.buildMainAgentContract('opencode'),
  codexRule: contract.buildMainAgentContract('codex')
};

for (const [name, text] of Object.entries(generated)) {
  assert.ok(contract.validateContractText(text).ok, `${name} missing contract requirements`);
  assert.match(text, /new session, resumed session/i, `${name} missing resume contract`);
}

for (const agent of agents) {
  const antigravityText = antigravity.buildAgentJson(agent).config.customAgent.systemPromptSections[0].content;
  const cursorText = cursor.generateCursorSubagent(agent);
  const claudeText = clients.generateClaudeCodeSubagent(agent);
  for (const [client, text] of Object.entries({ antigravity: antigravityText, cursor: cursorText, claude: claudeText })) {
    assert.ok(contract.validateContractText(text).ok, `${client}/${agent.name} missing contract`);
  }
}

const claudePermissions = fs.readFileSync(path.join(root, 'src', 'mcp_clients_manager.js'), 'utf8');
assert.match(claudePermissions, /mcp__konoha__\*/);
assert.match(claudePermissions, /mcp__semble__\*/);
assert.match(claudePermissions, /Shell\(rtk \*\)/);

const openCodeSource = fs.readFileSync(path.join(root, 'src', 'opencode_manager.js'), 'utf8');
assert.match(openCodeSource, /deployOpenCodeRules/);
assert.doesNotMatch(openCodeSource, /spawnSync\([^\n]*['"]rtk['"][^\n]*hook[^\n]*opencode/);
assert.ok(opencode.deployOpenCodeRules, 'OpenCode contract deployment must be exported');

const cursorBootstrap = fs.readFileSync(path.join(root, 'src', 'cursor_bootstrap.js'), 'utf8');
assert.doesNotMatch(cursorBootstrap, /syncCursorSkills\(\)/, 'Cursor bootstrap must not mirror skills');
assert.match(cursorBootstrap, /CURSOR_RTK_RULE/);
assert.match(cursorBootstrap, /CURSOR_RULE/);

const cliSource = fs.readFileSync(path.join(root, 'bin', 'cli.js'), 'utf8');
assert.match(cliSource, /refreshSemblePackage/);
assert.match(cliSource, /refreshRtk/);
assert.match(cliSource, /agent_contract\.js/);
assert.match(cliSource, /autoInstallKonohaBridgeExtension\(true, true\)/);
assert.match(cliSource, /andycungkrinx91\.konoha-bridge-master-universal/);

console.log('Cross-client Konoha/Semble/RTK contract passed for all official agents and supported clients.');
