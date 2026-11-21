#!/usr/bin/env node
'use strict';

/**
 * tests/test_runtime_mirror_links.js
 *
 * The flat ~/.konoha/mcp copy sits one directory level above ~/.konoha/src/mcp,
 * so a module such as ~/.konoha/mcp/three_asset/model_router.js that requires
 * '../../web/controllers/common' resolves to ~/.konoha/web instead of the
 * mirrored ~/.konoha/src/web and throws MODULE_NOT_FOUND at load.
 *
 * The fix links ~/.konoha/mcp at ~/.konoha/src/mcp so every relative require
 * below it resolves exactly as it does from the repo. This asserts that:
 *   1. the flat name is a symlink to the mirrored tree, not a stale copy;
 *   2. the upward require that used to fail resolves from the installed tree;
 *   3. the module itself loads — the real failure was at require time;
 *   4. no manual ~/.konoha/web sibling link is needed to make (2) true.
 *
 * Skips cleanly (exit 0) when ~/.konoha is absent, as on a fresh checkout or CI.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const KONOHA_HOME = path.join(HOME, '.konoha');
const FLAT_MCP = path.join(KONOHA_HOME, 'mcp');
const MIRROR_MCP = path.join(KONOHA_HOME, 'src', 'mcp');
const MODEL_ROUTER = path.join(FLAT_MCP, 'three_asset', 'model_router.js');
// Built from a variable, not a literal: static import scanners cannot resolve a
// specifier that is relative to the *installed* mirror rather than this file, and
// would report a false unresolved import for a probe that is correct.
const UPWARD_SPECIFIER = ['..', '..', 'web', 'controllers', 'common'].join('/');

function skip(reason) {
  console.log(`SKIP test_runtime_mirror_links: ${reason}`);
  process.exit(0);
}

if (!fs.existsSync(KONOHA_HOME)) skip('~/.konoha is absent');
if (!fs.existsSync(MIRROR_MCP)) skip('~/.konoha/src/mcp is absent');
if (!fs.existsSync(MODEL_ROUTER)) skip('the installed mcp tree has no three_asset/model_router.js');

function testFlatNameIsLinked() {
  const stat = fs.lstatSync(FLAT_MCP);
  assert.ok(stat.isSymbolicLink(), `${FLAT_MCP} is a real directory, not a link to ${MIRROR_MCP}`);
  const target = fs.readlinkSync(FLAT_MCP);
  assert.strictEqual(
    path.resolve(KONOHA_HOME, target),
    path.resolve(MIRROR_MCP),
    `${FLAT_MCP} points at ${target}, not the mirrored src/mcp tree`
  );
  console.log(`  ✓ ${FLAT_MCP} -> ${target}`);
}

function testUpwardRequireResolves() {
  const resolved = require.resolve(UPWARD_SPECIFIER, { paths: [path.dirname(MODEL_ROUTER)] });
  // Node resolves through realpath, and on macOS /var is a symlink to
  // /private/var, so the expected root must be realpath'd too or every correct
  // resolution on macOS reads as "outside".
  let expectedRoot = path.resolve(KONOHA_HOME, 'src', 'web', 'controllers');
  try {
    expectedRoot = fs.realpathSync(expectedRoot);
  } catch (_) { /* keep the unresolved form if it cannot be resolved */ }
  assert.ok(
    resolved.startsWith(expectedRoot),
    `../../web/controllers/common resolved to ${resolved}, outside ${expectedRoot}`
  );
  console.log(`  ✓ ../../web/controllers/common -> ${path.relative(expectedRoot, resolved)}`);
}

function testModuleLoads() {
  // The reported defect was MODULE_NOT_FOUND thrown while loading this file.
  const mod = require(MODEL_ROUTER);
  assert.ok(mod && typeof mod === 'object', 'model_router.js did not export an object');
  console.log('  ✓ three_asset/model_router.js loads from the installed mirror');
}

function testManualSiblingLinkIsNotRequired() {
  // With the flat name linked at src/mcp, resolution goes through src/, so a
  // hand-made ~/.konoha/web symlink is redundant. Its absence must not matter.
  const manual = path.join(KONOHA_HOME, 'web');
  const resolved = require.resolve(UPWARD_SPECIFIER, { paths: [path.dirname(MODEL_ROUTER)] });
  const goesThroughMirror = resolved.startsWith(path.resolve(KONOHA_HOME, 'src'));
  if (fs.existsSync(manual)) {
    console.log(`  ! note: a manual ${manual} link still exists; resolution no longer depends on it`);
  }
  assert.ok(goesThroughMirror, 'resolution does not pass through the mirrored src/ tree');
  console.log('  ✓ resolution is independent of a manual ~/.konoha/web link');
}

console.log('Running test_runtime_mirror_links: installed mirror resolution...');
testFlatNameIsLinked();
testUpwardRequireResolves();
testManualSiblingLinkIsNotRequired();
testModuleLoads();
console.log('\nAll test_runtime_mirror_links checks passed successfully!');
