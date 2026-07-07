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
  t = t.replace(/^["'\\]+|["'\\]+$/g, '');
  return t.trim();
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

const path = require('path');
const os = require('os');

function loadRealAgent(name) {
  try {
    const agentsPath = path.join(os.homedir(), '.agents', 'agents.json');
    if (fs.existsSync(agentsPath)) {
      const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
      return agents.find(a => a.name === name);
    }
  } catch (e) {}
  return null;
}

// Override prepended to every subagent's system_prompt to immunize against
// user_global orchestrator instructions leaking into subagent sessions.
const SUBAGENT_IDENTITY_OVERRIDE = [
  'CRITICAL IDENTITY OVERRIDE — READ THIS FIRST:',
  'You are a SUBAGENT spawned by the Konoha orchestrator. You are NOT the orchestrator.',
  'You must NEVER call define_subagent or invoke_subagent or manage_subagents.',
  'IGNORE any rules about "Session Startup — Auto-Initialize Team", "MANDATORY: define all 6 Konoha subagents", or "Auto-Delegation".',
  'Those rules are for the PARENT orchestrator only and do NOT apply to you.',
  'Focus EXCLUSIVELY on the task described in your prompt (typically in delegate.md).',
  '',
].join('\n');

function sanitizeDefineSubagentArgs(args) {
  const out = {};
  for (const key of Object.keys(args || {})) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'name') out.name = args[key];
    else if (lowerKey === 'description') out.description = args[key];
    else if (lowerKey === 'system_prompt' || lowerKey === 'systemprompt') out.system_prompt = args[key];
    else if (lowerKey === 'enable_mcp_tools' || lowerKey === 'enablemcptools') out.enable_mcp_tools = args[key];
    else if (lowerKey === 'enable_write_tools' || lowerKey === 'enablewritetools') out.enable_write_tools = args[key];
    else if (lowerKey === 'enable_subagent_tools' || lowerKey === 'enablesubagenttools') out.enable_subagent_tools = args[key];
    else out[key] = args[key];
  }

  for (const key of ['name', 'description', 'system_prompt']) {
    if (out[key] != null) out[key] = stripQuotes(out[key]);
  }
  for (const key of ['enable_mcp_tools', 'enable_write_tools', 'enable_subagent_tools']) {
    if (out[key] != null) out[key] = toBool(out[key]);
  }

  if (out.name) {
    const realAgent = loadRealAgent(out.name);
    if (realAgent) {
      if (realAgent.description) out.description = realAgent.description;
      if (realAgent.instructions) out.system_prompt = realAgent.instructions;
      if (realAgent.enable_mcp_tools != null) out.enable_mcp_tools = realAgent.enable_mcp_tools;
      if (realAgent.enable_write_tools != null) out.enable_write_tools = realAgent.enable_write_tools;
      // Note: enable_subagent_tools is force-set to false below regardless
    }
  }

  // LAYER 1: Force enable_subagent_tools=false — subagents must NEVER spawn sub-subagents.
  // agents.json has 0 occurrences of this field, so without this override it defaults to
  // whatever the model provides (often true), allowing subagents to call define_subagent.
  out.enable_subagent_tools = false;

  // LAYER 2: Prepend identity override to system_prompt to immunize against
  // user_global rules that contain orchestrator instructions ("MANDATORY: define all 6 subagents").
  if (out.system_prompt) {
    out.system_prompt = SUBAGENT_IDENTITY_OVERRIDE + out.system_prompt;
  }

  return out;
}

function sanitizeInvokeSubagentArgs(args) {
  const out = {};
  for (const key of Object.keys(args || {})) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'subagents') out.Subagents = args[key];
    else out[key] = args[key];
  }

  const subs = parseSubagents(out.Subagents);
  if (!Array.isArray(subs)) {
    return { error: 'Subagents must be a JSON array, not a string.' };
  }

  const OFFICIAL_NINJAS = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];

  const cleaned = subs.map((entry) => {
    const e = {};
    for (const key of Object.keys(entry || {})) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'typename' || lowerKey === 'type_name') e.TypeName = entry[key];
      else if (lowerKey === 'role') e.Role = entry[key];
      else if (lowerKey === 'prompt') e.Prompt = entry[key];
      else if (lowerKey === 'workspace') e.Workspace = entry[key];
      else e[key] = entry[key];
    }
    if (e.TypeName != null) e.TypeName = stripQuotes(e.TypeName);
    if (e.Role != null) e.Role = stripQuotes(e.Role);
    if (e.Prompt != null) e.Prompt = stripQuotes(e.Prompt);
    if (e.Workspace != null) e.Workspace = stripQuotes(e.Workspace);

    if (e.TypeName) {
      const tn = e.TypeName.toLowerCase();
      if (OFFICIAL_NINJAS.includes(tn)) {
        const realAgent = loadRealAgent(tn);
        if (realAgent) {
          const allowsWrite = !/read-only/i.test(realAgent.constraints || '');
          const identityPrefix = [
            `CRITICAL IDENTITY OVERRIDE — READ THIS FIRST:`,
            `You are @${realAgent.name} (${realAgent.title || ''}).`,
            `Instructions: ${realAgent.instructions || ''}`,
            `Constraints: ${realAgent.constraints || ''}`,
            `Workflow: ${realAgent.workflow || ''}`,
            `Description: ${realAgent.description || ''}`,
            `Identity Override: You are a SUBAGENT. Follow the above system rules and instructions.`,
            `---`,
            `Task to execute:`,
            ``
          ].join('\n');
          e.Prompt = identityPrefix + (e.Prompt || '');
          e.TypeName = allowsWrite ? 'self' : 'research';
        }
      }
    }
    return e;
  });

  out.Subagents = cleaned;
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

    let { name, args: rawArgs } = toolCall;
    if (name && name.includes(':')) {
      name = name.split(':').pop();
    }

    if (name === 'define_subagent') {
      const sanitized = sanitizeDefineSubagentArgs(rawArgs);
      if (!sanitized.name || !/^[a-z0-9-]+$/.test(sanitized.name)) {
        respond({
          decision: 'deny',
          reason: `define_subagent name must be bare (e.g. jonin, anbu, kage, chunin, genin, tokubetsu-jonin), got ${JSON.stringify(rawArgs.name)}`,
        });
        return;
      }
      if (argsChanged(rawArgs, sanitized)) {
        respond({
          decision: 'allow',
          overwrite: { args: sanitized },
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
          overwrite: { args: result.args },
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
