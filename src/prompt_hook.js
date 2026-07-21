const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readStdinJson, isConfirmedOrchestrator } = require('./hook-base');

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
      resolve(null);
    });
  });
}

const CONTINUE_PATTERN = /^(continue|go|proceed|next|ok|yes|y)$/i;

async function writePromptFile(lastInput, artifactDirectoryPath) {
  if (!lastInput || !artifactDirectoryPath) return;
  try {
    if (!fs.existsSync(artifactDirectoryPath)) {
      fs.mkdirSync(artifactDirectoryPath, { recursive: true });
    }
    const promptFilePath = path.join(artifactDirectoryPath, 'prompt.md');
    if (fs.existsSync(promptFilePath)) {
      if (CONTINUE_PATTERN.test(lastInput.trim())) return;
    }
    fs.writeFileSync(promptFilePath, lastInput, 'utf-8');
  } catch {
    // ignore write errors
  }
}

const ORCHESTRATOR_NUDGE = {
  injectSteps: [
    {
      ephemeralMessage:
        "A new user prompt has been written to prompt.md in your artifact directory. Please immediately read it using the view_file tool to retrieve the complete user request/prompt, and rely on this file instead of large chat history inputs to save tokens."
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

    // ONLY inject the orchestrator ephemeral for CONFIRMED orchestrator sessions.
    // At invocation 0 the transcript is empty → isConfirmedOrchestrator returns
    // false → no injection. From invocation 1+ we have evidence.
    if (lastInput && isConfirmedOrchestrator(transcriptPath)) {
      console.log(JSON.stringify(ORCHESTRATOR_NUDGE));
    }
  } catch {
    process.exit(0);
  }
}

main();