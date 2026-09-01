const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readStdinJson, isConfirmedSelf } = require('./hook-base');

async function getLastUserInput(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return null;
  }
  return new Promise((resolve) => {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lastInput = null;
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record && record.type === 'USER_INPUT') {
          lastInput = record.content || record.text;
        }
      } catch (e) {
        // ignore parsing errors for corrupted or partial lines
      }
    });

    rl.on('close', () => {
      resolve(lastInput);
    });

    fileStream.on('error', () => {
      rl.close();
      resolve(null);
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
        "A user prompt or conversation resume action has been received. Please read prompt.md using konoha MCP (read_file_head/read_file_range) and execute the <agentname> workflow immediately. Note: prompt.md may contain an Original Task section plus Follow-up sections — the Original Task remains authoritative; follow-ups refine it. Never drop or replace the original goal."
    }
  ]
};

async function main() {
  try {
    const context = await readStdinJson();
    if (!context) process.exit(0);

    const { transcriptPath, artifactDirectoryPath } = context;
    if (!transcriptPath) process.exit(0);

    const lastInput = await getLastUserInput(transcriptPath);
    await writePromptFile(lastInput, artifactDirectoryPath);

    // ONLY inject the self ephemeral for CONFIRMED self sessions.
    // At invocation 0 the transcript is empty → isConfirmedSelf returns
    // false → no injection. From invocation 1+ we have evidence.
    if (lastInput && isConfirmedSelf(transcriptPath)) {
      console.log(JSON.stringify(SELF_NUDGE));
    }
  } catch {
    process.exit(0);
  }
}

main();
