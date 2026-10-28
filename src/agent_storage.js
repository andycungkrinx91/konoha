'use strict';

const fs = require('fs');
const path = require('path');
const platform = require('./platform_utils');
const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');
const {
  USER_AGENTS_YAML_PATH, DEFAULT_AGENTS_YAML_PATH, HOME
} = require('../bin/lib/paths');

let __cachedPython = null;
let __cachedAgents = null;
let __cachedAgentsTs = 0;
let __cachedDbSkills = null;
let __cachedDbSkillsTs = 0;
let isRegenerating = false;

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
  } catch { /* intentional best-effort fallback */ }
  return null;
}

function _setCachedAgents(agents) {
  try {
    __cachedAgentsTs = fs.statSync(USER_AGENTS_YAML_PATH).mtimeMs;
  } catch { /* intentional best-effort fallback */ }
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

function appendSubskills(item, allDbSkills, added, result) {
  if (!allDbSkills || allDbSkills.length === 0) return;
  for (const s of allDbSkills) {
    if (s.startsWith(item + '/') && !added.has(s)) {
      result.push(s);
      added.add(s);
    }
  }
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
    if (expandSubskills) appendSubskills(item, allDbSkills, added, result);
  }

  return result;
}

function _loadRawAgents() {
  let agents = [];
  let loadedFromDb = false;
  let loadedFromUser = false;

  if (fs.existsSync(USER_AGENTS_YAML_PATH)) {
    try {
      agents = parseYaml(fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8'));
      if (Array.isArray(agents) && agents.length > 0) loadedFromUser = true;
    } catch (_) { /* best-effort */ }
  }

  if (!loadedFromUser) {
    try {
      const dbAgents = require('./db_agents');
      agents = dbAgents.listAgents();
      if (agents && agents.length > 0) loadedFromDb = true;
    } catch (_) { /* best-effort */ }
  }
  return { agents: Array.isArray(agents) ? agents : [], loadedFromDb, loadedFromUser };
}

function _loadDefaults() {
  if (!fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) return [];
  try {
    const parsed = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function _mergeDefaults(agents, defaults, loadedFromUser) {
  if (defaults.length === 0) return agents;
  if (agents.length === 0) {
    try {
      const dbAgents = require('./db_agents');
      dbAgents.bulkImportAgents(defaults);
    } catch (_) { /* best-effort */ }
    return [...defaults];
  }

  const existingNames = new Set(agents.map(a => a?.name));
  let anyAdded = false;
  for (const def of defaults) {
    if (def?.name && !existingNames.has(def.name)) {
      agents.push(def);
      anyAdded = true;
    }
  }
  if (anyAdded && loadedFromUser) {
    try {
      fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(agents) + '\n', 'utf8');
    } catch (_) { /* best-effort */ }
  }
  return agents;
}

function _normalizeSingleAgentSkills(a, defAgent, allDbSkills) {
  let configuredSkills = Array.isArray(a.skills)
    ? a.skills.map(normalizeLegacySkillName).filter(s => typeof s === 'string' && !s.includes('/'))
    : [];
  if (configuredSkills.length === 0 && defAgent) {
    configuredSkills = (defAgent.skills || []).filter(s => typeof s === 'string' && !s.includes('/'));
  }

  if (defAgent?.skills && defAgent.skills.length > 0) {
    const primary = defAgent.skills[0];
    configuredSkills = configuredSkills.includes(primary)
      ? [primary, ...configuredSkills.filter(s => s !== primary)]
      : [primary, ...configuredSkills];
  }

  a.skills = allDbSkills.length === 0
    ? configuredSkills
    : getSkillsForAgentFromDb(configuredSkills, allDbSkills, false);
  return a;
}

function _upgradeAgentInstructions(a, defAgent, isAlreadyUpgraded) {
  if (typeof a.instructions === 'string' && a.instructions.length > 0) {
    const defInst = typeof defAgent.instructions === 'string' ? defAgent.instructions : '';
    const needsAgentUpgrade = /\b(?:skills-db|konoha)\.find_skill/.test(a.instructions) && !a.instructions.includes('agent=');
    const needsContextUpgrade = !a.instructions.includes('antigravity-cli/brain') && defInst.includes('antigravity-cli/brain');
    const needsCompactUpgrade = a.instructions.length > 400 && a.instructions.includes('At the start of your response, output a log line like');
    const needsSkillRoutingUpgrade = !isAlreadyUpgraded && defAgent.skills[0] && !a.instructions.includes(defAgent.skills[0]);
    const needsReferenceLoadingUpgrade = !a.instructions.includes('exact reference names') && defInst.includes('exact reference names');

    if (needsAgentUpgrade || needsContextUpgrade || needsCompactUpgrade || needsSkillRoutingUpgrade || needsReferenceLoadingUpgrade) {
      a.instructions = defAgent.instructions;
      return true;
    }
  } else if (defAgent && typeof defAgent.instructions === 'string' && defAgent.instructions.length > 0) {
    if (a.instructions !== defAgent.instructions) {
      a.instructions = defAgent.instructions;
      return true;
    }
  }
  return false;
}

function _upgradeSingleAgent(a, defAgent, isAlreadyUpgraded) {
  let changed = false;
  if (!defAgent) return changed;

  if (defAgent.skills && !isAlreadyUpgraded && Array.isArray(a.skills)) {
    defAgent.skills.forEach((skill, idx) => {
      if (!a.skills.includes(skill)) {
        if (idx === 0) a.skills.unshift(skill);
        else a.skills.push(skill);
        changed = true;
      }
    });
  }

  if (Array.isArray(a.skills)) {
    const cleanSkills = a.skills.filter(s => typeof s === 'string' && !s.includes('/'));
    if (cleanSkills.length !== a.skills.length) {
      a.skills = cleanSkills;
      changed = true;
    }
  }

  if (_upgradeAgentInstructions(a, defAgent, isAlreadyUpgraded)) changed = true;

  if (typeof a.description === 'string' && a.description.length > 200 && typeof defAgent.description === 'string') {
    a.description = defAgent.description;
    changed = true;
  }
  if (a.icon !== defAgent.icon) {
    a.icon = defAgent.icon;
    changed = true;
  }
  if (typeof defAgent.constraints === 'string') {
    if (typeof a.constraints !== 'string' || (!a.constraints.includes('semble') && defAgent.constraints.includes('semble')) || (defAgent.constraints.includes('NEVER use grep') && !a.constraints.includes('NEVER use grep'))) {
      a.constraints = defAgent.constraints;
      changed = true;
    }
  }

  if (typeof a.instructions === 'string' && a.instructions.includes('Before work: find_skill')) {
    a.instructions = a.instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
    changed = true;
  }
  return changed;
}

function _applyUpgradesAndSave(agents, defaults, loadedFromUser, silent) {
  const UPGRADED_MARKER_PATH = path.join(HOME, '.agents', '.upgraded_v1.1.1');
  let isAlreadyUpgraded = fs.existsSync(UPGRADED_MARKER_PATH);
  if (!isAlreadyUpgraded) {
    isAlreadyUpgraded = agents.some(a => {
      const defAgent = defaults.find(d => d.name === a?.name);
      return defAgent?.skills?.[0] && a.skills?.includes(defAgent.skills[0]);
    });
    if (isAlreadyUpgraded) {
      try { fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8'); } catch (_) { /* best-effort */ }
    }
  }

  let upgraded = false;
  agents = agents.map(a => {
    const defAgent = defaults.find(d => d.name === a?.name);
    if (_upgradeSingleAgent(a, defAgent, isAlreadyUpgraded)) upgraded = true;
    return a;
  });

  if (loadedFromUser && fs.existsSync(USER_AGENTS_YAML_PATH)) {
    try {
      if (fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf8').includes('/')) upgraded = true;
    } catch (_) { /* best-effort */ }
  }

  if (upgraded) {
    try { fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8'); } catch (_) { /* best-effort */ }
    saveAgents(agents);
    if (!isRegenerating) {
      isRegenerating = true;
      try {
        const agentDeployer = require('./agent_deployer');
        agentDeployer.regenerateAndDeploy({ silent });
      } catch (_) { /* best-effort */ }
      finally { isRegenerating = false; }
    }
  }
  return agents;
}

function loadAgents(reloadDefaults = false, silent = false) {
  const cached = _getCachedAgents(reloadDefaults);
  if (cached !== null) return cached;

  const { agents: rawAgents, loadedFromDb, loadedFromUser } = _loadRawAgents();
  const defaults = _loadDefaults();
  let agents = _mergeDefaults(rawAgents, defaults, loadedFromUser);

  agents = agents.filter(a => a?.name && !a.name.startsWith('mcp_'));
  const allDbSkills = _getDbSkills();

  if (agents.length > 0) {
    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a?.name);
      return _normalizeSingleAgentSkills(a, defAgent, allDbSkills);
    });
  }

  if (loadedFromDb || loadedFromUser) {
    agents = _applyUpgradesAndSave(agents, defaults, loadedFromUser, silent);
  } else if (defaults.length > 0) {
    const agentsDir = path.dirname(USER_AGENTS_YAML_PATH);
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(defaults) + '\n');
    _setCachedAgents(defaults);
    return defaults;
  }

  _setCachedAgents(agents);
  return agents;
}

function saveAgents(agents) {
  const agentsDir = path.dirname(USER_AGENTS_YAML_PATH);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  fs.writeFileSync(USER_AGENTS_YAML_PATH, stringifyYaml(agents) + '\n');

  try {
    const dbAgents = require('./db_agents');
    dbAgents.bulkImportAgents(agents);
  } catch (_) { /* intentional best-effort fallback */ }

  __cachedAgents = null;
  __cachedAgentsTs = null;
}

module.exports = {
  loadAgents,
  saveAgents,
  _getDbSkills,
  _getCachedAgents,
  _setCachedAgents,
  _getPythonCmd,
  normalizeLegacySkillName,
  getSkillsForAgentFromDb
};
