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
const OFFICIAL_NINJAS = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];

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
      try { fs.rmSync(path.join(base, entry.name), { recursive: true, force: true }); } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
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
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  }
  return agents;
}

function loadAgents() {
  try {
    if (fs.existsSync(USER_AGENTS_YAML)) {
      const agents = parseYaml(fs.readFileSync(USER_AGENTS_YAML, 'utf-8'));
      if (Array.isArray(agents) && agents.length > 0) return agents;
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
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
        skills: agent.skills || [],
      });
      fs.writeFileSync(path.join(destDir, 'agent.json'), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  }
}

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

    // Auto-scaffold workspace rules (GEMINI.md, AGENTS.md) in new project workspaces
    ensureWorkspaceRules();

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