const fs = require('fs');
const path = require('path');
const {
  buildSembleSearchPolicy,
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const deployUtils = require('./deploy_utils');
const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
const {
  CURSOR_DIR, CURSOR_MCP_GLOBAL, CURSOR_AGENTS_GLOBAL, CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL, CURSOR_CLI_CONFIG, SKILLS_DB_DIR,
  SERVER_PATH, FILE_TOOLS_MCP_PATH, CURSOR_BOOTSTRAP_PATH, SRC_DIR
} = require('../bin/lib/paths');

const PROJECT_CURSOR_DIR = '.cursor';

const CURSOR_FALLBACK_MODEL = 'inherit';

const CURSOR_RULES_GLOBAL = path.join(CURSOR_DIR, 'rules');
const CURSOR_RTK_RULE_SRC = path.join(__dirname, '..', '.cursor', 'rules', 'rtk.mdc');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached } = require('./platform_utils');
const {
  buildSubagentContract,
  buildMainAgentContract,
  buildManagedContract
} = require('./agent_contract');

function isRtkInstalled() {
  return isCommandAvailable('rtk');
}

function deployCursorRtkRule(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  if (!fileExists(CURSOR_RTK_RULE_SRC)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  ensureDir(CURSOR_RULES_GLOBAL);
  const dest = path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc');
  try {
    fs.copyFileSync(CURSOR_RTK_RULE_SRC, dest);
    if (!silent) console.log(`  ✓ Deployed RTK rule to ${dest}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function isCursorInstalled() {
  return (
    isCommandAvailable('cursor') ||
    fileExistsCached(CURSOR_DIR) ||
    fileExistsCached(CURSOR_MCP_GLOBAL)
  );
}

function adaptInstructionsForCursor(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file|replace_file_content/g, 'Write/StrReplace')
    .replace(/run_command/g, 'Shell')
    .trim();
}

function resolveCursorModel(agent = {}) {
  return agent.cursor_fallback_model || agent.cursorFallbackModel || CURSOR_FALLBACK_MODEL;
}

function generateCursorSubagent(agent) {
  const readonly = agent.name === 'genin';
  const description = `${agent.description} Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
  
  let instructions = agent.instructions || '';
  // Strip any existing Before work: find_skill(...) checklist calls
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const findSkillCalls = agent.skills.map(s => `find_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const getSkillCalls = agent.skills.map(s => `get_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const loadingInstruction = `After discovery, load the full skill content with ${getSkillCalls}`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions;
    }
  }

  instructions = `${instructions}\n\n${buildSubagentContract('cursor')}`;
  const body = adaptInstructionsForCursor(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
  ];
  if (readonly) {
    frontmatter.push('readonly: true');
  }
  frontmatter.push('---', '');

  return frontmatter.join('\n') + body + '\n\n' + sembleLine + '\n' + fileToolsLine + '\n';
}function generateCursorRule(agents, ruleContent = null) {
  if (ruleContent) {
    const managed = buildManagedContract(ruleContent, buildMainAgentContract('cursor'));
    return `---\ndescription: Konoha multi-agent orchestration — delegate to ninja agents via Task tool, use konoha MCP for skills\nalwaysApply: true\n---\n\n` + managed;
  }
  const agentList = agents.map(a => `\`${a.name}\` (${resolveCursorModel(a)})`).join(', ');
  const delegationRows = agents
    .map(a => `| ${a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None'} | \`${a.name}\` |`)
    .join('\n');

  const rule = `---
description: Konoha multi-agent orchestration — delegate to ninja agents via MCP tools, use konoha MCP for skills
alwaysApply: true
---

# Konoha — Cursor Main Agent

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You MUST use \`konoha\` MCP and \`semble\` MCP for ALL file operations and code search. Using built-in Cursor tools (\`Read\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`) or shell commands (\`cat\`, \`head\`, \`grep\`, \`rg\`, \`find\`) is **STRICTLY FORBIDDEN**.
>
> - **File reads/grep/structure** → \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
> - **Code search/discovery** → \`semble\` MCP (\`search\`, \`find_related\`)
> - **Skill lookup** → \`konoha\` MCP (\`find_skill\`, \`get_skill\`, \`list_skills\`)
> - **NEVER** call Cursor \`Read\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`, or shell \`cat\`/\`head\`/\`tail\`/\`grep\`/\`rg\`/\`find\` — always use the MCP equivalents above.

You are the **Konoha orchestrator**. Act as coordinator, delegating specialized work to specialized Konoha agents by calling the corresponding subagent MCP tool (e.g. \`konoha.kage\`, \`konoha.anbu\`). Direct Tool Calls in the orchestrator thread for executing file edits or running commands are strictly prohibited; the orchestrator must always delegate via the MCP tools.

## Ninja Agents (MCP tools)

Official team tools: ${agentList}

Skill packages live under \`.cursor/skills/\` (mirrored from \`~/.agents/skills/\`). Use \`konoha\` MCP for on-demand retrieval — never load \`SKILL.md\` files directly.

## Mandatory workflow

### Step 0: Classify Request — ALWAYS FIRST (Branch A vs Branch B)
**BEFORE entering the standard workflow**, classify the user's request:
- **Website build intent** (build/create/scaffold/generate/make + website/web app/landing page/UI/frontend/site/e-commerce/storefront/portfolio/dashboard/app, OR framework-specific like "next.js project"/"svelte app"/"nuxt site") → **BRANCH B**
- **Design mockups provided** (source-image-design, mockup images, figma) → **BRANCH B** with \`build_from_source\`
- **Everything else** → **BRANCH A** (standard workflow below)

### BRANCH B: Website Scaffolding (SKIP standard pipeline)
1. Call \`konoha.build_from_text(name, description, framework)\` or \`konoha.build_from_source(name, source_dir, framework)\` FIRST.
2. Write \`delegate.md\` with returned directives as constraints and call \`konoha.jonin\` directly — DO NOT call Chunin, Genin, or Kage.
3. After Jonin completes, call \`konoha.tokubetsu_jonin\` for documentation.
4. Output final report.

### BRANCH A: Standard Workflow (for non-website tasks)
1. **Skills first**: Call \`konoha\` MCP \`find_skill\` with keywords from the user prompt (pass \`agent\` when available) to find the related skill reference. Never load SKILL.md files directly.
2. **Code context**: If source code search is needed, call \`semble\` MCP (\`search\` / \`find_related\`). Never use semble for skill lookup. **Do NOT use Cursor \`Grep\`, \`Glob\`, or \`SemanticSearch\` — semble is the default search tool.**
3. **File reads**: After semble locates targets, use \`konoha\` MCP for reads/grep/structure — **never Cursor \`Read\`/\`Grep\`/\`Glob\` or shell \`cat\`/\`head\`/\`grep\`.**
4. **Match agent by skill**: Route to the correct agent dynamically based on the discovered skill or task domain:
   - Check the team roster to see if the discovered skill is embedded in the \`skills\` array of any agent.
   - If no matching skill is embedded, route to the closest matching specialized agent (e.g. framework/maintenance to @kage, backend to @anbu, UI to @jonin).
   - Delegate by calling the corresponding subagent MCP tool (e.g. \`konoha.anbu\`), passing \`task_dir\` pointing to a task directory (resolved via \`konoha.get_resolved_task_dir\` → \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/\` — **never** inside the project workspace) containing \`delegate.md\` instructions.
5. **Synthesize**: Present results to the user.
6. **Resuming & Multi-Turn Conversations (CRITICAL)**: Upon resuming a conversation or handling any follow-up turn in Cursor, you MUST ALWAYS re-evaluate the user prompt, write \`delegate.md\`, and execute the \`mcp_<agentname>\` delegation workflow again for all non-trivial tasks. NEVER skip \`mcp_<agentname>\` delegation when resuming a conversation.
7. **Package Manager Mandate**: ALWAYS use \`pnpm\` (e.g., \`pnpm dlx create-next-app@latest\`, \`pnpm create\`, \`pnpm install\`, \`pnpm run dev\`) for all project scaffolding, dependencies, and dev server execution. NEVER use \`npm\` or standalone \`npx\` without pnpm.
8. **Project Knowledge Mandate**: ALWAYS inspect project-local knowledge files (project \`README.md\`, \`docs/\`, \`CONTRIBUTING.md\`, \`.cursorrules\`, \`.clauderules\`, and project-local skills in \`.agents/skills\`, \`.cursor/skills\`, \`skills/\`) using \`konoha\` MCP before designing architecture or executing code.
9. **Operational Scenarios**: Follow Scenario 1 (\`build_from_source\` — 100% exact mockup match), Scenario 2 (\`build_from_text\` — new site with \`pnpm\` & premium templates), and Scenario 3 (\`existing_project\` — preserve existing logic, architecture, and design system without silent or unrequested changes).

| Embedded Skills | Subagent MCP Tool |
|---|---|
${delegationRows}
| Simple/trivial task | Route to the closest matching specialized agent (e.g. framework/maintenance to @kage). |

${buildSembleSearchPolicy()}

${buildFileToolsPolicy()}

## Tool boundaries

- **konoha**: \`find_skill\`, \`get_skill\`, \`list_skills\` (skills/references), and bounded file operations (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
- **semble**: \`search\`, \`find_related\` — **default** for all project code search and discovery
- Never mix MCP servers for the wrong purpose
- **Forbidden for code discovery**: \`Grep\`, \`Glob\`, \`SemanticSearch\`, shell \`grep\`/\`rg\`/\`find\` (use semble first; \`rg\` only if semble MCP fails)
- **Forbidden for file reads**: Cursor \`Read\`, shell \`cat\`/\`head\`/\`tail\` (use konoha MCP)

## Guardrails

- Log at response start: \`[Konoha] orchestrator active. Calling konoha.find_skill(...)\`
- **Zero Warning/Error Policy**: You MUST ensure the codebase passes \`pnpm lint\` and \`pnpm build\` with ZERO warnings and ZERO errors. You MUST NOT use deprecated libraries. If you see warnings during installation or execution (e.g. deprecated packages), you MUST fix them before claiming the task is complete.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.
- **Optimize Thought Tokens**: Keep thought processes concise, structured, and implementation-focused to minimize output and thought token usage.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Codebase Hygiene & Cleanup**: When working on fixes or testing features manually, ensure that all temporary files, debugging scripts (e.g., \`patch_test.py\`, \`savings_out.txt\`, \`test_clients_e2e.py\`, \`fix_json.js\`, etc.), or manual mock files created during the testing process are ALWAYS DELETED before concluding the task. The project codebase must remain clean and strictly contain only production logic and official test suites.
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- Read-only for \`.env\`, \`terraform.tfvars\`, \`secrets.yaml\` unless user approves
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`~/.konoha/tmp/<client>/<session>/scratch/tasks/\` which must be executed silently and automatically.
- On rate limits, retry with \`${CURSOR_FALLBACK_MODEL}\`

Full team config: \`~/.agents/AGENTS.md\`
`;
  return buildManagedContract(rule, buildMainAgentContract('cursor'));
}

function buildMcpServers(pythonCmd, serverPath, uvxCmd) {
  const servers = {
    semble: {
      type: 'stdio',
      command: uvxCmd,
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };

  const konohaEntry = deployUtils.buildKonohaFilesMcpEntry('cursor');
  if (konohaEntry) {
    servers['konoha'] = konohaEntry;
  }
  return servers;
}

function registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!pythonCmd || !serverPath || !fileExists(serverPath)) {
    return false;
  }

  const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
  ensureDir(CURSOR_DIR);

  // Backup existing config once before replacing
  const backupPath = CURSOR_MCP_GLOBAL + '.back';
  if (fileExists(CURSOR_MCP_GLOBAL) && !fileExists(backupPath)) {
    fs.copyFileSync(CURSOR_MCP_GLOBAL, backupPath);
    if (!silent) console.log(`  \u2713 Backed up ${path.basename(CURSOR_MCP_GLOBAL)} \u2192 ${path.basename(backupPath)}`);
  }

  // Load existing config to preserve non-mcpServers keys
  let config = { mcpServers: {} };
  if (fileExists(CURSOR_MCP_GLOBAL)) {
    try {
      config = parseYaml(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) console.warn(`Invalid YAML in ${CURSOR_MCP_GLOBAL}, starting fresh.`);
      config = { mcpServers: {} };
    }
  }

  // Replace mcpServers entirely with only Konoha servers
  const servers = buildMcpServers(pythonCmd, serverPath, uvxCmd || 'uvx');
  config.mcpServers = servers;

  fs.writeFileSync(CURSOR_MCP_GLOBAL, stringifyYaml(config) + '\n');
  if (!silent) {
    console.log(`\u2713 Replaced ${CURSOR_MCP_GLOBAL} with Konoha-only MCP servers`);
  }
  return true;
}

function registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const mcpPath = path.join(cursorDir, 'mcp.yaml');
  ensureDir(cursorDir);

  let config = { mcpServers: {} };
  if (fileExists(mcpPath)) {
    try {
      config = parseYaml(fs.readFileSync(mcpPath, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) {
        console.warn(`Skipped project MCP update: invalid YAML in ${mcpPath}`);
      }
      return false;
    }
  }

  delete config.mcpServers['konoha'];

  const servers = buildMcpServers(
    pythonCmd,
    serverPath,
    uvxCmd || 'uvx'
  );

  // Portable project config — cross-platform JS launcher (node on PATH in Cursor/IDE)
  if (servers['konoha']) {
    servers['konoha'] = {
      type: 'stdio',
      command: 'node',
      args: ['${userHome}/.konoha/file_tools_launcher.js']
    };
  }

  let updated = false;
  for (const [name, entry] of Object.entries(servers)) {
    const existing = config.mcpServers[name];
    if (
      !existing ||
      existing.command !== entry.command ||
      JSON.stringify(existing.args || []) !== JSON.stringify(entry.args || [])
    ) {
      config.mcpServers[name] = entry;
      updated = true;
    }
  }

  if (updated || !fileExists(mcpPath)) {
    fs.writeFileSync(mcpPath, stringifyYaml(config) + '\n');
    if (!silent) {
      console.log(`✓ Registered project MCP config: ${mcpPath}`);
    }
  }
  return true;
}

function registerCursorCliPermissions(silent = true) {
  if (!fileExists(CURSOR_CLI_CONFIG)) {
    return false;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
  } catch {
    return false;
  }

  if (!config.permissions) config.permissions = {};
  const allowRaw = config.permissions.allow;
  config.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

  const grants = [
    'Mcp(konoha)',
    'Mcp(konoha, find_skill)',
    'Mcp(konoha, get_skill)',
    'Mcp(konoha, list_skills)',
    'Mcp(konoha, optimize_report)',
    'Mcp(konoha, read_file_head)',
    'Mcp(konoha, read_file_range)',
    'Mcp(konoha, file_info)',
    'Mcp(konoha, token_efficient_grep)',
    'Mcp(konoha, get_file_structure)',
    'Mcp(konoha, find_files_clean)',
    'Mcp(semble)',
    'Mcp(semble, search)',
    'Mcp(semble, find_related)',
    'Shell(konoha)',
    'Shell(node bin/cli.js)',
    'Shell(node */.konoha/cursor_bootstrap.js)'
  ];

  let updated = false;
  for (const grant of grants) {
    if (!config.permissions.allow.includes(grant)) {
      config.permissions.allow.push(grant);
      updated = true;
    }
  }

  if (updated) {
    fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      console.log(`✓ Cursor CLI permissions updated: ${CURSOR_CLI_CONFIG}`);
    }
  }
  return true;
}

function registerCursorHooks(silent = true, allowHooks = true) {
  if (!allowHooks) {
    if (!fileExists(CURSOR_HOOKS_GLOBAL)) return false;
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (config.hooks && config.hooks.sessionStart) {
        config.hooks.sessionStart = config.hooks.sessionStart.filter(
          h => !(h.command && h.command.includes('cursor_bootstrap.js'))
        );
        if (config.hooks.sessionStart.length === 0) {
          delete config.hooks.sessionStart;
        }
        fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
      }
    } catch {}
    return false;
  }

  ensureDir(CURSOR_DIR);
  let config = { version: 1, hooks: {} };

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (!config.hooks) config.hooks = {};
      if (!config.version) config.version = 1;
    } catch {
      config = { version: 1, hooks: {} };
    }
  }

  const bootstrapCmd = `node "${CURSOR_BOOTSTRAP_PATH}"`;
  const existing = config.hooks.sessionStart || [];
  const hasBootstrap = existing.some(h => h.command && h.command.includes('cursor_bootstrap.js'));

  if (!hasBootstrap) {
    config.hooks.sessionStart = [
      ...existing,
      { command: bootstrapCmd }
    ];
    fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      console.log(`✓ Registered Cursor sessionStart hook: ${CURSOR_HOOKS_GLOBAL}`);
    }
  }
  return true;
}

function deployCursorGlobalRule(agents, silent = true) {
  if (!agents || agents.length === 0) return false;
  try {
    ensureDir(CURSOR_RULES_GLOBAL);
    const rulePath = path.join(CURSOR_RULES_GLOBAL, 'konoha.mdc');
    const content = generateCursorRule(agents);
    if (!fileExists(rulePath) || fs.readFileSync(rulePath, 'utf8') !== content) {
      fs.writeFileSync(rulePath, content, 'utf8');
    }
    if (!silent) console.log(`✓ Deployed global Cursor rule: ${rulePath}`);
    return true;
  } catch {
    return false;
  }
}

function deployProjectCursor(projectRoot, agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const rulesDir = path.join(cursorDir, 'rules');
  ensureDir(rulesDir);

  // Deploy orchestrator rule
  const rulePath = path.join(rulesDir, 'konoha.mdc');
  fs.writeFileSync(rulePath, generateCursorRule(agents, ruleContent));

  if (!silent) {
    console.log(`✓ Deployed project Cursor config to ${cursorDir}`);
  }
  return true;
}

function copyCursorHelperScripts(silent = true) {
  const scripts = ['cursor_bootstrap.js'];
  ensureDir(SKILLS_DB_DIR);
  let copied = 0;

  for (const script of scripts) {
    const src = path.join(SRC_DIR, script);
    const dest = path.join(SKILLS_DB_DIR, script);
    if (fileExists(src)) {
      try {
        const srcContent = fs.readFileSync(src);
        if (!fileExists(dest) || !srcContent.equals(fs.readFileSync(dest))) {
          fs.writeFileSync(dest, srcContent);
          copied++;
        }
      } catch {}
    }
  }
  return copied > 0;
}

function ensureCursorSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    agents = [],
    projectRoot = null,
    deployProject = true,
    silent = true,
    allowHooks = true,
    ruleContent = null
  } = options;

  copyCursorHelperScripts(silent);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent);
  registerCursorCliPermissions(silent);
  registerCursorHooks(silent, allowHooks);
  deployCursorRtkRule(silent);
  if (agents.length > 0) deployCursorGlobalRule(agents, silent);

  if (deployProject) {
    const root = projectRoot || process.cwd();
    try {
      registerCursorProjectMcp(root, pythonCmd, serverPath, uvxCmd, silent);
    } catch {}
  }

  deployUtils.syncCursorSkillsFromAgents({ projectRoot, deployProject, silent });

  if (agents.length > 0) {
    if (deployProject) {
      const root = projectRoot || process.cwd();
      try {
        deployProjectCursor(root, agents, silent, ruleContent);
      } catch {}
    }
  }

  return { ok: true };
}

function removeCursorConfig(silent = true) {
  // Remove only Konoha-managed MCP entries
  if (fileExists(CURSOR_MCP_GLOBAL)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      let updated = false;
      if (config.mcpServers) {
        for (const name of ['konoha', 'semble']) {
          if (config.mcpServers[name]) {
            delete config.mcpServers[name];
            updated = true;
          }
        }
      }
      if (updated) {
        fs.writeFileSync(CURSOR_MCP_GLOBAL, JSON.stringify(config, null, 2) + '\n');
        if (!silent) console.log('✓ Removed Konoha MCP servers from ~/.cursor/mcp.json');
      }
    } catch {}
  }

  // Remove global subagents
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  for (const name of official) {
    const p = path.join(CURSOR_AGENTS_GLOBAL, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  // Remove Cursor CLI permissions
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
      if (allowArr.length > 0) {
        const grants = [
          'Mcp(semble)',
          'Mcp(semble, search)',
          'Mcp(semble, find_related)',
          'Mcp(konoha)',
          'Mcp(konoha, find_skill)',
          'Mcp(konoha, get_skill)',
          'Mcp(konoha, list_skills)',
          'Mcp(konoha, optimize_report)',
          'Mcp(konoha, read_file_head)',
          'Mcp(konoha, read_file_range)',
          'Mcp(konoha, file_info)',
          'Mcp(konoha, token_efficient_grep)',
          'Mcp(konoha, get_file_structure)',
          'Mcp(konoha, find_files_clean)',
          'Mcp(konoha-files)',
          'Mcp(konoha-files, read_file_head)',
          'Mcp(konoha-files, read_file_range)',
          'Mcp(konoha-files, file_info)',
          'Mcp(konoha-files, token_efficient_grep)',
          'Mcp(konoha-files, get_file_structure)',
          'Mcp(konoha-files, find_files_clean)',
          'Shell(konoha)',
          'Shell(node bin/cli.js)',
          'Shell(node */.konoha/cursor_bootstrap.js)'
        ];
        const initialLength = allowArr.length;
        const filtered = allowArr.filter(p => !grants.includes(p));
        if (filtered.length !== initialLength) {
          config.permissions.allow = filtered;
          fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
          if (!silent) console.log('✓ Removed Konoha permissions from ~/.cursor/cli-config.json');
        }
      }
    } catch {}
  }

  // Remove sessionStart bootstrap hook
  registerCursorHooks(silent, false);
}

function getCursorStatus() {
  const status = {
    mcpGlobal: fileExists(CURSOR_MCP_GLOBAL),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonoha: false,
    subagentsGlobal: 0,
    skillsGlobal: 0,
    skillsProject: 0,
    cliPermissions: false,
    hooks: false,
    projectMcp: false,
    projectRule: false,
    projectAgents: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc'))
  };

  if (status.mcpGlobal) {
    try {
      const { parseYaml } = require('../bin/lib/yaml_utils');
      const config = parseYaml(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      status.mcpSkillsDb = !!(config.mcpServers && config.mcpServers['konoha']);
      status.mcpSemble = !!(config.mcpServers && config.mcpServers['semble']);
      status.mcpKonoha = !!(config.mcpServers && config.mcpServers['konoha']);
    } catch {}
  }

  if (fileExists(CURSOR_AGENTS_GLOBAL)) {
    try {
      status.subagentsGlobal = fs.readdirSync(CURSOR_AGENTS_GLOBAL).filter(f => f.endsWith('.md')).length;
    } catch {}
  }

  if (fileExists(CURSOR_SKILLS_GLOBAL)) {
    try {
      status.skillsGlobal = deployUtils.listSkillEntries(CURSOR_SKILLS_GLOBAL).length;
    } catch {}
  }

  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allows = (config.permissions && Array.isArray(config.permissions.allow)) ? config.permissions.allow : [];
      status.cliPermissions = allows.some(a => a.includes('konoha')) && allows.some(a => a.includes('semble'));
    } catch {}
  }

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      const hooks = (config.hooks && config.hooks.sessionStart) || [];
      status.hooks = hooks.some(h => h.command && h.command.includes('cursor_bootstrap.js'));
    } catch {}
  }

  const cwd = process.cwd();
  const projectMcp = path.join(cwd, PROJECT_CURSOR_DIR, 'mcp.yaml');
  const projectRule = path.join(cwd, PROJECT_CURSOR_DIR, 'rules', 'konoha.mdc');
  const projectAgents = path.join(cwd, PROJECT_CURSOR_DIR, 'agents');
  const projectSkills = null; // No-op: filesystem mirroring is disabled

  status.projectMcp = fileExists(projectMcp);
  status.projectRule = fileExists(projectRule);
  if (fileExists(projectAgents)) {
    try {
      status.projectAgents = fs.readdirSync(projectAgents).filter(f => f.endsWith('.md')).length;
    } catch {}
  }
  // No-op: filesystem mirroring is disabled. Skills are loaded from SQLite DB at runtime.
  status.skillsProject = 0;

  return status;
}

module.exports = {
  CURSOR_MCP_GLOBAL,
  CURSOR_AGENTS_GLOBAL,
  CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG,
  CURSOR_RULES_GLOBAL,
  CURSOR_FALLBACK_MODEL,
  resolveCursorModel,
  isCursorInstalled,
  isRtkInstalled,
  generateCursorSubagent,
  generateCursorRule,
  registerCursorMcp,
  registerCursorProjectMcp,
  registerCursorCliPermissions,
  registerCursorHooks,
  deployProjectCursor,
  deployCursorGlobalRule,
  deployCursorRtkRule,
  ensureCursorSetup,
  removeCursorConfig,
  getCursorStatus,
  copyCursorHelperScripts
};
