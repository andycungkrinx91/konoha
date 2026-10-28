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

function runMigrationProcess(runArgs, timeoutMs) {
  let run = spawnSync(process.execPath, runArgs, {
    encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
  });
  if (run.status !== 0) {
    const fallback = [...runArgs.filter(a => a !== '--rebuild-embeddings'), '--skills-only', '--skip-embeddings'];
    run = spawnSync(process.execPath, fallback, {
      encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: timeoutMs
    });
  }
  return run;
}

function runCustomDirMigration(customDir, cleanArgs, flags, timeoutMs) {
  try {
    const runArgs = [MIGRATE_PATH, ...cleanArgs, '--skills-dir', customDir];
    if (flags.hasRebuildEmbeddings) runArgs.push('--rebuild-embeddings');
    if (flags.hasSkipEmbeddings) runArgs.push('--skip-embeddings');
    const run = runMigrationProcess(runArgs, timeoutMs);
    if (run.status !== 0) throw new Error(run.stderr || run.error?.message || 'Migration failed');
    log(run.stdout);
    success('Migration complete!');
  } catch (e) {
    warn(`Migration timed out or partially failed: ${e.message}`);
    warn('Run "konoha migrate" again to finish remaining references.');
  }
}

function runAutoDirsMigration(skillsDirs, cleanArgs, flags, timeoutMs) {
  if (skillsDirs.length === 0) {
    try {
      const fallbackArgs = [MIGRATE_PATH, ...cleanArgs];
      if (flags.hasRebuildEmbeddings) fallbackArgs.push('--rebuild-embeddings');
      if (flags.hasSkipEmbeddings) fallbackArgs.push('--skip-embeddings');
      const runFallback = runMigrationProcess(fallbackArgs, timeoutMs);
      if (runFallback.status !== 0) throw new Error(runFallback.stderr || runFallback.error?.message || 'Migration failed');
      log(runFallback.stdout);
      success('Migration complete!');
    } catch (e) {
      warn(`Migration timed out or partially failed: ${e.message}`);
      warn('Run "konoha migrate" again to finish remaining references.');
    }
    return;
  }

  const migrateArgs = [MIGRATE_PATH, ...cleanArgs];
  if (flags.hasRebuildEmbeddings) migrateArgs.push('--rebuild-embeddings');
  if (flags.hasSkipEmbeddings) migrateArgs.push('--skip-embeddings');
  for (const dir of skillsDirs) migrateArgs.push('--skills-dir', dir.path);

  try {
    const run = runMigrationProcess(migrateArgs, timeoutMs);
    if (run.status === 0) {
      log(run.stdout);
      success('Migration complete for all skill directories!');
    } else {
      const errMsg = (run.stderr || '').trim() || run.error?.message || `process exited with code ${run.status}`;
      error(run.error?.code === 'ETIMEDOUT' ? `Migration timed out after ${Math.round(timeoutMs / 1000)}s: ${errMsg}` : `Migration failed: ${errMsg}`);
      warn('Migration timed out; run "konoha migrate" again to finish remaining references.');
    }
  } catch (e) {
    error(`Migration failed: ${e.message}`);
  }
}

function syncTrackedProject(p, cwd) {
  if (!p?.project_path || p.project_path === cwd || !fileExists(p.project_path)) return false;
  try {
    const res = agentManager.deployProjectWorkspace(p.project_path, { silent: true, force: true });
    return Boolean(res?.ok && !res.skipped);
  } catch {
    return false;
  }
}

function syncPostMigrationWorkspaces() {
  try {
    agentManager.regenerateAndDeploy({ force: true, silent: true });
    const cwd = process.cwd();
    let syncedWorkspaces = 0;
    const res = agentManager.deployProjectWorkspace(cwd, { silent: true, force: true });
    if (res?.ok && !res.skipped) syncedWorkspaces++;

    try {
      const personaMemory = require('../../src/persona_memory');
      const { DB_PATH } = require('../lib/paths');
      const tracked = personaMemory.listProjects(50, DB_PATH) || [];
      for (const p of tracked) {
        if (syncTrackedProject(p, cwd)) syncedWorkspaces++;
      }
    } catch (_) { /* best-effort */ }

    const msg = syncedWorkspaces > 0
      ? `GEMINI.md, AGENTS.md, rules, and skills synchronized across ${syncedWorkspaces} project workspace(s) and all client environments.`
      : 'GEMINI.md, AGENTS.md, rules, and skills synchronized across all client environments.';
    success(msg);
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

  if (!fileExists(MIGRATE_PATH)) {
    error('Migration script not found. Run "konoha init" first.');
    process.exit(1);
  }

  const hasForce = args.includes('--force');
  const flags = {
    hasRebuildEmbeddings: args.includes('--rebuild-embeddings'),
    hasSkipEmbeddings: args.includes('--skip-embeddings')
  };
  const rawTimeout = Number(MIGRATION_TIMEOUT_MS);
  const baseTimeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 180000;
  const timeoutMs = flags.hasRebuildEmbeddings ? Math.max(baseTimeout, 600000) : baseTimeout;

  if (hasForce) {
    info('Pruning unused/unembedded skills to prevent duplicate content...');
    const agents = agentManager.loadAgents();
    const skillsDirs = detectSkillsDirs();
    moveUnusedSkills(skillsDirs, agents);
  }

  const cleanArgs = args.includes('--clean') ? ['--clean'] : [];
  const customDirIdx = args.indexOf('--skills-dir');

  if (customDirIdx >= 0 && args[customDirIdx + 1]) {
    runCustomDirMigration(args[customDirIdx + 1], cleanArgs, flags, timeoutMs);
  } else {
    runAutoDirsMigration(detectSkillsDirs(), cleanArgs, flags, timeoutMs);
  }

  syncPostMigrationWorkspaces();
}



module.exports = {
  cmdMigrate,
  cmdMigrateHelp,
};
