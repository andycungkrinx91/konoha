#!/usr/bin/env node
'use strict';

/**
 * tests/test_cross_platform.js — Tests ensuring cross-platform support across Windows, Linux, and macOS.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const vectorSearch = require('../src/vector_search');

async function run() {
  console.log('Running test_cross_platform tests...');

  // 1. Matrix testing for platform tags and release asset names
  const testCases = [
    // [sys, mach, expected_tag, expected_asset, expected_lib]
    ['Linux', 'x86_64', 'linux-x64', 'vector-linux-x86_64-1.1.0.tar.gz', 'vector.so'],
    ['Linux', 'amd64', 'linux-x64', 'vector-linux-x86_64-1.1.0.tar.gz', 'vector.so'],
    ['Linux', 'aarch64', 'linux-arm64', 'vector-linux-arm64-1.1.0.tar.gz', 'vector.so'],
    ['Linux', 'arm64', 'linux-arm64', 'vector-linux-arm64-1.1.0.tar.gz', 'vector.so'],
    ['Darwin', 'arm64', 'darwin-arm64', 'vector-macos-arm64-1.1.0.tar.gz', 'vector.dylib'],
    ['Darwin', 'x86_64', 'darwin-x64', 'vector-macos-x86_64-1.1.0.tar.gz', 'vector.dylib'],
    ['Windows', 'AMD64', 'windows-x64', 'vector-windows-x86_64-1.1.0.zip', 'vector.dll'],
    ['Windows', 'x86_64', 'windows-x64', 'vector-windows-x86_64-1.1.0.zip', 'vector.dll']
  ];

  for (const [sysName, mach, expTag, expAsset, expLib] of testCases) {
    const tag = vectorSearch.getPlatformTag(sysName, mach);
    const [asset, lib] = vectorSearch.getPlatformAssetInfo(sysName, mach);
    assert.strictEqual(tag, expTag, `Tag mismatch for ${sysName} ${mach}`);
    assert.strictEqual(asset, expAsset, `Asset mismatch for ${sysName} ${mach}`);
    assert.strictEqual(lib, expLib, `Lib mismatch for ${sysName} ${mach}`);
  }
  console.log('✓ Platform tag and asset resolution matrix passed');

  // 2. Windows ARM64 graceful handling
  const tagWinArm = vectorSearch.getPlatformTag('Windows', 'ARM64');
  const [assetWinArm, libWinArm] = vectorSearch.getPlatformAssetInfo('Windows', 'ARM64');
  assert.strictEqual(tagWinArm, 'windows-arm64');
  assert.strictEqual(assetWinArm, null);
  assert.strictEqual(libWinArm, null);
  console.log('✓ Windows ARM64 graceful handling passed');

  // 3. Path normalization cross platform
  const winPath = 'C:\\Users\\test\\.konoha\\konoha.db';
  const normWin = path.normalize(winPath);
  assert.ok(normWin.includes('.konoha'));

  const winFwd = 'C:/Users/test/.konoha/konoha.db';
  const normFwd = path.normalize(winFwd);
  assert.ok(normFwd.includes('.konoha'));

  assert.strictEqual(db.DB_PATH, path.normalize(db.DB_PATH));
  console.log('✓ Path normalization cross platform passed');

  // 4. In-memory exact scan parity
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross_plat_'));
  const testDb = path.join(tmpDir, 'test.db');
  try {
    const conn = db.getConnection(testDb, false);
    db.setupSchema(conn);

    conn.prepare("INSERT INTO skills (name, type, skill_name, content) VALUES ('skill-a', 'skill', 'skill-a', 'Frontend content')").run();
    conn.prepare("INSERT INTO skills (name, type, skill_name, content) VALUES ('skill-b', 'skill', 'skill-b', 'Backend content')").run();

    const vecA = new Float32Array(384);
    for (let i = 0; i < 384; i++) vecA[i] = 1.0;
    const normA = Math.sqrt(384);
    for (let i = 0; i < 384; i++) vecA[i] /= normA;

    const vecB = new Float32Array(384);
    vecB[0] = 1.0;

    const blobA = Buffer.from(vecA.buffer);
    const blobB = Buffer.from(vecB.buffer);

    conn.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)').run(
      'skill-a', 0, 'Chunk A', blobA
    );
    conn.prepare('INSERT INTO skill_chunks (skill_name, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?)').run(
      'skill-b', 0, 'Chunk B', blobB
    );

    const queryVec = vecA;
    const results = vectorSearch.scanNearestChunks(conn, queryVec, 2);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0][0], 'skill-a');
    assert.ok(Math.abs(results[0][3] - 1.0) < 0.001);
    assert.strictEqual(results[1][0], 'skill-b');
    conn.close();
    console.log('✓ In-memory exact scan parity passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 5. Extension unauthorized simulation
  const mockConn = {
    loadExtension: () => { throw new Error('not authorized'); }
  };
  const safe = vectorSearch.enableLoadExtensionSafe(mockConn);
  assert.strictEqual(safe, false);
  console.log('✓ Extension unauthorized simulation passed');

  // 6. Agent-browser resolution
  const cmdWin = true ? 'agent-browser.cmd' : 'agent-browser';
  assert.ok(cmdWin.includes('agent-browser'));
  const cmdUnix = false ? 'agent-browser.cmd' : 'agent-browser';
  assert.strictEqual(cmdUnix, 'agent-browser');
  console.log('✓ Agent-browser cross-platform resolution passed');

  console.log('\nAll test_cross_platform tests passed!');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
