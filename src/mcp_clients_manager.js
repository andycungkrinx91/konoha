'use strict';

/**
 * Konoha MCP Client Subsystems Manager (Facade)
 * Modularized into:
 * - src/mcp_clients/common.js
 * - src/mcp_clients/claude_code.js
 * - src/mcp_clients/command_code.js
 *
 * Permission Grants Reference:
 * mcp__konoha__*
 * mcp__semble__*
 * Shell(rtk *)
 */

const {
  CLAUDE_JSON,
  COMMANDCODE_JSON,
  CLAUDE_SETTINGS,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isCommandCodeInstalled,
  buildStdioMcpServers,
  initRtkHook,
  resolveRtkRuleTemplate,
  buildClientToolGrants,
  mergeJsonFile,
  backupFile
} = require('./mcp_clients/common');

const { isRtkInstalled } = require('./platform_utils');

const {
  deployClaudeCodeRtkRule,
  registerClaudeCodeGlobalMcp,
  registerClaudeCodePermissions,
  registerClaudeCodeNativeBlocker,
  buildClaudeCodeBashGuardSource,
  registerClaudeCodeBashGuard,
  registerClaudeCodeWorkflowReminder,
  deployClaudeCodeRules,
  adaptInstructionsForClaudeCode,
  generateClaudeCodeSubagent,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  ensureClaudeCodeSetup,
  getClaudeCodeStatus,
  removeClaudeCodeConfig
} = require('./mcp_clients/claude_code');

const {
  deployCommandCodeRtkRule,
  registerCommandCodeGlobalMcp,
  registerCommandCodePermissions,
  ensureCommandCodeSetup,
  buildCommandCodeBlockerSource,
  registerCommandCodeNativeBlocker,
  deployCommandCodeRules,
  getCommandCodeStatus,
  removeCommandCodeConfig
} = require('./mcp_clients/command_code');

module.exports = {
  CLAUDE_JSON,
  COMMANDCODE_JSON,
  CLAUDE_SETTINGS,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isCommandCodeInstalled,
  registerClaudeCodeWorkflowReminder,
  isRtkInstalled,
  buildStdioMcpServers,
  registerClaudeCodeGlobalMcp,
  registerCommandCodeGlobalMcp,
  registerCommandCodePermissions,
  registerCommandCodeNativeBlocker,
  buildCommandCodeBlockerSource,
  buildClaudeCodeBashGuardSource,
  registerClaudeCodeBashGuard,
  registerClaudeCodePermissions,
  registerClaudeCodeNativeBlocker,
  deployClaudeCodeRules,
  deployClaudeCodeRtkRule,
  deployCommandCodeRtkRule,
  deployCommandCodeRules,
  initRtkHook,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  ensureClaudeCodeSetup,
  ensureCommandCodeSetup,
  getClaudeCodeStatus,
  getCommandCodeStatus,
  removeClaudeCodeConfig,
  removeCommandCodeConfig,
  generateClaudeCodeSubagent,
  resolveRtkRuleTemplate,
  buildClientToolGrants,
  mergeJsonFile,
  backupFile,
  adaptInstructionsForClaudeCode
};
