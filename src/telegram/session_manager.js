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
    try {
      const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
      let newest = null;
      let newestMtime = 0;
      for (const f of files) {
        const full = path.join(sessDir, f);
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs > newestMtime) {
            newestMtime = st.mtimeMs;
            newest = { path: full, name: f, mtimeMs: st.mtimeMs };
          }
        } catch (_) {
          // File access race fallback
        }
      }
      if (newest) return newest;
    } catch (_) {
      // Directory read error fallback
    }
  }
  return null;
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

  // 1. Current active environment session is always alive
  if (currentConvId && sess.session_id === currentConvId && sess.workspace_root === cwd) {
    return true;
  }

  // 2. Check last_active_at timestamp freshness
  let lastActiveMs = 0;
  if (sess.last_active_at) {
    const d = new Date(sess.last_active_at.endsWith('Z') ? sess.last_active_at : sess.last_active_at + 'Z');
    if (!isNaN(d.getTime())) {
      lastActiveMs = d.getTime();
    }
  }

  // If last_active_at is older than maxIdleMs, it is definitely not actively used
  if (lastActiveMs > 0 && (now - lastActiveMs) > maxIdleMs) {
    return false;
  }

  // 3. For Antigravity sessions, check brain directory and transcript freshness
  const clientNorm = (sess.client || '').toLowerCase();
  if (clientNorm === 'antigravity' || clientNorm === 'agy') {
    const brainCli = sess.session_id && sess.session_id !== 'default'
      ? path.join(os.homedir(), '.gemini/antigravity-cli/brain', sess.session_id)
      : null;
    const brainIde = sess.session_id && sess.session_id !== 'default'
      ? path.join(os.homedir(), '.gemini/antigravity-ide/brain', sess.session_id)
      : null;
    const brainDir = (brainCli && fs.existsSync(brainCli)) ? brainCli : ((brainIde && fs.existsSync(brainIde)) ? brainIde : null);

    if (brainDir) {
      let newestMtime = 0;
      const transcriptPath = path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
      const promptPath = path.join(brainDir, 'prompt.md');
      if (fs.existsSync(transcriptPath)) {
        try {
          newestMtime = Math.max(newestMtime, fs.statSync(transcriptPath).mtimeMs);
        } catch (_) {
          // Transcript access fallback
        }
      }
      if (fs.existsSync(promptPath)) {
        try {
          newestMtime = Math.max(newestMtime, fs.statSync(promptPath).mtimeMs);
        } catch (_) {
          // Prompt access fallback
        }
      }
      if (newestMtime > 0) {
        return (now - newestMtime) <= maxIdleMs;
      }
    }

    // When brainDir is absent (e.g. session created via Telegram, remote ingress, mock test, or new session),
    // rely on last_active_at freshness and workspace directory existence
    return lastActiveMs > 0 && (now - lastActiveMs) <= maxIdleMs;
  }

  // 4. For OMP Agent sessions, check active session file freshness
  if (clientNorm === 'omp') {
    const ompSess = findOmpSessionForWorkspace(sess.workspace_root);
    if (ompSess) {
      return (now - ompSess.mtimeMs) <= maxIdleMs;
    }
  }

  // 5. For Claude Code sessions, check transcript freshness if path exists
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

  // 6. Fallback for manual or generic sessions: check last_active_at
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
      const ompSess = findOmpSessionForWorkspace(cwd);
      let detectedClient = 'omp';
      let sessId = 'default';
      if (process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.GEMINI_CONVERSATION_ID) {
        detectedClient = 'antigravity';
        sessId = process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.GEMINI_CONVERSATION_ID;
      } else if (ompSess) {
        detectedClient = 'omp';
        sessId = path.parse(ompSess.name).name;
      } else {
        try {
          const cd = require('../mcp/client_detection');
          const det = cd.detectActiveClient();
          if (det && det !== 'unattributed' && det !== 'unknown') {
            detectedClient = CANONICAL_CLIENT_MAP[det] || det;
          } else {
            detectedClient = 'antigravity';
          }
        } catch (_) {
          detectedClient = 'antigravity';
        }
      }

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
      const ompSess = findOmpSessionForWorkspace(cwd);
      let detectedClient = ompSess ? 'omp' : 'antigravity';
      let sessId = ompSess ? path.parse(ompSess.name).name : 'default';
      try {
        const cd = require('../mcp/client_detection');
        const det = cd.detectActiveClient();
        if (det && det !== 'unattributed' && det !== 'unknown') {
          detectedClient = CANONICAL_CLIENT_MAP[det] || det;
        }
      } catch (_) {
        /* fallback to default detected client */
      }
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
    const ompSess = findOmpSessionForWorkspace(cwd);
    let detectedClient = ompSess ? 'omp' : 'antigravity';
    let sessId = ompSess ? path.parse(ompSess.name).name : 'default';
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

/**
 * Create/register and immediately target a session: /session create <client> <path>.
 */
function createSession(chatId, clientInput, pathInput) {
  if (!clientInput || typeof clientInput !== 'string' || !clientInput.trim()) {
    return {
      success: false,
      error: 'Client name is required (e.g. agy, antigravity, claude, codex, pi, opencode, commandcode, omp).'
    };
  }

  const cleanClient = clientInput.trim().toLowerCase();
  const canonicalClient = CANONICAL_CLIENT_MAP[cleanClient];
  if (!canonicalClient) {
    return {
      success: false,
      error: `Unsupported client "${clientInput}". Supported: agy, antigravity, claude, codex, pi, opencode, commandcode, cursor, omp.`
    };
  }

  if (!pathInput || typeof pathInput !== 'string' || !pathInput.trim()) {
    return {
      success: false,
      error: 'Workspace directory path is required.'
    };
  }

  let resolvedPath = pathInput.trim();
  if ((resolvedPath.startsWith('"') && resolvedPath.endsWith('"')) ||
      (resolvedPath.startsWith("'") && resolvedPath.endsWith("'"))) {
    resolvedPath = resolvedPath.slice(1, -1).trim();
  }

  if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
  } else if (!path.isAbsolute(resolvedPath)) {
    resolvedPath = path.resolve(process.cwd(), resolvedPath);
  }
  resolvedPath = path.normalize(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      error: `Directory does not exist: "${resolvedPath}".`
    };
  }

  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err) {
    return {
      success: false,
      error: `Cannot access path "${resolvedPath}": ${err.message}`
    };
  }

  if (!stat.isDirectory()) {
    return {
      success: false,
      error: `Path is not a directory: "${resolvedPath}".`
    };
  }

  if (resolvedPath === path.normalize(os.homedir())) {
    return {
      success: false,
      error: `Cannot use home directory (${os.homedir()}) as project workspace.`
    };
  }

  if (resolvedPath === path.normalize(os.tmpdir()) || resolvedPath === '/tmp' || resolvedPath.startsWith('/tmp/')) {
    return {
      success: false,
      error: 'Cannot use /tmp directory as project workspace.'
    };
  }

  if (resolvedPath.includes('/.konoha')) {
    return {
      success: false,
      error: 'Cannot use internal .konoha directory as project workspace.'
    };
  }

  const conn = dbModule.getConnection();
  ensureTable(conn);
  const now = new Date().toISOString();
  const sessionId = `sess_${canonicalClient}_${Date.now()}`;
  const pHash = personaMemory.computeProjectHash(resolvedPath);
  try {
    personaMemory.saveOrUpdateProject(resolvedPath);
  } catch (_) { /* non-fatal best effort */ }

  try {
    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, project_hash, transcript_path, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(client, workspace_root, session_id) DO UPDATE SET
        last_active_at = excluded.last_active_at,
        project_hash = excluded.project_hash
    `).run(canonicalClient, resolvedPath, sessionId, pHash, null, now);
  } catch (err) {
    return {
      success: false,
      error: `Failed to save session to active_sessions: ${err.message}`
    };
  }

  try {
    conn.prepare(`
      INSERT OR REPLACE INTO telegram_session_targets (chat_id, client, workspace_root, session_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(chatId), canonicalClient, resolvedPath, sessionId, now);
  } catch (err) {
    return {
      success: false,
      error: `Failed to save session target: ${err.message}`
    };
  }

  const sessions = getActiveSessions();
  const found = sessions.find(s => s.session_id === sessionId) ||
                sessions.find(s => s.workspace_root === resolvedPath && s.client === canonicalClient);
  const idx = found ? found.index : 1;

  return {
    success: true,
    session: {
      client: canonicalClient,
      workspace_root: resolvedPath,
      session_id: sessionId,
      project_hash: pHash
    },
    index: idx,
    totalSessions: sessions.length
  };
}

/**
 * Delete a session from active_sessions by index or session_id.
 */
function deleteSession(chatId, selector) {
  if (!selector || typeof selector !== 'string' || !selector.trim()) {
    return {
      success: false,
      error: 'Please specify a session number to delete (e.g. /session delete 2).'
    };
  }

  const clean = selector.trim();
  const sessions = getActiveSessions();
  const idx = parseInt(clean, 10);
  let targetSess = null;

  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    targetSess = sessions[idx - 1];
  } else {
    targetSess = sessions.find(s => s.session_id === clean);
  }

  if (!targetSess) {
    return {
      success: false,
      error: `Session "${clean}" not found. Available sessions: 1 to ${sessions.length}.`
    };
  }

  const conn = dbModule.getConnection();
  try {
    conn.prepare(`
      DELETE FROM active_sessions
      WHERE client = ? AND workspace_root = ? AND session_id = ?
    `).run(targetSess.client, targetSess.workspace_root, targetSess.session_id);

    // If active target for this chat was deleted, re-target to first remaining session
    const remaining = getActiveSessions();
    if (remaining.length > 0) {
      conn.prepare(`
        INSERT OR REPLACE INTO telegram_session_targets (chat_id, client, workspace_root, session_id, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(String(chatId), remaining[0].client, remaining[0].workspace_root, remaining[0].session_id);
    } else {
      conn.prepare(`DELETE FROM telegram_session_targets WHERE chat_id = ?`).run(String(chatId));
    }

    return {
      success: true,
      removedSession: targetSess,
      totalSessions: remaining.length
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to delete session: ${err.message}`
    };
  }
}

/**
 * Format HTML list of active sessions for Telegram.
 */
function formatSessionList(chatId) {
  const sessions = getActiveSessions();
  const current = getTargetSession(chatId);

  const lines = [
    '<b>🎛️ [ACTIVE SESSIONS & WORKSPACES]</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Select a session number to route tasks to that specific workspace & client.',
    '',
    '<b>📋 Available Active Sessions:</b>'
  ];

  let targetIndex = -1;
  if (current) {
    if (current.session_id && current.session_id !== 'default') {
      targetIndex = sessions.findIndex(s => s.session_id === current.session_id);
    }
    if (targetIndex === -1 && current.client && current.workspace_root) {
      targetIndex = sessions.findIndex(s => s.client === current.client && s.workspace_root === current.workspace_root);
    }
    if (targetIndex === -1 && sessions.length > 0) {
      targetIndex = 0;
    }
  }

  sessions.forEach((s, idx) => {
    const isCurrent = (idx === targetIndex);
    const clientName = CLIENT_DISPLAY_NAMES[s.client.toLowerCase()] || s.client;
    const badge = isCurrent ? ' <b>(CURRENT TARGET)</b>' : '';
    const timeAgo = formatTimeAgo(s.last_active_at);

    lines.push(`<b>[${s.index}] ${clientName}</b>${badge}`);
    lines.push(`    🔖 <b>Session ID:</b> <code>${s.session_id}</code>`);
    lines.push(`    📂 <code>${s.workspace_root}</code>`);
    lines.push(`    🕒 Active: ${timeAgo}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('<b>🎯 Switch:</b> <code>/session &lt;number&gt;</code>');
  lines.push(`<b>💡 Example:</b> <code>/session 1</code>${sessions.length > 1 ? ` or <code>/session 2</code>` : ''}`);
  lines.push('<b>➕ Create:</b> <code>/session create &lt;client&gt; &lt;path&gt;</code>');
  lines.push('<b>🗑️ Delete:</b> <code>/session delete &lt;number&gt;</code>');

  return lines.join('\n');
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
