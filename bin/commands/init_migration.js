'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { fileExists } = require('../../src/platform_utils');
const {
  HOME,
  DB_PATH,
  SKILLS_DB_DIR,
  MIGRATE_PATH,
  MCP_CONFIG_PATH,
  SERVER_PATH
} = require('../lib/paths');
const cursorManager = require('../../src/cursor_manager');
const { C, log, info, warn, error, drawBox, LEAF_THEME, getCliVersion } = require('../lib/format');
const { verifySkillDatabaseContract, hasCompleteDatabaseSchema } = require('../lib/runtime_lifecycle');

function runMigrateProcess(args, timeoutMs) {
  return spawnSync(process.execPath, [MIGRATE_PATH, ...args], {
    encoding: 'utf-8',
    cwd: SKILLS_DB_DIR,
    timeout: timeoutMs
  });
}

function runMigrationAttempts(migrationArgs, safeTimeoutMs) {
  let run = runMigrateProcess(migrationArgs, safeTimeoutMs);
  if (run.status === 0) return run;

  run = runMigrateProcess([...migrationArgs, '--skip-embeddings'], safeTimeoutMs);
  if (run.status === 0) return run;

  const skillsOnlyArgs = migrationArgs.filter(a => a !== '--skip-embeddings');
  const runFallback = runMigrateProcess([...skillsOnlyArgs, '--skills-only', '--skip-embeddings'], 120000);
  if (runFallback.status === 0) {
    warn("Reference indexing deferred: subagent skills are ready; references will index on first search or via 'konoha migrate'.");
  }
  return runFallback;
}

function migrateSingleSkillsDir(sDirPath) {
  try {
    spawnSync(process.execPath, [MIGRATE_PATH, '--skills-dir', sDirPath, '--skip-embeddings'], {
      encoding: 'utf-8',
      cwd: SKILLS_DB_DIR,
      timeout: 60000
    });
  } catch { /* intentional fallback */ }
}

function indexPreExistingSkills(skillsDirs, pkgSkillsDir) {
  if (!Array.isArray(skillsDirs)) return;
  for (const sDir of skillsDirs) {
    if (sDir.path && sDir.path !== pkgSkillsDir && fileExists(sDir.path)) {
      migrateSingleSkillsDir(sDir.path);
    }
  }
}

function executeInitMigration(options) {
  const { skillsDirs, skills, migrationArgs, safeTimeoutMs, python, pkgSkillsDir, spinner } = options;
  const run = runMigrationAttempts(migrationArgs, safeTimeoutMs);

  if (run.status !== 0) {
    const detail = run.error ? run.error.message : (run.stderr || run.stdout || 'Migration failed');
    spinner.error(`Failed to initialize skills database: ${detail}`);
    process.exit(1);
  }

  const skillContract = verifySkillDatabaseContract(python);
  if (!skillContract.ok) {
    spinner.error(`Skill database contract failed: ${skillContract.reason}`);
    process.exit(1);
  }

  spinner.success(skills.length > 0 ? 'Default subagent skills seeded successfully.' : 'Empty skills database schema initialized.');
  indexPreExistingSkills(skillsDirs, pkgSkillsDir);

  try {
    if (!hasCompleteDatabaseSchema()) throw new Error('required SQLite schema is incomplete');
  } catch (schemaError) {
    error(`SQLite schema verification failed: ${schemaError.message}`);
    process.exit(1);
  }
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
  log(`  1. Re-index & embed: ${C.cyan}konoha embed${C.reset} ${C.dim}(or: konoha migrate --clean --rebuild-embeddings)${C.reset}`);
  log(`  2. Restart IDE/CLI:  Restart Antigravity, Cursor${flags.claudeInstalled ? ', Claude Code' : ''}${flags.openCodeInstalled ? ', OpenCode' : ''}${flags.commandCodeInstalled ? ', Command Code' : ''}${flags.codexInstalled ? ', Codex' : ''} to load MCP servers`);
  log(`  3. Test execution:   ${C.cyan}konoha test${C.reset}`);
  log(`  4. Check status:     ${C.cyan}konoha status${C.reset}`);
  log(`  5. Web UI:           ${C.cyan}http://127.0.0.1:1404/${C.reset} ${C.dim}(auto-started; konoha ui stop|restart)${C.reset}`);
  log('');
}

module.exports = {
  executeInitMigration,
  renderInitSummary
};
