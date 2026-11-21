#!/usr/bin/env node
'use strict';

/**
 * tests/test_workspace_allowed_roots.js
 *
 * The bounded-file and code-intel tools refuse paths outside the workspace root.
 * An OpenBot agent works inside its own agent directory while being pointed at a
 * project elsewhere, so the workspace alone is the wrong boundary there.
 *
 * KONOHA_ALLOWED_ROOTS names extra project roots explicitly, using the same
 * path.delimiter-separated shape as KONOHA_ALLOWED_DB_ROOTS. This asserts:
 *   1. with nothing configured, an outside path is still refused;
 *   2. a named root is allowed, and its files are readable through it;
 *   3. a sibling of the named root is still refused — the guard widens per root,
 *      never wholesale;
 *   4. blank, missing and relative-noise entries authorize nothing;
 *   5. both guards (file_tools_router and file_tools/common) agree.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const router = require(path.join(ROOT, 'src', 'file_tools_router.js'));
const common = require(path.join(ROOT, 'src', 'file_tools', 'common.js'));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-allowed-roots-'));
const projectRoot = path.join(sandbox, 'konoha');
const siblingRoot = path.join(sandbox, 'elsewhere');
const projectFile = path.join(projectRoot, 'README.md');
const siblingFile = path.join(siblingRoot, 'secret.txt');

fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(siblingRoot, { recursive: true });
fs.writeFileSync(projectFile, '# konoha\n');
fs.writeFileSync(siblingFile, 'not for this agent\n');

// A workspace that is deliberately somewhere else, as an agent directory is.
const workspace = path.join(sandbox, 'agent-workspace');
fs.mkdirSync(workspace, { recursive: true });

function setEnv(value) {
  if (value === undefined) delete process.env.KONOHA_ALLOWED_ROOTS;
  else process.env.KONOHA_ALLOWED_ROOTS = value;
}

function assertAllowed(label, fn) {
  try {
    fn();
  } catch (err) {
    assert.fail(`${label}: expected the path to be allowed, got: ${err.message}`);
  }
  console.log(`  ok   ${label} allowed`);
}

function assertRefused(label, fn) {
  assert.throws(fn, /Path outside workspace/, `${label}: expected a refusal`);
  console.log(`  ok   ${label} refused`);
}

function guards() {
  return {
    router: () => router.assertWithinAllowed(projectFile),
    common: () => common.assertWithinAllowed(projectFile, workspace)
  };
}

function siblingGuards() {
  return {
    router: () => router.assertWithinAllowed(siblingFile),
    common: () => common.assertWithinAllowed(siblingFile, workspace)
  };
}

function run() {
  console.log('Running test_workspace_allowed_roots: explicit project roots...');

  router.setWorkspaceRoot(workspace);

  setEnv(undefined);
  assertRefused('unconfigured project file (router)', guards().router);
  assertRefused('unconfigured project file (common)', guards().common);

  setEnv(projectRoot);
  assertAllowed('named root (router)', guards().router);
  assertAllowed('named root (common)', guards().common);
  assertRefused('sibling of the named root (router)', siblingGuards().router);
  assertRefused('sibling of the named root (common)', siblingGuards().common);

  setEnv(['', '   ', path.join(sandbox, 'does-not-exist'), projectRoot].join(path.delimiter));
  assertAllowed('named root beside blank and missing entries (router)', guards().router);
  assertRefused('sibling beside blank and missing entries (common)', siblingGuards().common);

  setEnv(path.join(sandbox, 'does-not-exist'));
  assertRefused('a single missing entry authorizes nothing (router)', guards().router);
  assertRefused('a single missing entry authorizes nothing (common)', guards().common);

  // A traversal out of the named root must not ride along with it.
  setEnv(projectRoot);
  const escape = path.join(projectRoot, '..', 'elsewhere', 'secret.txt');
  assertRefused('traversal out of the named root (router)', () => router.assertWithinAllowed(escape));
  assertRefused('traversal out of the named root (common)', () => common.assertWithinAllowed(escape, workspace));

  setEnv(undefined);
  console.log('\nAll test_workspace_allowed_roots checks passed successfully!');
}

try {
  run();
} finally {
  setEnv(undefined);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
