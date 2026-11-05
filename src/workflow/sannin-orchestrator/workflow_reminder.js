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


const REMINDER = [
  '[konoha] Workflow active — applies to ALL sessions (new, resumed, compacted):',
  'FIRST ACTION on any new task: call konoha.find_skill with keywords from the user prompt BEFORE any code changes.',
  'Route tasks via konoha MCP `sannin` (structured task args, never file IPC); skills via konoha.find_skill/get_skill;',
  'code search via semble search/find_related; bounded file tools konoha.read_file_head/range/file_info/get_file_structure/token_efficient_grep/find_files_clean;',
  'artifacts live in konoha.get_resolved_task_dir; completion requires kage review (confidence >= 98%, ai_slop_findings = 0, aislop score 100/100);',
  '@advisor approval review before final delivery sign-off;',
  'base personality: high effort + instruct style (STRICTLY FORBIDDEN filler: "Hmmmm", "Let me check", "Let me see", "Wait, let me", "Wait - but", "I will now proceed to", "Let me examine");',
  'lead with direct action/evidence; ADHD-friendly: number steps, bold headings, bullet points, zero fluff;',
  'zero hallucination: never fabricate test results, never claim success without verified evidence, never lie;',
  'anti-context-loss / middle-attenuation guard: never lose user constraints in the middle of multi-turn sessions; re-anchor explicit parameters (author, identity, flags, negative constraints) on every turn, and assert exact string equality rather than relying on degraded conversational memory.'
].join(' ');

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
