#!/usr/bin/env node
// The Windows golden seed failed for four CI runs because a 'junction' pointed at
// a FILE is created WITHOUT error on Windows and then dangles: the staging link
// "succeeded", the real server.js was deleted, fs.existsSync returned false, and
// init exited 0. The earlier safety test only covered symlinkSync THROWING, which
// is the benign case. This one covers the link that lies.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-link-dangle-'));
const dest = path.join(sandbox, 'home', '.konoha');
const srcDir = path.join(dest, 'src');

function buildFixture() {
  fs.mkdirSync(path.join(srcDir, 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'server.js'), 'module.exports = "mirror";\n');
  fs.writeFileSync(path.join(srcDir, 'mcp', 'tool_dispatch.js'), '// dispatch\n');
  // Flat copies, as syncRuntimeJsFiles leaves them before the link pass.
  fs.mkdirSync(path.join(dest, 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'server.js'), 'module.exports = "flat";\n');
  fs.writeFileSync(path.join(dest, 'mcp', 'tool_dispatch.js'), '// flat dispatch\n');
}

const realSymlinkSync = fs.symlinkSync;
const realStatSync = fs.statSync;

// Windows without Developer Mode, as the runner behaves:
//   'file'    -> EPERM (needs elevation)
//   'junction' to a FILE      -> created, but resolves to nothing
//   'junction' to a DIRECTORY -> works
function installWindowsSemantics() {
  fs.symlinkSync = function (target, p, type) {
    if (type === 'file') {
      const err = new Error('EPERM: operation not permitted, symlink');
      err.code = 'EPERM';
      throw err;
    }
    if (type === 'junction') {
      const absolute = path.resolve(path.dirname(p), target);
      let isDirectory = false;
      try { isDirectory = realStatSync(absolute).isDirectory(); } catch (_) { /* absent */ }
      if (!isDirectory) {
        // The lie: no throw, but the link points at nothing.
        return realSymlinkSync.call(fs, path.join(sandbox, 'dangling-target'), p, 'dir');
      }
    }
    return realSymlinkSync.call(fs, target, p, type);
  };
}

function restore() {
  fs.symlinkSync = realSymlinkSync;
}

function testDanglingFileJunctionKeepsTheFile() {
  installWindowsSemantics();
  const installer = require('../src/deploy_installer');
  const linked = installer.ensureMirroredRootFileLinks(dest);
  restore();

  assert.deepStrictEqual(
    [...linked], [],
    'a file junction that cannot resolve must not be reported as linked'
  );
  console.log('  ok   an unresolvable file junction reports no link');

  const serverJs = path.join(dest, 'server.js');
  assert.ok(fs.existsSync(serverJs), 'a dangling junction deleted server.js, a golden-seed sentinel');
  assert.ok(!fs.lstatSync(serverJs).isSymbolicLink(), 'server.js must remain a real file');
  assert.strictEqual(
    fs.readFileSync(serverJs, 'utf8'),
    'module.exports = "flat";\n',
    'the original copy must be byte-identical, not replaced by a broken link'
  );
  console.log('  ok   server.js survives with its original contents');
}

function testDirectoryJunctionStillLinks() {
  installWindowsSemantics();
  const installer = require('../src/deploy_installer');
  const linked = installer.ensureMirroredSubdirLinks(dest);
  restore();

  assert.ok(linked.has('mcp'), 'a directory junction works on Windows and must still be used');
  const mcpDir = path.join(dest, 'mcp');
  assert.ok(fs.lstatSync(mcpDir).isSymbolicLink(), 'mcp/ should be the link');
  assert.strictEqual(
    fs.readFileSync(path.join(mcpDir, 'tool_dispatch.js'), 'utf8'),
    '// dispatch\n',
    'the linked directory must resolve to the mirrored tree'
  );
  console.log('  ok   a working directory junction still links and resolves');
}

function testNoStagingLeftovers() {
  const leftovers = fs.readdirSync(dest)
    .filter((name) => name.includes('konoha-link-tmp') || name.includes('konoha-link-probe'));
  assert.deepStrictEqual(leftovers, [], `failed linking left staging artefacts behind: ${leftovers.join(', ')}`);
  console.log('  ok   no staging or probe artefacts left behind');
}

console.log('Running test_mirror_file_junction_safety: a link that dangles must not delete the copy...');
try {
  buildFixture();
  testDanglingFileJunctionKeepsTheFile();
  testDirectoryJunctionStillLinks();
  testNoStagingLeftovers();
} finally {
  restore();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log('\nAll test_mirror_file_junction_safety checks passed successfully!');
