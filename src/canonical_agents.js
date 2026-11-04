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

module.exports = {
  FALLBACK_AGENT_NAMES,
  CANONICAL_NINJAS,
  CANONICAL_AGENT_NAMES,
  CANONICAL_AGENT_SET,
  normalizeAgentName,
  getCanonicalAgentNames,
  isCanonicalAgent,
  getCanonicalAgent,
  getCanonicalIdentitySkills,
  resetCanonicalAgentCache
};
