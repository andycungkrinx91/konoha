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
    if (/You are the\s+(genin|kage|chunin|jonin|anbu|tokubetsu-jonin|sannin)\b/i.test(content)) return true;
    if (content.includes('delegate.md') || content.includes('result.md')) return true;
    if (/(?:Please\s+)?read\s+(?:your task|the delegation)/i.test(content)) return true;
    if (/\/brain\/[a-f0-9-]+\/scratch\/tasks\//i.test(content)) return true;
  }
  if (row.source === 'MODEL' && /\[(?:🍃|🌀|📜|🛡️|👥|🎯)?\s*(?:Genin|Kage|Chunin|Jonin|Anbu|Tokubetsu-jonin)\]\s*active/i.test(content)) {
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

module.exports = {
  readStdin,
  readStdinJson,
  respond,
  respondNoop,
  isConfirmedSelf,
  isConfirmedOrchestrator: isConfirmedSelf,
  brainDirFromTranscript,
};