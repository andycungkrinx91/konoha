'use strict';

/**
 * bin/commands/db.js — SQLite Database Health, Integrity Checks & Recovery.
 *
 * Subcommands:
 * - check: Run PRAGMA integrity_check and quick_check on target DB.
 * - restore: Restore database from verified backup or salvage damaged tables.
 */

const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('../lib/paths');
const { C, log, info, error, success, chidoriTransition } = require('../lib/format');
const { checkIntegrity, restoreDatabase } = require('../../src/db_recovery');

function cmdDbHelp() {
  log(`
${C.cyan}konoha db${C.reset} — SQLite database integrity diagnostics and disaster recovery

${C.bold}USAGE${C.reset}
  konoha db <subcommand> [path] [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}check [path]${C.reset}                         🔍 Perform PRAGMA integrity and quick checks.
  ${C.cyan}restore [path] [--from <bcp>] [--force]${C.reset}  🛠️  Restore from verified backup or salvage tables.

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--from, -b <backupPath>${C.reset}   Explicit path to a verified backup snapshot.
  ${C.cyan}--force, -f${C.reset}               Force overwrite of destination database.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. Check default database integrity:${C.reset}
     konoha db check

  ${C.dim}2. Check custom database file:${C.reset}
     konoha db check /path/to/database.db

  ${C.dim}3. Restore database from latest automatic backup:${C.reset}
     konoha db restore

  ${C.dim}4. Restore database from specific backup snapshot:${C.reset}
     konoha db restore /path/to/database.db --from /path/to/snapshot.db --force
`);
}

async function cmdDbCheck(args) {
  const targetDb = args[0] && !args[0].startsWith('-') ? path.resolve(args[0]) : DB_PATH;
  info(`Checking database integrity for: ${targetDb}`);

  if (!fs.existsSync(targetDb)) {
    error(`Database file does not exist: ${targetDb}`);
    process.exit(1);
  }

  const result = checkIntegrity(targetDb);
  if (result.ok) {
    success(`Database integrity verified: ${targetDb}`);
    log(`  ${C.bold}Status:${C.reset}  ${C.green}HEALTHY (PRAGMA integrity_check passed)${C.reset}\n`);
    process.exit(0);
  } else {
    error(`Database corruption detected in: ${targetDb}`);
    log(`  ${C.bold}Status:${C.reset}  ${C.red}${result.status}${C.reset}`);
    result.details.forEach(d => log(`  ${C.red}✖ ${d}${C.reset}`));
    log(`\nRun ${C.cyan}konoha db restore ${targetDb}${C.reset} to restore from verified backup.\n`);
    process.exit(1);
  }
}

async function cmdDbRestore(args) {
  let targetDb = DB_PATH;
  let backupPath = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--from' || arg === '-b') && args[i + 1]) {
      backupPath = path.resolve(args[++i]);
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (!arg.startsWith('-') && targetDb === DB_PATH) {
      targetDb = path.resolve(arg);
    }
  }

  info(`Initiating database recovery protocol for: ${targetDb}`);
  try {
    const result = restoreDatabase({
      dbPath: targetDb,
      backupPath,
      force
    });

    if (result.restored) {
      success(`Database recovery successful!`);
      log(`  ${C.bold}Method:${C.reset}   ${result.method}`);
      log(`  ${C.bold}Source:${C.reset}   ${result.source}`);
      log(`  ${C.bold}Target:${C.reset}   ${result.target}`);
      if (result.archived) {
        log(`  ${C.bold}Archived:${C.reset} ${result.archived}`);
      }
      log(`  ${C.bold}Details:${C.reset}  ${result.details}\n`);
      process.exit(0);
    } else {
      error(`Database recovery failed.`);
      log(`  ${C.bold}Details:${C.reset} ${result.details}`);
      if (result.archived) {
        log(`  ${C.bold}Preserved file:${C.reset} ${result.archived}\n`);
      }
      process.exit(1);
    }
  } catch (err) {
    error(`Database restore error: ${err.message}`);
    process.exit(1);
  }
}

async function cmdDb(args) {
  await chidoriTransition('db');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdDbHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'check':
      await cmdDbCheck(subArgs);
      break;
    case 'restore':
      await cmdDbRestore(subArgs);
      break;
    default:
      error(`Unknown db subcommand: ${subcommand}`);
      cmdDbHelp();
      process.exit(1);
  }
}

module.exports = {
  cmdDb,
  cmdDbHelp,
  cmdDbCheck,
  cmdDbRestore
};
