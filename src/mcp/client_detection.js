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
  HOME,
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

function globSync(pattern) {
  // Minimal glob implementation for common transcript paths
  const results = [];
  const parts = pattern.split('*');
  if (parts.length === 1) {
    if (fs.existsSync(pattern)) results.push(pattern);
    return results;
  }
  // Standard recursive search for directory + extension pattern
  const baseDir = parts[0];
  if (!fs.existsSync(baseDir)) return [];
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            walk(full);
          } else if (st.isFile()) {
            if (pattern.endsWith('*.jsonl') && entry.endsWith('.jsonl')) results.push(full);
            else if (pattern.endsWith('*.json') && entry.endsWith('.json')) results.push(full);
            else if (pattern.endsWith('prompt.md') && entry === 'prompt.md') results.push(full);
            else if (pattern.endsWith('transcript.jsonl') && entry === 'transcript.jsonl') results.push(full);
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  }
  walk(baseDir);
  return results;
}


function detectActiveClient() {
  try {
    if (getActiveClient()) return getActiveClient();
    const activeOverride = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || '').toLowerCase().trim();
    if (activeOverride) {
      if (activeOverride.includes('codex') || activeOverride.includes('openai')) return 'codex';
      if (activeOverride.includes('commandcode') || activeOverride.includes('command-code')) return 'commandcode';
      if (activeOverride.includes('opencode')) return 'opencode';
      if (activeOverride.includes('claude')) return 'claudecode';
      if (activeOverride.includes('cursor')) return 'cursor';
      if (activeOverride.includes('agy') || activeOverride.includes('antigravity-cli')) return 'agy';
      if (activeOverride.includes('antigravity') || activeOverride.includes('ide')) return 'antigravity';
    }

    if (process.env.CODEX_SESSION || process.env.CODEX_THREAD_ID || process.env.CODEX_CI) return 'codex';
    if (process.env.OPENCODE_CLIENT === '1' || process.env.OPENCODE_SESSION === '1') return 'opencode';
    if (process.env.COMMANDCODE_CLIENT === '1' || process.env.COMMANDCODE_SESSION === '1') return 'commandcode';
    if (process.env.CLAUDE_CODE_CHILD_SESSION === '1') return 'claudecode';

    // Check environment variable for Antigravity
    const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
    if (convId) {
      if ((process.env.ANTIGRAVITY_LS_VERSION || '').startsWith('cli')) return 'agy';
      const cliDir = path.join(ANTIGRAVITY_CLI_BRAIN, convId);
      if (fs.existsSync(cliDir) && fs.statSync(cliDir).isDirectory()) return 'agy';
      const ideDir = path.join(ANTIGRAVITY_IDE_BRAIN, convId);
      if (fs.existsSync(ideDir) && fs.statSync(ideDir).isDirectory()) return 'antigravity';
      return 'antigravity';
    }

    const brainDirs = [
      ANTIGRAVITY_IDE_BRAIN,
      ANTIGRAVITY_CLI_BRAIN,
      CURSOR_PROJECTS,
      CLAUDE_PROJECTS,
      path.join(HOME, '.codex', 'sessions'),
      path.join(HOME, '.commandcode', 'logs'),
      path.join(HOME, '.config', 'opencode')
    ];
    const allFiles = [];
    for (const bDir of brainDirs) {
      if (!fs.existsSync(bDir)) continue;
      if (bDir.includes('cursor')) {
        allFiles.push(...globSync(path.join(bDir, '*.jsonl')));
      } else if (bDir.includes('claude')) {
        allFiles.push(...globSync(path.join(bDir, '*.jsonl')));
      } else {
        allFiles.push(...globSync(path.join(bDir, 'prompt.md')));
        allFiles.push(...globSync(path.join(bDir, 'transcript.jsonl')));
      }
    }

    if (allFiles.length === 0) return 'antigravity';

    allFiles.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch (_) {
        return 0;
      }
    });

    const mostRecent = allFiles[0];
    if (mostRecent.includes('cursor')) return 'cursor';
    if (mostRecent.includes('claude')) return 'claudecode';
    if (mostRecent.includes('codex')) return 'codex';
    if (mostRecent.includes('commandcode')) return 'commandcode';
    if (mostRecent.includes('opencode')) return 'opencode';
    if (mostRecent.includes('antigravity-cli')) return 'agy';
    return 'antigravity';
  } catch (_) {
    return 'antigravity';
  }
}

function detectActiveAgent() {
  try {
    const client = detectActiveClient();
    let convId = (client === 'agy' || client === 'antigravity') ? process.env.ANTIGRAVITY_CONVERSATION_ID : null;
    if (['cursor', 'claudecode', 'opencode', 'commandcode'].includes(getActiveClient()) || ['cursor', 'claudecode', 'opencode', 'commandcode'].includes(client)) {
      convId = null;
    }

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
      if (bDir.includes('cursor')) {
        allFiles.push(...globSync(path.join(bDir, '*.jsonl')));
      } else if (bDir.includes('claude')) {
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
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch (_) {
        return 0;
      }
    });

    let detected = null;
    const visitedDirs = new Set();
    const fallbackAgent = null;

    for (const fpath of existingFiles) {
      let convDir = '';
      if (fpath.endsWith('prompt.md')) {
        convDir = path.dirname(fpath);
      } else if (fpath.includes('agent-transcripts')) {
        convDir = path.dirname(path.dirname(fpath));
      } else if (fpath.includes('claude')) {
        convDir = path.dirname(fpath);
      } else {
        convDir = path.dirname(path.dirname(path.dirname(fpath)));
      }
      convDir = path.normalize(convDir);
      if (visitedDirs.has(convDir)) continue;
      visitedDirs.add(convDir);

      const promptPath = path.join(convDir, 'prompt.md');
      if (fs.existsSync(promptPath)) {
        try {
          const promptContent = fs.readFileSync(promptPath, 'utf8');
          const lower = promptContent.toLowerCase();
          if (lower.includes('[konoha] orchestrator active') || lower.includes('[konoha] active') || lower.includes('orchestrator active')) {
            detected = 'orchestrator';
          } else {
            const match = promptContent.match(/\[([^\]]+)\]\s+active/);
            if (match) {
              const parts = match[1].trim().split(/\s+/);
              const name = parts[parts.length - 1].toLowerCase();
              if (['anbu', 'genin', 'chunin', 'jonin', 'kage', 'tokubetsu-jonin'].includes(name)) {
                detected = name;
              } else if (['antigravity', 'orchestrator'].includes(name)) {
                detected = 'orchestrator';
              }
            }
          }
          if (!detected) {
            for (const candidate of ['anbu', 'genin', 'chunin', 'tokubetsu-jonin', 'jonin', 'kage']) {
              if (new RegExp(`\\b${candidate}\\b`, 'i').test(promptContent)) {
                if (new RegExp(`you\\s+are\\s+(?:the|a)\\s+${candidate}\\s+(?:agent|subagent|scout|builder|intel|scribe|leader)`, 'i').test(promptContent)) {
                  detected = candidate;
                  break;
                }
                if (new RegExp(`Log:\\s*"\\[.*${candidate}.*\\]\\s*active"`, 'i').test(promptContent)) {
                  detected = candidate;
                  break;
                }
              }
            }
          }
        } catch (_) { /* ignore */ }
      }

      if (!detected) {
        let transcriptPath = '';
        if ((fpath.includes('agent-transcripts') || fpath.includes('claude')) && fpath.endsWith('.jsonl')) {
          transcriptPath = fpath;
        } else {
          transcriptPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
        }

        if (fs.existsSync(transcriptPath)) {
          try {
            const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const data = JSON.parse(lines[i]);
                let content = '';
                if (data && typeof data === 'object' && data.message && typeof data.message === 'object') {
                  const contentList = data.message.content;
                  if (Array.isArray(contentList)) {
                    for (const block of contentList) {
                      if (block && typeof block === 'object') {
                        if (block.type === 'text') content += ' ' + (block.text || '');
                        else if (block.type === 'tool_use' && block.name === 'Task' && block.input && block.input.subagent_type) {
                          detected = block.input.subagent_type;
                          break;
                        }
                      }
                    }
                    if (detected) break;
                  }
                }
                if (!content && data && typeof data === 'object') {
                  content = data.content || '';
                }
                if (!content) continue;

                const lower = content.toLowerCase();
                if (lower.includes('[konoha] orchestrator active') || lower.includes('[konoha] active') || lower.includes('orchestrator active')) {
                  detected = 'orchestrator';
                  break;
                }

                const match = content.match(/\[([^\]]+)\]\s+active/);
                if (match) {
                  const parts = match[1].trim().split(/\s+/);
                  let name = parts[parts.length - 1].toLowerCase().replace(/_/g, '-');
                  if (['anbu', 'genin', 'chunin', 'jonin', 'kage', 'tokubetsu-jonin'].includes(name)) {
                    detected = name;
                    break;
                  } else if (['antigravity', 'orchestrator'].includes(name)) {
                    detected = 'orchestrator';
                    break;
                  }
                }
              } catch (_) { /* ignore */ }
            }
          } catch (_) { /* ignore */ }
        }
      }

      if (detected) {
        try {
          const conn = getDb();
          conn.prepare(`
            CREATE TABLE IF NOT EXISTS active_sessions (
              client TEXT NOT NULL,
              workspace_root TEXT NOT NULL,
              session_id TEXT NOT NULL,
              transcript_path TEXT,
              last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (client, workspace_root)
            )
          `).run();

          let sessId = convId;
          if (!sessId) {
            const parts = path.normalize(fpath).split(path.sep);
            const idx = parts.indexOf('agent-transcripts');
            if (idx !== -1 && idx + 1 < parts.length) {
              sessId = parts[idx + 1];
            } else if (parts.includes('claude')) {
              sessId = path.parse(fpath).name;
            }
          }
          if (sessId) {
            conn.prepare(`
              INSERT OR REPLACE INTO active_sessions (client, workspace_root, session_id, transcript_path, last_active_at)
              VALUES (?, ?, ?, ?, datetime('now'))
            `).run(getActiveClient() || 'unknown', getWorkspaceRoot() || 'unknown', sessId, fpath);
          }
        } catch (err) {
          process.stderr.write(`  [Warning] Failed to write active session: ${err.message}\n`);
        }
        return detected;
      }

      if (visitedDirs.size >= 15) break;
    }

    if (getWorkspaceRoot()) {
      try {
        const conn = getDb();
        const row = conn.prepare(`
          SELECT session_id, transcript_path FROM active_sessions
          WHERE client = ? AND workspace_root = ?
        `).get(getActiveClient() || 'unknown', getWorkspaceRoot());
        if (row && row.transcript_path && fs.existsSync(row.transcript_path)) {
          const lines = fs.readFileSync(row.transcript_path, 'utf8').split(/\r?\n/).filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const data = JSON.parse(lines[i]);
              let content = data.content || '';
              if (data.message && Array.isArray(data.message.content)) {
                content = data.message.content.map(b => b.text || '').join(' ');
              }
              const match = content.match(/\[([^\]]+)\]\s+active/);
              if (match) {
                const parts = match[1].trim().split(/\s+/);
                const name = parts[parts.length - 1].toLowerCase().replace(/_/g, '-');
                if (['anbu', 'genin', 'chunin', 'jonin', 'kage', 'tokubetsu-jonin'].includes(name)) {
                  return name;
                }
              }
            } catch (_) { /* ignore */ }
          }
        }
      } catch (_) { /* ignore */ }
    }

    process.stderr.write(`[mcp konoha] detect_active_agent: no agent detected, returning ${fallbackAgent}\n`);
    return fallbackAgent;
  } catch (e) {
    process.stderr.write(`[mcp konoha] detect_active_agent: fatal error: ${e.message}\n`);
    return null;
  }
}


function getActiveSessionId() {
  const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
  if (convId) return convId;
  try {
    const conn = getDb();
    const row = conn.prepare(`
      SELECT session_id FROM active_sessions
      WHERE client = ? AND workspace_root = ?
    `).get(getActiveClient() || 'unknown', getWorkspaceRoot() || 'unknown');
    if (row && row.session_id) return row.session_id;
  } catch (_) { /* ignore */ }
  return '';
}

function getKonohaTmpRoot() {
  let client = getActiveClient() || detectActiveClient() || 'unknown';
  let sess = '';
  try {
    sess = getActiveSessionId();
  } catch (_) { /* ignore */ }
  if (!sess) sess = 'default';

  try {
    const target = path.join(KONOHA_DIR, 'tmp', client, sess);
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, '.write_probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return target;
  } catch (_) { /* ignore */ }

  const fallback = path.join(os.tmpdir(), `konoha-${process.pid}-${process.env.KONOHA_TS || 'x'}`);
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

function getSessionKey(projectPath = null) {
  const convId = (
    process.env.ANTIGRAVITY_CONVERSATION_ID ||
    process.env.CLAUDE_CONVERSATION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.COMMANDCODE_SESSION_ID ||
    process.env.CURSOR_SESSION_ID ||
    process.env.SESSION_ID ||
    ''
  );
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const pHash = personaMemory.computeProjectHash(pPath);
  const client = getActiveClient() || 'universal';
  if (convId) return `${client}:${convId}:${pHash}`;
  return `${client}:${pHash}`;
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
