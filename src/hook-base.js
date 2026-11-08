/**
 * Shared helpers for Antigravity/Cursor hook scripts.
 *
 * Every hook is also deployed to ~/.konoha/ as a flat file (see cli.js cmdInit),
 * so this file MUST be deployed alongside them as well. The hooks do:
 *
 *     const hookBase = require('./hook-base');
 *
 * which resolves to ~/.konoha/hook-base.js when the deployed copy runs.
 *
 * Keep this file dependency-free (only Node builtins) so the deployed copy
 * never needs a separate node_modules tree.
 */
const fs = require('fs');

/**
 * Read all of stdin as UTF-8. Resolves to '' on EOF / error — hooks must
 * never throw out of stdin reads.
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/**
 * Parse a JSON object from stdin. Resolves to null if the input is empty,
 * malformed, or not an object. Hooks should treat null as "no-op" and
 * silently exit.
 */
async function readStdinJson() {
  const raw = await readStdin();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Write a JSON object to stdout followed by a newline. Antigravity hook
 * responses must be JSON-line terminated.
 */
function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Write an empty JSON object to stdout. The convention for hooks that
 * intentionally take no action (e.g. subagent context not ready).
 */
function respondNoop() {
  respond({});
}

/**
 * Determine if this session is CONFIRMED to be the main self (primary thread).
 *
 * Returns true ONLY when we have positive evidence from the transcript
 * that this is NOT a subagent session.
 *
 * Key design: defaults to false (safe) when uncertain.
 * This prevents the ephemeral self message from being injected into
 * subagent sessions where the transcript is empty at invocation 0.
 *
 * Used by prompt_hook.js and antigravity_subagent_hook.js.
 */
function _isSubagentRow(row) {
  const content = row.content || row.thinking || '';
  if (row.type === 'USER_INPUT') {
    if (/acting as the\s*`?@/i.test(content)) return true;
    if (/You are the\s+(genin|kage|chunin|jonin|anbu|tokubetsu-jonin|akatsuki|sannin)\b/i.test(content)) return true;
    if (content.includes('delegate.md') || content.includes('result.md')) return true;
    if (/(?:Please\s+)?read\s+(?:your task|the delegation)/i.test(content)) return true;
    if (/\/brain\/[a-f0-9-]+\/scratch\/tasks\//i.test(content)) return true;
  }
  if (row.source === 'MODEL' && /\[(?:🍃|🌀|📜|🛡️|👥|🎯|☁|🍶)?\s*(?:Genin|Kage|Chunin|Jonin|Anbu|Tokubetsu-jonin|Akatsuki|Sannin)\]\s*active/i.test(content)) {
    return true;
  }
  return false;
}

function isConfirmedSelf(transcriptPath) {
  if (!transcriptPath) return false;
  if (transcriptPath.includes('/subagents/')) return false;

  try {
    const fullPath = transcriptPath.replace('transcript.jsonl', 'transcript_full.jsonl');
    const targetPath = fs.existsSync(fullPath) ? fullPath : transcriptPath;
    if (!fs.existsSync(targetPath)) return false;

    const limit = 50 * 200;
    const raw = fs.readFileSync(targetPath, 'utf-8').trim().slice(0, limit);
    if (!raw) return false;

    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return false;

    for (const line of lines.slice(0, 50)) {
      try {
        const row = JSON.parse(line);
        if (_isSubagentRow(row)) return false;
      } catch { /* intentional best-effort fallback */ }
    }

    return true;
  } catch {
    console.error('[hook-base] guard probe failed — failing open (non-fatal)');
    return false;
  }
}

/**
 * Determine the brain directory from a transcript path.
 * Returns null if the path doesn't match the expected .system_generated/logs/<id> shape.
 */
function brainDirFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  const path = require('path');
  const logsDir = path.dirname(transcriptPath);
  if (path.basename(logsDir) !== 'logs') return null;
  const sysDir = path.dirname(logsDir);
  if (path.basename(sysDir) !== '.system_generated') return null;
  return path.dirname(sysDir);
}

const KONOHA_COMMAND_PREFIX_RE = /(?:^|\s|>)(\/(?:konoha|sannin|genin|kage|chunin|jonin|anbu|tokubetsu-jonin|tokubetsu_jonin|akatsuki|yamanaka)\b|@(?:konoha|sannin|genin|kage|chunin|jonin|anbu|tokubetsu-jonin|tokubetsu_jonin|akatsuki|yamanaka)\b)/i;

function isKonohaInvocationPrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') return false;
  return KONOHA_COMMAND_PREFIX_RE.test(promptText.trim());
}

function isKonohaSessionActive(contextOrPath = null) {
  if (process.env.KONOHA_MANAGED_CONTEXT === '1' || process.env.KONOHA_TASK_ID || process.env.KONOHA_ACTIVE_SESSION === '1') {
    return true;
  }
  const transcriptPath = typeof contextOrPath === 'string'
    ? contextOrPath
    : (contextOrPath && (contextOrPath.transcriptPath || contextOrPath.transcript_path));
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const raw = fs.readFileSync(transcriptPath, 'utf-8');
      if (KONOHA_COMMAND_PREFIX_RE.test(raw) || raw.includes('task_mw') || raw.includes('sannin') || raw.includes('konoha.')) {
        return true;
      }
    } catch { /* ignore */ }
  }
  const promptText = contextOrPath && (contextOrPath.prompt || contextOrPath.user_prompt || contextOrPath.content || contextOrPath.message);
  if (typeof promptText === 'string' && isKonohaInvocationPrompt(promptText)) {
    return true;
  }
  return false;
}

const TRUSTED_KONOHA_TASK_FILE_RE = /(?:^|\/)(?:\.konoha\/tmp|konoha-tmp)\/([a-zA-Z0-9_-]{1,32})\/([a-zA-Z0-9._-]{1,64})\/([a-zA-Z0-9._-]{1,96})\/scratch\/tasks\/([a-zA-Z0-9._-]{1,96})\/(walkthrough_todos\.json|status\.json|walkthrough\.md|compact_checkpoint\.json|plan\.md|final_report\.md)$/;

const CANONICAL_KONOHA_SUBAGENTS = new Set([
  'sannin',
  'kage',
  'jonin',
  'anbu',
  'chunin',
  'genin',
  'tokubetsu-jonin',
  'tokubetsu_jonin',
  'akatsuki',
  'yamanaka'
]);

function isCanonicalKonohaSubagentName(rawName) {
  if (!rawName || typeof rawName !== 'string') return false;
  const cleaned = rawName.trim().toLowerCase().replace(/^@/, '');
  return CANONICAL_KONOHA_SUBAGENTS.has(cleaned);
}

function isTrustedKonohaTaskReadPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  if (rawPath.includes('\0')) return false;
  const trimmed = rawPath.trim().replace(/^file:\/\//i, '');
  if (!trimmed || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(trimmed)) return false;

  const pathMod = require('path');
  const osMod = require('os');
  let expanded = trimmed;
  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE || osMod.homedir();
    expanded = pathMod.join(home, expanded.slice(2));
  }
  const normalizedFwd = pathMod.resolve(expanded).replace(/\\/g, '/');
  if (!TRUSTED_KONOHA_TASK_FILE_RE.test(normalizedFwd)) {
    return false;
  }

  try {
    if (fs.existsSync(expanded)) {
      const lstat = fs.lstatSync(expanded);
      if (lstat.isSymbolicLink()) return false;
      const realFwd = fs.realpathSync(expanded).replace(/\\/g, '/');
      if (!TRUSTED_KONOHA_TASK_FILE_RE.test(realFwd)) return false;
    } else {
      const parentDir = pathMod.dirname(expanded);
      if (fs.existsSync(parentDir)) {
        const lstatParent = fs.lstatSync(parentDir);
        if (lstatParent.isSymbolicLink()) return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

module.exports = {
  readStdin,
  readStdinJson,
  respond,
  respondNoop,
  isConfirmedSelf,
  isConfirmedOrchestrator: isConfirmedSelf,
  brainDirFromTranscript,
  isKonohaInvocationPrompt,
  isKonohaSessionActive,
  isCanonicalKonohaSubagentName,
  isTrustedKonohaTaskReadPath,
  KONOHA_COMMAND_PREFIX_RE,
  TRUSTED_KONOHA_TASK_FILE_RE,
};