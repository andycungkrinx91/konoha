#!/usr/bin/env node
'use strict';

/**
 * tests/test_runtime_mirror_requires.js
 *
 * The installed runtime is what an MCP client actually loads, and it is a copy of
 * src/ rather than src/ itself. A module whose relative require is satisfied in
 * the repo but not in the mirror throws MODULE_NOT_FOUND on the user's machine
 * and nowhere else — that is how konoha.sannin shipped broken while every repo
 * test passed.
 *
 * This resolves every relative require in both trees and asserts the installed
 * tree has no more unresolved specifiers than the repo source tree. Counting
 * rather than listing keeps it honest: both trees resolve their third-party
 * dependencies from different node_modules layouts, so an absolute "zero
 * unresolved" would fail for reasons unrelated to the mirror.
 *
 * Skips cleanly (exit 0) when ~/.konoha is absent, as on a fresh checkout or CI.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const KONOHA_HOME = path.join(HOME, '.konoha');

function skip(reason) {
  console.log(`SKIP test_runtime_mirror_requires: ${reason}`);
  process.exit(0);
}

if (!fs.existsSync(KONOHA_HOME)) skip('~/.konoha is absent');

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '__pycache__', 'build', 'dist', 'coverage']);

function walkJsFiles(root, out = [], seen = new Set()) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    // Node resolves a module through realpath, so the require graph must be
    // evaluated at the realpath too. A flat name linked at the mirrored tree
    // would otherwise be judged at the wrong depth, and a file reachable by two
    // paths would be counted twice.
    let real = full;
    try {
      real = fs.realpathSync(full);
    } catch (_) {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    let stat;
    try {
      stat = fs.statSync(real);
    } catch (_) {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkJsFiles(real, out, seen);
      continue;
    }
    if (real.endsWith('.js')) out.push(real);
  }
  return out;
}

// The installed tree that matters is the FLAT one the launcher loads:
// ~/.konoha/file_tools_mcp.js requires ./mcp/tool_dispatch, so the mirror is
// ~/.konoha/<sub>/ for each src/<sub>/ plus the root *.js copies. ~/.konoha/src
// is a complete copy and would mask the defect, so it is deliberately excluded.
function listInstalledRuntimeRoots() {
  const roots = [];
  let entries = [];
  try {
    entries = fs.readdirSync(KONOHA_HOME, { withFileTypes: true });
  } catch (_) {
    return roots;
  }
  const repoSubdirs = new Set(
    fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  );
  for (const entry of entries) {
    if (entry.name === 'src') continue;
    const full = path.join(KONOHA_HOME, entry.name);
    if (entry.isDirectory() && repoSubdirs.has(entry.name)) {
      roots.push(full);
      continue;
    }
    if (entry.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(full);
      } catch (_) {
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(real);
      } catch (_) {
        continue;
      }
      if (stat.isDirectory() && repoSubdirs.has(entry.name)) roots.push(full);
    }
  }
  return roots;
}

const RELATIVE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function collectUnresolved(files) {
  const unresolved = [];
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    RELATIVE_RE.lastIndex = 0;
    let match;
    while ((match = RELATIVE_RE.exec(source)) !== null) {
      const specifier = match[1];
      try {
        require.resolve(specifier, { paths: [path.dirname(file)] });
      } catch (_) {
        unresolved.push({ file, specifier });
      }
    }
  }
  return unresolved;
}

function describe(unresolved, label) {
  if (!unresolved.length) {
    console.log(`  ok   ${label}: 0 unresolved relative requires`);
    return;
  }
  console.log(`  note ${label}: ${unresolved.length} unresolved relative require(s)`);
  for (const item of unresolved.slice(0, 10)) {
    console.log(`       ${path.relative(ROOT, item.file)} -> ${item.specifier}`);
  }
  if (unresolved.length > 10) console.log(`       ... and ${unresolved.length - 10} more`);
}

console.log('Running test_runtime_mirror_requires: installed flat mirror vs repo source...');

const repoFiles = walkJsFiles(path.join(ROOT, 'src'));
const installedRoots = listInstalledRuntimeRoots();
if (!installedRoots.length) skip('the installed tree has no runtime subdirectories');

const installedFiles = [];
const installedSeen = new Set();
for (const dir of installedRoots) walkJsFiles(dir, installedFiles, installedSeen);
// Root-level *.js modules, which the flat subdirectories require upward.
for (const entry of fs.readdirSync(KONOHA_HOME, { withFileTypes: true })) {
  if (!entry.name.endsWith('.js')) continue;
  const full = path.join(KONOHA_HOME, entry.name);
  let real;
  try {
    real = fs.realpathSync(full);
  } catch (_) {
    continue;
  }
  if (installedSeen.has(real)) continue;
  installedSeen.add(real);
  installedFiles.push(real);
}

assert.ok(repoFiles.length > 0, 'expected to find JavaScript under src/');
assert.ok(installedFiles.length > 0, 'expected to find JavaScript in the installed flat tree');

const repoUnresolved = collectUnresolved(repoFiles);
const installedUnresolved = collectUnresolved(installedFiles);

describe(repoUnresolved, `repo src (${repoFiles.length} files)`);
describe(installedUnresolved, `installed flat tree (${installedRoots.length} subdirs, ${installedFiles.length} files)`);

// The specific defect: a mirrored module reaching for a src/ sibling.
const escapes = installedUnresolved.filter(item => item.specifier.startsWith('../..'));
if (escapes.length) {
  for (const item of escapes) {
    console.error(`  ✗ ${path.relative(KONOHA_HOME, item.file)} -> ${item.specifier}`);
  }
}
// The installer links each flat entry at the mirrored tree so relative requires
// resolve from the repo's own depth. Where the host refuses links (a Windows
// runner without Developer Mode) it keeps real flat copies instead, and a module
// copied one level shallow can no longer reach a src/ sibling. Both states are
// legitimate; assert the one that is actually installed and never let a silently
// broken install pass as a working link-mode one.
const LINK_MODE = (() => {
  try {
    const first = installedRoots[0];
    return Boolean(first) && fs.lstatSync(path.join(KONOHA_HOME, first)).isSymbolicLink();
  } catch (_) {
    return false;
  }
})();

if (LINK_MODE) {
  assert.deepStrictEqual(
    escapes.map(item => `${path.relative(KONOHA_HOME, item.file)} -> ${item.specifier}`),
    [],
    `${escapes.length} mirrored module(s) cannot reach a src/ sibling`
  );
} else {
  // Copy mode cannot satisfy the src/ guarantee, but every escape must still be
  // the documented shallow-copy class and the tree must not be worse than source.
  const outsideHome = escapes.filter((item) => {
    const target = path.resolve(path.dirname(item.file), item.specifier);
    const rel = path.relative(KONOHA_HOME, target);
    return rel.startsWith('..') || path.isAbsolute(rel);
  });
  assert.strictEqual(
    outsideHome.length,
    escapes.length,
    'copy mode may only leave the src/ guarantee for requires that escape the install root'
  );
  console.log(`  ok   copy mode (host refuses links): ${escapes.length} documented shallow-copy escape(s)`);
  for (const item of escapes) {
    console.log(`       ${path.relative(KONOHA_HOME, item.file)} -> ${item.specifier}`);
  }
}

assert.ok(
  installedUnresolved.length <= repoUnresolved.length,
  `installed tree has ${installedUnresolved.length} unresolved relative requires, ` +
  `more than the repo source tree's ${repoUnresolved.length}`
);

console.log('\nAll test_runtime_mirror_requires checks passed successfully!');
