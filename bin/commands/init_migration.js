'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists } = require('../../src/platform_utils');
const {
  HOME,
  DB_PATH,
  MIGRATE_PATH,
  MCP_CONFIG_PATH,
  SERVER_PATH,
  UI_PORT
} = require('../lib/paths');
const cursorManager = require('../../src/cursor_manager');
const { C, log, info, warn, error, success, drawBox, LEAF_THEME, getCliVersion } = require('../lib/format');
const { createEmbedProgress, MIGRATION_PHASES } = require('../lib/embed_progress');
const { verifySkillDatabaseContract, hasCompleteDatabaseSchema } = require('../lib/runtime_lifecycle');

/**
 * Count skills that still have no vector chunks.
 *
 * backfillAllEmbeddings stops at its time budget and leaves the alphabetical tail
 * unembedded without saying so. Instead of plumbing an outcome flag through three
 * layers, measure the database after the fact: the query is the ground truth and
 * also covers the case where the migration fell back to --skip-embeddings.
 *
 * Returns null when the database cannot be read (e.g. --no-project dry paths).
 */
function measureEmbeddingCoverage(dbPath = DB_PATH) {
  let conn;
  try {
    const Database = require('../../src/sqlite_driver');
    conn = new Database(dbPath, { readOnly: true });
    // A chunk row with a NULL vector is not embedded: counting chunk existence
    // alone reported a half-embedded database as complete.
    const q = (where) => conn.prepare(
      `SELECT COUNT(*) n FROM skills s WHERE length(coalesce(s.content,'')) > 0
         AND ${where} AND NOT EXISTS (SELECT 1 FROM skill_chunks k
                                       WHERE k.skill_name = s.name AND k.embedding IS NOT NULL)`
    ).get().n;
    return { canonicalPending: q("s.type = 'skill'"), referencePending: q("s.type <> 'skill'") };
  } catch (_) {
    return null;
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* ignore */ }
  }
}

async function runMigrationAttempts(migrationArgs, safeTimeoutMs, onProgress = null, logSink = null) {
  const migrate = require('../../src/migrate');
  const baseOptions = {
    skillsDir: _argValue(migrationArgs, '--skills-dir'),
    skills: _argList(migrationArgs, '--skills'),
    clean: migrationArgs.includes('--clean'),
    timeBudgetSeconds: Math.floor(safeTimeoutMs / 1000),
    onProgress,
    logSink
  };

  const attempt = async (opts) => {
    try {
      return await migrate.runMigration(opts);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  };

  let result = await attempt({
    ...baseOptions,
    rebuildEmbeddings: !migrationArgs.includes('--skip-embeddings'),
    skipEmbeddings: migrationArgs.includes('--skip-embeddings')
  });
  // Embedding is the only part allowed to fail softly, and only the first
  // attempt produces a diagnosis. Keep it: the fallbacks below skip embedding
  // entirely, so without this the reason would be lost.
  const embedFailure = (result && result.embed && result.embed.ok === false) ? result.embed.failure : null;
  if (result && result.ok !== false) return { status: 0, result, embedFailure };

  // Retry without embeddings only when the first attempt actually asked for them.
  // `--no-embed` already passed --skip-embeddings, so re-running is identical.
  if (!migrationArgs.includes('--skip-embeddings')) {
    result = await attempt({ ...baseOptions, skipEmbeddings: true, rebuildEmbeddings: false });
    if (result && result.ok !== false) return { status: 0, result, embedFailure };
  }

  const fallback = await attempt({ ...baseOptions, skipEmbeddings: true, skillsOnly: true, rebuildEmbeddings: false });
  if (fallback && fallback.ok !== false) {
    // Reported by the caller once the progress bar has settled: printing here
    // would interleave with the animated bar line.
    return { status: 0, result: fallback, embedFailure, referencesDeferred: true };
  }
  return { status: 1, result: fallback, embedFailure, stderr: (fallback && fallback.reason) || 'Migration failed' };
}

function _argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

function _argList(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < args.length && !String(args[i]).startsWith('--'); i += 1) out.push(args[i]);
  return out;
}

async function migrateSingleSkillsDir(sDirPath, logSink = null) {
  try {
    await require('../../src/migrate').runMigration({
      skillsDir: sDirPath,
      skipEmbeddings: true,
      rebuildEmbeddings: false,
      logSink
    });
  } catch { /* intentional fallback */ }
}

async function indexPreExistingSkills(skillsDirs, pkgSkillsDir, logSink = null) {
  if (!Array.isArray(skillsDirs)) return;
  for (const sDir of skillsDirs) {
    if (sDir.path && sDir.path !== pkgSkillsDir && fileExists(sDir.path)) {
      await migrateSingleSkillsDir(sDir.path, logSink);
    }
  }
}

async function executeInitMigration(options) {
  const { skillsDirs, skills, migrationArgs, safeTimeoutMs, python, pkgSkillsDir } = options;

  // One bar for the whole seed+embed phase: embedding dominates the wall time
  // and used to print a line per skill, which buried the actual failure when the
  // model download broke. A caller that injects its own reporter also owns the
  // settle, because it knows the stages that run after this one.
  const progress = options.progress || createEmbedProgress('Seeding skills', MIGRATION_PHASES);
  const settle = !options.progress;
  const run = await runMigrationAttempts(migrationArgs, safeTimeoutMs, progress.onProgress, progress.detail);

  if (run.status !== 0) {
    // Not an embedding failure: the migration itself failed, so classifying it
    // would print a remedy for the wrong problem.
    progress.abort(run.stderr || 'migration failed');
    error('Skill database initialization failed. Nothing was installed.');
    process.exit(1);
  }

  const embedFailure = run.embedFailure || (run.result && run.result.embed && run.result.embed.ok === false ? run.result.embed.failure : null);
  const embed = run.result && run.result.embed;
  if (settle) {
    if (embedFailure) {
      // Skills are indexed; only the vectors are missing. Keep the install usable
      // and tell the user exactly how to finish, instead of exiting non-zero.
      progress.fail(embedFailure);
      warn(`Semantic search is unavailable until embeddings are rebuilt: ${C.cyan}konoha doctor --fix${C.reset}`);
    } else {
      progress.succeed(embed && Number.isFinite(embed.chunksIndexed)
        ? `${embed.chunksIndexed} chunks embedded`
        : 'embeddings ready');
    }
  }

  if (run.referencesDeferred) {
    warn("Reference indexing deferred: subagent skills are ready; references will index on first search or via 'konoha migrate'.");
  }

  const skillContract = verifySkillDatabaseContract(python);
  if (!skillContract.ok) {
    error(`Skill database contract failed: ${skillContract.reason}`);
    process.exit(1);
  }

  success(skills.length > 0 ? 'Default subagent skills seeded successfully.' : 'Empty skills database schema initialized.');
  await indexPreExistingSkills(skillsDirs, pkgSkillsDir, progress.detail);

  try {
    if (!hasCompleteDatabaseSchema()) throw new Error('required SQLite schema is incomplete');
  } catch (schemaError) {
    error(`SQLite schema verification failed: ${schemaError.message}`);
    process.exit(1);
  }
  return { embedFailed: Boolean(embedFailure), embedFailure, embed };
}

function buildClientStatusLines(flags) {
  const ok = `${C.green}✓${C.reset}`;
  const skip = `${C.dim}─${C.reset}`;
  return [
    flags.allowCursor ? `${ok} Cursor        ${C.dim}~/.cursor/mcp.json + subagents${C.reset}` : `${skip} Cursor        ${C.dim}(not installed)${C.reset}`,
    flags.claudeInstalled || flags.allowClaudeCode ? `${ok} Claude Code   ${C.dim}~/.claude.json + RTK${C.reset}` : `${skip} Claude Code   ${C.dim}(not installed)${C.reset}`,
    flags.openCodeInstalled || flags.allowOpenCode ? `${ok} OpenCode     ${C.dim}~/.config/opencode/opencode.json + RTK rule${C.reset}` : `${skip} OpenCode     ${C.dim}(not installed)${C.reset}`,
    flags.commandCodeInstalled || flags.allowCommandCode ? `${ok} Command Code ${C.dim}~/.commandcode/mcp.json + RTK${C.reset}` : `${skip} Command Code ${C.dim}(not installed)${C.reset}`,
    flags.codexInstalled || flags.allowCodex ? `${ok} Codex        ${C.dim}~/.codex/config.toml + RTK${C.reset}` : `${skip} Codex        ${C.dim}(not installed)${C.reset}`,
    flags.piInstalled || flags.allowPi ? `${ok} Pi (pi.dev)  ${C.dim}~/.pi/agent/mcp.json + pi-mcp-adapter${C.reset}` : `${skip} Pi (pi.dev)  ${C.dim}(not installed)${C.reset}`,
    flags.ompInstalled || flags.allowOmp ? `${ok} OMP          ${C.dim}~/.omp/agent/mcp.json + contract${C.reset}` : `${skip} OMP          ${C.dim}(not installed)${C.reset}`
  ];
}

/**
 * Assert that init actually deployed what the summary is about to claim.
 *
 * The Windows golden seed failed for four runs because the success banner printed
 * `Server: <path>` from a constant, never from the filesystem: a mirror swap had
 * replaced server.js with a dangling link and init still exited 0. Read the paths
 * back and throw with the exact missing file instead of reporting a healthy install.
 */
function verifyRuntimeDeployment() {
  const expected = [
    ['MCP server', SERVER_PATH],
    ['migration script', MIGRATE_PATH],
    ['database', DB_PATH],
    ['auto-setup marker', path.join(HOME, '.konoha', '.autosetup-done')],
    ['Konoha skill', path.join(HOME, '.agents', 'skills', 'konoha', 'SKILL.md')]
  ];
  const failures = [];
  for (const [label, target] of expected) {
    try {
      fs.readFileSync(target);
    } catch (err) {
      failures.push(`${label} missing or unreadable: ${target} (${err && err.code ? err.code : err})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`[INIT] Runtime deployment incomplete:\n  ${failures.join('\n  ')}`);
  }
}

function renderInitSummary(flags) {
  const summaryLines = [
    `${C.bold}Konoha MCP Orchestrator installed successfully!${C.reset}`,
    '─',
    'Connected AI Clients:',
    ...buildClientStatusLines(flags),
    '─',
    'Installed files:',
    `Version:     ${C.green}v${getCliVersion()}${C.reset}`,
    `Server:     ${C.dim}${SERVER_PATH}${C.reset}`,
    `Migration:  ${C.dim}${MIGRATE_PATH}${C.reset}`,
    `Database:   ${C.dim}${DB_PATH}${C.reset}`,
    `MCP Config: ${C.dim}${MCP_CONFIG_PATH}${C.reset}`,
    `Agents YAML: ${C.dim}${path.join(HOME, '.agents', 'agents.yaml')}${C.reset}`,
    `Cursor MCP: ${C.dim}${cursorManager.CURSOR_MCP_GLOBAL}${C.reset}`,
    `Cursor Agents: ${C.dim}${cursorManager.CURSOR_AGENTS_GLOBAL}${C.reset}`
  ];
  drawBox('Installed Files', summaryLines, LEAF_THEME);
  log('');

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Restart IDE/CLI:  Restart Antigravity, Cursor${flags.claudeInstalled ? ', Claude Code' : ''}${flags.openCodeInstalled ? ', OpenCode' : ''}${flags.commandCodeInstalled ? ', Command Code' : ''}${flags.codexInstalled ? ', Codex' : ''} to load MCP servers`);
  log(`  2. Test execution:   ${C.cyan}konoha test${C.reset}`);
  log(`  3. Check status:     ${C.cyan}konoha status${C.reset}`);
  log(`  4. Web UI:           ${C.cyan}http://127.0.0.1:${UI_PORT}/${C.reset} ${C.dim}(konoha ui start)${C.reset}`);
  if (flags.skipEmbed) {
    log('');
    warn(`Vector embeddings were skipped (--no-embed). Run ${C.cyan}konoha migrate${C.reset} to enable semantic skill search.`);
  } else if (!flags.embedFailed && flags.embedCoverage && (flags.embedCoverage.canonicalPending || flags.embedCoverage.referencePending)) {
    // Backfill stops at its time budget; say so rather than implying full coverage.
    // `konoha migrate` resumes incrementally — `konoha embed` would wipe and redo all chunks.
    const { canonicalPending, referencePending } = flags.embedCoverage;
    log('');
    warn(`Embedding pass incomplete: ${canonicalPending} skill(s) and ${referencePending} reference doc(s) still pending.`);
    log(`  Run ${C.cyan}konoha migrate${C.reset} again to finish the remainder; on a slow machine raise`);
    log(`  the budget so it can finish in one pass: ${C.cyan}KONOHA_MIGRATE_TIME_BUDGET=900 konoha migrate${C.reset}`);
  }
  log('');
}

module.exports = {
  executeInitMigration,
  measureEmbeddingCoverage,
  renderInitSummary,
  verifyRuntimeDeployment
};
