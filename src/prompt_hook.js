const fs = require('fs');
const readline = require('readline');
const { readStdinJson, isConfirmedSelf } = require('./hook-base');

function _processTranscriptLine(line, state) {
  if (!line.trim()) return;
  try {
    const record = JSON.parse(line);
    if (record && record.type === 'USER_INPUT') {
      state.lastInput = record.content || record.text;
      state.hasResponseAfterInput = false;
    } else if (record && (record.type === 'PLANNER_RESPONSE' || record.source === 'MODEL')) {
      state.hasResponseAfterInput = true;
    }
  } catch (_) {
    // ignore parsing errors for corrupted or partial lines
  }
}

async function getLastUserInput(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { lastInput: null, isNewInput: false };
  }
  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    const state = { lastInput: null, hasResponseAfterInput: false };
    rl.on('line', (line) => _processTranscriptLine(line, state));

    rl.on('close', () => {
      resolve({ lastInput: state.lastInput, isNewInput: state.lastInput !== null && !state.hasResponseAfterInput });
    });

    fileStream.on('error', () => {
      rl.close();
      resolve({ lastInput: null, isNewInput: false });
    });
  });
}

// File-based IPC is retired: this hook NEVER writes prompt.md / delegate.md.
// User input already lives in the transcript; routing uses structured MCP args.
// Inbox notification below peeks SQLite only (no claim, no file append).

const SELF_NUDGE = {
  injectSteps: [
    {
      ephemeralMessage:
        "A user prompt or conversation resume action has been received. User instructions and constraints are passed directly in conversation context / <USER_REQUEST>. Execute the Konoha orchestration workflow immediately via direct structured MCP tool arguments (sannin/genin/kage/chunin/jonin/anbu/tokubetsu-jonin). Do NOT call file_info('prompt.md') or read prompt.md/delegate.md. Adopt High Effort + Instruct Style base personality: strictly NO conversational filler ('hmmmm', 'let me', 'wait - but'), lead with direct action, strictly no lies, zero hallucination. Delivery requires Kage review (>=98% confidence, 0 slop findings) and @advisor approval review before delivery sign-off. The original task remains authoritative; follow-ups refine it. Never drop or replace the original goal."
    }
  ]
};


async function main() {
  try {
    const context = await readStdinJson();
    if (!context) process.exit(0);

    const { transcriptPath } = context;
    if (!transcriptPath) process.exit(0);

    const { isNewInput } = await getLastUserInput(transcriptPath);

    // Inbox notification peeks SQLite only — never claims, never writes prompt.md.
    // Claiming happens via structured queue tools when the agent actually dispatches.
    let pendingInboxMsg = null;
    try {
      const inbox = require('./queue/inbox');
      const pending = inbox.getNextPendingPrompt();
      if (pending) {
        pendingInboxMsg = `[INBOUND PROMPT QUEUE] Task #${pending.id} waiting from ${pending.source}: "${pending.prompt}". Execute via Konoha subagents.`;
      }
    } catch (_) {
      /* intentional fallback: queue failure must never crash prompt hook */
    }

    // ONLY inject the self ephemeral for CONFIRMED self sessions
    // AND only when this is a NEW user input awaiting its initial response.
    // Suppresses repetitive nudges on subsequent tool calls and steps within the turn.
    if (isNewInput && isConfirmedSelf(transcriptPath)) {
      const nudge = JSON.parse(JSON.stringify(SELF_NUDGE));
      if (pendingInboxMsg) {
        nudge.injectSteps.push({ ephemeralMessage: pendingInboxMsg });
      }
      console.log(JSON.stringify(nudge));
    }
  } catch {
    process.exit(0);
  }
}

main();
