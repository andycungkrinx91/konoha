// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const auth = require('../src/auth');
const deployUtils = require('../src/deploy_utils');
const { ensureAutoSetup } = require('../bin/lib/runtime');

async function run() {
  console.log('Running test_auto_upgrade_and_embeddings...');

  // 1. Verify auth password hashing and verification works cleanly when cwd is /tmp
  const originalCwd = process.cwd();
  try {
    const testHash = auth.hashPassword('konohagakure');
    assert.ok(testHash.hash, 'hash must be generated');

    process.chdir(os.tmpdir());
    const verifiedFromTmp = auth.verifyPasswordHash('konohagakure', testHash);
    assert.strictEqual(verifiedFromTmp, true, 'verifyPasswordHash must succeed even when process.cwd() is /tmp');

    // Verify bootstrap fallback and auto-healing in authenticate()
    const tempAuthFile = path.join(os.tmpdir(), `test_auth_${Date.now()}.json`);
    process.env.KONOHA_AUTH_FILE = tempAuthFile;
    try {
      fs.writeFileSync(tempAuthFile, JSON.stringify({
        format: 'argon2id',
        salt: 'stalesalt',
        hash: '$argon2id$v=19$m=65536,t=3,p=4$stalesalt$brokenhash',
        is_bootstrap: true,
        created_at: new Date().toISOString()
      }, null, 2), 'utf8');

      const authRes = auth.authenticate('konohagakure', '127.0.0.1');
      assert.strictEqual(authRes.success, true, 'authenticate must succeed with bootstrap password in provisioning mode');
      assert.strictEqual(authRes.isBootstrap, true, 'session must be marked as bootstrap');
      assert.strictEqual(authRes.requiresPasswordChange, true, 'session must require password change');

      const healed = JSON.parse(fs.readFileSync(tempAuthFile, 'utf8'));
      assert.strictEqual(healed.is_bootstrap, true);
      assert.ok(healed.hash !== '$argon2id$v=19$m=65536,t=3,p=4$stalesalt$brokenhash', 'stored hash must be auto-healed');
      console.log('✓ Feedback 1: Auth hashing, verification, and auto-heal verified from /tmp');
    } finally {
      try { fs.rmSync(tempAuthFile, { force: true }); } catch (_) {}
    }
  } finally {
    process.chdir(originalCwd);
  }

  // 2. Verify deployUtils.resolveWebUiDir() priority and automated build sync
  const resolvedUi = deployUtils.resolveWebUiDir();
  assert.ok(resolvedUi, 'resolveWebUiDir must find a valid Web UI directory');
  assert.ok(fs.existsSync(path.join(resolvedUi, 'build', 'handler.js')), 'resolved UI must have build/handler.js');
  console.log('✓ Feedback 2: Web UI directory resolution and packaging verified');

  // 3. Verify ensureAutoSetup() runs without crashing on bridge functions
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_setup_test_'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = tempHome;
    process.env.KONOHA_SEMANTIC_SEARCH = '0'; // Fast-path migration for unit test
    process.env.KONOHA_UI_AUTOSTART = '0';

    // Must not throw (e.g. TypeError on autoInstallKonohaBridgeExtension)
    assert.doesNotThrow(() => {
      ensureAutoSetup(true);
    }, 'ensureAutoSetup must execute cleanly without runtime bridge errors');

    console.log('✓ Feedback 3: ensureAutoSetup executes cleanly without manual intervention');
  } finally {
    process.env.HOME = origHome;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
  }

  // 4. Verify bin/commands/upgrade.js does not force --skip-embeddings
  const upgradeSrc = fs.readFileSync(path.join(__dirname, '..', 'bin', 'commands', 'upgrade.js'), 'utf8');
  assert.strictEqual(
    upgradeSrc.includes("'--skip-embeddings'"),
    false,
    'cmdUpgrade must not pass --skip-embeddings to cmdInit'
  );
  console.log('✓ Feedback 3: upgrade command does not skip neural embeddings');

  console.log('\nAll test_auto_upgrade_and_embeddings tests passed cleanly!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
