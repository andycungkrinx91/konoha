#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('Running test_token_hygiene_and_platform.js...');

const { findFilesClean } = require('../src/file_tools/find_files_clean');
const { readFileHead } = require('../src/file_tools/read_file_head');
const { readFileRange } = require('../src/file_tools/read_file_range');
const common = require('../src/file_tools/common');
const router = require('../src/file_tools_router');
const contract = require('../src/agent_contract');

// 1. Verify findFilesClean bounds results and respects limit
const repoDir = path.resolve(__dirname, '..');
const boundedRes = findFilesClean({ dir: repoDir, pattern: '*.js', limit: 5 });
assert.strictEqual(boundedRes.files.length, 5, 'findFilesClean should return exactly 5 files when limit=5');
assert.strictEqual(boundedRes.truncated, true, 'findFilesClean should mark truncated: true when limit reached');
assert.strictEqual(boundedRes.limit, 5, 'findFilesClean should return limit: 5');

// 2. Verify findFilesClean through router with aliases
const routerFind = router.dispatchTool('find_files_clean', { root_dir: repoDir, pattern: '*.js', max_results: 3 });
assert.ok(!routerFind.isError, 'router find_files_clean should not error');
const parsedFind = JSON.parse(routerFind.text);
assert.strictEqual(parsedFind.files.length, 3, 'router should normalize max_results and root_dir');
assert.strictEqual(parsedFind.truncated, true, 'should be truncated');

// 3. Verify read_file_head and read_file_range truncate excessively long lines to prevent token blowups
const tmpDir = path.join(os.tmpdir(), 'konoha-token-test-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
const longLineFile = path.join(tmpDir, 'longline.txt');
const hugeLine = 'A'.repeat(10000);
fs.writeFileSync(longLineFile, `Line 1: short\nLine 2: ${hugeLine}\nLine 3: short\n`, 'utf8');

// Note: to test reading outside workspace without error, set router workspace root to tmpDir
const oldWs = router.getWorkspaceRoot();
router.setWorkspaceRoot(tmpDir);

try {
  const headRes = readFileHead({ path: longLineFile, max_lines: 3, workspace: tmpDir });
  assert.ok(headRes.text.includes('[line truncated from 10008 chars]'), 'readFileHead should truncate lines > 1000 chars');

  const rangeRes = readFileRange({ path: longLineFile, start_line: 2, end_line: 2, workspace: tmpDir });
  assert.ok(rangeRes.text.includes('[line truncated from 10008 chars]'), 'readFileRange should truncate lines > 1000 chars');

  // Verify MAX_SPAN = 250 enforcement on readFileRange
  assert.throws(() => {
    readFileRange({ path: longLineFile, start_line: 1, end_line: 300, workspace: tmpDir });
  }, /requested span is 300 lines \(max 250\)/, 'readFileRange must enforce MAX_SPAN = 250');

  // Verify MAX_LINES = 150 enforcement on readFileHead
  assert.throws(() => {
    readFileHead({ path: longLineFile, max_lines: 200, workspace: tmpDir });
  }, /exceeds cap 150/, 'readFileHead must enforce MAX_LINES = 150');

  // 4. Verify .pi is in allowed paths in common.js
  const piFile = path.join(os.homedir(), '.pi', 'agent', 'test.txt');
  let allowed = false;
  try {
    common.assertWithinAllowed(piFile, repoDir);
    allowed = true;
  } catch (_) {
    allowed = false;
  }
  assert.strictEqual(allowed, true, '~/.pi paths must be allowed in common.assertWithinAllowed');

  // 5. Verify contract includes token hygiene rule across all clients
  for (const client of ['antigravity', 'cursor', 'claude', 'opencode', 'commandcode', 'codex', 'pi']) {
    const text = contract.buildMainAgentContract(client);
    assert.ok(text.includes('Review token hygiene & strict changed-files scoping'), `Client ${client} contract must include token hygiene`);
  }

  // 6. Verify Rule 56 (Token Savings Flow Logic Preservation Invariant) in all templates & skills
  const agentManagerSrc = fs.readFileSync(path.join(repoDir, 'src', 'agent_manager.js'), 'utf8');
  assert.ok(agentManagerSrc.includes('Token Savings Flow Logic'), 'agent_manager.js must contain Token Savings Flow Logic invariant');
  assert.ok(agentManagerSrc.includes('getCliVersion'), 'agent_manager.js must define getCliVersion');
  assert.ok(agentManagerSrc.includes('${cliVer}:${st.mtimeMs}:${st.size}'), 'deploy fingerprint must incorporate CLI version');

  const cursorManagerSrc = fs.readFileSync(path.join(repoDir, 'src', 'cursor_manager.js'), 'utf8');
  assert.ok(cursorManagerSrc.includes('Token Savings Flow Logic'), 'cursor_manager.js must contain Token Savings Flow Logic invariant');

  const skillSrc = fs.readFileSync(path.join(repoDir, '.agents', 'skills', 'konoha', 'SKILL.md'), 'utf8');
  assert.ok(skillSrc.includes('Token Savings Flow Logic Preservation Invariant'), 'konoha SKILL.md must define Rule 56');

  const templateSkillSrc = fs.readFileSync(path.join(repoDir, 'src', 'templates', 'skills', 'konoha', 'SKILL.md'), 'utf8');
  assert.ok(templateSkillSrc.includes('Token Savings Flow Logic Preservation Invariant'), 'src/templates konoha SKILL.md must define Rule 56');

  // 7. Verify CLI fresh install, reinstall & upgrade guarantees
  const cliSrc = fs.readFileSync(path.join(repoDir, 'bin', 'cli.js'), 'utf8');
  assert.ok(cliSrc.includes("checkAndRepairFile('tools_savings_logger.js'"), 'cmdDoctor must check and repair tools_savings_logger.js');
  assert.ok(cliSrc.includes("case 'reinstall':"), 'CLI must support reinstall command alias');
  assert.ok(cliSrc.includes("case 'install':"), 'CLI must support install command alias');
  assert.ok(cliSrc.includes('force: force || versionChanged'), 'ensureAutoSetup must force redeploy on version change');
  assert.ok(cliSrc.includes('syncTemplateSkills()'), 'ensureAutoSetup must sync template skills');
} finally {
  router.setWorkspaceRoot(oldWs);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

console.log('✓ All token hygiene and platform edge-case tests passed!\n');
