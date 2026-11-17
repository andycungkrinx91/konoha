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

const ADVISOR_EXTRA_BLOCKED_TOOLS = Object.freeze([
  'sannin',
  'aislop_fix',
  'aislop_baseline'
]);

const READONLY_ENFORCED_AGENTS = new Set(['genin', 'advisor']);

const GENIN_CODE_INDEX_MAX_FILES = 5000;
const GENIN_CODE_INDEX_TIMEOUT_MS = 30000;

function normalizeAgentName(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/^@/, '').replace(/_/g, '-');
}

function _isEnforcedReadOnly(agent) {
  return READONLY_ENFORCED_AGENTS.has(normalizeAgentName(agent));
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
  // Active read-only sessions (@genin / @advisor) remain pinned even if args override agent
  if (_isEnforcedReadOnly(detected)) return detected;
  const explicit = safeArgs.agent || safeArgs.agent_name;
  if (explicit) {
    const explicitNorm = normalizeAgentName(explicit);
    // Prevent a detected non-akatsuki session from self-elevating to @akatsuki via args
    if (explicitNorm === 'akatsuki' && detected && detected !== 'akatsuki') {
      return detected;
    }
    return explicitNorm;
  }
  return detected;
}

function checkGeninToolAccess(toolName, args = {}, detectFn = null) {
  const isBlockedGenin = GENIN_BLOCKED_TOOLS.includes(toolName);
  const isBlockedAdvisor = isBlockedGenin || ADVISOR_EXTRA_BLOCKED_TOOLS.includes(toolName);
  const needsGuard = toolName === 'code_index' || isBlockedAdvisor;
  const safeArgs = args && typeof args === 'object' ? args : {};
  const hasExplicit = Boolean(safeArgs.agent || safeArgs.agent_name);
  const agent = (hasExplicit || needsGuard) ? resolveAgentIdentity(safeArgs, detectFn) : '';
  if ((agent === 'genin' && isBlockedGenin) || (agent === 'advisor' && isBlockedAdvisor)) {
    return {
      allowed: false,
      agent,
      error: `Permission denied: @${agent} is in strict read-only mode and cannot call '${toolName}'. Use read-only exploration or delegate to anbu/tokubetsu-jonin.`
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
  if (toolName !== 'code_index' || !_isEnforcedReadOnly(agent)) {
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
  ADVISOR_EXTRA_BLOCKED_TOOLS,
  GENIN_CODE_INDEX_MAX_FILES,
  GENIN_CODE_INDEX_TIMEOUT_MS,
  normalizeAgentName,
  resolveAgentIdentity,
  checkGeninToolAccess,
  applyGeninCodeIndexBounds
};
