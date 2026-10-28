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

const SUPPORTED_CLIENTS = [
  'antigravity',
  'cursor',
  'claude',
  'opencode',
  'commandcode',
  'codex',
  'pi',
  'omp'
];

function ensureClientSetup(client, options = {}) {
  const normClient = String(client || '').toLowerCase().trim();
  if (!SUPPORTED_CLIENTS.includes(normClient)) {
    throw new Error(`Unknown or unsupported client: ${client}. Supported clients: ${SUPPORTED_CLIENTS.join(', ')}`);
  }

  switch (normClient) {
    case 'antigravity':
      return require('./antigravity_manager').ensureAntigravitySetup(options);
    case 'cursor':
      return require('./cursor_manager').ensureCursorSetup(options);
    case 'claude':
      return require('./mcp_clients_manager').ensureClaudeCodeSetup(options);
    case 'opencode':
      return require('./opencode_manager').ensureOpenCodeSetup(options);
    case 'commandcode':
      return require('./mcp_clients_manager').ensureCommandCodeSetup(options);
    case 'codex':
      return require('./codex_manager').ensureCodexSetup(options);
    case 'pi':
      return require('./pi_manager').ensurePiSetup(options);
    case 'omp':
      return require('./omp_manager').ensureOmpSetup(options);
    default:
      throw new Error(`Unsupported client: ${normClient}`);
  }
}

function getClientStatus(client) {
  const normClient = String(client || '').toLowerCase().trim();
  switch (normClient) {
    case 'antigravity':
      return require('./antigravity_manager').getAntigravityStatus();
    case 'cursor':
      return require('./cursor_manager').getCursorStatus();
    case 'claude':
      return require('./mcp_clients_manager').getClaudeCodeStatus();
    case 'opencode':
      return require('./opencode_manager').getOpenCodeStatus();
    case 'commandcode':
      return require('./mcp_clients_manager').getCommandCodeStatus();
    case 'codex':
      return require('./codex_manager').getCodexStatus();
    case 'pi':
      return require('./pi_manager').getPiStatus();
    case 'omp':
      return require('./omp_manager').getOmpStatus();
    default:
      throw new Error(`Unknown client for status: ${client}`);
  }
}

function validateWorkflowDispatch(payload = {}) {
  const opts = (typeof payload === 'object' && payload !== null) ? payload : { task: String(payload || '') };
  const taskText = String(opts.task || opts.description || opts.prompt || opts.choice || opts.gate_action || '').trim();
  const hasTaskDir = Boolean(opts.taskDir || opts.task_dir || opts.task_id || opts.taskId);

  if (!taskText && !hasTaskDir) {
    return { ok: false, error: 'Direct structured MCP argument "task" is required.' };
  }

  if (opts.file === 'prompt.md' || opts.file === 'delegate.md' || /\b(read|check|load|process|open)\s+(prompt\.md|delegate\.md)\b/i.test(taskText)) {
    return {
      ok: false,
      reason: 'retired_file_ipc',
      error: 'File-based IPC (delegate.md / prompt.md) is retired and rejected. Pass task instructions, context, constraints, and skills via direct structured MCP arguments.'
    };
  }

  if (opts.client) {
    const normClient = String(opts.client).toLowerCase().trim();
    if (!SUPPORTED_CLIENTS.includes(normClient)) {
      return { ok: false, error: `Client "${opts.client}" is not supported. Supported clients: ${SUPPORTED_CLIENTS.join(', ')}` };
    }
  }

  return { ok: true, task: taskText };
}

function runCanonicalWorkflow(prompt, options = {}) {
  const check = validateWorkflowDispatch({ prompt, ...options });
  if (!check.ok) {
    throw new Error(check.error);
  }
  const { runSannin } = require('./mcp/workflow');
  return runSannin(prompt, options.taskDir, options.projectPath, options.sessionId, options);
}

function dispatchWorkflow(taskDir, options = {}) {
  const { runMcpWorkflow } = require('./mcp/workflow');
  return runMcpWorkflow(taskDir, options);
}

module.exports = {
  SUPPORTED_CLIENTS,
  ensureClientSetup,
  getClientStatus,
  validateWorkflowDispatch,
  runCanonicalWorkflow,
  dispatchWorkflow,
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
