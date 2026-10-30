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

const CONTINUE_PATTERN = /^(continue|go|proceed|next|ok|yes|y)$/i;

const PROMPT_HEADER = [
  '# Session Prompts',
  '',
  '> The FIRST section below is the ORIGINAL TASK. Sections marked "Follow-up"',
  '> refine it but NEVER replace it. When executing, always preserve the',
  '> original goal: fix the reported bug itself; do not abandon prior work',
  '> when a new error appears — resolve both, original task first.',
  ''
].join('\n');

async function writePromptFile(lastInput, artifactDirectoryPath) {
  if (!lastInput || !artifactDirectoryPath) return;
  try {
    if (!fs.existsSync(artifactDirectoryPath)) {
      fs.mkdirSync(artifactDirectoryPath, { recursive: true });
    }
    const promptFilePath = path.join(artifactDirectoryPath, 'prompt.md');
    const trimmed = lastInput.trim();
    if (!trimmed) return;

    if (!fs.existsSync(promptFilePath)) {
      fs.writeFileSync(promptFilePath, `${PROMPT_HEADER}\n## Original Task\n\n${trimmed}\n`, 'utf-8');
      return;
    }

    // Continue-style inputs carry no new task content — leave the file as-is.
    if (CONTINUE_PATTERN.test(trimmed)) return;

    const existing = fs.readFileSync(promptFilePath, 'utf-8');
    // Skip exact duplicates (hook may fire twice for the same input).
    if (existing.includes(trimmed)) return;

    // Append as a follow-up so the original task is never overwritten or lost.
    const followUpCount = (existing.match(/^## Follow-up /gm) || []).length;
    const stamp = new Date().toISOString();
    fs.appendFileSync(
      promptFilePath,
      `\n\n## Follow-up ${followUpCount + 1} (${stamp})\n\n${trimmed}\n`,
      'utf-8'
    );
  } catch {
    // ignore write errors
  }
}

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

    const { transcriptPath, artifactDirectoryPath } = context;
    if (!transcriptPath) process.exit(0);

async function appendPendingInboxPrompts(artifactDirectoryPath) {
  if (!artifactDirectoryPath) return null;
  try {
    const inbox = require('./queue/inbox');
    const sessionId = path.basename(artifactDirectoryPath);
    const pending = inbox.claimNextPendingPrompt({ client: 'antigravity', session_id: sessionId });
    if (!pending) return null;
    const promptFilePath = path.join(artifactDirectoryPath, 'prompt.md');
    if (!fs.existsSync(promptFilePath)) return null;
    const existing = fs.readFileSync(promptFilePath, 'utf-8');
    if (existing.includes(pending.id)) return null;
    const followUpCount = (existing.match(/^## Follow-up /gm) || []).length;
    const stamp = new Date().toISOString();
    const content = `\n\n## Follow-up ${followUpCount + 1} (${stamp}) [Inbound Queue: ${pending.id} from ${pending.source}]\n\n<USER_REQUEST>\n${pending.prompt}\n</USER_REQUEST>\n`;
    fs.appendFileSync(promptFilePath, content, 'utf-8');
    return pending;
  } catch (_) {
    /* intentional fallback: queue file append error must not crash prompt hook */
    return null;
  }
}

    const { lastInput, isNewInput } = await getLastUserInput(transcriptPath);
    await writePromptFile(lastInput, artifactDirectoryPath);
    const queuedTask = await appendPendingInboxPrompts(artifactDirectoryPath);

    // Inject pending inbox/telegram prompt notification if queued
    let pendingInboxMsg = null;
    try {
      const inbox = require('./queue/inbox');
      const pending = queuedTask || inbox.getNextPendingPrompt();
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
