"use strict";

/**
 * bin/commands/migrate.js — Skill Migration, Vector Embedding & Database Re-Indexing.
 */


const { spawnSync } = require("child_process");

const { SKILLS_DB_DIR, MIGRATE_PATH, MIGRATION_TIMEOUT_MS } = require("../lib/paths");
const { C, log, info, warn, error, success, header } = require("../lib/format");
const { fileExists } = require("../lib/prompt");
const { moveUnusedSkills, detectSkillsDirs, syncTemplateSkills } = require("../lib/runtime");
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

async function cmdMigrate(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdMigrateHelp();
    return;
  }
  syncTemplateSkills();
  header('📊 Re-running Skills Migration');

  if (!fileExists(MIGRATE_PATH)) {
    error('Migration script not found. Run "konoha init" first.');
    process.exit(1);
  }

  const hasForce = args.includes('--force');
  const hasRebuildEmbeddings = args.includes('--rebuild-embeddings');
  const hasSkipEmbeddings = args.includes('--skip-embeddings');
  const timeoutMs = hasRebuildEmbeddings ? Math.max(MIGRATION_TIMEOUT_MS, 300000) : MIGRATION_TIMEOUT_MS;

  if (hasForce) {
    info('Pruning unused/unembedded skills to prevent duplicate content...');
    const agents = agentManager.loadAgents();
    const skillsDirs = detectSkillsDirs();
    moveUnusedSkills(skillsDirs, agents);
  }

  const isClean = args.includes('--clean');
  const cleanArgs = isClean ? ['--clean'] : [];

  // Check for custom skills dir
  const customDirIdx = args.indexOf('--skills-dir');
  if (customDirIdx >= 0 && args[customDirIdx + 1]) {
    const customDir = args[customDirIdx + 1];
    try {
      const runArgs = [MIGRATE_PATH, ...cleanArgs, '--skills-dir', customDir];
      if (hasRebuildEmbeddings) runArgs.push('--rebuild-embeddings');
      if (hasSkipEmbeddings) runArgs.push('--skip-embeddings');
      let run = spawnSync(process.execPath, runArgs, {
        encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
      });
      if (run.status !== 0) {
        run = spawnSync(process.execPath, [MIGRATE_PATH, ...cleanArgs, '--skills-dir', customDir, '--skills-only', '--skip-embeddings'], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
        });
      }
      if (run.status !== 0) throw new Error(run.stderr || run.error?.message || 'Migration failed');
      log(run.stdout);
      success('Migration complete!');
    } catch (e) {
      warn(`Migration timed out or partially failed: ${e.message}`);
      warn('Run "konoha migrate" again to finish remaining references.');
    }
  } else {
    // Migrate all detected skill directories
    const skillsDirs = detectSkillsDirs();
    if (skillsDirs.length === 0) {
      // Fallback: run without args
      try {
        const fallbackArgs = [MIGRATE_PATH, ...cleanArgs];
        if (hasRebuildEmbeddings) fallbackArgs.push('--rebuild-embeddings');
        if (hasSkipEmbeddings) fallbackArgs.push('--skip-embeddings');
        let runFallback = spawnSync(process.execPath, fallbackArgs, {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
        });
        if (runFallback.status !== 0) {
          runFallback = spawnSync(process.execPath, [MIGRATE_PATH, ...cleanArgs, '--skills-only', '--skip-embeddings'], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
          });
        }
        if (runFallback.status !== 0) throw new Error(runFallback.stderr || runFallback.error?.message || 'Migration failed');
        log(runFallback.stdout);
        success('Migration complete!');
      } catch (e) {
        warn(`Migration timed out or partially failed: ${e.message}`);
        warn('Run "konoha migrate" again to finish remaining references.');
      }
    } else {
      let anySuccess = false;
      const migrateArgs = [MIGRATE_PATH, ...cleanArgs];
      if (hasRebuildEmbeddings) migrateArgs.push('--rebuild-embeddings');
      if (hasSkipEmbeddings) migrateArgs.push('--skip-embeddings');
      for (const dir of skillsDirs) {
        migrateArgs.push('--skills-dir', dir.path);
      }
      try {
        let run = spawnSync(process.execPath, migrateArgs, {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
        });
        if (run.status !== 0) {
          run = spawnSync(process.execPath, [...migrateArgs.filter(a => a !== '--rebuild-embeddings'), '--skills-only', '--skip-embeddings'], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
          });
        }
        if (run.status === 0) {
          log(run.stdout);
          anySuccess = true;
        } else {
          error(`Migration failed: ${run.stderr}`);
        }
      } catch (e) {
        error(`Migration failed: ${e.message}`);
      }

      if (anySuccess) {
        success('Migration complete for all skill directories!');
      } else {
        warn('Migration timed out; run "konoha migrate" again to finish remaining references.');
      }
    }
  }

  // After migration, automatically optimize rules
  try {
    agentManager.regenerateAndDeploy();
    success('GEMINI.md and AGENTS.md regenerated with optimized token footprint.');
  } catch (e) {
    warn(`Auto-optimize skipped: ${e.message}`);
  }
}



module.exports = {
  cmdMigrate,
  cmdMigrateHelp,
};
