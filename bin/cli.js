#!/usr/bin/env node
'use strict';

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

const { C, log, error, drawLogo, chidoriTransition } = require('./lib/format');
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
const { cmdTelegram } = require('./commands/telegram');
const { cmdTunnel } = require('./commands/tunnel');
const { cmdQueue } = require('./commands/queue');

async function cmdHelp() {
  await chidoriTransition('help');
  drawLogo(false); // Print static logo for help menu

  log(`
  ${C.bold}🍃 Welcome to Konoha — The Ninja Agent Village Management Tool! 🍃${C.reset}
  ${C.dim}========================================================================
  Konoha helps you manage a team of specialized AI subagents (Ninjas) across
  Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, and Pi.
  It stores agent "skills" (instructions, rules, scripts) in a local SQLite FTS5
  database and exposes them via a searchable MCP server, providing massive token
  savings (~80-98%) while keeping agents highly capable.
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha <command> [options]

${C.bold}CORE COMMANDS${C.reset}
  ${C.cyan}init${C.reset}              🚀 Setup MCP servers, migrate local skills, and configure supported clients.
  ${C.cyan}reinstall${C.reset}         🚀 Force clean re-installation and replace existing configuration (implies --force).
  ${C.cyan}migrate${C.reset}           🔄 Re-index/migrate your custom skills database (run after editing skills).
  ${C.cyan}embed${C.reset}             ⚡ Rebuild vector embeddings for all skills (implies --rebuild-embeddings).
  ${C.cyan}test${C.reset}              🧪 Perform verification tests on the MCP server.
  ${C.cyan}status${C.reset}            🩺 Check installation health, database size, and loaded skills.
  ${C.cyan}version, -v${C.reset}       ✨ Display current version and check for updates from npm registry.
  ${C.cyan}upgrade${C.reset}           🔄 Upgrade Konoha CLI to the latest version from npm registry.
  ${C.cyan}savings${C.reset}           📊 View your total token savings (Today, 7 days, All time).
  ${C.cyan}detect-ai${C.reset}         🛡️  Scan website URL or project files for AI fingerprints (Human-Built Index).
  ${C.cyan}detect-docs${C.reset}       📄 Scan prose documents or text for AI generation markers (ZeroGPT defense).
  ${C.cyan}project${C.reset}           📁 Manage persistent project workspaces, detected stacks, and invariants.
  ${C.cyan}task${C.reset}              📋 Native SDLC governance tasks, readiness gates, and audits.
  ${C.cyan}data${C.reset}              🧠 Manage SQLite active session history, persona memories, and database size.
  ${C.cyan}soul${C.reset}              🔥 Display Ninja's Soul doctrine, tenets, and archetype spirits.
  ${C.cyan}doctor${C.reset}            🩺 Run environment diagnostics to detect/fix integration issues.
  ${C.cyan}bridge${C.reset}            🌉 Manage Konoha Bridge Router (status, list, create, delete, enable, disable).
  ${C.cyan}search${C.reset}            🔍 Zero-API-key multi-source web search (SearXNG, DuckDuckGo, Wikipedia).
  ${C.cyan}ui, web${C.reset}           🌐 Manage local Web Configuration UI (start, stop, restart, status; port 1404).
  ${C.cyan}service${C.reset}           ⚙️  Manage background system daemon service (systemd / launchd) for Web UI.
  ${C.cyan}telegram${C.reset}          ✈️  Manage Telegram bot task reporting and two-way remote prompting.
  ${C.cyan}webhook${C.reset}           🔗 Manage outbound webhook integrations (Bearer, API Key, JWT).
  ${C.cyan}tunnel${C.reset}            🚇 Manage Cloudflare and ngrok public ingress tunnels.
  ${C.cyan}clean${C.reset}             🧹 Clean stale backups, dead PIDs, and reclaim disk space in ~/.konoha.
  ${C.cyan}queue${C.reset}             📬 Background task prompt queue and execution worker.
  ${C.cyan}uninstall${C.reset}         🗑️  Safely remove Konoha MCP server (leaves custom skill files intact).

${C.bold}SUBAGENT & SKILL MANAGEMENT COMMANDS${C.reset}
  ${C.cyan}skill${C.reset}             📚 Manage skills (list installed, search the public registry, add/remove).
  ${C.cyan}agent${C.reset}             👤 Configure Ninja subagents (list, create, toggle skills, models config, delete, status).
  ${C.cyan}help, -h${C.reset}          ❓ Show this educational help menu.

${C.bold}GLOBAL OPTIONS${C.reset}
  ${C.dim}--force${C.reset}            Force clean re-installation (used with init).
  ${C.dim}--skills-dir${C.reset}       Specify a custom directory to scan for skill folders (used with migrate).
  ${C.dim}--clean${C.reset}            Clean stale records before re-indexing (used with migrate).

${C.bold}QUICK-START EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. Setup everything for the first time:${C.reset}
     pnpm dlx konoha-mcp init  # (or: npm install -g konoha-mcp && konoha init)

  ${C.dim}2. Re-index skills & synchronize vector embeddings:${C.reset}
     konoha migrate --clean --rebuild-embeddings  # (or: konoha embed)

  ${C.dim}3. Verify MCP server connection:${C.reset}
     konoha test

  ${C.dim}4. Search for a custom skill on the registry and install it:${C.reset}
     konoha skill search golang

  ${C.dim}5. Interactively configure subagent skills:${C.reset}
     konoha agent skill genin

  ${C.dim}6. View byte-weighted token savings metrics:${C.reset}
     konoha savings

  ${C.dim}7. Inspect database storage and session history:${C.reset}
     konoha data view

  ${C.dim}8. Scan a website or document for AI markers:${C.reset}
     konoha detect-ai https://example.com
     konoha detect-docs report.pdf

  ${C.dim}9. Configure Telegram remote task notifications:${C.reset}
     konoha telegram config --token <BOT_TOKEN> --chat-id <CHAT_ID>
     konoha telegram test

  ${C.dim}10. Start Cloudflare public tunnel for remote Web UI access:${C.reset}
     konoha tunnel start

`);
}

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  if (command === undefined) {
    await runSplashScreen();
  }

  // Silent auto-setup on every command (except help/uninstall/version)
  const skipAutoSetup = ['uninstall', 'help', '--help', '-h', '--version', '-v', 'version'].includes(command);
  if (!skipAutoSetup) {
    try {
      ensureAutoSetup();
    } catch (_) {
      // Never block CLI on auto-setup failures
    }
  }

  // Auto-start Web UI daemon silently in background so frontend is always available
  const skipUiAuto = ['ui', 'web', 'service', 'uninstall', 'help', '--help', '-h', '--version', '-v', 'version'].includes(command);
  if (!skipUiAuto) {
    ensureUiDaemonAutoStart({ silent: true }).catch(() => {});
  }

  try {
    switch (command) {
      case 'init':
      case 'reinstall':
        if (command === 'reinstall' && !args.includes('--force')) {
          args.push('--force');
        }
        await cmdInit(args);
        break;
      case 'migrate':
        await cmdMigrate(args);
        break;
      case 'embed':
        if (!args.includes('--rebuild-embeddings')) {
          args.push('--rebuild-embeddings');
        }
        await cmdMigrate(args);
        break;
      case 'test':
        await cmdTest(args);
        break;
      case 'status':
        await cmdStatus(args);
        break;
      case 'savings':
        await cmdSavings(args);
        break;
      case 'detect-ai':
        await cmdDetectAi(args);
        break;
      case 'detect-docs':
        await cmdDetectDocs(args);
        break;
      case 'doctor':
        await cmdDoctor(args);
        break;
      case 'clean':
        await cmdClean(args);
        break;
      case 'uninstall':
        await cmdUninstall(args);
        break;
      case 'web':
        await cmdWeb(args);
        break;
      case 'ui':
        await cmdUi(args);
        break;
      case 'auth': {
        const sub = args[0];
        if (sub === 'reset' || sub === 'reset-password') {
          const auth = require('../src/auth');
          auth.resetAuthToDefault();
          process.stdout.write('  \x1b[38;2;0;255;255m⚡\x1b[0m Web console password has been reset to default: \x1b[1mkonohagakure\x1b[0m\n');
        } else {
          process.stdout.write('Usage: konoha auth reset\n');
        }
        break;
      }
      case 'service':
        await cmdUiService(args);
        break;
      case 'version':
      case '--version':
      case '-v':
        await cmdVersion(args);
        break;
      case 'upgrade':
        await cmdUpgrade(args);
        break;
      case 'skill':
        await cmdSkill(args);
        break;
      case 'agent':
        await cmdAgent(args);
        break;
      case 'data':
        await cmdData(args);
        break;
      case 'soul':
        await cmdSoul(args);
        break;
      case 'project':
        await cmdProject(args);
        break;
      case 'task':
        await cmdTask(args);
        break;
      case 'bridge':
        await cmdBridge(args);
        break;
      case 'search':
        await cmdSearch(args);
        break;
      case 'telegram':
        await cmdTelegram(args);
        break;
      case 'webhook':
      case 'webhooks': {
        const { cmdWebhook } = require('./commands/webhook');
        await cmdWebhook(args);
        break;
      }
      case 'tunnel':
        await cmdTunnel(args);
        break;
      case 'queue':
        await cmdQueue(args);
        break;
      case 'help':
      case '--help':
      case '-h':
        await cmdHelp();
        break;
      case undefined:
        await cmdHelp();
        break;
      default:
        error(`Unknown command: ${command}`);
        log(`Run ${C.cyan}konoha help${C.reset} for usage.`);
        process.exit(1);
    }
  } finally {
    closeReadline();
  }
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      closeReadline();
      error(`Execution error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  syncTemplateSkills,
  installCliRuntime,
  reconcileGlobalCommand,
  ensureUiDaemonAutoStart,
  cmdHelp
};
