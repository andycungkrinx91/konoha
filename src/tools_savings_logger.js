#!/usr/bin/env node
/**
 * Lightweight tool-call logger for non-server tool paths (file router, file_tools_mcp.js).
 * Pure Node.js replacement for src/tools_savings_logger.py.
 * Inserts a row into the `tool_calls` table inside ~/.konoha/skills.db.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb, DB_PATH } = require('./db');

const HOME = os.homedir();
const DEFAULT_BASELINE = 550000; // ~140k tokens — matches server.py/server.js fallback

const ANTIGRAVITY_CLI_BRAIN = path.join(HOME, '.gemini', 'antigravity-cli', 'brain');
const ANTIGRAVITY_IDE_BRAIN = path.join(HOME, '.gemini', 'antigravity-ide', 'brain');
const CURSOR_PROJECTS = path.join(HOME, '.cursor', 'projects');
const CLAUDE_PROJECTS = path.join(HOME, '.claude', 'projects');

function globFiles(baseDir, matchPattern) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;
  function walk(current) {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && matchPattern(full)) {
        results.push(full);
      }
    }
  }
  walk(baseDir);
  return results;
}

function detectActiveClient() {
  try {
    const activeOverride = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || '').toLowerCase().trim();
    if (activeOverride) {
      if (activeOverride.includes('codex') || activeOverride.includes('openai')) return 'codex';
      if (activeOverride.includes('commandcode') || activeOverride.includes('command-code')) return 'commandcode';
      if (activeOverride.includes('opencode')) return 'opencode';
      if (activeOverride.includes('claude')) return 'claudecode';
      if (activeOverride.includes('cursor')) return 'cursor';
      if (activeOverride === 'pi') return 'pi';
      if (activeOverride.includes('agy') || activeOverride.includes('antigravity-cli')) return 'agy';
      if (activeOverride.includes('antigravity') || activeOverride.includes('ide')) return 'antigravity';
    }

    const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
    if (convId) {
      const cliDir = path.join(ANTIGRAVITY_CLI_BRAIN, convId);
      if (fs.existsSync(cliDir) && fs.statSync(cliDir).isDirectory()) return 'agy';
      const ideDir = path.join(ANTIGRAVITY_IDE_BRAIN, convId);
      if (fs.existsSync(ideDir) && fs.statSync(ideDir).isDirectory()) return 'antigravity';
      return 'antigravity';
    }

    if (process.env.OPENCODE_CLIENT === '1' || process.env.OPENCODE_SESSION === '1') return 'opencode';
    if (process.env.COMMANDCODE_CLIENT === '1' || process.env.COMMANDCODE_SESSION === '1') return 'commandcode';
    if (process.env.CLAUDE_CODE_CHILD_SESSION === '1') return 'claudecode';
    if (process.env.PI_CODING_AGENT === 'true' || process.env.PI_SESSION_FILE || process.env.PI_SESSION_ID) return 'pi';

    const brainDirs = [
      ANTIGRAVITY_IDE_BRAIN,
      ANTIGRAVITY_CLI_BRAIN,
      CURSOR_PROJECTS,
      CLAUDE_PROJECTS,
      path.join(HOME, '.commandcode', 'projects'),
      path.join(HOME, '.config', 'opencode', 'projects'),
      path.join(HOME, '.codex', 'sessions'),
      path.join(HOME, '.pi', 'agent', 'sessions')
    ];

    const allFiles = [];
    for (const bDir of brainDirs) {
      if (!fs.existsSync(bDir) || !fs.statSync(bDir).isDirectory()) continue;
      if (bDir.includes(path.join('.pi', 'agent', 'sessions'))) {
        allFiles.push(...globFiles(bDir, (f) => f.endsWith('.jsonl')));
      } else if (bDir.includes('cursor')) {
        allFiles.push(...globFiles(bDir, (f) => f.endsWith('.jsonl') && f.includes('agent-transcripts')));
      } else if (bDir.includes('claude')) {
        allFiles.push(...globFiles(bDir, (f) => f.endsWith('.jsonl')));
      } else {
        allFiles.push(...globFiles(bDir, (f) => f.endsWith('prompt.md') || f.endsWith('transcript.jsonl')));
      }
    }

    if (!allFiles.length) return 'antigravity';

    allFiles.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch (_) {
        return 0;
      }
    });

    const mostRecent = allFiles[0].toLowerCase();
    if (mostRecent.includes(path.join('.pi', 'agent', 'sessions'))) return 'pi';
    if (mostRecent.includes('cursor')) return 'cursor';
    if (mostRecent.includes('commandcode')) return 'commandcode';
    if (mostRecent.includes('claudecode') || mostRecent.includes('claude')) return 'claudecode';
    if (mostRecent.includes('antigravity-cli') || mostRecent.includes('agy')) return 'agy';
    return 'antigravity';
  } catch (_) {
    return 'antigravity';
  }
}

function log(tool, query, returnedBytes, client = null, baselineBytes = null) {
  if (!client) {
    client = detectActiveClient();
  }
  const conn = getDb();
  try {
    let baseline = 0;
    if (baselineBytes !== null && baselineBytes !== undefined && Number(baselineBytes) > 0) {
      baseline = Number(baselineBytes);
    } else if (tool === 'token_efficient_grep') {
      baseline = Math.max(Number(returnedBytes) || 0, 150000);
    } else if (tool === 'find_files_clean') {
      baseline = Math.max(Number(returnedBytes) || 0, 250000);
    } else if (['read_file_head', 'read_file_range', 'file_info', 'get_file_structure'].includes(tool)) {
      baseline = Number(returnedBytes) || 0;
    } else if (['find_skill', 'find_skills', 'list_skills', 'optimize_report', 'build_from_text', 'build_from_source', 'build_with_image_design'].includes(tool)) {
      baseline = DEFAULT_BASELINE;
      try {
        const row = conn.prepare('SELECT SUM(byte_size) as total FROM skills').get();
        if (row && row.total) baseline = Number(row.total);
      } catch (_) {}
    } else if (tool === 'get_skill') {
      baseline = Number(returnedBytes) || 0;
    } else {
      baseline = Number(returnedBytes) || 0;
    }

    const retBytes = Number(returnedBytes) || 0;
    const bytesSaved = Math.max(baseline - retBytes, 0);
    const tokensSaved = Math.floor(bytesSaved / 4);

    conn.prepare(`
      INSERT INTO tool_calls
      (tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, client)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(tool || '').slice(0, 200),
      String(query || '').slice(0, 2000),
      retBytes,
      baseline,
      bytesSaved,
      tokensSaved,
      client
    );
  } catch (_) {
    // Fail silently
  } finally {
    try { conn.close(); } catch (_) {}
  }
}

if (require.main === module) {
  if (process.argv.length < 5) {
    process.stderr.write('usage: tools_savings_logger.js <tool> <query> <returned_bytes> [client] [baseline_bytes]\n');
    process.exit(1);
  }
  try {
    const tool = process.argv[2];
    const query = process.argv[3];
    const returnedBytes = parseInt(process.argv[4], 10) || 0;
    const client = process.argv[5] || null;
    const baselineBytes = process.argv[6] ? parseInt(process.argv[6], 10) : null;
    log(tool, query, returnedBytes, client, baselineBytes);
  } catch (exc) {
    process.stderr.write(`[tools_savings_logger] ${exc.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  log,
  detectActiveClient,
  DEFAULT_BASELINE,
  DB_PATH
};
