"use strict";

/**
 * bin/commands/version.js — CLI Version Reporting & Registry Update Checks.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const { SKILLS_DB_DIR } = require("../lib/paths");
const { C, log, header } = require("../lib/format");
const { fileExists, startSpinner } = require("../lib/prompt");
const { getLatestVersion, semverCompare } = require("./upgrade");


function cmdVersionHelp() {
  log(`
${C.cyan}konoha version${C.reset} — Display current version and check for updates from npm registry

${C.bold}USAGE${C.reset}
  konoha version

${C.bold}EXAMPLES${C.reset}
  konoha version
`);
}


async function cmdVersion(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdVersionHelp();
    return;
  }
  const candidatePkgPaths = [
    path.join(__dirname, '..', '..', 'package.json'),
    path.join(SKILLS_DB_DIR, 'package.json'),
    path.join(os.homedir(), '.konoha', 'package.json')
  ];
  let currentVersion = '2.0.0';
  for (const p of candidatePkgPaths) {
    if (fileExists(p)) {
      try {
        const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
        if (v) { currentVersion = v; break; }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  header('✨ Konoha Version');
  log(`  ${C.bold}Current Version:${C.reset}  ${C.green}${currentVersion}${C.reset}\n`);

  const spinner = startSpinner('Checking for latest release from npm registry...');
  try {
    const latestVersion = await getLatestVersion();
    const cleanLatest = latestVersion.replace(/^v/, '');
    const cleanCurrent = currentVersion.replace(/^v/, '');
    const cmp = semverCompare(cleanLatest, cleanCurrent);

    if (cmp > 0) {
      spinner.warn(`Update available! Latest: ${C.green}${cleanLatest}${C.reset} (current: ${C.yellow}${cleanCurrent}${C.reset})`);
      log('');
      log(`  To upgrade to the latest version, run:`);
      log(`    ${C.cyan}konoha upgrade${C.reset}`);
      log('');
    } else {
      spinner.success(`You are already running the latest version of Konoha (${currentVersion}).`);
    }
  } catch (err) {
    spinner.error(`Failed to check for updates: ${err.message}`);
  }
}



module.exports = {
  cmdVersion,
  cmdVersionHelp,
};
