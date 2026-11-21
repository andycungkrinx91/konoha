#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_antigravity_agent_roster.js — Antigravity agent profile contract.
 *
 * Antigravity was audited against the two defects that broke Pi delegation
 * (missing roster, wrong tool-grant spelling) and needed no roster fix: it
 * deploys every canonical agent and names tools in Antigravity's own spelling.
 * This test locks that so a future change cannot regress it silently.
 *
 * Also locks the ownership boundary in `cleanStaleSessionAgents`: it must report
 * non-roster agent directories and must never delete them.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-ag-roster-'));
process.env.HOME = TEST_HOME;
if (process.env.USERPROFILE) process.env.USERPROFILE = TEST_HOME;

const { buildAgentJson } = require('../src/antigravity_agents');
const { getDeployableAgents } = require('../src/canonical_agents');
const { isReadOnlyAgent } = require('../src/agent_file_safety');
const { cleanStaleSessionAgents } = require('../src/antigravity_subagent_hook');

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

const agents = getDeployableAgents();

console.log('\nRoster');
check('roster covers the specialists Pi was missing', agents.length >= 9, `got ${agents.length}`);
check('every canonical ninja is deployable',
  ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka']
    .every((n) => agents.some((a) => a.name === n)),
  agents.map((a) => a.name).join(','));

console.log('\nAgent json shape');
let shapeOk = true;
let toolsOk = true;
let readOnlyOk = true;
let wildcardFree = true;
let routerOk = true;

for (const agent of agents) {
  const payload = buildAgentJson(agent);
  const custom = payload && payload.config && payload.config.customAgent;
  if (!payload.name || !payload.description || !custom) {
    shapeOk = false;
    continue;
  }
  if (!Array.isArray(custom.toolNames) || custom.toolNames.length === 0) {
    toolsOk = false;
    continue;
  }
  // Antigravity's own spelling, never the claude `mcp__server__tool` form.
  if (custom.toolNames.some((t) => String(t).startsWith('mcp__') || String(t) === '*')) wildcardFree = false;
  if (custom.toolNames.includes('call_mcp_tool') === false) toolsOk = false;

  if (isReadOnlyAgent(agent)) {
    const forbidden = custom.toolNames.filter((t) => ['write_to_file', 'replace_file_content', 'run_command'].includes(t));
    if (forbidden.length > 0) readOnlyOk = false;
  }

  const isRouter = agent.name === 'sannin';
  if (Boolean(custom.enable_subagent_tools) !== isRouter) routerOk = false;
}

check('every agent produces name, description and customAgent', shapeOk);
check('toolNames is a non-empty array with call_mcp_tool', toolsOk);
check('no wildcard or mcp__ grants leak into Antigravity toolNames', wildcardFree);
check('read-only agents get no write or run_command grant', readOnlyOk);
check('only sannin may spawn subagents', routerOk);

console.log('\nStale session agent boundary');
const base = path.join(TEST_HOME, '.gemini', 'antigravity', 'brain', 'sess-1', '.agents', 'agents');
fs.mkdirSync(path.join(base, 'chunin'), { recursive: true });
fs.mkdirSync(path.join(base, 'test-agent-x'), { recursive: true });
fs.mkdirSync(path.join(base, 'my-custom-agent'), { recursive: true });

const stale = cleanStaleSessionAgents(base);
check('reports non-roster directories', stale.includes('test-agent-x') && stale.includes('my-custom-agent'),
  stale.join(','));
check('does not report roster directories', !stale.includes('chunin'), stale.join(','));
check('never deletes anything', fs.existsSync(path.join(base, 'test-agent-x')) && fs.existsSync(path.join(base, 'my-custom-agent')));
check('repeat call returns the same report', cleanStaleSessionAgents(base).length === stale.length);
check('missing directory returns an empty report', cleanStaleSessionAgents(path.join(base, 'nope')).length === 0);
check('null input returns an empty report', cleanStaleSessionAgents(null).length === 0);

console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
