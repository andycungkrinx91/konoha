'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve a shared bin/lib module defensively. Deployment layouts differ: the
 * repository keeps src/ and bin/ as siblings, while some sandboxes flatten the
 * module to a different root. A missing helper must never break startup, so
 * failures degrade to null and callers fall back to the frozen roster.
 */
function tryResolve(relativeCandidates) {
  for (const candidate of relativeCandidates) {
    try {
      return require(candidate);
    } catch (_) { /* candidate unavailable in this layout */ }
  }
  return null;
}

const yamlUtils = tryResolve(['../bin/lib/yaml_utils', './bin/lib/yaml_utils', '../../bin/lib/yaml_utils']);
const pathUtils = tryResolve(['../bin/lib/paths', './bin/lib/paths', '../../bin/lib/paths']);

const FALLBACK_AGENT_NAMES = Object.freeze([
  'sannin',
  'genin',
  'kage',
  'chunin',
  'jonin',
  'anbu',
  'tokubetsu-jonin',
  'akatsuki',
  'yamanaka'
]);

let cachedNames = null;

function normalizeAgentName(name) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim().toLowerCase().replace(/^@+/, '');
  if (!trimmed) return '';
  const collapsed = trimmed.replace(/[\s_]+/g, '-');
  return collapsed.replace(/-+/g, '-');
}

function _templatePath() {
  if (pathUtils && pathUtils.DEFAULT_AGENTS_YAML_PATH) return pathUtils.DEFAULT_AGENTS_YAML_PATH;
  return path.join(__dirname, 'templates', 'agents.yaml');
}

function readTemplateAgents() {
  const parseYaml = yamlUtils && yamlUtils.parseYaml;
  if (typeof parseYaml !== 'function') return [];
  try {
    const templatePath = _templatePath();
    if (!fs.existsSync(templatePath)) return [];
    const parsed = parseYaml(fs.readFileSync(templatePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a) => a && typeof a.name === 'string' && a.name.trim());
  } catch (_) {
    return [];
  }
}

function getCanonicalAgentNames(force = false) {
  if (!force && cachedNames !== null) return cachedNames;
  const fromTemplate = readTemplateAgents().map((a) => normalizeAgentName(a.name));
  cachedNames = fromTemplate.length > 0 ? fromTemplate : FALLBACK_AGENT_NAMES.slice();
  return cachedNames;
}

function isCanonicalAgent(name) {
  const normalized = normalizeAgentName(name);
  if (!normalized) return false;
  return getCanonicalAgentNames().includes(normalized);
}

function getCanonicalAgent(name) {
  const normalized = normalizeAgentName(name);
  if (!normalized) return null;
  return readTemplateAgents().find((a) => normalizeAgentName(a.name) === normalized) || null;
}

function getCanonicalIdentitySkills() {
  const map = new Map();
  for (const agent of readTemplateAgents()) {
    if (!Array.isArray(agent.skills) || agent.skills.length === 0) continue;
    map.set(normalizeAgentName(agent.name), agent.skills[0]);
  }
  return map;
}

function resetCanonicalAgentCache() {
  cachedNames = null;
}

const CANONICAL_NINJAS = Object.freeze([
  { name: 'sannin', icon: '🌀', title: 'Village Router & Planner', skill: 'sannin-skill' },
  { name: 'genin', icon: '🍃', title: 'Code Exploration Scout', skill: 'genin-skill' },
  { name: 'kage', icon: '⛰️', title: 'Architecture & Quality Gate', skill: 'kage-skill' },
  { name: 'chunin', icon: '📜', title: 'Deep Research', skill: 'chunin-skill' },
  { name: 'jonin', icon: '🛡️', title: 'UI & Frontend Elite', skill: 'jonin-skill' },
  { name: 'anbu', icon: '👥', title: 'Backend & DevOps', skill: 'anbu-skill' },
  { name: 'tokubetsu-jonin', icon: '⬡', title: 'Technical Writing & Scribe', skill: 'tokubetsu-jonin-skill' },
  { name: 'akatsuki', icon: '⚔️', title: 'Red-Team & Blue-Team Security', skill: 'akatsuki-skill' },
  { name: 'yamanaka', icon: '❖', title: 'Generative 3D & Spatial Subsystem', skill: 'yamanaka-skill' }
]);
const CANONICAL_AGENT_NAMES = Object.freeze(CANONICAL_NINJAS.map((a) => a.name));
const CANONICAL_AGENT_SET = Object.freeze(new Set(CANONICAL_AGENT_NAMES));
const RESIDENT_SUPERVISOR_AGENTS = Object.freeze(['advisor']);
const RESIDENT_SUPERVISOR_SET = Object.freeze(new Set(RESIDENT_SUPERVISOR_AGENTS));

const ADVISOR_AGENT_DEFINITION = Object.freeze({
  name: 'advisor',
  icon: '◎',
  title: 'Always-On Idle Foreman & Direct Steer Supervisor',
  role: 'Resident Supervisor',
  purpose: 'Idle turn-0 supervisor monitoring plan, TODO, and goal alignment across all agents and directly steering drifting agents',
  description: 'Always-on idle supervisor started from workflow begin; monitors all agents against plan, TODOs, and goals, and directly steers drifting agents.',
  delegationKeywords: 'advisor idle monitor drift supervision direct steer plan todo goal alignment',
  constraints: 'STRICT READ-ONLY idle supervision (0 tokens when compliant, <= 8,192 tokens per steer turn). Never modify codebase files or run mutating commands; review agent outputs/in-progress turns against user goal, approved plan, and active TODOs, then directly steer any drifting agent.',
  instructions: 'Log: "[◎ Advisor] idle watchdog armed." Sit idle on standby from the beginning of every session. Review every agent turn and report against the user goal, approved PLAN, active TODO list, worktree isolation, and owned_files. Consume 0 tokens when aligned (IDLE_OK). Whenever any agent drifts from the plan, TODOs, or goals, issue an immediate [ADVISOR STEER] correction directly to that agent.',
  skills: []
});

function getAdvisorAgentDefinition() {
  return {
    ...ADVISOR_AGENT_DEFINITION,
    skills: [...ADVISOR_AGENT_DEFINITION.skills]
  };
}

function isResidentSupervisorAgent(name) {
  return RESIDENT_SUPERVISOR_SET.has(normalizeAgentName(name));
}

function getDeployableAgentNames(baseNames = null) {
  const base = Array.isArray(baseNames) ? baseNames : getCanonicalAgentNames();
  const merged = [...base];
  for (const sup of RESIDENT_SUPERVISOR_AGENTS) {
    if (!merged.includes(sup)) merged.push(sup);
  }
  return merged;
}

function getDeployableAgents(agents = null) {
  const list = Array.isArray(agents) && agents.length > 0 ? [...agents] : readTemplateAgents();
  const hasAdvisor = list.some((a) => normalizeAgentName(a && a.name) === 'advisor');
  if (!hasAdvisor) {
    list.push(getAdvisorAgentDefinition());
  }
  return list;
}

module.exports = {
  FALLBACK_AGENT_NAMES,
  CANONICAL_NINJAS,
  CANONICAL_AGENT_NAMES,
  CANONICAL_AGENT_SET,
  RESIDENT_SUPERVISOR_AGENTS,
  RESIDENT_SUPERVISOR_SET,
  ADVISOR_AGENT_DEFINITION,
  getAdvisorAgentDefinition,
  isResidentSupervisorAgent,
  getDeployableAgentNames,
  getDeployableAgents,
  normalizeAgentName,
  getCanonicalAgentNames,
  isCanonicalAgent,
  getCanonicalAgent,
  getCanonicalIdentitySkills,
  resetCanonicalAgentCache
};
