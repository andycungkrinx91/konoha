'use strict';

/**
 * Konoha MCP Subsystem - Memory, Context, Reporting & Subagent Execution (Facade)
 * Modularized into:
 * - src/mcp/memory_project_context.js
 * - src/mcp/memory_subagent_runner.js
 */

const {
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory
} = require('./memory_project_context');

const {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  buildSubagentMcpBlock,
  truncateAtBoundary,
  cleanRedundantPersonaText,
  runMcpAgent
} = require('./memory_subagent_runner');

module.exports = {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  buildSubagentMcpBlock,
  truncateAtBoundary,
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  cleanRedundantPersonaText,
  runMcpAgent
};
