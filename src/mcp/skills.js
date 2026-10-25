'use strict';

/**
 * Konoha MCP Skills Subsystem (Facade)
 * Modularized into:
 * - src/mcp/skills_common.js
 * - src/mcp/skills_search.js
 * - src/mcp/skills_retrieval.js
 */

const {
  normalizeLegacySkillName,
  contentHash,
  levenshtein,
  fuzzyResolveSkill,
  smartTruncate,
  findInMirror,
  logToolCall
} = require('./skills_common');

const {
  autoDetectSkills,
  autoMigrateProjectSkills,
  querySkillsByKeyword,
  clearSkillQueryCache,
  findSkill,
  listSkills,
  getAgentSkills
} = require('./skills_search');

const {
  getSkill,
  useSkills,
  optimizeReport
} = require('./skills_retrieval');

module.exports = {
  findSkill,
  clearSkillQueryCache,
  listSkills,
  findInMirror,
  getSkill,
  useSkills,
  optimizeReport,
  getAgentSkills,
  fuzzyResolveSkill,
  levenshtein,
  contentHash,
  smartTruncate,
  autoMigrateProjectSkills,
  autoDetectSkills,
  normalizeLegacySkillName,
  logToolCall,
  querySkillsByKeyword
};
