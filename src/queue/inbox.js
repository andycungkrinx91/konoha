/**
 * Unified Inbound Prompt Queue & Inbox Engine.
 * Synchronizes SQLite prompt_queue records with local filesystem mirrors in ~/.konoha/inbox/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const dbModule = require('../db');

function getInboxDir() {
  const dir = path.join(os.homedir(), '.konoha', 'inbox');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function generateTaskId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 7);
  return `task_${ts}_${rand}`;
}

/**
 * Enqueue a new prompt into SQLite and update filesystem mirror.
 */
function enqueuePrompt({ prompt, source = 'web_ui', sender_info = '', session_id = 'default', workspace_root = '', client = '' }) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Prompt cannot be empty');
  }

  const conn = dbModule.getConnection();
  const id = generateTaskId();
  const now = new Date().toISOString();
  const cleanPrompt = prompt.trim();
  const cleanSession = session_id || 'default';
  const cleanWs = workspace_root || '';
  const cleanClient = client || '';

  conn.prepare(`
    INSERT INTO prompt_queue (
      id, source, sender_info, prompt, status, session_id, workspace_root, client, created_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(id, source, String(sender_info || ''), cleanPrompt, cleanSession, cleanWs, cleanClient, now);

  // Write filesystem mirror
  try {
    const inboxDir = getInboxDir();
    const payload = JSON.stringify({
      id,
      prompt: cleanPrompt,
      source,
      sender_info,
      session_id: cleanSession,
      workspace_root: cleanWs,
      client: cleanClient,
      status: 'pending',
      created_at: now
    }, null, 2);

    fs.writeFileSync(path.join(inboxDir, `${cleanSession}.json`), payload, 'utf8');
    fs.writeFileSync(path.join(inboxDir, 'latest.json'), payload, 'utf8');
  } catch (_) { /* best-effort filesystem mirror */ }

  return {
    id,
    source,
    prompt: cleanPrompt,
    status: 'pending',
    session_id: cleanSession,
    workspace_root: cleanWs,
    client: cleanClient,
    created_at: now
  };
}

/**
 * Get next pending prompt from queue.
 */
function getNextPendingPrompt(session_id = null) {
  const conn = dbModule.getConnection();
  if (session_id) {
    return conn.prepare(`
      SELECT * FROM prompt_queue
      WHERE status = 'pending' AND session_id = ?
      ORDER BY created_at ASC LIMIT 1
    `).get(session_id) || null;
  }

  return conn.prepare(`
    SELECT * FROM prompt_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC LIMIT 1
  `).get() || null;
}

/**
 * Atomically claim next pending prompt for execution.
 * Prevents conflicts and race conditions when multiple client sessions run concurrently
 * (e.g. 2 Antigravity sessions or 1 Antigravity + 1 Claude Code).
 */
function claimNextPendingPrompt({ client = 'default', session_id = null } = {}) {
  const conn = dbModule.getConnection();
  const now = new Date().toISOString();
  let claimed = null;

  const tx = conn.transaction(() => {
    let row = null;
    if (session_id) {
      row = conn.prepare(`
        SELECT * FROM prompt_queue
        WHERE status = 'pending' AND (session_id = ? OR session_id = 'default' OR session_id = '')
        ORDER BY created_at ASC LIMIT 1
      `).get(session_id);
    }
    if (!row) {
      row = conn.prepare(`
        SELECT * FROM prompt_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      `).get();
    }

    if (row) {
      conn.prepare(`
        UPDATE prompt_queue
        SET status = 'processing', processed_at = ?, session_id = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, session_id || row.session_id || client, row.id);
      claimed = { ...row, status: 'processing', processed_at: now, session_id: session_id || row.session_id };
    }
  });

  tx();
  return claimed;
}

/**
 * Mark prompt as processing.
 */
function markPromptProcessing(id) {
  const conn = dbModule.getConnection();
  const now = new Date().toISOString();
  conn.prepare(`
    UPDATE prompt_queue
    SET status = 'processing', processed_at = ?
    WHERE id = ?
  `).run(now, id);
}

/**
 * Mark prompt as completed or failed and clean up mirror.
 */
function completePrompt(id, {
  result_summary = '',
  token_savings_percent = 0,
  kage_confidence_score = 0,
  status = 'completed'
} = {}) {
  const conn = dbModule.getConnection();
  const now = new Date().toISOString();
  const cleanStatus = ['completed', 'failed', 'cancelled'].includes(status) ? status : 'completed';

  conn.prepare(`
    UPDATE prompt_queue
    SET status = ?,
        result_summary = ?,
        token_savings_percent = ?,
        kage_confidence_score = ?,
        completed_at = ?
    WHERE id = ?
  `).run(
    cleanStatus,
    String(result_summary || ''),
    Number(token_savings_percent) || 0,
    Number(kage_confidence_score) || 0,
    now,
    id
  );

  // Clean up session mirror if present
  try {
    const row = conn.prepare('SELECT session_id FROM prompt_queue WHERE id = ?').get(id);
    if (row && row.session_id) {
      const inboxFile = path.join(getInboxDir(), `${row.session_id}.json`);
      if (fs.existsSync(inboxFile)) {
        try {
          const current = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
          if (current.id === id) {
            fs.unlinkSync(inboxFile);
          }
        } catch (_fileErr) {
          /* ignore unlinking error */
        }
      }
    }
  } catch (_dbErr) {
    /* ignore session lookup error */
  }
}

/**
 * List recent prompts for API/dashboard.
 */
function listPrompts({ limit = 20, status = null } = {}) {
  const conn = dbModule.getConnection();
  const max = Math.max(1, Math.min(100, Number(limit) || 20));

  if (status) {
    return conn.prepare(`
      SELECT * FROM prompt_queue
      WHERE status = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(status, max);
  }

  return conn.prepare(`
    SELECT * FROM prompt_queue
    ORDER BY created_at DESC LIMIT ?
  `).all(max);
}

/**
 * Retrieve single prompt by ID.
 */
function getPromptById(id) {
  const conn = dbModule.getConnection();
  return conn.prepare('SELECT * FROM prompt_queue WHERE id = ?').get(id) || null;
}

module.exports = {
  getInboxDir,
  enqueuePrompt,
  getNextPendingPrompt,
  claimNextPendingPrompt,
  markPromptProcessing,
  completePrompt,
  listPrompts,
  getPromptById
};
