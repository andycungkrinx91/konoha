const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const platform = require('./platform_utils');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
const {
  SKILLS_DB_DIR, SERVER_PATH, GEMINI_MD_PATH, AGENTS_MD_PATH,
  USER_AGENTS_YAML_PATH, DEFAULT_AGENTS_YAML_PATH, GEMINI_TEMPLATE_PATH,
  AGENTS_TEMPLATE_PATH, FINGERPRINT_PATH, SRC_DIR, DEFAULT_SKILLS_DIRS,
  HOME, CURSOR_MCP, AGENTS_SKILLS
} = require('../bin/lib/paths');

const {
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const {
  buildMainAgentContract,
  buildManagedContract
} = require('./agent_contract');


let isRegenerating = false;
let __cachedPython = null; // Cache Python detection across loadAgents calls
let __cachedAgents = null; // Cache loadAgents result
let __cachedAgentsTs = 0; // File modification timestamp for cache invalidation

function _getCachedAgents(reloadDefaults = false) {
  if (reloadDefaults) return null;
  try {
    const ts = fs.statSync(USER_AGENTS_YAML_PATH).mtimeMs;
    if (__cachedAgents !== null && __cachedAgentsTs === ts) {
      return __cachedAgents;
    }
  } catch {}
  return null;
}

function _setCachedAgents(agents) {
  try {
    __cachedAgentsTs = fs.statSync(USER_AGENTS_YAML_PATH).mtimeMs;
  } catch {}
  __cachedAgents = agents;
}

function _getPythonCmd() {
  if (__cachedPython === null) {
    try {
      __cachedPython = platform.detectPythonOrDefault();
    } catch {
      __cachedPython = process.platform === 'win32' ? 'python' : 'python3';
    }
  }
  return __cachedPython;
}

function normalizeLegacySkillName(skill) {
  if (typeof skill !== 'string') return skill;
  if (skill === 'deep-code-explorer') return 'genin-skill';
  if (skill.startsWith('deep-code-explorer/')) {
    return `genin-skill/${skill.slice('deep-code-explorer/'.length)}`;
  }
  return skill;
}

function getSkillsForAgentFromDb(configuredSkills, allDbSkills) {
  if (!allDbSkills || allDbSkills.length === 0) return Array.isArray(configuredSkills) ? configuredSkills : [];
  const allowed = Array.isArray(configuredSkills) ? configuredSkills : [];
  const resolved = allDbSkills.filter(s => {
    const base = s.split('/')[0];
    if (allowed.includes(s) || allowed.includes(base)) return true;
    return false;
  });
  const resolvedBases = new Set(resolved.map(s => s.split('/')[0]));
  const unresolved = allowed.filter(s => {
    const base = s.split('/')[0];
    return !resolvedBases.has(base);
  });
  return [...unresolved, ...resolved];
}

// Load agents from SQLite or YAML
function loadAgents(reloadDefaults = false, silent = false) {
  // Use cached result if file hasn't changed
  const cached = _getCachedAgents(reloadDefaults);
  if (cached !== null) return cached;

  let agents = [];
  let loadedFromDb = false;
  let loadedFromUser = false;

  if (!reloadDefaults) {
    try {
      const pythonCmd = _getPythonCmd();
      const dbAgentsScript = path.join(__dirname, 'db_agents.py');
      const res = spawnSync(pythonCmd, [dbAgentsScript, 'list-compact'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      if (res.status === 0) {
        agents = JSON.parse(res.stdout.trim());
        loadedFromDb = true;
      }
    } catch (e) {}

    if (!loadedFromDb && fs.existsSync(USER_AGENTS_YAML_PATH)) {
      try {
        agents = parseYaml(fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8'));
        loadedFromUser = true;
      } catch (e) {}
    }
  }

  // Load defaults
  let defaults = [];
  if (fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) {
    try {
      defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    } catch (e) {}
  }

  if ((agents.length === 0 || reloadDefaults) && defaults.length > 0) {
    agents = defaults;
    try {
      const pythonCmd = _getPythonCmd();
      const dbAgentsScript = path.join(__dirname, 'db_agents.py');
      // Bulk upsert via a single Python invocation to avoid N process startups
      spawnSync(pythonCmd, [dbAgentsScript, '--bulk-import', JSON.stringify(agents)], { encoding: 'utf8' });
    } catch (e) {}
  }

  // Query installed skills from SQLite database dynamically
  let allDbSkills = [];
  const dbPath = path.join(HOME, '.konoha', 'skills.db');
  if (fs.existsSync(dbPath)) {
    try {
      const pythonCmd = _getPythonCmd();
      const script = `import sqlite3, sys, json
try:
    conn = sqlite3.connect(sys.argv[1])
    rows = conn.execute("SELECT DISTINCT name FROM skills").fetchall()
    print(json.dumps([r[0] for r in rows]))
except Exception:
    print("[]")`;
      const res = spawnSync(pythonCmd, ['-c', script, dbPath], { encoding: 'utf8' });
      if (res.status === 0) {
        allDbSkills = JSON.parse(res.stdout.trim());
      }
    } catch (e) {}
  }

  // Dynamically resolve skills for each agent based on SQLite contents
  if (agents.length > 0) {
    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      // Determine base configured skills (if not present, fallback to default template skills)
      let configuredSkills = Array.isArray(a.skills) ? a.skills.map(normalizeLegacySkillName) : [];
      if (configuredSkills.length === 0 && defAgent) {
        configuredSkills = defAgent.skills || [];
      }
      if (!Array.isArray(configuredSkills)) {
        configuredSkills = [];
      }

      if (allDbSkills.length === 0) {
        // Fallback to configured list if SQLite DB is empty/unmigrated
        a.skills = configuredSkills;
      } else {
        // Resolve sub-skills/reference files dynamically from SQLite
        a.skills = getSkillsForAgentFromDb(configuredSkills, allDbSkills);
      }
      return a;
    });
  }

  if (loadedFromDb || loadedFromUser) {
    // Upgrade existing agents if their instructions do not specify passing the agent parameter
    let upgraded = false;

    // Check if the user's agents.yaml has already been upgraded to the new concept (v1.1.1+)
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
          const legacyBundledSkills = ['devsecops-engineer', 'websearch-deep', 'documentation'];
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
          const needsAgentUpgrade = /\b(?:skills-db|konoha)\.find_skill/.test(a.instructions) && !a.instructions.includes('agent=');
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
        if (a.icon !== defAgent.icon) {
          a.icon = defAgent.icon;
          changed = true;
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
          regenerateAndDeploy({ silent });
        } catch (e) {
        } finally {
          isRegenerating = false;
        }
      }
    }
    _setCachedAgents(agents);
    return agents;
  } else {
    // Initialize user agents.yaml
    if (defaults.length > 0) {
      const agentsDir = path.dirname(USER_AGENTS_YAML_PATH);
      if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
      }
      fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(defaults) + '\n');
      _setCachedAgents(defaults);
      return defaults;
    }
  }
  _setCachedAgents(agents);
  return agents;
}

// Save agents to SQLite (authoritative) then mirror to YAML cache
function saveAgents(agents) {
  // 1. Persist to YAML file first (external consumers read this)
  const agentsDir = path.dirname(USER_AGENTS_YAML_PATH);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(agents) + '\n');

  // 2. Write to SQLite as source of truth via import (single transaction)
  try {
    const pythonCmd = _getPythonCmd();
    const dbAgentsScript = path.join(__dirname, 'db_agents.py');
    spawnSync(pythonCmd, [dbAgentsScript, 'import'], { encoding: 'utf8' });
  } catch (e) {}

  // 3. Invalidate cache so next loadAgents reads the fresh state
  __cachedAgents = null;
}

function buildAgentReferenceList(agents) {
  return agents.map((a, i) => {
    const iconStr = a.icon ? `${a.icon} ` : '';
    return `${i + 1}. **${iconStr}${a.name}** — ${a.description}`;
  }).join('\n');
}

function buildDefineSubagentGuide(agents) {
  const names = agents.map((a) => a.name).join(', ');
  return `### Konoha MCP Tool-Based Delegation (CRITICAL)

All subagents are migrated to MCP tools served by the \`konoha\` MCP server. Rather than using custom subagent configuration structures or files, delegation is performed directly by calling the corresponding MCP tool.

The official delegation tools are: ${agents.map(a => `\`${a.name}\``).join(', ')}.

### Delegation Protocol

To delegate a task:
1. Resolve a task directory via the MCP tool \`konoha.get_resolved_task_dir\` (it returns \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/\` — **never** inside the project workspace, so transient agent files can never be accidentally committed). Create a fresh subdirectory there (e.g. \`<task_dir>/<task_id>/\`).
2. Write a \`delegate.md\` file inside the task directory containing:
   - Specific instructions, context, and file paths to modify.
   - The list of skill reference names to load (or omit to let prompt-driven autoload match skills from the prompt text).
   - Standard constraints.
3. Call the corresponding MCP tool (e.g. \`kage\`, \`jonin\`, etc.) using the tool calling API, passing the \`task_dir\` argument pointing to the created task directory.
4. The tool executes the agent inline and returns the result. Read the response/result.md and continue your orchestration flow.

This guarantees consistent cross-client execution without relying on custom subagent configuration frameworks or files.`;
}

function buildImageDesignDelegateGuide() {
  return `### Image / mockup builds — delegate.md rules (CRITICAL)

When the user prompt mentions \`source-image-design\`, design images, or mockups:

1. Orchestrator calls \`konoha.build_from_source\`(name, source_dir, framework) before writing \`delegate.md\`.
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

1. The orchestrator MUST call the MCP tool \`konoha.build_from_text\`(name, description, framework) first before writing \`delegate.md\`.
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
3. **No silent design changes**: NEVER hallucinate, fabricate, or silently update/change design elements, colors, layouts, styles, or functionality without the user's explicit knowledge and approval.
4. **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.`;
}

function getSkillDescriptions(skillsList) {
  const dbPath = path.join(HOME, '.konoha', 'skills.db');
  if (!fs.existsSync(dbPath) || !skillsList || skillsList.length === 0) return {};
  try {
    const platform = require('./platform_utils');
    const pythonCmd = _getPythonCmd();
    const script = `import sqlite3, sys, json
try:
    conn = sqlite3.connect(sys.argv[1])
    skills = json.loads(sys.argv[2])
    res = {}
    for s in skills:
        row = conn.execute("SELECT content FROM skills WHERE name = ?", (s,)).fetchone()
        if row:
            content = row[0]
            desc = ""
            if content.startswith("---"):
                parts = content.split("---")
                if len(parts) >= 3:
                    for line in parts[1].split("\\n"):
                        if line.strip().startswith("description:"):
                            desc = line.split("description:")[1].strip()
                            if desc.startswith('"') and desc.endswith('"'): desc = desc[1:-1]
                            if desc.startswith("'") and desc.endswith("'"): desc = desc[1:-1]
                            break
            if not desc:
                row_desc = conn.execute("SELECT tags FROM skills WHERE name = ?", (s,)).fetchone()
                if row_desc: desc = row_desc[0].replace(",", " ")
            res[s] = desc
    print(json.dumps(res))
except Exception:
    print("{}")`;
    const res = spawnSync(pythonCmd, ['-c', script, dbPath, JSON.stringify(skillsList)], { encoding: 'utf8' });
    if (res.status === 0) {
      return JSON.parse(res.stdout.trim());
    }
  } catch (e) {}
  return {};
}

function generateGeminiMd(agents) {
  const skillRows = agents.map(a => {
    const skill = a.skills && a.skills.length > 0 ? a.skills[0] : 'simple-task';
    return `| ${skill} | \`${a.name}\` |`;
  }).join('\n');

  // Build official agent name list
  const agentNames = agents.map(a => `\`${a.name}\``).join(', ');

  const baseSkills = [...new Set(agents.flatMap(a => {
    return (a.skills || []).map(s => s.split('/')[0]);
  }))];
  const skillDescs = getSkillDescriptions(baseSkills);
  const dynamicTableRows = baseSkills.map(skill => {
    const desc = skillDescs[skill] || 'Specialized skill';
    const cleanDesc = desc.replace(/[\r\n|]/g, ' ').trim().slice(0, 100);
    return `| ${cleanDesc} | \`${skill}\` | \`${skill}\` |`;
  }).join('\n');

  const content = `# Global Agent Instructions

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You are equipped with two MCP servers: **\`konoha\`** and **\`semble\`**. You MUST use them for ALL file operations and code search. Using native/built-in tools (\`view_file\`, \`grep_search\`, \`list_dir\`, \`run_command\` with \`cat\`/\`head\`/\`grep\`/\`rg\`/\`find\`) is **STRICTLY FORBIDDEN** and will be blocked.
>
> - **File reads/grep/structure** → \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
> - **Code search/discovery** → \`semble\` MCP (\`search\`, \`find_related\`)
> - **Skill lookup** → \`konoha\` MCP (\`find_skill\`, \`get_skill\`, \`list_skills\`)
> - **NEVER** call \`view_file\`, \`grep_search\`, \`list_dir\`, or shell \`cat\`/\`head\`/\`tail\`/\`grep\`/\`rg\`/\`find\` directly — always use the MCP equivalents above.

### Team roster (reference — full instructions in ~/.agents/agents.yaml)

${buildAgentReferenceList(agents)}

${buildImageDesignDelegateGuide()}

${buildDefineSubagentGuide(agents)}

## Orchestration Model

> [!IMPORTANT]
> **Orchestrator Role**: The main agent runs as the primary Antigravity thread and acts as the **orchestrator only**. It coordinates and delegates tasks to konoha subagents — it does NOT execute non-trivial implementation tasks itself.
>
> Delegation is performed directly by calling the corresponding subagent MCP tool (e.g. \`kage\`, \`jonin\`, \`anbu\`, \`chunin\`, \`tokubetsu_jonin\`, \`genin\`) served by the \`konoha\` MCP server. Do NOT attempt to use \`invoke_subagent\` or custom IDE subagent configurations.

The orchestrator follows this workflow:
1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it to retrieve the complete user request/prompt.
2. **Find Skill First**: Call \`konoha.find_skill\` or \`optimize_report\` using keywords from the user prompt to discover specific skill reference names. **Do NOT call \`semble\` tools when locating skills.**
3. **Load Skill Reference**: Call \`konoha.get_skill\` to fetch the full content of the discovered skill.
4. **Delegate to Konoha Subagent (MCP Tool)**: Resolve a task directory via \`konoha.get_resolved_task_dir\` (returns \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/\` — **never** inside the project workspace, so transient agent files cannot be accidentally committed), create a fresh subdirectory there, write a \`delegate.md\` file inside it containing specific instructions, constraints, and the list of skill references (or omit to allow prompt-driven autoload), then call the matching subagent MCP tool (e.g., \`jonin\`, \`anbu\`, \`genin\`) passing the \`task_dir\` argument pointing to the created task directory.
5. **Wait & Receive Result**: The MCP tool runs the subagent inline. Once it finishes and writes \`result.md\`, retrieve the results and proceed.
6. **Direct Execution (trivial only)**: Only execute simple/trivial tasks directly (single bounded read/edit on a known file). All non-trivial tasks MUST be delegated.
7. **Planning-to-File**: Write detailed analysis, plans, or research details to a markdown file instead of outputting massive text blocks.

### Routing by Domain (for skill selection AND delegation)

Use the table below to select the right **skill reference** AND **subagent** to delegate to:

| Domain / Description | Embedded Skills | Skill to Load |
|---|---|---|
${dynamicTableRows}
| Simple/trivial tasks | Select the closest matching skill | Consult the team roster |

For complex multi-domain tasks, load multiple skill references and delegate each domain to the appropriate subagent.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.) instead of the built-in \`view_file\` or \`Read\` tool. When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.
- **Konoha MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse, and bounded file tools (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`) for file operations. **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns API tokens. Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.**
- **Tool Boundaries**: Call **\`semble\` MCP** directly for codebase search. Call **\`konoha\` MCP** for all skill lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills/reference documents. NEVER use \`semble\` search for skills.
- **Agent-Browser CLI**: Use \`agent-browser\` for web page interaction, screenshots, and design match comparison.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\`
- **No Auto-Creation of Agents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Specialized ninja agents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.yaml\` (created and managed exclusively by the user via the \`konoha\` CLI command).
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`~/.konoha/tmp/<client>/<session>/scratch/tasks/\` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use \`rg\` or semble instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **Quota Handling**: Removed. Quota management is handled at the platform level, not by subagents.
- **Conversation Resume / Multi-Turn**: Upon resuming a conversation or in multi-turn interactions, you MUST NOT forget your constraints. ALWAYS re-execute the \`mcp_<agentname>\` delegation workflow via the \`konoha\` MCP. ALWAYS use the \`semble\` MCP for codebase search, and ALWAYS adhere to RTK (Rust Token Killer) principles. Do not bypass these tools just because you are in a resumed session.
- **Forced MCP Usage & Delegation**: ABSOLUTE RULE — all work MUST go through \`konoha\` MCP (skills + bounded file ops) and \`semble\` MCP (codebase search). NEVER call generic \`view_file\`/\`Read\`/\`Grep\`/\`Glob\`/\`run_command\` (\`cat\`, \`head\`, \`grep\`, \`rg\`, \`find\`) directly. NEVER use \`semble\` for skills; NEVER use \`konoha\` for codebase search. The main orchestrator MUST delegate all non-trivial tasks to konoha subagents (\`genin\`, \`chunin\`, \`jonin\`, \`anbu\`, \`kage\`, \`tokubetsu-jonin\`) via the Agent tool. The orchestrator MUST NOT execute implementation tasks itself — it only coordinates and delegates. Trivial tasks (single bounded read/edit on a known file) may be executed directly.

Full team configuration, model registry, and operational conventions: \`~/.agents/AGENTS.md\`
`;

  return buildManagedContract(content, buildMainAgentContract('antigravity'));
}

function generateClaudeCodeMd(agents) {
  const baseSkills = [...new Set(agents.flatMap(a => {
    return (a.skills || []).map(s => s.split('/')[0]);
  }))];
  const skillDescs = getSkillDescriptions(baseSkills);
  const dynamicTableRows = baseSkills.map(skill => {
    const desc = skillDescs[skill] || 'Specialized skill';
    const cleanDesc = desc.replace(/[\r\n|]/g, ' ').trim().slice(0, 100);
    const agent = agents.find(a => (a.skills || []).some(s => s.startsWith(skill)));
    const agentTool = agent ? `\`${agent.name}\` (MCP Tool)` : 'Main agent';
    return `| ${cleanDesc} | \`${skill}\` | ${agentTool} |`;
  }).join('\n');

  const content = `# Claude Code — Global Agent Instructions

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You MUST use \`konoha\` MCP and \`semble\` MCP for ALL file operations and code search. Using built-in tools (\`Read\`, \`Grep\`, \`Glob\`, \`Bash\` with \`cat\`/\`head\`/\`grep\`/\`rg\`/\`find\`) is **STRICTLY FORBIDDEN**.
>
> - **File reads/grep/structure** → \`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`
> - **Code search/discovery** → \`semble.search\`, \`semble.find_related\`
> - **Skill lookup** → \`konoha.find_skill\`, \`konoha.get_skill\`, \`konoha.list_skills\`
> - **NEVER** call \`Read\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`, or \`Bash\` with \`cat\`/\`head\`/\`tail\`/\`grep\`/\`rg\`/\`find\` — always use the MCP equivalents above.

You are the **Claude Code agent** (the orchestrator / **Konoha agent**) equipped with Konoha MCP servers (\`konoha\`, \`semble\`).

## Orchestrator & Delegation Model (CRITICAL)

You delegate specialized work by calling the corresponding subagent MCP tools served by the \`konoha\` MCP server: \`mcp__konoha__kage\`, \`mcp__konoha__jonin\`, \`mcp__konoha__anbu\`, \`mcp__konoha__chunin\`, \`mcp__konoha__tokubetsu_jonin\`, \`mcp__konoha__genin\`.

**CRITICAL RULES:**
- **NEVER use built-in Claude Code agents** or custom agent \`@\` mentions — only delegate via the MCP tools listed above.
- **NEVER call built-in tools directly** (\`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`, \`WebSearch\`) — all file operations and search MUST go through \`konoha\` MCP and \`semble\` MCP tools exclusively.
- The main agent is an **orchestrator only** — it coordinates, delegates, and reports back. It does NOT execute implementation tasks itself.

### Delegation Protocol:
1. **Read User Prompt**: Read the user request to understand scope and domain.
2. **Find Skill**: Call \`konoha.find_skill\` or \`optimize_report\` to discover skill references. **Do NOT call \`semble\` for skills.**
3. **Delegate**: Resolve a task directory via \`konoha.get_resolved_task_dir\` (returns \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/\` — **never** inside the project workspace), create a fresh subdirectory there, write \`delegate.md\` with task details, constraints, and context, then invoke the corresponding subagent MCP tool (e.g. \`anbu\`) passing that absolute \`task_dir\`.
4. **Report**: Once the tool completes and writes \`result.md\`, read it and report back to the user.
5. **Direct Execution (trivial only)**: Only execute simple/trivial tasks directly (single bounded read/edit on a known file using konoha MCP tools).
6. **Planning-to-File**: Write plans and analysis to markdown files, keeping the conversation log light.

## Tools & Guardrails

- **MCP-Only Tooling (ABSOLUTE RULE)**: ALL file reads, searches, and operations MUST use \`konoha\` MCP or \`semble\` MCP tools. NEVER call built-in \`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`, or \`WebSearch\` tools directly. NEVER use shell commands (\`cat\`, \`head\`, \`grep\`, \`rg\`, \`find\`).
- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.). When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines). Avoid loading massive files into your context window.
- **Konoha MCP**: Use \`find_skill(keyword)\` for skill search, \`get_skill(name)\` for full content, \`list_skills()\` to browse, and bounded file operations (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`). **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools for finding or locating skills. NEVER use \`semble\` search for skills.**
- **Tool Boundaries**: Call **\`semble\` MCP** for codebase search. Call **\`konoha\` MCP** for skills and bounded file reads/grep. Never mix them.
- **Logging**: Every response MUST start with a log line: \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\`
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any \`git\` command. Use semble instead.
- **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.
- **Optimize Thought Tokens**: Keep thoughts concise in thinking processes. Avoid verbose reasoning.

| Domain / Description | Skill to Load | MCP Tool to Call |
|---|---|---|
${dynamicTableRows}
| Simple/trivial tasks | - | Main agent runs directly (MCP tools only) |
`;

  return buildManagedContract(content, buildMainAgentContract('claude'))
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file/g, 'Write')
    .replace(/replace_file_content/g, 'Edit')
    .replace(/run_command/g, 'Bash')
    // MCP tool mapping for Claude Code double underscore format.
    // Use a single guard to avoid double-prefixing when text already contains `mcp__konoha__`.
    .replace(/(?:skills-db|konoha)\.find_skill/g, 'mcp__konoha__find_skill')
    .replace(/(?:skills-db|konoha)\.get_skill/g, 'mcp__konoha__get_skill')
    .replace(/(?:skills-db|konoha)\.list_skills/g, 'mcp__konoha__list_skills')
    .replace(/(?:skills-db|konoha)\.optimize_report/g, 'mcp__konoha__optimize_report')
    .replace(/(?:skills-db|konoha)\.build_from_source/g, 'mcp__konoha__build_from_source')
    .replace(/(?:skills-db|konoha)\.build_from_text/g, 'mcp__konoha__build_from_text')
    .replace(/(?:skills-db|konoha)\.get_resolved_task_dir/g, 'mcp__konoha__get_resolved_task_dir')
    .replace(/(?:skills-db|konoha)\.migrate_skills/g, 'mcp__konoha__migrate_skills')
    .replace(/(?:skills-db|konoha)\.web_search/g, 'mcp__konoha__web_search')
    .replace(/(?:skills-db|konoha)\.sannin/g, 'mcp__konoha__sannin')
    .replace(/(?:skills-db|konoha)\.kage/g, 'mcp__konoha__kage')
    .replace(/(?:skills-db|konoha)\.jonin/g, 'mcp__konoha__jonin')
    .replace(/(?:skills-db|konoha)\.anbu/g, 'mcp__konoha__anbu')
    .replace(/(?:skills-db|konoha)\.chunin/g, 'mcp__konoha__chunin')
    .replace(/(?:skills-db|konoha)\.tokubetsu_jonin/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?:skills-db|konoha)\.genin/g, 'mcp__konoha__genin')
    .replace(/semble\.search/g, 'mcp__semble__search')
    .replace(/semble\.find_related/g, 'mcp__semble__find_related')
    // Bare tool names → mcp__konoha__ prefix. Word-boundary + negative lookbehind so we don't
    // double-prefix text that already contains `mcp__konoha__`.
    .replace(/(?<!mcp__konoha__)\boptimize_report\b/g, 'mcp__konoha__optimize_report')
    .replace(/(?<!mcp__konoha__)\bkage\b(?!-)/g, 'mcp__konoha__kage')
    .replace(/(?<!mcp__konoha__)\bjonin\b(?!-)/g, 'mcp__konoha__jonin')
    .replace(/(?<!mcp__konoha__)\banbu\b(?!-)/g, 'mcp__konoha__anbu')
    .replace(/(?<!mcp__konoha__)\bchunin\b(?!-)/g, 'mcp__konoha__chunin')
    .replace(/(?<!mcp__konoha__)\bgenin\b(?!-)/g, 'mcp__konoha__genin')
    .replace(/(?<!mcp__konoha__)\btokubetsu_jonin\b(?!-)/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?<!mcp__konoha__)\bmcp_sannin\b(?!-)/g, 'mcp__konoha__mcp_sannin')
    .replace(/(?<!mcp__konoha__)\bfind_skill\b/g, 'mcp__konoha__find_skill')
    .replace(/(?<!mcp__konoha__)\bget_skill\b/g, 'mcp__konoha__get_skill')
    .replace(/(?<!mcp__konoha__)\blist_skills\b/g, 'mcp__konoha__list_skills')
    .replace(/(?<!mcp__konoha__)\bread_file_head\b/g, 'mcp__konoha__read_file_head')
    .replace(/(?<!mcp__konoha__)\bread_file_range\b/g, 'mcp__konoha__read_file_range')
    .replace(/(?<!mcp__konoha__)\bfile_info\b/g, 'mcp__konoha__file_info')
    .replace(/(?<!mcp__konoha__)\btoken_efficient_grep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bget_file_structure\b/g, 'mcp__konoha__get_file_structure')
    .replace(/(?<!mcp__konoha__)\bfind_files_clean\b/g, 'mcp__konoha__find_files_clean')
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

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You are equipped with two MCP servers: **\`konoha\`** and **\`semble\`**. You MUST use them for ALL file operations and code search. Using native/built-in tools (\`view_file\`, \`grep_search\`, \`list_dir\`, \`run_command\` with \`cat\`/\`head\`/\`grep\`/\`rg\`/\`find\`) is **STRICTLY FORBIDDEN** and will be blocked.
>
> - **File reads/grep/structure** → \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
> - **Code search/discovery** → \`semble\` MCP (\`search\`, \`find_related\`)
> - **Skill lookup** → \`konoha\` MCP (\`find_skill\`, \`get_skill\`, \`list_skills\`)
> - **NEVER** call \`view_file\`, \`grep_search\`, \`list_dir\`, or shell \`cat\`/\`head\`/\`tail\`/\`grep\`/\`rg\`/\`find\` directly — always use the MCP equivalents above.

## Team Roles & Delegation

### Team roster

${buildAgentReferenceList(agents)}

${buildImageDesignDelegateGuide()}

${buildDefineSubagentGuide(agents)}

### @orchestrator — Task Coordinator
- **Purpose**: Orchestrates and coordinates tasks by calling subagent MCP tools. Runs as TypeName: "self" — the primary Antigravity thread.
- **Orchestration Model**:
  - The orchestrator acts as a coordinator. For any non-trivial task, the orchestrator delegates by calling the corresponding subagent MCP tool (e.g. \`kage\`, \`jonin\`, etc.).
  - To delegate: create a task directory, write a \`delegate.md\` file with task instructions, context, and skills, then call the subagent MCP tool passing the \`task_dir\` argument.
- **Workflow**:
  1. **Read User Prompt**: At the start of the session/turn, if a \`prompt.md\` file exists in the artifact directory, immediately read it to retrieve the complete user request/prompt.
  2. **Find Skill**: Call \`konoha.find_skill()\` or \`optimize_report()\` using keywords from the user prompt to discover specific skill reference names.
  3. **Load Skill**: Call \`konoha.get_skill()\` to fetch the full content of the discovered skill.
  4. **Delegate (MCP Tool)**: Create a task directory, write \`delegate.md\`, and call the matching subagent MCP tool passing \`task_dir\`.
  5. **Report**: Read the subagent's execution results from the tool return or \`result.md\`, and present them to the user.
- **Constraints**: ONLY references skill definitions from the defined ninja agents: ${agentNames}.
- **Fallback**: Only use Direct Tool Calls as a fallback if MCP tools are unavailable.

| Skill Name | Subagent MCP Tool |
|---|---|
${delegationRows}
| Simple/trivial task | Main agent executes directly using native tools. |

${agentSections}

## Operational Conventions — All Agents

### Mandatory Protocol (every agent must follow)
1. **Log on start**: Output \`[{Icon} {Name}] active. Calling konoha.find_skill('...')\` at the start of every response.
2. **Read File-Based Task**: Read the delegation parameters from the absolute path to \`delegate.md\` specified in your invocation prompt at the start of the execution step to fetch the task scope, context, and constraints. **If the Context lists specific skill reference names (e.g. \`devsecops-engineer/ci-cd-security\`), you MUST immediately call the MCP tool \`konoha.get_skill\` (not direct file reads or view_file of files under .agents/skills/) to load and read the contents of those references before beginning work.**
3. **Konoha first**: Call \`find_skill(keyword, agent='{your_name}')\` before starting any task. Never load SKILL.md files directly.
4. **Agent parameter**: When invoking \`find_skill\`, \`get_skill\`, or \`list_skills\`, always pass \`agent='{your_name}'\`.
5. **Write File-Based Output**: Upon finishing the task, write the complete, detailed output and code changes to a temporary file (e.g. \`result.md.tmp\`) first, then rename/move it atomically to \`result.md\` (at the path specified in your invocation prompt) instead of generating a massive chat response. When writing any files or artifacts using a file modification tool, you MUST set RequestFeedback: false and UserFacing: false in the ArtifactMetadata object to prevent user prompt overlays and allow silent background execution.
6. **Planning-to-File (Thought-to-Markdown)**: For complex tasks requiring multi-step plans, security assessments, or architectural designs, write your detailed step-by-step plan, rationale, and options to \`plan.md\` in the task directory (e.g. \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/plan.md\`) first. Refer to this plan in your final \`result.md\` and keep the reasoning details out of the chat history and thought block to optimize token consumption.

### Conditional Tools (use only when needed)
- **Semble for code search**: If the task requires searching project source code (not skills), call the **\`semble\` MCP** (\`search\` or \`find_related\` tools) directly. **Do NOT call \`semble\` tools (search, find_related) for finding or locating skills, as \`semble\` is strictly a project code search engine and querying it for skills burns API tokens. Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills and reference documents. NEVER use \`semble\` search for skills.** Prefer \`semble\` over grep/glob for source code search, and do NOT use find_skill for codebase/file search.
- **Konoha for file reads**: If project file reading, structure inspection, info checks, or line greps are needed, call the **\`konoha\` MCP** tools (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`) directly after locating targets with \`semble\`. Do NOT use raw \`cat\`, \`head\`, \`tail\`, \`grep\`, or built-in file tools unless \`konoha\` is unavailable.
- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **\`konoha\` MCP** (\`read_file_head\`, \`read_file_range\`, etc.) instead of the built-in \`view_file\` or \`Read\` tool. When reading files, ALWAYS specify a precise \`StartLine\` and \`EndLine\` range (no more than 50-100 lines) containing the target code discovered via \`semble\` search. Avoid loading massive files into your context window.

### Safety Guardrails
- **Tool Boundaries**: Call **\`semble\` MCP** directly for codebase search. Call **\`konoha\` MCP** for all skill/instruction lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use \`konoha\` MCP tools (\`find_skill\`, \`get_skill\`) for discovering and reading skills/reference documents. NEVER use \`semble\` search for skills. Direct file reads of instructions or raw grep/find commands are disallowed unless these tools are exhausted.
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`~/.konoha/tmp/<client>/<session>/scratch/tasks/\` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask user permission before reading/writing these files.
- **No Git Commands**: Never execute any \`git\` command. Use \`rg\` (ripgrep) or semble MCP instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In the thought/thinking process, keep explanations concise and directly focused on implementation steps. Avoid writing extensive explanations, essays, or redundant logs in the thought block to minimize output/thought token costs.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **No Auto-Creation of Agents**: The AI is strictly prohibited from dynamically calling \`define_subagent\` during a task to create custom/shadow agents. Specialized ninja agents can only be defined at session startup based on the manual configuration loaded from \`~/.agents/agents.yaml\` (created and managed exclusively by the user via the \`konoha\` CLI command).
- **Minimal changes**: Avoid large rewrites unless explicitly requested. Preserve existing architecture.
- **Validate**: Run tests, linting, dry-runs before claiming completion.
- **Cite evidence**: File paths with line numbers for code, URLs for research.
- **Security**: Never expose secrets, use least privilege, redact credentials as \`[REDACTED]\`.

## Model Registry

| Model Name | Tier | Alias |
|---|---|---|
| Gemini 3.5 Flash (Low) | Fast | \`flash-low\`, \`low\` |
| Gemini 3.5 Flash (Medium) | Fast | \`flash-medium\`, \`medium\` |
| Gemini 3.5 Flash (High) | Fast | \`flash-high\`, \`high\` |
| Gemini 3.1 Pro (Low) | Standard | \`pro-low\` |
| Gemini 3.1 Pro (High) | Standard | \`pro-high\` |
| Claude Sonnet 4.6 (Thinking) | Reasoning | \`sonnet\`, \`sonnet-thinking\` |
| Claude Opus 4.6 (Thinking) | Advanced | \`opus\`, \`opus-thinking\` |

## Available MCP Tools

Load **semble** when project source code search is needed — do NOT load it for skill-only tasks.

| MCP | Command | Load When |
|---|---|---|
| **semble** | \`uvx --from semble[mcp] semble\` | Project source code search needed |
| **konoha** | node ~/.konoha/file_tools_launcher.js | Skill discovery, file operations, and targeted file reads |
| cloudrun | \`npx -y @google-cloud/cloud-run-mcp\` | GCP deployments |
`;

  return buildManagedContract(content, buildMainAgentContract('antigravity'));
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

  const agents = loadAgents(force);
  if (agents.length === 0) return;

  // Skip regeneration when nothing has changed since last deploy.
  // Fingerprint = agents.yaml mtime+size — robust to content edits, no full JSON parse.
  // Stored persistently because the CLI process exits between invocations.
  let fingerprint = null;
  try {
    const st = fs.statSync(USER_AGENTS_YAML_PATH);
    fingerprint = `${st.mtimeMs}:${st.size}`;
  } catch {}
  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(FINGERPRINT_PATH, 'utf8').trim(); } catch {}
    if (stored === fingerprint) return;
  }

  const geminiContent = generateGeminiMd(agents);
  const agentsContent = generateAgentsMd(agents);

  try {
    fs.mkdirSync(path.dirname(GEMINI_MD_PATH), { recursive: true });
    fs.writeFileSync(GEMINI_MD_PATH, geminiContent);
  } catch (e) {}

  try {
    fs.mkdirSync(path.dirname(AGENTS_MD_PATH), { recursive: true });
    fs.writeFileSync(AGENTS_MD_PATH, agentsContent);
  } catch (e) {}

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

  // Deploy native Antigravity CLI MCP schemas (fixes lazy tool discovery)
  try {
    antigravityManager.ensureAntigravityMcpSchemas(agents);
  } catch (e) {
    // Fail silently if Antigravity dirs are not writable
  }

  // Clean up obsolete subagent configuration directories (delegation is strictly MCP-based now)
  try {
    const obsoleteDirs = [
      path.join(__dirname, '..', '.agents', 'agents'),
      path.join(__dirname, '..', '.cursor', 'agents'),
      path.join(os.homedir(), '.gemini', 'config', 'agents'),
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'agents'),
      path.join(os.homedir(), '.gemini', 'antigravity-ide', 'agents'),
      path.join(os.homedir(), '.cursor', 'agents')
    ];
    for (const d of obsoleteDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
  } catch (e) {}

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

  // Cache fingerprint so subsequent calls with unchanged agents.yaml skip the deploy.
  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(FINGERPRINT_PATH), { recursive: true });
      fs.writeFileSync(FINGERPRINT_PATH, fingerprint);
    } catch {}
  }

  if (!silent) {
    const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
    const lines = [
      `  - ${cursorManager.CURSOR_AGENTS_GLOBAL}`,
      `  - ${antigravityManager.ANTIGRAVITY_AGENTS_GLOBAL}`,
    ];
    if (claudeInstalled) {
      const claudeHome = require('os').homedir();
      lines.push(`  - ${require('path').join(claudeHome, '.claude.yaml')} (Claude Code)`);
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
  
  const allowedNames = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  if (!allowedNames.includes(lowerName) && !options.manual) {
    throw new Error(`Subagent creation locked: "${name}" is not an official subagent. Auto-creation of custom subagents is strictly prohibited by system guardrails. To override this manually, you must pass the --manual flag.`);
  }

  // Auto-prefix with mcp_ for consistency with DB storage
  const displayName = lowerName.startsWith('mcp_') ? lowerName : `mcp_${lowerName}`;

  if (agents.some(a => a.name === lowerName || a.name === displayName)) {
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
    name: displayName,
    icon: icon,
    title: options.title || (name.charAt(0).toUpperCase() + name.slice(1) + " Ninja"),
    purpose: options.purpose || "General assistant",
    skills: options.skills || [],
    delegateWhen: options.delegateWhen || `Need assistance with ${options.purpose || "general tasks"}`,
    constraints: options.constraints || "Discover skills via `konoha.find_skill`. If project source code search is needed, use `semble` MCP (`search`/`find_related`).",
    workflow: options.workflow || "Discover skill references via `konoha.find_skill`, search project code via `semble`, then execute task.",
    description: options.description || options.purpose || `Custom subagent specialized in ${name}`,
    instructions: options.instructions || `You are the ${name} subagent. Log: \"[${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}] active\". If delegate.md specifies exact reference names, load them via the konoha.get_skill tool. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md. ALWAYS use semble for codebase search and ensure the RTK (Rust Token Killer) principles are followed.`,
    delegationKeywords: options.delegationKeywords || name
  };

  agents.push(newAgent);
  saveAgents(agents);
  regenerateAndDeploy();
  return newAgent;
}

function findAgent(agents, name) {
  const searchName = name.toLowerCase().replace(/^(mcp_|_mcp_|mcp-)/, '');
  return agents.find(a => {
    const aName = a.name.toLowerCase();
    const aBare = aName.replace(/^(mcp_|_mcp_|mcp-)/, '');
    return aName === name.toLowerCase() || aBare === searchName;
  });
}

// Embed a skill in a subagent
function embedSkill(agentName, skillName) {
  const agents = loadAgents();
  const agent = findAgent(agents, agentName);

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
  const agent = findAgent(agents, agentName);

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
  if (fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) {
    try {
      defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    } catch (e) {}
  }
  return defaults.map((a) => a.name.toLowerCase());
}

// Delete a subagent entirely
function deleteAgent(name) {
  const lowerName = name.toLowerCase();
  const searchName = lowerName.replace(/^(mcp_|_mcp_|mcp-)/, '');
  const official = getOfficialAgentNames();
  
  const isOfficial = official.some(oName => {
    const oBare = oName.toLowerCase().replace(/^(mcp_|_mcp_|mcp-)/, '');
    return oName.toLowerCase() === lowerName || oBare === searchName;
  });

  if (isOfficial) {
    throw new Error(
      `Subagent "${name}" is a protected default Konoha ninja and cannot be deleted.`
    );
  }

  const agents = loadAgents();
  const initialLength = agents.length;
  const filtered = agents.filter(a => {
    const aName = a.name.toLowerCase();
    const aBare = aName.replace(/^(mcp_|_mcp_|mcp-)/, '');
    return aName !== lowerName && aBare !== searchName;
  });

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
  deleteAgent,
  buildDefineSubagentGuide,
  generateGeminiMd,
  generateAgentsMd,
  generateClaudeCodeMd,
  parseYaml,
  stringifyYaml
};
