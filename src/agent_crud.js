'use strict';

const fs = require('fs');
const { parseYaml } = require('../bin/lib/yaml_utils');
const { DEFAULT_AGENTS_YAML_PATH } = require('../bin/lib/paths');
const { loadAgents, saveAgents } = require('./agent_storage');
const { regenerateAndDeploy } = require('./agent_deployer');

const CANONICAL_OFFICIAL_NINJAS = [
  'sannin',
  'genin',
  'kage',
  'chunin',
  'jonin',
  'anbu',
  'tokubetsu-jonin',
  'akatsuki'
];

function _loadDefaultAgentNames() {
  if (!fs.existsSync(DEFAULT_AGENTS_YAML_PATH)) return [];
  try {
    const defaults = parseYaml(fs.readFileSync(DEFAULT_AGENTS_YAML_PATH, 'utf-8'));
    if (!Array.isArray(defaults)) return [];
    return defaults.filter(a => a && a.name).map(a => a.name.toLowerCase());
  } catch (_) {
    return [];
  }
}

function getOfficialAgentNames() {
  const names = new Set(CANONICAL_OFFICIAL_NINJAS);
  for (const name of _loadDefaultAgentNames()) {
    names.add(name);
  }
  return Array.from(names);
}

function findAgent(agents, name) {
  const lowerName = name.toLowerCase();
  const searchName = lowerName.replace(/^(mcp_|_mcp_|mcp-)/, '');
  return agents.find(a => {
    const aName = a.name.toLowerCase();
    const aBare = aName.replace(/^(mcp_|_mcp_|mcp-)/, '');
    return aName === lowerName || aBare === searchName;
  });
}

function createSubagent(name, options = {}) {
  const agentNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!agentNameRegex.test(name)) {
    throw new Error(`Invalid subagent name: "${name}". Only alphanumeric characters, dashes, and underscores are allowed.`);
  }

  const agents = loadAgents();
  if (findAgent(agents, name)) {
    throw new Error(`Subagent with name "${name}" already exists.`);
  }

  const newAgent = {
    name,
    title: options.title || name,
    purpose: options.purpose || options.description || `Custom subagent: ${name}`,
    description: options.description || options.purpose || `Custom subagent: ${name}`,
    icon: options.icon || 'user',
    instructions: options.instructions || `Custom subagent ${name}. Follow system instructions and project conventions.`,
    skills: Array.isArray(options.skills) ? options.skills : []
  };

  if (options.model) {
    newAgent.model = String(options.model).trim();
  }

  agents.push(newAgent);
  saveAgents(agents);
  regenerateAndDeploy();

  return newAgent;
}

function embedSkill(agentName, skillName) {
  const agents = loadAgents();
  const agent = findAgent(agents, agentName);

  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  if (agent.skills.includes(skillName)) {
    return false;
  }

  agent.skills.push(skillName);
  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

function unembedSkill(agentName, skillName) {
  const agents = loadAgents();
  const agent = findAgent(agents, agentName);

  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  const idx = agent.skills.indexOf(skillName);
  if (idx === -1) {
    return false;
  }

  agent.skills.splice(idx, 1);
  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

function updateAgentModel(agentName, modelId) {
  const agents = loadAgents();
  const agent = findAgent(agents, agentName);

  if (!agent) {
    throw new Error(`Subagent "${agentName}" not found.`);
  }

  if (modelId === null || modelId === undefined || modelId === '') {
    if (!('model' in agent) || agent.model === undefined) {
      return false;
    }
    delete agent.model;
  } else {
    if (agent.model === modelId) {
      return false;
    }
    agent.model = modelId;
  }

  saveAgents(agents);
  regenerateAndDeploy();
  return true;
}

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
  } catch (_) { /* intentional best-effort fallback */ }

  saveAgents(filtered);
  regenerateAndDeploy();
  return true;
}

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
  CANONICAL_OFFICIAL_NINJAS,
  createSubagent,
  findAgent,
  embedSkill,
  unembedSkill,
  updateAgentModel,
  getOfficialAgentNames,
  deleteAgent,
  updateAgent
};
