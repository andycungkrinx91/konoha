#!/usr/bin/env node
/**
 * src/workflow_reminder.js — Konoha workflow re-engagement hook.
 *
 * Dual-mode output:
 *  - Claude Code (UserPromptSubmit / SessionStart): plain text on stdout is
 *    added to the model context — covers every prompt and resumed/compacted
 *    sessions.
 *  - Command Code (SessionStart): prints the JSON envelope with
 *    `additionalContext` (detected via COMMANDCODE_HOOK_EVENT=SessionStart).
 *
 * The reminder re-engages the Konoha workflow on EVERY prompt and on
 * resumed/compacted/cleared sessions, where the original contract would
 * otherwise be buried in history or compacted away.
 */

const REMINDER = [
  '[konoha] Workflow active — applies to resumed sessions too:',
  'route tasks via konoha MCP `sannin` (delegate.md phases); skills via konoha.find_skill/get_skill;',
  'code search via semble search/find_related; bounded file tools konoha.read_file_head/range/file_info/get_file_structure/token_efficient_grep/find_files_clean;',
  'artifacts live in konoha.get_resolved_task_dir; completion requires kage review (confidence >= 97, ai_slop_findings = 0).'
].join(' ');

// Command Code hook mode: emit the SessionStart JSON envelope so the
// reminder is injected as first-turn context (startup, resume, clear).
if (process.env.COMMANDCODE_HOOK_EVENT === 'SessionStart') {
  process.stdout.write(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: REMINDER
    }
  }) + '\n');
  process.exit(0);
}

// Claude Code mode (UserPromptSubmit / SessionStart): plain text is
// added to the model context.
process.stdout.write(REMINDER + '\n');
