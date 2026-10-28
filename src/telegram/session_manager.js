/**
 * Konoha Telegram Multi-Session & Workspace Switcher.
 * Enables selecting and routing tasks to active client sessions (Antigravity, Claude, Cursor, etc.)
 * using simple numbered session indices: /session <number>.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const dbModule = require('../db');
const personaMemory = require('../persona_memory');

const CLIENT_DISPLAY_NAMES = {
  antigravity: 'Antigravity IDE/CLI',
  agy: 'Antigravity IDE/CLI',
  claudecode: 'Claude Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  commandcode: 'Command Code',
  pi: 'Pi Agent',
  omp: 'OMP Agent',
  telegram: 'Telegram Bot'
};

const CANONICAL_CLIENT_MAP = {
  agy: 'antigravity',
  antigravity: 'antigravity',
  claude: 'claudecode',
  claudecode: 'claudecode',
  codex: 'codex',
  pi: 'pi',
  omp: 'omp',
  opencode: 'opencode',
  commandcode: 'commandcode',
  cursor: 'cursor'
};

const IGNORED_CLIENTS = new Set(['unattributed', 'unknown', 'default']);
const IGNORED_PATHS = [
  os.homedir(),
  path.join(os.homedir(), '.konoha'),
  path.normalize(os.tmpdir())
];

/**
 * Ensure telegram_session_targets table exists in database.
 */
function ensureTable(conn) {
  try {
    conn.prepare(`
      CREATE TABLE IF NOT EXISTS telegram_session_targets (
        chat_id TEXT PRIMARY KEY,
        client TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (_) { /* intentional best-effort fallback */ }
}

/**
 * Check if a workspace path is a real project workspace.
 */
function isRealWorkspace(ws) {
  if (!ws || typeof ws !== 'string') return false;
  const norm = path.normalize(ws.trim());
  if (IGNORED_PATHS.includes(norm)) return false;
  if (norm.startsWith('/tmp') || norm.includes('/.konoha')) return false;
  if (!fs.existsSync(norm)) return false;
  try {
    const stat = fs.statSync(norm);
    return stat.isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * Format relative timestamp.
 */
function formatTimeAgo(dateStr) {
  if (!dateStr) return 'recently';
  try {
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    const diffMs = Date.now() - d.getTime();
    if (isNaN(diffMs) || diffMs < 0) return 'just now';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  } catch (_) {
    return dateStr;
  }
}

function _getFileMtimeSafe(full) {
  try {
    return fs.statSync(full).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function _findNewestFileInDir(sessDir) {
  let files = [];
  try {
    files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[session] failed to read session dir ${sessDir}:`, err.message);
    return null;
  }
  let newest = null;
  let newestMtime = 0;
  for (const f of files) {
    const full = path.join(sessDir, f);
    const mtime = _getFileMtimeSafe(full);
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newest = { path: full, name: f, mtimeMs: mtime };
    }
  }
  return newest;
}

/**
 * Dynamically locate active OMP session file for a workspace.
 */
function findOmpSessionForWorkspace(wsPath) {
  if (!wsPath || typeof wsPath !== 'string') return null;
  const norm = path.normalize(wsPath);
  const candidates = [];
  if (norm.startsWith(os.homedir())) {
    const rel = path.relative(os.homedir(), norm);
    candidates.push('-' + rel.replace(/\//g, '-'));
  }
  candidates.push('-' + norm.replace(/^\//, '').replace(/\//g, '-'));

  const baseDir = path.join(os.homedir(), '.omp', 'agent', 'sessions');
  if (!fs.existsSync(baseDir)) return null;

  for (const cand of candidates) {
    const sessDir = path.join(baseDir, cand);
    if (!fs.existsSync(sessDir)) continue;
    const newest = _findNewestFileInDir(sessDir);
    if (newest) return newest;
  }
  return null;
}

function _getAntigravityBrainDir(sessionId) {
  if (!sessionId || sessionId === 'default') return null;
  const brainCli = path.join(os.homedir(), '.gemini/antigravity-cli/brain', sessionId);
  if (fs.existsSync(brainCli)) return brainCli;
  const brainIde = path.join(os.homedir(), '.gemini/antigravity-ide/brain', sessionId);
  if (fs.existsSync(brainIde)) return brainIde;
  return null;
}

function _getBrainMtime(brainDir) {
  let newestMtime = 0;
  for (const sub of ['.system_generated/logs/transcript.jsonl', 'prompt.md']) {
    const p = path.join(brainDir, sub);
    if (fs.existsSync(p)) {
      try { newestMtime = Math.max(newestMtime, fs.statSync(p).mtimeMs); } catch (_) { /* ignore */ }
    }
  }
  return newestMtime;
}

function _isAntigravitySessionAlive(sess, lastActiveMs, now, maxIdleMs) {
  const brainDir = _getAntigravityBrainDir(sess.session_id);
  if (brainDir) {
    const newestMtime = _getBrainMtime(brainDir);
    if (newestMtime > 0) return (now - newestMtime) <= maxIdleMs;
  }
  return lastActiveMs > 0 && (now - lastActiveMs) <= maxIdleMs;
}

/**
 * Check if a session is genuinely alive on the local workstation.
 */
function isSessionAlive(sess, maxIdleMs = 45 * 60 * 1000) {
  if (!sess || !sess.workspace_root) return false;
  if (!isRealWorkspace(sess.workspace_root)) return false;

  const now = Date.now();
  const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID ||
                        process.env.GEMINI_CONVERSATION_ID ||
                        null;
  const cwd = path.normalize(process.cwd());

  // Current active environment session is always alive
  if (currentConvId && sess.session_id === currentConvId && sess.workspace_root === cwd) {
    return true;
  }

  // Check last_active_at timestamp freshness
  let lastActiveMs = 0;
  if (sess.last_active_at) {
    const d = new Date(sess.last_active_at.endsWith('Z') ? sess.last_active_at : sess.last_active_at + 'Z');
    if (!isNaN(d.getTime())) {
      lastActiveMs = d.getTime();
    }
  }

  if (lastActiveMs > 0 && (now - lastActiveMs) > maxIdleMs) {
    return false;
  }

  const clientNorm = (sess.client || '').toLowerCase();
  if (clientNorm === 'antigravity' || clientNorm === 'agy') {
    return _isAntigravitySessionAlive(sess, lastActiveMs, now, maxIdleMs);
  }

  // For OMP Agent sessions, check active session file freshness
  if (clientNorm === 'omp') {
    const ompSess = findOmpSessionForWorkspace(sess.workspace_root);
    if (ompSess) {
      return (now - ompSess.mtimeMs) <= maxIdleMs;
    }
  }

  // For Claude Code sessions, check transcript freshness if path exists
  if (clientNorm === 'claudecode' || clientNorm === 'claude') {
    if (sess.transcript_path && fs.existsSync(sess.transcript_path)) {
      try {
        const mtime = fs.statSync(sess.transcript_path).mtimeMs;
        return (now - mtime) <= maxIdleMs;
      } catch (_) {
        // Transcript access fallback
      }
    }
  }

  // Fallback for manual or generic sessions: check last_active_at
  return lastActiveMs > 0 && (now - lastActiveMs) <= maxIdleMs;
}

/**
 * Automatically touch and register current active environment session into active_sessions.
 */
function touchCurrentSession(conn) {
  try {
    const cwd = path.normalize(process.cwd());
    if (!isRealWorkspace(cwd)) return;

    const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID ||
                          process.env.GEMINI_CONVERSATION_ID ||
                          null;
    const now = new Date().toISOString();
    const pHash = personaMemory.computeProjectHash(cwd);

    if (currentConvId) {
      conn.prepare(`
        INSERT INTO active_sessions (client, workspace_root, session_id, project_hash, transcript_path, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(client, workspace_root, session_id) DO UPDATE SET
          last_active_at = excluded.last_active_at,
          project_hash = COALESCE(excluded.project_hash, active_sessions.project_hash)
      `).run('antigravity', cwd, currentConvId, pHash, null, now);
      return;
    }

    // Check if running under OMP or OMP session exists for current workspace
    const ompSess = findOmpSessionForWorkspace(cwd);
    if (ompSess && (Date.now() - ompSess.mtimeMs) <= (2 * 3600 * 1000)) {
      const ompSessionId = path.parse(ompSess.name).name;
      conn.prepare(`
        INSERT INTO active_sessions (client, workspace_root, session_id, project_hash, transcript_path, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(client, workspace_root, session_id) DO UPDATE SET
          last_active_at = excluded.last_active_at,
          project_hash = COALESCE(excluded.project_hash, active_sessions.project_hash)
      `).run('omp', cwd, ompSessionId, pHash, ompSess.path, now);
      return;
    }
  } catch (_) { /* ignore */ }
}

function _resolveCurrentWorkspaceSession(cwd) {
  const ompSess = findOmpSessionForWorkspace(cwd);
  if (process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.GEMINI_CONVERSATION_ID) {
    return {
      client: 'antigravity',
      sessId: process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.GEMINI_CONVERSATION_ID
    };
  }
  if (ompSess) {
    return { client: 'omp', sessId: path.parse(ompSess.name).name };
  }
  try {
    const cd = require('../mcp/client_detection');
    const det = cd.detectActiveClient();
    if (det && det !== 'unattributed' && det !== 'unknown') {
      return { client: CANONICAL_CLIENT_MAP[det] || det, sessId: 'default' };
    }
  } catch (_) { /* ignore */ }
  return { client: 'antigravity', sessId: 'default' };
}

/**
 * Retrieve ONLY genuinely active sessions from database.
 */
function getActiveSessions() {
  const conn = dbModule.getConnection();
  ensureTable(conn);
  touchCurrentSession(conn);

  try {
    const rows = conn.prepare(`
      SELECT client, workspace_root, session_id, project_hash, transcript_path, last_active_at
      FROM active_sessions
      ORDER BY last_active_at DESC
      LIMIT 50
    `).all();

    const seen = new Set();
    const sessions = [];

    for (const r of rows) {
      if (!r.client || IGNORED_CLIENTS.has(r.client.toLowerCase())) continue;
      if (!isRealWorkspace(r.workspace_root)) continue;

      // Filter: only genuinely active sessions
      if (!isSessionAlive(r)) continue;

      let normClient = CANONICAL_CLIENT_MAP[r.client.toLowerCase()] || r.client.toLowerCase();
      const normWs = path.normalize(r.workspace_root);
      const key = `${normClient}:${normWs}:${r.session_id || 'default'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      sessions.push({
        index: sessions.length + 1,
        client: normClient,
        workspace_root: normWs,
        session_id: r.session_id || 'default',
        project_hash: r.project_hash || '',
        last_active_at: r.last_active_at || ''
      });
    }

    // Always ensure current workspace is present
    const cwd = path.normalize(process.cwd());
    const hasCwd = sessions.some(s => s.workspace_root === cwd);
    if (!hasCwd && isRealWorkspace(cwd)) {
      const { client: detectedClient, sessId } = _resolveCurrentWorkspaceSession(cwd);
      sessions.unshift({
        index: 1,
        client: detectedClient,
        workspace_root: cwd,
        session_id: sessId,
        project_hash: personaMemory.computeProjectHash(cwd),
        last_active_at: new Date().toISOString()
      });
      // Re-index
      sessions.forEach((s, i) => { s.index = i + 1; });
    }

    if (sessions.length === 0) {
      const { client: detectedClient, sessId } = _resolveCurrentWorkspaceSession(cwd);
      sessions.push({
        index: 1,
        client: detectedClient,
        workspace_root: cwd,
        session_id: sessId,
        project_hash: personaMemory.computeProjectHash(cwd),
        last_active_at: new Date().toISOString()
      });
    }

    return sessions;
  } catch (_) {
    const cwd = path.normalize(process.cwd());
    const { client: detectedClient, sessId } = _resolveCurrentWorkspaceSession(cwd);
    return [{
      index: 1,
      client: detectedClient,
      workspace_root: cwd,
      session_id: sessId,
      project_hash: personaMemory.computeProjectHash(cwd),
      last_active_at: new Date().toISOString()
    }];
  }
}

/**
 * Get active target session for a Telegram chat.
 */
function getTargetSession(chatId) {
  const conn = dbModule.getConnection();
  ensureTable(conn);
  const cId = String(chatId);
  const sessions = getActiveSessions();

  try {
    const row = conn.prepare(`
      SELECT client, workspace_root, session_id, updated_at
      FROM telegram_session_targets
      WHERE chat_id = ?
    `).get(cId);

    if (row && row.workspace_root && isRealWorkspace(row.workspace_root)) {
      const matched = sessions.find(s => s.session_id === row.session_id) ||
                      sessions.find(s => s.client === row.client && s.workspace_root === row.workspace_root);
      if (matched) {
        return {
          client: matched.client,
          workspace_root: matched.workspace_root,
          session_id: matched.session_id
        };
      }
      return {
        client: row.client,
        workspace_root: row.workspace_root,
        session_id: row.session_id
      };
    }
  } catch (_) { /* ignore */ }

  if (sessions.length > 0) {
    return {
      client: sessions[0].client,
      workspace_root: sessions[0].workspace_root,
      session_id: sessions[0].session_id
    };
  }

  const currentConvId = process.env.ANTIGRAVITY_CONVERSATION_ID ||
                        process.env.GEMINI_CONVERSATION_ID ||
                        'default';
  return {
    client: 'antigravity',
    workspace_root: process.cwd(),
    session_id: currentConvId
  };
}

/**
 * Set target session by 1-based index number: /session <number>.
 */
function setTargetSession(chatId, selector) {
  if (!selector || typeof selector !== 'string' || !selector.trim()) {
    return {
      success: false,
      error: 'Please specify a session number (e.g. /session 1).'
    };
  }

  const clean = selector.trim();
  const sessions = getActiveSessions();

  // Strictly parse by 1-based index number
  const idx = parseInt(clean, 10);
  if (isNaN(idx) || idx < 1 || idx > sessions.length) {
    return {
      success: false,
      error: `Invalid session number "${clean}". Choose a number between 1 and ${sessions.length}.`,
      sessionsCount: sessions.length
    };
  }

  const matched = sessions[idx - 1];
  const conn = dbModule.getConnection();
  ensureTable(conn);
  const now = new Date().toISOString();

  try {
    conn.prepare(`
      INSERT OR REPLACE INTO telegram_session_targets (chat_id, client, workspace_root, session_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(chatId), matched.client, matched.workspace_root, matched.session_id, now);

    return {
      success: true,
      session: matched,
      index: idx
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to save session: ${err.message}`
    };
  }
}

const sessionCommands = require('./session_commands');

function createSession(chatId, clientInput, pathInput) {
  return sessionCommands.createSession(chatId, clientInput, pathInput, {
    canonicalMap: CANONICAL_CLIENT_MAP,
    ensureTableFn: ensureTable,
    getActiveSessionsFn: getActiveSessions
  });
}

function deleteSession(chatId, selector) {
  return sessionCommands.deleteSession(chatId, selector, {
    getActiveSessionsFn: getActiveSessions
  });
}

function formatSessionList(chatId) {
  return sessionCommands.formatSessionList(chatId, {
    getActiveSessionsFn: getActiveSessions,
    getTargetSessionFn: getTargetSession,
    displayNames: CLIENT_DISPLAY_NAMES,
    formatTimeAgoFn: formatTimeAgo
  });
}

module.exports = {
  CLIENT_DISPLAY_NAMES,
  CANONICAL_CLIENT_MAP,
  ensureTable,
  isRealWorkspace,
  isSessionAlive,
  touchCurrentSession,
  getActiveSessions,
  getTargetSession,
  setTargetSession,
  createSession,
  deleteSession,
  formatSessionList,
  formatTimeAgo
};
