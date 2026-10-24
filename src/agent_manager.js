const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = require('./platform_utils');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const { SEMBLE_PACKAGE } = require('./semble_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
const {
  SERVER_PATH, GEMINI_MD_PATH, AGENTS_MD_PATH,
  USER_AGENTS_YAML_PATH, DEFAULT_AGENTS_YAML_PATH, 
  FINGERPRINT_PATH, DB_PATH, FILE_TOOLS_LAUNCHER_JS,
  HOME
} = require('../bin/lib/paths');

const {
  buildLightweightContract,
  buildManagedContract
} = require('./agent_contract');

let isRegenerating = false;
let __cachedPython = null; // Cache Python detection across loadAgents calls
let __cachedAgents = null; // Cache loadAgents result
let __cachedAgentsTs = 0; // File modification timestamp for cache invalidation
let __cachedDbSkills = null;
let __cachedDbSkillsTs = 0;

function _getDbSkills() {
  const { DB_PATH } = require('./db');
  const dbPath = DB_PATH;
  if (!fs.existsSync(dbPath)) return [];
  try {
    const ts = fs.statSync(dbPath).mtimeMs;
    if (__cachedDbSkills !== null && __cachedDbSkillsTs === ts) {
      return __cachedDbSkills;
    }
    const { getDb } = require('./db');
    const conn = getDb(dbPath);
    const rows = conn.prepare("SELECT DISTINCT name FROM skills").all();
    __cachedDbSkills = rows.map(r => r.name);
    __cachedDbSkillsTs = ts;
    return __cachedDbSkills;
  } catch (_) { /* intentional best-effort fallback */ }
  return [];
}

function _getCachedAgents(reloadDefaults = false) {
  if (reloadDefaults) return null;
  try {
    const ts = fs.statSync(USER_AGENTS_YAML_PATH).mtimeMs;
    if (__cachedAgents !== null && __cachedAgentsTs === ts) {
      return __cachedAgents;
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  return null;
}

function _setCachedAgents(agents) {
  try {
    __cachedAgentsTs = fs.statSync(USER_AGENTS_YAML_PATH).mtimeMs;
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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

function getSkillsForAgentFromDb(configuredSkills, allDbSkills, expandSubskills = false) {
  if (!configuredSkills || configuredSkills.length === 0) return [];
  const allowed = Array.isArray(configuredSkills) ? configuredSkills : [];

  const result = [];
  const added = new Set();

  for (const item of allowed) {
    if (!item || added.has(item)) continue;
    result.push(item);
    added.add(item);

    if (expandSubskills && allDbSkills && allDbSkills.length > 0) {
      for (const s of allDbSkills) {
        if (s.startsWith(item + '/') && !added.has(s)) {
          result.push(s);
          added.add(s);
        }
      }
    }
  }

  return result;
}

// Load agents from SQLite or YAML
function loadAgents(reloadDefaults = false, silent = false) {
  // Use cached result if file hasn't changed
  const cached = _getCachedAgents(reloadDefaults);
  if (cached !== null) return cached;

  let agents = [];
  let loadedFromDb = false;
  let loadedFromUser = false;

  if (fs.existsSync(USER_AGENTS_YAML_PATH)) {
    try {
      agents = parseYaml(fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8'));
      if (Array.isArray(agents) && agents.length > 0) {
        loadedFromUser = true;
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (!loadedFromUser) {
    try {
      const dbAgents = require('./db_agents');
      agents = dbAgents.listAgents();
      if (agents && agents.length > 0) {
        loadedFromDb = true;
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Load defaults
  let defaults = [];
  if (fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) {
    try {
      defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (defaults.length > 0) {
    if (agents.length === 0) {
      agents = defaults;
      try {
        const dbAgents = require('./db_agents');
        dbAgents.bulkImportAgents(agents);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    } else {
      const existingNames = new Set(agents.map(a => a && a.name));
      let anyAdded = false;
      for (const def of defaults) {
        if (def && def.name && !existingNames.has(def.name)) {
          agents.push(def);
          anyAdded = true;
        }
      }
      if (anyAdded && loadedFromUser) {
        try {
          fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(agents) + '\n', 'utf8');
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  }

  // Strip any legacy mcp_* agents from being loaded or exposed
  agents = agents.filter(a => a && a.name && !a.name.startsWith('mcp_'));

  // Query installed skills from SQLite database dynamically
  const allDbSkills = _getDbSkills();

  // Dynamically resolve skills for each agent based on SQLite contents
  if (agents.length > 0) {
    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      // Determine base configured skills (strip legacy expanded subskills with slashes)
      let configuredSkills = Array.isArray(a.skills) ? a.skills.map(normalizeLegacySkillName).filter(s => typeof s === 'string' && !s.includes('/')) : [];
      if (configuredSkills.length === 0 && defAgent) {
        configuredSkills = (defAgent.skills || []).filter(s => typeof s === 'string' && !s.includes('/'));
      }
      if (!Array.isArray(configuredSkills)) {
        configuredSkills = [];
      }

      // Ensure the agent's dedicated default primary skill is always first in priority
      if (defAgent && defAgent.skills && defAgent.skills.length > 0) {
        const primaryDefaultSkill = defAgent.skills[0];
        if (configuredSkills.includes(primaryDefaultSkill)) {
          configuredSkills = [
            primaryDefaultSkill,
            ...configuredSkills.filter(s => s !== primaryDefaultSkill)
          ];
        } else {
          configuredSkills.unshift(primaryDefaultSkill);
        }
      }

      if (allDbSkills.length === 0) {
        // Fallback to configured list if SQLite DB is empty/unmigrated
        a.skills = configuredSkills;
      } else {
        // Scoped to canonical skills; sub-skills retrieved dynamically on-demand
        a.skills = getSkillsForAgentFromDb(configuredSkills, allDbSkills, false);
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
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
            a.skills = a.skills.filter(s => !s.startsWith('modern-') || s === defaultSkill);
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

        // Enforce mandatory anti-slop skills across all official agents
        const MANDATORY_AGENT_ANTISLOP_SKILLS = {
          'sannin': ['antislop'],
          'genin': ['antislop', 'antislop-human', 'antislop-code'],
          'kage': ['antislop', 'antislop-human', 'antislop-code'],
          'chunin': ['antislop', 'antislop-human', 'antislop-code'],
          'jonin': ['antislop', 'antislop-ui', 'antislop-human', 'antislop-layoutmobile', 'antislop-code'],
          'anbu': ['antislop', 'antislop-human', 'antislop-code'],
          'tokubetsu-jonin': ['antislop', 'antislop-copywriting', 'antislop-human', 'antislop-code']
        };

        const mandatory = MANDATORY_AGENT_ANTISLOP_SKILLS[a.name];
        if (mandatory && Array.isArray(a.skills)) {
          for (const mSkill of mandatory) {
            if (!a.skills.includes(mSkill)) {
              a.skills.push(mSkill);
              changed = true;
            }
          }
        }

        // Strip any legacy sub-references with slashes
        if (Array.isArray(a.skills)) {
          const cleanSkills = a.skills.filter(s => typeof s === 'string' && !s.includes('/'));
          if (cleanSkills.length !== a.skills.length) {
            a.skills = cleanSkills;
            changed = true;
          }
        }

        // Always ensure instructions use the correct find_skill call for the new default skill
        if (typeof a.instructions === 'string' && a.instructions.length > 0) {
          const defInst = typeof defAgent.instructions === 'string' ? defAgent.instructions : '';
          const needsAgentUpgrade = /\b(?:skills-db|konoha)\.find_skill/.test(a.instructions) && !a.instructions.includes('agent=');
          const needsContextUpgrade = !a.instructions.includes('antigravity-cli/brain') && defInst.includes('antigravity-cli/brain');
          const needsCompactUpgrade = a.instructions.length > 400 && a.instructions.includes('At the start of your response, output a log line like');
          const needsSkillRoutingUpgrade = !isAlreadyUpgraded && defAgent.skills[0] && !a.instructions.includes(defAgent.skills[0]);
          const needsReferenceLoadingUpgrade = !a.instructions.includes('exact reference names') && defInst.includes('exact reference names');
          
          if (needsAgentUpgrade || needsContextUpgrade || needsCompactUpgrade || needsSkillRoutingUpgrade || needsReferenceLoadingUpgrade) {
            a.instructions = defAgent.instructions;
            changed = true;
          }
        } else if (defAgent && typeof defAgent.instructions === 'string' && defAgent.instructions.length > 0) {
          if (a.instructions !== defAgent.instructions) {
            a.instructions = defAgent.instructions;
            changed = true;
          }
        }

        // v1.1.0: Upgrade verbose descriptions to compact format
        if (typeof a.description === 'string' && a.description.length > 200 && typeof defAgent.description === 'string') {
          a.description = defAgent.description;
          changed = true;
        }
        if (a.icon !== defAgent.icon) {
          a.icon = defAgent.icon;
          changed = true;
        }
        if (typeof a.constraints === 'string' && typeof defAgent.constraints === 'string') {
          if (!a.constraints.includes('semble') && defAgent.constraints.includes('semble')) {
            a.constraints = defAgent.constraints;
            changed = true;
          }
          // v1.1.6: Enforce semble as default search/grep (no built-in grep/glob)
          if (defAgent.constraints.includes('NEVER use grep') && !a.constraints.includes('NEVER use grep')) {
            a.constraints = defAgent.constraints;
            changed = true;
          }
        } else if (defAgent.constraints && typeof a.constraints !== 'string') {
          a.constraints = defAgent.constraints;
          changed = true;
        }

      }

      // Sync instructions with skills moved to deployment generators
      if (typeof a.instructions === 'string' && a.instructions.includes('Before work: find_skill')) {
        a.instructions = a.instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
        changed = true;
      }

      if (changed) {
        upgraded = true;
      }
      return a;
    });
    if (loadedFromUser && fs.existsSync(USER_AGENTS_YAML_PATH)) {
      try {
        const raw = fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf8');
        if (raw.includes('/')) {
          upgraded = true;
        }
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
    if (upgraded) {
      try {
        fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8');
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      saveAgents(agents);
      if (!isRegenerating) {
        isRegenerating = true;
        try {
          regenerateAndDeploy({ silent });
        } catch (_) {
        	/* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */
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

  // 2. Write to SQLite as source of truth via bulk-import (single transaction)
  try {
    const dbAgents = require('./db_agents');
    dbAgents.bulkImportAgents(agents);
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // 3. Invalidate cache so next loadAgents reads the fresh state
  __cachedAgents = null;
  __cachedAgentsTs = null;
}

function buildDefineSubagentGuide(agents) {
  return `### Konoha MCP Tool-Based Delegation (CRITICAL)

All subagents are migrated to MCP tools served by the \`konoha\` MCP server. Rather than using custom subagent configuration structures or files, delegation is performed directly by calling the corresponding MCP tool.

The official delegation tools are: ${agents.map(a => `\`${a.name}\``).join(', ')}.


### Auto-Compaction Contract (Token Preservation across all clients)
Konoha automatically activates **High-Efficiency Auto-Compaction** after 2 MCP delegations (\`turn >= 2\`, reset after 30 min idle) across all coding tools (Antigravity IDE/CLI, Claude Code, CommandCode, OpenCode, Cursor, and Codex):
- **Memory Continuity**: Project tech stack (\`framework\`, \`styling\`, \`package_manager\`), architectural invariants, and verified episodic learnings are permanently remembered and prioritized in prompts. Advisory learnings are preserved with base importance.
- **Prompt Compaction**: Verbose instruction boilerplates and redundant diff explanations are compacted. The primary skill SOP preview (250 chars) is always included even on compact turns. Agent instructions are truncated to 1200 chars and constraints to 600 chars (never stripped entirely).
- **On-Demand Skills**: Full reference manuals are served on-demand via \`konoha.get_skill\` instead of being dumped into prompts.

### Delegation Protocol

To delegate a task:
1. **Direct Structured MCP Delegation (Mandatory & Token-Safe)**: Call the subagent MCP tool directly (for example, \`jonin\`, \`anbu\`, \`kage\`, or \`genin\`) with \`task\`, \`context\`, \`constraints\`, \`skills\`, \`taste_dials\`, and \`project_path\`. This executes inline with zero file-based IPC (never search for or write \`prompt.md\`, \`delegate.md\`, or \`result.md\`).
2. **Result Delivery**: Subagents return structured results directly to the orchestrator upon completion.

This guarantees consistent cross-client execution without relying on custom subagent configuration frameworks or files.`;
}

function buildLightweightMarkdownContent(agents, clientTitle, clientKey) {
  const roster = (agents || []).map(a => {
    const title = a.name === 'anbu' ? 'Backend, DevOps & Security' : (a.title || 'Specialist');
    return `- **@${a.name}**: ${title}`;
  }).join('\n');

  const contractText = buildLightweightContract({ client: clientKey });

  const body = `# ${clientTitle}

## Team Roster
${roster}

## Safety Guardrails
NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset\`) or view secrets (\`.env*\`).\n\n`;

  return buildManagedContract(body, contractText);
}

function generateGeminiMd(agents) {
  return buildLightweightMarkdownContent(agents, 'Global Agent Instructions', 'antigravity');
}

function generateClaudeCodeMd(agents) {
  return buildLightweightMarkdownContent(agents, 'Claude Code — Global Agent Instructions', 'claude');
}


function generateAgentsMd(agents) {
  return buildLightweightMarkdownContent(agents, 'AGENTS.md — Multi-Agent Team Configuration', 'antigravity');
}



function getCliVersion() {
  const candidatePkgPaths = [
    path.join(__dirname, '..', 'package.json'),
    path.join(HOME, '.konoha', 'package.json')
  ];
  for (const p of candidatePkgPaths) {
    if (fs.existsSync(p)) {
      try {
        const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
        if (v) return v;
      } catch (_) { /* intentional fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return '0.0.0';
}


/**
 * Injects managed Konoha configuration/instructions into a markdown file while
 * strictly preserving existing user configuration, custom instructions, and notes.
 */
function injectManagedConfig(filePath, newManagedContent, marker = 'KONOHA') {
  const startMarker = `<!-- ${marker}-START -->`;
  const endMarker = `<!-- ${marker}-END -->`;
  const wrapped = `${startMarker}\n${newManagedContent.trim()}\n${endMarker}\n`;

  let existing = '';
  if (fs.existsSync(filePath)) {
    try {
      existing = fs.readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  const trimmed = existing.trim();
  if (!trimmed) {
    return wrapped;
  }

  // If already contains managed markers, replace between them and preserve surrounding content
  const startIndex = existing.indexOf(startMarker);
  const endIndex = existing.indexOf(endMarker);
  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const before = existing.slice(0, startIndex).trim();
    const after = existing.slice(endIndex + endMarker.length).trim();
    const isBeforeKonoha = before.startsWith('# Global Agent Instructions') ||
      before.startsWith('# Antigravity') ||
      before.startsWith('# AGENTS.md') ||
      before.startsWith('# Claude Code') ||
      before.startsWith('# Gemini');
    const parts = [];
    if (before && !isBeforeKonoha) parts.push(before);
    parts.push(`${startMarker}\n${newManagedContent.trim()}\n${endMarker}`);
    if (after) parts.push(after);
    return parts.join('\n\n') + '\n';
  }

  // Check if existing content starts with Konoha headers
  const isKonohaFile = trimmed.startsWith('# Global Agent Instructions') ||
    trimmed.startsWith('# Antigravity') ||
    trimmed.startsWith('# AGENTS.md') ||
    trimmed.startsWith('# Claude Code') ||
    trimmed.startsWith('# Gemini');

  if (isKonohaFile) {
    return wrapped;
  }

  // User already had their own instructions/config before Konoha was installed.
  // Strictly preserve the user's config and inject Konoha's managed block.
  return `${trimmed}\n\n${wrapped}`;
}

// Regenerate template files and deploy them
function regenerateAndDeploy(silentOrOptions = false) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent || false);
  const pythonCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.pythonCmd || 'python3') : 'python3';
  const serverPath = typeof silentOrOptions === 'object' ? (silentOrOptions.serverPath || SERVER_PATH) : SERVER_PATH;
  const uvxCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.uvxCmd || 'uvx') : 'uvx';
  const projectRoot = typeof silentOrOptions === 'object' ? (silentOrOptions.projectRoot || null) : null;
  const deployProject = typeof silentOrOptions === 'object' ? (silentOrOptions.deployProject || false) : false;
  const force = typeof silentOrOptions === 'object' ? (silentOrOptions.force || false) : false;

  // Skip regeneration when nothing has changed since last deploy.
  // Fingerprint = CLI version + agents.yaml mtime+size — invalidates on upgrades and content edits.
  // Stored persistently because the CLI process exits between invocations.
  let fingerprint = null;
  try {
    const st = fs.statSync(USER_AGENTS_YAML_PATH);
    const cliVer = getCliVersion();
    fingerprint = `${cliVer}:${st.mtimeMs}:${st.size}`;
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(FINGERPRINT_PATH, 'utf8').trim(); } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    if (stored === fingerprint) return;
  }

  const agents = loadAgents(force);
  if (agents.length === 0) return;

  const geminiContent = generateGeminiMd(agents);
  const agentsContent = generateAgentsMd(agents);

  try {
    fs.mkdirSync(path.dirname(GEMINI_MD_PATH), { recursive: true });
    const finalGemini = injectManagedConfig(GEMINI_MD_PATH, geminiContent, 'KONOHA');
    fs.writeFileSync(GEMINI_MD_PATH, finalGemini, 'utf8');
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  try {
    fs.mkdirSync(path.dirname(AGENTS_MD_PATH), { recursive: true });
    const finalAgents = injectManagedConfig(AGENTS_MD_PATH, agentsContent, 'KONOHA');
    fs.writeFileSync(AGENTS_MD_PATH, finalAgents, 'utf8');
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
  } catch (_) {
    // Fail silently if Cursor dirs are not writable
  }

  // Deploy native Antigravity CLI MCP schemas (fixes lazy tool discovery)
  try {
    antigravityManager.ensureAntigravityMcpSchemas(agents);
  } catch (_) {
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
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

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
  } catch (_) {
    // Fail silently if Claude configs are not writable
  }

  // Deploy OpenCode setup
  try {
    const opencodeManager = require('./opencode_manager');
    opencodeManager.ensureOpenCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Deploy Codex setup
  try {
    const codexManager = require('./codex_manager');
    codexManager.ensureCodexSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Deploy Command Code setup
  try {
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Deploy Pi setup
  try {
    const piManager = require('./pi_manager');
    if (piManager.isPiInstalled()) {
      piManager.ensurePiSetup({
        pythonCmd,
        serverPath,
        uvxCmd,
        silent: true
      });
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Deploy OMP setup
  try {
    const ompManager = require('./omp_manager');
    if (ompManager.isOmpInstalled()) {
      ompManager.ensureOmpSetup({
        pythonCmd,
        serverPath,
        uvxCmd,
        silent: true
      });
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Synchronize all skills across all clients
  try {
    const skillManager = require('./skill_manager');
    skillManager.syncAllClientSkills({
      projectRoot,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Cache fingerprint so subsequent calls with unchanged agents.yaml skip the deploy.
  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(FINGERPRINT_PATH), { recursive: true });
      fs.writeFileSync(FINGERPRINT_PATH, fingerprint);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
    process.stderr.write(`✓ Generated and deployed configs to:\n${lines.join('\n')}\n`);
  }
}

/**
 * Injects all skills, rules, and MCP client configurations with the mandatory
 * Konoha runtime contract into an active or new project workspace root.
 */
function deployProjectWorkspace(projectRoot, options = {}) {
  const silent = options.silent !== false;
  const force = options.force || false;
  const targetPath = path.resolve(projectRoot || process.cwd());
  const konohaRepoRoot = path.resolve(__dirname, '..');
  if (!fs.existsSync(targetPath)) {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (_) {
      return { ok: false, error: 'Target path could not be created' };
    }
  }

  const agents = loadAgents(force);
  if (!agents || agents.length === 0) return { ok: false, error: 'No agents loaded' };

  const deployedFiles = [];

  // 1. Root AGENTS.md (full roster + mandatory Konoha runtime contract)
  try {
    const agentsPath = path.join(targetPath, 'AGENTS.md');
    const agentsContent = generateAgentsMd(agents);
    const finalAgents = injectManagedConfig(agentsPath, agentsContent, 'KONOHA');
    fs.writeFileSync(agentsPath, finalAgents, 'utf8');
    deployedFiles.push(agentsPath);
  } catch (_) { /* intentional best-effort fallback */ }

  // 2. Root GEMINI.md (Antigravity IDE & CLI instructions + mandatory contract)
  try {
    const geminiPath = path.join(targetPath, 'GEMINI.md');
    const geminiContent = generateGeminiMd(agents);
    const finalGemini = injectManagedConfig(geminiPath, geminiContent, 'KONOHA');
    fs.writeFileSync(geminiPath, finalGemini, 'utf8');
    deployedFiles.push(geminiPath);
  } catch (_) { /* intentional best-effort fallback */ }

  // 3. Root CLAUDE.md (Claude Code instructions + mandatory contract)
  try {
    const claudePath = path.join(targetPath, 'CLAUDE.md');
    const claudeContent = generateClaudeCodeMd(agents);
    const finalClaude = injectManagedConfig(claudePath, claudeContent, 'KONOHA');
    fs.writeFileSync(claudePath, finalClaude, 'utf8');
    deployedFiles.push(claudePath);
  } catch (_) { /* intentional best-effort fallback */ }

  // 4. Root .cursorrules and .cursor/rules/konoha.mdc (Cursor rules)
  try {
    const cursorRulesPath = path.join(targetPath, '.cursorrules');
    const cursorRuleContent = cursorManager.generateCursorRule(agents);
    fs.writeFileSync(cursorRulesPath, cursorRuleContent, 'utf8');
    deployedFiles.push(cursorRulesPath);

    const mdcDir = path.join(targetPath, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    const mdcPath = path.join(mdcDir, 'konoha.mdc');
    fs.writeFileSync(mdcPath, cursorRuleContent, 'utf8');
    deployedFiles.push(mdcPath);
  } catch (_) { /* intentional best-effort fallback */ }

  // 5. OMP Agent Instructions (.omp/agent/AGENTS.md and .omp/AGENTS.md)
  try {
    const ompDir = path.join(targetPath, '.omp', 'agent');
    fs.mkdirSync(ompDir, { recursive: true });
    const ompAgentsPath = path.join(ompDir, 'AGENTS.md');
    const ompAgentsContent = generateAgentsMd(agents);
    const finalOmp = injectManagedConfig(ompAgentsPath, ompAgentsContent, 'KONOHA');
    fs.writeFileSync(ompAgentsPath, finalOmp, 'utf8');
    deployedFiles.push(ompAgentsPath);

    const ompRootPath = path.join(targetPath, '.omp', 'AGENTS.md');
    fs.writeFileSync(ompRootPath, finalOmp, 'utf8');
  } catch (_) { /* intentional best-effort fallback */ }

  // 6. Codex Rules (.codex/AGENTS.md and .codex/rules/rtk.md)
  try {
    const codexDir = path.join(targetPath, '.codex');
    const codexRulesDir = path.join(codexDir, 'rules');
    fs.mkdirSync(codexRulesDir, { recursive: true });
    const codexAgentsPath = path.join(codexDir, 'AGENTS.md');
    const codexAgentsContent = generateAgentsMd(agents);
    const finalCodex = injectManagedConfig(codexAgentsPath, codexAgentsContent, 'KONOHA');
    fs.writeFileSync(codexAgentsPath, finalCodex, 'utf8');
    deployedFiles.push(codexAgentsPath);

    const codexRtkPath = path.join(codexRulesDir, 'rtk.md');
    const rtkContent = `# RTK Command Execution Policy\n\nALWAYS prefix all shell and terminal command executions with \`rtk\` to filter verbose terminal output and optimize token consumption.\n`;
    fs.writeFileSync(codexRtkPath, rtkContent, 'utf8');
    deployedFiles.push(codexRtkPath);
  } catch (_) { /* intentional best-effort fallback */ }

  // 7. MCP Configurations across all clients in the project workspace
  try {
    // A. Cursor (.cursor/mcp.json)
    cursorManager.registerCursorProjectMcp(targetPath, 'python3', SERVER_PATH, 'uvx', true);
    deployedFiles.push(path.join(targetPath, '.cursor', 'mcp.json'));

    // B. Antigravity (.gemini/antigravity-cli/settings.json and .gemini/settings.json)
    const geminiCliDir = path.join(targetPath, '.gemini', 'antigravity-cli');
    fs.mkdirSync(geminiCliDir, { recursive: true });
    const mcpServers = cursorManager.buildMcpServers('python3', SERVER_PATH, 'uvx');
    const geminiSettings = { mcpServers };
    fs.writeFileSync(path.join(geminiCliDir, 'settings.json'), JSON.stringify(geminiSettings, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.gemini', 'settings.json'), JSON.stringify(geminiSettings, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(geminiCliDir, 'settings.json'));

    // C. Claude Code (.claude/settings.json and .claude.json)
    const claudeDir = path.join(targetPath, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.claude.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(claudeDir, 'settings.json'));

    // D. Command Code (.commandcode/mcp.json)
    const ccDir = path.join(targetPath, '.commandcode');
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(path.join(ccDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(ccDir, 'mcp.json'));

    // E. OMP (.omp/agent/mcp.json and .omp/mcp.json)
    const ompAgentDir = path.join(targetPath, '.omp', 'agent');
    fs.mkdirSync(ompAgentDir, { recursive: true });
    const launcherScript = fs.existsSync(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH;
    const ompConfig = {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        konoha: {
          command: process.execPath || 'node',
          args: [launcherScript],
          type: 'stdio'
        },
        semble: {
          command: 'uvx',
          args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
          type: 'stdio'
        },
        aislop: {
          command: 'npx',
          args: ['-y', '--prefer-offline', '-p', 'aislop', 'aislop-mcp'],
          type: 'stdio'
        }
      }
    };
    fs.writeFileSync(path.join(ompAgentDir, 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.omp', 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(ompAgentDir, 'mcp.json'));
  } catch (_) { /* intentional best-effort fallback */ }

  // 8. Synchronize all skills into project mirror trees
  try {
    const skillManager = require('./skill_manager');
    skillManager.syncAllClientSkills({
      projectRoot: targetPath,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  // 9. Register or update project context in SQLite memory store
  try {
    const personaMemory = require('./persona_memory');
    const summary = options.summary || options.title || '';
    personaMemory.saveOrUpdateProject(targetPath, summary, null, DB_PATH);
  } catch (_) { /* intentional best-effort fallback */ }

  // 10. Inject into .gitignore and .dockerignore for consumer projects (exclude konoha project itself)
  const isTargetKonohaRepo = (() => {
    if (targetPath === konohaRepoRoot) return true;
    try {
      const pkgPath = path.join(targetPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'konoha-mcp' && fs.existsSync(path.join(targetPath, 'bin', 'cli.js')) && fs.existsSync(path.join(targetPath, 'scripts', 'lint.js'))) {
          return true;
        }
      }
    } catch (_) { /* intentional best-effort fallback */ }
    return false;
  })();

  if (!isTargetKonohaRepo) {
    const ignoreBlock = [
      '## Start Konoha config+skill',
      '.agents',
      '.claude*',
      '.commandcode*',
      '.cursor*',
      '.cursorrules*',
      '.gemini*',
      '.omp*',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
      '## End Konoha config+skill'
    ].join('\n');

    for (const ignoreFile of ['.gitignore', '.dockerignore']) {
      try {
        const ignorePath = path.join(targetPath, ignoreFile);
        let existing = '';
        if (fs.existsSync(ignorePath)) {
          existing = fs.readFileSync(ignorePath, 'utf8');
        }
        if (!existing.includes('## Start Konoha config+skill')) {
          const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : (existing.length > 0 ? '\n' : '');
          fs.writeFileSync(ignorePath, existing + separator + ignoreBlock + '\n', 'utf8');
          deployedFiles.push(ignorePath);
        }
      } catch (_) { /* intentional best-effort fallback */ }
    }
  }

  if (!silent) {
    process.stderr.write(`✓ Injected Konoha skills, rules, and configs with mandatory runtime contract into ${targetPath}\n`);
  }

  return { ok: true, projectPath: targetPath, deployedFiles };
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

  const displayName = lowerName.replace(/^(mcp_|_mcp_|mcp-)/, '');

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
    instructions: options.instructions || `You are the ${name} subagent. Log: "[${icon} ${name.charAt(0).toUpperCase() + name.slice(1)}] active". If delegate.md specifies exact reference names, load them via the konoha.get_skill tool. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md. ALWAYS use semble for codebase search and ensure the RTK (Rust Token Killer) principles are followed.`,
    delegationKeywords: options.delegationKeywords || name
  };

  agents.push(newAgent);
  saveAgents(agents);
  regenerateAndDeploy();
  return newAgent;
}

function findAgent(agents, name) {
  const lower = name.toLowerCase();
  const exact = agents.find(a => a.name.toLowerCase() === lower);
  if (exact) return exact;

  const searchName = lower.replace(/^(mcp_|_mcp_|mcp-)/, '');
  return agents.find(a => {
    const aName = a.name.toLowerCase();
    const aBare = aName.replace(/^(mcp_|_mcp_|mcp-)/, '');
    return aBare === searchName;
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

// Set or clear the bridge-served model assignment for a subagent.
// modelId === null clears the assignment (agent inherits the host client model).
function updateAgentModel(agentName, modelId) {
  const agents = loadAgents();
  const agent = findAgent(agents, agentName);

  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  if (modelId === null || modelId === undefined || modelId === '') {
    if (!('model' in agent) || agent.model === undefined) {
      return false; // Nothing to clear
    }
    delete agent.model;
  } else {
    if (agent.model === modelId) {
      return false; // Already assigned
    }
    agent.model = modelId;
  }

  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

const CANONICAL_OFFICIAL_NINJAS = [
  'sannin',
  'genin',
  'kage',
  'chunin',
  'jonin',
  'anbu',
  'tokubetsu-jonin'
];

function getOfficialAgentNames() {
  const names = new Set(CANONICAL_OFFICIAL_NINJAS);
  if (fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) {
    try {
      const defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
      if (Array.isArray(defaults)) {
        defaults.forEach((a) => {
          if (a && a.name) names.add(a.name.toLowerCase());
        });
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  return Array.from(names);
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
      `Subagent "${name}" is a protected official Konoha ninja agent and cannot be deleted.`
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

  try {
    const dbAgents = require('./db_agents');
    dbAgents.deleteAgent(searchName);
    dbAgents.deleteAgent(name);
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  saveAgents(filtered);
  regenerateAndDeploy();
  return true;
}

// Update a custom subagent
function updateAgent(name, updates = {}) {
  const lowerName = name.toLowerCase();
  const searchName = lowerName.replace(/^(mcp_|_mcp_|mcp-)/, '');
  const official = getOfficialAgentNames();

  const isOfficial = official.some(oName => {
    const oBare = oName.toLowerCase().replace(/^(mcp_|_mcp_|mcp-)/, '');
    return oName.toLowerCase() === lowerName || oBare === searchName;
  });

  if (isOfficial) {
    throw new Error(
      `Subagent "${name}" is a protected official Konoha ninja agent and cannot be modified directly.`
    );
  }

  const agents = loadAgents();
  const agent = agents.find(a => {
    const aName = a.name.toLowerCase();
    const aBare = aName.replace(/^(mcp_|_mcp_|mcp-)/, '');
    return aName === lowerName || aBare === searchName;
  });

  if (!agent) {
    throw new Error(`Subagent "${name}" not found.`);
  }

  if (updates.title) agent.title = String(updates.title).trim();
  if (updates.purpose) agent.purpose = String(updates.purpose).trim();
  if (updates.description) agent.description = String(updates.description).trim();
  if (updates.instructions) agent.instructions = String(updates.instructions).trim();
  if (updates.icon) agent.icon = String(updates.icon).trim();
  if (updates.model !== undefined) {
    if (updates.model) agent.model = String(updates.model).trim();
    else delete agent.model;
  }
  if (Array.isArray(updates.skills)) {
    agent.skills = updates.skills.map(s => String(s).trim()).filter(Boolean);
  }

  saveAgents(agents);
  regenerateAndDeploy();
  return agent;
}

module.exports = {
  loadAgents,
  saveAgents,
  regenerateAndDeploy,
  deployProjectWorkspace,
  createSubagent,
  updateAgent,
  embedSkill,
  unembedSkill,
  updateAgentModel,
  deleteAgent,
  buildDefineSubagentGuide,
  generateGeminiMd,
  generateAgentsMd,
  generateClaudeCodeMd,
  injectManagedConfig,
  parseYaml,
  stringifyYaml
};
