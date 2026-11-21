#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_pi_agent_roster.js — Pi agent profile deployment.
 *
 * Two production defects this locks down:
 *  1. Only `advisor.md` was written to ~/.pi/agent/agents, so `subagent(agent="chunin")`
 *     had no definition to resolve and every delegation failed even with pi-subagents
 *     installed.
 *  2. The advisor profile carried `tools: read, grep, find, ls` — a YAML scalar, which
 *     pi-subagents reads as one tool name and then rejects at launch.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-pi-roster-'));
process.env.HOME = TEST_HOME;
if (process.env.USERPROFILE) process.env.USERPROFILE = TEST_HOME;

const piManager = require('../src/pi_manager');
const { getDeployableAgents } = require('../src/canonical_agents');
const { isReadOnlyAgent } = require('../src/agent_file_safety');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function frontmatterOf(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  return end === -1 ? null : content.slice(4, end);
}

function toolLines(frontmatter) {
  const lines = frontmatter.split('\n');
  const idx = lines.findIndex((l) => l.trim() === 'tools:');
  if (idx === -1) return null;
  const entries = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('  - ')) break;
    entries.push(line.slice(4).trim());
  }
  return entries;
}

const agentsDir = path.join(TEST_HOME, '.pi', 'agent', 'agents');
fs.mkdirSync(agentsDir, { recursive: true });

const written = piManager.deployPiAgentProfiles(agentsDir, { silent: true });
const expected = getDeployableAgents().map((a) => a.name);

console.log('\nPi agent roster');
check('deploy reports every deployable agent', written.length === expected.length,
  `wrote ${written.length} of ${expected.length}`);
check('roster includes the specialists that failed to resolve before',
  ['chunin', 'anbu', 'genin', 'jonin', 'kage', 'sannin', 'akatsuki', 'tokubetsu-jonin'].every((n) => written.includes(n)),
  written.join(','));

console.log('\nProfile files');
let frontmatterOk = true;
let toolsListOk = true;
let commaScalar = [];
let markerOk = true;
let contractOk = true;
let readOnlyOk = true;

for (const agent of getDeployableAgents()) {
  const file = path.join(agentsDir, `${agent.name}.md`);
  if (!fs.existsSync(file)) {
    frontmatterOk = false;
    continue;
  }
  const content = fs.readFileSync(file, 'utf-8');
  const fm = frontmatterOf(content);
  if (!fm || !fm.includes(`name: ${agent.name}`)) frontmatterOk = false;
  if (!fm || !fm.includes('generated_by: konoha')) markerOk = false;
  if (!content.includes('Konoha runtime contract')) contractOk = false;

  const tools = fm ? toolLines(fm) : null;
  if (!tools || tools.length === 0) {
    toolsListOk = false;
  }
  if (fm && /^tools:\s*[a-z]/m.test(fm)) commaScalar.push(agent.name);

  if (tools && isReadOnlyAgent(agent)) {
    const forbidden = tools.filter((t) => ['write', 'edit', 'bash', 'Write', 'Edit', 'Bash'].includes(t));
    if (forbidden.length > 0) readOnlyOk = false;
  }
}

check('every profile has a name in its frontmatter', frontmatterOk);
check('every profile carries the konoha ownership marker', markerOk);
check('every profile carries the runtime contract', contractOk);
check('tools are a YAML sequence, never a comma scalar', toolsListOk && commaScalar.length === 0,
  commaScalar.length ? `scalar form in: ${commaScalar.join(', ')}` : '');
check('read-only agents get no write/edit/bash grant', readOnlyOk);

console.log('\nPi tool spelling');
const chunin = fs.readFileSync(path.join(agentsDir, 'chunin.md'), 'utf-8');
const chuninTools = toolLines(frontmatterOf(chunin)) || [];
check('builtins use Pi lowercase names', chuninTools.includes('read'), chuninTools.slice(0, 3).join(','));
check('MCP tools use the mcp:server/tool form', chuninTools.some((t) => t.startsWith('mcp:konoha/')),
  chuninTools.filter((t) => t.startsWith('mcp')).slice(0, 2).join(','));
check('no mcp__server__tool grants leak into Pi profiles', !chuninTools.some((t) => t.startsWith('mcp__')),
  chuninTools.filter((t) => t.startsWith('mcp__')).slice(0, 2).join(','));

const genin = fs.readFileSync(path.join(agentsDir, 'genin.md'), 'utf-8');
const geninTools = toolLines(frontmatterOf(genin)) || [];
check('read-only profile keeps read/grep/find/ls', ['read', 'grep', 'find', 'ls'].every((t) => geninTools.includes(t)),
  geninTools.join(','));

console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
