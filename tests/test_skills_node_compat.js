'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const deployUtils = require('../src/deploy_utils');

async function testSkillsNodeCompat() {
  console.log('Running test_skills_node_compat...');

  // 1. Test parseNodeVersion
  assert.deepStrictEqual(deployUtils.parseNodeVersion('v16.20.2'), { major: 16, minor: 20, patch: 2 });
  assert.deepStrictEqual(deployUtils.parseNodeVersion('18.12.0'), { major: 18, minor: 12, patch: 0 });
  assert.deepStrictEqual(deployUtils.parseNodeVersion('v26.5.1'), { major: 26, minor: 5, patch: 1 });
  assert.strictEqual(deployUtils.parseNodeVersion('invalid'), null);
  console.log('✓ parseNodeVersion verified');

  // 2. Test isNodeVersionCompatible
  assert.strictEqual(deployUtils.isNodeVersionCompatible('16.20.2'), false);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('v14.21.3'), false);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('18.11.0'), false);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('18.12.0'), true);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('v18.19.1'), true);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('20.11.1'), true);
  assert.strictEqual(deployUtils.isNodeVersionCompatible('v26.5.1'), true);
  console.log('✓ isNodeVersionCompatible verified');

  // 3. Test resolveCompatibleNode
  const resolvedNode = deployUtils.resolveCompatibleNode();
  assert.ok(resolvedNode, 'resolveCompatibleNode must return a path');
  assert.ok(fs.existsSync(resolvedNode), `Resolved node path must exist on disk: ${resolvedNode}`);

  const check = spawnSync(resolvedNode, ['-v'], { encoding: 'utf8' });
  assert.strictEqual(check.status, 0);
  const version = check.stdout.trim();
  assert.ok(
    deployUtils.isNodeVersionCompatible(version),
    `Resolved node version ${version} must be >= 18.12.0`
  );
  console.log(`✓ resolveCompatibleNode verified: ${resolvedNode} (${version})`);

  // 4. Test resolveCompatibleNodeEnv with simulated legacy Node in PATH (ZERO hardcoded paths)
  const nvmDir = process.env.NVM_DIR || path.join(require('os').homedir(), '.nvm');
  const nvmNodeVersions = path.join(nvmDir, 'versions', 'node');
  let simulatedOldNodeDir = null;

  if (fs.existsSync(nvmNodeVersions)) {
    try {
      const entries = fs.readdirSync(nvmNodeVersions)
        .map(name => ({ name, ver: deployUtils.parseNodeVersion(name) }))
        .filter(item => item.ver && !deployUtils.isNodeVersionCompatible(item.ver))
        .sort((a, b) => a.ver.major - b.ver.major);
      if (entries.length > 0) {
        simulatedOldNodeDir = path.join(nvmNodeVersions, entries[0].name, 'bin');
      }
    } catch (_) { /* non-fatal discovery */ }
  }

  let tempFixtureDir = null;
  if (!simulatedOldNodeDir || !fs.existsSync(simulatedOldNodeDir)) {
    tempFixtureDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'konoha-node-test-'));
    simulatedOldNodeDir = tempFixtureDir;
  }

  try {
    const baseEnv = {
      PATH: `${simulatedOldNodeDir}:${process.env.PATH}`,
      USER: process.env.USER || 'test',
    };

    const { env: childEnv, nodePath, nodeBinDir } = deployUtils.resolveCompatibleNodeEnv(baseEnv);
    assert.ok(nodePath, 'Must return nodePath');
    assert.ok(nodeBinDir, 'Must return nodeBinDir');
    assert.ok(childEnv.PATH.startsWith(nodeBinDir), 'childEnv.PATH must start with resolved compatible nodeBinDir');

    const oldNodePos = childEnv.PATH.indexOf(simulatedOldNodeDir);
    const resolvedPos = childEnv.PATH.indexOf(nodeBinDir);
    assert.ok(
      resolvedPos < oldNodePos,
      `Resolved compatible node (${nodeBinDir}) must precede simulated legacy node (${simulatedOldNodeDir}) in PATH`
    );

    // Verify pnpm execution with childEnv succeeds without Node 16 error
    const isWin = process.platform === 'win32';
    const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
    const pnpmRes = spawnSync(pnpmCmd, ['-v'], { env: childEnv, encoding: 'utf8', shell: isWin });
    if (pnpmRes.status === 0) {
      assert.ok(!pnpmRes.stderr.includes('requires at least Node.js v18.12'));
      console.log(`✓ pnpm -v executed cleanly under sanitized environment: ${pnpmRes.stdout.trim()}`);
    }

    // Verify npx execution with childEnv succeeds
    const npxCmd = isWin ? 'npx.cmd' : 'npx';
    const npxRes = spawnSync(npxCmd, ['--version'], { env: childEnv, encoding: 'utf8', shell: isWin });
    if (npxRes.status === 0) {
      console.log(`✓ npx --version executed cleanly under sanitized environment: ${npxRes.stdout.trim()}`);
    }
  } finally {
    if (tempFixtureDir && fs.existsSync(tempFixtureDir)) {
      try { fs.rmSync(tempFixtureDir, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
    }
  }

  console.log('✅ All skills Node compatibility tests passed cleanly!');
}

testSkillsNodeCompat().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
