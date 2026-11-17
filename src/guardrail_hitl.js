'use strict';

/**
 * src/guardrail_hitl.js
 *
 * Human-in-the-loop front end for the Konoha project guardrail.
 *
 * A hook cannot ask a question: every harness runs PreToolUse non-interactively
 * and expects one JSON answer on stdout. So the automated path stays fail-closed
 * and this module supplies the interactive path a human or agent runs after a
 * denial. It offers exactly two real outcomes — block and route the call through
 * the Konoha alternative, or accept the risk with a justification that is
 * scoped, time-limited, and audited.
 */

const fs = require('fs');
const readline = require('readline');

const {
  normalizeHarness,
  evaluateProjectMcpGuardrail,
  describeGuardrailRemediation,
  recordGuardrailException,
  readGuardrailExceptions
} = require('./project_konoha_mcp_guardrail');

const DEFAULT_TTL_MINUTES = 30;

const MENU_LINES = Object.freeze([
  '  1) Block this call and try another way',
  '  2) Accept with risk (scoped to this call, expires, audited)',
  '  3) Cancel (same as block)'
]);

function formatDenialBriefing(evalResult) {
  return [
    '',
    `Guardrail denial: ${evalResult.code} [${evalResult.harness}]`,
    `  reason       : ${evalResult.reason}`,
    `  another way  : ${describeGuardrailRemediation(evalResult.code)}`
  ].join('\n');
}

function formatExceptionList(entries) {
  if (!entries.length) return 'No active guardrail exceptions.';
  return [
    `Active guardrail exceptions (${entries.length}):`,
    ...entries.map((e) => `  ${e.id}  ${e.code}  tool=${e.tool}  path=${e.path}  expires=${e.expires_at}  by=${e.accepted_by}`)
  ].join('\n');
}

/**
 * True when this process has a controlling terminal it can ask. Cheap probe.
 *
 * `KONOHA_GUARD_NO_TTY=1` forces "no terminal", so the fail-closed branch is
 * reachable deterministically from a script — a test running on a developer's
 * terminal otherwise inherits a real terminal and waits for a keystroke. The
 * override can only ever force a block, never an allow.
 */
function hasControllingTerminal() {
  if (process.env.KONOHA_GUARD_NO_TTY === '1') return false;
  const readPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';
  try {
    fs.closeSync(fs.openSync(readPath, 'r'));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * The denial payload arrives on stdin, so stdin is a pipe whenever `--hitl` is
 * used from a pipeline — and a pipe cannot answer a prompt. Ask the controlling
 * terminal instead, which is the human's actual keyboard. No controlling
 * terminal (CI, a hook, a detached process) returns null and the caller stays
 * fail-closed.
 */
function openControllingTerminal() {
  const readPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty';
  const writePath = process.platform === 'win32' ? 'CONOUT$' : '/dev/tty';
  let inFd = null;
  let outFd = null;
  try {
    inFd = fs.openSync(readPath, 'r');
    outFd = fs.openSync(writePath, 'w');
  } catch (_) {
    if (inFd !== null) { try { fs.closeSync(inFd); } catch (_) { /* ignore */ } }
    if (outFd !== null) { try { fs.closeSync(outFd); } catch (_) { /* ignore */ } }
    return null;
  }
  return {
    input: fs.createReadStream(null, { fd: inFd }),
    output: fs.createWriteStream(null, { fd: outFd }),
    // End the streams rather than closing the descriptors: a raw close under a
    // pending write emits EBADF and takes the process down after the answer.
    close() {
      this.input.destroy();
      this.output.end();
    }
  };
}

/**
 * Line-queued prompt reader. readline drops a line typed before a question is
 * pending, and `rl.question` throws after close, so buffer lines and resolve
 * pending prompts from the queue. EOF resolves the prompt with '' — the menu
 * treats that as "block".
 */
function _createPrompter(rl, output) {
  const pending = [];
  const queued = [];
  let closed = false;

  const flush = () => {
    while (pending.length && queued.length) pending.shift()(queued.shift());
  };

  rl.on('line', (line) => { queued.push(line); flush(); });
  rl.on('close', () => {
    closed = true;
    while (pending.length) pending.shift()('');
  });

  return (prompt) => new Promise((resolve) => {
    output.write(prompt);
    pending.push(resolve);
    flush();
    if (closed) {
      while (pending.length) pending.shift()('');
    }
  });
}

/**
 * Render the three-way menu and collect the decision.
 * Returns { choice: 'block' | 'cancel' | 'accept', exception? }.
 * EOF, an empty answer, or an unrecognised answer blocks: the safe default.
 */
async function askHitlDecision(options = {}) {
  // stdin carries the payload, so only a real tty can answer; otherwise fail closed.
  const tty = options.input ? null : openControllingTerminal();
  const input = options.input || (tty && tty.input) || process.stdin;
  const output = options.output || (tty && tty.output) || process.stdout;
  const evalResult = options.evalResult || {};
  const repoRoot = options.repoRoot;
  if (!repoRoot) throw new Error('askHitlDecision requires the Konoha repository root.');

  output.write(`${formatDenialBriefing(evalResult)}\n${MENU_LINES.join('\n')}\n`);
  const rl = readline.createInterface({ input, output, terminal: Boolean(output.isTTY) });
  const ask = _createPrompter(rl, output);
  try {
    const raw = String(await ask('Choose 1/2/3 [1]: ')).trim();
    const answer = raw || '1';

    if (answer === '3') return { choice: 'cancel' };
    if (answer !== '2') return { choice: 'block' };

    const ttlMinutes = Number.isFinite(options.ttlMinutes) && options.ttlMinutes > 0
      ? options.ttlMinutes
      : DEFAULT_TTL_MINUTES;
    let justification = String(options.justification || '').trim();
    if (!justification) {
      justification = String(await ask('Justification (written to the audit log): ')).trim();
    }

    const exception = recordGuardrailException(repoRoot, {
      code: evalResult.code,
      tool: evalResult.tool_name || options.toolName || '*',
      targetPath: evalResult.target_path || options.targetPath || '',
      justification,
      harness: evalResult.harness,
      ttlMs: ttlMinutes * 60 * 1000,
      acceptedBy: options.acceptedBy
    });
    output.write(`Risk accepted: ${exception.id} until ${exception.expires_at}\n`);
    return { choice: 'accept', exception };
  } finally {
    rl.close();
    if (tty) tty.close();
  }
}

/**
 * One HITL round trip: evaluate, and only when denied, ask.
 * The re-evaluation after an acceptance proves the exception actually applies.
 */
async function runHitlSession(options = {}) {
  const harness = normalizeHarness(options.harness);
  const payload = options.payload || {};
  const evalOptions = { harness };
  if (options.repoRoot) evalOptions.repoRoot = options.repoRoot;
  if (options.cwd) evalOptions.cwd = options.cwd;

  const evaluation = evaluateProjectMcpGuardrail(payload, evalOptions);
  if (evaluation.allowed) return { choice: 'allow', evaluation };

  const repoRoot = options.repoRoot || evaluation.repo_root;
  const decision = await askHitlDecision({
    ...options,
    evalResult: {
      ...evaluation,
      tool_name: payload.tool_name || payload.toolName || payload.tool || '',
      target_path: (payload.tool_input && (payload.tool_input.path || payload.tool_input.file_path)) || ''
    },
    repoRoot
  });

  if (decision.choice !== 'accept') {
    return {
      choice: decision.choice,
      evaluation,
      remediation: describeGuardrailRemediation(evaluation.code)
    };
  }

  const reEvaluated = evaluateProjectMcpGuardrail(payload, evalOptions);
  return { choice: 'accept', evaluation: reEvaluated, exception: decision.exception };
}

module.exports = {
  DEFAULT_TTL_MINUTES,
  MENU_LINES,
  formatDenialBriefing,
  formatExceptionList,
  askHitlDecision,
  hasControllingTerminal,
  openControllingTerminal,
  runHitlSession,
  readGuardrailExceptions
};
