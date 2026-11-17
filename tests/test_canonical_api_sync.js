#!/usr/bin/env node
'use strict';

/**
 * test_canonical_api_sync.js
 * Regression test locking the canonical MCP tool count (45 tools) and
 * ensuring docs/architecture/CANONICAL-API.md remains in 100% sync with live listToolSchemas().
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { listToolSchemas } = require('../src/file_tools_router');
const { syncCanonicalApi } = require('../scripts/sync_canonical_api');

const ROOT = path.resolve(__dirname, '..');

console.log('Running test_canonical_api_sync.js...');

// Tool count lock
const schemas = listToolSchemas();
assert.strictEqual(schemas.length, 56, `Expected exactly 56 canonical MCP tools, found ${schemas.length}`);
console.log('  ✓ Canonical tool count is locked at 56.');

// Deprecated alias integrity (56 canonical + 2 deprecated = 58 manifest tools)
const manifestTools = require('../src/mcp_tool_manifest.json').tools;
const deprecatedTools = manifestTools.filter(t => t.deprecated);
assert.strictEqual(manifestTools.length, 58, `Expected 58 tools in manifest (56 canonical + 2 deprecated), found ${manifestTools.length}`);
assert.strictEqual(deprecatedTools.length, 2, `Expected 2 deprecated tools in manifest, found ${deprecatedTools.length}`);
assert.ok(deprecatedTools.find(t => t.name === 'find_skills' && t.replacedBy === 'find_skill'), 'find_skills must be deprecated with replacedBy find_skill');
assert.ok(deprecatedTools.find(t => t.name === 'build_with_image_design' && t.replacedBy === 'build_from_source'), 'build_with_image_design must be deprecated with replacedBy build_from_source');
console.log('  ✓ 56 canonical + 2 deprecated aliases = 58 manifest tools verified.');

// Specific schema parameter integrity checks
const findSkill = schemas.find(t => t.name === 'find_skill');
assert.ok(findSkill, 'find_skill must exist in canonical tool schemas');
assert.ok(findSkill.inputSchema.properties.task_id, 'find_skill schema must include task_id parameter');
assert.ok(findSkill.inputSchema.properties.keyword, 'find_skill schema must include keyword parameter');
assert.ok(findSkill.inputSchema.required.includes('keyword'), 'find_skill must require keyword');

const getSkill = schemas.find(t => t.name === 'get_skill');
assert.ok(getSkill, 'get_skill must exist in canonical tool schemas');
assert.ok(getSkill.inputSchema.properties.name, 'get_skill schema must include name parameter');
assert.ok(getSkill.inputSchema.properties.token_budget, 'get_skill schema must include token_budget parameter');
assert.ok(getSkill.inputSchema.properties.section, 'get_skill schema must include section parameter');
assert.ok(getSkill.inputSchema.properties.task_id, 'get_skill schema must include task_id parameter');
assert.ok(getSkill.inputSchema.required.includes('name'), 'get_skill must require name');
console.log('  ✓ find_skill and get_skill schemas include token optimization parameters.');

// sync_canonical_api check passes
assert.doesNotThrow(() => {
  syncCanonicalApi(true); // check only
}, 'CANONICAL-API.md must be in exact sync with live tool schemas');
console.log('  ✓ CANONICAL-API.md Section 1 matches live listToolSchemas() output.');

// CLI check execution
const cliRes = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync_canonical_api.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8'
});
assert.strictEqual(cliRes.status, 0, `CLI sync check failed: ${cliRes.stderr || cliRes.stdout}`);
console.log('  ✓ scripts/sync_canonical_api.js --check exits with code 0.');

console.log('All tests in test_canonical_api_sync.js passed cleanly!');
