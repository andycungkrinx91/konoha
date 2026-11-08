'use strict';

const { getCanonicalAgentNames } = require('./canonical_agents');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildSubagentContract } = require('./agent_contract');

const HOME = os.homedir();
const ANTIGRAVITY_CONFIG_GLOBAL = path.join(HOME, ".gemini", "config");
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(ANTIGRAVITY_CONFIG_GLOBAL, "agents");
const ANTIGRAVITY_CLI_GLOBAL = path.join(HOME, ".gemini", "antigravity-cli");
const ANTIGRAVITY_IDE_GLOBAL = path.join(HOME, ".gemini", "antigravity-ide");

const BASE_TOOLS = [
  'find_by_name',
  'grep_search',
  'file_search',
  'view_file',
  'view_file_outline',
  'view_symbol',
  'read_file',
  'call_mcp_tool',
  'send_message',
];

const WRITE_TOOLS = [
  'replace_file_content',
  'write_to_file',
  'edit_file',
  'write_file',
  'run_command',
];

const SYSTEM_PROMPT_SECTIONS = [
  'SECTION_GENERAL',
  'SECTION_SAFETY',
];

function agentAllowsWriteTools(agent) {
  return !/read-only/i.test(agent.constraints || '');
}

function processAgentInstructions(agent) {
  let instructions = agent.instructions || '';
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const skillList = agent.skills.map(s => `"${s}"`).join(', ');
    const loadingInstruction = `MANDATORY FIRST ACTION before writing code: Call konoha.use_skills({ skills: [${skillList}] }) or konoha.get_skill to load your assigned domain guidelines into context. NEVER skip loading your assigned skills.`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `${loadingInstruction} ` + instructions;
    }
  }
  return `${instructions}\n\n${buildSubagentContract('antigravity')}`;
}

function buildAgentJson(agent) {
  const tools = agentAllowsWriteTools(agent)
    ? [...BASE_TOOLS, ...WRITE_TOOLS]
    : [...BASE_TOOLS];

  const processedInstructions = processAgentInstructions(agent);

  const customAgent = {
    systemPromptSections: [
      {
        title: 'Agent System Instructions',
        content: processedInstructions,
      },
    ],
    toolNames: tools,
    systemPromptConfig: {
      includeSections: SYSTEM_PROMPT_SECTIONS,
    },
  };
  // Only the router may spawn subagents; without this flag a delegated spawn
  // is rejected and the top-level agent silently does the work itself.
  customAgent.enable_subagent_tools = agent.name === ROUTER_AGENT;

  if (agent.model) {
    customAgent.model = agent.model;
  }

  return {
    name: agent.name,
    description: agent.description,
    config: {
      customAgent,
    },
  };
}

function validateAgentName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return false;
  }
  return true;
}

function _pruneStaleAgentDirs(_resolvedBaseDir, _agentNames) {
  // Ownership boundary invariant: Konoha NEVER deletes non-Konoha agent directories
  // inside `agents/`. User-created and third-party agents are strictly preserved.
}

function _writeSingleAgentJson(resolvedBaseDir, agent) {
  if (!agent || !validateAgentName(agent.name)) return 0;
  const agentDir = path.resolve(resolvedBaseDir, agent.name);
  if (!agentDir.startsWith(resolvedBaseDir + path.sep)) return 0;
  const agentPath = path.join(agentDir, 'agent.json');
  try {
    const backupMgr = require('./config_backup_manager');
    if (fs.existsSync(agentPath)) {
      backupMgr.backupConfigFile(agentPath, { client: 'antigravity', scope: 'global' });
    }
    fs.mkdirSync(agentDir, { recursive: true });
    const payload = JSON.stringify(buildAgentJson(agent), null, 2) + '\n';
    const existing = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : null;
    if (existing !== payload) {
      fs.writeFileSync(agentPath, payload, 'utf8');
      backupMgr.recordOwnership(agentPath, {
        client: 'antigravity',
        scope: 'global',
        format: 'json',
        createdByKonoha: existing === null,
        ownedKeys: ['name', 'description', 'config']
      });
      return 1;
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return 0;
}

function deployAgentsToDir(agents, baseDir) {
  if (!agents || agents.length === 0) return { deployed: 0, dir: baseDir };
  const resolvedBaseDir = path.resolve(baseDir);
  _pruneStaleAgentDirs(resolvedBaseDir, new Set(agents.map(a => a.name)));

  let deployed = 0;
  for (const agent of agents) {
    deployed += _writeSingleAgentJson(resolvedBaseDir, agent);
  }
  return { deployed, dir: resolvedBaseDir };
}

function ensureAntigravityAgents(agents, options = {}) {
  const home = options.home || HOME;
  const globalTarget = options.home ? path.join(home, ".gemini", "config", "agents") : ANTIGRAVITY_AGENTS_GLOBAL;
  const cliTarget = options.home ? path.join(home, ".gemini", "antigravity-cli", "agents") : path.join(ANTIGRAVITY_CLI_GLOBAL, "agents");
  const ideTarget = options.home ? path.join(home, ".gemini", "antigravity-ide", "agents") : path.join(ANTIGRAVITY_IDE_GLOBAL, "agents");
  const globalResult = deployAgentsToDir(agents, globalTarget);
  deployAgentsToDir(agents, cliTarget);
  deployAgentsToDir(agents, ideTarget);

  let projectResult = null;
  if (options.projectDir) {
    const projectAgentsDir = path.join(options.projectDir, '.agents', 'agents');
    projectResult = deployAgentsToDir(agents, projectAgentsDir);
  }

  return { global: globalResult, project: projectResult };
}

// Only the router may spawn subagents. Granting this to every agent caused the
// top-level agent to work alone instead of delegating, because it could satisfy
// the task without ever dispatching a specialist.
const ROUTER_AGENT = 'sannin';

function buildDefineSubagentArgs(agent) {
  const processedInstructions = processAgentInstructions(agent);
  return {
    name: agent.name,
    description: agent.description,
    system_prompt: processedInstructions,
    enable_mcp_tools: true,
    enable_write_tools: agentAllowsWriteTools(agent),
    enable_subagent_tools: agent.name === ROUTER_AGENT,
  };
}

function _removeSingleAgentDir(resolvedBase, name) {
  if (!validateAgentName(name)) return;
  const agentDir = path.resolve(resolvedBase, name);
  if (!agentDir.startsWith(resolvedBase + path.sep) || !fs.existsSync(agentDir)) return;
  try {
    fs.rmSync(agentDir, { recursive: true, force: true });
  } catch { /* intentional best-effort fallback */ }
}

function removeAntigravityAgents(options = {}) {
  const home = options.home || process.env.HOME || os.homedir();
  const official = getCanonicalAgentNames();
  const dirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'agents'),
    path.join(home, '.gemini', 'antigravity-ide', 'agents')
  ];

  for (const baseDir of dirs) {
    const resolvedBase = path.resolve(baseDir);
    for (const name of official) {
      _removeSingleAgentDir(resolvedBase, name);
    }
  }
}

module.exports = {
  agentAllowsWriteTools,
  processAgentInstructions,
  buildAgentJson,
  _pruneStaleAgentDirs,
  deployAgentsToDir,
  validateAgentName,
  ensureAntigravityAgents,
  buildDefineSubagentArgs,
  removeAntigravityAgents
};
