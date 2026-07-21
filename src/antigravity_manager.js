const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  ANTIGRAVITY_AGENTS_GLOBAL,
  ANTIGRAVITY_CLI_GLOBAL,
  ANTIGRAVITY_IDE_GLOBAL
} = require('../bin/lib/paths');

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

  // Sync directory: delete any subdirectory that does not match an agent name
  try {
    if (fs.existsSync(baseDir)) {
      const existingDirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      const agentNames = new Set(agents.map(a => a.name));
      for (const dirName of existingDirs) {
        if (!agentNames.has(dirName)) {
          const staleDir = path.join(baseDir, dirName);
          fs.rmSync(staleDir, { recursive: true, force: true });
        }
      }
    }
  } catch (err) {}

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

function ensureAntigravityMcpSchemas(agents) {
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
  }

  const subagentsInfo = [
    {
      name: 'mcp_sannin',
      description: 'Sannin router agent. Resolves the task prompt, chooses the best subagent to run, and triggers it.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task prompt. If not provided, reads from prompt.md in task_dir.' },
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_kage',
      description: 'Village Leader & Architect subagent. Focuses on architecture decisions, security audits, and critical problem solving.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_jonin',
      description: 'UI & Frontend Specialist subagent. Focuses on UI components, SvelteKit, Next.js, and visual excellence.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_anbu',
      description: 'Backend & DevOps Specialist subagent. Focuses on backend logic, bug fixes, database schema, CI/CD, and infra.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_chunin',
      description: 'Intel & Research subagent. Focuses on web research, documentation lookup, compliance, and evidence synthesis.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_tokubetsu_jonin',
      description: 'Technical Writer & Scribe subagent. Focuses on README, API specs, diagrams, specs, and documentation.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'mcp_genin',
      description: 'Codebase Scout subagent. Focuses on read-only codebase navigation, symbol tracing, and dependency mapping.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    }
  ];

  for (const info of subagentsInfo) {
    const filePath = path.join(schemaDir, `${info.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2) + '\n', 'utf8');
  }
}

function getAntigravityStatus() {
  const mcpConfigPath = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
  const hooksPath = path.join(HOME, '.gemini', 'config', 'hooks.json');
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');

  let mcpConfigExists = fs.existsSync(mcpConfigPath);
  let mcpSkillsDb = false;
  let mcpSemble = false;

  if (mcpConfigExists) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (config.mcpServers) {
        mcpSkillsDb = !!config.mcpServers.konoha;
        mcpSemble = !!config.mcpServers.semble;
      }
    } catch {}
  }

  let hooksExists = fs.existsSync(hooksPath);
  let hasHooks = false;
  if (hooksExists) {
    try {
      const content = fs.readFileSync(hooksPath, 'utf8');
      hasHooks = content.includes('antigravity_subagent_hook.js') || content.includes('antigravity_tool_sanitize_hook.js');
    } catch {}
  }

  let agentsCount = 0;
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  if (fs.existsSync(ANTIGRAVITY_AGENTS_GLOBAL)) {
    try {
      agentsCount = fs.readdirSync(ANTIGRAVITY_AGENTS_GLOBAL).filter(f => {
        if (!official.includes(f)) return false;
        const p = path.join(ANTIGRAVITY_AGENTS_GLOBAL, f);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'agent.json'));
      }).length;
    } catch {}
  }

  let schemasCount = 0;
  if (fs.existsSync(schemaDir)) {
    try {
      schemasCount = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json')).length;
    } catch {}
  }

  return {
    mcpConfigExists,
    mcpSkillsDb,
    mcpSemble,
    hasHooks,
    agentsCount,
    schemasCount
  };
}

module.exports = {
  ANTIGRAVITY_AGENTS_GLOBAL,
  buildAgentJson,
  buildDefineSubagentArgs,
  ensureAntigravityAgents,
  ensureAntigravityMcpSchemas,
  getAntigravityStatus,
  removeAntigravityAgents,
};
