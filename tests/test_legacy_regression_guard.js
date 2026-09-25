#!/usr/bin/env node
'use strict';

/**
 * tests/test_legacy_regression_guard.js
 *
 * Verifies that deprecated legacy aliases and obsolete identifiers are not reintroduced
 * into active runtime code, CLI interfaces, or tool listings without explicit authorization.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const BIN_DIR = path.join(ROOT_DIR, 'bin');

console.log('Running test_legacy_regression_guard...');

// 1. Verify schema pruning: listToolSchemas must filter out all deprecated tool names
const fileToolsRouter = require('../src/file_tools_router');
const activeSchemas = fileToolsRouter.listToolSchemas();
const activeToolNames = new Set(activeSchemas.map((t) => t.name));

const BANNED_FROM_TOOL_LIST = [
  'find_skills',
  'build_with_image_design',
  'delegate_to_sannin',
  'delegate_to_kage',
  'delegate_to_jonin',
  'delegate_to_anbu',
  'delegate_to_chunin',
  'delegate_to_tokubetsu_jonin',
  'delegate_to_genin'
];

for (const tool of BANNED_FROM_TOOL_LIST) {
  assert.ok(
    !activeToolNames.has(tool),
    `Deprecated tool "${tool}" must not be advertised in listToolSchemas()`
  );
}

// 2. Canonical tools must be present in active schemas
const CANONICAL_REQUIRED_TOOLS = [
  'find_skill',
  'list_skills',
  'get_skill',
  'build_from_source',
  'build_from_text',
  'sannin',
  'kage',
  'jonin',
  'anbu',
  'chunin',
  'tokubetsu_jonin',
  'genin',
  'report_from_agent',
  'get_project_context',
  'save_project_context',
  'query_project_memory',
  'check_readiness',
  'get_task_evidence',
  'get_slop_findings'
];

for (const tool of CANONICAL_REQUIRED_TOOLS) {
  assert.ok(
    activeToolNames.has(tool),
    `Canonical tool "${tool}" must be present in active schemas`
  );
}

// 3. Verify that obsolete aliases do not exist anywhere in bin/cli.js or src/
const cliContent = fs.readFileSync(path.join(BIN_DIR, 'cli.js'), 'utf8');

// The banned command "skilladd" must never be implemented
assert.ok(!cliContent.includes("cmd === 'skilladd'"), 'Banned command "skilladd" must not exist in cli.js');
assert.ok(!cliContent.includes("case 'skilladd':"), 'Banned case "skilladd" must not exist in cli.js');

// 4. Verify deep-code-explorer is never used as an active agent name in src/ (except legacy normalizer)
function scanForPattern(dir, pattern, allowlist = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (allowlist.some((al) => full.includes(al))) continue;
    if (entry.isDirectory()) {
      scanForPattern(full, pattern, allowlist);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
      const content = fs.readFileSync(full, 'utf8');
      if (pattern.test(content)) {
        throw new Error(`Legacy pattern ${pattern} found in ${path.relative(ROOT_DIR, full)}`);
      }
    }
  }
}

scanForPattern(SRC_DIR, /deep-code-explorer/i, ['test', 'agent_manager.js', 'mcp/skills.js', 'migrate.js']);
const agentMgrContent = fs.readFileSync(path.join(SRC_DIR, 'agent_manager.js'), 'utf8');
const occurrences = (agentMgrContent.match(/deep-code-explorer/g) || []).length;
assert.ok(occurrences <= 3, 'deep-code-explorer in agent_manager.js must only exist in legacy normalizer');

console.log('✓ Legacy regression guard passed successfully: all canonical constraints intact.');
