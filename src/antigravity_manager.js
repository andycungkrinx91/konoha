const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(HOME, '.gemini', 'config', 'agents');
const ANTIGRAVITY_CLI_GLOBAL = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');
const ANTIGRAVITY_IDE_GLOBAL = path.join(HOME, '.gemini', 'antigravity-ide', 'agents');

const BASE_TOOLS = [
  'send_message',
  'find_by_name',
  'grep_search',
  'view_file',
  'list_dir',
  'read_url_content',
  'search_web',
  'schedule',
  'call_mcp_tool',
];

const WRITE_TOOLS = [
  'multi_replace_file_content',
  'replace_file_content',
  'write_to_file',
  'run_command',
  'manage_task',
];

const SYSTEM_PROMPT_SECTIONS = [
  'user_information',
  'mcp_servers',
  'skills',
  'subagent_reminder',
  'messaging',
  'artifacts',
  'user_rules',
];

function agentAllowsWriteTools(agent) {
  return !/read-only/i.test(agent.constraints || '');
}

function processAgentInstructions(agent) {
  let instructions = agent.instructions || '';
  // Strip any existing Before work: find_skill(...) checklist calls
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const findSkillCalls = agent.skills.map(s => `find_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ` + instructions;
    }
  }
  return instructions;
}

function buildAgentJson(agent) {
  const tools = agentAllowsWriteTools(agent)
    ? [...BASE_TOOLS, ...WRITE_TOOLS]
    : [...BASE_TOOLS];

  const processedInstructions = processAgentInstructions(agent);

  return {
    name: agent.name,
    description: agent.description,
    config: {
      customAgent: {
        model: agent.modelTier,
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
      },
    },
  };
}

function deployAgentsToDir(agents, baseDir) {
  if (!agents || agents.length === 0) return { deployed: 0, dir: baseDir };

  let deployed = 0;
  for (const agent of agents) {
    const agentDir = path.join(baseDir, agent.name);
    const agentPath = path.join(agentDir, 'agent.json');
    try {
      fs.mkdirSync(agentDir, { recursive: true });
      const payload = JSON.stringify(buildAgentJson(agent), null, 2) + '\n';
      const existing = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : null;
      if (existing !== payload) {
        fs.writeFileSync(agentPath, payload, 'utf8');
        deployed += 1;
      }
    } catch (err) {}
  }
  return { deployed, dir: baseDir };
}

function ensureAntigravityAgents(agents, options = {}) {
  const globalResult = deployAgentsToDir(agents, ANTIGRAVITY_AGENTS_GLOBAL);

  // Deploy to CLI and IDE specific directories as well for full discovery coverage
  deployAgentsToDir(agents, ANTIGRAVITY_CLI_GLOBAL);
  deployAgentsToDir(agents, ANTIGRAVITY_IDE_GLOBAL);

  let projectResult = null;
  if (options.projectDir) {
    const projectAgentsDir = path.join(options.projectDir, '.agents', 'agents');
    projectResult = deployAgentsToDir(agents, projectAgentsDir);
  }

  return { global: globalResult, project: projectResult };
}

function buildDefineSubagentArgs(agent) {
  const processedInstructions = processAgentInstructions(agent);
  return {
    name: agent.name,
    description: agent.description,
    system_prompt: processedInstructions,
    model: agent.modelTier,
    enable_mcp_tools: true,
    enable_write_tools: agentAllowsWriteTools(agent),
    enable_subagent_tools: false,
  };
}

function removeAntigravityAgents(silent = true) {
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  const dirs = [
    ANTIGRAVITY_AGENTS_GLOBAL,
    ANTIGRAVITY_CLI_GLOBAL,
    ANTIGRAVITY_IDE_GLOBAL
  ];

  for (const baseDir of dirs) {
    for (const name of official) {
      const agentDir = path.join(baseDir, name);
      if (fs.existsSync(agentDir)) {
        try {
          fs.rmSync(agentDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

module.exports = {
  ANTIGRAVITY_AGENTS_GLOBAL,
  buildAgentJson,
  buildDefineSubagentArgs,
  ensureAntigravityAgents,
  removeAntigravityAgents,
};
