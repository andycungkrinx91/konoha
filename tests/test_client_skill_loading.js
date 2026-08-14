#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sampleAgent = {
  name: 'genin',
  description: 'Codebase Scout',
  purpose: 'codebase exploration',
  delegationKeywords: 'trace flows',
  constraints: 'read-only',
  skills: ['genin-skill', 'genin-skill/code-exploration'],
  instructions: 'Use Konoha MCP to load the assigned skill and use Semble for code search.'
};

const agentManager = require('../src/agent_manager');
const antigravity = require('../src/antigravity_manager');
const cursor = require('../src/cursor_manager');
const clients = require('../src/mcp_clients_manager');
const opencodeSource = fs.readFileSync(path.join(root, 'src', 'opencode_manager.js'), 'utf8');

const generated = [
  antigravity.buildAgentJson(sampleAgent).config.customAgent.systemPromptSections[0].content,
  antigravity.buildDefineSubagentArgs(sampleAgent).system_prompt,
  cursor.generateCursorSubagent(sampleAgent),
  clients.generateClaudeCodeSubagent(sampleAgent),
  agentManager.generateGeminiMd([sampleAgent]),
  agentManager.generateAgentsMd([sampleAgent]),
  agentManager.generateClaudeCodeMd([sampleAgent]),
];

for (const content of generated) {
  assert.match(content, /genin-skill/, 'generated client instructions must use canonical genin-skill');
  assert.doesNotMatch(content, /mcp__konoha__genin-skill/, 'skill identifiers must not be rewritten as MCP tool names');
  assert.match(content, /find_skill/, 'generated client instructions must load skills through find_skill');
  assert.doesNotMatch(content, /deep-code-explorer/, 'generated client instructions must not use legacy skill names');
}
for (const content of [
  agentManager.generateGeminiMd([sampleAgent]),
  agentManager.generateAgentsMd([sampleAgent]),
  agentManager.generateClaudeCodeMd([sampleAgent]),
  clients.generateClaudeCodeSubagent(sampleAgent),
]) {
  assert.match(content, /get_skill/, 'full client instructions must expose get_skill loading');
}

const mcpServers = clients.buildStdioMcpServers({
  pythonCmd: 'python3',
  serverPath: '/tmp/konoha-server.py',
  uvxCmd: 'uvx',
});
assert.ok(mcpServers.semble, 'Claude Code and Command Code MCP builder must include Semble');
if (mcpServers.konoha) {
  assert.ok(mcpServers.konoha, 'Konoha MCP entry must be present when file tools are installed');
}
assert.match(opencodeSource, /config\.mcp\[['"]konoha['"]\]/, 'OpenCode must register Konoha MCP');
assert.match(opencodeSource, /config\.mcp\[['"]semble['"]\]/, 'OpenCode must register Semble MCP');

console.log('Client skill-loading contract passed for Antigravity, Cursor, Claude Code, OpenCode, and Command Code.');
