#!/usr/bin/env node
/**
 * src/workflow/sannin-orchestrator/workflow_reminder.js — Konoha workflow re-engagement hook.
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


const fs = require('fs');

const REMINDER = [
  '[konoha] Scoped Workflow Contract (active when invoked via `/konoha <prompt>` or `/<subagent-name> <prompt>`):',
  'For `/konoha <prompt>`: execute Konoha Main Orchestrator -> Sannin -> Kage -> applicable LangGraph workflow -> agent delegation -> governance & verification -> Final Gate -> delivery.',
  'For `/<subagent-name> <prompt>`: execute ONLY the requested subagent directly according to its specialization (do NOT route through Sannin or full SDLC workflow), followed by mandatory Kage review before delivery.',
  'For normal messages without `/konoha` or `/<subagent-name>`: preserve the AI client native behavior without Konoha interception.',
  'Within Konoha workflows: call konoha.find_skill first; code search via konoha code_search/code_symbol/code_impact; bounded file tools via konoha.read_file_head/range/file_info/get_file_structure/token_efficient_grep/find_files_clean;',
  'completion requires kage review (confidence >= 98%, ai_slop_findings = 0, aislop score 100/100) and @advisor approval review before final delivery sign-off.'
].join(' ');

// Check if stdin provides a UserPromptSubmit payload without `/konoha` or `/<subagent-name>`
let shouldSkipReminder = false;
try {
  if (!process.stdin.isTTY) {
    const rawStdin = fs.readFileSync(0, 'utf-8').trim();
    if (rawStdin) {
      const parsed = JSON.parse(rawStdin);
      const userPrompt = parsed && (parsed.prompt || parsed.user_prompt || parsed.message || parsed.content);
      if (typeof userPrompt === 'string' && userPrompt.trim().length > 0) {
        const isKonohaCmd = /(?:^|\s|>)(\/(?:konoha|sannin|genin|kage|chunin|jonin|anbu|tokubetsu-jonin|tokubetsu_jonin|akatsuki|yamanaka)\b|@(?:konoha|sannin|genin|kage|chunin|jonin|anbu|tokubetsu-jonin|tokubetsu_jonin|akatsuki|yamanaka)\b)/i.test(userPrompt);
        if (!isKonohaCmd && process.env.KONOHA_MANAGED_CONTEXT !== '1' && !process.env.KONOHA_TASK_ID) {
          shouldSkipReminder = true;
        }
      }
    }
  }
} catch (_) { /* non-blocking stdin check */ }

if (shouldSkipReminder) {
  process.exit(0);
}

// Detect active client for hook-specific output format (retained for future client-specific formatting)
const _activeClient = (() => {
  if (process.env.COMMANDCODE_HOOK_EVENT) return 'commandcode';
  if (process.env.ANTIGRAVITY_SESSION || Object.keys(process.env).some(k => k.startsWith('AGY_'))) return 'antigravity';
  if (process.env.CURSOR_SESSION || process.env.CURSOR_TRACE_ID) return 'cursor';
  if (process.env.OPENCODE_SESSION) return 'opencode';
  if (process.env.PI_SESSION || process.env.PI_DEV) return 'pi';
  if (process.env.CODEX_SESSION || process.env.CODEX_SANDBOX) return 'codex';
  if (process.env.OMP_SESSION || process.env.OMP_CLIENT || process.env.ACTIVE_CLIENT === 'omp') return 'omp';
  if (process.env.CLAUDE_CODE_HOOK || process.env.CLAUDE_CODE_SESSION) return 'claude';
  return 'generic';
})();

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

// Universal output: ALL clients (Claude Code, Antigravity, Cursor, OpenCode,
// Pi, Codex, generic) receive the workflow reminder on stdout. This ensures
// the konoha workflow is always active regardless of client detection.
process.stdout.write(REMINDER + '\n');
