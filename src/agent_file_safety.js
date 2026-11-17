'use strict';

/**
 * src/agent_file_safety.js — Shared role classification, canonical descriptions,
 * and conflict-preserving subagent file deployment across all client harnesses.
 */

const fs = require('fs');
const path = require('path');
const { fileExists, ensureDir } = require('./platform_utils');
const { normalizeAgentName } = require('./canonical_agents');

const AGENT_OWNERSHIP_MARKER = 'generated_by: konoha';
const TOML_OWNERSHIP_MARKER = '# generated_by: konoha';

const DEFAULT_ROLE_DESCRIPTIONS = Object.freeze({
  'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
  'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
  'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
  'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
  'jonin': 'Elite builder for premium UI/frontend across modern frameworks with Tailwind v4',
  'anbu': 'Backend, DevOps, and bug-fixing specialist for APIs, databases, CI/CD, infrastructure deployment, and QA automation',
  'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports',
  'akatsuki': 'Red-team and blue-team security specialist; authorized security execution only',
  'yamanaka': 'Generative 3D and spatial specialist for Three.js/Manifold synthesis, live Blender editing, and PBR asset delivery',
  'advisor': 'Always-on idle foreman started from turn 0 to review all agent outputs against plan, TODOs, and goals and directly steer drifting agents'
});

/** True when agent must execute strictly read-only without file/command mutations. */
function isReadOnlyAgent(agent) {
  if (!agent) return false;
  const name = typeof agent === 'string'
    ? normalizeAgentName(agent)
    : normalizeAgentName(agent.name);
  if (name === 'genin' || name === 'advisor') return true;
  if (typeof agent === 'object' && /\bread-only\b/i.test(String(agent.constraints || ''))) {
    return true;
  }
  return false;
}

/** True when agent is the router orchestrator allowed to delegate to workers. */
function isRouterAgent(agent) {
  const name = typeof agent === 'string'
    ? normalizeAgentName(agent)
    : normalizeAgentName(agent && agent.name);
  return name === 'sannin';
}

function getRoleDescription(agent = {}) {
  const name = normalizeAgentName(agent.name || '');
  return DEFAULT_ROLE_DESCRIPTIONS[name]
    || agent.description
    || agent.purpose
    || agent.role
    || `${name || 'konoha'} ninja agent`;
}

/** True when a generated agent file carries Konoha's YAML or TOML ownership marker. */
function isKonohaOwnedAgentFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    // Konoha 2.2.x deployed agent files without the frontmatter marker, identifying
    // themselves only by the managed contract block in the body. Without this the
    // deploy sees its own older output as user-authored and parks every update as
    // `.konoha-proposed`, so agents stay frozen at the version that first wrote them.
    if (content.includes('<!-- KONOHA-CONTRACT-START -->')) return true;
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---', 3);
      const frontmatter = end === -1 ? content : content.slice(0, end);
      return frontmatter.split(/\r?\n/).some((line) => line.trim() === AGENT_OWNERSHIP_MARKER);
    }
    return lines.slice(0, 8).some((line) => {
      const trimmed = line.trim();
      return trimmed === TOML_OWNERSHIP_MARKER || trimmed === '<!-- generated_by: konoha -->';
    });
  } catch (_) {
    return false;
  }
}

/**
 * Checks frontmatter and managed-block markers to distinguish Konoha-owned
 * rule/config files from user-authored custom files.
 */
function isKonohaManagedRuleFile(filePath) {
  if (isKonohaOwnedAgentFile(filePath)) return true;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (
      content.includes('<!-- KONOHA-CONTRACT-START -->') ||
      content.includes('<!-- KONOHA-START -->') ||
      content.includes('<!-- generated_by: konoha -->')
    ) {
      return true;
    }
    if (
      /^# RTK - Rust Token Killer\b/m.test(content) &&
      /\*\*Usage\*\*:\s*Token-optimized CLI proxy for shell commands\./m.test(content)
    ) {
      return true;
    }
    return /^# RTK Mandatory Rule\b/m.test(content);
  } catch (_) {
    return false;
  }
}

/**
 * Shared conflict-preserving writer: keeps foreign/user-authored files intact,
 * writes a one-time `.konoha-backup`, and parks Konoha's candidate at `.konoha-proposed`.
 */
function _writeProtectedFileSafe(targetPath, content, isOwnedFn, conflictMeta = {}, options = {}) {
  ensureDir(path.dirname(targetPath));
  if (fileExists(targetPath) && !isOwnedFn(targetPath)) {
    const current = fs.readFileSync(targetPath, 'utf8');
    if (current === content) {
      return { status: 'unchanged', path: targetPath };
    }
    const backupPath = `${targetPath}.konoha-backup`;
    if (!fileExists(backupPath)) {
      fs.copyFileSync(targetPath, backupPath);
    }
    const proposedPath = `${targetPath}.konoha-proposed`;
    fs.writeFileSync(proposedPath, content, 'utf8');
    if (options.silent !== true) {
      process.stderr.write(`! Kept existing ${targetPath}; Konoha's version written to ${proposedPath}\n`);
    }
    return {
      status: 'conflict',
      ...conflictMeta,
      path: targetPath,
      backup: backupPath,
      proposed: proposedPath
    };
  }

  if (fileExists(targetPath) && fs.readFileSync(targetPath, 'utf8') === content) {
    return { status: 'unchanged', path: targetPath };
  }
  if (fileExists(targetPath) && typeof options.onBeforeOverwrite === 'function') {
    options.onBeforeOverwrite(targetPath);
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  // A file Konoha now owns may still have a candidate parked from when it was
  // misclassified; that candidate is exactly what was just written, so drop it.
  const staleProposed = `${targetPath}.konoha-proposed`;
  if (fileExists(staleProposed)) {
    try { fs.unlinkSync(staleProposed); } catch (_) { /* best effort */ }
  }
  return { status: 'written', path: targetPath };
}

/**
 * Safely writes an agent definition file without clobbering user-authored files.
 * Pre-existing foreign files stay intact, receive a one-time `.konoha-backup`,
 * and Konoha's candidate is written beside them as `.konoha-proposed`.
 */
function writeAgentFileSafe(targetPath, content, agentName, options = {}) {
  return _writeProtectedFileSafe(targetPath, content, isKonohaOwnedAgentFile, { agent: agentName }, options);
}

/**
 * Safely writes a rule/instruction file without clobbering user-authored rules.
 * Foreign files remain untouched with `.konoha-backup` and `.konoha-proposed`.
 */
function writeManagedFileSafe(targetPath, content, options = {}) {
  return _writeProtectedFileSafe(targetPath, content, isKonohaManagedRuleFile, options.meta || {}, options);
}

/**
 * Snapshots existing non-Konoha files before external CLI hooks (like `rtk init`)
 * run so user-authored rule files can never be silently overwritten.
 */
function snapshotNonKonohaRuleFiles(filePaths) {
  const snapshots = [];
  for (const p of filePaths || []) {
    if (fileExists(p) && !isKonohaManagedRuleFile(p)) {
      try {
        snapshots.push({ path: p, content: fs.readFileSync(p, 'utf8') });
      } catch (_) { /* best effort */ }
    }
  }
  return snapshots;
}

/** Restores any snapshotted user-authored files modified by external CLI tools. */
function restoreNonKonohaRuleFiles(snapshots) {
  for (const snap of snapshots || []) {
    try {
      const current = fileExists(snap.path) ? fs.readFileSync(snap.path, 'utf8') : null;
      if (current !== snap.content) {
        fs.writeFileSync(snap.path, snap.content, 'utf8');
      }
    } catch (_) { /* best effort */ }
  }
}

module.exports = {
  AGENT_OWNERSHIP_MARKER,
  TOML_OWNERSHIP_MARKER,
  DEFAULT_ROLE_DESCRIPTIONS,
  isReadOnlyAgent,
  isRouterAgent,
  getRoleDescription,
  isKonohaOwnedAgentFile,
  isKonohaManagedRuleFile,
  writeAgentFileSafe,
  writeManagedFileSafe,
  snapshotNonKonohaRuleFiles,
  restoreNonKonohaRuleFiles
};
