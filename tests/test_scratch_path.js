#!/usr/bin/env node
'use strict';

/**
 * tests/test_scratch_path.js — Regression test: konoha must NEVER write scratch/task files inside the user's project.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../src/server');

async function run() {
  console.log('Running test_scratch_path tests...');
  const savedActiveClient = server.ACTIVE_CLIENT;
  const savedWorkspaceRoot = server.WORKSPACE_ROOT;
  const fakeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_scratch_test_workspace_'));

  try {
    server.WORKSPACE_ROOT = fakeWorkspace;
    server.ACTIVE_CLIENT = 'claudecode';

    // 1. Default task dir lives outside workspace
    const td1 = server.getResolvedTaskDir();
    assert.ok(
      !td1.startsWith(fakeWorkspace),
      `task_dir ${td1} must not be inside workspace ${fakeWorkspace}`
    );
    console.log('✓ Default task dir lives outside workspace passed');

    // 2. Default task dir lives under konoha tmp
    const expectedRoot = path.join(os.homedir(), '.konoha', 'tmp');
    assert.ok(
      td1.startsWith(expectedRoot) || td1.startsWith(path.join(os.tmpdir(), 'konoha-')) || td1.startsWith('/tmp/konoha-'),
      `task_dir ${td1} should be under ~/.konoha/tmp or tmp fallback`
    );
    console.log('✓ Default task dir lives under konoha tmp passed');

    // 3. Default task dir uses client and session subdirs
    const normalized = path.normalize(td1);
    assert.ok(normalized.includes('konoha'), `Path ${normalized} must contain konoha`);
    assert.ok(td1.includes('claudecode'), `Path ${td1} must contain active client claudecode`);
    console.log('✓ Default task dir uses client and session subdirs passed');

    // 4. Relative task dir resolves outside workspace
    const td2 = server.getResolvedTaskDir('my-task');
    assert.ok(
      !td2.startsWith(fakeWorkspace),
      `relative task_dir resolved to ${td2} which is inside workspace`
    );
    console.log('✓ Relative task dir resolves outside workspace passed');

    // 5. Existing filesystem does not get task dir under workspace
    const legacy = path.join(fakeWorkspace, 'scratch', 'tasks', 'leftover');
    fs.mkdirSync(legacy, { recursive: true });
    const td3 = server.getResolvedTaskDir();
    assert.ok(
      !td3.startsWith(fakeWorkspace),
      `resolver reused legacy workspace scratch dir: ${td3}`
    );
    console.log('✓ Existing filesystem does not get task dir under workspace passed');

    // 6. No scratch dir created under workspace
    function getDirs(dir) {
      const results = [];
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const full = path.join(dir, e.name);
          results.push(full);
          results.push(...getDirs(full));
        }
      }
      return results;
    }

    const before = new Set(getDirs(fakeWorkspace));
    server.getResolvedTaskDir();
    const after = new Set(getDirs(fakeWorkspace));
    const newDirs = [...after].filter(d => !before.has(d));
    assert.strictEqual(
      newDirs.length, 0,
      `resolver created dirs inside workspace: ${newDirs.join(', ')}`
    );
    console.log('✓ No scratch dir created under workspace passed');

    console.log('\nAll test_scratch_path tests passed!');
  } finally {
    server.ACTIVE_CLIENT = savedActiveClient;
    server.WORKSPACE_ROOT = savedWorkspaceRoot;
    fs.rmSync(fakeWorkspace, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
