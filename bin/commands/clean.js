"use strict";

/**
 * bin/commands/clean.js — Purge Stale Runtime Files, Temp Artifacts & Vacuum.
 */

const { C, log, warn, header } = require("../lib/format");
const { startSpinner } = require("../lib/prompt");
const deployUtils = require("../../src/deploy_utils");


function cmdCleanHelp() {
  header('🧹 Konoha Clean Help');
  log(`
${C.bold}DESCRIPTION${C.reset}
  Clean stale runtime artifacts, legacy databases, dead PIDs, old backups,
  and orphaned modules from ~/.konoha/ to reclaim disk space.

${C.bold}USAGE${C.reset}
  konoha clean [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--no-vacuum${C.reset}   Skip SQLite database VACUUM and WAL truncation.
  ${C.cyan}--help, -h${C.reset}    Show this help message.

${C.bold}EXAMPLES${C.reset}
  konoha clean
`);
}

async function cmdClean(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdCleanHelp();
    return;
  }
  header('🧹 Cleaning Konoha Runtime');
  const spinner = startSpinner('Cleaning stale runtime files from ~/.konoha/...');
  try {
    const cleanResult = deployUtils.cleanKonohaRuntimeDir({
      silent: false,
      vacuumDatabase: !args.includes('--no-vacuum'),
    });
    const mb = (cleanResult.reclaimedBytes / (1024 * 1024)).toFixed(2);
    if (cleanResult.purgedFiles > 0) {
      spinner.success(`Cleaned ${cleanResult.purgedFiles} stale files (${mb} MB reclaimed) from ~/.konoha/`);
      if (cleanResult.details && cleanResult.details.length > 0) {
        log(`\n${C.dim}Purged artifacts:${C.reset}`);
        cleanResult.details.slice(0, 20).forEach(d => log(`  ${C.dim}- ${d}${C.reset}`));
        if (cleanResult.details.length > 20) {
          log(`  ${C.dim}...and ${cleanResult.details.length - 20} more files.${C.reset}`);
        }
      }
    } else {
      spinner.success('~/.konoha/ runtime is already clean.');
    }
    if (cleanResult.errors && cleanResult.errors.length > 0) {
      cleanResult.errors.forEach(e => warn(`Cleanup notice: ${e}`));
    }
  } catch (err) {
    spinner.error(`Failed to clean ~/.konoha/: ${err.message}`);
  }
}



module.exports = {
  cmdClean,
  cmdCleanHelp,
};
