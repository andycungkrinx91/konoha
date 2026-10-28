'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const dbModule = require('../db');
const personaMemory = require('../persona_memory');

/**
 * Create/register and immediately target a session: /session create <client> <path>.
 */
function createSession(chatId, clientInput, pathInput, helpers = {}) {
  const {
    canonicalMap = {},
    ensureTableFn = () => {},
    getActiveSessionsFn = () => []
  } = helpers;

  if (!clientInput || typeof clientInput !== 'string' || !clientInput.trim()) {
    return {
      success: false,
      error: 'Client name is required (e.g. agy, antigravity, claude, codex, pi, opencode, commandcode, omp).'
    };
  }

  const cleanClient = clientInput.trim().toLowerCase();
  const canonicalClient = canonicalMap[cleanClient];
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

  if (resolvedPath.startsWith('~/') || resolvedPath.startsWith('~\\') || resolvedPath === '~') {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(1).replace(/^[/\\]+/, ''));
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

  const normHome = path.normalize(os.homedir());
  const isHome = process.platform === 'win32'
    ? resolvedPath.toLowerCase() === normHome.toLowerCase()
    : resolvedPath === normHome;
  if (isHome) {
    return {
      success: false,
      error: `Cannot use home directory (${os.homedir()}) as project workspace.`
    };
  }

  const normTmp = path.normalize(os.tmpdir());
  const isTmp = process.platform === 'win32'
    ? (resolvedPath.toLowerCase() === normTmp.toLowerCase() || resolvedPath.toLowerCase().startsWith(normTmp.toLowerCase() + path.sep))
    : (resolvedPath === normTmp || resolvedPath === '/tmp' || resolvedPath.startsWith('/tmp/') || resolvedPath.startsWith(normTmp + path.sep));
  if (isTmp) {
    return {
      success: false,
      error: 'Cannot use temporary directory as project workspace.'
    };
  }

  if (resolvedPath.includes('/.konoha') || resolvedPath.includes('\\.konoha')) {
    return {
      success: false,
      error: 'Cannot use internal .konoha directory as project workspace.'
    };
  }

  const conn = dbModule.getConnection();
  ensureTableFn(conn);
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

  const sessions = getActiveSessionsFn();
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
function deleteSession(chatId, selector, helpers = {}) {
  const { getActiveSessionsFn = () => [] } = helpers;

  if (!selector || typeof selector !== 'string' || !selector.trim()) {
    return {
      success: false,
      error: 'Please specify a session number to delete (e.g. /session delete 2).'
    };
  }

  const clean = selector.trim();
  const sessions = getActiveSessionsFn();
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

    const remaining = getActiveSessionsFn();
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
function formatSessionList(chatId, helpers = {}) {
  const {
    getActiveSessionsFn = () => [],
    getTargetSessionFn = () => null,
    displayNames = {},
    formatTimeAgoFn = s => s
  } = helpers;

  const sessions = getActiveSessionsFn();
  const current = getTargetSessionFn(chatId);

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
    const clientName = displayNames[s.client.toLowerCase()] || s.client;
    const badge = isCurrent ? ' <b>(CURRENT TARGET)</b>' : '';
    const timeAgo = formatTimeAgoFn(s.last_active_at);

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
  createSession,
  deleteSession,
  formatSessionList
};
