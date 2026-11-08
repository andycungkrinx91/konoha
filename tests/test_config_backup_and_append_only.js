'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  SUPPORTED_CLIENTS,
  getClientConfigMap,
  backupConfigFile,
  ensureBackupBeforeModify,
  formatBackupSummaryLines,
  verifyBackupIntegrity,
  backupClientConfigs,
  backupAllDetectedClients,
  listClientBackups,
  restoreLatestClientBackups,
  recordOwnership,
  loadOwnershipManifest,
  restoreFromBackupSnapshot,
  getBackupRoot
} = require('../src/config_backup_manager');
const { executePreInstallBackup } = require('../bin/lib/install_lifecycle');
const { parseRequestedClients } = require('../bin/commands/init_clients');

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

    // Verify standard --client=<name> parsing for all 8 clients + all
    assert.strictEqual(parseRequestedClients([]), null, 'Bare init without --client must return null');
    for (const c of ['cursor', 'claude', 'opencode', 'omp', 'codex', 'pi', 'antigravity', 'commandcode', 'all']) {
      assert.deepStrictEqual(parseRequestedClients([`--client=${c}`]), [c]);
    }

    // Verify client-scoped backup, listing, and latest restore (global + project)
    const cursorGlobalMcp = path.join(homeDir, '.cursor', 'mcp.json');
    const cursorProjectMcp = path.join(projDir, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(cursorGlobalMcp), { recursive: true });
    fs.mkdirSync(path.dirname(cursorProjectMcp), { recursive: true });
    fs.writeFileSync(cursorGlobalMcp, JSON.stringify({ mcpServers: { old_global: { command: 'node' } } }, null, 2));
    fs.writeFileSync(cursorProjectMcp, JSON.stringify({ mcpServers: { old_project: { command: 'node' } } }, null, 2));

    const cursorBakRes = backupClientConfigs('cursor', { home: homeDir, projectRoot: projDir, scope: 'all' });
    assert.strictEqual(cursorBakRes.ok, true);
    assert.strictEqual(cursorBakRes.backedUpCount, 2, 'Both global and project cursor mcp.json must be backed up');

    mergeJsonConfigAppendOnly(cursorGlobalMcp, { mcpServers: { konoha: { command: 'node' } } }, { client: 'cursor', scope: 'global' });
    mergeJsonConfigAppendOnly(cursorProjectMcp, { mcpServers: { konoha: { command: 'node' } } }, { client: 'cursor', scope: 'project' });
    assert.ok(JSON.parse(fs.readFileSync(cursorGlobalMcp, 'utf8')).mcpServers.old_global, 'Global old config preserved on append');
    assert.ok(JSON.parse(fs.readFileSync(cursorProjectMcp, 'utf8')).mcpServers.old_project, 'Project old config preserved on append');

    const listedBackups = listClientBackups({ client: 'cursor', scope: 'all' });
    assert.ok(listedBackups.length >= 2, 'listClientBackups must list both global and project cursor backups');

    const latestRestore = restoreLatestClientBackups({ client: 'cursor', scope: 'all' });
    assert.strictEqual(latestRestore.ok, true);
    assert.ok(latestRestore.restoredCount >= 2, 'restoreLatestClientBackups must restore both global and project files');

    // =========================================================================
    // Workstream E — All 14 Mandatory Automatic Global Backup Scenarios
    // =========================================================================

    // Scenario 7: Missing configuration files on a fresh system handled cleanly
    const freshMissingRes = ensureBackupBeforeModify(path.join(homeDir, '.nonexistent_client', 'settings.json'), {
      client: 'claude',
      scope: 'global',
      home: homeDir
    });
    assert.strictEqual(freshMissingRes.ok, true, 'Missing config file on fresh system must succeed');
    assert.strictEqual(freshMissingRes.existed, false, 'Missing config file must report existed: false');
    assert.strictEqual(freshMissingRes.backedUp, false, 'Missing config file must report backedUp: false');
    assert.strictEqual(freshMissingRes.verified, true, 'Missing config file must report verified: true');

    // Scenario 1, 6, 9, 10, 14: Seed global settings.json & configs across all 8 clients + cross-platform Cursor paths
    const secretMarker = 'sk-ant-super-secret-do-not-print-99999';
    const seededGlobalFiles = [
      { client: 'antigravity', rel: '.gemini/antigravity/settings.json', content: JSON.stringify({ permissionMode: 'strict', confirmDangerousCommands: true, apiKey: secretMarker }, null, 2) },
      { client: 'antigravity', rel: '.gemini/settings.json', content: JSON.stringify({ theme: 'dark', apiKey: secretMarker }, null, 2) },
      { client: 'cursor', rel: '.cursor/settings.json', content: JSON.stringify({ cursorCustom: true, token: secretMarker }, null, 2) },
      { client: 'cursor', rel: '.config/Cursor/User/settings.json', content: JSON.stringify({ linuxCursorSetting: 'keep' }, null, 2) },
      { client: 'cursor', rel: 'Library/Application Support/Cursor/User/settings.json', content: JSON.stringify({ macCursorSetting: 'keep' }, null, 2) },
      { client: 'cursor', rel: 'AppData/Roaming/Cursor/User/settings.json', content: JSON.stringify({ winCursorSetting: 'keep' }, null, 2) },
      { client: 'claude', rel: '.claude/settings.json', content: JSON.stringify({ permissions: { allow: ['UserCustomTool'] }, env: { ANTHROPIC_API_KEY: secretMarker } }, null, 2) },
      { client: 'opencode', rel: '.config/opencode/settings.json', content: JSON.stringify({ opencodeSetting: 'keep' }, null, 2) },
      { client: 'commandcode', rel: '.commandcode/settings.json', content: JSON.stringify({ commandcodeSetting: 'keep' }, null, 2) },
      { client: 'codex', rel: '.codex/settings.json', content: JSON.stringify({ codexSetting: 'keep' }, null, 2) },
      { client: 'pi', rel: '.pi/agent/settings.json', content: JSON.stringify({ packages: ['custom-pi-pkg'], secret: secretMarker }, null, 2) },
      { client: 'omp', rel: '.omp/agent/settings.json', content: JSON.stringify({ ompSetting: 'keep' }, null, 2) }
    ];

    for (const item of seededGlobalFiles) {
      const target = path.join(homeDir, item.rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.content, 'utf8');
    }

    // Verify getClientConfigMap covers all 8 clients + cross-platform Cursor User/settings.json
    const configMap = getClientConfigMap({ home: homeDir, projectRoot: projDir });
    assert.strictEqual(SUPPORTED_CLIENTS.length, 8, 'Must support all 8 coding-agent clients');
    for (const client of SUPPORTED_CLIENTS) {
      assert.ok(Array.isArray(configMap[client].global) && configMap[client].global.length > 0, `Client ${client} must have global config paths`);
      assert.ok(
        configMap[client].global.some((p) => p.endsWith('settings.json')),
        `Client ${client} global config map must include settings.json`
      );
    }
    assert.ok(
      configMap.cursor.global.some((p) => p.includes(path.join('.config', 'Cursor', 'User', 'settings.json'))),
      'Cursor global config map must include Linux User/settings.json'
    );
    assert.ok(
      configMap.cursor.global.some((p) => p.includes(path.join('Library', 'Application Support', 'Cursor', 'User', 'settings.json'))),
      'Cursor global config map must include macOS User/settings.json'
    );
    assert.ok(
      configMap.cursor.global.some((p) => p.includes(path.join('AppData', 'Roaming', 'Cursor', 'User', 'settings.json'))),
      'Cursor global config map must include Windows User/settings.json'
    );

    // Scenario 1, 2, 5: executePreInstallBackup (used by init, upgrade, migrate) backs up all 8 clients automatically
    const preInstallSummary = executePreInstallBackup({ home: homeDir, projectRoot: projDir });
    assert.strictEqual(preInstallSummary.ok, true, 'executePreInstallBackup must succeed across all 8 clients');
    assert.ok(preInstallSummary.totalBackedUp >= seededGlobalFiles.length, 'All seeded global settings.json files must be backed up');

    for (const client of SUPPORTED_CLIENTS) {
      const clientEntries = (preInstallSummary.backups || []).filter((b) => b.client === client && b.backedUp);
      assert.ok(clientEntries.length >= 1, `Client ${client} must have at least 1 backed up global file`);
      for (const entry of clientEntries) {
        // Scenario 6: Separate per-client backup directory
        assert.ok(entry.backupPath.includes(path.join(client, entry.scope)), `Backup path ${entry.backupPath} must be isolated under ${client}/${entry.scope}`);
        // Scenario 9: Byte-for-byte + SHA-256 verification
        const verifyRes = verifyBackupIntegrity(entry.sourcePath, entry.backupPath);
        assert.strictEqual(verifyRes.ok, true, `SHA-256 integrity check must pass for ${entry.sourcePath}`);
        assert.strictEqual(
          fs.readFileSync(entry.backupPath, 'utf8'),
          fs.readFileSync(entry.sourcePath, 'utf8'),
          `Backup content must match original byte-for-byte for ${entry.sourcePath}`
        );
        // Scenario 10: Restrictive permissions (0600 on POSIX)
        if (process.platform !== 'win32') {
          const mode = fs.statSync(entry.backupPath).mode & 0o777;
          assert.strictEqual(mode, 0o600, `Backup file ${entry.backupPath} must have 0600 permissions`);
        }
      }
    }

    // Scenario 10 (privacy): formatBackupSummaryLines must never print secret values from settings.json
    const summaryLines = formatBackupSummaryLines(preInstallSummary).join('\n');
    assert.ok(summaryLines.includes('[Backup]'), 'Summary lines must report backup status');
    assert.ok(!summaryLines.includes(secretMarker), 'Summary output must NEVER leak secret values from settings.json');

    // Scenario 2 & 8: Upgrade / repeated backup creates new timestamped collision-safe backup without overwriting earlier backup
    const claudeSettingsPath = path.join(homeDir, '.claude', 'settings.json');
    const firstClaudeEntry = listClientBackups({ client: 'claude', scope: 'global', home: homeDir })
      .find((b) => path.resolve(b.sourcePath) === path.resolve(claudeSettingsPath));
    assert.ok(firstClaudeEntry && firstClaudeEntry.backupCount >= 1, 'Claude settings.json must have at least 1 backup');
    const initialBackupCount = firstClaudeEntry.backupCount;

    const upgradeBackupSummary = executePreInstallBackup({ home: homeDir, projectRoot: projDir });
    assert.strictEqual(upgradeBackupSummary.ok, true, 'Upgrade pre-install backup must succeed');
    const secondClaudeEntry = listClientBackups({ client: 'claude', scope: 'global', home: homeDir })
      .find((b) => path.resolve(b.sourcePath) === path.resolve(claudeSettingsPath));
    assert.ok(secondClaudeEntry.backupCount > initialBackupCount, 'Upgrade must create a new distinct timestamped backup');

    // Scenario 3, 4, 13: Update, reinstall, and --force preserve user settings, unrelated agents/, conversations/, hooks, and extensions
    const userConversationsDir = path.join(homeDir, '.gemini', 'antigravity', 'conversations');
    const userCustomAgentFile = path.join(homeDir, '.claude', 'agents', 'my-custom-user-agent.md');
    fs.mkdirSync(userConversationsDir, { recursive: true });
    fs.writeFileSync(path.join(userConversationsDir, 'conv-1.json'), '{"id":"conv-1"}', 'utf8');
    fs.mkdirSync(path.dirname(userCustomAgentFile), { recursive: true });
    fs.writeFileSync(userCustomAgentFile, '# Custom User Agent\nDo not delete.\n', 'utf8');

    const { ensureClaudeCodeSetup } = require('../src/mcp_clients/claude_code');
    const { ensurePiSetup } = require('../src/pi_manager');
    ensureClaudeCodeSetup({ home: homeDir, konohaHome: process.env.KONOHA_HOME, silent: true, force: true });
    ensureClaudeCodeSetup({ home: homeDir, konohaHome: process.env.KONOHA_HOME, silent: true, force: true });
    ensurePiSetup({ home: homeDir, konohaHome: process.env.KONOHA_HOME, silent: true, force: true });

    const claudeAfterForce = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
    assert.ok(claudeAfterForce.permissions.allow.includes('UserCustomTool'), 'Force setup must preserve user permission grants');
    assert.strictEqual(claudeAfterForce.env.ANTHROPIC_API_KEY, secretMarker, 'Force setup must preserve user env vars in settings.json');
    assert.ok(fs.existsSync(path.join(userConversationsDir, 'conv-1.json')), 'User conversations/ must remain untouched');
    assert.ok(fs.existsSync(userCustomAgentFile), 'Unrelated user custom agent must remain untouched');

    const piSettingsPath = path.join(homeDir, '.pi', 'agent', 'settings.json');
    const piAfterForce = JSON.parse(fs.readFileSync(piSettingsPath, 'utf8'));
    assert.ok(piAfterForce.packages.includes('custom-pi-pkg'), 'Pi force setup must preserve user packages');
    assert.strictEqual(piAfterForce.secret, secretMarker, 'Pi force setup must preserve user keys in settings.json');

    // Scenario 5: Migration / agent deployment backs up existing agents.yaml before modifying
    const customAgentsYaml = path.join(homeDir, '.agents', 'agents.yaml');
    fs.mkdirSync(path.dirname(customAgentsYaml), { recursive: true });
    fs.writeFileSync(customAgentsYaml, '# User customized agents.yaml\nversion: 1\n', 'utf8');
    const bakAgents = ensureBackupBeforeModify(customAgentsYaml, { client: 'antigravity', scope: 'global', home: homeDir });
    assert.strictEqual(bakAgents.ok, true, 'Custom agents.yaml must be backed up');
    assert.strictEqual(bakAgents.backedUp, true);
    const agyYamlEntry = listClientBackups({ client: 'antigravity', scope: 'global', home: homeDir })
      .find((b) => path.resolve(b.sourcePath) === path.resolve(customAgentsYaml));
    assert.ok(agyYamlEntry && agyYamlEntry.backupCount >= 1, 'agents.yaml backup must be tracked');

    // Scenario 11: Simulated backup failure and broken symlink targets abort fail-closed BEFORE mutating original file
    const beforeFailContent = fs.readFileSync(claudeSettingsPath, 'utf8');
    assert.throws(
      () => ensureBackupBeforeModify(claudeSettingsPath, {
        client: 'claude',
        scope: 'global',
        home: homeDir,
        simulateBackupFailure: true
      }),
      /Simulated backup.*failure/i,
      'simulateBackupFailure must throw and abort configuration modification'
    );
    assert.strictEqual(
      fs.readFileSync(claudeSettingsPath, 'utf8'),
      beforeFailContent,
      'Original settings.json must remain 100% unchanged when backup fails'
    );

    assert.throws(
      () => executePreInstallBackup({ home: homeDir, projectRoot: projDir, simulateBackupFailure: true }),
      /Simulated backup.*failure|Pre-install automatic configuration backup failed/i,
      'executePreInstallBackup must abort fail-closed when any backup fails'
    );

    if (process.platform !== 'win32') {
      const brokenSymlinkPath = path.join(homeDir, '.claude', 'broken_settings.json');
      fs.symlinkSync(path.join(homeDir, '.claude', 'does_not_exist_target.json'), brokenSymlinkPath);
      assert.throws(
        () => ensureBackupBeforeModify(brokenSymlinkPath, { client: 'claude', scope: 'global', home: homeDir }),
        /broken symlink/,
        'Broken symlink config target must fail closed before modification'
      );
      fs.unlinkSync(brokenSymlinkPath);
    }

    // Scenario 12: Restore original configuration byte-for-byte from initial backup
    const earliestClaudeSettingBackup = firstClaudeEntry.backups[0];
    const restoreClaudeRes = restoreFromBackupSnapshot(earliestClaudeSettingBackup, claudeSettingsPath);
    assert.strictEqual(restoreClaudeRes.ok, true, 'restoreFromBackupSnapshot must succeed for Claude settings.json');
    const restoredClaudeObj = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
    assert.deepStrictEqual(restoredClaudeObj.permissions.allow, ['UserCustomTool'], 'Restored Claude settings.json must match original pre-Konoha state');

    console.log('PASS: test_config_backup_and_append_only.js');
  } finally {
    if (prevKonohaHome === undefined) delete process.env.KONOHA_HOME;
    else process.env.KONOHA_HOME = prevKonohaHome;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests();
