"use strict";

/**
 * bin/commands/help.js — Educational CLI Help Menu & Command Catalog.
 */

const { C, log, drawLogo, chidoriTransition } = require("../lib/format");


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
  ${C.cyan}soul${C.reset}              🔥 Display Village Soul / Will of Fire doctrine, tenets, and archetype spirits.
  ${C.cyan}doctor${C.reset}            🩺 Run environment diagnostics to detect/fix integration issues.
  ${C.cyan}bridge${C.reset}            🌉 Manage Konoha Bridge Router (status, list, create, delete, enable, disable).
  ${C.cyan}search${C.reset}            🔍 Zero-API-key multi-source web search (SearXNG, DuckDuckGo, Wikipedia).
  ${C.cyan}ui, web${C.reset}           🌐 Manage local Web Configuration UI (start, stop, restart, status; port 1404).
  ${C.cyan}service${C.reset}           ⚙️  Manage background system daemon service (systemd / launchd) for Web UI.
  ${C.cyan}telegram${C.reset}          ✈️  Manage Telegram bot task reporting and two-way remote prompting.
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




module.exports = {
  cmdHelp,
};
