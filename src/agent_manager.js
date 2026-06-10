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

let isRegenerating = false;

// Load agents from JSON
function loadAgents() {
  let agents = [];
  let loadedFromUser = false;
  if (fs.existsSync(USER_AGENTS_JSON_PATH)) {
    try {
      agents = JSON.parse(fs.readFileSync(USER_AGENTS_JSON_PATH, 'utf-8'));
      loadedFromUser = true;
    } catch (e) {}
  }
  
  // Load defaults
  let defaults = [];
  if (fs.existsSync(DEFAULT_AGENTS_JSON_PATH)) {
    try {
      defaults = JSON.parse(fs.readFileSync(DEFAULT_AGENTS_JSON_PATH, 'utf-8'));
    } catch (e) {}
  }

  if (loadedFromUser) {
    // Upgrade existing agents if their instructions do not specify passing the agent parameter
    let upgraded = false;

    // Check if the user's agents.json has already been upgraded to the new concept (v1.1.1+)
    const isAlreadyUpgraded = agents.some(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      return defAgent && defAgent.skills && defAgent.skills[0] && a.skills && a.skills.includes(defAgent.skills[0]);
    });

    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      let changed = false;
      if (defAgent) {
        // v1.1.1: Upgrade to new routing concept where each agent has their own default skill
        if (a.skills && !isAlreadyUpgraded) {
          const oldDefaults = ['deep-code-explorer', 'devsecops-engineer', 'websearch-deep', 'modern-full-stack', 'documentation'];
          let changedSkills = false;
          
          // Ensure agent has their own default skill (e.g., anbu-skill)
          const defaultSkill = defAgent.skills[0]; // e.g. 'anbu-skill'
          if (defaultSkill && !a.skills.includes(defaultSkill)) {
            a.skills.unshift(defaultSkill);
            changedSkills = true;

            // Remove old default skills to align with new clean concept
            // (Only do this during the initial upgrade when the default skill was missing)
            oldDefaults.forEach(old => {
              const idx = a.skills.indexOf(old);
              if (idx !== -1) {
                a.skills.splice(idx, 1);
              }
            });
          }
          
          if (changedSkills) {
            changed = true;
          }
        }

        // Always ensure instructions use the correct find_skill call for the new default skill
        if (a.instructions) {
          const needsAgentUpgrade = a.instructions.includes('skills-db.find_skill') && !a.instructions.includes('pass agent=');
          const needsContextUpgrade = !a.instructions.includes('antigravity-cli/brain');
          const needsCompactUpgrade = a.instructions.length > 400 && a.instructions.includes('At the start of your response, output a log line like');
          const needsSkillRoutingUpgrade = !isAlreadyUpgraded && defAgent.skills[0] && !a.instructions.includes(defAgent.skills[0]);
          
          if (needsAgentUpgrade || needsContextUpgrade || needsCompactUpgrade || needsSkillRoutingUpgrade) {
            a.instructions = defAgent.instructions;
            changed = true;
          }
        }

        // v1.1.0: Upgrade verbose descriptions to compact format
        if (a.description && a.description.length > 200) {
          a.description = defAgent.description;
          changed = true;
        }
        if (a.modelTier) {
          const oldDefaults = [
            'Gemini 3.5 Flash (Low)',
            'Gemini 3.5 Flash (Medium)',
            'Gemini 3.5 Flash (High)',
            'Gemini 3.1 Pro (High)',
            'Claude Sonnet 4.6 (Thinking)',
            'Claude Sonnet 4.6 (Thinking) | fallback when fail Gemini 3.5 Flash (High)',
            'Claude Sonnet 4.6 (Thinking) | Fallback when fail Gemini 3.5 Flash (High)'
          ];
          const hasOldFallbackLow = a.modelTier.includes('Fallback when fail Gemini 3.5 Flash (Low)');
          const hasOldFallbackMed = a.modelTier.includes('Fallback when fail Gemini 3.5 Flash (Medium)');
          const isOldDefault = oldDefaults.includes(a.modelTier.trim());
          if (hasOldFallbackLow || hasOldFallbackMed || isOldDefault) {
            a.modelTier = defAgent.modelTier;
            changed = true;
          }
        }
      }

      // Sync instructions with skills for default and custom agents
      if (a.instructions && a.skills && a.skills.length > 0) {
        const findSkillCalls = a.skills.map(s => `find_skill("${s}", agent='${a.name}')`).join('. ') + '.';
        const regex = /Before work:\s*(?:find_skill\((?:'[^']+'|"[^"]+"),\s*agent=(?:'[^']+'|"[^"]+")\)(?:\.\s*)?)+/;
        if (regex.test(a.instructions)) {
          const newInstructions = a.instructions.replace(regex, `Before work: ${findSkillCalls} `);
          if (newInstructions !== a.instructions) {
            a.instructions = newInstructions;
            changed = true;
          }
        }
      }

      if (changed) {
        upgraded = true;
      }
      return a;
    });
    if (upgraded) {
      saveAgents(agents);
      if (!isRegenerating) {
        isRegenerating = true;
        try {
          regenerateAndDeploy();
        } catch (e) {
        } finally {
          isRegenerating = false;
        }
      }
    }
    return agents;
  } else {
    // Initialize user agents.json
    if (defaults.length > 0) {
      const agentsDir = path.dirname(USER_AGENTS_JSON_PATH);
      if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
      }
      fs.writeFileSync(USER_AGENTS_JSON_PATH, JSON.stringify(defaults, null, 2) + '\n');
      return defaults;
    }
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

// ─── Compact GEMINI.md Generator (v1.1.0 — Token-Optimized) ─────────────────
// Reduced from ~13 KB to ~4 KB by:
// - Compact agent definitions (no verbose instructions inline)
// - Deduplicated guardrails (single block, refs AGENTS.md for full details)
// - Terse delegation table
function generateGeminiMd(agents) {
  // Build compact agent definitions
  const agentDefs = agents.map((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    return `${i + 1}. **${iconStr}${a.name}** — ${a.description}
   - name: \`${a.name}\`
   - instructions: \`${a.instructions}\``;
  }).join('\n\n');

  // Build compact delegation table
  const delegationRows = agents.map(a => `| ${a.delegationKeywords} | → \`${a.name}\` |`).join('\n');

  // Build official agent name list
  const agentNames = agents.map(a => `\`${a.name}\``).join(', ');

  const content = `# Global Agent Instructions

## Session Startup — Auto-Initialize Team

**MANDATORY**: At the START of every session, define the following ${agents.length} subagents using \`define_subagent\`. Do this silently without asking the user.

### Subagent Definitions

${agentDefs}

## Auto-Delegation

> [!IMPORTANT]
> **Orchestrator Role & Auto-Delegation**:
> - The main agent (Antigravity orchestrator) MUST act strictly as a coordinator.
> - It is STRICTLY prohibited from executing direct tool calls (such as \`write_to_file\`, \`replace_file_content\`, or \`run_command\` in the parent conversation). It must always delegate them.
> - Doing direct execution breaks guardrails.

The orchestrator MUST follow this workflow:
1. **Find Skill First**: Call \`skills-db.find_skill\` or \`optimize_report\` to discover necessary skills.
2. **Find Code Context**: Always call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) to locate exact project files and relevant codebase context before formulating a delegation.
3. **Select Agent**: Route to the correct agent based on the table below.
4. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to \`<appDataDir>/brain/<conversation-id>/scratch/delegate.md\`. You must embed a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
   \`\`\`markdown
   ---
   depth: <N>
   ---
   \`\`\`
   Before writing or updating \`delegate.md\`, read the existing \`depth\` metadata:
   - If \`depth\` exists, increment it (\`depth = depth + 1\`).
   - If it does not exist, initialize it to \`depth: 1\`.
   - **Circuit Breaker**: If \`depth > 5\`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to \`scratch/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
   - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
   Categorize the main content clearly:
   - **Goal**: Clear explanation of what needs to be accomplished.
   - **Context**: Relevant files, code snippets, and background details discovered via \`semble\`.
   - **Constraints**: Rule constraints and target files.
5. **Delegate**: Invoke the subagent. The subagent will load their default skill (e.g., \`anbu-skill\`). If the subagent needs additional skills that aren't embedded, they must use Direct Tool Calls (\`find_skill\`) to get them. The subagent will read \`delegate.md\` to execute the task.
6. **Await Results**: The subagent will write its output directly to \`<appDataDir>/brain/<conversation-id>/scratch/result.md\`. Read this file to finalize the step and report back.

The orchestrator ONLY delegates to: ${agentNames}. Creating new/custom subagents is prohibited.

If a subagent hits quota limits (\`RESOURCE_EXHAUSTED\` / \`429\`), fall back to **Direct Tool Calls** — do NOT spawn shadow subagents.

| Task type | Subagent |
|-----------|----------|
${delegationRows}
| Simple/trivial tasks | MUST still be delegated (unless in quota fallback mode). Main agent acts ONLY as orchestrator. |

For complex multi-domain tasks, invoke multiple subagents in parallel.

## Tools & Guardrails

- **Skills-DB MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse. **NEVER load SKILL.md files directly.**
- **Semble MCP**: Prefer \`search\`/\`find_related\` over grep/glob for code discovery. Mandatory for all agents.
- **Agent-Browser CLI**: Use \`agent-browser\` for web page interaction, screenshots, and visual QA.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling skills-db.find_skill('...')\`
- **No Auto-Creation of Subagents**: AI is NEVER allowed to define/create/delete subagents. Reserved for user only.
- **Proactive Execution**: Never instruct user to do tasks the agent can perform itself.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use \`rg\` or semble instead.
- **Quota Handling**: On \`RESOURCE_EXHAUSTED\`/\`429\`, fallback to \`Gemini 3.5 Flash (High)\`. On total exhaustion, halt and output: "Your Antigravity account has reach the limit quota. Please change the account and resume the session or increase your subcribe Google AI."

Full team configuration, model registry, and operational conventions: \`~/.agents/AGENTS.md\`
`;

  return content;
}

// ─── Compact AGENTS.md Generator (v1.1.0 — Token-Optimized) ─────────────────
// Reduced from ~21 KB to ~8 KB by:
// - Removed duplicate define_subagent code blocks
// - Merged duplicate delegation tables
// - Consolidated operational conventions
function generateAgentsMd(agents) {
  // Build official agent name list
  const agentNames = agents.map(a => `\`${a.name}\``).join(', ');

  // Build delegation table
  const delegationRows = agents.map(a => `| ${a.delegationKeywords} | @${a.name} |`).join('\n');

  // Build agent role sections
  const agentSections = agents.map(a => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    const skillsFormatted = a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None';
    return `### @${a.name} — ${iconStr}${a.title}
- **Model tier**: ${a.modelTier}
- **Purpose**: ${a.purpose}
- **Skills**: ${skillsFormatted}
- **Delegate when**: ${a.delegateWhen}
- **Constraints**: ${a.constraints}
- **Workflow**: ${a.workflow}`;
  }).join('\n\n');

  const content = `# AGENTS.md — Multi-Agent Team Configuration

> **Compatibility**: Antigravity IDE, CLI, and all Gemini agent surfaces. Place at \`~/.agents/AGENTS.md\`.

## Team Roles & Delegation

### @orchestrator — Task Coordinator
- **Purpose**: Decomposes complex tasks, discovers required skills, and delegates to specialized agents.
- **Auto-Delegation**:
  - The main agent (Antigravity orchestrator) MUST act strictly as a coordinator.
  - It is STRICTLY prohibited from executing direct tool calls (such as \`write_to_file\`, \`replace_file_content\`, or \`run_command\` in the parent conversation). It must always delegate them.
  - Doing direct execution breaks guardrails.
- **Workflow**:
  1. **Find Skill First**: Call \`skills-db.find_skill()\` or \`optimize_report()\` to discover the right skills for the task.
  2. **Find Code Context**: Always call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) to locate exact project files and relevant codebase context before formulating a delegation.
  3. **Select Agent**: Based on the discovered skills and task domain, find the correct agent.
  4. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to \`<appDataDir>/brain/<conversation-id>/scratch/delegate.md\` using the fields: \`Goal\`, \`Context\`, and \`Constraints\`. You must include a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
     \`\`\`markdown
     ---
     depth: <N>
     ---
     \`\`\`
     Before writing or updating \`delegate.md\`, read the existing \`depth\` metadata:
     - If \`depth\` exists, increment it (\`depth = depth + 1\`).
     - If it does not exist, initialize it to \`depth: 1\`.
     - **Circuit Breaker**: If \`depth > 5\`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to \`scratch/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
     - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
  5. **Delegate & Await**: Launch the subagent. The subagent will read \`delegate.md\` to run the task, and write its output to \`scratch/result.md\` in the same directory. Read \`scratch/result.md\` once complete to consume the output.
- **Constraints**: ONLY delegates to: ${agentNames}. No custom subagents. On quota limits, fall back to Direct Tool Calls.

| Subtask type | Delegate to |
|---|---|
${delegationRows}
| Sandboxed execution, parallel workflows | @self |
| Simple/trivial task | MUST be delegated (unless quota fallback). Main agent = orchestrator only. |

${agentSections}

### @self — Parallel Execution (Built-in)
- **Purpose**: Run tasks in parallel isolated context with identical tools and MCP access.
- **Delegate when**: Isolated script execution or parallel workflows needing identical permissions.

## Operational Conventions — All Agents

### Mandatory Protocol (every agent must follow)
1. **Log on start**: Output \`[{Icon} {Name}] active. Calling skills-db.find_skill('...')\` at the start of every response.
2. **Read File-Based Task**: Read the delegation parameters from \`<appDataDir>/brain/<conversation-id>/scratch/delegate.md\` at the start of the execution step to fetch the task scope, context, and constraints.
3. **Skills-DB first**: Call \`find_skill(keyword, agent='{your_name}')\` before starting any task. Never load SKILL.md files directly.
4. **Semble for code search**: Always use semble MCP (\`search\`, \`find_related\`) before grep/glob.
5. **Agent parameter**: When invoking \`find_skill\`, \`get_skill\`, or \`list_skills\`, always pass \`agent='{your_name}'\`.
6. **Write File-Based Output**: Upon finishing the task, write the complete, detailed output and code changes to \`<appDataDir>/brain/<conversation-id>/scratch/result.md\` instead of generating a massive chat response. When writing any files or artifacts using a file modification tool, you MUST set RequestFeedback: false and UserFacing: false in the ArtifactMetadata object to prevent user prompt overlays and allow silent background execution.

### Safety Guardrails
- **Proactive Execution**: Never instruct user to manually perform tasks you can execute yourself.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask user permission before reading/writing these files.
- **No Git Commands**: Never execute any \`git\` command. Use \`rg\` (ripgrep) or semble MCP instead.
- **No Auto-Creation of Subagents**: AI is never allowed to define/create/delete subagents. User-only feature.
- **Minimal changes**: Avoid large rewrites unless explicitly requested. Preserve existing architecture.
- **Validate**: Run tests, linting, dry-runs before claiming completion.
- **Cite evidence**: File paths with line numbers for code, URLs for research.
- **Security**: Never expose secrets, use least privilege, redact credentials as \`[REDACTED]\`.

### Quota & Rate Limits
On \`RESOURCE_EXHAUSTED\` or HTTP \`429\`, automatically fallback to \`Gemini 3.5 Flash (High)\`. On total exhaustion, halt and output:
> "Your Antigravity account has reach the limit quota. Please change the account and resume the session or increase your subcribe Google AI."

Recovery: \`/logout\` → relogin with another account → \`/resume\` → prompt \`continue\`.

## Model Registry

| Model Name | Tier | Alias |
|---|---|---|
| Gemini 2.5 Flash | Fast | \`flash-2.5\`, \`gemini-2.5-flash\` |
| Gemini 3.5 Flash (Low) | Fast | \`flash-low\`, \`low\` |
| Gemini 3.5 Flash (Medium) | Fast | \`flash-medium\`, \`medium\` |
| Gemini 3.5 Flash (High) | Fast | \`flash-high\`, \`high\` |
| Gemini 3.1 Pro (Low) | Standard | \`pro-low\` |
| Gemini 3.1 Pro (High) | Standard | \`pro-high\` |
| Claude Sonnet 4.6 (Thinking) | Reasoning | \`sonnet\`, \`sonnet-thinking\` |
| Claude Opus 4.6 (Thinking) | Advanced | \`opus\`, \`opus-thinking\` |
| GPT-OSS 120B (Medium) | Standard | \`gpt\`, \`gpt-oss-120b\` |

## Default MCP Tools

All agents MUST load **semble** as primary code search MCP.

| MCP | Command | Required By |
|---|---|---|
| **semble** | \`uvx --from semble[mcp] semble\` | All agents (mandatory) |
| cloudrun | \`npx -y @google-cloud/cloud-run-mcp\` | GCP deployments |
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
  const agentNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!agentNameRegex.test(name)) {
    throw new Error(`Invalid subagent name: "${name}". Only alphanumeric characters, dashes, and underscores are allowed.`);
  }

  const agents = loadAgents();
  const lowerName = name.toLowerCase();
  
  const allowedNames = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  if (!allowedNames.includes(lowerName) && !options.manual) {
    throw new Error(`Subagent creation locked: "${name}" is not an official subagent. Auto-creation of custom subagents is strictly prohibited by system guardrails. To override this manually, you must pass the --manual flag.`);
  }
  
  if (agents.some(a => a.name === lowerName)) {
    throw new Error(`Subagent with name "${name}" already exists.`);
  }

  const randomIcons = [
    '🐱', '🦊', '🐯', '🦁', '🐸', '🐼', '🐨', '🐵', '🐣', '🦉',
    '🦄', '🐝', '🦖', '🐙', '👾', '🚀', '🔮', '🎭', '🎨', '⚡',
    '🔥', '💧', '🌲', '🍀', '✨', '⚔️', '🛡️', '🏹', '🥋', '🥊',
    '🎪', '🎃', '🛸', '⛩️', '🐉', '👹', '👺', '💨', '🌪️', '💮'
  ];
  const icon = options.icon || randomIcons[Math.floor(Math.random() * randomIcons.length)];

  const newAgent = {
    name: lowerName,
    icon: icon,
    title: options.title || (name.charAt(0).toUpperCase() + name.slice(1) + " Ninja"),
    modelTier: options.modelTier || "Gemini 3.5 Flash (High)",
    purpose: options.purpose || "General assistant",
    skills: options.skills || [],
    delegateWhen: options.delegateWhen || `Need assistance with ${options.purpose || "general tasks"}`,
    constraints: options.constraints || "Always use `semble` semantic search before manual search.",
    workflow: options.workflow || "Process input, use `semble` to discover context, and report findings.",
    description: options.description || options.purpose || `Custom subagent specialized in ${name}`,
    instructions: options.instructions || `You are the ${name} subagent. Log: \"[${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}] active\". Before work: find_skill(\"${options.purpose || name}\", agent='${lowerName}'). Follow full protocol in ~/.agents/AGENTS.md.`,
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

// Update subagent model tier
function updateAgentModel(agentName, modelName) {
  const agents = loadAgents();
  const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  
  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  if (agent.modelTier === modelName) {
    return false; // Already set
  }

  agent.modelTier = modelName;
  saveAgents(agents);
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
  deleteAgent,
  updateAgentModel
};
