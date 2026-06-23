#!/usr/bin/env node
/**
 * Antigravity PreInvocation hook — session agent.json cache + orchestrator nudge.
 * NOTE: injectSteps toolCall for define_subagent breaks on this Antigravity build
 * ("unknown injected step type"). Registration is handled via:
 *   1) orchestrator define_subagent (sanitized by PreToolUse hook)
 *   2) ~/.gemini/antigravity-cli/agents/<name>/agent.json cache
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.gemini', 'skills-db');
const REGISTRY_DIR = path.join(SKILLS_DB_DIR, '.subagent_registered');
const USER_AGENTS_JSON = path.join(HOME, '.agents', 'agents.json');
const GLOBAL_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function loadAgentsFromGlobalDir() {
  try {
    if (!fs.existsSync(GLOBAL_AGENTS_DIR)) return [];
    return fs
      .readdirSync(GLOBAL_AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const agentPath = path.join(GLOBAL_AGENTS_DIR, d.name, 'agent.json');
        if (!fs.existsSync(agentPath)) return null;
        const json = JSON.parse(fs.readFileSync(agentPath, 'utf-8'));
        return { name: json.name || d.name };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadAgents() {
  try {
    if (fs.existsSync(USER_AGENTS_JSON)) {
      const agents = JSON.parse(fs.readFileSync(USER_AGENTS_JSON, 'utf-8'));
      if (Array.isArray(agents) && agents.length > 0) return agents;
    }
  } catch {}
  return loadAgentsFromGlobalDir();
}

function brainDirFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  const logsDir = path.dirname(transcriptPath);
  if (path.basename(logsDir) !== 'logs') return null;
  const sysDir = path.dirname(logsDir);
  if (path.basename(sysDir) !== '.system_generated') return null;
  return path.dirname(sysDir);
}

function deploySessionAgents(agents, brainDir) {
  if (!brainDir) return;
  const base = path.join(brainDir, '.agents', 'agents');
  for (const agent of agents) {
    try {
      const globalPath = path.join(GLOBAL_AGENTS_DIR, agent.name, 'agent.json');
      const destDir = path.join(base, agent.name);
      fs.mkdirSync(destDir, { recursive: true });
      if (fs.existsSync(globalPath)) {
        fs.copyFileSync(globalPath, path.join(destDir, 'agent.json'));
      }
    } catch {}
  }
}

function isFirstInvocation(invocationNum) {
  return invocationNum === 0 || invocationNum === 1;
}

function isSubagentSpawnSession(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines.slice(0, 5)) {
      const row = JSON.parse(line);
      if (row.type !== 'USER_INPUT') continue;
      const content = row.content || '';
      if (/acting as the\s*`?@/i.test(content)) return true;
      if (/You are the\s+(genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b/i.test(content)) return true;
    }
  } catch {}
  return false;
}

async function main() {
  try {
    const stdinContent = await readStdin();
    if (!stdinContent) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    let context;
    try {
      context = JSON.parse(stdinContent);
    } catch {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const { conversationId, invocationNum, transcriptPath } = context;

    // Never inject into spawned subagent conversations (breaks self/jonin startup)
    if (isSubagentSpawnSession(transcriptPath)) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    if (!conversationId || !isFirstInvocation(invocationNum)) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const agents = loadAgents();
    const brainDir = brainDirFromTranscript(transcriptPath);
    deploySessionAgents(agents, brainDir);

    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    const guardPath = path.join(REGISTRY_DIR, conversationId);
    const firstRun = !fs.existsSync(guardPath);
    if (firstRun) {
      fs.writeFileSync(guardPath, new Date().toISOString(), 'utf-8');
    }

    if (!firstRun) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const names = agents.map((a) => a.name).join(', ');
    process.stdout.write(
      JSON.stringify({
        injectSteps: [
          {
            ephemeralMessage: `[Konoha] Session start: call define_subagent for each ninja (${names}) with BARE string fields — name must be jonin not "\\"jonin\\"". enable_* must be boolean true/false, not strings. Then invoke_subagent with Subagents as a JSON array (not a string) and TypeName jonin. NEVER TypeName self to impersonate jonin.`,
          },
        ],
      }) + '\n'
    );
  } catch {
    process.stdout.write('{}\n');
  }
}

main();
