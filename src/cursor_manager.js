const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildSembleSearchPolicy,
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const deployUtils = require('./deploy_utils');

const HOME = os.homedir();
const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP_GLOBAL = path.join(CURSOR_DIR, 'mcp.json');
const CURSOR_AGENTS_GLOBAL = path.join(CURSOR_DIR, 'agents');
const CURSOR_SKILLS_GLOBAL = path.join(CURSOR_DIR, 'skills');
const CURSOR_HOOKS_GLOBAL = path.join(CURSOR_DIR, 'hooks.json');
const CURSOR_CLI_CONFIG = path.join(CURSOR_DIR, 'cli-config.json');
const SKILLS_DB_DIR = path.join(HOME, '.gemini', 'skills-db');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const FILE_TOOLS_MCP_PATH = path.join(SKILLS_DB_DIR, 'file_tools_mcp.js');
const CURSOR_BOOTSTRAP_PATH = path.join(SKILLS_DB_DIR, 'cursor_bootstrap.js');

const SRC_DIR = __dirname;
const PROJECT_CURSOR_DIR = '.cursor';

const DEFAULT_CURSOR_MODELS = {
  genin: 'inherit',
  kage: 'inherit',
  chunin: 'inherit',
  jonin: 'inherit',
  anbu: 'inherit',
  'tokubetsu-jonin': 'inherit'
};

const CURSOR_FALLBACK_MODEL = 'inherit';

const CURSOR_MODEL_ALIASES = {
  'Gemini 3.1 Flash-Lite': 'composer-2.5-fast',
  'Gemini 2.5 Flash': 'composer-2.5-fast',
  'Gemini 2.5 Flash-Lite': 'composer-2.5-fast',
  'Gemini 3.5 Flash (Low)': 'gpt-5.5-medium',
  'Gemini 3.5 Flash (Medium)': 'claude-4.6-sonnet-medium-thinking',
  'Gemini 3.5 Flash (High)': 'claude-4.6-sonnet-medium-thinking',
  'Gemini 3.1 Pro (Low)': 'claude-opus-4-8-thinking-high',
  'Gemini 3.1 Pro (High)': 'claude-opus-4-8-thinking-high',
  'Claude Sonnet 4.6 (Thinking)': 'claude-4.6-sonnet-medium-thinking',
  'Claude Opus 4.6 (Thinking)': 'claude-opus-4-8-thinking-high',
  'GPT-OSS 120B (Medium)': 'gpt-5.3-codex'
};

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(d) {
  if (!fileExists(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function resolveCursorModel(agent) {
  // Cursor Free users cannot reliably pick premium models; use session Auto.
  if (agent.cursorModel && agent.cursorModel.trim()) {
    const configured = agent.cursorModel.trim().toLowerCase();
    if (configured === 'auto' || configured === 'inherit') {
      return 'inherit';
    }
    return agent.cursorModel;
  }
  if (agent.name && DEFAULT_CURSOR_MODELS[agent.name]) {
    return DEFAULT_CURSOR_MODELS[agent.name];
  }
  return CURSOR_FALLBACK_MODEL;
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

function generateCursorSubagent(agent) {
  const model = resolveCursorModel(agent);
  const readonly = agent.name === 'genin';
  const description = `${agent.description} Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
  const body = adaptInstructionsForCursor(agent.instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
    `model: ${model}`,
  ];
  if (readonly) {
    frontmatter.push('readonly: true');
  }
  frontmatter.push('---', '');

  return frontmatter.join('\n') + body + '\n\n' + sembleLine + '\n' + fileToolsLine + '\n';
}

function generateCursorRule(agents) {
  const agentList = agents.map(a => `\`${a.name}\` (${resolveCursorModel(a)})`).join(', ');
  const delegationRows = agents
    .map(a => `| ${a.delegationKeywords || a.delegateWhen} | \`${a.name}\` |`)
    .join('\n');

  return `---
description: Konoha multi-agent orchestration — delegate to ninja subagents via Task tool, use skills-db MCP for skills
alwaysApply: true
---

# Konoha — Cursor Orchestrator

You are the **Konoha orchestrator**. Act as coordinator only — delegate specialized work to Konoha subagents via the **Task** tool.

## Subagents (auto-loaded from \`.cursor/agents/\`)

Official team: ${agentList}

Skill packages live under \`.cursor/skills/\` (mirrored from \`~/.agents/skills/\`). Use \`skills-db\` MCP for on-demand retrieval — never load \`SKILL.md\` files directly.

Each subagent has an embedded **Cursor model** in its frontmatter. When using Task, pass \`subagent_type\` matching the agent name (e.g. \`anbu\`, \`genin\`) and include \`model\` from the subagent definition when supported.

## Mandatory workflow

1. **Skills first**: Call \`skills-db\` MCP \`find_skill\` with keywords from the user prompt (pass \`agent\` when available). Never load SKILL.md files directly.
2. **Code context**: If source code search is needed, call \`semble\` MCP (\`search\` / \`find_related\`). Never use semble for skill lookup. **Do NOT use Cursor \`Grep\`, \`Glob\`, or \`SemanticSearch\` — semble is the default search tool.**
3. **File reads**: After semble locates targets, use \`konoha-files\` MCP for reads/grep/structure — **never Cursor \`Read\`/\`Grep\`/\`Glob\` or shell \`cat\`/\`head\`/\`grep\`.**
4. **Select agent** using the table below.
5. **Delegate** via Task tool to the matching subagent. Pass skill reference names discovered in step 1.
6. **Synthesize** subagent results for the user.

| Task type | Subagent |
|-----------|----------|
${delegationRows}

${buildSembleSearchPolicy()}

${buildFileToolsPolicy()}

## Tool boundaries

- **skills-db**: \`find_skill\`, \`get_skill\`, \`list_skills\` — skills and references only
- **semble**: \`search\`, \`find_related\` — **default** for all project code search and discovery
- **konoha-files**: \`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\` — **default** for all file reads and line grep
- Never mix MCP servers for the wrong purpose
- **Forbidden for code discovery**: \`Grep\`, \`Glob\`, \`SemanticSearch\`, shell \`grep\`/\`rg\`/\`find\` (use semble first; \`rg\` only if semble MCP fails)
- **Forbidden for file reads**: Cursor \`Read\`, shell \`cat\`/\`head\`/\`tail\` (use konoha-files)

## Guardrails

- Log at response start: \`[Konoha] orchestrator active. Calling skills-db.find_skill(...)\`
- Read-only for \`.env\`, \`terraform.tfvars\`, \`secrets.yaml\` unless user approves
- Execute commands yourself; never ask the user to run verification steps
- On rate limits, retry with \`${CURSOR_FALLBACK_MODEL}\`

Full team config: \`~/.agents/AGENTS.md\`
`;
}

function buildMcpServers(pythonCmd, serverPath, uvxCmd) {
  const servers = {
    'skills-db': {
      type: 'stdio',
      command: pythonCmd,
      args: [serverPath]
    },
    semble: {
      type: 'stdio',
      command: uvxCmd,
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };
  const fileTools = deployUtils.buildKonohaFilesMcpEntry('cursor');
  if (fileTools) {
    servers['konoha-files'] = fileTools;
  }
  return servers;
}

function registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!pythonCmd || !serverPath || !fileExists(serverPath)) {
    return false;
  }

  ensureDir(CURSOR_DIR);
  let config = { mcpServers: {} };

  if (fileExists(CURSOR_MCP_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) {
        console.warn(`Skipped Cursor MCP update: invalid JSON in ${CURSOR_MCP_GLOBAL}`);
      }
      return false;
    }
  }

  const servers = buildMcpServers(pythonCmd, serverPath, uvxCmd || 'uvx');
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

  if (updated || !fileExists(CURSOR_MCP_GLOBAL)) {
    fs.writeFileSync(CURSOR_MCP_GLOBAL, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      console.log(`✓ Registered skills-db and semble in ${CURSOR_MCP_GLOBAL}`);
    }
  }
  return true;
}

function registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const mcpPath = path.join(cursorDir, 'mcp.json');
  ensureDir(cursorDir);

  let config = { mcpServers: {} };
  if (fileExists(mcpPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) {
        console.warn(`Skipped project MCP update: invalid JSON in ${mcpPath}`);
      }
      return false;
    }
  }

  const servers = buildMcpServers(
    pythonCmd,
    serverPath,
    uvxCmd || 'uvx'
  );

  // Portable project config — cross-platform JS launcher (node on PATH in Cursor/IDE)
  servers['skills-db'].args = ['${userHome}/.gemini/skills-db/server.py'];
  if (servers['konoha-files']) {
    servers['konoha-files'] = {
      type: 'stdio',
      command: 'node',
      args: ['${userHome}/.gemini/skills-db/file_tools_launcher.js']
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
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
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
  if (!config.permissions.allow) config.permissions.allow = [];

  const grants = [
    'Mcp(skills-db)',
    'Mcp(skills-db, find_skill)',
    'Mcp(skills-db, get_skill)',
    'Mcp(skills-db, list_skills)',
    'Mcp(skills-db, optimize_report)',
    'Mcp(semble)',
    'Mcp(semble, search)',
    'Mcp(semble, find_related)',
    'Mcp(konoha-files)',
    'Mcp(konoha-files, read_file_head)',
    'Mcp(konoha-files, read_file_range)',
    'Mcp(konoha-files, file_info)',
    'Mcp(konoha-files, token_efficient_grep)',
    'Mcp(konoha-files, get_file_structure)',
    'Mcp(konoha-files, find_files_clean)',
    'Shell(konoha)',
    'Shell(node bin/cli.js)',
    'Shell(node */.gemini/skills-db/cursor_bootstrap.js)'
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

function deployCursorSubagents(agents, silent = true) {
  if (!agents || agents.length === 0) return false;

  ensureDir(CURSOR_AGENTS_GLOBAL);
  let deployed = 0;

  for (const agent of agents) {
    const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
    if (!official.includes(agent.name)) continue;

    const destPath = path.join(CURSOR_AGENTS_GLOBAL, `${agent.name}.md`);
    const content = generateCursorSubagent(agent);
    let shouldWrite = true;

    if (fileExists(destPath)) {
      try {
        shouldWrite = fs.readFileSync(destPath, 'utf-8') !== content;
      } catch {
        shouldWrite = true;
      }
    }

    if (shouldWrite) {
      fs.writeFileSync(destPath, content);
      deployed++;
    }
  }

  if (!silent && deployed > 0) {
    console.log(`✓ Deployed ${deployed} Cursor subagents to ${CURSOR_AGENTS_GLOBAL}`);
  }
  return deployed > 0;
}

function deployProjectCursor(projectRoot, agents, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const agentsDir = path.join(cursorDir, 'agents');
  const rulesDir = path.join(cursorDir, 'rules');
  ensureDir(agentsDir);
  ensureDir(rulesDir);

  // Deploy subagents to project
  for (const agent of agents) {
    const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
    if (!official.includes(agent.name)) continue;
    const destPath = path.join(agentsDir, `${agent.name}.md`);
    fs.writeFileSync(destPath, generateCursorSubagent(agent));
  }

  // Deploy orchestrator rule
  const rulePath = path.join(rulesDir, 'konoha.mdc');
  fs.writeFileSync(rulePath, generateCursorRule(agents));

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
    allowHooks = true
  } = options;

  copyCursorHelperScripts(silent);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'skills-db server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent);
  registerCursorCliPermissions(silent);
  registerCursorHooks(silent, allowHooks);

  if (deployProject) {
    const root = projectRoot || process.cwd();
    try {
      registerCursorProjectMcp(root, pythonCmd, serverPath, uvxCmd, silent);
    } catch {}
  }

  deployUtils.syncCursorSkillsFromAgents({ projectRoot, deployProject, silent });

  if (agents.length > 0) {
    deployCursorSubagents(agents, silent);
    if (deployProject) {
      const root = projectRoot || process.cwd();
      try {
        deployProjectCursor(root, agents, silent);
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
        for (const name of ['skills-db', 'semble', 'konoha-files']) {
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
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const name of official) {
    const p = path.join(CURSOR_AGENTS_GLOBAL, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  // Remove sessionStart bootstrap hook
  registerCursorHooks(silent, false);
}

function getCursorStatus() {
  const status = {
    mcpGlobal: fileExists(CURSOR_MCP_GLOBAL),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonohaFiles: false,
    subagentsGlobal: 0,
    skillsGlobal: 0,
    skillsProject: 0,
    cliPermissions: false,
    hooks: false,
    projectMcp: false,
    projectRule: false,
    projectAgents: 0
  };

  if (status.mcpGlobal) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      status.mcpSkillsDb = !!(config.mcpServers && config.mcpServers['skills-db']);
      status.mcpSemble = !!(config.mcpServers && config.mcpServers['semble']);
      status.mcpKonohaFiles = !!(config.mcpServers && config.mcpServers['konoha-files']);
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
      const allows = (config.permissions && config.permissions.allow) || [];
      status.cliPermissions = allows.some(a => a.includes('skills-db'));
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
  const projectMcp = path.join(cwd, PROJECT_CURSOR_DIR, 'mcp.json');
  const projectRule = path.join(cwd, PROJECT_CURSOR_DIR, 'rules', 'konoha.mdc');
  const projectAgents = path.join(cwd, PROJECT_CURSOR_DIR, 'agents');
  const projectSkills = path.join(cwd, PROJECT_CURSOR_DIR, 'skills');

  status.projectMcp = fileExists(projectMcp);
  status.projectRule = fileExists(projectRule);
  if (fileExists(projectAgents)) {
    try {
      status.projectAgents = fs.readdirSync(projectAgents).filter(f => f.endsWith('.md')).length;
    } catch {}
  }
  if (fileExists(projectSkills)) {
    try {
      status.skillsProject = deployUtils.listSkillEntries(projectSkills).length;
    } catch {}
  }

  return status;
}

module.exports = {
  CURSOR_MCP_GLOBAL,
  CURSOR_AGENTS_GLOBAL,
  CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG,
  CURSOR_FALLBACK_MODEL,
  DEFAULT_CURSOR_MODELS,
  CURSOR_MODEL_ALIASES,
  resolveCursorModel,
  generateCursorSubagent,
  generateCursorRule,
  registerCursorMcp,
  registerCursorProjectMcp,
  registerCursorCliPermissions,
  registerCursorHooks,
  deployCursorSubagents,
  deployProjectCursor,
  ensureCursorSetup,
  removeCursorConfig,
  getCursorStatus,
  copyCursorHelperScripts
};
