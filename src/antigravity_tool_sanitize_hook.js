#!/usr/bin/env node
/**
 * Antigravity PreToolUse hook — Konoha MCP enforcement.
 *
 * Denies:
 * 1. define_subagent / invoke_subagent (must use MCP tools instead)
 * 2. Native file/search tools (must use konoha/semble MCP instead)
 * 3. Shell commands that bypass MCP file reads (cat/grep/find/...)
 *
 * Shared stdin/respond helpers live in ./hook-base, which is deployed
 * alongside this script to ~/.konoha/.
 */
const { readStdinJson, respond } = require('./hook-base');

function extractToolCall(payload) {
  if (!payload) return null;
  const tc = payload.toolCall || payload.ToolCall || payload;
  if (!tc || !tc.name) return null;
  const args = tc.args || tc.Args || tc.arguments || {};
  return { name: tc.name, args };
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

    // DENY 3: Block run_command calls that use shell file-reading/search commands
    if (name === 'run_command') {
      const cmdLine = rawArgs.CommandLine || rawArgs.command || rawArgs.commandLine || '';
      const cmdStr = typeof cmdLine === 'string' ? cmdLine.trim() : '';
      const firstWord = cmdStr.split(/\s+/)[0].replace(/^.*\//, ''); // basename
      const FORBIDDEN_SHELL_CMDS = ['cat', 'head', 'tail', 'grep', 'rg', 'find', 'fd', 'ag', 'ack', 'less', 'more', 'bat', 'wc'];
      if (FORBIDDEN_SHELL_CMDS.includes(firstWord)) {
        respond({
          decision: 'deny',
          reason: `Konoha Enforcement: Shell command '${firstWord}' is DISABLED. You MUST use 'konoha' MCP tools (read_file_head, read_file_range, token_efficient_grep, etc.) for file reads and 'semble' MCP (search, find_related) for code search instead of shell commands.`,
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