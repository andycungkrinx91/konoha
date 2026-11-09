/**
 * Red-skill classification, the fail-closed authorization gate, and the
 * main-vs-lab DB path boundary. No env var, option, or parameter may bypass
 * red-skill authorization.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeAgentName } = require('./canonical_agents');

const SKILL_AUTHORIZATION_DENIED = 'SKILL_AUTHORIZATION_DENIED';
const LAB_DB_ISOLATION_VIOLATION = 'LAB_DB_ISOLATION_VIOLATION';

const RED_SKILLS = Object.freeze(new Set(['akatsuki-skill']));
// Roots match on a boundary so namespaced/derived rows stay red:
//   akatsuki-skill, akatsuki-skill/<ref>, akatsuki-skill@global-<harness>,
//   akatsuki-skill@proj-<hash>, akatsuki-skill-fixture
const RED_SKILL_ROOTS = Object.freeze(['akatsuki-skill']);
const RED_SKILL_ROOT_PATTERN = /^(?:akatsuki-skill)(?:[-_/@]|$)/;
const RED_MODE_AGENTS = Object.freeze(new Set(['akatsuki']));
const RED_SKILL_PREFIXES = Object.freeze(['pentest', 'patch-diff-exploit']);
const RED_SKILL_PATTERN = /^(?:pentest|patch-diff-exploit)(?:[-_/]|$)/;
const RED_SKILL_TAGS = Object.freeze(['red-team', 'pentest', 'offensive']);

const DEFAULT_LAB_DIR_NAME = 'akatsuki-lab';

function _normalizeTags(tags) {
  if (!tags) return [];
  const raw = Array.isArray(tags) ? tags : String(tags).split(/[,;\s]+/);
  return raw
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Classify a skill as red (offensive/privileged, lab-required) or blue.
 *
 * @param {string} skillName
 * @param {string[]|string} [tags]
 * @returns {{red: boolean, mode: 'red'|'blue', requires_lab: boolean, reason: string|null}}
 */
function classifySkill(skillName, tags) {
  const normalized = normalizeAgentName(skillName);
  const tagList = _normalizeTags(tags);

  let red = false;
  if (normalized && RED_SKILLS.has(normalized)) {
    red = true;
  } else if (normalized && RED_SKILL_ROOT_PATTERN.test(normalized)) {
    red = true;
  } else if (normalized && RED_SKILL_PATTERN.test(normalized)) {
    red = true;
  } else if (tagList.some((t) => RED_SKILL_TAGS.includes(t))) {
    red = true;
  }

  if (!red) {
    return { red: false, mode: 'blue', requires_lab: false, reason: null };
  }
  return {
    red: true,
    mode: 'red',
    requires_lab: true,
    reason: `Skill "${skillName}" is classified red (offensive/privileged) and requires the akatsuki-lab sandbox.`
  };
}

function _resolveIdentity(params) {
  const raw = params && (params.agentName || params.agent_name);
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  try {
    const detection = require('./mcp/client_detection');
    if (detection && typeof detection.detectActiveAgent === 'function') {
      const detected = detection.detectActiveAgent();
      if (typeof detected === 'string' && detected.trim()) return detected.trim();
      if (detected && typeof detected.agent === 'string' && detected.agent.trim()) return detected.agent.trim();
    }
  } catch (_) {
    /* detection unavailable: identity stays null, red skills fail closed */
  }
  return null;
}

/**
 * Authorize access to a skill for a given identity.
 *
 * @param {{skill?: string, skillName?: string, tags?: string[]|string,
 *          agentName?: string, agent_name?: string, via?: string}} params
 * @returns {{authorized: boolean, code?: string, reason?: string, identity: string|null}}
 */
function authorizeSkillAccess(params) {
  const opts = params || {};
  const skillName = opts.skillName || opts.skill || '';
  const classification = classifySkill(skillName, opts.tags);
  const identity = _resolveIdentity(opts);
  const normalizedIdentity = normalizeAgentName(identity || '');

  if (!classification.red) {
    return { authorized: true, identity };
  }

  if (!normalizedIdentity) {
    return {
      authorized: false,
      code: SKILL_AUTHORIZATION_DENIED,
      identity: null,
      reason: 'No authenticated agent identity; red skills require @akatsuki.'
    };
  }

  if (!RED_MODE_AGENTS.has(normalizedIdentity)) {
    return {
      authorized: false,
      code: SKILL_AUTHORIZATION_DENIED,
      identity,
      reason: 'Agents other than @akatsuki may never invoke red skills. Red execution requires isolated akatsuki-lab dispatch by @akatsuki.'
    };
  }

  return { authorized: true, identity };
}

/**
 * Stable, JSON-serializable denial payload.
 */
function authorizationDeniedResult(authResult, skillName) {
  const res = authResult || {};
  return {
    error: SKILL_AUTHORIZATION_DENIED,
    code: SKILL_AUTHORIZATION_DENIED,
    skill: String(skillName == null ? '' : skillName),
    identity: res.identity || null,
    reason: res.reason || 'Red skills require @akatsuki.',
    requires_lab: true,
    remediation: 'Red skills are reserved for @akatsuki inside akatsuki-lab. Delegate the security task to @akatsuki (workflow_type: "red_team").'
  };
}

function getMainDbPath() {
  const override = process.env.KONOHA_DB_PATH;
  if (override && String(override).trim()) return path.resolve(override);
  return path.join(os.homedir(), '.konoha', 'konoha.db');
}

function getLabDbDir() {
  const override = process.env.KONOHA_LAB_DB_ROOT;
  if (override && String(override).trim()) return path.resolve(override);
  return path.join(os.homedir(), '.konoha', DEFAULT_LAB_DIR_NAME);
}

/**
 * True when p resolves strictly inside the lab DB root and is not the main DB.
 */
function isLabDbPath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  const target = path.resolve(p);
  if (target === getMainDbPath()) return false;
  const root = getLabDbDir();
  const rel = path.relative(root, target);
  if (!rel) return false;
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

function assertLabDbPath(p) {
  if (isLabDbPath(p) && !_escapesViaSymlink(p)) return;
  const err = new Error(
    `Lab DB writes are restricted to ${getLabDbDir()}; got ${p}.`
  );
  err.code = LAB_DB_ISOLATION_VIOLATION;
  throw err;
}

/**
 * True when p, resolved through the longest existing prefix, leaves the lab
 * root. A symlink inside the lab root pointing at the main DB would otherwise
 * satisfy the lexical containment check.
 */
function _escapesViaSymlink(p) {
  const realTarget = _realizeExistingPrefix(p);
  if (realTarget === _realizeExistingPrefix(getMainDbPath())) return true;
  const realRoot = _realizeExistingPrefix(getLabDbDir());
  if (realTarget === realRoot) return true;
  const rel = path.relative(realRoot, realTarget);
  if (!rel || path.isAbsolute(rel)) return true;
  return rel === '..' || rel.startsWith(`..${path.sep}`);
}

/**
 * Resolve symlinks on the longest existing prefix of p and re-append the
 * components that do not exist yet, so a lab root that has never been created
 * still compares correctly. Uses lstat so a dangling symlink counts as
 * existing; an unresolvable prefix fails closed instead of being treated as
 * an ordinary new directory.
 */
function _realizeExistingPrefix(p) {
  const resolved = path.resolve(p);
  const missing = [];
  let probe = resolved;
  for (;;) {
    if (_lexists(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) return resolved;
    missing.unshift(path.basename(probe));
    probe = parent;
  }
  let real;
  try {
    real = fs.realpathSync(probe);
  } catch (err) {
    const violation = new Error(
      `Lab DB path cannot be resolved (dangling symlink or unreadable prefix): ${probe} (${err.code || err.message})`
    );
    violation.code = LAB_DB_ISOLATION_VIOLATION;
    throw violation;
  }
  return missing.length ? path.join(real, ...missing) : real;
}

function _lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    return err.code !== 'ENOENT' && err.code !== 'ENOTDIR';
  }
}

module.exports = {
  SKILL_AUTHORIZATION_DENIED,
  LAB_DB_ISOLATION_VIOLATION,
  RED_SKILLS,
  RED_SKILL_ROOTS,
  RED_MODE_AGENTS,
  RED_SKILL_PREFIXES,
  RED_SKILL_TAGS,
  classifySkill,
  authorizeSkillAccess,
  authorizationDeniedResult,
  getMainDbPath,
  getLabDbDir,
  isLabDbPath,
  assertLabDbPath
};
