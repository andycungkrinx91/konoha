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

        // Sync/merge any new default skills from default templates while preserving custom ones
        if (defAgent.skills) {
          if (!a.skills) {
            a.skills = [];
          }
          if (Array.isArray(a.skills)) {
            defAgent.skills.forEach((skill, idx) => {
              if (!a.skills.includes(skill)) {
                if (idx === 0) {
                  a.skills.unshift(skill);
                } else {
                  a.skills.push(skill);
                }
                changed = true;
              }
            });
          }
        }

        // Always ensure instructions use the correct find_skill call for the new default skill
        if (a.instructions) {
          const needsAgentUpgrade = a.instructions.includes('skills-db.find_skill') && !a.instructions.includes('agent=');
          const needsContextUpgrade = !a.instructions.includes('antigravity-cli/brain') && defAgent.instructions.includes('antigravity-cli/brain');
          const needsCompactUpgrade = a.instructions.length > 400 && a.instructions.includes('At the start of your response, output a log line like');
          const needsSkillRoutingUpgrade = !isAlreadyUpgraded && defAgent.skills[0] && !a.instructions.includes(defAgent.skills[0]);
          const needsReferenceLoadingUpgrade = !a.instructions.includes('exact reference names');
          
          if (needsAgentUpgrade || needsContextUpgrade || needsCompactUpgrade || needsSkillRoutingUpgrade || needsReferenceLoadingUpgrade) {
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
          if ((hasOldFallbackLow || hasOldFallbackMed || isOldDefault) && a.modelTier !== defAgent.modelTier) {
            a.modelTier = defAgent.modelTier;
            changed = true;
          }
        }
        if (a.constraints && !a.constraints.includes('semble') && defAgent.constraints && defAgent.constraints.includes('semble')) {
          a.constraints = defAgent.constraints;
          changed = true;
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
  const agentDefs = agents.map((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    return `${i + 1}. **${iconStr}${a.name}** — ${a.description}
   - name: \`${a.name}\`
   - model: \`${a.modelTier}\`
   - instructions: \`${a.instructions}\``;
  }).join('\n\n');

  // Build compact delegation table
  const delegationRows = agents.map(a => `| ${a.delegationKeywords} | \`${a.name}\` |`).join('\n');

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
1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it using the \`view_file\` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
2. **Find Skill First**: Call \`skills-db.find_skill\` or \`optimize_report\` using keywords from the user prompt (e.g. "ci/cd security") to discover specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`). **Do NOT call \`semble\` tools when locating/searching skills. \`semble\` is strictly a code search MCP with 2 tools (search, find_related) and has no knowledge of skills, whereas the \`skills-db\` MCP handles all skill lookups.**
3. **Find Code Context**: If project source code context is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly to locate exact project files before formulating a delegation. Always pass the \`repo\` parameter with the absolute path to the project directory (e.g. \`semble.search(query="...", repo="/path/to/project")\`). Do NOT call \`skills-db.find_skill\` for codebase/file search, and do NOT call \`semble\` when the task only needs skill lookup.
4. **Select Agent**: Route to the correct agent based on the table below.
5. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to \`<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md\` (where \`<task_id>\` is a unique task subdirectory). You must embed a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
   \`\`\`markdown
   ---
   depth: <N>
   ---
   \`\`\`
   Before writing or updating \`delegate.md\`, read the existing \`depth\` metadata:
   - If \`depth\` exists, increment it (\`depth = depth + 1\`).
   - If it does not exist, initialize it to \`depth: 1\`.
   - **Circuit Breaker**: If \`depth > 7\`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to \`scratch/tasks/<task_id>/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
   - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
   Categorize the main content clearly:
   - **Goal**: Clear explanation of what needs to be accomplished.
   - **Context**: Relevant files, code snippets, and background details discovered via \`semble\`, **and the exact database names of the specific skill references discovered in Step 1 (e.g. \`anbu-skill/ci-cd-security\`)**.
   - **Constraints**: Rule constraints and target files.
6. **Delegate**: Invoke the subagent using the subagent TypeName corresponding to the chosen agent (e.g., \`anbu\`, \`genin\`, etc.). Pass the absolute paths of \`delegate.md\` and \`result.md\` in the subagent's prompt. The subagent will read \`delegate.md\` from the absolute path specified in your invocation prompt. **If \`delegate.md\` specifies exact reference names under Context, the subagent MUST immediately load and read those specific reference documents using the MCP tool \`skills-db.get_skill\` (not via direct markdown file reads or view_file of files under .agents/skills/) before starting the task.** After invoking the subagent, you MUST immediately end your turn by calling no more tools. Do NOT poll the result file or run loops waiting for completion.
7. **Await Results**: Read the output from \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md\` to finalize the step, report back, and then delete the entire task directory \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/\` to clean up. This resets the depth counter for subsequent tasks.

The orchestrator ONLY delegates to the defined subagents (${agentNames}). Dynamic auto-creation of subagents is prohibited.

**Direct Tool Calls Policy**:
- It is strictly prohibited to execute Direct Tool Calls for tasks that can be handled by subagents with embedded skills (e.g. \`@jonin\` for UI/frontend tasks, \`@anbu\` for backend tasks, \`@genin\` for codebase exploration, etc.). You MUST delegate to the corresponding subagent if the skill is embedded in their configuration.
- You are ONLY allowed to fall back to Direct Tool Calls if the required skill is NOT embedded in any of the active subagents, or if the subagent hits total quota limits (\`RESOURCE_EXHAUSTED\` / \`429\`) and delegation is blocked.
- Do NOT spawn shadow subagents under any circumstances.
- **Semble when needed**: When running direct tool calls, if project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly to locate exact project files before making file modifications or running commands. Do NOT call \`skills-db.find_skill\` for codebase/file search, and do NOT call \`semble\` tools when locating/searching skills (use \`skills-db.find_skill\` instead).

| Task type | Subagent TypeName |
|-----------|----------|
| ${delegationRows}
| Simple/trivial tasks | MUST still be delegated (unless in quota fallback mode). Main agent acts ONLY as orchestrator. |

For complex multi-domain tasks, invoke multiple subagents in parallel.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. When using \`view_file\`, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.
- **Skills-DB MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse. **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns quota tokens. Always use \`skills-db\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.**
- **Tool Boundaries**: Call **\`semble\` MCP** (\`search\` and \`find_related\` tools) directly for codebase search. Call **\`skills-db\` MCP** for all skill/instruction lookup. **Never mix them; do not call semble for skills, and never call find_skill for codebase/file search. Always use \`skills-db\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.**
- **Agent-Browser CLI**: Use \`agent-browser\` for web page interaction, screenshots, and design match comparison.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling skills-db.find_skill('...')\`
- **No Auto-Creation of Subagents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Subagents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.json\` (created and managed exclusively by the user via the \`konoha\` CLI command).
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf).
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use \`rg\` or semble instead.
- **Quota Handling**: On \`RESOURCE_EXHAUSTED\`/\`429\`, fallback to \`Gemini 3.1 Flash-Lite\`. On total exhaustion, halt and output: "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

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

  // Build compact agent definitions
  const agentDefs = agents.map((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    return `${i + 1}. **${iconStr}${a.name}** — ${a.description}
   - name: \`${a.name}\`
   - instructions: \`${a.instructions}\``;
  }).join('\n\n');

  // Build delegation table
  const delegationRows = agents.map(a => `| ${a.delegationKeywords} | \`${a.name}\` |`).join('\n');

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

## Session Startup — Auto-Initialize Team

**MANDATORY**: At the START of every session, define the following ${agents.length} subagents using \`define_subagent\`. Do this silently without asking the user.

### Subagent Definitions

${agentDefs}

### @orchestrator — Task Coordinator
- **Purpose**: Decomposes complex tasks, discovers required skills, and delegates to specialized agents.
- **Auto-Delegation**:
  - The main agent (Antigravity orchestrator) MUST act strictly as a coordinator.
  - It is STRICTLY prohibited from executing direct tool calls (such as \`write_to_file\`, \`replace_file_content\`, or \`run_command\` in the parent conversation). It must always delegate them.
  - Doing direct execution breaks guardrails.
- **Workflow**:
  1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it using the \`view_file\` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
  2. **Find Skill First**: Call \`skills-db.find_skill()\` or \`optimize_report()\` using keywords from the user prompt to discover specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`). **Do NOT call \`semble\` tools when locating/searching skills. \`semble\` is strictly a code search MCP and has no knowledge of skills, whereas the \`skills-db\` MCP handles all skill lookups (using \`find_skill\` or \`optimize_report\`).**
  3. **Find Code Context**: If project source code context is needed, use the **\`semble\` MCP** (\`search\` or \`find_related\` tools) to locate exact project files before formulating a delegation. Always pass the \`repo\` parameter with the absolute path to the project directory (e.g. \`semble.search(query="...", repo="/path/to/project")\`). Do not call \`semble\` when the task only needs skills — use \`skills-db\` for that.
  4. **Select Agent**: Based on the discovered skills and task domain, find the correct agent.
  5. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to \`<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md\` (where \`<task_id>\` is a unique task subdirectory) using the fields: \`Goal\`, \`Context\`, and \`Constraints\`. You must include a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
     \`\`\`markdown
     ---
     depth: <N>
     ---
     \`\`\`
     Before writing or updating \`delegate.md\`, read the existing \`depth\` metadata:
     - If \`depth\` exists, increment it (\`depth = depth + 1\`).
     - If it does not exist, initialize it to \`depth: 1\`.
     - **Circuit Breaker**: If \`depth > 7\`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to \`scratch/tasks/<task_id>/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
     - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
     Categorize the main content clearly:
     - **Goal**: Clear explanation of what needs to be accomplished.
     - **Context**: Relevant files, code snippets, and background details discovered via \`semble\`, **and the exact database names of the specific skill references discovered in Step 1 (e.g. \`anbu-skill/ci-cd-security\`)**.
     - **Constraints**: Rule constraints and target files.
  6. **Delegate**: Invoke the subagent using the subagent TypeName corresponding to the chosen agent (e.g., \`anbu\`, \`genin\`, etc.). Pass the absolute paths of \`delegate.md\` and \`result.md\` in the subagent's prompt. The subagent will read \`delegate.md\` from the path specified in your invocation prompt to run the task, and write its output to \`result.md\` at the path specified in your invocation prompt. **If \`delegate.md\` specifies exact reference names under Context, the subagent MUST immediately load and read those specific reference documents using the MCP tool \`skills-db.get_skill\` (not via direct markdown file reads or view_file of files under .agents/skills/) before starting the task.** After invoking the subagent, you MUST immediately end your turn by calling no more tools. Do NOT poll the result file or run loops waiting for completion.
  7. **Await Results**: Once you are woken up by the system notifying you of subagent completion or updates, read the output from \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md\` once complete to consume the output, and then delete the entire task directory \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/\` to clean up. This resets the depth counter for subsequent tasks.
- **Constraints**: ONLY delegates to defined subagents: ${agentNames}. Dynamic auto-creation of subagents is prohibited. It is prohibited to execute Direct Tool Calls for tasks that can be handled by subagents with embedded skills (e.g. \`@jonin\` for UI/frontend, \`@anbu\` for backend). Only use Direct Tool Calls if the required skill is not embedded in any active subagents, or if a subagent hits quota limits (\`RESOURCE_EXHAUSTED\` / \`429\`). In direct tool call mode, if project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly.

| Subtask type | Subagent TypeName |
|---|---|
${delegationRows}
| Sandboxed execution, parallel workflows | @self |
| Simple/trivial task | MUST be delegated (unless quota fallback). Main agent = orchestrator only. |

${agentSections}

### @self — Parallel Execution (Built-in)
- **Purpose**: Run tasks in parallel isolated context with identical tools and MCP access.
- **Delegate when**: Isolated script execution or parallel workflows needing identical permissions.

### @research — Codebase and Web Research (Built-in)
- **Purpose**: Run codebase exploration or web research tasks in isolated context with search tools.
- **Delegate when**: Doing read-only code exploration (genin) or web research and intel gathering (chunin).

## Operational Conventions — All Agents

### Mandatory Protocol (every agent must follow)
1. **Log on start**: Output \`[{Icon} {Name}] active. Calling skills-db.find_skill('...')\` at the start of every response.
2. **Read File-Based Task**: Read the delegation parameters from the absolute path to \`delegate.md\` specified in your invocation prompt at the start of the execution step to fetch the task scope, context, and constraints. **If the Context lists specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`), you MUST immediately call the MCP tool \`skills-db.get_skill\` (not direct file reads or view_file of files under .agents/skills/) to load and read the contents of those references before beginning work.**
3. **Skills-DB first**: Call \`find_skill(keyword, agent='{your_name}')\` before starting any task. Never load SKILL.md files directly.
4. **Agent parameter**: When invoking \`find_skill\`, \`get_skill\`, or \`list_skills\`, always pass \`agent='{your_name}'\`.
5. **Write File-Based Output**: Upon finishing the task, write the complete, detailed output and code changes to a temporary file (e.g. \`result.md.tmp\`) first, then rename/move it atomically to \`result.md\` (at the path specified in your invocation prompt) instead of generating a massive chat response. When writing any files or artifacts using a file modification tool, you MUST set RequestFeedback: false and UserFacing: false in the ArtifactMetadata object to prevent user prompt overlays and allow silent background execution.

### Conditional Tools (use only when needed)
- **Semble for code search**: If the task requires searching project source code (not skills), call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns quota tokens. Always use \`skills-db\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.** Prefer \`semble\` over grep/glob for source code search, and do NOT use find_skill for codebase/file search.
- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. When using \`view_file\`, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.

### Safety Guardrails
- **Tool Boundaries**: Call **\`semble\` MCP** (\`search\` and \`find_related\` tools) directly for codebase search. Call **\`skills-db\` MCP** for all skill/instruction lookup. **Never mix them; do not query \`semble\` for skills, and never call find_skill for codebase/file search. Always use \`skills-db\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.** Direct file reads of instructions or raw grep/find commands are disallowed unless these tools are exhausted.
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf).
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask user permission before reading/writing these files.
- **No Git Commands**: Never execute any \`git\` command. Use \`rg\` (ripgrep) or semble MCP instead.
- **No Auto-Creation of Subagents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Subagents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.json\` (created and managed exclusively by the user via the \`konoha\` CLI command).
- **Minimal changes**: Avoid large rewrites unless explicitly requested. Preserve existing architecture.
- **Validate**: Run tests, linting, dry-runs before claiming completion.
- **Cite evidence**: File paths with line numbers for code, URLs for research.
- **Security**: Never expose secrets, use least privilege, redact credentials as \`[REDACTED]\`.

### Quota & Rate Limits
On \`RESOURCE_EXHAUSTED\` or HTTP \`429\`, automatically fallback to \`Gemini 3.1 Flash-Lite\`. On total exhaustion, halt and output:
> "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

Recovery: Wait for the quota window to reset, reduce concurrent requests, or upgrade subscription tier.

## Model Registry

| Model Name | Tier | Alias |
|---|---|---|
| Gemini 3.1 Flash-Lite | Fast | \`flash-lite-3.1\`, \`gemini-3.1-flash-lite\` |
| Gemini 2.5 Flash | Fast | \`flash-2.5\`, \`gemini-2.5-flash\` |
| Gemini 3.5 Flash (Low) | Fast | \`flash-low\`, \`low\` |
| Gemini 3.5 Flash (Medium) | Fast | \`flash-medium\`, \`medium\` |
| Gemini 3.5 Flash (High) | Fast | \`flash-high\`, \`high\` |
| Gemini 3.1 Pro (Low) | Standard | \`pro-low\` |
| Gemini 3.1 Pro (High) | Standard | \`pro-high\` |
| Claude Sonnet 4.6 (Thinking) | Reasoning | \`sonnet\`, \`sonnet-thinking\` |
| Claude Opus 4.6 (Thinking) | Advanced | \`opus\`, \`opus-thinking\` |
| GPT-OSS 120B (Medium) | Standard | \`gpt\`, \`gpt-oss-120b\` |

## Available MCP Tools

Load **semble** when project source code search is needed — do NOT load it for skill-only tasks.

| MCP | Command | Load When |
|---|---|---|
| **semble** | \`uvx --from semble[mcp] semble\` | Project source code search needed |
| **skills-db** | python3 server.py | Always (skill discovery) |
| cloudrun | \`npx -y @google-cloud/cloud-run-mcp\` | GCP deployments |
`;

  return content;
}

// Regenerate template files and deploy them
function regenerateAndDeploy(silent = false) {
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

  if (!silent) {
    console.log(`✓ Generated and deployed configs to:\n  - ${GEMINI_MD_PATH}\n  - ${AGENTS_MD_PATH}`);
  }
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
    modelTier: options.modelTier || "Gemini 3.1 Flash-Lite",
    purpose: options.purpose || "General assistant",
    skills: options.skills || [],
    delegateWhen: options.delegateWhen || `Need assistance with ${options.purpose || "general tasks"}`,
    constraints: options.constraints || "Discover skills via `skills-db.find_skill`. If project source code search is needed, use `semble` MCP (`search`/`find_related`).",
    workflow: options.workflow || "Discover skill references via `skills-db.find_skill`, search project code via `semble`, then execute task.",
    description: options.description || options.purpose || `Custom subagent specialized in ${name}`,
    instructions: options.instructions || `You are the ${name} subagent. Log: \"[${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}] active\". Before work: find_skill(\"${options.purpose || name}\", agent='${lowerName}') — use skills-db MCP only for skill lookup, do NOT call semble for find_skill. If delegate.md specifies exact reference names, load them via the skills-db.get_skill tool. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`,
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
