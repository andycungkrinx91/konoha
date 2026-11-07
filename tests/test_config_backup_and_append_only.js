'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  backupConfigFile,
  verifyBackupIntegrity,
  backupAllDetectedClients,
  recordOwnership,
  loadOwnershipManifest,
  restoreFromBackupSnapshot,
  getBackupRoot
} = require('../src/config_backup_manager');

const {
  mergeJsonConfigAppendOnly,
  mergeTomlConfigAppendOnly,
  mergeYamlConfigAppendOnly,
  mergeXmlConfigAppendOnly,
  mergePlainTextAppendOnly,
  removeKonohaOwnedEntries
} = require('../src/config_merger');

function runTests() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-backup-'));
  const prevKonohaHome = process.env.KONOHA_HOME;
  process.env.KONOHA_HOME = path.join(tmpBase, '.konoha');

  try {
    const homeDir = path.join(tmpBase, 'home');
    const projDir = path.join(tmpBase, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projDir, { recursive: true });

    const agySettings = path.join(homeDir, '.gemini', 'antigravity', 'settings.json');
    fs.mkdirSync(path.dirname(agySettings), { recursive: true });
    fs.writeFileSync(agySettings, JSON.stringify({
      permissionMode: 'strict',
      confirmDangerousCommands: true,
      customTheme: 'solarized',
      hooks: {
        BeforeTool: [{ matcher: 'custom.*', hooks: [{ type: 'command', command: 'echo user-hook' }] }]
      }
    }, null, 2));

    const b1 = backupConfigFile(agySettings, { client: 'antigravity', scope: 'global' });
    assert.strictEqual(b1.ok, true, 'First backup must succeed');
    assert.strictEqual(b1.backedUp, true, 'Existing file must be backed up');
    assert.ok(b1.backupPath.startsWith(getBackupRoot()), 'Backup must reside under ~/.konoha/backups/configs');
    assert.ok(b1.backupPath.includes(path.join('antigravity', 'global')), 'Backup must be separated by client and scope');

    const b2 = backupConfigFile(agySettings, { client: 'antigravity', scope: 'global' });
    assert.strictEqual(b2.ok, true, 'Second rapid backup must succeed without collision');
    assert.notStrictEqual(b1.backupPath, b2.backupPath, 'Collision-safe backup filenames must be unique');

    const badVerify = verifyBackupIntegrity(agySettings, path.join(tmpBase, 'nonexistent.bak'));
    assert.strictEqual(badVerify.ok, false, 'Missing or mismatched backup must fail verification');

    const jsonMerge = mergeJsonConfigAppendOnly(agySettings, {
      mcpServers: {
        konoha: { command: 'node', args: ['server.js'] },
        semble: { command: 'uvx', args: ['semble'] }
      },
      hooks: {
        BeforeTool: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node ~/.konoha/antigravity_tool_sanitize_hook.js' }] }]
      }
    }, { client: 'antigravity', scope: 'global' });

    assert.strictEqual(jsonMerge.ok, true, 'JSON append-only merge must succeed');
    const mergedJson = JSON.parse(fs.readFileSync(agySettings, 'utf8'));
    assert.strictEqual(mergedJson.permissionMode, 'strict', 'permissionMode must NEVER be deleted');
    assert.strictEqual(mergedJson.confirmDangerousCommands, true, 'confirmDangerousCommands must NEVER be deleted');
    assert.strictEqual(mergedJson.customTheme, 'solarized', 'Unrelated user keys must be preserved');
    assert.strictEqual(mergedJson.hooks.BeforeTool.length, 2, 'Both user hook and Konoha hook must exist');

    const jsonMerge2 = mergeJsonConfigAppendOnly(agySettings, {
      mcpServers: {
        konoha: { command: 'node', args: ['server.js'] },
        semble: { command: 'uvx', args: ['semble'] }
      },
      hooks: {
        BeforeTool: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node ~/.konoha/antigravity_tool_sanitize_hook.js' }] }]
      }
    }, { client: 'antigravity', scope: 'global' });
    assert.strictEqual(jsonMerge2.ok, true);
    const mergedJsonAfterRepeat = JSON.parse(fs.readFileSync(agySettings, 'utf8'));
    assert.strictEqual(mergedJsonAfterRepeat.hooks.BeforeTool.length, 2, 'Repeated merge must be idempotent with 0 duplicate hooks');

    const codexToml = path.join(homeDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(codexToml), { recursive: true });
    fs.writeFileSync(codexToml, [
      'model = "gpt-5"',
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      '',
      '[mcp_servers.user_custom]',
      'command = "custom-mcp"',
      ''
    ].join('\n'));

    const tomlRes = mergeTomlConfigAppendOnly(codexToml, [
      { header: '[mcp_servers.konoha]', body: 'command = "node"\nargs = ["server.js"]' }
    ], { client: 'codex', scope: 'global', keysOwned: ['mcp_servers.konoha'] });
    assert.strictEqual(tomlRes.ok, true, 'TOML merge must succeed');
    const mergedToml = fs.readFileSync(codexToml, 'utf8');
    assert.ok(mergedToml.includes('sandbox_mode = "workspace-write"'), 'User TOML sandbox_mode must be preserved');
    assert.ok(mergedToml.includes('approval_policy = "on-request"'), 'User TOML approval_policy must be preserved');
    assert.ok(mergedToml.includes('[mcp_servers.user_custom]'), 'User TOML sections must be preserved');
    assert.ok(mergedToml.includes('[mcp_servers.konoha]'), 'Konoha TOML section must be appended');

    const yamlPath = path.join(projDir, 'config.yaml');
    fs.writeFileSync(yamlPath, 'user_setting: keep_me\n');
    const yamlRes = mergeYamlConfigAppendOnly(yamlPath, 'konoha_enabled: true', {
      client: 'opencode',
      scope: 'project',
      keysOwned: ['konoha_enabled']
    });
    assert.strictEqual(yamlRes.ok, true);
    const yamlText = fs.readFileSync(yamlPath, 'utf8');
    assert.ok(yamlText.includes('user_setting: keep_me'));
    assert.ok(yamlText.includes('konoha_enabled: true'));

    const xmlPath = path.join(projDir, 'settings.xml');
    fs.writeFileSync(xmlPath, '<configuration>\n  <userNode>preserved</userNode>\n</configuration>\n');
    const xmlRes = mergeXmlConfigAppendOnly(xmlPath, '<konohaNode>enabled</konohaNode>', {
      client: 'antigravity',
      scope: 'project'
    });
    assert.strictEqual(xmlRes.ok, true);
    const xmlText = fs.readFileSync(xmlPath, 'utf8');
    assert.ok(xmlText.includes('<userNode>preserved</userNode>'));
    assert.ok(xmlText.includes('<konohaNode>enabled</konohaNode>'));

    const mdPath = path.join(projDir, 'AGENTS.md');
    fs.writeFileSync(mdPath, '# My Custom Project Rules\n\nAlways keep my custom lint rule.\n');
    const mdRes = mergePlainTextAppendOnly(mdPath, '# Konoha Managed Rules\nUse konoha MCP.', {
      client: 'cursor',
      scope: 'project'
    });
    assert.strictEqual(mdRes.ok, true);
    const mdText = fs.readFileSync(mdPath, 'utf8');
    assert.ok(mdText.includes('# My Custom Project Rules'));
    assert.ok(mdText.includes('Always keep my custom lint rule.'));
    assert.ok(mdText.includes('<!-- KONOHA-START -->'));

    const currentSettings = JSON.parse(fs.readFileSync(agySettings, 'utf8'));
    currentSettings.userAddedAfterInstall = 'must-survive-uninstall';
    fs.writeFileSync(agySettings, JSON.stringify(currentSettings, null, 2));

    removeKonohaOwnedEntries(agySettings, { client: 'antigravity', scope: 'global' });
    const afterUninstallJson = JSON.parse(fs.readFileSync(agySettings, 'utf8'));
    assert.strictEqual(afterUninstallJson.userAddedAfterInstall, 'must-survive-uninstall', 'Post-install user edits must survive Konoha removal');
    assert.strictEqual(afterUninstallJson.customTheme, 'solarized', 'Original user keys must survive Konoha removal');
    assert.strictEqual(afterUninstallJson.mcpServers?.konoha, undefined, 'Konoha MCP entry must be removed');
    assert.strictEqual(afterUninstallJson.hooks.BeforeTool.length, 1, 'Only user hook must remain after Konoha removal');

    removeKonohaOwnedEntries(mdPath, { client: 'cursor', scope: 'project' });
    const afterMdUninstall = fs.readFileSync(mdPath, 'utf8');
    assert.ok(afterMdUninstall.includes('Always keep my custom lint rule.'), 'User markdown must remain intact');
    assert.ok(!afterMdUninstall.includes('<!-- KONOHA-START -->'), 'Konoha block must be cleanly removed');

    recordOwnership(agySettings, { client: 'antigravity', scope: 'global', keysOwned: ['mcpServers.konoha'] });
    const manifest = loadOwnershipManifest();
    assert.ok(manifest.files[path.resolve(agySettings)], 'Ownership manifest must track target file');

    const allBackups = backupAllDetectedClients({ homeDir, projectRoot: projDir });
    assert.strictEqual(allBackups.ok, true, 'backupAllDetectedClients must succeed across all 8 clients');

    const restoreRes = restoreFromBackupSnapshot(b1.backupPath, agySettings);
    assert.strictEqual(restoreRes.ok, true, 'restoreFromBackupSnapshot must succeed');

    console.log('PASS: test_config_backup_and_append_only.js');
  } finally {
    if (prevKonohaHome === undefined) delete process.env.KONOHA_HOME;
    else process.env.KONOHA_HOME = prevKonohaHome;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests();
