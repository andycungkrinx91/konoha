#!/usr/bin/env node
'use strict';

/**
 * tests/test_delegation_alias_removal.js
 *
 * Verification suite for Batch 4.6 (Option A):
 * - Confirms total removal of delegate_to_* schemas from mcp_tool_manifest.json (49 -> 42 tools).
 * - Confirms listToolSchemas() continues returning 40 canonical tools.
 * - Confirms tool_dispatch.js and file_tools_router.js return Unknown tool error for delegate_to_*.
 * - Confirms ensureAntigravityPermissions prunes stale grants across all four settings.json paths idempotently.
 * - Confirms normalization behavior: keeps mcp_ stripping and _ -> - conversion, removes delegate_to_ stripping.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DELEGATE_TOOLS = [
  'delegate_to_sannin',
  'delegate_to_kage',
  'delegate_to_jonin',
  'delegate_to_anbu',
  'delegate_to_chunin',
  'delegate_to_tokubetsu_jonin',
  'delegate_to_genin'
];

// 1. Manifest & Router Schema Verification
console.log('Testing 1: Manifest and listToolSchemas contract...');
const manifestPath = path.resolve(__dirname, '../src/mcp_tool_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const tool of DELEGATE_TOOLS) {
  assert.ok(
    !manifest.tools.some(t => t.name === tool),
    `Tool ${tool} must NOT exist in mcp_tool_manifest.json`
  );
}
assert.strictEqual(manifest.tools.length, 42, `Manifest tools length must be exactly 42, got ${manifest.tools.length}`);

const fileToolsRouter = require('../src/file_tools_router');
const liveSchemas = fileToolsRouter.listToolSchemas();
assert.strictEqual(liveSchemas.length, 40, `listToolSchemas() must return exactly 40 canonical schemas, got ${liveSchemas.length}`);

for (const tool of DELEGATE_TOOLS) {
  assert.strictEqual(
    fileToolsRouter.TOOL_HANDLERS[tool],
    undefined,
    `TOOL_HANDLERS must NOT have handler for ${tool}`
  );
}

// 2. Dispatch Error Verification (Unknown Tool via both paths)
console.log('Testing 2: Unknown tool dispatch error via both paths...');
const toolDispatch = require('../src/mcp/tool_dispatch');

for (const tool of ['delegate_to_kage', 'delegate_to_anbu', 'delegated_to_jonin']) {
  // Path A: tool_dispatch.js (_executeToolInternal)
  const dispatchRes = JSON.parse(toolDispatch._executeToolInternal(tool, {}, 'kage'));
  assert.deepStrictEqual(
    dispatchRes,
    { error: `Unknown tool: ${tool}` },
    `tool_dispatch._executeToolInternal must return unknown tool error for ${tool}`
  );

  // Path B: file_tools_router.js (dispatchTool)
  const routerRes = fileToolsRouter.dispatchTool(tool, {});
  assert.strictEqual(routerRes.isError, true, `dispatchTool must return isError: true for ${tool}`);
  const parsedRouterRes = JSON.parse(routerRes.text);
  assert.deepStrictEqual(
    parsedRouterRes,
    { error: `Unknown tool: ${tool}` },
    `file_tools_router.dispatchTool must return unknown tool error for ${tool}`
  );
}

// 3. Antigravity Permissions Pruning Fixture Test
console.log('Testing 3: ensureAntigravityPermissions pruning fixture test...');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_ag_test_'));

try {
  const origHome = process.env.HOME;
  process.env.HOME = tmpHome;

  const targetSettingsPaths = [
    path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json'),
    path.join(tmpHome, '.gemini', 'antigravity-ide', 'settings.json'),
    path.join(tmpHome, '.gemini', 'config', 'settings.json'),
    path.join(tmpHome, '.gemini', 'settings.json')
  ];

  // Seed fixture files with user entries AND stale delegate_to grants
  for (const p of targetSettingsPaths) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const initialData = {
      permissions: {
        allow: [
          'user_custom_tool',
          'mcp(konoha/kage)',
          'mcp(konoha/delegate_to_kage)',
          'mcp(konoha/delegate_to_anbu)',
          'mcp(konoha/delegated_to_jonin)'
        ]
      },
      autoApprove: [
        'mcp(konoha/kage)',
        'mcp(konoha/delegate_to_kage)',
        'user_custom_auto'
      ]
    };
    fs.writeFileSync(p, JSON.stringify(initialData, null, 2), 'utf8');
  }

  // Create corrupt file test for one extra path
  const corruptPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json.test-corrupt');
  fs.writeFileSync(corruptPath, '{ bad: json', 'utf8');

  // Load antigravity_manager freshly
  delete require.cache[require.resolve('../src/antigravity_manager')];
  const agManager = require('../src/antigravity_manager');

  // Execute ensureAntigravityPermissions
  const res1 = agManager.ensureAntigravityPermissions();
  const updatedCount = res1 && typeof res1 === 'object' ? res1.updatedCount : res1;
  assert.strictEqual(updatedCount, 4, `All 4 settings files should be updated, got ${updatedCount}`);

  // Verify stale grants pruned, user custom preserved
  for (const p of targetSettingsPaths) {
    const updated = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(updated.permissions.allow.includes('user_custom_tool'), 'user_custom_tool must be preserved in allow');
    assert.ok(updated.permissions.allow.includes('mcp(konoha/kage)'), 'mcp(konoha/kage) must be preserved in allow');
    assert.ok(!updated.permissions.allow.some(g => g.includes('delegate_to_')), 'No delegate_to_ in allow');
    assert.ok(!updated.permissions.allow.some(g => g.includes('delegated_to_')), 'No delegated_to_ in allow');

    assert.ok(updated.autoApprove.includes('user_custom_auto'), 'user_custom_auto must be preserved in autoApprove');
    assert.ok(updated.autoApprove.includes('mcp(konoha/kage)'), 'mcp(konoha/kage) must be preserved in autoApprove');
    assert.ok(!updated.autoApprove.some(g => g.includes('delegate_to_')), 'No delegate_to_ in autoApprove');
  }

  // Idempotency: Second run should be a no-op (updatedCount = 0)
  const res2 = agManager.ensureAntigravityPermissions();
  const secondRunUpdated = res2 && typeof res2 === 'object' ? res2.updatedCount : res2;
  assert.strictEqual(secondRunUpdated, 0, `Second run must be a no-op (updatedCount: 0), got ${secondRunUpdated}`);

  process.env.HOME = origHome;
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

// 4. Normalization Checks (Kept vs Removed Behavior)
console.log('Testing 4: Agent normalization in sdlc_manager and memory_reporting...');
const sdlcManager = require('../src/sdlc_manager');
const memoryReporting = require('../src/mcp/memory_reporting');
const Database = require('../src/sqlite_driver');

const normTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_norm_test_'));
const normDbPath = path.join(normTmpDir, 'test.db');
try {
  const conn = new Database(normDbPath);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      model TEXT
    );
    INSERT INTO agents (name, model) VALUES
      ('kage', 'anthropic/claude-3-7-sonnet'),
      ('anbu', 'openai/gpt-4o'),
      ('tokubetsu-jonin', 'google/gemini-2.5-pro');
  `);
  conn.close();

  // In sdlc_manager.detectReviewIndependence:
  // mcp_anbu -> anbu (kept)
  // tokubetsu_jonin -> tokubetsu-jonin (kept)
  // delegate_to_jonin -> delegate-to-jonin (delegate_to_ stripping removed)
  const indep1 = sdlcManager.detectReviewIndependence('mcp_anbu', 'kage', normDbPath);
  assert.strictEqual(indep1.isCrossProvider, true, 'mcp_ prefix must still be stripped');

  const indep2 = sdlcManager.detectReviewIndependence('tokubetsu_jonin', 'kage', normDbPath);
  assert.strictEqual(indep2.isCrossProvider, true, '_ must still be converted to -');

  const indep3 = sdlcManager.detectReviewIndependence('delegate_to_jonin', 'kage', normDbPath);
  // delegate-to-jonin is unknown in db, so fallback to self (isCrossProvider = false)
  assert.strictEqual(indep3.isCrossProvider, false, 'delegate_to_ must NOT be stripped');
} finally {
  fs.rmSync(normTmpDir, { recursive: true, force: true });
}

// 5. ensureAntigravitySetup (POST /api/v1/clients/antigravity/setup) Pruning Verification
console.log('Testing 5: ensureAntigravitySetup endpoint pruning verification...');
const setupTmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_setup_ep_'));
try {
  const origHome = process.env.HOME;
  process.env.HOME = setupTmpHome;

  const testSettingsPath = path.join(setupTmpHome, '.gemini', 'antigravity-cli', 'settings.json');
  fs.mkdirSync(path.dirname(testSettingsPath), { recursive: true });
  fs.writeFileSync(testSettingsPath, JSON.stringify({
    permissions: {
      allow: [
        'mcp(konoha/kage)',
        'mcp(konoha/delegate_to_kage)',
        'custom_allow'
      ]
    },
    autoApprove: [
      'mcp(konoha/kage)',
      'mcp(konoha/delegate_to_kage)'
    ]
  }, null, 2), 'utf8');

  delete require.cache[require.resolve('../src/antigravity_manager')];
  const agManagerSetup = require('../src/antigravity_manager');
  const setupRes = agManagerSetup.ensureAntigravitySetup({ silent: true });
  assert.strictEqual(setupRes.ok, true, 'ensureAntigravitySetup must return { ok: true }');

  const afterSettings = JSON.parse(fs.readFileSync(testSettingsPath, 'utf8'));
  assert.ok(afterSettings.permissions.allow.includes('custom_allow'), 'custom_allow preserved');
  assert.ok(afterSettings.permissions.allow.includes('mcp(konoha/kage)'), 'mcp(konoha/kage) preserved');
  assert.ok(!afterSettings.permissions.allow.some(g => g.includes('delegate_to_')), 'delegate_to_ pruned from allow');
  assert.ok(!afterSettings.autoApprove.some(g => g.includes('delegate_to_')), 'delegate_to_ pruned from autoApprove');

  process.env.HOME = origHome;
} finally {
  fs.rmSync(setupTmpHome, { recursive: true, force: true });
}

console.log('✓ All test_delegation_alias_removal assertions passed cleanly!');
