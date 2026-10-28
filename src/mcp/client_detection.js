/**
 * src/mcp/client_detection.js — Active client, agent, and session detection.
 * 
 * CRITICAL INVARIANT (PLAN_REFACTOR.md §2):
 * Reads runtime state via getWorkspaceRoot() and getActiveClient().
 * Never exports or imports mutable state by value.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const db = require("../db");
const personaMemory = require("../persona_memory");
const {
  getWorkspaceRoot,
  getActiveClient,
  KONOHA_DIR,
  GEMINI_DIR,
  CURSOR_DIR,
  CLAUDE_DIR
} = require("./runtime_state");

const ANTIGRAVITY_CLI = path.join(GEMINI_DIR, "antigravity-cli");
const ANTIGRAVITY_IDE = path.join(GEMINI_DIR, "antigravity-ide");
const ANTIGRAVITY_CLI_BRAIN = path.join(ANTIGRAVITY_CLI, "brain");
const ANTIGRAVITY_IDE_BRAIN = path.join(ANTIGRAVITY_IDE, "brain");
const CURSOR_PROJECTS = path.join(CURSOR_DIR, "projects");
const CLAUDE_PROJECTS = path.join(CLAUDE_DIR, "projects");

function getDb() {
  return db.getConnection();
}

function matchesPattern(pattern, entry) {
  if (pattern.endsWith('*.jsonl') && entry.endsWith('.jsonl')) return true;
  if (pattern.endsWith('*.json') && entry.endsWith('.json')) return true;
  if (pattern.endsWith('prompt.md') && entry === 'prompt.md') return true;
  return Boolean(pattern.endsWith('transcript.jsonl') && entry === 'transcript.jsonl');
}

function walkEntry(full, entry, pattern, results) {
  try {
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDir(full, pattern, results);
    else if (st.isFile() && matchesPattern(pattern, entry)) results.push(full);
  } catch (_) { /* ignore */ }
}

function walkDir(dir, pattern, results) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return; }
  for (const entry of entries) {
    walkEntry(path.join(dir, entry), entry, pattern, results);
  }
}

function globSync(pattern) {
  const parts = pattern.split('*');
  if (parts.length === 1) {
    return fs.existsSync(pattern) ? [pattern] : [];
  }
  const baseDir = parts[0];
  if (!fs.existsSync(baseDir)) return [];
  const results = [];
  walkDir(baseDir, pattern, results);
  return results;
}


function detectActiveClient() {
  try {
    if (getActiveClient()) return getActiveClient();
    const activeOverride = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || '').toLowerCase().trim();
    if (activeOverride) {
      if (activeOverride.includes('codex') || activeOverride.includes('openai')) return 'codex';
      if (activeOverride.includes('omp')) return 'omp';
      if (activeOverride.includes('commandcode') || activeOverride.includes('command-code')) return 'commandcode';
      if (activeOverride.includes('opencode')) return 'opencode';
      if (activeOverride.includes('claude')) return 'claudecode';
      if (activeOverride.includes('cursor')) return 'cursor';
      if (activeOverride.includes('pi.dev') || activeOverride === 'pi' || activeOverride.endsWith('-pi') || activeOverride.includes('pi-')) return 'pi';
      if (activeOverride.includes('agy') || activeOverride.includes('antigravity-cli')) return 'agy';
      if (activeOverride.includes('antigravity') || activeOverride.includes('ide')) return 'antigravity';
    }

    if (process.env.CODEX_SESSION || process.env.CODEX_THREAD_ID || process.env.CODEX_CI) return 'codex';
    if (process.env.OMP_SESSION || process.env.OMP_SESSION_ID || process.env.OMP_CLIENT || process.env.OMP_AGENT) return 'omp';
    if (process.env.OPENCODE_CLIENT === '1' || process.env.OPENCODE_SESSION === '1' || process.env.OPENCODE_SESSION_ID) return 'opencode';
    if (process.env.COMMANDCODE_CLIENT === '1' || process.env.COMMANDCODE_SESSION === '1' || process.env.COMMANDCODE_SESSION_ID) return 'commandcode';
    if (process.env.CLAUDE_CODE_CHILD_SESSION === '1' || process.env.CLAUDE_CONVERSATION_ID) return 'claudecode';
    if (process.env.PI_CODING_AGENT || process.env.PI_SESSION_FILE || process.env.PI_SESSION_ID) return 'pi';
    if (process.env.CURSOR_SESSION_ID) return 'cursor';

    // Check environment variable for Antigravity
    const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
    if (convId) {
      if (process.env.CLAUDE_CODE_CHILD_SESSION === '1' || process.env.CLAUDE_CONVERSATION_ID) return 'claudecode';
      if (process.env.PI_CODING_AGENT || process.env.PI_SESSION_FILE || process.env.PI_SESSION_ID) return 'pi';
      if ((process.env.ANTIGRAVITY_LS_VERSION || '').startsWith('cli') || (process.env.ANTIGRAVITY_AGENTAPI_EXE || '').includes('agy')) return 'agy';
      const cliDir = path.join(ANTIGRAVITY_CLI_BRAIN, convId);
      if (fs.existsSync(cliDir) && fs.statSync(cliDir).isDirectory()) return 'agy';
      const ideDir = path.join(ANTIGRAVITY_IDE_BRAIN, convId);
      if (fs.existsSync(ideDir) && fs.statSync(ideDir).isDirectory()) return 'antigravity';
      return 'agy';
    }

    // No hard session signal: attribute HONESTLY instead of guessing from
    // filesystem mtimes (the old heuristic misattributed calls across clients
    // and corrupted the per-provider savings breakdown).
    return 'unattributed';
  } catch (_) {
    return 'unattributed';
  }
}

function _collectBrainFiles(client, convId) {
  const brainDirs = [];
  if (convId) {
    brainDirs.push(path.join(ANTIGRAVITY_IDE_BRAIN, convId));
    brainDirs.push(path.join(ANTIGRAVITY_CLI_BRAIN, convId));
  }
  if (client === 'claudecode') brainDirs.push(CLAUDE_PROJECTS);
  else if (client === 'cursor') brainDirs.push(CURSOR_PROJECTS);
  else {
    if (!brainDirs.includes(CURSOR_PROJECTS)) brainDirs.push(CURSOR_PROJECTS);
    if (!brainDirs.includes(CLAUDE_PROJECTS)) brainDirs.push(CLAUDE_PROJECTS);
    if (!brainDirs.includes(ANTIGRAVITY_IDE_BRAIN)) brainDirs.push(ANTIGRAVITY_IDE_BRAIN);
    if (!brainDirs.includes(ANTIGRAVITY_CLI_BRAIN)) brainDirs.push(ANTIGRAVITY_CLI_BRAIN);
  }

  const allFiles = [];
  for (const bDir of brainDirs) {
    if (!fs.existsSync(bDir)) continue;
    if (bDir.includes('cursor') || bDir.includes('claude')) {
      allFiles.push(...globSync(path.join(bDir, '*.jsonl')));
    } else if (convId && (bDir.includes('antigravity-ide') || bDir.includes('antigravity-cli'))) {
      const p1 = path.join(bDir, 'prompt.md');
      const p2 = path.join(bDir, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(p1)) allFiles.push(p1);
      if (fs.existsSync(p2)) allFiles.push(p2);
    } else {
      allFiles.push(...globSync(path.join(bDir, 'prompt.md')));
      allFiles.push(...globSync(path.join(bDir, 'transcript.jsonl')));
    }
  }

  const existingFiles = allFiles.filter(f => fs.existsSync(f));
  existingFiles.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (_) { return 0; }
  });
  return existingFiles;
}

function _parsePromptContentForAgent(promptContent) {
  const lower = promptContent.toLowerCase();
  if (lower.includes('[konoha] orchestrator active') || lower.includes('[konoha] active') || lower.includes('orchestrator active')) {
    return 'orchestrator';
  }
  const match = promptContent.match(/\[([^\]]+)\]\s+active/);
  if (match) {
    const parts = match[1].trim().split(/\s+/);
    const name = parts[parts.length - 1].toLowerCase();
    if (['anbu', 'genin', 'chunin', 'jonin', 'kage', 'tokubetsu-jonin'].includes(name)) return name;
    if (['antigravity', 'orchestrator'].includes(name)) return 'orchestrator';
  }
  for (const candidate of ['anbu', 'genin', 'chunin', 'tokubetsu-jonin', 'jonin', 'kage']) {
    if (new RegExp(`\\b${candidate}\\b`, 'i').test(promptContent)) {
      if (new RegExp(`you\\s+are\\s+(?:the|a)\\s+${candidate}\\s+(?:agent|subagent|scout|builder|intel|scribe|leader)`, 'i').test(promptContent)) {
        return candidate;
      }
      if (new RegExp(`Log:\\s*"\\[.*${candidate}.*\\]\\s*active"`, 'i').test(promptContent)) {
        return candidate;
      }
    }
  }
  return null;
}

function _detectFromPromptFile(convDir) {
  const promptPath = path.join(convDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) return null;
  try {
    return _parsePromptContentForAgent(fs.readFileSync(promptPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function extractContentFromBlocks(blocks) {
  let text = '';
  for (const block of blocks) {
    if (block?.type === 'text') text += ' ' + (block.text || '');
    else if (block?.type === 'tool_use' && block.name === 'Task' && block.input?.subagent_type) {
      return { subagentType: block.input.subagent_type, text: '' };
    }
  }
  return { subagentType: null, text };
}

function _parseTranscriptLine(line) {
  try {
    const data = JSON.parse(line);
    let content = data?.content || '';
    if (data?.message?.content && Array.isArray(data.message.content)) {
      const extracted = extractContentFromBlocks(data.message.content);
      if (extracted.subagentType) return extracted.subagentType;
      content = extracted.text;
    }
    if (!content) return null;

    const lower = content.toLowerCase();
    if (lower.includes('[konoha] orchestrator active') || lower.includes('[konoha] active') || lower.includes('orchestrator active')) {
      return 'orchestrator';
    }
    const match = content.match(/\[([^\]]+)\]\s+active/);
    if (match) {
      const parts = match[1].trim().split(/\s+/);
      const name = parts[parts.length - 1].toLowerCase().replace(/_/g, '-');
      if (['anbu', 'genin', 'chunin', 'jonin', 'kage', 'tokubetsu-jonin'].includes(name)) return name;
      if (['antigravity', 'orchestrator'].includes(name)) return 'orchestrator';
    }
  } catch (_) { /* ignore */ }
  return null;
}

function _detectFromTranscriptFile(fpath, convDir) {
  const isDirectTranscript = (fpath.includes('agent-transcripts') || fpath.includes('claude')) && fpath.endsWith('.jsonl');
  const transcriptPath = isDirectTranscript ? fpath : path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) return null;

  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const detected = _parseTranscriptLine(lines[i]);
      if (detected) return detected;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function resolveSessionIdForPath(fpath, convId) {
  if (convId) return convId;
  const parts = path.normalize(fpath).split(path.sep);
  const idx = parts.indexOf('agent-transcripts');
  if (idx !== -1 && idx + 1 < parts.length) return parts[idx + 1];
  if (parts.includes('claude')) return path.parse(fpath).name;
  return null;
}

function computeAndSaveProjectHash(wsRoot) {
  if (!wsRoot || wsRoot === 'unknown' || !fs.existsSync(wsRoot)) return '';
  try {
    const personaMemory = require('../persona_memory');
    const pHash = personaMemory.computeProjectHash(wsRoot) || '';
    personaMemory.saveOrUpdateProject(wsRoot);
    return pHash;
  } catch (_) {
    return '';
  }
}

function _saveActiveSession(fpath, convId) {
  const sessId = resolveSessionIdForPath(fpath, convId);
  if (!sessId) return;

  let conn = null;
  try {
    conn = getDb();
    conn.prepare(`
      CREATE TABLE IF NOT EXISTS active_sessions (
        client TEXT NOT NULL, workspace_root TEXT NOT NULL, session_id TEXT NOT NULL,
        project_hash TEXT, transcript_path TEXT, last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (client, workspace_root, session_id)
      )
    `).run();

    const actClient = getActiveClient() || 'unknown';
    const wsRoot = getWorkspaceRoot() || 'unknown';
    const pHash = computeAndSaveProjectHash(wsRoot);

    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, project_hash, transcript_path, last_active_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(client, workspace_root, session_id) DO UPDATE SET
        last_active_at = excluded.last_active_at,
        project_hash = COALESCE(excluded.project_hash, active_sessions.project_hash),
        transcript_path = COALESCE(excluded.transcript_path, active_sessions.transcript_path)
    `).run(actClient, wsRoot, sessId, pHash, fpath);
  } catch (err) {
    process.stderr.write(`  [Warning] Failed to write active session: ${err.message}\n`);
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  }
}

function _detectFromSessionDb() {
  if (!getWorkspaceRoot()) return null;
  let conn = null;
  try {
    conn = getDb();
    const row = conn.prepare(`
      SELECT session_id, transcript_path FROM active_sessions WHERE client = ? AND workspace_root = ?
    `).get(getActiveClient() || 'unknown', getWorkspaceRoot());
    if (row?.transcript_path && fs.existsSync(row.transcript_path)) {
      const lines = fs.readFileSync(row.transcript_path, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const detected = _parseTranscriptLine(lines[i]);
        if (detected) return detected;
      }
    }
  } catch (_) { /* ignore */ }
  finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  }
  return null;
}

function resolveConvDir(fpath) {
  if (fpath.endsWith('prompt.md')) return path.dirname(fpath);
  if (fpath.includes('agent-transcripts')) return path.dirname(path.dirname(fpath));
  if (fpath.includes('claude')) return path.dirname(fpath);
  return path.dirname(path.dirname(path.dirname(fpath)));
}

function detectActiveAgent() {
  try {
    const client = detectActiveClient();
    let convId = (client === 'agy' || client === 'antigravity') ? process.env.ANTIGRAVITY_CONVERSATION_ID : null;
    if (['cursor', 'claudecode', 'opencode', 'commandcode', 'omp'].includes(getActiveClient()) || ['cursor', 'claudecode', 'opencode', 'commandcode', 'omp'].includes(client)) {
      convId = null;
    }

    const existingFiles = _collectBrainFiles(client, convId);
    const visitedDirs = new Set();

    for (const fpath of existingFiles) {
      const convDir = path.normalize(resolveConvDir(fpath));
      if (visitedDirs.has(convDir)) continue;
      visitedDirs.add(convDir);

      let detected = _detectFromPromptFile(convDir);
      if (!detected) detected = _detectFromTranscriptFile(fpath, convDir);

      if (detected) {
        _saveActiveSession(fpath, convId);
        return detected;
      }
      if (visitedDirs.size >= 15) break;
    }

    const dbDetected = _detectFromSessionDb();
    if (dbDetected) return dbDetected;

    process.stderr.write(`[mcp konoha] detect_active_agent: no agent detected, returning null\n`);
    return null;
  } catch (e) {
    process.stderr.write(`[mcp konoha] detect_active_agent: fatal error: ${e.message}\n`);
    return null;
  }
}


function getActiveSessionId(workspaceRoot = null, client = null) {
  try {
    const runtimeState = require('./runtime_state');
    if (runtimeState.getActiveSessionId) {
      const explicit = runtimeState.getActiveSessionId();
      if (explicit) return explicit;
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  const curClient = client || getActiveClient() || detectActiveClient() || '';
  let sessId = '';
  if (curClient === 'agy' || curClient === 'antigravity') {
    sessId = process.env.ANTIGRAVITY_CONVERSATION_ID || '';
  } else if (curClient === 'claudecode') {
    sessId = process.env.CLAUDE_CONVERSATION_ID || process.env.CLAUDE_CODE_SESSION_ID || '';
  } else if (curClient === 'pi') {
    sessId = process.env.PI_SESSION_ID || '';
    if (!sessId && process.env.PI_SESSION_FILE) {
      try {
        const bn = path.basename(process.env.PI_SESSION_FILE, path.extname(process.env.PI_SESSION_FILE));
        if (bn) sessId = bn;
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  } else if (curClient === 'cursor') {
    sessId = process.env.CURSOR_SESSION_ID || '';
  } else if (curClient === 'opencode') {
    sessId = process.env.OPENCODE_SESSION_ID || '';
  } else if (curClient === 'commandcode') {
    sessId = process.env.COMMANDCODE_SESSION_ID || '';
  } else if (curClient === 'codex') {
    sessId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION || '';
  } else if (curClient === 'omp') {
    sessId = process.env.OMP_SESSION_ID || process.env.OMP_AGENT_ID || '';
  } else {
    sessId = process.env.SESSION_ID || process.env.KONOHA_SESSION_ID || '';
  }
  if (sessId) return sessId;

  let conn = null;
  try {
    conn = getDb();
    const ws = workspaceRoot || getWorkspaceRoot() || 'unknown';
    const cl = curClient || 'unknown';
    let pHash = '';
    try {
      const personaMemory = require('../persona_memory');
      pHash = ws !== 'unknown' ? personaMemory.computeProjectHash(ws) : '';
    } catch (_) { /* ignore */ }
    const row = conn.prepare(`
      SELECT session_id FROM active_sessions
      WHERE client = ? AND (workspace_root = ? OR (project_hash != '' AND project_hash = ?))
      ORDER BY last_active_at DESC LIMIT 1
    `).get(cl, ws, pHash || '');
    if (row && row.session_id) return row.session_id;
  } catch (_) { /* ignore */ } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return '';
}

function getKonohaTmpRoot(projectPath = null, sessionId = null) {
  let client = getActiveClient() || detectActiveClient() || 'unknown';
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const pHash = personaMemory.computeProjectHash(pPath) || 'global';
  let sess = sessionId || '';
  if (!sess) {
    try {
      sess = getActiveSessionId(pPath, client);
    } catch (_) { /* ignore */ }
  }
  if (!sess) sess = 'default';

  try {
    const target = path.join(KONOHA_DIR, 'tmp', client, pHash, sess);
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, '.write_probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return target;
  } catch (_) { /* ignore */ }

  const fallback = path.join(os.tmpdir(), `konoha-${client}-${pHash}-${sess}`);
  try {
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  } catch (_) {
    return os.tmpdir();
  }
}


const SESSION_TURNS = new Map();
const SESSION_TURN_LAST_ACCESS = new Map();
const SESSION_IDLE_RESET_SECONDS = 30 * 60;

function getSessionKey(projectPath = null, sessionId = null) {
  const rawPath = projectPath || getWorkspaceRoot() || process.cwd();
  let pPath = rawPath;
  try {
    pPath = path.resolve(rawPath);
    if (fs.existsSync(pPath)) {
      pPath = fs.realpathSync(pPath);
    }
  } catch (_) { /* ignore */ }
  let pHash = '';
  try {
    const personaMemory = require('../persona_memory');
    pHash = personaMemory.computeProjectHash(pPath);
  } catch (_) { /* ignore */ }
  if (!pHash) {
    const crypto = require('crypto');
    pHash = crypto.createHash('sha256').update(String(pPath), 'utf8').digest('hex').substring(0, 12);
  }
  const client = getActiveClient() || detectActiveClient() || 'universal';
  const sess = sessionId || getActiveSessionId(pPath, client) || 'default';
  return `${client}:${pHash}:${sess}`;
}

function getAndIncrementSessionTurn(sessionKey) {
  const now = Date.now() / 1000;
  const last = SESSION_TURN_LAST_ACCESS.get(sessionKey);
  if (last !== undefined && (now - last) > SESSION_IDLE_RESET_SECONDS) {
    SESSION_TURNS.set(sessionKey, 0);
  }
  SESSION_TURN_LAST_ACCESS.set(sessionKey, now);
  const current = (SESSION_TURNS.get(sessionKey) || 0) + 1;
  SESSION_TURNS.set(sessionKey, current);
  return current;
}


module.exports = {
  detectActiveClient,
  detectActiveAgent,
  getActiveSessionId,
  getKonohaTmpRoot,
  getSessionKey,
  getAndIncrementSessionTurn,
  SESSION_TURNS,
  SESSION_TURN_LAST_ACCESS,
  SESSION_IDLE_RESET_SECONDS,
  globSync
};
