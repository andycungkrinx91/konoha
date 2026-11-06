#!/usr/bin/env node
'use strict';

// Suppress Node.js conflict warning when both NO_COLOR and FORCE_COLOR are present
if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
  delete process.env.NO_COLOR;
}


/**
 * bin/cli.js — Konoha command-line interface.
 *
 * MCP Tools Orchestrator installer for Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, and Codex.
 * Migrates agent skills into a searchable MCP server to reduce token usage.
 *
 * Usage:
 *   konoha init          # Install MCP server + migrate skills
 *   konoha migrate       # Re-run migration (after editing skills)
 *   konoha test          # Test MCP server search
 *   konoha status        # Show installation status
 *   konoha uninstall     # Remove skills-db
 *
 * Cross-platform: Linux, macOS, Windows
 */

const { C, log, error } = require('./lib/format');
const { closeReadline } = require('./lib/prompt');
const {
  ensureAutoSetup,
  installCliRuntime,
  reconcileGlobalCommand,
  syncTemplateSkills
} = require('./lib/runtime');
const {
  ensureUiDaemonAutoStart,
  cmdUi,
  cmdWeb,
  cmdUiService
} = require('./lib/ui_commands');
const { runSplashScreen } = require('../src/splash');

// Modular subcommand handlers
const { cmdInit } = require('./commands/init');
const { cmdMigrate } = require('./commands/migrate');
const { cmdTest } = require('./commands/test');
const { cmdStatus } = require('./commands/status');
const { cmdDoctor } = require('./commands/doctor');
const { cmdUninstall } = require('./commands/uninstall');
const { cmdClean } = require('./commands/clean');
const { cmdSavings } = require('./commands/savings');
const { cmdDetectAi, cmdDetectDocs } = require('./commands/detect');
const { cmdSkill } = require('./commands/skill');
const { cmdAgent } = require('./commands/agent');
const { cmdVersion } = require('./commands/version');
const { cmdUpgrade } = require('./commands/upgrade');
const { cmdProject } = require('./commands/project');
const { cmdTask } = require('./commands/task');
const { cmdData } = require('./commands/data');
const { cmdSoul } = require('./commands/soul');
const { cmdBridge } = require('./commands/bridge');
const { cmdSearch } = require('./commands/search');
const { cmdMode } = require('./commands/mode');
const { cmdConfig } = require('./commands/config');
const { cmdTelegram } = require('./commands/telegram');
const { cmdQueue } = require('./commands/queue');
const { cmdHelp } = require('./commands/help');
const { removedSynonymMessage } = require('./lib/canonical_synonyms');

const command = process.argv[2];
const args = process.argv.slice(3);

async function dispatchCoreCommand(cmd, cmdArgs) {
  switch (cmd) {
    case 'init':
    case 'reinstall':
      if (cmd === 'reinstall' && !cmdArgs.includes('--force')) cmdArgs.push('--force');
      await cmdInit(cmdArgs);
      return true;
    case 'migrate':
      await cmdMigrate(cmdArgs);
      return true;
    case 'embed':
      if (!cmdArgs.includes('--rebuild-embeddings')) cmdArgs.push('--rebuild-embeddings');
      await cmdMigrate(cmdArgs);
      return true;
    case 'test':
      await cmdTest(cmdArgs);
      return true;
    case 'status':
      await cmdStatus(cmdArgs);
      return true;
    case 'savings':
      await cmdSavings(cmdArgs);
      return true;
    case 'doctor':
      await cmdDoctor(cmdArgs);
      return true;
    case 'clean':
      await cmdClean(cmdArgs);
      return true;
    case 'uninstall':
      await cmdUninstall(cmdArgs);
      return true;
    case 'version':
    case '--version':
    case '-v':
      await cmdVersion(cmdArgs);
      return true;
    case 'upgrade':
      await cmdUpgrade(cmdArgs);
      return true;
    case 'db': {
      const { cmdDb } = require('./commands/db');
      await cmdDb(cmdArgs);
      return true;
    }
    case 'tui': {
      const { cmdAgent } = require('./commands/agent');
      await cmdAgent(['list', '--tui']);
      return true;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      await cmdHelp();
      return true;
    default:
      return false;
  }
}

async function dispatchServiceCommand(cmd, cmdArgs) {
  switch (cmd) {
    case 'web':
      await cmdWeb(cmdArgs);
      return true;
    case 'ui':
      await cmdUi(cmdArgs);
      return true;
    case 'service':
      await cmdUiService(cmdArgs);
      return true;
    case 'auth': {
      const sub = cmdArgs[0];
      if (sub === 'reset' || sub === 'reset-password') {
        const auth = require('../src/auth');
        auth.resetAuthToDefault();
        process.stdout.write('  \x1b[38;2;0;255;255m⚡\x1b[0m Web console password has been reset to default: \x1b[1mkonohagakure\x1b[0m\n');
      } else {
        process.stdout.write('Usage: konoha auth reset\n');
      }
      return true;
    }
    case 'queue':
      await cmdQueue(cmdArgs);
      return true;
    case 'telegram':
      await cmdTelegram(cmdArgs);
      return true;
    case 'webhook':
    case 'webhooks': {
      const { cmdWebhook } = require('./commands/webhook');
      await cmdWebhook(cmdArgs);
      return true;
    }
    default:
      return false;
  }
}

async function dispatchAgentCommand(cmd, cmdArgs) {
  switch (cmd) {
    case 'detect-ai':
      await cmdDetectAi(cmdArgs);
      return true;
    case 'detect-docs':
      await cmdDetectDocs(cmdArgs);
      return true;
    case 'skill':
      await cmdSkill(cmdArgs);
      return true;
    case 'akatsuki': {
      const { cmdAkatsuki } = require('./commands/akatsuki');
      await cmdAkatsuki(cmdArgs);
      return true;
    }
    case 'agent':
      await cmdAgent(cmdArgs);
      return true;
    case 'data':
      await cmdData(cmdArgs);
      return true;
    case 'soul':
      await cmdSoul(cmdArgs);
      return true;
    case 'project':
      await cmdProject(cmdArgs);
      return true;
    case 'task':
      await cmdTask(cmdArgs);
      return true;
    case 'bridge':
      await cmdBridge(cmdArgs);
      return true;
    case 'search':
      await cmdSearch(cmdArgs);
      return true;
    case 'mode':
      await cmdMode(cmdArgs);
      return true;
    case 'config':
      await cmdConfig(cmdArgs);
      return true;
    default:
      return false;
  }
}

async function main() {
  if (command === undefined) {
    await runSplashScreen();
  }

  // Removed synonyms are rejected from argv alone, before any bootstrap, so the
  // error is instant and identical regardless of install state.
  const synonymError = removedSynonymMessage(command, args[0]);
  if (synonymError) {
    error(synonymError);
    process.exit(1);
  }

  // Run background auto-setup exclusively during explicit doctor checks
  if (command === 'doctor') {
    try {
      ensureAutoSetup();
    } catch (_) {
      // Never block CLI on auto-setup failures
    }
  }

  try {
    const handled = await dispatchCoreCommand(command, args)
      || await dispatchServiceCommand(command, args)
      || await dispatchAgentCommand(command, args);

    if (!handled) {
      error(`Unknown command: ${command}`);
      log(`Run ${C.cyan}konoha help${C.reset} for usage.`);
      process.exit(1);
    }
  } finally {
    closeReadline();
  }
}

function flushStdStreamsAndExit(code) {
  const flushStream = (stream) => new Promise((resolve) => {
    if (!stream || typeof stream.write !== 'function') return resolve();
    try {
      stream.write('', () => resolve());
    } catch (_) {
      resolve();
    }
  });
  Promise.all([flushStream(process.stdout), flushStream(process.stderr)])
    .then(() => process.exit(code))
    .catch(() => process.exit(code));
}

if (require.main === module) {
  main()
    .then(() => {
      flushStdStreamsAndExit(process.exitCode !== undefined && process.exitCode !== 0 ? process.exitCode : 0);
    })
    .catch(err => {
      closeReadline();
      error(`Execution error: ${err.message}`);
      flushStdStreamsAndExit(1);
    });
}

module.exports = {
  syncTemplateSkills,
  installCliRuntime,
  reconcileGlobalCommand,
  ensureUiDaemonAutoStart,
  cmdHelp
};
