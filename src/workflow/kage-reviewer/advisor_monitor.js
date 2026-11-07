'use strict';

const fs = require('fs');
const path = require('path');
const { VALIDATION_EVIDENCE_PATTERN } = require('../../mcp/workflow_common');

const MAX_ADVISOR_TURN_TOKENS = 1000;
const MAX_ADVISOR_TURN_BYTES = MAX_ADVISOR_TURN_TOKENS * 4;
const ADVISOR_MODES = Object.freeze(['realtime-idle', 'turn-gate', 'off']);

const PLACEHOLDER_SLOP_PATTERN = /\b(\x54ODO:\s*implement|\x46IXME:\s*implement|placeholder implementation|coming soon|lorem ipsum|not implemented yet)\b/i;
const CONFLICT_MARKER_PATTERN = /^(<<<<<<<|=======|>>>>>>>)(\s|$)/m;

const staleTelemetryStore = new Map();

function clampAdvisorBytes(text, maxBytes = MAX_ADVISOR_TURN_BYTES) {
  if (!text || typeof text !== 'string') return '';
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const sliced = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes - 18)).toString('utf8');
  const lastNewline = sliced.lastIndexOf('\n');
  const clean = lastNewline > Math.floor(sliced.length * 0.6) ? sliced.slice(0, lastNewline) : sliced;
  return `${clean.trimEnd()}\n...[advisor-cap]`;
}

function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.min(MAX_ADVISOR_TURN_TOKENS, Math.ceil(Buffer.byteLength(String(text), 'utf8') / 4));
}

function evictStaleAdvisorState(sessionKey) {
  if (!sessionKey) return;
  staleTelemetryStore.delete(sessionKey);
}

function _normalizeRelPath(filePath, baseDir) {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  if (!baseDir) return trimmed.replace(/\\/g, '/');
  const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed);
  const rel = path.relative(path.resolve(baseDir), abs).replace(/\\/g, '/');
  return rel;
}

function _matchesOwnedPattern(rel, pattern, effectiveBase) {
  const rawPat = String(pattern || '').trim();
  if (!rawPat) return true;
  const normPat = (path.isAbsolute(rawPat) ? _normalizeRelPath(rawPat, effectiveBase) : rawPat)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!normPat) return true;
  if (normPat.endsWith('/**') || normPat.endsWith('/*')) {
    const prefix = normPat.replace(/\/\*+$/, '');
    return rel === prefix || rel.startsWith(`${prefix}/`);
  }
  return rel === normPat || rel.endsWith(`/${normPat}`) || rel.startsWith(`${normPat}/`);
}

function _checkSingleFileBoundary(f, { ownedFiles, worktreePath, effectiveBase }) {
  const fileViolations = [];
  if (worktreePath && path.isAbsolute(f)) {
    const relToWt = path.relative(path.resolve(worktreePath), path.resolve(f));
    if (relToWt.startsWith('..') || path.isAbsolute(relToWt)) {
      fileViolations.push({
        type: 'worktree_escape',
        file: f,
        detail: `File "${f}" is outside assigned worktree "${worktreePath}".`
      });
    }
  }
  if (Array.isArray(ownedFiles) && ownedFiles.length > 0) {
    const rel = _normalizeRelPath(f, effectiveBase);
    const allowed = ownedFiles.some((pat) => _matchesOwnedPattern(rel, pat, effectiveBase));
    if (!allowed) {
      fileViolations.push({
        type: 'owned_files_breach',
        file: rel,
        detail: `Modified "${rel}" outside delegated owned_files contract (${ownedFiles.join(', ')}).`
      });
    }
  }
  return fileViolations;
}

function _checkOwnedFilesAndWorktree({ filesCreated = [], filesModified = [], ownedFiles = [], worktreePath = null, projectPath = null }) {
  const violations = [];
  const allFiles = [...(Array.isArray(filesCreated) ? filesCreated : []), ...(Array.isArray(filesModified) ? filesModified : [])];
  if (allFiles.length === 0) return violations;

  const effectiveBase = worktreePath || projectPath || process.cwd();
  for (const f of allFiles) {
    if (!f || typeof f !== 'string') continue;
    violations.push(..._checkSingleFileBoundary(f, { ownedFiles, worktreePath, effectiveBase }));
  }
  return violations;
}

function _hasConflictMarkersOnDisk(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > 512 * 1024) return false;
    return CONFLICT_MARKER_PATTERN.test(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return false;
  }
}

function _checkFabricatedAndConflictFiles({ filesCreated = [], filesModified = [], worktreePath = null, projectPath = null, checkDiskExistence = false }) {
  const violations = [];
  const baseDir = worktreePath || projectPath;
  if (!baseDir) return violations;

  const allFiles = [...(Array.isArray(filesCreated) ? filesCreated : []), ...(Array.isArray(filesModified) ? filesModified : [])];
  for (const f of allFiles) {
    if (!f || typeof f !== 'string') continue;
    const absPath = path.isAbsolute(f) ? f : path.resolve(baseDir, f);
    if (checkDiskExistence && !fs.existsSync(absPath)) {
      violations.push({
        type: 'fabricated_file',
        file: f,
        detail: `Claimed file "${f}" does not exist on disk at "${absPath}".`
      });
      continue;
    }
    if (fs.existsSync(absPath) && _hasConflictMarkersOnDisk(absPath)) {
      violations.push({
        type: 'conflict_marker',
        file: f,
        detail: `Unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) detected in "${f}".`
      });
    }
  }
  return violations;
}

function _checkTodoDrift({ delegatedTodo = '', summary = '', filesCreated = [], filesModified = [] }) {
  if (!delegatedTodo || typeof delegatedTodo !== 'string' || !summary || typeof summary !== 'string') {
    return null;
  }
  const todoLower = delegatedTodo.toLowerCase();
  const sumLower = summary.toLowerCase();
  if (/\b(instead of|skipped the requested|unrelated task|abandoned the original)\b/i.test(sumLower)) {
    return {
      type: 'todo_drift',
      detail: `Worker summary indicates deviation from delegated TODO: "${delegatedTodo.slice(0, 120)}".`
    };
  }
  const stop = new Set(['the', 'and', 'for', 'with', 'into', 'from', 'that', 'this', 'task', 'implement', 'create', 'update', 'build']);
  const keywords = todoLower
    .replace(/[^a-z0-9_./-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
  if (keywords.length === 0) return null;
  const combinedHaystack = `${sumLower} ${(filesCreated || []).join(' ').toLowerCase()} ${(filesModified || []).join(' ').toLowerCase()}`;
  const matched = keywords.filter((k) => combinedHaystack.includes(k));
  if (keywords.length >= 3 && matched.length === 0) {
    return {
      type: 'todo_drift',
      detail: `Worker output has zero keyword overlap with delegated TODO ("${delegatedTodo.slice(0, 120)}").`
    };
  }
  return null;
}

function buildInterruptCorrectionDirective({ agent, taskId, delegatedTodo, worktreePath, ownedFiles, violations = [] }) {
  const header = `[ADVISOR INTERRUPT -> @${agent || 'worker'}${taskId ? ` (${taskId})` : ''}]`;
  const vLines = violations.slice(0, 4).map((v, i) => `${i + 1}. [${v.type}] ${v.detail}`).join('\n');
  const todoLine = delegatedTodo ? `Target TODO: ${delegatedTodo.slice(0, 220)}` : 'Target TODO: Execute only the assigned task slice.';
  const wtLine = worktreePath ? `Worktree Lock: Stay strictly inside \`${worktreePath}\`.` : '';
  const ownLine = Array.isArray(ownedFiles) && ownedFiles.length > 0
    ? `Owned Files Lock: Touch ONLY ${ownedFiles.slice(0, 6).join(', ')}.`
    : '';
  const actionLine = 'Required Action: Revert out-of-scope edits immediately, complete the exact Target TODO above, run verification via `rtk`, and re-submit `konoha.report_from_agent` with real exit-code evidence.';

  const raw = [header, vLines, todoLine, wtLine, ownLine, actionLine].filter(Boolean).join('\n');
  return clampAdvisorBytes(raw, MAX_ADVISOR_TURN_BYTES);
}

function _buildIdleOkResponse(advisorMode, maxTokens) {
  return {
    status: 'IDLE_OK',
    mode: advisorMode,
    interrupted: false,
    tokens_used: 0,
    bytes_used: 0,
    budget_tokens: maxTokens,
    evict_stale_results: true,
    violations: [],
    directive: null
  };
}

/**
 * Evaluates a worker subagent's telemetry in real-time.
 * Consumes 0 tokens when idle (no active worker event or mode === 'off').
 * Hard-capped at <= 1,000 tokens (4,000 bytes) per turn when triggered.
 */
function evaluateWorkerTurn(event = {}, options = {}) {
  const advisorMode = options.advisor_mode || options.advisorMode || 'realtime-idle';
  const maxTokens = Math.min(MAX_ADVISOR_TURN_TOKENS, Number(options.advisor_max_tokens || options.advisorMaxTokens || MAX_ADVISOR_TURN_TOKENS));
  const maxBytes = maxTokens * 4;
  const sessionKey = event.sessionId || event.taskId || 'default';

  if (advisorMode === 'off' || !event || (!event.summary && !event.filesCreated && !event.filesModified && !event.validation)) {
    evictStaleAdvisorState(sessionKey);
    return _buildIdleOkResponse(advisorMode, maxTokens);
  }

  const violations = [];
  const agent = (event.agent || 'worker').replace(/_/g, '-');
  const isReadOnlyAgent = ['genin', 'chunin', 'kage'].includes(agent);

  const drift = _checkTodoDrift({
    delegatedTodo: event.delegatedTodo || event.todo || '',
    summary: event.summary || '',
    filesCreated: event.filesCreated,
    filesModified: event.filesModified
  });
  if (drift) violations.push(drift);

  const boundaryViolations = _checkOwnedFilesAndWorktree({
    filesCreated: event.filesCreated,
    filesModified: event.filesModified,
    ownedFiles: event.ownedFiles,
    worktreePath: event.worktreePath,
    projectPath: event.projectPath
  });
  violations.push(...boundaryViolations);

  const diskViolations = _checkFabricatedAndConflictFiles({
    filesCreated: event.filesCreated,
    filesModified: event.filesModified,
    worktreePath: event.worktreePath,
    projectPath: event.projectPath,
    checkDiskExistence: Boolean(event.checkDiskExistence)
  });
  violations.push(...diskViolations);

  if (event.status === 'completed' && !isReadOnlyAgent) {
    const valList = Array.isArray(event.validation) ? event.validation.filter((v) => typeof v === 'string' && v.trim()) : [];
    const hasValidMarker = valList.some((v) => VALIDATION_EVIDENCE_PATTERN.test(v));
    if (!hasValidMarker) {
      violations.push({
        type: 'unverified_claim',
        detail: 'Worker claimed status="completed" without verifiable command/exit-code validation evidence.'
      });
    }
  }

  if (event.summary && PLACEHOLDER_SLOP_PATTERN.test(event.summary)) {
    violations.push({
      type: 'placeholder_slop',
      detail: 'Worker summary contains forbidden placeholder/slop markers.'
    });
  }

  // Evict prior turn telemetry immediately (OMP evictStaleResults: true)
  evictStaleAdvisorState(sessionKey);

  if (violations.length === 0) {
    return _buildIdleOkResponse(advisorMode, maxTokens);
  }

  const rawDirective = buildInterruptCorrectionDirective({
    agent,
    taskId: event.taskId,
    delegatedTodo: event.delegatedTodo || event.todo || '',
    worktreePath: event.worktreePath,
    ownedFiles: event.ownedFiles,
    violations
  });
  const directive = clampAdvisorBytes(rawDirective, maxBytes);
  const bytesUsed = Buffer.byteLength(directive, 'utf8');
  const tokensUsed = Math.min(maxTokens, estimateTokens(directive));

  return {
    status: 'INTERRUPT_CORRECTION',
    mode: advisorMode,
    interrupted: true,
    tokens_used: tokensUsed,
    bytes_used: bytesUsed,
    budget_tokens: maxTokens,
    evict_stale_results: true,
    violations,
    directive
  };
}

module.exports = {
  MAX_ADVISOR_TURN_TOKENS,
  MAX_ADVISOR_TURN_BYTES,
  ADVISOR_MODES,
  clampAdvisorBytes,
  estimateTokens,
  evictStaleAdvisorState,
  buildInterruptCorrectionDirective,
  evaluateWorkerTurn
};
