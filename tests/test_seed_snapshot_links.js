#!/usr/bin/env node
// The Windows seed snapshot failed with
//   EEXIST: file already exists, symlink '...konoha_golden_seed\.konoha\src\agent_contract.js'
//           -> '...konoha_suite_XXXX\.konoha\agent_contract.js'
// once the installer began linking flat runtime entries into the mirrored src/
// tree: fs.cpSync recreates symlinks and `force` does not cover link creation.
// The fallback copier must produce a usable snapshot anyway.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copySeedDir } = require('./helpers/seed_snapshot');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-seed-snapshot-'));
const seed = path.join(sandbox, 'seed');

function buildSeed() {
  // A mirrored tree plus the flat links the installer now creates.
  fs.mkdirSync(path.join(seed, '.konoha', 'src', 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.konoha', 'src', 'agent_contract.js'), 'module.exports = "contract";\n');
  fs.writeFileSync(path.join(seed, '.konoha', 'src', 'mcp', 'tool_dispatch.js'), '// dispatch\n');
  fs.writeFileSync(path.join(seed, '.konoha', 'server.js'), 'require("./agent_contract");\n');
  fs.writeFileSync(path.join(seed, '.konoha', 'konoha.db'), 'db');
  fs.writeFileSync(path.join(seed, '.konoha', '.autosetup-done'), '1\n');
  fs.mkdirSync(path.join(seed, '.agents', 'skills', 'konoha'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.agents', 'skills', 'konoha', 'SKILL.md'), '---\nname: konoha\n---\n');

  // A FILE link (the entry that produced EEXIST) and a DIRECTORY link.
  fs.symlinkSync(path.join('src', 'agent_contract.js'), path.join(seed, '.konoha', 'agent_contract.js'));
  fs.symlinkSync(path.join('src', 'mcp'), path.join(seed, '.konoha', 'mcp'), 'dir');
}

function testCpSyncCollisionIsPlatformDependent() {
  // The collision that broke every Windows shard is a property of fs.cpSync and
  // varies by platform and Node build, so record it rather than assert it. The
  // assertion that matters is the next one: the copier must survive either way.
  const dest = path.join(sandbox, 'collide');
  fs.mkdirSync(path.join(dest, '.konoha'), { recursive: true });
  fs.writeFileSync(path.join(dest, '.konoha', 'agent_contract.js'), 'stale\n');
  let code = null;
  try {
    fs.cpSync(seed, dest, { recursive: true, force: true, verbatimSymlinks: true });
  } catch (err) {
    code = err.code;
  }
  console.log(code
    ? `  ok   fs.cpSync collides with ${code} here, which is why the fallback exists`
    : '  ok   fs.cpSync did not collide on this platform; the fallback copier still must not depend on it');
}

function testFallbackCopySurvivesLinks() {
  // Force the cp fallback by hiding cp from PATH: the helper tries `cp` first.
  const dest = path.join(sandbox, 'suite');
  fs.mkdirSync(dest, { recursive: true });
  const savedPath = process.env.PATH;
  process.env.PATH = path.join(sandbox, 'empty-bin');
  fs.mkdirSync(process.env.PATH, { recursive: true });
  try {
    copySeedDir(seed, dest, null);
  } finally {
    process.env.PATH = savedPath;
  }

  const sentinels = [
    ['.konoha', 'konoha.db'],
    ['.konoha', 'server.js'],
    ['.konoha', '.autosetup-done'],
    ['.agents', 'skills', 'konoha', 'SKILL.md']
  ];
  for (const parts of sentinels) {
    const target = path.join(dest, ...parts);
    assert.ok(fs.existsSync(target), `snapshot lost a seed sentinel: ${parts.join('/')}`);
  }
  console.log(`  ok   all ${sentinels.length} sentinels survive the fallback copy`);

  // The flat entry must still resolve to the mirrored file, whether it was
  // recreated as a link or materialised as a real copy.
  const flatContract = path.join(dest, '.konoha', 'agent_contract.js');
  assert.ok(fs.existsSync(flatContract), 'the flat agent_contract.js is missing from the snapshot');
  assert.strictEqual(
    fs.readFileSync(flatContract, 'utf8'),
    'module.exports = "contract";\n',
    'the flat entry must resolve to the mirrored content'
  );
  console.log('  ok   a flat linked entry resolves to its mirrored content');

  const linkedMcp = path.join(dest, '.konoha', 'mcp');
  assert.ok(
    fs.existsSync(path.join(linkedMcp, 'tool_dispatch.js')),
    'the linked mcp/ directory must resolve inside the snapshot'
  );
  console.log('  ok   a linked directory resolves inside the snapshot');
}

function testAbsoluteSeedLinksAreRepaired() {
  // Windows left the snapshot's links pointing at the seed, so a snapshot copy
  // must never keep a link that resolves outside itself. An absolute seed link is
  // the portable way to reproduce that.
  const absSeed = path.join(sandbox, 'abs-seed');
  fs.mkdirSync(path.join(absSeed, '.konoha', 'src', 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(absSeed, '.konoha', 'src', 'agent_contract.js'), 'module.exports = "contract";\n');
  fs.writeFileSync(path.join(absSeed, '.konoha', 'src', 'mcp', 'tool_dispatch.js'), '// dispatch\n');
  fs.symlinkSync(
    path.join(absSeed, '.konoha', 'src', 'agent_contract.js'),
    path.join(absSeed, '.konoha', 'agent_contract.js')
  );

  const dest = path.join(sandbox, 'abs-suite');
  fs.mkdirSync(dest, { recursive: true });
  copySeedDir(absSeed, dest, null);

  const flat = path.join(dest, '.konoha', 'agent_contract.js');
  assert.ok(fs.existsSync(flat), 'the repaired snapshot must still resolve the flat entry');
  let resolved = null;
  try {
    resolved = fs.realpathSync(flat);
  } catch (_) {
    resolved = null;
  }
  assert.ok(resolved, 'the flat entry must resolve after repair');
  // macOS reports /var as /private/var through realpath, so both sides are
  // compared in their resolved form.
  let destReal = dest;
  try {
    destReal = fs.realpathSync(dest);
  } catch (_) { /* keep the given form */ }
  const rel = path.relative(destReal, resolved);
  assert.ok(
    !rel.startsWith('..') && !path.isAbsolute(rel),
    `a snapshot link must not resolve outside the snapshot, got ${resolved}`
  );
  assert.strictEqual(
    fs.readFileSync(flat, 'utf8'),
    'module.exports = "contract";\n',
    'the repaired entry must carry the mirrored content'
  );
  console.log('  ok   an absolute seed link is repaired to resolve inside the snapshot');
}

function testNoLeftoverLinkArtifacts() {
  const dest = path.join(sandbox, 'suite');
  const stray = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // A snapshot link must resolve inside the snapshot, never back into the seed.
        const resolved = path.resolve(path.dirname(full), fs.readlinkSync(full));
        if (resolved.startsWith(seed)) stray.push(`${full} -> ${resolved}`);
        continue;
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dest);
  assert.deepStrictEqual(stray, [], `snapshot links must not point back at the seed: ${stray.join(', ')}`);
  console.log('  ok   no snapshot link points back at the seed');
}

console.log('Running test_seed_snapshot_links: a linked seed must copy without EEXIST...');
try {
  buildSeed();
  testCpSyncCollisionIsPlatformDependent();
  testFallbackCopySurvivesLinks();
  testAbsoluteSeedLinksAreRepaired();
  testNoLeftoverLinkArtifacts();
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log('\nAll test_seed_snapshot_links checks passed successfully!');
