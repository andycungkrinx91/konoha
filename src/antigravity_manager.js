/**
 * Deploy Konoha ninja subagents as native Antigravity CLI agent.json files.
 * Pre-registration avoids broken LLM define_subagent calls (e.g. name "\"jonin\"").
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');

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

function buildAgentJson(agent) {
  const tools = agentAllowsWriteTools(agent)
    ? [...BASE_TOOLS, ...WRITE_TOOLS]
    : [...BASE_TOOLS];

  return {
    name: agent.name,
    description: agent.description,
    hidden: true,
    config: {
      customAgent: {
        systemPromptSections: [
          {
            title: 'Agent System Instructions',
            content: agent.instructions,
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
    } catch (err) {
      // Fail silently for read-only dirs
    }
  }
  return { deployed, dir: baseDir };
}

/**
 * Deploy global Antigravity CLI agents (~/.gemini/antigravity-cli/agents/).
 */
function ensureAntigravityAgents(agents, options = {}) {
  const globalResult = deployAgentsToDir(agents, ANTIGRAVITY_AGENTS_GLOBAL);

  let projectResult = null;
  if (options.projectDir) {
    const projectAgentsDir = path.join(options.projectDir, '.agents', 'agents');
    projectResult = deployAgentsToDir(agents, projectAgentsDir);
  }

  if (!options.silent && globalResult.deployed > 0) {
    console.log(
      `✓ Deployed ${globalResult.deployed} Antigravity agent.json file(s) to ${ANTIGRAVITY_AGENTS_GLOBAL}`
    );
  }

  return { global: globalResult, project: projectResult };
}

function buildDefineSubagentArgs(agent) {
  return {
    name: agent.name,
    description: agent.description,
    system_prompt: agent.instructions,
    enable_mcp_tools: true,
    enable_write_tools: agentAllowsWriteTools(agent),
    enable_subagent_tools: false,
  };
}

function buildAntigravityPreinstalledAgentsNote(agents) {
  const names = agents.map((a) => `\`${a.name}\``).join(', ');
  return `### Konoha subagents (${names})

Pre-installed at \`~/.gemini/antigravity-cli/agents/<name>/agent.json\`. **At session start**, call \`define_subagent\` for each ninja per definitions below (GEMINI.md). The \`konoha-subagent-hook\` also injects programmatic registration on first turn as a backup.`;
}

module.exports = {
  ANTIGRAVITY_AGENTS_GLOBAL,
  buildAgentJson,
  buildDefineSubagentArgs,
  ensureAntigravityAgents,
  buildAntigravityPreinstalledAgentsNote,
};
