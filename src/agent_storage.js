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

function loadAgents(reloadDefaults = false, silent = false) {
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
    } catch (_) { /* intentional best-effort fallback */ }
  }

  if (!loadedFromUser) {
    try {
      const dbAgents = require('./db_agents');
      agents = dbAgents.listAgents();
      if (agents && agents.length > 0) {
        loadedFromDb = true;
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  let defaults = [];
  if (fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) {
    try {
      defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    } catch (_) { /* intentional best-effort fallback */ }
  }

  if (defaults.length > 0) {
    if (agents.length === 0) {
      agents = defaults;
      try {
        const dbAgents = require('./db_agents');
        dbAgents.bulkImportAgents(agents);
      } catch (_) { /* intentional best-effort fallback */ }
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
        } catch (_) { /* intentional best-effort fallback */ }
      }
    }
  }

  agents = agents.filter(a => a && a.name && !a.name.startsWith('mcp_'));

  const allDbSkills = _getDbSkills();

  if (agents.length > 0) {
    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      let configuredSkills = Array.isArray(a.skills) ? a.skills.map(normalizeLegacySkillName).filter(s => typeof s === 'string' && !s.includes('/')) : [];
      if (configuredSkills.length === 0 && defAgent) {
        configuredSkills = (defAgent.skills || []).filter(s => typeof s === 'string' && !s.includes('/'));
      }
      if (!Array.isArray(configuredSkills)) {
        configuredSkills = [];
      }

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
        a.skills = configuredSkills;
      } else {
        a.skills = getSkillsForAgentFromDb(configuredSkills, allDbSkills, false);
      }
      return a;
    });
  }

  if (loadedFromDb || loadedFromUser) {
    let upgraded = false;
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
        } catch (_) { /* intentional best-effort fallback */ }
      }
    }

    agents = agents.map(a => {
      const defAgent = defaults.find(d => d.name === a.name);
      let changed = false;
      if (defAgent) {
        if (a.skills && !isAlreadyUpgraded) {
          const legacyBundledSkills = ['devsecops-engineer', 'websearch-deep', 'documentation'];
          let changedSkills = false;
          
          const defaultSkill = defAgent.skills[0];
          if (defaultSkill && !a.skills.includes(defaultSkill)) {
            a.skills.unshift(defaultSkill);
            changedSkills = true;

            legacyBundledSkills.forEach(old => {
              const idx = a.skills.indexOf(old);
              if (idx !== -1) {
                a.skills.splice(idx, 1);
              }
            });
            a.skills = a.skills.filter(s => !s.startsWith('modern-') || s === defaultSkill);
          }
          
          if (changedSkills) {
            changed = true;
          }
        }

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

        if (Array.isArray(a.skills)) {
          const cleanSkills = a.skills.filter(s => typeof s === 'string' && !s.includes('/'));
          if (cleanSkills.length !== a.skills.length) {
            a.skills = cleanSkills;
            changed = true;
          }
        }

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
          if (defAgent.constraints.includes('NEVER use grep') && !a.constraints.includes('NEVER use grep')) {
            a.constraints = defAgent.constraints;
            changed = true;
          }
        } else if (defAgent.constraints && typeof a.constraints !== 'string') {
          a.constraints = defAgent.constraints;
          changed = true;
        }
      }

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
      } catch (_) { /* intentional best-effort fallback */ }
    }

    if (upgraded) {
      try {
        fs.writeFileSync(UPGRADED_MARKER_PATH, 'true', 'utf-8');
      } catch (_) { /* intentional best-effort fallback */ }
      saveAgents(agents);
      if (!isRegenerating) {
        isRegenerating = true;
        try {
          const agentDeployer = require('./agent_deployer');
          agentDeployer.regenerateAndDeploy({ silent });
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
