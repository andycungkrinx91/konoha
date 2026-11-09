'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  runFullInstallationLifecycle,
  runTransactionalDatabaseMigration
} = require('../bin/lib/install_lifecycle');
const { collectUpgradeChoices } = require('../bin/lib/upgrade_prompts');
const { syncTemplateSkills } = require('../bin/lib/runtime_lifecycle');

function runTests() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-lifecycle-'));
  const prevKonohaHome = process.env.KONOHA_HOME;
  const konohaRoot = path.join(tmpBase, '.konoha');
  process.env.KONOHA_HOME = konohaRoot;

  try {
    const homeDir = path.join(tmpBase, 'home');
    const projectRoot = path.join(tmpBase, 'project');
    fs.mkdirSync(path.join(homeDir, '.cursor'), { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: { existing_user_server: { command: 'node', args: ['user.js'] } }
    }, null, 2));

    const stageOrder = [];
    runFullInstallationLifecycle({
      konohaRoot,
      homeDir,
      projectRoot,
      skipEmbeddings: true,
      skipUi: true,
      installStep: async () => { stageOrder.push('install'); },
      initStep: async () => { stageOrder.push('init'); }
    }).then((res) => {
      assert.strictEqual(res.ok, true, 'Full 5-stage installation lifecycle must succeed');
      assert.strictEqual(res.stages.length, 5, 'Lifecycle must execute all 5 stages');
      assert.strictEqual(res.stages[0].name, 'backup_configs');
      assert.strictEqual(res.stages[1].name, 'install_or_upgrade');
      assert.strictEqual(res.stages[2].name, 'konoha_init');
      assert.strictEqual(res.stages[3].name, 'konoha_embed_and_db_migration');
      assert.strictEqual(res.stages[4].name, 'konoha_ui_build_and_restart');
      assert.deepStrictEqual(stageOrder, ['install', 'init']);

      const dbMig = runTransactionalDatabaseMigration({ konohaRoot });
      assert.strictEqual(dbMig.ok, true);
      assert.strictEqual(
        dbMig.schemaVersion,
        dbMig.expectedSchemaVersion,
        'user_version must equal the schema version, not the app version'
      );
      assert.notStrictEqual(
        dbMig.schemaVersion,
        2218,
        'user_version must never be pinned to the 2.2.18 app version'
      );
      assert.match(dbMig.appVersion, /^\d+\.\d+\.\d+$/, 'app version is reported separately');

      // syncTemplateSkills is a real sync, not a no-op; run it against a throwaway
      // home so the assertion never depends on (or mutates) the developer's $HOME.
      const syncHome = path.join(tmpBase, 'sync-home');
      fs.mkdirSync(syncHome, { recursive: true });
      const synced = syncTemplateSkills({ home: syncHome });
      assert.ok(synced > 0, 'syncTemplateSkills must install template skills into the target home');
      assert.ok(
        fs.existsSync(path.join(syncHome, '.pi', 'agent', 'skills')),
        'template skills must land under the target home, never the real one'
      );

      return collectUpgradeChoices(['--yes']).then((choices) => {
        assert.strictEqual(choices.injectConfigs, false, 'Upgrade must never auto-inject client configs (require explicit konoha init --client=<name>)');
        console.log('PASS: test_install_lifecycle_and_db_preservation.js');
      });
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    }).finally(() => {
      if (prevKonohaHome === undefined) delete process.env.KONOHA_HOME;
      else process.env.KONOHA_HOME = prevKonohaHome;
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });
  } catch (err) {
    if (prevKonohaHome === undefined) delete process.env.KONOHA_HOME;
    else process.env.KONOHA_HOME = prevKonohaHome;
    fs.rmSync(tmpBase, { recursive: true, force: true });
    throw err;
  }
}

runTests();
