const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { readStdinJson, isConfirmedSelf } = require('./hook-base');

const HOME = os.homedir();

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

function ensureWorkspaceRules(targetCwd) {
  try {
    const cwd = targetCwd || process.cwd();
    if (!cwd || cwd === HOME || !fs.existsSync(cwd)) return;
    const contractPath = path.join(HOME, '.konoha', 'agent_contract.js');
    const agentContract = fs.existsSync(contractPath) ? require(contractPath) : null;

    const geminiMdPath = path.join(cwd, 'GEMINI.md');
    if (!fs.existsSync(geminiMdPath)) {
      const templatePath = path.join(__dirname, 'templates', 'GEMINI.md');
      const globalGeminiMd = path.join(HOME, '.gemini', 'GEMINI.md');
      const src = fs.existsSync(templatePath) ? templatePath : (fs.existsSync(globalGeminiMd) ? globalGeminiMd : null);
      if (src) fs.copyFileSync(src, geminiMdPath);
      else if (agentContract) fs.writeFileSync(geminiMdPath, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('antigravity')), 'utf8');
    }

    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      const templateClaude = path.join(__dirname, 'templates', 'CLAUDE.md');
      const globalClaudeMd = path.join(HOME, '.claude', 'CLAUDE.md');
      const src = fs.existsSync(templateClaude) ? templateClaude : (fs.existsSync(globalClaudeMd) ? globalClaudeMd : null);
      if (src) fs.copyFileSync(src, claudeMdPath);
      else if (agentContract) fs.writeFileSync(claudeMdPath, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('claude')), 'utf8');
    }

    const agentsDir = path.join(cwd, '.agents');
    const agentsMdPath = path.join(agentsDir, 'AGENTS.md');
    const rootAgentsMdPath = path.join(cwd, 'AGENTS.md');
    const templateAgents = path.join(__dirname, 'templates', 'AGENTS.md');
    const globalAgentsMd = path.join(HOME, '.agents', 'AGENTS.md');
    const srcAgents = fs.existsSync(templateAgents) ? templateAgents : (fs.existsSync(globalAgentsMd) ? globalAgentsMd : null);

    if (!fs.existsSync(agentsMdPath)) {
      if (srcAgents) {
        if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
        fs.copyFileSync(srcAgents, agentsMdPath);
      } else if (agentContract) {
        if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(agentsMdPath, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('antigravity')), 'utf8');
      }
    }
    if (!fs.existsSync(rootAgentsMdPath)) {
      if (srcAgents) fs.copyFileSync(srcAgents, rootAgentsMdPath);
      else if (agentContract) fs.writeFileSync(rootAgentsMdPath, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('antigravity')), 'utf8');
    }

    const cursorRuleDir = path.join(cwd, '.cursor', 'rules');
    const cursorRulePath = path.join(cursorRuleDir, 'konoha.mdc');
    if (!fs.existsSync(cursorRulePath)) {
      const globalCursorRule = path.join(HOME, '.cursor', 'rules', 'konoha.mdc');
      if (fs.existsSync(globalCursorRule)) {
        if (!fs.existsSync(cursorRuleDir)) fs.mkdirSync(cursorRuleDir, { recursive: true });
        fs.copyFileSync(globalCursorRule, cursorRulePath);
      } else if (agentContract) {
        if (!fs.existsSync(cursorRuleDir)) fs.mkdirSync(cursorRuleDir, { recursive: true });
        fs.writeFileSync(cursorRulePath, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('cursor')), 'utf8');
      }
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
}

async function main() {
  try {
    const context = await readStdinJson();
    if (!context) process.exit(0);

    const targetDir = context.workspaceDirectory || context.cwd || context.projectDirectory || process.cwd();
    // Auto-scaffold workspace rules (GEMINI.md, AGENTS.md) in new project workspaces
    ensureWorkspaceRules(targetDir);

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
