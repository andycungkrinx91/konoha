'use strict';

/**
 * Test Suite: Incremental indexing correctness (`verify: 'strict'` SHA-256 default,
 * same-size restored-mtime detection, parser_version bump, force rebuild,
 * opt-in fast_stat, vanished file pruning, and Git worktree/packed-refs resolution).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-code-intel-inc-'));
process.env.HOME = tmpRoot;
process.env.USERPROFILE = tmpRoot;
process.env.KONOHA_HOME = path.join(tmpRoot, '.konoha');
process.env.KONOHA_DB_PATH = path.join(tmpRoot, 'inc.db');

const db = require('../src/db');
const store = require('../src/code_intel/store');
const { indexRepositoryAsync } = require('../src/code_intel/indexer');

function testGitWorktreeAndPackedRefs() {
  const packedRepo = path.join(tmpRoot, 'git_packed');
  fs.mkdirSync(path.join(packedRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(packedRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  const fakeSha = '1234567890abcdef1234567890abcdef12345678';
  fs.writeFileSync(
    path.join(packedRepo, '.git', 'packed-refs'),
    `# pack-refs with: peeled\n${fakeSha} refs/heads/main\n`,
    'utf8'
  );
  assert.strictEqual(store.resolveGitHeadSha(packedRepo), fakeSha, 'Should resolve SHA from packed-refs');

  const mainGit = path.join(tmpRoot, 'main_git', '.git');
  const wtGitDir = path.join(mainGit, 'worktrees', 'wt1');
  const wtWorktree = path.join(tmpRoot, 'wt1_dir');
  fs.mkdirSync(path.join(mainGit, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(wtGitDir, { recursive: true });
  fs.mkdirSync(wtWorktree, { recursive: true });
  const wtSha = 'abcdef1234567890abcdef1234567890abcdef12';
  fs.writeFileSync(path.join(mainGit, 'refs', 'heads', 'feature'), `${wtSha}\n`, 'utf8');
  fs.writeFileSync(path.join(wtGitDir, 'HEAD'), 'ref: refs/heads/feature\n', 'utf8');
  fs.writeFileSync(path.join(wtGitDir, 'commondir'), '../..\n', 'utf8');
  fs.writeFileSync(path.join(wtWorktree, '.git'), `gitdir: ${wtGitDir}\n`, 'utf8');

  assert.strictEqual(store.resolveGitHeadSha(wtWorktree), wtSha, 'Should follow worktree gitdir + commondir');
  console.log('✓ Git packed-refs and worktree gitdir/commondir resolution verified');
}

async function testIncrementalStrictAndFastStat(conn) {
  const repo = path.join(tmpRoot, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  const targetFile = path.join(repo, 'src', 'calc.js');
  const extraFile = path.join(repo, 'src', 'extra.js');
  fs.writeFileSync(targetFile, 'export function calc() { return 1111; }\n', 'utf8');
  fs.writeFileSync(extraFile, 'export const EXTRA = 42;\n', 'utf8');

  const first = await indexRepositoryAsync({ rootPath: repo, conn });
  assert.strictEqual(first.verifyMode, 'strict', 'Default mode must be verify: strict');
  assert.strictEqual(first.files, 2);
  assert.strictEqual(first.indexed, 2);

  // Unchanged re-index skips all files cleanly
  const noopRun = await indexRepositoryAsync({ rootPath: repo, conn });
  assert.strictEqual(noopRun.indexed, 0);
  assert.strictEqual(noopRun.skippedUnchanged, 2);

  // Same-size edit + restored exact mtime: strict mode MUST still detect content SHA-256 change
  const origStat = fs.statSync(targetFile);
  fs.writeFileSync(targetFile, 'export function calc() { return 2222; }\n', 'utf8');
  fs.utimesSync(targetFile, origStat.atime, origStat.mtime);

  const strictRun = await indexRepositoryAsync({ rootPath: repo, conn });
  assert.strictEqual(strictRun.verifyMode, 'strict');
  assert.strictEqual(strictRun.indexed, 1, 'Strict SHA-256 must detect same-size edit with restored mtime');
  assert.strictEqual(strictRun.skippedUnchanged, 1);
  const chunkRow = conn.prepare(
    "SELECT body FROM code_chunks WHERE root_hash = ? AND rel_path = 'src/calc.js'"
  ).get(first.rootHash);
  assert.ok(chunkRow.body.includes('2222'), 'Updated body must be stored after same-size restored-mtime edit');

  // Simulated parser_version upgrade triggers re-parse even with identical bytes
  conn.prepare("UPDATE code_files SET parser_version = 'old-parser-v0' WHERE root_hash = ? AND rel_path = 'src/extra.js'")
    .run(first.rootHash);
  const bumpRun = await indexRepositoryAsync({ rootPath: repo, conn });
  assert.strictEqual(bumpRun.indexed, 1, 'Stale parser_version must force re-parse of affected file');

  // force: true re-indexes everything cleanly
  const forceRun = await indexRepositoryAsync({ rootPath: repo, conn, force: true });
  assert.strictEqual(forceRun.indexed, 2);
  assert.strictEqual(forceRun.skippedUnchanged, 0);

  // Opt-in fast_stat reports fast_stat mode and skips matching stats
  const fastRun = await indexRepositoryAsync({ rootPath: repo, conn, verify: 'fast_stat' });
  assert.strictEqual(fastRun.verifyMode, 'fast_stat');
  assert.strictEqual(fastRun.indexed, 0);
  assert.strictEqual(fastRun.skippedUnchanged, 2);

  // Vanished file pruning removes deleted file from code_files
  fs.unlinkSync(extraFile);
  const pruneRun = await indexRepositoryAsync({ rootPath: repo, conn });
  assert.strictEqual(pruneRun.removed, 1);
  assert.strictEqual(pruneRun.files, 1);

  console.log('✓ Incremental verify=strict, restored-mtime same-size edit, parser bump, force, fast_stat, and pruning verified');
}

(async () => {
  const conn = db.getConnection();
  try {
    console.log('Running test_code_intel_incremental tests...');
    db.setupSchema(conn);
    testGitWorktreeAndPackedRefs();
    await testIncrementalStrictAndFastStat(conn);
    console.log('test_code_intel_incremental passed cleanly.');
  } catch (err) {
    console.error('test_code_intel_incremental failed:', err);
    process.exitCode = 1;
  } finally {
    conn.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})();
