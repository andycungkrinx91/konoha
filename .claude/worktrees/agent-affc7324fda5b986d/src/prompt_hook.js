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

    const lastInput = await getLastUserInput(transcriptPath);

    if (lastInput) {
      // Write to artifactDirectoryPath / prompt.md
      if (artifactDirectoryPath) {
        try {
          if (!fs.existsSync(artifactDirectoryPath)) {
            fs.mkdirSync(artifactDirectoryPath, { recursive: true });
          }
          fs.writeFileSync(path.join(artifactDirectoryPath, 'prompt.md'), lastInput, 'utf-8');
        } catch (e) {
          // ignore write errors
        }
      }

      // Output injectSteps JSON to stdout
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
