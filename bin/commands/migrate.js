"use strict";

/**
 * bin/commands/migrate.js — Skill Migration, Vector Embedding & Database Re-Indexing.
 */


const { C, log, info, warn, error, success, header } = require("../lib/format");
const { createEmbedProgress } = require("../lib/embed_progress");

const { moveUnusedSkills, detectSkillsDirs, syncTemplateSkills } = require("../lib/runtime");
const { executePreInstallBackup, runTransactionalDatabaseMigration } = require("../lib/install_lifecycle");
const agentManager = require("../../src/agent_manager");


function cmdMigrateHelp() {
  log(`
${C.cyan}konoha migrate${C.reset} — Re-index skills and rebuild the SQLite FTS5 database

${C.bold}USAGE${C.reset}
  konoha migrate [options]
  konoha embed

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--skills-dir <dir>${C.reset}       Specify a custom directory to scan for skill folders.
  ${C.cyan}--force${C.reset}                  Prune unused/unembedded skills before migration.
  ${C.cyan}--clean${C.reset}                  Clean existing database tables before migrating.
  ${C.cyan}--rebuild-embeddings${C.reset}   Rebuild vector embeddings for all skill chunks.
  ${C.cyan}--skip-embeddings${C.reset}      Skip generating neural embeddings (FTS5 search only).

${C.bold}EXAMPLES${C.reset}
  konoha migrate
  konoha migrate --clean --rebuild-embeddings
  konoha embed  # (implies --rebuild-embeddings)
  konoha migrate --force
  konoha migrate --skills-dir ./my-skills
`);
}

/**
 * Index skills and rebuild the FTS5/vector database.
 *
 * Runs in-process: a spawned child node made every failure an opaque status
 * code, doubled peak memory, and needed a timeout budget the caller could not
 * actually enforce from the inside.
 */
async function runInProcessMigration(options = {}) {
  const migrate = require('../../src/migrate');
  return migrate.runMigration({
    skillsDir: options.skillsDir || null,
    skillsDirs: options.skillsDirs || [],
    clean: options.clean || false,
    rebuildEmbeddings: options.rebuildEmbeddings || false,
    skipEmbeddings: options.skipEmbeddings || false,
    skillsOnly: options.skillsOnly || false,
    timeBudgetSeconds: options.timeBudgetSeconds,
    onProgress: options.onProgress
  });
}

/**
 * Keep the historical behaviour: if a full run fails, retry without embeddings
 * so the skills are at least searchable through FTS5.
 */
async function runMigrationWithFallback(options = {}) {
  const first = await runInProcessMigration(options);
  if (first && first.ok !== false) return first;
  return runInProcessMigration({
    skillsDir: options.skillsDir || null,
    clean: options.clean || false,
    skipEmbeddings: true,
    skillsOnly: true
  });
}

async function runCustomDirMigration(customDir, cleanArgs, flags, progress) {
  try {
    const result = await runMigrationWithFallback({
      skillsDir: customDir,
      clean: cleanArgs.includes('--clean'),
      rebuildEmbeddings: flags.hasRebuildEmbeddings,
      skipEmbeddings: flags.hasSkipEmbeddings,
      onProgress: progress && progress.onProgress
    });
    if (result && result.ok === false) {
      throw new Error((result.missingRequired || []).join(', ') || result.reason || 'Migration failed');
    }
    success('Migration complete!');
    return result;
  } catch (e) {
    warn(`Migration timed out or partially failed: ${e.message}`);
    warn('Run "konoha migrate" again to finish remaining references.');
    return null;
  }
}

async function runAutoDirsMigration(skillsDirs, cleanArgs, flags, progress) {
  try {
    const last = await runMigrationWithFallback({
      skillsDirs: skillsDirs.map((d) => d.path),
      clean: cleanArgs.includes('--clean'),
      rebuildEmbeddings: flags.hasRebuildEmbeddings,
      skipEmbeddings: flags.hasSkipEmbeddings,
      onProgress: progress && progress.onProgress
    });
    if (last && last.ok === false) {
      throw new Error((last.missingRequired || []).join(', ') || last.reason || 'Migration failed');
    }
    success('Migration complete for all skill directories!');
    return last;
  } catch (e) {
    error(`Migration failed: ${e.message}`);
    return null;
  }
}

function syncPostMigrationWorkspaces() {
  try {
    agentManager.regenerateAndDeploy({ force: true, silent: true });
    success('Global rules, skills, and client configurations synchronized.');
  } catch (e) {
    warn(`Auto-synchronization skipped: ${e.message}`);
  }
}

async function cmdMigrate(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdMigrateHelp();
    return;
  }
  syncTemplateSkills();
  header('📊 Re-running Skills Migration');
  try {
    const backupSummary = executePreInstallBackup({ projectRoot: process.cwd() });
    for (const line of (backupSummary.summaryLines || [])) {
      info(line.trim());
    }
    runTransactionalDatabaseMigration();
  } catch (backupErr) {
    error(`Pre-migration configuration backup verification failed: ${backupErr.message}`);
    process.exit(1);
  }

  const hasForce = args.includes('--force');
  const flags = {
    hasRebuildEmbeddings: args.includes('--rebuild-embeddings'),
    hasSkipEmbeddings: args.includes('--skip-embeddings')
  };
  if (hasForce) {
    info('Pruning unused/unembedded skills to prevent duplicate content...');
    const agents = agentManager.loadAgents();
    const skillsDirs = detectSkillsDirs();
    moveUnusedSkills(skillsDirs, agents);
  }

  const cleanArgs = args.includes('--clean') ? ['--clean'] : [];
  const customDirIdx = args.indexOf('--skills-dir');

  const progress = createEmbedProgress('Embeddings');
  const run = customDirIdx >= 0 && args[customDirIdx + 1]
    ? await runCustomDirMigration(args[customDirIdx + 1], cleanArgs, flags, progress)
    : await runAutoDirsMigration(detectSkillsDirs(), cleanArgs, flags, progress);

  const embed = run && run.embed;
  if (!run) {
    // The helpers swallow their own exceptions and return null; without this the
    // bar would stay mid-flight. The cause was already printed by the helper, so
    // no diagnosis block here.
    progress.abort('migration failed; see the errors above');
  } else if (embed && embed.ok === false && embed.failure) {
    // Skills are searchable through FTS5; only vectors are missing. Print the
    // cause and remedies, keep the exit code at 0 so scripts do not treat a
    // failed model download as a broken install.
    progress.fail(embed.failure);
    warn(`Semantic search is unavailable until embeddings are rebuilt: ${C.cyan}konoha doctor --fix${C.reset}`);
  } else if (embed && embed.ok && !embed.skipped) {
    progress.succeed(`${embed.chunksIndexed || 0} chunks embedded`);
  } else {
    progress.succeed(embed && embed.skipped ? 'migration complete (embeddings skipped)' : 'migration complete');
  }

  syncPostMigrationWorkspaces();
}



module.exports = {
  cmdMigrate,
  cmdMigrateHelp,
};
