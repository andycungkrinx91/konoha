const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { readStdinJson, isConfirmedSelf } = require('./hook-base');

const HOME = os.homedir();

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

    let lastInput = null;
    let hasResponseAfterInput = false;
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record && record.type === 'USER_INPUT') {
          lastInput = record.content || record.text;
          hasResponseAfterInput = false;
        } else if (record && (record.type === 'PLANNER_RESPONSE' || record.source === 'MODEL')) {
          hasResponseAfterInput = true;
        }
      } catch (_) {
        // ignore parsing errors for corrupted or partial lines
      }
    });

    rl.on('close', () => {
      resolve({ lastInput, isNewInput: lastInput !== null && !hasResponseAfterInput });
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
        "A user prompt or conversation resume action has been received. Please read prompt.md using konoha MCP (read_file_head/read_file_range) and execute the Konoha orchestration workflow immediately (sannin/genin/kage/chunin/jonin/anbu/tokubetsu-jonin). Adopt High Effort + Instruct Style base personality: strictly NO conversational filler ('hmmmm', 'let me', 'wait - but'), lead with direct action, strictly no lies, zero hallucination. Note: prompt.md may contain an Original Task section plus Follow-up sections — the Original Task remains authoritative; follow-ups refine it. Never drop or replace the original goal."
    }
  ]
};

function ensureWorkspaceRules(targetCwd) {
  try {
    const cwd = targetCwd || process.cwd();
    if (!cwd || cwd === HOME || !fs.existsSync(cwd)) return;

    // 1. Scaffold GEMINI.md in workspace root if missing
    const geminiMdPath = path.join(cwd, 'GEMINI.md');
    if (!fs.existsSync(geminiMdPath)) {
      const templatePath = path.join(__dirname, 'templates', 'GEMINI.md');
      const globalGeminiMd = path.join(HOME, '.gemini', 'GEMINI.md');
      const src = fs.existsSync(templatePath) ? templatePath : (fs.existsSync(globalGeminiMd) ? globalGeminiMd : null);
      if (src) {
        fs.copyFileSync(src, geminiMdPath);
      }
    }

    // 2. Scaffold .agents/AGENTS.md in workspace root if missing
    const agentsDir = path.join(cwd, '.agents');
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

    const { lastInput, isNewInput } = await getLastUserInput(transcriptPath);
    await writePromptFile(lastInput, artifactDirectoryPath);

    // ONLY inject the self ephemeral for CONFIRMED self sessions
    // AND only when this is a NEW user input awaiting its initial response.
    // Suppresses repetitive nudges on subsequent tool calls and steps within the turn.
    if (isNewInput && isConfirmedSelf(transcriptPath)) {
      console.log(JSON.stringify(SELF_NUDGE));
    }
  } catch {
    process.exit(0);
  }
}

main();
