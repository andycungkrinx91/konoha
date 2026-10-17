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

function detectActiveClient() {
  try {
    const activeOverride = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || '').toLowerCase().trim();
    if (activeOverride) {
      if (activeOverride.includes('codex') || activeOverride.includes('openai')) return 'codex';
      if (activeOverride.includes('omp')) return 'omp';
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
      if ((process.env.ANTIGRAVITY_LS_VERSION || '').startsWith('cli') || (process.env.ANTIGRAVITY_AGENTAPI_EXE || '').includes('agy')) return 'agy';
      const cliDir = path.join(ANTIGRAVITY_CLI_BRAIN, convId);
      if (fs.existsSync(cliDir) && fs.statSync(cliDir).isDirectory()) return 'agy';
      const ideDir = path.join(ANTIGRAVITY_IDE_BRAIN, convId);
      if (fs.existsSync(ideDir) && fs.statSync(ideDir).isDirectory()) return 'antigravity';
      return 'agy';
    }

    if (process.env.OPENCODE_CLIENT === '1' || process.env.OPENCODE_SESSION === '1') return 'opencode';
    if (process.env.COMMANDCODE_CLIENT === '1' || process.env.COMMANDCODE_SESSION === '1') return 'commandcode';
    if (process.env.CLAUDE_CODE_CHILD_SESSION === '1') return 'claudecode';
    if (process.env.PI_CODING_AGENT === 'true' || process.env.PI_SESSION_FILE || process.env.PI_SESSION_ID) return 'pi';
    if (process.env.OMP_CLIENT === '1' || process.env.OMP_SESSION === '1' || process.env.OMP_SESSION_ID || process.env.OMP_AGENT) return 'omp';

    // No hard session signal: attribute HONESTLY instead of guessing.
    // The previous filesystem heuristic (glob every client's session dirs,
    // pick the most-recently-modified file) misattributed thousands of calls
    // made by CLI commands, test harnesses and scripts to whatever client
    // happened to have a fresh session file — corrupting the per-provider
    // breakdown in `konoha savings`. Provider rows must only contain calls
    // from sessions with a verified client signal.
    return 'unattributed';
  } catch (_) {
    return 'unattributed';
  }
}

const { BOUNDED_FILE_TOOL_NAMES } = require('./file_tools_router');
const [
  TOOL_READ_HEAD,
  TOOL_READ_RANGE,
  TOOL_FILE_INFO,
  TOOL_TOKEN_GREP,
  TOOL_STRUCTURE,
  TOOL_FIND_CLEAN
] = BOUNDED_FILE_TOOL_NAMES;

function log(tool, query, returnedBytes, client = null, baselineBytes = null) {
  if (!client) {
    client = detectActiveClient();
  }
  const conn = getDb();
  try {
    let baseline = 0;
    if (baselineBytes !== null && baselineBytes !== undefined && Number(baselineBytes) > 0) {
      baseline = Number(baselineBytes);
    } else if (tool === TOOL_TOKEN_GREP) {
      baseline = Math.max(Number(returnedBytes) || 0, 150000);
    } else if (tool === TOOL_FIND_CLEAN) {
      baseline = Math.max(Number(returnedBytes) || 0, 250000);
    } else if ([TOOL_READ_HEAD, TOOL_READ_RANGE, TOOL_FILE_INFO, TOOL_STRUCTURE].includes(tool)) {
      let resolvedSize = 0;
      try {
        let rawTarget = null;
        if (typeof query === 'string') {
          try {
            const parsed = JSON.parse(query);
            rawTarget = parsed.path || parsed.file_path || parsed.filepath || parsed.dir;
          } catch (_) {
            rawTarget = query;
          }
        }
        if (rawTarget) {
          const checkPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(process.cwd(), rawTarget);
          if (fs.existsSync(checkPath)) {
            const st = fs.statSync(checkPath);
            resolvedSize = st.isFile() ? st.size : 100000;
          }
        }
      } catch (_) {
        // Ignore file stat errors
      }
      baseline = Math.max(Number(returnedBytes) || 0, resolvedSize);
    } else if (['find_skill', 'find_skills'].includes(tool)) {
      baseline = Number(returnedBytes) || 0;
      try {
        let extractedQuery = query;
        if (typeof query === 'string' && query.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(query);
            extractedQuery = parsed.query || parsed.keyword || parsed.keywords || parsed.name || query;
          } catch (_) { /* best-effort json parse fallback */ }
        }
        const words = String(extractedQuery || '').replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          let totalMatched = 0;
          try {
            const ftsMatch = words.map(w => `"${w.replace(/"/g, '""')}*"`).join(' OR ');
            const ftsRow = conn.prepare(`
              SELECT COALESCE(SUM(s.byte_size), 0) as total_matched
              FROM (
                SELECT rowid FROM skills_fts WHERE skills_fts MATCH ? LIMIT 10
              ) f
              JOIN skills s ON s.rowid = f.rowid
            `).get(ftsMatch);
            if (ftsRow && ftsRow.total_matched > 0) {
              totalMatched = Number(ftsRow.total_matched);
            }
          } catch (_) {
            const lk = '%' + words[0] + '%';
            const likeRow = conn.prepare(`
              SELECT COALESCE(SUM(byte_size), 0) as total_matched
              FROM (SELECT byte_size FROM skills WHERE tags LIKE ? OR name LIKE ? OR skill_name LIKE ? LIMIT 5)
            `).get(lk, lk, lk);
            if (likeRow && likeRow.total_matched > 0) {
              totalMatched = Number(likeRow.total_matched);
            }
          }
          if (totalMatched > 0) {
            baseline = Math.max(Number(returnedBytes) || 0, totalMatched);
          }
        }
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    } else if (tool === 'get_skill') {
      baseline = Number(returnedBytes) || 0;
      try {
        let skillTarget = query;
        if (typeof query === 'string' && query.startsWith('{')) {
          try { skillTarget = JSON.parse(query).name || query; } catch (_) { /* best-effort json parse fallback */ }
        }
        const sRow = conn.prepare('SELECT byte_size FROM skills WHERE name = ? OR name LIKE ? LIMIT 1').get(skillTarget, `%/${skillTarget}`);
        if (sRow && sRow.byte_size) {
          baseline = Math.max(Number(returnedBytes) || 0, Number(sRow.byte_size));
        }
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    } else if (['list_skills', 'optimize_report'].includes(tool)) {
      // Baseline rationale: Unpruned listing across ~138 skills requires loading raw frontmatter metadata
      // (averaging ~250 bytes each = ~34.5 KB, standardized to 35,000 bytes baseline). list_skills parses
      // and delivers concise JSON summaries (~15.7 KB), yielding ~55% empirical token reduction.
      baseline = Math.max(Number(returnedBytes) || 0, 35000);
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
    try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

/**
 * Prunes tool_calls records older than the given retention period (default 90 days).
 * @param {number} retentionDays - Number of days to retain (default: 90).
 * @param {string|null} dbPath - Optional path to the database file.
 * @returns {{ deleted: number, retentionDays: number }}
 */
function pruneToolCalls(retentionDays = 90, dbPath = null) {
  const days = Math.max(Number(retentionDays) || 90, 1);
  const conn = getDb(dbPath || DB_PATH);
  try {
    const res = conn.prepare(`
      DELETE FROM tool_calls
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `).run(days);
    return { deleted: res.changes || 0, retentionDays: days };
  } catch (err) {
    return { deleted: 0, retentionDays: days, error: err.message };
  } finally {
    try { conn.close(); } catch (_) { /* ignore close error */ }
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
  pruneToolCalls,
  detectActiveClient,
  DEFAULT_BASELINE,
  DB_PATH
};
