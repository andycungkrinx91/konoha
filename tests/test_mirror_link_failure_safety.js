#!/usr/bin/env node
'use strict';

/**
 * tests/test_mirror_link_failure_safety.js
 *
 * The install mirror replaces a flat copy in ~/.konoha/<name> with a symlink to
 * ~/.konoha/src/<name> so relative requires resolve at the repo's own depth.
 * Creating a symlink fails on Windows unless Developer Mode is on or the process
 * is elevated, and the first version of that code deleted the copy before trying,
 * so a failed link left nothing behind.
 *
 * That broke the Windows golden seed: ~/.konoha/server.js and ~/.konoha/mcp are
 * seed sentinels, and `konoha init` exited 0 while the seed was incomplete, so CI
 * reported "init did not produce a complete seed in 281.4s (status 0)".
 *
 * A failed link must therefore leave the existing copy exactly as it was. This
 * forces symlink creation to throw and asserts nothing is lost, on a fixture tree
 * in /tmp so it never touches the real ~/.konoha.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-link-failure-'));
const dest = path.join(sandbox, 'konoha');
const serverJs = path.join(dest, 'server.js');
const mcpDir = path.join(dest, 'mcp');
const mcpFile = path.join(mcpDir, 'tool_dispatch.js');

function buildFixture() {
  fs.mkdirSync(path.join(dest, 'src', 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'src', 'server.js'), 'module.exports = "src";\n');
  fs.writeFileSync(path.join(dest, 'src', 'mcp', 'tool_dispatch.js'), 'module.exports = 1;\n');
  // The flat copies an earlier install pass leaves behind.
  fs.writeFileSync(serverJs, 'module.exports = "flat";\n');
  fs.mkdirSync(mcpDir, { recursive: true });
  fs.writeFileSync(mcpFile, 'module.exports = 1;\n');
}

function testFailurePreservesCopies() {
  const realSymlink = fs.symlinkSync;
  // Simulate a host where symlink creation is refused (Windows without elevation).
  fs.symlinkSync = () => {
    const err = new Error('EPERM: operation not permitted, symlink');
    err.code = 'EPERM';
    throw err;
  };
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'deploy_installer.js'))];
    const installer = require(path.join(ROOT, 'src', 'deploy_installer.js'));
    const linkedSubdirs = installer.ensureMirroredSubdirLinks(dest);
    const linkedRoots = installer.ensureMirroredRootFileLinks(dest);

    assert.deepStrictEqual([...linkedSubdirs], [], 'a refused symlink must report no link');
    assert.deepStrictEqual([...linkedRoots], [], 'a refused symlink must report no link');
  } finally {
    fs.symlinkSync = realSymlink;
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'deploy_installer.js'))];
  }

  assert.ok(fs.existsSync(serverJs), 'a refused symlink deleted server.js, a golden-seed sentinel');
  assert.ok(fs.existsSync(mcpDir), 'a refused symlink deleted the flat mcp/ directory');
  assert.ok(fs.existsSync(mcpFile), 'a refused symlink deleted a file inside the flat mcp/ directory');
  assert.ok(!fs.lstatSync(serverJs).isSymbolicLink(), 'server.js must remain a real file');
  assert.ok(fs.lstatSync(mcpDir).isDirectory(), 'mcp/ must remain a real directory');
  console.log('  ok   a refused symlink preserves the existing flat copies');

  assert.strictEqual(
    fs.readFileSync(serverJs, 'utf8'),
    'module.exports = "flat";\n',
    'a refused symlink must not alter the contents of the existing copy'
  );
  console.log('  ok   contents are unchanged');
}

function testNoStagingLeftovers() {
  const leftovers = fs.readdirSync(dest).filter(name => name.includes('konoha-link-tmp') || name.includes('konoha-link-probe'));
  assert.deepStrictEqual(leftovers, [], `failed linking left staging artefacts behind: ${leftovers.join(', ')}`);
  console.log('  ok   no staging or probe artefacts left behind');
}

console.log('Running test_mirror_link_failure_safety: mirror links must fail safe...');
try {
  buildFixture();
  testFailurePreservesCopies();
  testNoStagingLeftovers();
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log('\nAll test_mirror_link_failure_safety checks passed successfully!');
