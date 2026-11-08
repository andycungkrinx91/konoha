'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { HOME, SKILLS_DB_DIR, MIGRATE_PATH, INSTALL_BUILD_MIGRATE_TIMEOUT_MS } = require('./paths');
const {
  backupAllDetectedClients,
  verifyBackupIntegrity,
  formatBackupSummaryLines,
  restoreFromBackupSnapshot
} = require('../../src/config_backup_manager');

function getKonohaRoot() {
  return process.env.KONOHA_HOME || SKILLS_DB_DIR || path.join(HOME, '.konoha');
}

function _verifyBackupEntry(entry) {
  if (!entry || !entry.existed || !entry.backupPath || !entry.sourcePath) return;
  const check = verifyBackupIntegrity(entry.sourcePath, entry.backupPath);
  if (!check.ok) {
    throw new Error(`Configuration backup integrity check failed for ${entry.sourcePath}: ${check.error}`);
  }
}

function executePreInstallBackup(options = {}) {
  const homeDir = options.home || options.homeDir || process.env.HOME || process.env.USERPROFILE || HOME;
  const projectRoot = options.projectRoot || process.cwd();
  const konohaRoot = options.konohaRoot || options.konohaHome || getKonohaRoot();
  const backupSummary = backupAllDetectedClients({
    home: homeDir,
    homeDir,
    projectRoot,
    konohaRoot,
    simulateBackupFailure: options.simulateBackupFailure
  });

  for (const entry of (backupSummary.backups || [])) {
    _verifyBackupEntry(entry);
  }

  backupSummary.summaryLines = formatBackupSummaryLines(backupSummary);
  if (typeof options.onBackupSummary === 'function') {
    options.onBackupSummary(backupSummary);
  }

  return backupSummary;
}

function runTransactionalDatabaseMigration(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  fs.mkdirSync(konohaRoot, { recursive: true });
  try {
    const db = require('../../src/db');
    const conn = db.getDb();
    const versionRow = conn.prepare('PRAGMA user_version').get();
    const currentVersion = versionRow ? (versionRow.user_version || 0) : 0;
    const TARGET_SCHEMA_VERSION = 2218;
    if (currentVersion < TARGET_SCHEMA_VERSION) {
      conn.exec('PRAGMA user_version = 2218;');
    }
    try { conn.close(); } catch (_) { /* ignore */ }
    return { ok: true, schemaVersion: Math.max(currentVersion, TARGET_SCHEMA_VERSION), dbPath: db.DB_PATH };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function runEmbedAndMigrationStage(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  const migrateScript = fs.existsSync(MIGRATE_PATH)
    ? MIGRATE_PATH
    : path.resolve(__dirname, '..', '..', 'src', 'migrate.js');

  const dbMig = runTransactionalDatabaseMigration({ konohaRoot });
  if (!dbMig.ok) {
    return { ok: false, stage: 'db_migration', reason: dbMig.reason };
  }

  if (!fs.existsSync(migrateScript)) {
    return { ok: true, stage: 'embed', skipped: true, dbMigration: dbMig };
  }

  const args = [migrateScript];
  if (options.skillsDir && fs.existsSync(options.skillsDir)) {
    args.push('--skills-dir', options.skillsDir);
  }
  if (options.skipEmbeddings || process.env.KONOHA_SKIP_LIFECYCLE_EMBED === '1') {
    args.push('--skip-embeddings');
  } else {
    args.push('--rebuild-embeddings');
  }

  const timeoutMs = options.timeoutMs || INSTALL_BUILD_MIGRATE_TIMEOUT_MS || 180000;
  let res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: konohaRoot,
    timeout: timeoutMs,
    env: { ...process.env, KONOHA_HOME: konohaRoot }
  });

  if (res.status !== 0 && !args.includes('--skip-embeddings')) {
    const fallbackArgs = args.filter((a) => a !== '--rebuild-embeddings').concat(['--skip-embeddings']);
    res = spawnSync(process.execPath, fallbackArgs, {
      encoding: 'utf8',
      cwd: konohaRoot,
      timeout: timeoutMs,
      env: { ...process.env, KONOHA_HOME: konohaRoot }
    });
  }

  return {
    ok: res.status === 0,
    stage: 'embed',
    status: res.status,
    dbMigration: dbMig
  };
}

async function _restartOrAutoStartUi(cmdUiRestart, ensureUiDaemonAutoStart) {
  try {
    await cmdUiRestart(['--no-open']);
  } catch (_) {
    await ensureUiDaemonAutoStart();
  }
}

async function runUiBuildAndRestartStage(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  if (options.skipUi || process.env.KONOHA_SKIP_UI_LIFECYCLE === '1') {
    return { ok: true, stage: 'ui_build_restart', skipped: true, konohaRoot };
  }

  try {
    const { cmdUiBuild } = require('./ui_build');
    const { cmdUiRestart, ensureUiDaemonAutoStart } = require('./ui_commands');
    const installedHandler = path.join(konohaRoot, 'apps', 'web', 'build', 'handler.js');
    const repoHandler = path.resolve(__dirname, '..', '..', 'apps', 'web', 'build', 'handler.js');

    if (options.forceUiBuild || (!fs.existsSync(installedHandler) && !fs.existsSync(repoHandler))) {
      await cmdUiBuild();
    }

    if (options.restartUi !== false && process.env.KONOHA_UI_AUTOSTART !== '0') {
      await _restartOrAutoStartUi(cmdUiRestart, ensureUiDaemonAutoStart);
    }

    return { ok: true, stage: 'ui_build_restart', konohaRoot };
  } catch (err) {
    return { ok: false, stage: 'ui_build_restart', reason: err.message, konohaRoot };
  }
}

function _buildStageFailure(opts) {
  return {
    ok: false,
    failedStage: opts.failedStage,
    stageName: opts.stageName,
    error: opts.err.message,
    backupSummary: opts.backupSummary,
    recoveryHint: opts.recoveryHint,
    stages: opts.stages
  };
}

async function runFullInstallationLifecycle(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  const stages = [];
  let backupSummary = null;

  try {
    backupSummary = executePreInstallBackup({
      homeDir: options.homeDir,
      projectRoot: options.projectRoot
    });
    stages.push({ stage: 1, name: 'backup_configs', ok: true, count: Object.keys(backupSummary.backups || {}).length });
  } catch (err) {
    return {
      ok: false,
      failedStage: 1,
      stageName: 'backup_configs',
      error: err.message,
      recoveryHint: 'Verify read/write permissions on ~/.konoha/backups/configs/ before retrying.',
      stages
    };
  }

  if (typeof options.installStep === 'function') {
    try {
      await options.installStep({ konohaRoot, backupSummary });
      stages.push({ stage: 2, name: 'install_or_upgrade', ok: true });
    } catch (err) {
      return _buildStageFailure({ failedStage: 2, stageName: 'install_or_upgrade', err, backupSummary, recoveryHint: 'Use restoreFromBackupSnapshot to roll back any partial changes.', stages });
    }
  } else {
    stages.push({ stage: 2, name: 'install_or_upgrade', ok: true, skipped: true });
  }

  if (typeof options.initStep === 'function') {
    try {
      await options.initStep({ konohaRoot, backupSummary });
      stages.push({ stage: 3, name: 'konoha_init', ok: true, konohaRoot });
    } catch (err) {
      return _buildStageFailure({ failedStage: 3, stageName: 'konoha_init', err, backupSummary, recoveryHint: 'Run konoha doctor or restore configuration backups from ~/.konoha/backups/configs/.', stages });
    }
  } else {
    stages.push({ stage: 3, name: 'konoha_init', ok: true, konohaRoot });
  }

  const embedResult = runEmbedAndMigrationStage({
    konohaRoot,
    skillsDir: options.skillsDir,
    skipEmbeddings: options.skipEmbeddings
  });
  stages.push({ stage: 4, name: 'konoha_embed_and_db_migration', ...embedResult });
  if (!embedResult.ok) {
    return {
      ok: false,
      failedStage: 4,
      stageName: 'konoha_embed_and_db_migration',
      error: embedResult.reason || 'Embedding/database migration failed',
      backupSummary,
      recoveryHint: 'Run "konoha migrate --skip-embeddings" or "konoha db doctor" to inspect ~/.konoha/konoha.db.',
      stages
    };
  }

  const uiResult = await runUiBuildAndRestartStage({
    konohaRoot,
    skipUi: options.skipUi,
    forceUiBuild: options.forceUiBuild,
    restartUi: options.restartUi
  });
  stages.push({ stage: 5, name: 'konoha_ui_build_and_restart', ...uiResult });
  if (!uiResult.ok) {
    return {
      ok: false,
      failedStage: 5,
      stageName: 'konoha_ui_build_and_restart',
      error: uiResult.reason || 'Web UI build/restart failed',
      backupSummary,
      recoveryHint: 'Run "konoha ui build && konoha ui restart" manually.',
      stages
    };
  }

  return {
    ok: true,
    konohaRoot,
    backupSummary,
    stages,
    rollbackAvailable: typeof restoreFromBackupSnapshot === 'function'
  };
}

module.exports = {
  getKonohaRoot,
  executePreInstallBackup,
  runTransactionalDatabaseMigration,
  runEmbedAndMigrationStage,
  runUiBuildAndRestartStage,
  runFullInstallationLifecycle
};
