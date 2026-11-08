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

function buildAdvisorCoreCharter(options = {}) {
  const maxBytes = Math.min(
    MAX_ADVISOR_TURN_BYTES,
    Number(options.maxBytes || MAX_ADVISOR_TURN_BYTES)
  );
  const roleFocus = options.stage ? ` | Stage: ${options.stage}` : '';
  const charter = [
    `# @advisor Always-On Engineering Foreman Charter (<=1,000 Tokens${roleFocus})`,
    '## 1. Mission & Authority',
    '- Continuous real-time supervisor across planning, task decomposition, specialist dispatch, parallel execution, MCP tool usage, handoffs, context compaction, remediation, and Final Gate.',
    '- Authority to interrupt drift, reject fabricated evidence, enforce git worktree / owned_files boundaries, and require immediate specialist remediation.',
    '## 2. Core Supervision Invariants',
    '- Plan & Decomposition: Every requirement maps to an explicit specialist task with verifiable exit criteria and disjoint owned_files.',
    '- Parallel Isolation: Concurrent specialists operate strictly inside their assigned worktree_path and owned_files without cross-branch interference.',
    '- Evidence Over Claims: Completed tasks require concrete command/exit-code validation and existing on-disk artifacts with zero conflict markers.',
    '- Compaction Integrity: Post-Gate-1 compaction must preserve beginning, middle, and end anchors, active TODOs, and architectural constraints.',
    '- Zero-Slop Gate: Reject placeholder implementations, TODO/FIXME stubs, emojis in UI, and confidence < 98%.',
    '## 3. Dynamic On-Demand Context Retrieval Pointers',
    '- Canonical Contract: `konoha.get_skill("konoha/contract")`',
    '- Active Workflow & Checkpoints: `status.json`, `walkthrough_todos.json`, LangGraph SQLite thread state',
    '- Project Knowledge RAG: `konoha.query_project_memory` & `konoha.find_skill` (scoped by `project_hash`)'
  ].join('\n');

  const clamped = clampAdvisorBytes(charter, maxBytes);
  return {
    charter: clamped,
    bytes_used: Buffer.byteLength(clamped, 'utf8'),
    tokens_used: estimateTokens(clamped),
    budget_tokens: MAX_ADVISOR_TURN_TOKENS
  };
}

function _appendRagMemorySlice(slices, projectPath, query, status) {
  if (!projectPath && !query) return;
  try {
    const personaMemory = require('../../persona_memory');
    if (typeof personaMemory.queryMemories !== 'function') return;
    const mems = personaMemory.queryMemories({
      projectPath: projectPath || status.project_path,
      query: query || status.prompt || '',
      limit: 2
    });
    if (Array.isArray(mems) && mems.length > 0) {
      slices.push(`RAG Memory: ${mems.map((m) => `${m.title}: ${(m.content || '').slice(0, 120)}`).join(' | ')}`);
    }
  } catch (_) {
    /* best-effort RAG lookup */
  }
}

function _recordTaskOwnershipCollisions(t, seenOwned, violations) {
  if (!t || !Array.isArray(t.owned_files)) return;
  for (const f of t.owned_files) {
    const prev = seenOwned.get(f);
    if (prev && prev.id !== t.id && t.parallel_group && prev.parallel_group === t.parallel_group) {
      violations.push({
        type: 'parallel_ownership_collision',
        file: f,
        detail: `Parallel tasks "${prev.id}" and "${t.id}" share owned file "${f}".`
      });
    }
    seenOwned.set(f, { id: t.id, parallel_group: t.parallel_group });
  }
}

function retrieveAdvisorDynamicContext(params = {}) {
  const { status = {}, taskDir = '', projectPath = '', stage = 'execution', query = '' } = params;
  const slices = [];

  if (stage) {
    slices.push(`Stage: ${stage} | Phase: ${status.phase || 'unknown'} | Track: ${status.execution_track || 'full_sdlc'}`);
  }
  if (status.task_id || taskDir) {
    slices.push(`Task: ${status.task_id || path.basename(taskDir)} | Flow: ${status.flow_hash || 'none'}`);
  }
  if (status.plan && typeof status.plan === 'string') {
    const planText = status.plan.trim();
    const head = planText.slice(0, 280);
    const tail = planText.length > 320 ? planText.slice(-200) : '';
    slices.push(`Plan Anchor: ${head}${tail ? ` ... ${tail}` : ''}`);
  }
  if (Array.isArray(status.tasks) && status.tasks.length > 0) {
    const summary = status.tasks
      .slice(0, 8)
      .map((t) => `${t.id || 't'}:${t.agent || 'worker'}=${t.status || 'pending'}`)
      .join(', ');
    slices.push(`Tasks (${status.tasks.length}): ${summary}`);
  }
  _appendRagMemorySlice(slices, projectPath, query, status);

  const contextText = clampAdvisorBytes(slices.join('\n'), 1600);
  return {
    context: contextText,
    bytes_used: Buffer.byteLength(contextText, 'utf8'),
    tokens_used: estimateTokens(contextText),
    sources_consulted: ['workflow_status', 'plan_anchors', 'task_graph', 'project_rag']
  };
}

function _collectExecutionStageViolations(context, options, violations) {
  if (!context.workerEvent) return;
  const turnEval = evaluateWorkerTurn(context.workerEvent, options);
  if (turnEval.interrupted && Array.isArray(turnEval.violations)) {
    violations.push(...turnEval.violations);
  }
}

function superviseLifecycleStage(stage, context = {}, options = {}) {
  const normStage = String(stage || 'execution').toLowerCase();
  const status = context.status || {};
  const charterInfo = buildAdvisorCoreCharter({ stage: normStage });
  const dynamicCtx = retrieveAdvisorDynamicContext({
    status,
    taskDir: context.taskDir,
    projectPath: context.projectPath || status.project_path,
    stage: normStage,
    query: context.query || status.prompt
  });

  const violations = [];

  if (normStage === 'plan' || normStage === 'planning') {
    const tasks = Array.isArray(status.tasks) ? status.tasks : (Array.isArray(context.todos) ? context.todos : []);
    const seenOwned = new Map();
    for (const t of tasks) {
      _recordTaskOwnershipCollisions(t, seenOwned, violations);
    }
  } else if (normStage === 'compaction') {
    const comp = context.compaction || status.compaction || {};
    if (comp.compacted && !status.plan && !comp.checkpoint_path) {
      violations.push({
        type: 'compaction_context_loss',
        detail: 'Post-approval compaction lost plan reference without saving compact_checkpoint.json.'
      });
    }
  } else if (normStage === 'execute' || normStage === 'execution' || normStage === 'handoff') {
    _collectExecutionStageViolations(context, options, violations);
  } else if (normStage === 'review' || normStage === 'final_gate') {
    const pending = (status.tasks || []).filter((t) => t.status !== 'completed');
    if (pending.length > 0) {
      violations.push({
        type: 'incomplete_tasks_at_review',
        detail: `${pending.length} task(s) remain incomplete (${pending.map((t) => t.id).join(', ')}).`
      });
    }
    if ((status.ai_slop_findings || 0) > 0 || status.ai_slop_clean === false) {
      violations.push({
        type: 'slop_gate_violation',
        detail: `AI slop gate reported ${status.ai_slop_findings || 1} finding(s).`
      });
    }
  }

  const approved = violations.length === 0;
  const record = {
    stage: normStage,
    status: approved ? 'ADVISOR_PASS' : 'INTERRUPT_CORRECTION',
    approved,
    interrupted: !approved,
    charter_tokens: charterInfo.tokens_used,
    dynamic_context_tokens: dynamicCtx.tokens_used,
    budget_tokens: MAX_ADVISOR_TURN_TOKENS,
    violations,
    checked_at: new Date().toISOString()
  };

  if (status && typeof status === 'object') {
    status.advisor_audit_log = Array.isArray(status.advisor_audit_log) ? status.advisor_audit_log.slice(-19) : [];
    status.advisor_audit_log.push(record);
    if (normStage === 'review' || normStage === 'final_gate' || normStage === 'execute') {
      status.advisor_approved = approved;
      status.advisor_review = record;
    }
  }

  return {
    ...record,
    charter: charterInfo.charter,
    dynamic_context: dynamicCtx.context
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
  evaluateWorkerTurn,
  buildAdvisorCoreCharter,
  retrieveAdvisorDynamicContext,
  superviseLifecycleStage
};
