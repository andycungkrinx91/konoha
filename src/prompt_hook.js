const fs = require('fs');
const path = require('path');
const readline = require('readline');

// We will read from stdin
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
  });
}

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
        // Find the latest USER_INPUT type record
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

/**
 * Determines if this session is CONFIRMED to be the main orchestrator.
 * Returns true ONLY when we have positive evidence from the transcript
 * that this is NOT a subagent session.
 *
 * Key design: defaults to false (safe) when uncertain.
 * This prevents the ephemeral orchestrator message from being injected
 * into subagent sessions where the transcript is empty at invocation 0.
 */
function isConfirmedOrchestrator(transcriptPath) {
  // No transcript path → can't confirm → safe default
  if (!transcriptPath) return false;

  // Definitely a subagent if path contains /subagents/
  if (transcriptPath.includes('/subagents/')) return false;

  // Try to read transcript (prefer full uncompacted version)
  try {
    const fullPath = transcriptPath.replace('transcript.jsonl', 'transcript_full.jsonl');
    const targetPath = fs.existsSync(fullPath) ? fullPath : transcriptPath;

    if (!fs.existsSync(targetPath)) return false; // No file → can't confirm

    const raw = fs.readFileSync(targetPath, 'utf-8').trim();
    if (!raw) return false; // Empty transcript (invocation 0) → can't confirm

    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return false; // No lines → can't confirm

    // Scan first 50 lines for subagent indicators
    for (const line of lines.slice(0, 50)) {
      try {
        const row = JSON.parse(line);
        const content = row.content || row.thinking || '';

        // If any subagent signature is found → definitely NOT orchestrator
        if (row.type === 'USER_INPUT') {
          if (/acting as the\s*`?@/i.test(content)) return false;
          if (/You are the\s+(genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b/i.test(content)) return false;
          // Check for EITHER delegate.md OR result.md (invoke prompt may only mention one)
          if (content.includes('delegate.md') || content.includes('result.md')) return false;
          if (/(?:Please\s+)?read\s+(?:your task|the delegation)/i.test(content)) return false;
          // Brain path in USER_INPUT = subagent prompt (orchestrator never receives these)
          if (/\/brain\/[a-f0-9-]+\/scratch\/tasks\//i.test(content)) return false;
        }
        if (row.source === 'MODEL') {
          if (/\[(?:🍃|🌀|📜|🛡️|👥|🎯)?\s*(?:Genin|Kage|Chunin|Jonin|Anbu|Tokubetsu-jonin)\]\s*active/i.test(content)) return false;
        }
      } catch {}
    }

    // Has transcript content + no subagent indicators = confirmed orchestrator
    return true;
  } catch {
    return false; // Error reading → can't confirm → safe default
  }
}

async function main() {
  try {
    const stdinContent = await readStdin();
    if (!stdinContent) {
      process.exit(0);
    }
    
    let context;
    try {
      context = JSON.parse(stdinContent);
    } catch (e) {
      process.exit(0);
    }

    const { transcriptPath, workspacePaths, artifactDirectoryPath } = context;

    if (!transcriptPath) {
      process.exit(0);
    }

    // Always try to write prompt.md (useful for orchestrator sessions)
    const lastInput = await getLastUserInput(transcriptPath);

    if (lastInput && artifactDirectoryPath) {
      try {
        if (!fs.existsSync(artifactDirectoryPath)) {
          fs.mkdirSync(artifactDirectoryPath, { recursive: true });
        }
        fs.writeFileSync(path.join(artifactDirectoryPath, 'prompt.md'), lastInput, 'utf-8');
      } catch (e) {
        // ignore write errors
      }
    }

    // ONLY inject the orchestrator ephemeral for CONFIRMED orchestrator sessions.
    // This is the critical gate that prevents subagent poisoning.
    // At invocation 0, transcript is empty → isConfirmedOrchestrator returns false → no injection.
    // The orchestrator still works because user_global rules contain the full instructions.
    // From invocation 1+, the transcript has content and the orchestrator is confirmed.
    if (lastInput && isConfirmedOrchestrator(transcriptPath)) {
      const result = {
        injectSteps: [
          {
            ephemeralMessage: "A new user prompt has been written to prompt.md in your artifact directory. Please immediately read it using the view_file tool to retrieve the complete user request/prompt, and rely on this file instead of large chat history inputs to save tokens."
          }
        ]
      };
      console.log(JSON.stringify(result));
    }
  } catch (err) {
    // catch all errors to prevent hooks from breaking execution loop
    process.exit(0);
  }
}

main();
