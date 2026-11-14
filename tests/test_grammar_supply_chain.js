'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GRAMMARS_DIR,
  LOCKFILE_PATH,
  LICENSES_PATH,
  verifyGrammars
} = require('../scripts/build_grammars');

const REQUIRED_LANGUAGES = [
  'javascript',
  'typescript',
  'tsx',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'bash',
  'sql'
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function testLockfileAndRuntimeParity() {
  assert.ok(fs.existsSync(LOCKFILE_PATH), 'grammars.lock.json must exist');
  assert.ok(fs.existsSync(LICENSES_PATH), 'THIRD_PARTY_LICENSES.txt must exist');

  const lock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, 'utf8'));
  assert.equal(lock.schema_version, 1, 'Expected schema_version 1');
  assert.equal(lock.runtime.license, 'MIT', 'Runtime license must be MIT');

  const bundledRuntimePath = path.join(GRAMMARS_DIR, lock.runtime.file);
  const pkgRuntimePath = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
  assert.equal(
    sha256(bundledRuntimePath),
    sha256(pkgRuntimePath),
    'Bundled assets/grammars/tree-sitter.wasm must match installed web-tree-sitter.wasm'
  );

  const lockedLangs = lock.grammars.map((g) => g.language);
  assert.deepEqual(
    [...lockedLangs].sort(),
    [...REQUIRED_LANGUAGES].sort(),
    'grammars.lock.json must lock all 11 required languages'
  );

  for (const g of lock.grammars) {
    assert.equal(g.license, 'MIT', `${g.language} must be MIT licensed`);
    assert.match(g.commit_sha, /^[0-9a-f]{40}$/, `${g.language} commit_sha must be 40 hex chars`);
    assert.match(g.wasm_sha256, /^[0-9a-f]{64}$/, `${g.language} wasm_sha256 must be 64 hex chars`);
    assert.ok(
      g.abi_version >= lock.runtime.min_compatible_version && g.abi_version <= lock.runtime.language_version,
      `${g.language} ABI ${g.abi_version} outside runtime range ${lock.runtime.min_compatible_version}..${lock.runtime.language_version}`
    );
  }
}

async function testOfflineVerifyAndTamperRejection() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Network fetch is forbidden during offline verifyGrammars()');
  };
  try {
    const verified = await verifyGrammars({ grammarsDir: GRAMMARS_DIR });
    assert.equal(verified.ok, true);
    assert.equal(verified.verifiedCount, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_grammar_tamper_'));
  try {
    fs.cpSync(GRAMMARS_DIR, tmpDir, { recursive: true });
    const okCopy = await verifyGrammars({ grammarsDir: tmpDir });
    assert.equal(okCopy.verifiedCount, 11);

    // Corrupt 1 byte in tree-sitter-sql.wasm -> must reject by SHA-256
    const sqlPath = path.join(tmpDir, 'tree-sitter-sql.wasm');
    const sqlBuf = fs.readFileSync(sqlPath);
    sqlBuf[sqlBuf.length - 1] ^= 0xff;
    fs.writeFileSync(sqlPath, sqlBuf);
    await assert.rejects(
      () => verifyGrammars({ grammarsDir: tmpDir }),
      /SHA-256 mismatch for tree-sitter-sql\.wasm/
    );

    // Restore SQL WASM, then tamper license metadata to GPL -> must reject non-MIT license
    fs.copyFileSync(path.join(GRAMMARS_DIR, 'tree-sitter-sql.wasm'), sqlPath);
    const lockCopyPath = path.join(tmpDir, 'grammars.lock.json');
    const lockCopy = JSON.parse(fs.readFileSync(lockCopyPath, 'utf8'));
    lockCopy.grammars[0].license = 'GPL-3.0';
    fs.writeFileSync(lockCopyPath, JSON.stringify(lockCopy, null, 2));
    await assert.rejects(
      () => verifyGrammars({ grammarsDir: tmpDir }),
      /Forbidden non-MIT license/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function main() {
  await testLockfileAndRuntimeParity();
  await testOfflineVerifyAndTamperRejection();
  console.log('test_grammar_supply_chain passed (11 MIT WASMs locked, verified offline, tamper checks enforced)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
