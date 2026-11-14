'use strict';

const fs = require('fs');
const path = require('path');
const { HOME, SKILLS_DB_DIR } = require('./paths');
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
    clients: options.clients || null,
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

/**
 * Bring the database to the current schema. `PRAGMA user_version` tracks the
 * schema only; the app version lives in package.json and must never be written
 * here, or a schema bump and a release bump become indistinguishable.
 */
function runTransactionalDatabaseMigration(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  fs.mkdirSync(konohaRoot, { recursive: true });
  try {
    const db = require('../../src/db');
    const { CURRENT_SCHEMA_VERSION } = require('../../src/db_schema');
    const conn = db.getDb();
    db.setupSchema(conn);
    const versionRow = conn.prepare('PRAGMA user_version').get();
    const schemaVersion = versionRow ? (versionRow.user_version || 0) : 0;
    try { conn.close(); } catch (_) { /* ignore */ }
    return {
      ok: true,
      schemaVersion,
      expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: require('../../package.json').version,
      dbPath: db.DB_PATH
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function runEmbedAndMigrationStage(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();

  const dbMig = runTransactionalDatabaseMigration({ konohaRoot });
  if (!dbMig.ok) {
    return { ok: false, stage: 'db_migration', reason: dbMig.reason };
  }

  const migrate = require('../../src/migrate');
  const skipEmbeddings = Boolean(options.skipEmbeddings || process.env.KONOHA_SKIP_LIFECYCLE_EMBED === '1');

  // Run a second pass without embeddings if the first one fails: on a machine
  // without the embedding model, indexing is still better than no skills at all.
  let result;
  try {
    result = await migrate.runMigration({
      skillsDir: options.skillsDir && fs.existsSync(options.skillsDir) ? options.skillsDir : null,
      rebuildEmbeddings: !skipEmbeddings,
      skipEmbeddings,
      timeBudgetSeconds: options.timeBudgetSeconds
    });
  } catch (err) {
    return { ok: false, stage: 'embed', reason: err.message, dbMigration: dbMig };
  }

  if (result && result.ok === false && !skipEmbeddings) {
    try {
      result = await migrate.runMigration({
        skillsDir: options.skillsDir && fs.existsSync(options.skillsDir) ? options.skillsDir : null,
        skipEmbeddings: true,
        rebuildEmbeddings: false,
        timeBudgetSeconds: options.timeBudgetSeconds
      });
    } catch (err) {
      return { ok: false, stage: 'embed', reason: err.message, dbMigration: dbMig };
    }
  }

  return {
    ok: Boolean(result && result.ok !== false),
    stage: 'embed',
    indexed: result ? result.indexed : 0,
    deferredSkills: result ? (result.deferredSkills || 0) : 0,
    missingRequired: result ? result.missingRequired : undefined,
    dbMigration: dbMig
  };
}

async function runUiBuildStage(options = {}) {
  const konohaRoot = options.konohaRoot || getKonohaRoot();
  if (options.skipUi || process.env.KONOHA_SKIP_UI_LIFECYCLE === '1') {
    return { ok: true, stage: 'ui_build', skipped: true, konohaRoot };
  }

  try {
    const { cmdUiBuild } = require('./ui_build');
    const installedHandler = path.join(konohaRoot, 'apps', 'web', 'build', 'handler.js');
    const repoHandler = path.resolve(__dirname, '..', '..', 'apps', 'web', 'build', 'handler.js');

    if (options.forceUiBuild || (!fs.existsSync(installedHandler) && !fs.existsSync(repoHandler))) {
      await cmdUiBuild();
    }

    return { ok: true, stage: 'ui_build', konohaRoot };
  } catch (err) {
    return { ok: false, stage: 'ui_build', reason: err.message, konohaRoot };
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
      projectRoot: options.projectRoot,
      clients: options.clients || null
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

  const embedResult = await runEmbedAndMigrationStage({
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

  const uiResult = await runUiBuildStage({
    konohaRoot,
    skipUi: options.skipUi,
    forceUiBuild: options.forceUiBuild
  });
  stages.push({ stage: 5, name: 'konoha_ui_build', ...uiResult });
  if (!uiResult.ok) {
    return {
      ok: false,
      failedStage: 5,
      stageName: 'konoha_ui_build',
      error: uiResult.reason || 'Web UI build failed',
      backupSummary,
      recoveryHint: 'Run "konoha ui build" manually.',
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
  runUiBuildStage,
  runFullInstallationLifecycle
};
