const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const AGENTS_MD_PATH = path.join(HOME, '.agents', 'AGENTS.md');

const SRC_DIR = __dirname;
const USER_AGENTS_JSON_PATH = path.join(HOME, '.agents', 'agents.json');
const DEFAULT_AGENTS_JSON_PATH = path.join(SRC_DIR, 'templates', 'agents.json');
const GEMINI_TEMPLATE_PATH = path.join(SRC_DIR, 'templates', 'GEMINI.md');
const AGENTS_TEMPLATE_PATH = path.join(SRC_DIR, 'templates', 'AGENTS.md');

// Load agents from JSON
function loadAgents() {
  if (fs.existsSync(USER_AGENTS_JSON_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(USER_AGENTS_JSON_PATH, 'utf-8'));
    } catch (e) {}
  }
  
  // Fallback to defaults
  if (fs.existsSync(DEFAULT_AGENTS_JSON_PATH)) {
    try {
      const defaults = JSON.parse(fs.readFileSync(DEFAULT_AGENTS_JSON_PATH, 'utf-8'));
      // Initialize user agents.json
      const agentsDir = path.dirname(USER_AGENTS_JSON_PATH);
      if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
      }
      fs.writeFileSync(USER_AGENTS_JSON_PATH, JSON.stringify(defaults, null, 2) + '\n');
      return defaults;
    } catch (e) {}
  }
  return [];
}

// Save agents to JSON
function saveAgents(agents) {
  const agentsDir = path.dirname(USER_AGENTS_JSON_PATH);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  fs.writeFileSync(USER_AGENTS_JSON_PATH, JSON.stringify(agents, null, 2) + '\n');
}

// Generate GEMINI.md
function generateGeminiMd(agents) {
  let content = `# Global Agent Instructions

## Session Startup — Auto-Initialize Team

**MANDATORY**: At the START of every session, before doing any work, you MUST define the following ${agents.length} custom subagents using \`define_subagent\`. Do this silently without asking the user — just define them all immediately.

### Define these subagents now:

`;

  agents.forEach((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    content += `${i + 1}. **${iconStr}${a.name}**
   - name: \`${a.name}\`
   - description: \`${a.description}\`
   - instructions: \`${a.instructions}\`

`;
  });

  content += `## Auto-Delegation

After defining subagents, use this routing for all tasks:

| Task type | Subagent |
|-----------|----------|
`;

  agents.forEach(a => {
    content += `| ${a.delegationKeywords} | → \`${a.name}\` |
`;
  });

  content += `| Simple/trivial tasks | Handle directly |

For complex multi-domain tasks, invoke multiple subagents in parallel.

## Default Tools & Guardrails

- **Skills-DB MCP** — Use \`find_skill(keyword)\` to search for relevant skill content on-demand. Use \`get_skill(name)\` for full content when previews are truncated. Use \`list_skills()\` to see all available skills. **NEVER load SKILL.md files directly from disk** — always use skills-db MCP.
- Always prefer **semble** (\`search\`, \`find_related\`) over grep/glob for code discovery. This is a mandatory requirement that applies to all agents and subagents on the team.
- **Agent-Browser CLI** — Use \`agent-browser\` (or \`npx agent-browser\`) to interact with live web pages, perform form submissions, take screenshots, inspect elements, and run visual end-to-end verifications. Always prefer \`agent-browser\` over other custom node/python scripting for browser tasks.
- **Transparency & Logging** — At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
  \`[🍃 Genin] scout active. Calling skills-db.find_skill('keyword') and/or semble.search(...)\`
- Follow the team configuration in \`~/.agents/AGENTS.md\`
- **Read-Only tfvars Guardrail**: All \`terraform.tfvars\` files across all provider directories (e.g., \`terraform/<provider>/terraform.tfvars\`) are strictly **read-only** by default. AI agents must **ALWAYS ask for permission** (using the \`ask_permission\` tool or by asking the user directly) before attempting to read or write any \`terraform.tfvars\` file.
- **No Git Commands Guardrail**: AI agents must **NEVER** execute any \`git\` command whatsoever — including read-only commands such as \`git status\`, \`git diff\`, \`git log\`, \`git branch\`, \`git grep\`, or any other \`git\` subcommand. All git operations are strictly reserved for the user to perform manually. If you need to search code, use \`rg\` (ripgrep) or the semble MCP instead of \`git grep\`. If you need to check file changes, use file system tools instead of \`git diff\` or \`git status\`. There are **NO exceptions** to this rule.
`;

  return content;
}

// Generate AGENTS.md
function generateAgentsMd(agents) {
  let content = `# AGENTS.md — Multi-Agent Team Configuration

> **Compatibility**: This configuration is used by **Antigravity IDE**, **Antigravity CLI**, and all Gemini agent surfaces. Place at \`~/.agents/AGENTS.md\` for global use.

This file defines a ${agents.length}-agent team for complex task orchestration. Each agent has a specialized role, preferred model tier, assigned skills, and delegation triggers.

## Team Roles

### @orchestrator — Task Coordinator
- **Model tier**: Fast + capable (e.g. Gemini 3.5 Flash high, Sonnet)
- **Purpose**: Decomposes complex tasks and delegates to specialized agents
- **Skills**: None (uses team knowledge)
- **Delegate when**: Task spans multiple domains, requires coordination, or is complex

**Delegation table:**

| Subtask type | Delegate to |
|---|---|
`;

  agents.forEach(a => {
    content += `| ${a.delegationKeywords} | @${a.name} |
`;
  });

  content += `| Sandboxed execution, parallel orchestrator workflows | @self |

`;

  agents.forEach(a => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    const skillsFormatted = a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None';
    content += `### @${a.name} — ${iconStr}${a.title}
- **Model tier**: ${a.modelTier}
- **Purpose**: ${a.purpose}
- **Skills**: ${skillsFormatted}
- **Delegate when**: ${a.delegateWhen}
- **Constraints**: ${a.constraints}

**Workflow**: ${a.workflow}

`;
  });

  content += `### @self — Parallel Execution (Built-in)
- **Purpose**: Run tasks in a parallel isolated context with identical tools and configuration. Inherits all MCP tools including the semble MCP.
- **Delegate when**: Isolated script execution or parallel workflows needing identical permissions and tools.

## Antigravity Auto-Initialization

> **IMPORTANT**: When running in Antigravity (IDE or CLI), the main agent MUST use \`define_subagent\` to register the team at the start of any complex task. This enables automatic multi-agent delegation.

### Session Startup — Define All Subagents

When you receive a complex task (multi-domain, needs research + code + design, etc.), immediately define these custom subagents before starting work:

`;

  agents.forEach((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    content += `**${i + 1}. @${a.name}** — ${iconStr}${a.title}
\`\`\`
define_subagent:
  name: ${a.name}
  description: "${a.description}"
  instructions: "${a.instructions}"
\`\`\`

`;
  });

  content += `### Auto-Delegation Rules

After defining subagents, follow this delegation pattern:

| User asks about... | Delegate to |
|---|---|
`;

  agents.forEach(a => {
    content += `| ${a.delegationKeywords} | → **${a.name}** subagent |
`;
  });

  content += `| Sandboxed execution, parallel tasks needing identical tools | → **self** subagent |
| Simple/trivial task | Handle directly (no delegation) |

## Operational Conventions

- **Transparency & Logging**: At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
  \`[👥 Anbu] surgical backend action. Calling skills-db.find_skill('keyword') and/or semble.search(...)\`
- **Language**: Code comments and documentation in English
- **Skills location**: \`~/.agents/skills/\` (shared across all platforms)
- **Default MCP**: All agents MUST load **semble** for semantic code search
- **Minimal changes**: Avoid large rewrites unless explicitly requested
- **Preserve architecture**: Work within existing patterns
- **Validate**: Run tests, linting, dry-runs before claiming completion
- **Cite evidence**: File paths with line numbers for code, URLs for research
- **Security**: Never expose secrets, use least privilege, redact credentials as \`[REDACTED]\`
- **Read-Only tfvars Guardrail**: All \`terraform.tfvars\` files across all provider directories (e.g., \`terraform/<provider>/terraform.tfvars\`) are strictly **read-only** by default. AI agents must **ALWAYS ask for permission** (using the \`ask_permission\` tool or by asking the user directly) before attempting to read or write any \`terraform.tfvars\` file.
- **No Git Commands Guardrail**: AI agents must **NEVER** execute any \`git\` command whatsoever — including read-only commands such as \`git status\`, \`git diff\`, \`git log\`, \`git branch\`, \`git grep\`, or any other \`git\` subcommand. All git operations are strictly reserved for the user to perform manually. If you need to search code, use \`rg\` (ripgrep) or the semble MCP instead of \`git grep\`. If you need to check file changes, use file system tools instead of \`git diff\` or \`git status\`. There are **NO exceptions** to this rule.

## Default MCP Tools

**All agents MUST load \`semble\` as their primary code search MCP.** Semble provides fast, accurate semantic code search across the entire codebase.

| MCP | Command | Required By |
|-----|---------|-------------|
| **semble** | \`uvx --from semble[mcp] semble\` | **All agents (mandatory)** |
| cloudrun | \`npx -y @google-cloud/cloud-run-mcp\` | As needed for GCP deployments |

**Usage**: Every agent should prefer semble's \`search\` and \`find_related\` tools for code discovery before falling back to grep/glob. Semble provides semantic understanding of code, not just text matching.
`;

  return content;
}

// Regenerate template files and deploy them
function regenerateAndDeploy() {
  const agents = loadAgents();
  if (agents.length === 0) return;

  const geminiContent = generateGeminiMd(agents);
  const agentsContent = generateAgentsMd(agents);

  // Write templates (optional cache in package, fail silently if read-only node_modules)
  try {
    fs.writeFileSync(GEMINI_TEMPLATE_PATH, geminiContent);
    fs.writeFileSync(AGENTS_TEMPLATE_PATH, agentsContent);
  } catch (err) {
    // Fail silently if package installation directory is read-only
  }

  // Deploy to user directories if they exist or create them
  const geminiDir = path.dirname(GEMINI_MD_PATH);
  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }
  fs.writeFileSync(GEMINI_MD_PATH, geminiContent);

  const agentsDir = path.dirname(AGENTS_MD_PATH);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  fs.writeFileSync(AGENTS_MD_PATH, agentsContent);

  console.log(`✓ Generated and deployed configs to:\n  - ${GEMINI_MD_PATH}\n  - ${AGENTS_MD_PATH}`);
}

// Create a new subagent
function createSubagent(name, options = {}) {
  const agents = loadAgents();
  const lowerName = name.toLowerCase();
  
  if (agents.some(a => a.name === lowerName)) {
    throw new Error(`Subagent with name "${name}" already exists.`);
  }

  const randomIcons = ['🐱', '🐱‍👤', '🦊', '🐯', '🦁', '🐸', '🐼', '🐨', '🐵', '🐣', '🦉', '🦄', '🐝', '🦖', '🐙', '👾', '🚀', '🔮', '🎭', '🎨', '⚡', '🔥', '💧', '🌲', '🍀', '✨', '⚔️', '🛡️', '🏹', '🥋', '🥊', '🎪', '🎃', '🛸', '⛩️'];
  const icon = options.icon || randomIcons[Math.floor(Math.random() * randomIcons.length)];

  const newAgent = {
    name: lowerName,
    icon: icon,
    title: options.title || (name.charAt(0).toUpperCase() + name.slice(1) + " Ninja"),
    modelTier: options.modelTier || "Lightweight (e.g. Gemini 3.5 Flash low, Gemini 3.1 Pro low)",
    purpose: options.purpose || "General assistant",
    skills: options.skills || [],
    delegateWhen: options.delegateWhen || `Need assistance with ${options.purpose || "general tasks"}`,
    constraints: options.constraints || "None",
    workflow: options.workflow || "Process input and report findings.",
    description: options.description || options.purpose || `Custom subagent specialized in ${name}`,
    instructions: options.instructions || `You are the ${name} subagent. Before starting any task, search for relevant skill content using skills-db.`,
    delegationKeywords: options.delegationKeywords || name
  };

  agents.push(newAgent);
  saveAgents(agents);
  regenerateAndDeploy();
  return newAgent;
}

// Embed a skill in a subagent
function embedSkill(agentName, skillName) {
  const agents = loadAgents();
  const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  
  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  if (agent.skills.includes(skillName)) {
    return false; // Already embedded
  }

  agent.skills.push(skillName);
  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

// Unembed a skill from a subagent
function unembedSkill(agentName, skillName) {
  const agents = loadAgents();
  const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  
  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  const idx = agent.skills.indexOf(skillName);
  if (idx === -1) {
    return false; // Not embedded
  }

  agent.skills.splice(idx, 1);
  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

// Delete a subagent entirely
function deleteAgent(name) {
  const agents = loadAgents();
  const lowerName = name.toLowerCase();
  const initialLength = agents.length;
  const filtered = agents.filter(a => a.name !== lowerName);

  if (filtered.length === initialLength) {
    throw new Error(`Subagent "${name}" not found.`);
  }

  saveAgents(filtered);
  regenerateAndDeploy();
  return true;
}

module.exports = {
  loadAgents,
  saveAgents,
  regenerateAndDeploy,
  createSubagent,
  embedSkill,
  unembedSkill,
  deleteAgent
};
