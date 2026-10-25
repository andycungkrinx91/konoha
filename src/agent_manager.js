'use strict';

/**
 * Konoha Subagent Architecture Manager (Facade)
 * Modularized into:
 * - src/agent_storage.js
 * - src/agent_deployer.js
 * - src/agent_crud.js
 */

const { parseYaml, stringifyYaml } = require('../bin/lib/yaml_utils');

const {
  loadAgents,
  saveAgents,
  _getDbSkills,
  _getCachedAgents,
  _setCachedAgents,
  _getPythonCmd,
  normalizeLegacySkillName,
  getSkillsForAgentFromDb
} = require('./agent_storage');

const {
  buildDefineSubagentGuide,
  buildLightweightMarkdownContent,
  generateGeminiMd,
  generateClaudeCodeMd,
  generateAgentsMd,
  getCliVersion,
  injectManagedConfig,
  regenerateAndDeploy,
  deployProjectWorkspace
} = require('./agent_deployer');

const {
  createSubagent,
  findAgent,
  embedSkill,
  unembedSkill,
  updateAgentModel,
  getOfficialAgentNames,
  deleteAgent,
  updateAgent
} = require('./agent_crud');

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
  findAgent,
  getOfficialAgentNames,
  buildDefineSubagentGuide,
  buildLightweightMarkdownContent,
  generateGeminiMd,
  generateAgentsMd,
  generateClaudeCodeMd,
  injectManagedConfig,
  getCliVersion,
  parseYaml,
  stringifyYaml,
  _getDbSkills,
  _getCachedAgents,
  _setCachedAgents,
  _getPythonCmd,
  normalizeLegacySkillName,
  getSkillsForAgentFromDb
};
