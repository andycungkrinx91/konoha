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

const { parseYaml } = (() => {
  try { return require('./agent_manager'); }
  catch (_) {
    try { return require('./yaml_utils'); }
    catch (__) { return { parseYaml: null }; }
  }
})();
const { readStdinJson, brainDirFromTranscript } = require('./hook-base');

const HOME = os.homedir();
// Self-contained: derive agent paths from HOME rather than importing bin/lib/paths.
const USER_AGENTS_YAML = path.join(HOME, '.agents', 'agents.yaml');
const GLOBAL_CLI_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');
const GLOBAL_IDE_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-ide', 'agents');
const GLOBAL_CONFIG_AGENTS_DIR = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp');

/**
 * Official ninja roster — the ONLY agent directory names allowed inside a
 * session's `.agents/agents/` directory. Anything else (e.g. a leaked
 * `define_subagent` artifact from a previous orchestrator run, or stale
 * `test-*` debug agents) is purged by `cleanStaleSessionAgents` so it cannot
 * shadow the real roster and break `Agent(name: ...)` invocations.
 */
const OFFICIAL_NINJAS = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];

/**
 * Remove any directory under `base` whose name is NOT in the official ninja
 * whitelist. Defense-in-depth against leaked `define_subagent` artifacts and
 * stale test agents. Safe-by-default: silent on every error path.
 */
function cleanStaleSessionAgents(base) {
  if (!fs.existsSync(base)) return;
  const official = new Set(OFFICIAL_NINJAS);
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (official.has(entry.name)) continue;
      try { fs.rmSync(path.join(base, entry.name), { recursive: true, force: true }); } catch {}
    }
  } catch {}
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
    if (fs.existsSync(USER_AGENTS_YAML)) {
      const agents = parseYaml(fs.readFileSync(USER_AGENTS_YAML, 'utf-8'));
      if (Array.isArray(agents) && agents.length > 0) return agents;
    }
  } catch {}
  return loadAgentsFromGlobalDir();
}

function deploySessionAgents(agents, brainDir) {
  if (!brainDir) return;
  const base = path.join(brainDir, '.agents', 'agents');
  cleanStaleSessionAgents(base);
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
        skills: agent.skills || [],
      });
      fs.writeFileSync(path.join(destDir, 'agent.json'), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    } catch {}
  }
}

function isFirstInvocation(invocationNum) {
  return invocationNum === 0 || invocationNum === 1;
}

async function main() {
  try {
    const context = await readStdinJson();
    if (!context) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const { conversationId, invocationNum, transcriptPath } = context;

    // ALWAYS deploy agent.json at first invocation.
    // Harmless for subagent sessions (files just sit unused) but essential
    // for orchestrator sessions (Antigravity uses these to validate
    // invoke_subagent calls). Deploying unconditionally avoids the
    // invocation-0 chicken-and-egg detection problem.
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