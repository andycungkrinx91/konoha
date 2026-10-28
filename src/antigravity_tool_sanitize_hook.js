#!/usr/bin/env node
/**
 * Antigravity PreToolUse hook — Konoha MCP enforcement.
 *
 * Denies:
 * 1. define_subagent / invoke_subagent (must use MCP tools instead)
 * 2. Native file/search tools (must use konoha/semble MCP instead)
 * 3. Shell commands that violate the shared guardrails (read-bypass,
 *    destructive commands, git safety, secret protection)
 *
 * Shared stdin/respond helpers live in ./hook-base, which is deployed
 * alongside this script to ~/.konoha/. The guardrail checker lives in
 * ./guardrails, also deployed flat to ~/.konoha/.
 */
const { readStdinJson, respond } = require('./hook-base');

let checkCommandGuardrails = null;
try {
  checkCommandGuardrails = require('./guardrails').checkCommandGuardrails;
} catch (_) {
  // guardrails.js not deployed yet — the legacy first-word fallback below
  // still enforces the MCP read-bypass rule.
}

function extractToolCall(payload) {
  if (!payload) return null;
  const tc = payload.toolCall || payload.ToolCall || payload;
  if (!tc || !tc.name) return null;
  const args = tc.args || tc.Args || tc.arguments || {};
  return { name: tc.name, args };
}

function _checkRunCommandViolation(rawArgs) {
  const cmdLine = rawArgs.CommandLine || rawArgs.command || rawArgs.commandLine || '';
  const cmdStr = typeof cmdLine === 'string' ? cmdLine.trim() : '';
  if (!cmdStr) return null;
  if (checkCommandGuardrails) {
    return checkCommandGuardrails(cmdStr);
  }
  const firstWord = cmdStr.split(/\s+/)[0].replace(/^.*\//, '');
  const FORBIDDEN_SHELL_CMDS = ['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd', 'ag', 'ack', 'less', 'more', 'bat', 'wc', 'zcat'];
  if (FORBIDDEN_SHELL_CMDS.includes(firstWord)) {
    return {
      category: 'read-bypass',
      reason: `Shell command '${firstWord}' is DISABLED. You MUST use 'konoha' MCP tools (read_file_head, read_file_range, token_efficient_grep, etc.) for file reads and 'semble' MCP (search, find_related) for code search instead of shell commands. Prefix safe read/search commands with 'rtk' to run them anyway.`
    };
  }
  return null;
}

async function main() {
  try {
    const payload = await readStdinJson();
    if (!payload) {
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

    // DENY 1: Block direct subagent creation/invocation — must use MCP tools
    if (name === 'define_subagent' || name === 'invoke_subagent') {
      respond({
        decision: 'deny',
        reason: `Subagents must be executed strictly as MCP tools (e.g. kage, jonin, etc.) served by the konoha MCP server. Direct agent tool calls (define_subagent, invoke_subagent) are disabled in Konoha.`,
      });
      return;
    }

    // DENY 2: Block native file/search tools — must use konoha MCP + semble MCP
    const FORBIDDEN_TOOLS = ['view_file', 'grep_search', 'list_dir', 'Read', 'Grep', 'Glob', 'Search'];
    if (FORBIDDEN_TOOLS.includes(name)) {
      respond({
        decision: 'deny',
        reason: `Konoha Enforcement: Native tool '${name}' is DISABLED. You MUST use 'konoha' MCP (for bounded file reads/skills) and 'semble' MCP (for codebase search) instead.`,
      });
      return;
    }

    if (name === 'run_command') {
      const violation = _checkRunCommandViolation(rawArgs);
      if (violation) {
        respond({
          decision: 'deny',
          reason: `Konoha Enforcement (guardrails/${violation.category}): ${violation.reason}`,
        });
        return;
      }
    }

    respond({ decision: 'allow' });
  } catch {
    respond({ decision: 'allow' });
  }
}

main();