'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists } = require('../platform_utils');
const { buildGuardrailCheckerSource } = require('../guardrails');
const {
  CLAUDE_SETTINGS,
  HOME,
  mergeJsonFile
} = require('./common');

function registerClaudeCodeNativeBlocker() {
  if (!fileExists(CLAUDE_SETTINGS)) return;
  const binDir = path.join(HOME, ".local", "bin");
  const blockerJs = path.join(binDir, "konoha-native-blocker.js");
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const payload = `#!/usr/bin/env node
const reason = "⚠️ MANDATORY RULE VIOLATION: Using built-in/native file tools (Read, Glob, Grep, View, ReadFile, ls, cat, etc.) is STRICTLY FORBIDDEN! You MUST use the konoha MCP tools (read_file_head, read_file_range, token_efficient_grep, get_file_structure, find_files_clean, etc.) or semble MCP for codebase search! Retry using ONLY konoha or semble MCP tools.";
const decision = {
  "decision": "block",
  "reason": reason,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": reason
  }
};
process.stdout.write(JSON.stringify(decision) + "\\n");
`;
    fs.writeFileSync(blockerJs, payload, { mode: 0o755 });
  } catch (_) { /* intentional best-effort fallback */ }

  mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.hooks) config.hooks = {};
      if (!config.hooks.PreToolUse) config.hooks.PreToolUse = [];
      let changed = false;
      const beforeCount = config.hooks.PreToolUse.length;
      config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
        (h) => !((h.hooks || []).some((e) => e.command && e.command.includes("konoha-hook-wrapper")))
      );
      if (config.hooks.PreToolUse.length !== beforeCount) changed = true;
      const blockerRegex = "^(Read|Glob|Grep|View|ReadFile|Replace)$";
      const blockerCommand = `"${process.execPath}" "${blockerJs}"`;
      for (const hook of config.hooks.PreToolUse) {
        if (hook.matcher === blockerRegex) {
          const firstHook = hook.hooks && hook.hooks[0];
          if (firstHook && firstHook.command && firstHook.command.includes("konoha-native-blocker")) {
            if (firstHook.command !== blockerCommand) {
              firstHook.command = blockerCommand;
              changed = true;
            }
            return changed;
          }
        }
      }
      config.hooks.PreToolUse.push({
        matcher: blockerRegex,
        hooks: [
          {
            type: "command",
            command: blockerCommand
          }
        ]
      });
      return true;
    }
  );
}

function buildClaudeCodeBashGuardSource() {
  const checkerLiteral = JSON.stringify(buildGuardrailCheckerSource());
  return `#!/usr/bin/env node
const fs = require('fs');
const GUARDRAIL_CHECKER_SOURCE = ${checkerLiteral};
const checkCommandGuardrails = new Function(GUARDRAIL_CHECKER_SOURCE + "\\nreturn checkCommandGuardrails;")();
let raw = '';
try { raw = fs.readFileSync(0, 'utf-8'); } catch (e) { process.exit(0); }
let input = null;
try { input = JSON.parse(raw); } catch (e) { process.exit(0); }
const toolInput = input && input.tool_input;
const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
if (!command) process.exit(0);
const violation = checkCommandGuardrails(command);
if (!violation) process.exit(0);
const decision = {
  "decision": "block",
  "reason": violation.reason,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": violation.reason
  }
};
process.stdout.write(JSON.stringify(decision) + "\\n");
`;
}

function registerClaudeCodeBashGuard(silent = true) {
  if (!fileExists(CLAUDE_SETTINGS)) return;
  const binDir = path.join(HOME, ".local", "bin");
  const guardJs = path.join(binDir, "konoha-bash-guard.js");
  try {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(guardJs, buildClaudeCodeBashGuardSource(), { mode: 0o755 });
  } catch (e) {
    if (!silent) console.warn(`⚠ Claude Code bash guard deployment failed: ${e.message}`);
    return;
  }

  const guardRegex = "^Bash$";
  const guardCommand = `"${process.execPath}" "${guardJs}"`;
  mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.hooks) config.hooks = {};
      if (!config.hooks.PreToolUse) config.hooks.PreToolUse = [];
      let changed = false;
      const before = config.hooks.PreToolUse.length;
      config.hooks.PreToolUse = config.hooks.PreToolUse.filter(
        (h) => !((h.hooks || []).some((e) => e.command && e.command.includes("konoha-bash-guard")))
      );
      if (config.hooks.PreToolUse.length !== before) changed = true;
      const alreadyPresent =
        before === config.hooks.PreToolUse.length &&
        config.hooks.PreToolUse.some(
          (h) => h.matcher === guardRegex &&
            (h.hooks || []).some((e) => e.command === guardCommand)
        );
      if (!alreadyPresent) {
        config.hooks.PreToolUse.push({
          matcher: guardRegex,
          hooks: [
            {
              type: "command",
              command: guardCommand
            }
          ]
        });
        changed = true;
      }
      return changed;
    }
  );
}

function registerClaudeCodeWorkflowReminder(silent = true) {
  const reminderPath = path.join(HOME, '.konoha', 'workflow_reminder.js');
  if (!fileExists(reminderPath)) return;
  const reminderCommand = `"${process.execPath}" "${reminderPath}"`;
  mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.hooks) config.hooks = {};
      if (!Array.isArray(config.hooks.UserPromptSubmit)) config.hooks.UserPromptSubmit = [];
      if (!Array.isArray(config.hooks.SessionStart)) config.hooks.SessionStart = [];
      let changed = false;

      const upsEntry = config.hooks.UserPromptSubmit.find(
        (e) => e.hooks && e.hooks.some((h) => h.command && h.command.includes('workflow_reminder'))
      );
      if (!upsEntry) {
        config.hooks.UserPromptSubmit.push({
          hooks: [{ type: 'command', command: reminderCommand }]
        });
        changed = true;
      } else {
        upsEntry.hooks.forEach((h) => {
          if (h.command && h.command.includes('workflow_reminder') && h.command !== reminderCommand) {
            h.command = reminderCommand;
            changed = true;
          }
        });
      }

      const ssMatcher = 'resume|compact|clear';
      const ssEntry = config.hooks.SessionStart.find(
        (e) => e.matcher === ssMatcher && e.hooks && e.hooks.some((h) => h.command && h.command.includes('workflow_reminder'))
      );
      if (!ssEntry) {
        const stale = config.hooks.SessionStart.find(
          (e) => e.matcher === ssMatcher && e.hooks && e.hooks.some((h) => h.command && h.command.includes('workflow_reminder') && h.command !== reminderCommand)
        );
        if (stale) {
          stale.hooks.forEach((h) => { if (h.command && h.command.includes('workflow_reminder')) h.command = reminderCommand; });
          changed = true;
        } else {
          config.hooks.SessionStart.push({
            matcher: ssMatcher,
            hooks: [{ type: 'command', command: reminderCommand }]
          });
          changed = true;
        }
      }
      return changed;
    }
  );
  if (!silent) process.stderr.write('✓ Konoha workflow reminder registered (UserPromptSubmit + SessionStart resume/compact/clear)\n');
}

module.exports = {
  registerClaudeCodeNativeBlocker,
  buildClaudeCodeBashGuardSource,
  registerClaudeCodeBashGuard,
  registerClaudeCodeWorkflowReminder
};
