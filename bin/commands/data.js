"use strict";

/**
 * bin/commands/data.js — SQLite Database Maintenance, Export & Persona Memory Management.
 *
 * Subcommands:
 * - view: Database statistics (skills count, sessions, memory items, file size)
 * - memory: List persona memories, rules, and episodic records
 * - add: Persist new rule or preference for an agent persona
 * - search: Query persona memories across agents
 * - delete: Remove persona memory by ID
 * - export: Generate Markdown export of indexed skills and knowledge
 * - prune: Clean historical session tokens and usage logs
 * - vacuum: Defragment and shrink SQLite file
 * - backup: Online SQLite hot snapshot via VACUUM INTO
 * - rebuild-fts: Reconstruct FTS5 full-text search index
 */

const fs = require("fs");
const path = require("path");

const { HOME, DB_PATH } = require("../lib/paths");
const {
  C,
  log,
  info,
  warn,
  error,
  success,
  header,
  chidoriTransition
} = require("../lib/format");

const { fileExists } = require("../lib/prompt");


function cmdDataHelp() {
  log(`
${C.cyan}konoha data${C.reset} — Manage SQLite active session history, persona memories, and database size

${C.bold}USAGE${C.reset}
  konoha data <subcommand>

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}view${C.reset}              📊 See how much disk size, skills, and persona memories are in your database.
  ${C.cyan}memory [agent]${C.reset}    🧠 List saved persona rules, preferences, and episodic memory per agent.
  ${C.cyan}add <agent> <txt>${C.reset} ➕ Save a persistent rule or preference for an agent persona.
  ${C.cyan}search <query>${C.reset}    🔍 Search saved knowledge and memories across agents.
  ${C.cyan}delete <id>${C.reset}       🗑️ Remove a saved memory item by ID.
  ${C.cyan}export${C.reset}            📤 Export indexed skills and database knowledge into a Markdown report.
  ${C.cyan}prune${C.reset}             🧹 Clean up old active sessions and usage logs (preserves memories), then vacuum.
  ${C.cyan}vacuum${C.reset}            ⚡ Defragment and compress SQLite database file directly.
  ${C.cyan}backup [path]${C.reset}     💾 Create an online, consistent SQLite database snapshot using VACUUM INTO.
  ${C.cyan}rebuild-fts${C.reset}       🔄 Rebuild FTS5 full-text search indexes for skills and persona memories.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. View current database statistics:${C.reset}
     konoha data view

  ${C.dim}2. List saved persona memories for an agent:${C.reset}
     konoha data memory anbu

  ${C.dim}3. Add a persistent rule for an agent:${C.reset}
     konoha data add anbu "Always use parameterized queries and WAL mode in SQLite" --type rule

  ${C.dim}4. Search saved memories across all agents:${C.reset}
     konoha data search "SQLite WAL"

  ${C.dim}5. Prune usage logs while preserving saved memories:${C.reset}
     konoha data prune

  ${C.dim}6. Export skills and persona memories to a Markdown file:${C.reset}
     konoha data export
`);
}

async function cmdData(args) {
  await chidoriTransition('data');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdDataHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'view':
      await cmdDataView();
      break;
    case 'memory':
      await cmdDataMemory(subArgs);
      break;
    case 'add':
      await cmdDataAdd(subArgs);
      break;
    case 'search':
      await cmdDataSearch(subArgs);
      break;
    case 'delete':
      await cmdDataDelete(subArgs);
      break;
    case 'prune':
      await cmdDataPrune(subArgs);
      break;
    case 'export':
      await cmdDataExport();
      break;
    case 'vacuum':
      await cmdDataVacuum();
      break;
    case 'backup':
      await cmdDataBackup(subArgs);
      break;
    case 'rebuild-fts':
      await cmdDataRebuildFts();
      break;
    case 'memories':
    case 'list':
      error(`Unknown subcommand '${subcommand}' for 'konoha data'. Use canonical subcommand 'konoha data memory'.`);
      process.exit(1);
    case 'save':
      error(`Unknown subcommand 'save' for 'konoha data'. Use canonical subcommand 'konoha data add'.`);
      process.exit(1);
    case 'find':
      error(`Unknown subcommand 'find' for 'konoha data'. Use canonical subcommand 'konoha data search'.`);
      process.exit(1);
    case 'remove':
    case 'rm':
      error(`Unknown subcommand '${subcommand}' for 'konoha data'. Use canonical subcommand 'konoha data delete'.`);
      process.exit(1);
    default:
      error(`Unknown data subcommand: ${subcommand}`);
      cmdDataHelp();
      process.exit(1);
  }
}


async function cmdDataView() {
  try {
    if (fileExists(DB_PATH)) {
      const { getDb } = require('../../src/db');
      const conn = getDb(DB_PATH);
      const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
      let skillsCount = 0;
      try { skillsCount = conn.prepare("SELECT COUNT(*) as c FROM skills").get().c; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      let toolCallsCount = 0;
      try { toolCallsCount = conn.prepare("SELECT COUNT(*) as c FROM tool_calls").get().c; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      let sessionsCount = 0;
      try { sessionsCount = conn.prepare("SELECT COUNT(*) as c FROM active_sessions").get().c; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      let freelistSize = 0;
      try {
        const freelistCount = conn.pragma("freelist_count", { simple: true });
        const pageSize = conn.pragma("page_size", { simple: true });
        freelistSize = freelistCount * pageSize;
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      const sizeMb = (dbSize / (1024 * 1024)).toFixed(2);
      const freeMb = (freelistSize / (1024 * 1024)).toFixed(2);

      log(`\n${C.cyan}📊 Konoha Database Statistics${C.reset}`);
      log(`════════════════════════════════════════════════════════════`);
      log(`  ${C.bold}Database path:${C.reset}  ${DB_PATH}`);
      log(`  ${C.bold}Disk Size:${C.reset}      ${sizeMb} MB`);
      log(`  ${C.bold}Indexed Skills:${C.reset} ${skillsCount} skills`);
      log(`  ${C.bold}Usage Logs:${C.reset}     ${toolCallsCount} records`);
      log(`  ${C.bold}Active Sessions:${C.reset} ${sessionsCount} sessions`);
      log(`  ${C.bold}Prunable Space:${C.reset}  ${freeMb} MB (vacuumable)`);
      log(`════════════════════════════════════════════════════════════`);
      log(`Use ${C.cyan}konoha data prune${C.reset} to clear usage logs and shrink database size.\n`);
    } else {
      error('SQLite database not found.');
    }
  } catch (err) {
    error(`Failed to view database statistics: ${err.message}`);
  }
}

function pruneSearxngLogs() {
  const searxngDir = path.join(HOME, '.konoha', 'searxng');
  const pruneFiles = ['search.log', 'instances_cache.json', 'best_instance.json'];
  let searxngSavedBytes = 0;
  pruneFiles.forEach(f => {
    const fp = path.join(searxngDir, f);
    if (fs.existsSync(fp)) {
      searxngSavedBytes += fs.statSync(fp).size;
      try { fs.unlinkSync(fp); } catch { /* best-effort */ }
    }
  });
  return searxngSavedBytes;
}

function pruneMemoriesByArgs(projectFilter) {
  const personaMemory = require('../../src/persona_memory');
  info('Pruning episodic memory context...');
  if (projectFilter) {
    const res = personaMemory.pruneProjectMemories(projectFilter, {}, DB_PATH);
    success(`Pruned ${res.deleted} memory item(s) for project (${res.project_hash || projectFilter}).`);
  } else {
    const res = personaMemory.pruneMemories({}, DB_PATH);
    success(`Pruned ${res.deleted} episodic memory item(s) from database.`);
  }
}

async function cmdDataPrune(args = []) {
  if (!fileExists(DB_PATH)) {
    error('SQLite database not found.');
    return;
  }
  try {
    let projectFilter = null;
    for (let i = 0; i < args.length; i++) {
      if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
        projectFilter = args[++i];
      }
    }

    if (args.includes('--memories') || args.includes('memories') || args.includes('--memory') || projectFilter) {
      pruneMemoriesByArgs(projectFilter);
    }

    const retentionIdx = args.findIndex(a => a === '--retention' || a === '--days');
    const hasRetention = retentionIdx !== -1 && args[retentionIdx + 1];
    const retentionDays = hasRetention ? (parseInt(args[retentionIdx + 1], 10) || 90) : null;

    info('Pruning database (clearing session history, old usage logs)...');
    const sizeBefore = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
    const { getDb } = require('../../src/db');
    const conn = getDb(DB_PATH);
    if (hasRetention) {
      try {
        const { pruneToolCalls } = require('../../src/tools_savings_logger');
        pruneToolCalls(retentionDays, DB_PATH);
      } catch (_) { /* best-effort */ }
    } else {
      try { conn.prepare("DELETE FROM tool_calls;").run(); } catch (_) { /* best-effort */ }
    }
    try { conn.prepare("DELETE FROM active_sessions;").run(); } catch (_) { /* best-effort */ }
    try { conn.exec("VACUUM"); } catch (_) { /* best-effort */ }
    const sizeAfter = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
    const saved = Math.max(sizeBefore - sizeAfter, 0);

    const searxngSavedBytes = pruneSearxngLogs();
    const totalSavedBytes = saved + searxngSavedBytes;
    const sizeBeforeMb = (sizeBefore / (1024 * 1024)).toFixed(2);
    const sizeAfterMb = (sizeAfter / (1024 * 1024)).toFixed(2);
    const savedMb = (totalSavedBytes / (1024 * 1024)).toFixed(2);

    success('Successfully pruned active session mappings, usage logs, and SearXNG logs/caches!');
    log(`  ${C.bold}Size Before:${C.reset} ${sizeBeforeMb} MB`);
    log(`  ${C.bold}Size After:${C.reset}  ${sizeAfterMb} MB`);
    log(`  ${C.bold}Disk Reclaimed:${C.reset} ${C.green}${savedMb} MB${C.reset}`);
  } catch (err) {
    error(`Failed to prune database: ${err.message}`);
  }
}

async function cmdDataVacuum() {
  try {
    if (fileExists(DB_PATH)) {
      info('Vacuuming database (compressing SQLite files and reclaiming disk space)...');
      const sizeBefore = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
      const { getDb } = require('../../src/db');
      const conn = getDb(DB_PATH);
      try { conn.exec("VACUUM"); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      const sizeAfter = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
      const saved = Math.max(sizeBefore - sizeAfter, 0);

      const sizeBeforeMb = (sizeBefore / (1024 * 1024)).toFixed(2);
      const sizeAfterMb = (sizeAfter / (1024 * 1024)).toFixed(2);
      const savedMb = (saved / (1024 * 1024)).toFixed(2);

      success('Successfully vacuumed database!');
      log(`  ${C.bold}Size Before:${C.reset} ${sizeBeforeMb} MB`);
      log(`  ${C.bold}Size After:${C.reset}  ${sizeAfterMb} MB`);
      log(`  ${C.bold}Disk Reclaimed:${C.reset} ${C.green}${savedMb} MB${C.reset}`);
    } else {
      error('SQLite database not found.');
    }
  } catch (err) {
    error(`Failed to vacuum database: ${err.message}`);
  }
}

async function cmdDataRebuildFts() {
  try {
    const { getConnection, rebuildAllFts } = require('../../src/db');
    const conn = getConnection(DB_PATH);
    try {
      const res = rebuildAllFts(conn);
      if (res.rebuilt) {
        success(`Successfully rebuilt FTS5 full-text indexes: ${res.tables.join(', ')}.`);
      } else {
        warn(`FTS5 rebuild skipped: ${res.reason || 'not supported'}.`);
      }
    } finally {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  } catch (err) {
    error(`Failed to rebuild FTS5 indexes: ${err.message}`);
    process.exit(1);
  }
}

async function cmdDataBackup(args = []) {
  try {
    const { backupDatabase } = require('../../src/db');
    const targetPath = args[0] || null;
    info('Creating online SQLite database backup...');
    const result = backupDatabase(targetPath, DB_PATH);
    const sizeMb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
    success(`Successfully created database backup (${sizeMb} MB)!`);
    log(`  ${C.bold}Destination:${C.reset} ${result.targetPath}`);
  } catch (err) {
    error(`Failed to create database backup: ${err.message}`);
    process.exit(1);
  }
}

function buildExportMarkdown(conn) {
  let skills = [];
  try {
    skills = conn.prepare("SELECT name, skill_name, type, tags, content, byte_size, line_count FROM skills ORDER BY name ASC").all();
  } catch (_) { /* best-effort */ }

  let sessions = [];
  try {
    sessions = conn.prepare("SELECT client, workspace_root, session_id, last_active_at FROM active_sessions ORDER BY last_active_at DESC").all();
  } catch (_) { /* best-effort */ }

  let toolCallsSum = { count: 0, bytes_saved: 0, tokens_saved: 0 };
  try {
    toolCallsSum = conn.prepare("SELECT COUNT(*) as count, COALESCE(SUM(bytes_saved), 0) as bytes_saved, COALESCE(SUM(tokens_saved), 0) as tokens_saved FROM tool_calls").get();
  } catch (_) { /* best-effort */ }

  let content = `# 🍃 Konoha Persona & Knowledge Export\n\n`;
  content += `Generated Database Dump: ${DB_PATH}\n`;
  content += `This file contains the structured skills, agent identities, and active sessions database.\n\n`;

  content += `## 👤 Special Agent Village Roster\n`;
  try {
    const agentsData = conn.prepare("SELECT name, icon, model_tier, description FROM agents").all();
    for (const a of agentsData) {
      content += `- **${a.icon || '👤'} ${a.name}** (Model: ${a.model_tier}): ${a.description}\n`;
    }
  } catch (_) {
    content += `Failed to load agents configuration from database.\n`;
  }
  content += `\n## 📚 Indexed Reference Skills\n`;
  if (!skills || skills.length === 0) {
    content += `No skills currently indexed in the SQLite database.\n`;
  } else {
    for (const s of skills) {
      content += `### 📦 ${s.name} (${s.type})\n- **Skill Group**: ${s.skill_name}\n- **Tags**: ${s.tags || ''}\n- **Size**: ${s.byte_size} bytes (${s.line_count} lines)\n\n#### Instruction Content:\n\`\`\`markdown\n${(s.content || '').trim()}\n\`\`\`\n\n---\n\n`;
    }
  }

  content += `## 📊 Active Workspace Sessions\n`;
  if (!sessions || sessions.length === 0) {
    content += `No active workspace sessions recorded.\n`;
  } else {
    content += `| Client | Workspace Root | Session ID | Last Active |\n| --- | --- | --- | --- |\n`;
    for (const sess of sessions) {
      content += `| ${sess.client} | ${sess.workspace_root} | ${sess.session_id} | ${sess.last_active_at} |\n`;
    }
  }
  content += `\n## 📉 Token Telemetry Summary\n`;
  content += `- **Total Tool Invocations**: ${toolCallsSum.count || 0}\n`;
  content += `- **Cumulative Bytes Saved**: ${toolCallsSum.bytes_saved || 0} bytes\n`;
  content += `- **Cumulative Tokens Saved**: ${toolCallsSum.tokens_saved || 0} tokens\n`;
  return content;
}

async function cmdDataExport() {
  if (!fileExists(DB_PATH)) {
    error('SQLite database not found.');
    return;
  }
  try {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const filename = `konoha-persona-${dd}${mm}${yy}${ms}.md`;
    const exportPath = path.join(process.cwd(), filename);

    info(`Exporting database to Markdown at ${exportPath}...`);
    const { getDb } = require('../../src/db');
    const conn = getDb(DB_PATH);
    const content = buildExportMarkdown(conn);

    fs.writeFileSync(exportPath, content, 'utf-8');
    success(`Successfully exported database knowledge base to ${exportPath}!`);
  } catch (err) {
    error(`Failed to export database: ${err.message}`);
  }
}

function parseMemoryArgs(args) {
  let agentFilter = null;
  let projectFilter = null;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
      projectFilter = args[++i];
    } else if (!args[i].startsWith('-') && !agentFilter) {
      agentFilter = args[i];
    }
  }
  return { agentFilter, projectFilter };
}

async function cmdDataMemory(args) {
  if (!fileExists(DB_PATH)) {
    error('SQLite database not found.');
    return;
  }
  try {
    const { agentFilter, projectFilter } = parseMemoryArgs(args);
    const personaMemory = require('../../src/persona_memory');
    const mems = personaMemory.listMemories({
      agentName: agentFilter || null,
      projectPath: projectFilter || null,
      limit: 50,
      allSessions: true,
      dbPath: DB_PATH
    });
    const filterLabel = projectFilter ? `(Project: ${path.basename(projectFilter)})` : (agentFilter ? `(@${agentFilter})` : '');
    header(`🧠 Konoha Saved Persona Memories ${filterLabel}`);
    if (!mems || mems.length === 0) {
      log(`  ${C.dim}No saved memories found. Use ${C.cyan}konoha data add <agent> <content>${C.dim} to save rules/learnings.${C.reset}\n`);
      return;
    }
    mems.forEach((m, idx) => {
      const typeBadge = `[${(m.memory_type || 'rule').toUpperCase()}]`;
      log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}@${m.agent_name}${C.reset} ${C.yellow}${typeBadge}${C.reset} ${C.bold}${m.title || ''}${C.reset} ${C.dim}(ID: ${m.id})${C.reset}`);
      log(`     ${m.content}`);
      if (m.tags) log(`     ${C.dim}Tags: ${m.tags}${C.reset}`);
      log('');
    });
    success(`Total: ${mems.length} saved memory item(s).`);
  } catch (err) {
    error(`Failed to retrieve persona memories: ${err.message}`);
  }
}

async function cmdDataAdd(args) {
  if (args.length < 2) {
    error('Usage: konoha data add <agent> <content> [--title <title>] [--type <type>] [--tags <tags>]');
    process.exit(1);
  }
  const agent = args[0];
  let content = '';
  let title = '';
  let type = 'rule';
  let tags = '';
  let importance = 1;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--type' && i + 1 < args.length) {
      type = args[++i];
    } else if (args[i] === '--tags' && i + 1 < args.length) {
      tags = args[++i];
    } else if (args[i] === '--importance' && i + 1 < args.length) {
      importance = parseInt(args[++i], 10) || 1;
    } else {
      content += (content ? ' ' : '') + args[i];
    }
  }

  try {
    if (fileExists(DB_PATH)) {
      const personaMemory = require('../../src/persona_memory');
      const memId = personaMemory.saveMemory({
        agentName: agent,
        content,
        title,
        memoryType: type,
        tags,
        importance,
        dbPath: DB_PATH
      });
      success(`Saved persona memory for @${agent}! (ID: ${memId})`);
      log(`  ${C.bold}Content:${C.reset} ${content}\n`);
    } else {
      error('SQLite database not found.');
    }
  } catch (err) {
    error(`Failed to add persona memory: ${err.message}`);
  }
}

async function cmdDataSearch(args) {
  if (args.length === 0) {
    error('Usage: konoha data search <query> [--agent <name>]');
    process.exit(1);
  }
  let query = '';
  let agentFilter = 'global';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && i + 1 < args.length) {
      agentFilter = args[++i];
    } else {
      query += (query ? ' ' : '') + args[i];
    }
  }

  try {
    if (fileExists(DB_PATH)) {
      const personaMemory = require('../../src/persona_memory');
      const mems = personaMemory.queryMemories({
        agentName: agentFilter,
        query,
        limit: 10,
        allSessions: true,
        dbPath: DB_PATH
      });
      header(`🔍 Search Results for "${query}"`);
      if (!mems || mems.length === 0) {
        log(`  ${C.dim}No matching memories found.${C.reset}\n`);
        return;
      }
      mems.forEach((m, idx) => {
        const typeBadge = `[${(m.memory_type || 'rule').toUpperCase()}]`;
        log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}@${m.agent_name}${C.reset} ${C.yellow}${typeBadge}${C.reset} ${C.bold}${m.title || ''}${C.reset} ${C.dim}(ID: ${m.id})${C.reset}`);
        log(`     ${m.content}\n`);
      });
    } else {
      error('SQLite database not found.');
    }
  } catch (err) {
    error(`Failed to search persona memories: ${err.message}`);
  }
}

async function cmdDataDelete(args) {
  if (args.length === 0) {
    error('Usage: konoha data delete <id>');
    process.exit(1);
  }
  const memId = args[0];
  try {
    if (fileExists(DB_PATH)) {
      const personaMemory = require('../../src/persona_memory');
      const deleted = personaMemory.deleteMemory(memId, DB_PATH);
      if (deleted) {
        success(`Deleted memory item ID: ${memId}`);
      } else {
        warn(`Memory item ID "${memId}" not found.`);
      }
    } else {
      error('SQLite database not found.');
    }
  } catch (err) {
    error(`Failed to delete memory: ${err.message}`);
  }
}



module.exports = {
  cmdData,
  cmdDataHelp,
  cmdDataView,
  cmdDataPrune,
  cmdDataVacuum,
  cmdDataRebuildFts,
  cmdDataBackup,
  cmdDataExport,
  cmdDataMemory,
  cmdDataAdd,
  cmdDataSearch,
  cmdDataDelete,
};
