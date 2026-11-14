'use strict';

const GENIN_BLOCKED_TOOLS = Object.freeze([
  'document_create',
  'spreadsheet_create',
  'presentation_create',
  'diagram_create',
  'animation_export',
  'code_remove',
  'save_project_context',
  'save_persona_memory',
  'delete_persona_memory',
  'migrate_skills',
  'qa_codify',
  'akatsuki_init'
]);

const GENIN_CODE_INDEX_MAX_FILES = 5000;
const GENIN_CODE_INDEX_TIMEOUT_MS = 30000;

function normalizeAgentName(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/^@/, '').replace(/_/g, '-');
}

function _defaultDetectAgent() {
  try {
    const { detectActiveAgent } = require('./client_detection');
    return typeof detectActiveAgent === 'function' ? detectActiveAgent() : '';
  } catch {
    return '';
  }
}

function resolveAgentIdentity(args = {}, detectFn = null) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  const detectedRaw = typeof detectFn === 'function' ? detectFn() : _defaultDetectAgent();
  const detected = normalizeAgentName(detectedRaw);
  // Active @genin sessions remain pinned to read-only mode even if args override agent
  if (detected === 'genin') return 'genin';
  const explicit = safeArgs.agent || safeArgs.agent_name;
  if (explicit) return normalizeAgentName(explicit);
  return detected;
}

function checkGeninToolAccess(toolName, args = {}, detectFn = null) {
  const needsGuard = toolName === 'code_index' || GENIN_BLOCKED_TOOLS.includes(toolName);
  const safeArgs = args && typeof args === 'object' ? args : {};
  const hasExplicit = Boolean(safeArgs.agent || safeArgs.agent_name);
  const agent = (hasExplicit || needsGuard) ? resolveAgentIdentity(safeArgs, detectFn) : '';
  if (agent === 'genin' && GENIN_BLOCKED_TOOLS.includes(toolName)) {
    return {
      allowed: false,
      agent,
      error: `Permission denied: @genin is in strict read-only mode and cannot call '${toolName}'. Use read-only exploration or delegate to anbu/tokubetsu-jonin.`
    };
  }
  return { allowed: true, agent, error: null };
}

function _clampPositiveBound(value, maxAllowed) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.min(num, maxAllowed);
  return maxAllowed;
}

function applyGeninCodeIndexBounds(toolName, args = {}, agent = '') {
  if (toolName !== 'code_index' || normalizeAgentName(agent) !== 'genin') {
    return args;
  }
  const safeArgs = args && typeof args === 'object' ? args : {};
  return {
    ...safeArgs,
    max_files: _clampPositiveBound(safeArgs.max_files, GENIN_CODE_INDEX_MAX_FILES),
    timeout_ms: _clampPositiveBound(safeArgs.timeout_ms, GENIN_CODE_INDEX_TIMEOUT_MS)
  };
}

module.exports = {
  GENIN_BLOCKED_TOOLS,
  GENIN_CODE_INDEX_MAX_FILES,
  GENIN_CODE_INDEX_TIMEOUT_MS,
  normalizeAgentName,
  resolveAgentIdentity,
  checkGeninToolAccess,
  applyGeninCodeIndexBounds
};
