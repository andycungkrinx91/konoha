const fs = require('fs');
const path = require('path');
const os = require('os');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const {
  SEMBLE_SEARCH_CONSTRAINT,
  buildSembleSearchPolicy,
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
} = require('./search_policy');

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.konoha');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const AGENTS_MD_PATH = path.join(HOME, '.agents', 'AGENTS.md');

const SRC_DIR = __dirname;
const USER_AGENTS_JSON_PATH = path.join(HOME, '.agents', 'agents.json');
const DEFAULT_AGENTS_JSON_PATH = path.join(SRC_DIR, 'templates', 'agents.json');
const GEMINI_TEMPLATE_PATH = path.join(SRC_DIR, 'templates', 'GEMINI.md');
const AGENTS_TEMPLATE_PATH = path.join(SRC_DIR, 'templates', 'AGENTS.md');

// Persistent fingerprint path — stores agents.json mtime+size after each successful deploy,
// so subsequent CLI invocations can detect no-op and skip the ~640ms regenerateAndDeploy work.
const FINGERPRINT_PATH = path.join(HOME, '.konoha', '.deploy-fingerprint');

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
    const UPGRADED_MARKER_PATH = path.join(HOME, '.agents', '.upgraded_v1.1.1');
    let isAlreadyUpgraded = fs.existsSync(UPGRADED_MARKER_PATH);
    if (!isAlreadyUpgraded) {
      isAlreadyUpgraded = agents.some(a => {
        const defAgent = defaults.find(d => d.name === a.name);
        return defAgent && defAgent.skills && defAgent.skills[0] && a.skills && a.skills.includes(defAgent.skills[0]);
      });
      if (isAlreadyUpgraded) {
        try {
          fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8');
        } catch (e) {}
      }
    }

    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      let changed = false;
      if (defAgent) {
        // v1.1.1: Upgrade to new routing concept where each agent has their own default skill
        if (a.skills && !isAlreadyUpgraded) {
          const legacyBundledSkills = ['deep-code-explorer', 'devsecops-engineer', 'websearch-deep', 'documentation'];
          let changedSkills = false;
          
          // Ensure agent has their own default skill (e.g., anbu-skill)
          const defaultSkill = defAgent.skills[0]; // e.g. 'anbu-skill'
          if (defaultSkill && !a.skills.includes(defaultSkill)) {
            a.skills.unshift(defaultSkill);
            changedSkills = true;

            // Remove legacy bundled skills when upgrading to per-agent base skills
            legacyBundledSkills.forEach(old => {
              const idx = a.skills.indexOf(old);
              if (idx !== -1) {
                a.skills.splice(idx, 1);
              }
            });
            // Drop removed template storefront skills (legacy bundled UI templates)
            a.skills = a.skills.filter(s => !/^modern-/.test(s) || s === defaultSkill);
          }
          
          if (changedSkills) {
            changed = true;
          }
        }

        // Sync/merge any new default skills from default templates while preserving custom ones
        if (defAgent.skills && !isAlreadyUpgraded) {
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
        // v1.1.6: Enforce semble as default search/grep (no built-in grep/glob)
        if (a.constraints && defAgent.constraints && defAgent.constraints.includes('NEVER use grep') && !a.constraints.includes('NEVER use grep')) {
          a.constraints = defAgent.constraints;
          changed = true;
        }

        // v1.1.6: Sync Cursor, Claude, and OpenCode model slugs for IDE/CLI subagents if they are not defined
        if (a.cursorModel === undefined && defAgent.cursorModel) {
          a.cursorModel = defAgent.cursorModel;
          changed = true;
        }
        if (a.cursorFallbackModel === undefined && defAgent.cursorFallbackModel) {
          a.cursorFallbackModel = defAgent.cursorFallbackModel;
          changed = true;
        }
        if (a.claudeModel === undefined && defAgent.claudeModel) {
          a.claudeModel = defAgent.claudeModel;
          changed = true;
        }
        if (a.opencodeModel === undefined) {
          a.opencodeModel = defAgent.opencodeModel || 'inherit';
          changed = true;
        }
      }

      // Sync instructions with skills moved to deployment generators
      if (a.instructions && a.instructions.includes('Before work: find_skill')) {
        a.instructions = a.instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
        changed = true;
      }

      if (changed) {
        upgraded = true;
      }
      return a;
    });
    if (upgraded) {
      try {
        fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8');
      } catch (e) {}
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

function buildAgentReferenceList(agents) {
  return agents.map((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    return `${i + 1}. **${iconStr}${a.name}** — ${a.description}`;
  }).join('\n');
}

function buildDefineSubagentGuide(agents) {
  const sample = antigravityManager.buildDefineSubagentArgs(agents[0]);
  const names = agents.map((a) => a.name).join(', ');
  return `### define_subagent — CRITICAL quoting rules

At session start, call \`define_subagent\` once per ninja (**${names}**). Use **bare JSON strings** — extra quotes break \`invoke_subagent\`. Do NOT call \`manage_subagents\` or poll for status. Subagents execute asynchronously, and \`manage_subagents\` list will show 0 active subagents when no task is running, which is normal.

**CRITICAL TURN BOUNDARY RULE:** After calling \`define_subagent\` for the subagents, you MUST immediately end your turn (by calling no more tools) before attempting to invoke any subagent. This allows the Antigravity platform to register the new subagents into the session. You can ONLY call \`invoke_subagent\` in a subsequent turn after the definitions have been processed. Never define and invoke subagents in the same response turn.

Example (\`${agents[0].name}\`):
\`\`\`json
${JSON.stringify(sample, null, 2)}
\`\`\`

- \`name\` must be bare: \`jonin\` — NEVER \`"jonin"\` or \`\\"jonin\\"\`
- \`enable_mcp_tools\` / \`enable_write_tools\` / \`enable_subagent_tools\` must be JSON booleans, not strings
- Copy \`system_prompt\` from ~/.agents/agents.json for each agent

### invoke_subagent — CRITICAL format

\`Subagents\` must be a **JSON array object**, NOT a stringified array:

\`\`\`json
{
  "Subagents": [
    {
      "TypeName": "jonin",
      "Prompt": "Read <ABS>/delegate.md. Write report to <ABS>/result.md.",
      "Workspace": "inherit"
    }
  ]
}
\`\`\`

**FORBIDDEN:** \`TypeName: "self"\` or \`invoke_subagent\` with self to impersonate jonin. If jonin fails, re-run \`define_subagent\` with bare names — never fall back to self.`;
}

function buildImageDesignDelegateGuide() {
  return `### Image / mockup builds — delegate.md rules (CRITICAL)

When the user prompt mentions \`source-image-design\`, design images, or mockups:

1. Orchestrator calls \`skills-db.build_from_source\`(name, source_dir, framework) before writing \`delegate.md\`.
2. **Constraints section** MUST include:
   - \`build_from_source\` mode: 100% exact match with source mockup layout/colors/spacing — zero hallucination, zero invention
   - **NO DARK MODE**: All layouts must be Light Mode only unless the source design explicitly uses dark backgrounds
   - **Premium 3D animations**: Enhance source design with 3D perspective tilt, entrance animations, parallax depth — without altering source layout
   - **Footer watermark**: \`Build by Konoha\` in small, elegant, muted typography (always required)
   - **Custom error pages**: Unique, premium 4xx/5xx error pages with cute 3D illustrations (always required)
   - **.env safety**: Never hardcode secrets; provide \`.env.example\`
   - **Auto-open browser**: Start dev server with \`--open\` flag
   - **FORBIDDEN**: 10-theme switcher, generic 3D carousels, SweetAlert2 premium dialogs, or jonin default premium template — unless shown in mockups
3. **NEVER** paste "Mandatory UI/UX Standards" / premium template bullets from \`nextjs-ui-expert\` into \`delegate.md\` for image builds — that causes ugly generic sites instead of mockup fidelity.
4. **Context** must list \`absolute_image_paths\` from \`build_from_source\` and require jonin to \`view_file\` every mockup before coding.

### Text-based builds — delegate.md rules (CRITICAL)

When the user prompt requests building or scaffolding a website or user interface from text description (and no design mockup images are provided):

1. The orchestrator MUST call the MCP tool \`skills-db.build_from_text\`(name, description, framework) first before writing \`delegate.md\`.
2. Do NOT call \`ask_question\` or prompt the user for design/layout choices or styling frameworks; use the premium template specifications and layout rules returned by \`build_from_text\` directly.
3. In \`delegate.md\`, pass the directives and specifications returned by \`build_from_text\` directly under constraints and delegate the build to the \`jonin\` agent.
4. **Mandatory directives** for text-based builds (already included in \`build_from_text\` output):
   - NO dark mode — Light Mode only with premium gradient color theme
   - Premium 3D effect animations on ALL page components
   - Footer watermark: \`Build by Konoha\`
   - Custom premium error pages (4xx/5xx)
   - Auto-open browser with \`--open\` flag
   - .env safety and CVE-free dependencies

### Existing project rules — delegate.md rules (CRITICAL)

When the user prompt involves modifying or working within an existing project:

1. **NEVER touch existing logic**: Do not modify existing components, routes, styles, or code the user did not explicitly ask to change. Preserve all existing architecture.
2. **Do only what is asked**: Execute only the user's specific request. If you have improvement ideas or suggestions, ASK the user first before implementing.
3. **No silent design changes**: NEVER hallucinate, fabricate, or silently update/change design elements, colors, layouts, styles, or functionality without the user's explicit knowledge and approval.`;
}

function generateGeminiMd(agents) {
  const delegationRows = agents.map(a => `| ${a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None'} | \`${a.name}\` |`).join('\n');

  // Build official agent name list
  const agentNames = agents.map(a => `\`${a.name}\``).join(', ');

  const content = `# Global Agent Instructions

### Team roster (reference — full instructions in ~/.agents/agents.json)

${buildAgentReferenceList(agents)}

${buildImageDesignDelegateGuide()}

## Auto-Delegation

> [!IMPORTANT]
> **Orchestrator Role & Auto-Delegation**:
> - The main agent (Antigravity orchestrator) acts as a coordinator, delegating tasks to ninja agents (defined globally).
> - Direct Tool Calls in the orchestrator thread for executing file edits or running commands are strictly prohibited. The orchestrator must always route and delegate tasks to the specialized ninja agents.

The orchestrator MUST follow this workflow:
1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it using the \`view_file\` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
2. **Find Skill First**: Call \`konoha.find_skill\` or \`optimize_report\` using keywords from the user prompt (e.g. "ci/cd security") to discover specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`). **Do NOT call \`semble\` tools when locating/searching skills. \`semble\` is strictly a code search MCP with 2 tools (search, find_related) and has no knowledge of skills, whereas the \`konoha\` MCP handles all skill lookups.**
3. **Find Code Context**: If project source code context is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly to locate exact project files before formulating a delegation. Always pass the \`repo\` parameter with the absolute path to the project directory (e.g. \`semble.search(query="...", repo="/path/to/project")\`). Do NOT call \`konoha.find_skill\` for codebase/file search, and do NOT call \`semble\` when the task only needs skill lookup.
4. **Select Agent**: Route to the correct agent dynamically based on the discovered skill or task domain:
   - Check the team roster to see if the discovered skill is embedded in the \`skills\` array of any ninja agent.
   - If no matching skill is embedded, select the closest matching agent (e.g., framework, architecture, and tool maintenance to \`@kage\`; backend, script automation, and database to \`@anbu\`; frontend styling and UI implementation to \`@jonin\`; documentation to \`@tokubetsu-jonin\`).
   - The orchestrator always delegates the task by preparing a file-based delegation (Step 5) and invoking them (Step 6).
5. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to \`<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md\` (where \`<task_id>\` is a unique task subdirectory). You must embed a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
   \`\`\`markdown
   ---
   depth: <N>
   ---
   \`\`\`
   Before writing or updating the new \`delegate.md\`, read the \`depth\` metadata from your current incoming \`delegate.md\` (if you are an agent executing a delegated task) or the target \`delegate.md\` (if it already exists):
   - If a depth value \`N\` is found in either, write the new \`delegate.md\` with \`depth: N + 1\`.
   - Otherwise, initialize it to \`depth: 1\`.
   - **Circuit Breaker**: If \`depth > 7\`, you MUST immediately stop the execution loop, freeze the file state, halt the agent pool, write a circuit breaker warning to \`scratch/tasks/<task_id>/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
   - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
   Categorize the main content clearly:
   - **Goal**: Clear explanation of what needs to be accomplished.
   - **Context**: Relevant files, code snippets, and background details discovered via \`semble\`, **and the exact database names of the specific skill references discovered in Step 1 (e.g. \`anbu-skill/ci-cd-security\`)**.
   - **Constraints**: Rule constraints and target files.
6. **Delegate**: Invoke the ninja agent using the TypeName corresponding to the chosen agent (e.g., \`anbu\`, \`genin\`, etc.). Pass the absolute paths of \`delegate.md\` and \`result.md\` in the agent's prompt. The agent will read \`delegate.md\` from the absolute path specified in your invocation prompt. **If \`delegate.md\` specifies exact reference names under Context, the agent MUST immediately load and read those specific reference documents using the MCP tool \`konoha.get_skill\` (not via direct markdown file reads or view_file of files under .agents/skills/) before starting the task.** After invoking the agent, you MUST immediately end your turn by calling no more tools. Do NOT poll the result file or run loops waiting for completion.
7. **Await Results**: Read the output from \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md\` to finalize the step, report back, and then delete the entire task directory \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/\` to clean up. This cleanup of transient agent scratch folders must be done automatically and silently without asking the user for permission. This resets the depth counter for subsequent tasks.
8. **Planning-to-File (Thought-to-Markdown)**: When formulating a plan or conducting research, write the detailed analysis, plan, or research details to a markdown file (e.g. \`scratch/tasks/<task_id>/plan.md\`) and refer to it, keeping the conversation log light and token-efficient.

The orchestrator ONLY delegates to the defined ninja agents (${agentNames}). Dynamic auto-creation of agents is prohibited.

**Direct Tool Calls Policy**:
- It is strictly prohibited to execute Direct Tool Calls in the orchestrator thread for project tasks. You MUST delegate to the corresponding specialized ninja agent.
- You are ONLY allowed to execute Direct Tool Calls as a fallback if all ninja agents hit quota limits (\`RESOURCE_EXHAUSTED\` / \`429\`) and delegation is blocked.
- Do NOT spawn shadow agents under any circumstances.
- **Semble when needed**: When running direct tool calls, if project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly to locate exact project files before making file modifications or running commands. Do NOT call \`konoha.find_skill\` for codebase/file search, and do NOT call \`semble\` tools when locating/searching skills (use \`konoha.find_skill\` instead).

| Embedded Skills | Agent TypeName |
|-----------|----------|
| \`deep-code-explorer\` | \`genin\` |
| \`devsecops-engineer\`, \`deep-code-explorer\`, \`agent-browser\`, \`konoha\`, \`websearch-deep\`, \`jonin-skill\` | \`kage\` |
| \`websearch-deep\` | \`chunin\` |
| \`agent-browser\`, \`modern-full-stack\` | \`jonin\` |
| \`devsecops-engineer\`, \`agent-browser\` | \`anbu\` |
| \`documentation\` | \`tokubetsu-jonin\` |
| Simple/trivial tasks | Delegate to the matching agent if skill is embedded. Otherwise, route to the closest matching agent (e.g. framework/maintenance to @kage). |

For complex multi-domain tasks, invoke multiple agents in parallel.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.) instead of the built-in \`view_file\` or \`Read\` tool. When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.
- **Konoha MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse, and bounded file tools (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`) for file operations. **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns quota tokens. Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.**
- **Tool Boundaries**: Call **\`semble\` MCP** directly for codebase search. Call **\`konoha\` MCP** for all skill lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills/reference documents. NEVER use \`semble\` search for skills.
- **Agent-Browser CLI**: Use \`agent-browser\` for web page interaction, screenshots, and design match comparison.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\`
- **No Auto-Creation of Agents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Specialized ninja agents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.json\` (created and managed exclusively by the user via the \`konoha\` CLI command).
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`scratch/tasks/\` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use \`rg\` or semble instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **Quota Handling**: On \`RESOURCE_EXHAUSTED\`/\`429\`, fallback to \`Gemini 3.1 Flash-Lite\`. On total exhaustion, halt and output: "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

Full team configuration, model registry, and operational conventions: \`~/.agents/AGENTS.md\`
`;

  return content;
}

function generateClaudeCodeMd(agents) {
  const delegationRows = agents.map(a => `| ${a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None'} | \`@${a.name}\` |`).join('\n');

  const content = `# Claude Code — Global Agent Instructions

You are the **Claude Code agent** equipped with Konoha MCP servers (\`konoha\`, \`semble\`) and specialized ninja agents (\`@genin\`, \`@kage\`, \`@chunin\`, \`@jonin\`, \`@anbu\`, \`@tokubetsu-jonin\`).

## Mandatory workflow

1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it using the \`view_file\` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
2. **Find Skill First**: Call \`konoha.find_skill\` or \`optimize_report\` using keywords from the user prompt (e.g. "ci/cd security") to discover specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`). **Do NOT call \`semble\` tools when locating/searching skills. \`semble\` is strictly a code search MCP and has no knowledge of skills, whereas the \`konoha\` MCP handles all skill lookups.**
3. **Find Code Context**: If project source code context is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly to locate exact project files. Always pass the \`repo\` parameter with the absolute path to the project directory (e.g. \`semble.search(query="...", repo="/path/to/project")\`). Do NOT call \`konoha.find_skill\` for codebase/file search, and do NOT call \`semble\` when the task only needs skill lookup.
4. **Delegate to Konoha Ninja Agents**: When a user request matches a specific agent domain or embedded skill, delegate the task by invoking the appropriate agent (\`@genin\`, \`@kage\`, \`@chunin\`, \`@jonin\`, \`@anbu\`, \`@tokubetsu-jonin\`). Pass the task goal, context, and required skill references. If no agent matches, route to the closest matching specialized agent (e.g., framework, architecture, and tool maintenance to @kage; backend, script automation, and database to @anbu; UI to @jonin). Direct Tool Calls in the main agent thread are strictly prohibited.
5. **Planning-to-File (Thought-to-Markdown)**: When formulating a plan or conducting research, write the detailed analysis, plan, or research details to a markdown file (e.g. \`scratch/plan.md\` or \`.cursor/plan.md\`) and refer to it, keeping the conversation log light and token-efficient.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.) instead of the built-in \`view_file\` or \`Read\` tool. When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.
- **Konoha MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse, and bounded file operations (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`). **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns quota tokens. Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.**
- **Tool Boundaries**: Call **\`semble\` MCP** directly for codebase search. Call **\`konoha\` MCP** for all skill/instruction lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills/reference documents. NEVER use \`semble\` search for skills.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\`
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf).
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use \`rg\` or semble instead.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Quota Handling**: On \`RESOURCE_EXHAUSTED\`/\`429\`, fallback to \`Gemini 3.1 Flash-Lite\`. On total exhaustion, halt and output: "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

| Embedded Skills | Subagent TypeName |
|-----------|----------|
${delegationRows}
| Simple/trivial tasks | Main agent runs directly using Direct Tool Calls. |
`;

  return content
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file/g, 'Write')
    .replace(/replace_file_content/g, 'Edit')
    .replace(/run_command/g, 'Bash')
    // MCP tool mapping for Claude Code double underscore format
    .replace(/(?:skills-db|konoha)\.find_skill/g, 'mcp__konoha__find_skill')
    .replace(/(?:skills-db|konoha)\.get_skill/g, 'mcp__konoha__get_skill')
    .replace(/(?:skills-db|konoha)\.list_skills/g, 'mcp__konoha__list_skills')
    .replace(/(?:skills-db|konoha)\.optimize_report/g, 'mcp__konoha__optimize_report')
    .replace(/(?:skills-db|konoha)\.build_from_source/g, 'mcp__konoha__build_from_source')
    .replace(/(?:skills-db|konoha)\.build_from_text/g, 'mcp__konoha__build_from_text')
    .replace(/semble\.search/g, 'mcp__semble__search')
    .replace(/semble\.find_related/g, 'mcp__semble__find_related')
    .replace(/read_file_head/g, 'mcp__konoha__read_file_head')
    .replace(/read_file_range/g, 'mcp__konoha__read_file_range')
    .replace(/file_info/g, 'mcp__konoha__file_info')
    .replace(/token_efficient_grep/g, 'mcp__konoha__token_efficient_grep')
    .replace(/get_file_structure/g, 'mcp__konoha__get_file_structure')
    .replace(/find_files_clean/g, 'mcp__konoha__find_files_clean');
}



function generateAgentsMd(agents) {
  // Build official agent name list
  const agentNames = agents.map(a => `\`${a.name}\``).join(', ');

  // Build delegation table
  const delegationRows = agents.map(a => `| ${a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None'} | \`${a.name}\` |`).join('\n');

  // Build agent role sections
  const agentSections = agents.map(a => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    const skillsFormatted = a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None';
    return `### @${a.name} — ${iconStr}${a.title}
- **Purpose**: ${a.purpose}
- **Skills**: ${skillsFormatted}
- **Delegate when**: ${a.delegateWhen}
- **Constraints**: ${a.constraints}
- **Workflow**: ${a.workflow}`;
  }).join('\n\n');

  const content = `# AGENTS.md — Multi-Agent Team Configuration

> **Compatibility**: Antigravity IDE, CLI, and all Gemini agent surfaces. Place at \`~/.agents/AGENTS.md\`.

## Team Roles & Delegation

### Team roster

${buildAgentReferenceList(agents)}

${buildImageDesignDelegateGuide()}

### @orchestrator — Task Coordinator
- **Purpose**: Decomposes complex tasks, discovers required skills, and delegates to specialized agents.
- **Auto-Delegation**:
  - The main agent (Antigravity orchestrator) acts as a coordinator, delegating tasks to specialized ninja agents (defined globally).
  - Direct Tool Calls in the orchestrator thread for executing file edits or running commands are strictly prohibited. The orchestrator must always route and delegate tasks to the specialized agents.
- **Workflow**:
  1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it using the \`view_file\` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
  2. **Find Skill First**: Call \`konoha.find_skill()\` or \`optimize_report()\` using keywords from the user prompt to discover specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`). **Do NOT call \`semble\` tools when locating/searching skills. \`semble\` is strictly a code search MCP and has no knowledge of skills, whereas the \`konoha\` MCP handles all skill lookups.**
  3. **Find Code Context**: If project source code context is needed, use the **\`semble\` MCP** (\`search\` or \`find_related\` tools) to locate exact project files before formulating a delegation. Always pass the \`repo\` parameter with the absolute path to the project directory (e.g. \`semble.search(query="...", repo="/path/to/project")\`). Do not call \`semble\` when the task only needs skills — use \`konoha\` for that.
  4. **Select Agent**: Route to the correct agent dynamically based on the discovered skill or task domain:
     - Check the team roster to see if the discovered skill is embedded in the \`skills\` array of any agent.
     - If no matching skill is embedded, select the closest matching agent (e.g., framework, architecture, and tool maintenance to \`@kage\`; backend, script automation, and database to \`@anbu\`; frontend styling and UI implementation to \`@jonin\`; documentation to \`@tokubetsu-jonin\`).
     - The orchestrator always delegates the task by preparing a file-based delegation (Step 5) and invoking them (Step 6).
  5. **Prepare File-Based Delegation**: Write the structured delegation parameters to \`<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md\` (where \`<task_id>\` is a unique task subdirectory). You must include a sequential loop counter at the very top of \`delegate.md\` in a YAML metadata block:
     \`\`\`markdown
     ---
     depth: <N>
     ---
     \`\`\`
     Before writing or updating the new \`delegate.md\`, read the \`depth\` metadata from your current incoming \`delegate.md\` (if you are an agent executing a delegated task) or the target \`delegate.md\` (if it already exists):
     - If a depth value \`N\` is found in either, write the new \`delegate.md\` with \`depth: N + 1\`.
     - Otherwise, initialize it to \`depth: 1\`.
     - **Circuit Breaker**: If \`depth > 7\`, you MUST immediately stop the execution loop, freeze the file state, halt the agent pool, write a circuit breaker warning to \`scratch/tasks/<task_id>/result.md\`, and prompt the user directly in the chat for human-in-the-loop validation.
     - **Artifact Metadata**: When writing or updating any file or artifact (including \`delegate.md\`, \`result.md\`, etc.), you MUST set \`RequestFeedback: false\` and \`UserFacing: false\` in the \`ArtifactMetadata\` block to prevent user prompt overlays and allow silent background execution.
     Categorize the main content clearly:
     - **Goal**: Clear explanation of what needs to be accomplished.
     - **Context**: Relevant files, code snippets, and background details discovered via \`semble\`, **and the exact database names of the specific skill references discovered in Step 1 (e.g. \`anbu-skill/ci-cd-security\`)**.
     - **Constraints**: Rule constraints and target files.
  6. **Delegate**: Invoke the ninja agent using the agent TypeName (e.g., \`anbu\`, \`kage\`, etc.). Pass the absolute paths of \`delegate.md\` and \`result.md\` in the agent's prompt. The agent will read \`delegate.md\` from the path specified in your invocation prompt to run the task, and write its output to \`result.md\` at the path specified in your invocation prompt. **If \`delegate.md\` specifies exact reference names under Context, the agent MUST immediately load and read those specific reference documents using the MCP tool \`konoha.get_skill\` (not via direct markdown file reads or view_file of files under .agents/skills/) before starting the task.** After invoking the agent, you MUST immediately end your turn by calling no more tools. Do NOT poll the result file or run loops waiting for completion.
  7. **Await Results**: Once you are woken up by the system notifying you of agent completion or updates, read the output from \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md\` once complete to consume the output, and then delete the entire task directory \`<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/\` to clean up. This cleanup of transient agent scratch folders must be done automatically and silently without asking the user for permission. This resets the depth counter for subsequent tasks.
  8. **Planning-to-File (Thought-to-Markdown)**: When formulating a plan or conducting research, write the detailed analysis, plan, or research details to a markdown file (e.g. \`scratch/tasks/<task_id>/plan.md\`) and refer to it, keeping the conversation log light and token-efficient.
- **Constraints**: ONLY delegates to defined ninja agents: ${agentNames}. Dynamic auto-creation of agents is prohibited. It is prohibited to execute Direct Tool Calls in the orchestrator thread for project tasks. Only use Direct Tool Calls as a fallback if all agents hit quota limits (\`RESOURCE_EXHAUSTED\` / \`429\`) and delegation is blocked.

| Embedded Skills | Agent TypeName |
|---|---|
${delegationRows}
| Simple/trivial task | Route to the closest matching specialized agent (e.g. framework/maintenance to @kage). |

**FORBIDDEN for Konoha work:** \`TypeName: "self"\` or \`TypeName: "research"\` to impersonate jonin/anbu/genin. Never run \`run_command\` / \`write_to_file\` in the orchestrator thread for delegated work.

${agentSections}

## Operational Conventions — All Agents

### Mandatory Protocol (every agent must follow)
1. **Log on start**: Output \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\` at the start of every response.
2. **Read File-Based Task**: Read the delegation parameters from the absolute path to \`delegate.md\` specified in your invocation prompt at the start of the execution step to fetch the task scope, context, and constraints. **If the Context lists specific skill reference names (e.g. \`anbu-skill/ci-cd-security\`), you MUST immediately call the MCP tool \`konoha.get_skill\` (not direct file reads or view_file of files under .agents/skills/) to load and read the contents of those references before beginning work.**
3. **Konoha first**: Call \`find_skill(keyword, agent='{your_name}')\` before starting any task. Never load SKILL.md files directly.
4. **Agent parameter**: When invoking \`find_skill\`, \`get_skill\`, or \`list_skills\`, always pass \`agent='{your_name}'\`.
5. **Write File-Based Output**: Upon finishing the task, write the complete, detailed output and code changes to a temporary file (e.g. \`result.md.tmp\`) first, then rename/move it atomically to \`result.md\` (at the path specified in your invocation prompt) instead of generating a massive chat response. When writing any files or artifacts using a file modification tool, you MUST set RequestFeedback: false and UserFacing: false in the ArtifactMetadata object to prevent user prompt overlays and allow silent background execution.
6. **Planning-to-File (Thought-to-Markdown)**: For complex tasks requiring multi-step plans, security assessments, or architectural designs, write your detailed step-by-step plan, rationale, and options to \`plan.md\` in the task directory (e.g. \`scratch/tasks/<task_id>/plan.md\`) first. Refer to this plan in your final \`result.md\` and keep the reasoning details out of the chat history and thought block to optimize token consumption.

### Conditional Tools (use only when needed)
- **Semble for code search**: If the task requires searching project source code (not skills), call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns quota tokens. Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.** Prefer \`semble\` over grep/glob for source code search, and do NOT use find_skill for codebase/file search.
- **Konoha for file reads**: If project file reading, structure inspection, info checks, or line greps are needed, call the **\`konoha\` MCP** tools (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`) directly after locating targets with \`semble\`. Do NOT use raw \`cat\`, \`head\`, \`tail\`, \`grep\`, or built-in file tools unless \`konoha\` is unavailable.
- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.) instead of the built-in \`view_file\` or \`Read\` tool. When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.

### Safety Guardrails
- **Tool Boundaries**: Call **\`semble\` MCP** directly for codebase search. Call **\`konoha\` MCP** for all skill/instruction lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills/reference documents. NEVER use \`semble\` search for skills. Direct file reads of instructions or raw grep/find commands are disallowed unless these tools are exhausted.
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`scratch/tasks/\` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask user permission before reading/writing these files.
- **No Git Commands**: Never execute any \`git\` command. Use \`rg\` (ripgrep) or semble MCP instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In the thought/thinking process, keep explanations concise and directly focused on implementation steps. Avoid writing extensive explanations, essays, or redundant logs in the thought block to minimize output/thought token costs.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **No Auto-Creation of Agents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Specialized ninja agents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.json\` (created and managed exclusively by the user via the \`konoha\` CLI command).
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
| Gemini 2.5 Flash-Lite | Fast | \`flash-lite-2.5\`, \`gemini-2.5-flash-lite\` |
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
| **konoha** | node ~/.konoha/file_tools_launcher.js | Skill discovery, file operations, and targeted file reads |
| cloudrun | \`npx -y @google-cloud/cloud-run-mcp\` | GCP deployments |
`;

  return content;
}

// Regenerate template files and deploy them

// Regenerate template files and deploy them
function regenerateAndDeploy(silentOrOptions = false) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent || false);
  const pythonCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.pythonCmd || 'python3') : 'python3';
  const serverPath = typeof silentOrOptions === 'object' ? (silentOrOptions.serverPath || SERVER_PATH) : SERVER_PATH;
  const uvxCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.uvxCmd || 'uvx') : 'uvx';
  const projectRoot = typeof silentOrOptions === 'object' ? (silentOrOptions.projectRoot || null) : null;
  const deployProject = typeof silentOrOptions === 'object' ? (silentOrOptions.deployProject || false) : false;
  const force = typeof silentOrOptions === 'object' ? (silentOrOptions.force || false) : false;

  const agents = loadAgents();
  if (agents.length === 0) return;

  // Skip regeneration when nothing has changed since last deploy.
  // Fingerprint = agents.json mtime+size — robust to content edits, no full JSON parse.
  // Stored persistently because the CLI process exits between invocations.
  let fingerprint = null;
  try {
    const st = fs.statSync(USER_AGENTS_JSON_PATH);
    fingerprint = `${st.mtimeMs}:${st.size}`;
  } catch {}
  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(FINGERPRINT_PATH, 'utf8').trim(); } catch {}
    if (stored === fingerprint) return;
  }

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

  // Deploy Cursor IDE/CLI subagents, rules, and hooks
  try {
    cursorManager.ensureCursorSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true,
      allowHooks: true,
      ruleContent: null
    });
  } catch (e) {
    // Fail silently if Cursor dirs are not writable
  }

  // Deploy native Antigravity CLI agent.json files (fixes invoke_subagent / self fallback)
  try {
    antigravityManager.ensureAntigravityAgents(agents, { silent: true, projectDir: path.join(__dirname, '..') });
  } catch (e) {
    // Fail silently if Antigravity dirs are not writable
  }

  // Deploy Claude Code MCP setup
  try {
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      silent: true,
      ruleContent: generateClaudeCodeMd(agents),
      agents,
      projectRoot,
      deployProject
    });
  } catch (e) {
    // Fail silently if Claude configs are not writable
  }

  // Deploy OpenCode MCP setup
  try {
    mcpClientsManager.ensureOpenCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      silent: true
    });
  } catch (e) {
    // Fail silently if OpenCode configs are not writable
  }

  // Cache fingerprint so subsequent calls with unchanged agents.json skip the deploy.
  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(FINGERPRINT_PATH), { recursive: true });
      fs.writeFileSync(FINGERPRINT_PATH, fingerprint);
    } catch {}
  }

  if (!silent) {
    const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
    const opencodeInstalled = mcpClientsManager.isOpenCodeInstalled();
    const lines = [
      `  - ${GEMINI_MD_PATH}`,
      `  - ${AGENTS_MD_PATH}`,
      `  - ${cursorManager.CURSOR_AGENTS_GLOBAL}`,
      `  - ${antigravityManager.ANTIGRAVITY_AGENTS_GLOBAL}`,
    ];
    if (claudeInstalled) {
      const claudeHome = require('os').homedir();
      lines.push(`  - ${require('path').join(claudeHome, '.claude.json')} (Claude Code)`);
    }
    if (opencodeInstalled) {
      const ocHome = require('os').homedir();
      lines.push(`  - ${require('path').join(ocHome, '.config', 'opencode', 'opencode.json')} (OpenCode)`);
    }
    console.log(`✓ Generated and deployed configs to:\n${lines.join('\n')}`);
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
    instructions: options.instructions || `You are the ${name} subagent. Log: \"[${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}] active\". If delegate.md specifies exact reference names, load them via the skills-db.get_skill tool. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`,
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

function getOfficialAgentNames() {
  let defaults = [];
  if (fs.existsSync(DEFAULT_AGENTS_JSON_PATH)) {
    try {
      defaults = JSON.parse(fs.readFileSync(DEFAULT_AGENTS_JSON_PATH, 'utf-8'));
    } catch (e) {}
  }
  return defaults.map((a) => a.name.toLowerCase());
}

// Delete a subagent entirely
function deleteAgent(name) {
  const lowerName = name.toLowerCase();
  const official = getOfficialAgentNames();
  if (official.includes(lowerName)) {
    throw new Error(
      `Subagent "${name}" is a protected default Konoha ninja and cannot be deleted.`
    );
  }

  const agents = loadAgents();
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
function updateAgentModel(agentName, modelName, clientType = 'antigravity') {
  const agents = loadAgents();
  const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());

  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  let field = 'modelTier';
  if (clientType === 'cursor') field = 'cursorModel';
  else if (clientType === 'claude') field = 'claudeModel';
  else if (clientType === 'opencode') field = 'opencodeModel';

  if (agent[field] === modelName) {
    return false; // Already set
  }

  agent[field] = modelName;
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
  updateAgentModel,
  buildDefineSubagentGuide,
  generateGeminiMd,
  generateAgentsMd,
  generateClaudeCodeMd
};
