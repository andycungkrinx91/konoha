#!/usr/bin/env node
/**
 * Antigravity PreToolUse hook — fix define_subagent / invoke_subagent args via overwrite.
 * Deny alone is unreliable; overwrite applies bare names and proper Subagents arrays in-place.
 */
const fs = require('fs');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function stripQuotes(value) {
  if (value == null || typeof value !== 'string') return value;
  let t = value.trim();
  while (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}

function parseSubagents(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    try {
      return JSON.parse(s);
    } catch {
      try {
        return JSON.parse(stripQuotes(s));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractToolCall(payload) {
  if (!payload) return null;
  const tc = payload.toolCall || payload.ToolCall || payload;
  if (!tc || !tc.name) return null;
  const args = tc.args || tc.Args || tc.arguments || {};
  return { name: tc.name, args };
}

function sanitizeDefineSubagentArgs(args) {
  const out = { ...args };
  for (const key of ['name', 'description', 'system_prompt']) {
    if (out[key] != null) out[key] = stripQuotes(out[key]);
  }
  for (const key of ['enable_mcp_tools', 'enable_write_tools', 'enable_subagent_tools']) {
    if (out[key] != null) out[key] = toBool(out[key]);
  }
  delete out.toolAction;
  delete out.toolSummary;
  return out;
}

function sanitizeInvokeSubagentArgs(args) {
  const out = { ...args };
  const subs = parseSubagents(out.Subagents);
  if (!Array.isArray(subs)) {
    return { error: 'Subagents must be a JSON array, not a string.' };
  }

  const cleaned = subs.map((entry) => {
    const e = { ...entry };
    if (e.TypeName != null) e.TypeName = stripQuotes(e.TypeName);
    if (e.Role != null) e.Role = stripQuotes(e.Role);
    if (e.Prompt != null) e.Prompt = stripQuotes(e.Prompt);
    if (e.Workspace != null) e.Workspace = stripQuotes(e.Workspace);
    return e;
  });

  for (const entry of cleaned) {
    const tn = (entry.TypeName || '').toLowerCase();
    const prompt = entry.Prompt || '';
    if (tn === 'self' && (/acting as|@jonin|delegate\.md/i.test(prompt) || /jonin|genin|anbu|kage|chunin|tokubetsu-jonin/i.test(prompt))) {
      return { error: 'FORBIDDEN: TypeName "self" cannot impersonate Konoha subagents. Use TypeName jonin after define_subagent with bare name.' };
    }
    if (tn === 'research' && /delegate\.md/i.test(prompt)) {
      return { error: 'FORBIDDEN: TypeName "research" for Konoha delegation.' };
    }
  }

  out.Subagents = cleaned;
  delete out.toolAction;
  delete out.toolSummary;
  return { args: out };
}

function argsChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  try {
    const stdinContent = await readStdin();
    if (!stdinContent) {
      respond({ decision: 'allow' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(stdinContent);
    } catch {
      respond({ decision: 'allow' });
      return;
    }

    const toolCall = extractToolCall(payload);
    if (!toolCall) {
      respond({ decision: 'allow' });
      return;
    }

    const { name, args: rawArgs } = toolCall;

    if (name === 'define_subagent') {
      const sanitized = sanitizeDefineSubagentArgs(rawArgs);
      if (!sanitized.name || !/^[a-z0-9-]+$/.test(sanitized.name)) {
        respond({
          decision: 'deny',
          reason: `define_subagent name must be bare (e.g. jonin), got ${JSON.stringify(rawArgs.name)}`,
        });
        return;
      }
      if (argsChanged(rawArgs, sanitized)) {
        respond({
          decision: 'allow',
          overwrite: { name: 'define_subagent', args: sanitized },
        });
        return;
      }
      respond({ decision: 'allow' });
      return;
    }

    if (name === 'invoke_subagent') {
      const result = sanitizeInvokeSubagentArgs(rawArgs);
      if (result.error) {
        respond({ decision: 'deny', reason: result.error });
        return;
      }
      if (argsChanged(rawArgs, result.args)) {
        respond({
          decision: 'allow',
          overwrite: { name: 'invoke_subagent', args: result.args },
        });
        return;
      }
      respond({ decision: 'allow' });
      return;
    }

    respond({ decision: 'allow' });
  } catch {
    respond({ decision: 'allow' });
  }
}

main();
