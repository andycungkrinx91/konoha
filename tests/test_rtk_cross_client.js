#!/usr/bin/env node
'use strict';

/**
 * tests/test_rtk_cross_client.js — Cross-client RTK verification test across all 6 clients:
 * Antigravity, Claude Code, Cursor, OpenCode, CommandCode, and Codex.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();

async function run() {
  console.log('Running test_rtk_cross_client tests...');

  // 1. RTK binary detection
  const { getRtkCommand, isRtkInstalled } = require('../src/platform_utils');
  const rtkCmd = getRtkCommand();
  const installed = isRtkInstalled();
  assert.ok(installed && rtkCmd, 'RTK must be detected');
  console.log('✓ RTK binary detection passed:', rtkCmd);

  // 2. Antigravity RTK deployment
  const { deployAntigravityRtkRule } = require('../src/antigravity_manager');
  const resAgy = deployAntigravityRtkRule(true);
  assert.ok(resAgy && resAgy.ok, 'Antigravity RTK deployment failed');
  assert.ok(fs.existsSync(path.join(HOME, '.gemini', 'antigravity-cli', 'rules', 'rtk.md')));
  assert.ok(fs.existsSync(path.join(HOME, '.gemini', 'antigravity-ide', 'rules', 'rtk.md')));
  console.log('✓ Antigravity RTK deployment passed');

  // 3. Claude Code RTK deployment
  const { deployClaudeCodeRtkRule, initRtkHook } = require('../src/mcp_clients_manager');
  const r1 = deployClaudeCodeRtkRule(true);
  const r2 = initRtkHook(true);
  assert.ok(r1 && r1.ok, 'Claude Code RTK deployment failed');
  assert.ok(r2 && r2.ok, 'Claude Code RTK hook init failed');
  assert.ok(fs.existsSync(path.join(HOME, '.claude', 'rules', 'rtk.md')));
  console.log('✓ Claude Code RTK deployment passed');

  // 4. Cursor RTK deployment
  const { deployCursorRtkRule } = require('../src/cursor_manager');
  const resCursor = deployCursorRtkRule(true);
  assert.ok(resCursor && resCursor.ok, 'Cursor RTK deployment failed');
  assert.ok(fs.existsSync(path.join(HOME, '.cursor', 'rules', 'rtk.mdc')));
  console.log('✓ Cursor RTK deployment passed');

  // 5. OpenCode RTK deployment
  const { deployOpenCodeRtkRule } = require('../src/opencode_manager');
  const resOpenCode = deployOpenCodeRtkRule(true);
  assert.ok(resOpenCode && resOpenCode.ok, 'OpenCode RTK deployment failed');
  const opencodeRule1 = path.join(HOME, '.config', 'opencode', 'rules', 'rtk.md');
  const opencodeRule2 = path.join(HOME, '.opencode', 'rules', 'rtk.md');
  assert.ok(fs.existsSync(opencodeRule1) || fs.existsSync(opencodeRule2));
  console.log('✓ OpenCode RTK deployment passed');

  // 6. CommandCode RTK deployment
  const { deployCommandCodeRtkRule, registerCommandCodePermissions } = require('../src/mcp_clients_manager');
  const resCc = deployCommandCodeRtkRule(true);
  registerCommandCodePermissions(true);
  assert.ok(resCc && resCc.ok, 'CommandCode RTK deployment failed');
  assert.ok(fs.existsSync(path.join(HOME, '.commandcode', 'rules', 'rtk.md')));
  console.log('✓ CommandCode RTK deployment passed');

  // 7. Codex RTK deployment
  const { deployCodexRtkRule } = require('../src/codex_manager');
  const resCodex = deployCodexRtkRule(true);
  assert.ok(resCodex && resCodex.ok, 'Codex RTK deployment failed');
  assert.ok(fs.existsSync(path.join(HOME, '.codex', 'rules', 'rtk.md')));
  console.log('✓ Codex RTK deployment passed');

  // 8. RTK contract in rules and prompts
  const geminiRule = fs.readFileSync(path.join(ROOT, 'GEMINI.md'), 'utf-8');
  assert.ok(geminiRule.includes('RTK is mandatory for commands'));
  assert.ok(geminiRule.includes('prefix shell/command execution with `rtk`'));
  console.log('✓ RTK contract in rules and prompts passed');

  console.log('\nAll test_rtk_cross_client tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
