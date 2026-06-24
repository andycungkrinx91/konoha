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
const SKILLS_DB_DIR = path.join(HOME, '.konoha');
const REGISTRY_DIR = path.join(SKILLS_DB_DIR, '.subagent_registered');
const USER_AGENTS_JSON = path.join(HOME, '.agents', 'agents.json');
const GLOBAL_CLI_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');
const GLOBAL_IDE_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-ide', 'agents');
const GLOBAL_CONFIG_AGENTS_DIR = path.join(HOME, '.gemini', 'config', 'agents');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function loadAgentsFromGlobalDir() {
  const dirs = [GLOBAL_CLI_AGENTS_DIR, GLOBAL_IDE_AGENTS_DIR, GLOBAL_CONFIG_AGENTS_DIR];
  const seen = new Set();
  const agents = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const subdirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const d of subdirs) {
        if (seen.has(d.name.toLowerCase())) continue;
        const agentPath = path.join(dir, d.name, 'agent.json');
        if (!fs.existsSync(agentPath)) continue;
        const json = JSON.parse(fs.readFileSync(agentPath, 'utf-8'));
        seen.add(d.name.toLowerCase());
        agents.push({ name: json.name || d.name });
      }
    } catch (e) {}
  }
  return agents;
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
  const antigravityManager = require('./antigravity_manager');
  for (const agent of agents) {
    try {
      const destDir = path.join(base, agent.name);
      fs.mkdirSync(destDir, { recursive: true });
      const payload = antigravityManager.buildAgentJson({
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        constraints: agent.constraints || '',
        modelTier: agent.modelTier,
      });
      fs.writeFileSync(path.join(destDir, 'agent.json'), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    } catch {}
  }
}

function isFirstInvocation(invocationNum) {
  return invocationNum === 0 || invocationNum === 1;
}

/**
 * Determines if this session is CONFIRMED to be the main orchestrator.
 * Returns true ONLY when we have positive evidence from the transcript
 * that this is NOT a subagent session.
 *
 * Key design: defaults to false (safe) when uncertain.
 * This prevents orchestrator ephemeral from being injected into
 * subagent sessions where the transcript is empty at invocation 0.
 */
function isConfirmedOrchestrator(transcriptPath) {
  if (!transcriptPath) return false;
  if (transcriptPath.includes('/subagents/')) return false;

  try {
    const fullPath = transcriptPath.replace('transcript.jsonl', 'transcript_full.jsonl');
    const targetPath = fs.existsSync(fullPath) ? fullPath : transcriptPath;

    if (!fs.existsSync(targetPath)) return false;

    const raw = fs.readFileSync(targetPath, 'utf-8').trim();
    if (!raw) return false; // Empty transcript → can't confirm

    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return false;

    for (const line of lines.slice(0, 50)) {
      try {
        const row = JSON.parse(line);
        const content = row.content || row.thinking || '';

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

    return true;
  } catch {
    return false;
  }
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

    // ──────────────────────────────────────────────────────────────────
    // STEP 1: ALWAYS deploy agent.json at first invocation.
    // This is HARMLESS for subagent sessions (files just sit unused)
    // but ESSENTIAL for orchestrator sessions (Antigravity uses these
    // to validate invoke_subagent calls). Deploying unconditionally
    // avoids the invocation-0 chicken-and-egg detection problem.
    // ──────────────────────────────────────────────────────────────────
    if (conversationId && isFirstInvocation(invocationNum)) {
      const agents = loadAgents();
      const brainDir = brainDirFromTranscript(transcriptPath);
      deploySessionAgents(agents, brainDir);
    }

    process.stdout.write('{}\n');
    process.exit(0);
  } catch {
    process.stdout.write('{}\n');
  }
}

main();
