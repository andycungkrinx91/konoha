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

const fs = require('fs');
const path = require('path');
const os = require('os');
const HOME = os.homedir();

function ensureWorkspaceRules(targetCwd) {
  try {
    if (!targetCwd || targetCwd === HOME || !fs.existsSync(targetCwd)) return;
    const geminiMdPath = path.join(targetCwd, 'GEMINI.md');
    if (!fs.existsSync(geminiMdPath)) {
      const templatePath = path.join(__dirname, 'templates', 'GEMINI.md');
      const globalGeminiMd = path.join(HOME, '.gemini', 'GEMINI.md');
      const src = fs.existsSync(templatePath) ? templatePath : (fs.existsSync(globalGeminiMd) ? globalGeminiMd : null);
      if (src) fs.copyFileSync(src, geminiMdPath);
    }
    const agentsDir = path.join(targetCwd, '.agents');
    const agentsMdPath = path.join(agentsDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
      const templateAgents = path.join(__dirname, 'templates', 'AGENTS.md');
      const globalAgentsMd = path.join(HOME, '.agents', 'AGENTS.md');
      const src = fs.existsSync(templateAgents) ? templateAgents : (fs.existsSync(globalAgentsMd) ? globalAgentsMd : null);
      if (src) {
        if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
        fs.copyFileSync(src, agentsMdPath);
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }
}
try { ensureWorkspaceRules(process.cwd()); } catch (_) { /* intentional best-effort fallback */ }

const REMINDER = [
  '[konoha] Workflow active — applies to ALL sessions (new, resumed, compacted):',
  'FIRST ACTION on any new task: call konoha.find_skill with keywords from the user prompt BEFORE any code changes.',
  'Route tasks via konoha MCP `sannin` (delegate.md phases); skills via konoha.find_skill/get_skill;',
  'code search via semble search/find_related; bounded file tools konoha.read_file_head/range/file_info/get_file_structure/token_efficient_grep/find_files_clean;',
  'artifacts live in konoha.get_resolved_task_dir; completion requires kage review (confidence >= 98%, ai_slop_findings = 0, aislop score 100/100);',
  'base personality: high effort + instruct style (STRICTLY FORBIDDEN filler: "Hmmmm", "Let me check", "Let me see", "Wait, let me", "Wait - but", "I will now proceed to", "Let me examine");',
  'lead with direct action/evidence; ADHD-friendly: number steps, bold headings, bullet points, zero fluff;',
  'zero hallucination: never fabricate test results, never claim success without verified evidence, never lie.'
].join(' ');

// Detect active client for hook-specific output format (retained for future client-specific formatting)
const _activeClient = (() => {
  if (process.env.COMMANDCODE_HOOK_EVENT) return 'commandcode';
  if (process.env.ANTIGRAVITY_SESSION || Object.keys(process.env).some(k => k.startsWith('AGY_'))) return 'antigravity';
  if (process.env.CURSOR_SESSION || process.env.CURSOR_TRACE_ID) return 'cursor';
  if (process.env.OPENCODE_SESSION) return 'opencode';
  if (process.env.PI_SESSION || process.env.PI_DEV) return 'pi';
  if (process.env.CODEX_SESSION || process.env.CODEX_SANDBOX) return 'codex';
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

