'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { logToolCall } = require('./skills');
const sharedContext = require('./shared_context');
const {
  getResolvedTaskDir,
  loadWorkflowStatus,
  saveWorkflowStatus,
  VALIDATION_EVIDENCE_PATTERN
} = require('./workflow');
const {
  applyAgentReportToTodos,
  syncTodoAndWalkthrough,
  formatTodoSyncBlock
} = require('./todo_walkthrough_sync');

function assessValidationEvidence(validation) {
  if (!validation || !Array.isArray(validation)) {
    return { verified: false, reason: 'no validation evidence provided' };
  }
  const evidence = validation.filter(v => typeof v === 'string' && v.trim());
  if (evidence.length === 0) {
    return { verified: false, reason: 'validation evidence is empty' };
  }
  for (const entry of evidence) {
    if (VALIDATION_EVIDENCE_PATTERN.test(entry)) {
      return { verified: true, reason: 'validation evidence contains a passing command/exit-code marker' };
    }
  }
  return {
    verified: false,
    reason: "validation entries contain no command/exit-code evidence (expected entries like 'npm run build exited 0' or 'pytest: 12 passed')"
  };
}

function _parseReportOptions(agentName, summary, status, filesCreated, rest) {
  let [filesModified = null, learnings = null, projectPath = null, taskDir = null, dispatchId = null, validation = null, taskId = null] = rest;
  if (agentName && typeof agentName === 'object') {
    const opts = agentName;
    return {
      // `??` not `||`: an empty agent is a legitimate "unresolved" value that the
      // positional path already passes through; collapsing it to undefined makes
      // _updateWorkflowStatus call .replace on nothing.
      agentName: opts.agent ?? opts.agentName ?? opts.agent_name ?? '',
      summary: opts.summary || opts.task || '',
      status: opts.status || 'completed',
      filesCreated: opts.filesCreated || opts.files_created || opts.deliverables || null,
      filesModified: opts.filesModified || opts.files_modified || null,
      learnings: opts.learnings || null,
      projectPath: opts.projectPath || opts.project_path || null,
      taskDir: opts.taskDir || opts.task_dir || null,
      dispatchId: opts.dispatchId || opts.dispatch_id || null,
      validation: opts.validation || null,
      taskId: opts.taskId || opts.task_id || null,
      goal: opts.goal || null,
      plan: opts.plan || null,
      todos: opts.todos || null,
      agentId: opts.agentId || opts.agent_id || null,
      ownedFiles: opts.ownedFiles || opts.owned_files || null,
      worktree: opts.worktree || opts.worktree_path || null,
      client: opts.client || null
    };
  }
  return { agentName, summary, status, filesCreated, filesModified, learnings, projectPath, taskDir, dispatchId, validation, taskId };
}

function _checkTokubetsuDeliverables(filesCreated, filesModified, summary, finalStatus) {
  const { evaluateDeliverable } = require('./doc_quality_gate');
  const filesToCheck = [...(filesCreated || []), ...(filesModified || [])];
  if (filesToCheck.length === 0) return { finalStatus, summary };

  let failedDoc = null;
  for (const f of filesToCheck) {
    const evalRes = evaluateDeliverable(f);
    if (!evalRes.passed && !failedDoc) failedDoc = evalRes;
  }
  if (failedDoc) {
    return {
      finalStatus: 'rejected',
      summary: `[QUALITY GATE REJECTED - Score ${failedDoc.score}% >= 3.0%] Deliverable "${failedDoc.target}" failed AI detection: ${failedDoc.verdict}. Remediation: ${failedDoc.remediation_hints.join('; ')}. ${summary}`
    };
  }
  return { finalStatus, summary };
}

function _updateWorkflowStatus(taskDir, dispatchId, agentName, finalStatus, updateData) {
  if (!taskDir || !fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) {
    return { error: null, workflowStatus: null };
  }
  const workflowStatus = loadWorkflowStatus(taskDir);
  let dispatch = workflowStatus.current_dispatch || {};
  if (Array.isArray(workflowStatus.active_dispatches) && workflowStatus.active_dispatches.length > 0) {
    const found = workflowStatus.active_dispatches.find(d => d.id === dispatchId);
    if (found) dispatch = found;
  }
  if (dispatchId && dispatch.id && dispatch.id !== dispatchId) {
    return { error: 'dispatch_id does not match the active workflow dispatch', workflowStatus };
  }
  // Only a supplied name can mismatch; an unattributed report is accepted and
  // stays attributed to the dispatch that produced it.
  if (dispatch?.agent && agentName && dispatch.agent !== agentName.replace(/_/g, '-')) {
    return { error: 'agent_name does not match the active workflow dispatch', workflowStatus };
  }

  // Completion arrives ONLY via report_from_agent — never result.md polling.
  // Phase-level dispatches (explore/research/plan/document/review, no task_id)
  // also complete here so the workflow engine can advance without any file IPC.
  const cleanAgent = agentName.replace(/_/g, '-').toLowerCase();
  const todoUpdated = applyAgentReportToTodos(workflowStatus, cleanAgent, dispatchId, finalStatus, updateData);
  if ((finalStatus === 'completed' || finalStatus === 'unverified') && dispatch?.id) {
    workflowStatus.completed_dispatches = workflowStatus.completed_dispatches || [];
    if (!workflowStatus.completed_dispatches.includes(dispatch.id)) {
      workflowStatus.completed_dispatches.push(dispatch.id);
    }
    workflowStatus.dispatch_results = workflowStatus.dispatch_results || {};
    workflowStatus.dispatch_results[dispatch.id] = updateData.summary;
    saveWorkflowStatus(taskDir, workflowStatus);
  } else if (todoUpdated) {
    saveWorkflowStatus(taskDir, workflowStatus);
  }
  return { error: null, workflowStatus };
}

function saveSingleLearning(l, cleanAgent, pPath) {
  if (!l || typeof l !== 'string' || !l.trim()) return null;
  const content = l.trim();
  try {
    if (personaMemory.memoryContentExists({ content, agentName: cleanAgent, projectPath: pPath, dbPath: db.DB_PATH })) {
      return null;
    }
    const cd = require('./client_detection');
    const sessId = cd.getActiveSessionId(pPath);
    return personaMemory.saveMemory({
      agentName: cleanAgent, content, title: `${cleanAgent} decision`,
      memoryType: 'episodic', domain: 'session',
      sourceType: 'agent_report', creatorAgent: cleanAgent,
      verificationStatus: 'confirmed', confidence: 0.95,
      importance: 2, projectPath: pPath, sessionId: sessId, dbPath: db.DB_PATH
    });
  } catch (e) {
    process.stderr.write(`[mcp report_from_agent] Error saving learning: ${e.message}\n`);
    return null;
  }
}

function _saveLearnings(cleanAgent, pPath, verified, allLearnings, extra) {
  const savedIds = [];
  if (!verified) return savedIds;

  for (const l of allLearnings) {
    const mid = saveSingleLearning(l, cleanAgent, pPath);
    if (mid) savedIds.push(mid);
  }

  if (cleanAgent === 'chunin') {
    try {
      const chuninKnowledge = require('../workflow/chunin-intel/chunin_knowledge');
      const cd = require('./client_detection');
      const chuninSaved = chuninKnowledge.recordChuninReport({
        summary: extra.summary, learnings: allLearnings, validation: extra.validation,
        filesCreated: extra.filesCreated, filesModified: extra.filesModified,
        projectPath: pPath, sessionId: cd.getActiveSessionId(pPath), dbPath: db.DB_PATH
      });
      savedIds.push(...chuninSaved);
    } catch (e) {
      process.stderr.write(`[mcp report_from_agent] Error recording chunin knowledge: ${e.message}\n`);
    }
  }
  return savedIds;
}

function _notifyKageReview(cleanAgent, finalStatus, verified, details) {
  if (cleanAgent !== 'kage' || finalStatus !== 'completed' || !verified) return;
  try {
    const notifier = require('../telegram/notifier');
    const scoreMatch = (details.summary || '').match(/(?:confidence\s*score|overall\s*confidence)[:\s*]+(\d+)%/i);
    const evaluatedScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 100;
    notifier.notifyKageReviewPassed({
      title: `Kage Gate Review: ${evaluatedScore >= 98 ? 'APPROVED' : 'FAILED'}`,
      taskId: details.effTaskId,
      summary: details.summary && details.summary.length > 800 ? details.summary.slice(0, 800) + '...' : details.summary,
      kageScore: evaluatedScore,
      slopFindings: 0,
      filesModified: details.filesModified || [],
      client: details.actClient || 'Laptop Session'
    }).catch(() => {});
  } catch (_) { /* best-effort */ }
}

function _applyAdvisorVerdict({ advisorVerdict, finalStatus, result, workflowStatus, opts, cleanAgent }) {
  if (!advisorVerdict) return finalStatus;
  if (!advisorVerdict.interrupted) {
    result.advisor_status = advisorVerdict.status;
    result.advisor_tokens_used = advisorVerdict.tokens_used;
    return finalStatus;
  }
  result.advisor_status = advisorVerdict.status;
  result.advisor_interrupted = true;
  result.advisor_tokens_used = advisorVerdict.tokens_used;
  result.advisor_directive = advisorVerdict.directive;
  result.advisor_violations = advisorVerdict.violations;
  result.advisor_steer_call = advisorVerdict.steer_call;
  result.advisor_target_agent = cleanAgent;
  if (opts.taskDir && workflowStatus) {
    try { saveWorkflowStatus(opts.taskDir, workflowStatus); } catch (_) { /* non-fatal */ }
  }
  if (finalStatus !== 'completed') return finalStatus;
  result.task_status = 'unverified';
  return 'unverified';
}

function _evaluateAndRecordEvidence(ctx, useModelJudge = false) {
  const { cleanAgent, effTaskId, pPath, opts, workflowStatus, reportSummary, finalStatus, verified, verificationReason, result } = ctx;
  let actClient = opts.client || workflowStatus?.client || '';
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const advisorMonitor = require('../workflow/kage-reviewer/advisor_monitor');
    const cd = require('./client_detection');
    actClient = actClient || (typeof cd.getActiveClient === 'function' ? cd.getActiveClient() : null) || cd.detectActiveClient() || process.env.KONOHA_CLIENT || '';
    const sdlcConf = sdlcManager.getProjectSdlcConfig(pPath);
    const activeDispatchObj = workflowStatus?.current_dispatch || {};
    const advisorInput = {
      agent: cleanAgent,
      taskId: effTaskId,
      sessionId: cd.getActiveSessionId(pPath),
      delegatedTodo: activeDispatchObj.task || '',
      goal: workflowStatus?.prompt || opts.goal || '',
      plan: workflowStatus?.plan || opts.plan || null,
      todos: workflowStatus?.tasks || opts.todos || [],
      summary: reportSummary,
      status: finalStatus,
      filesCreated: opts.filesCreated || [],
      filesModified: opts.filesModified || [],
      ownedFiles: opts.ownedFiles || opts.owned_files || activeDispatchObj.owned_files || [],
      worktreePath: opts.worktree || opts.worktree_path || activeDispatchObj.worktree_path || null,
      projectPath: pPath,
      taskDir: opts.taskDir || workflowStatus?.task_dir || null,
      client: actClient,
      agentId: opts.agentId || activeDispatchObj.agent_id || null,
      workflowStatus,
      validation: opts.validation || []
    };

    const settle = (advisorVerdict) => {
      const nextStatus = _applyAdvisorVerdict({ advisorVerdict, finalStatus, result, workflowStatus, opts, cleanAgent });
      const isPhaseDispatch = !opts.taskId && !workflowStatus?.current_dispatch?.task_id;
      const evidenceData = {
        verified, verification_reason: verificationReason, validation: opts.validation || [], agent: cleanAgent,
        status: isPhaseDispatch ? (workflowStatus?.phase === 'synthesize' ? 'in_progress' : nextStatus) : nextStatus,
        summary: reportSummary, files_created: opts.filesCreated || [], files_modified: opts.filesModified || [],
        advisor: advisorVerdict ? {
          status: advisorVerdict.status,
          interrupted: advisorVerdict.interrupted,
          tokens_used: advisorVerdict.tokens_used,
          violations: advisorVerdict.violations
        } : undefined,
        is_phase_dispatch: isPhaseDispatch,
        recorded_at: new Date().toISOString(), project_path: pPath, session_id: cd.getActiveSessionId(pPath), client: actClient
      };
      sdlcManager.recordEvidence(effTaskId, evidenceData);
      result.task_id = effTaskId;
      result.evidence = evidenceData;
      if (advisorVerdict && advisorVerdict.judge_usage) result.advisor_judge_tokens = advisorVerdict.judge_usage.total_tokens || 0;
      return { finalStatus: nextStatus, actClient };
    };

    if (!useModelJudge || typeof advisorMonitor.evaluateWorkerTurnAsync !== 'function') {
      return settle(advisorMonitor.evaluateWorkerTurn(advisorInput, sdlcConf));
    }
    return advisorMonitor.evaluateWorkerTurnAsync(advisorInput, sdlcConf)
      .then(settle)
      .catch(() => ({ finalStatus, actClient }));
  } catch (_) { /* non-fatal */ }
  return { finalStatus, actClient };
}

function _reportFromAgent(delivery, rest, useModelJudge) {
  const opts = _parseReportOptions(delivery.agentName, delivery.summary, delivery.status, delivery.filesCreated, rest);
  const rawAgent = (opts.agentName || '').toLowerCase().trim();
  if (rawAgent.startsWith('delegate_to_') || rawAgent.startsWith('delegated_to_')) {
    const msg = `Legacy delegate_to_* name rejected: "${opts.agentName}". Direct specialist names (e.g. "kage", "jonin") must be used without delegate_to_ prefix.`;
    return JSON.stringify({ status: 'error', error: msg, message: msg });
  }

  const pPath = opts.projectPath || getWorkspaceRoot() || process.cwd();
  let cleanAgent = (opts.agentName || '').toLowerCase().trim();
  if (cleanAgent.startsWith('mcp_')) cleanAgent = cleanAgent.substring(4);
  cleanAgent = cleanAgent.replace(/_/g, '-');

  const { verified, reason: verificationReason } = assessValidationEvidence(opts.validation);
  let finalStatus = opts.status;
  if (finalStatus === 'completed' && !verified) finalStatus = 'unverified';

  let reportSummary = opts.summary;
  if (cleanAgent === 'tokubetsu-jonin') {
    const docRes = _checkTokubetsuDeliverables(opts.filesCreated, opts.filesModified, reportSummary, finalStatus);
    finalStatus = docRes.finalStatus;
    reportSummary = docRes.summary;
  }

  let safeTaskDir = '';
  if (opts.taskDir) {
    try {
      safeTaskDir = getResolvedTaskDir(opts.taskDir, pPath);
    } catch (err) {
      return JSON.stringify({ status: 'error', message: err.message });
    }
  }
  const safeOpts = safeTaskDir ? { ...opts, taskDir: safeTaskDir } : opts;

  // `cleanAgent`, not `opts.agentName`: the dispatch guard below compares against
  // the normalized name, so `mcp_kage` and `Anbu` were rejected as mismatches.
  const { error: wfError, workflowStatus } = _updateWorkflowStatus(safeTaskDir || opts.taskDir, opts.dispatchId, cleanAgent, finalStatus, {
    summary: reportSummary, validation: opts.validation, verified, filesCreated: opts.filesCreated, filesModified: opts.filesModified,
    // A report may name the slice it belongs to; without it a parallel workflow
    // attributes every child's result to whichever task happens to be open.
    taskId: opts.taskId
  });
  if (wfError) return JSON.stringify({ status: 'error', message: wfError });

  const allLearnings = Array.isArray(opts.learnings) ? [...opts.learnings] : [];
  const savedIds = _saveLearnings(cleanAgent, pPath, verified, allLearnings, {
    summary: reportSummary, validation: opts.validation, filesCreated: opts.filesCreated, filesModified: opts.filesModified
  });

  const effTaskId = opts.taskId || workflowStatus?.current_dispatch?.task_id || (safeTaskDir ? path.basename(safeTaskDir) : null) || 'task_active';
  const result = {
    status: 'recorded', agent: cleanAgent, task_status: finalStatus, summary: reportSummary, verified,
    files_created: opts.filesCreated || [], files_modified: opts.filesModified || [], learnings_saved_count: savedIds.length,
    project_path: pPath, reason: (finalStatus === 'rejected') ? `Score exceeds 3.0% threshold: ${reportSummary}` : null
  };

  const finalizeCtx = { cleanAgent, effTaskId, pPath, opts: safeOpts, workflowStatus, reportSummary, verified, verificationReason, result, safeTaskDir, allLearnings };
  const evalOutcome = _evaluateAndRecordEvidence(
    { cleanAgent, effTaskId, pPath, opts: safeOpts, workflowStatus, reportSummary, finalStatus, verified, verificationReason, result },
    useModelJudge
  );
  if (evalOutcome && typeof evalOutcome.then === 'function') {
    return evalOutcome.then((outcome) => _finalizeReport(finalizeCtx, outcome));
  }
  return _finalizeReport(finalizeCtx, evalOutcome);
}

function _finalizeReport(ctx, evalOutcome) {
  const { cleanAgent, effTaskId, pPath, opts, workflowStatus, reportSummary, verified, verificationReason, result, safeTaskDir, allLearnings } = ctx;
  const finalStatus = evalOutcome.finalStatus;
  const actClient = evalOutcome.actClient;

  const syncTarget = workflowStatus || { prompt: reportSummary, client: actClient, assigned_agent: cleanAgent };
  const syncBundle = syncTodoAndWalkthrough(syncTarget, {
    client: actClient,
    taskDir: safeTaskDir,
    taskId: effTaskId
  });
  if (safeTaskDir && workflowStatus) {
    try { saveWorkflowStatus(safeTaskDir, workflowStatus); } catch (_) { /* best-effort save */ }
  }
  result.todos = syncBundle.todos;
  result.walkthrough_steps = syncBundle.walkthrough_steps;
  result.client_todo_directive = syncBundle.client_todo_directive;
  result.todo_sync_block = formatTodoSyncBlock(syncBundle.client_todo_directive, syncBundle.todos);

  if (!verified) {
    result.verification_reason = verificationReason;
    result.remediation = "Task recorded as UNVERIFIED. Re-run validation commands, then re-report with entries like 'npm run build exited 0'.";
  }

  // Cross-agent context: publish this finding so sibling specialists dispatched
  // later in the same task start from it instead of re-deriving it.
  try {
    sharedContext.recordFinding({
      agent: cleanAgent,
      taskId: sharedContext.resolveTaskId({ taskDir: safeTaskDir || opts.taskDir, workflowStatus }),
      status: finalStatus,
      summary: reportSummary,
      learnings: allLearnings,
      filesCreated: opts.filesCreated,
      filesModified: opts.filesModified,
      verified,
      projectPath: pPath,
      sessionId: opts.sessionId || (workflowStatus && workflowStatus.session_id) || undefined
    });
  } catch (e) {
    process.stderr.write(`[mcp report_from_agent] shared context skipped: ${e.message}\n`);
  }

  _notifyKageReview(cleanAgent, finalStatus, verified, { summary: reportSummary, effTaskId, filesModified: opts.filesModified, actClient });
  const res = JSON.stringify(result);
  logToolCall('report_from_agent', `agent=${cleanAgent} status=${finalStatus}`, res, cleanAgent);
  return res;
}

function reportFromAgent(agentName, summary, status = 'completed', filesCreated = null, ...rest) {
  return _reportFromAgent({ agentName, summary, status, filesCreated }, rest, false);
}

async function reportFromAgentAsync(agentName, summary, status = 'completed', filesCreated = null, ...rest) {
  return _reportFromAgent({ agentName, summary, status, filesCreated }, rest, true);
}

function _formatBoundedMemories(mems) {
  return (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    domain: m.domain || 'persona',
    verification_status: m.verification_status || 'confirmed',
    lifecycle_status: m.lifecycle_status || 'active',
    confidence: m.confidence ?? 1.0,
    source_type: m.source_type || 'agent',
    source_ref: m.source_ref || '',
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
}

function getProjectContext(projectPath = null, sessionId = null) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const sess = sessionId || cd.getActiveSessionId(pPath);
  let profile = personaMemory.getProjectProfile(pPath);
  if (!profile) {
    const pHash = personaMemory.saveOrUpdateProject(pPath);
    profile = personaMemory.getProjectProfile(pHash);
  }
  const mems = personaMemory.listMemories({ projectPath: pPath, sessionId: sess, limit: 5, excludeDomains: ['shared_task'] });
  const boundedMems = _formatBoundedMemories(mems);
  const safeProfile = profile ? {
    ...profile,
    context_summary: profile.context_summary && profile.context_summary.length > 500
      ? profile.context_summary.substring(0, 500) + '...'
      : profile.context_summary
  } : null;
  return JSON.stringify({
    status: 'ok',
    project_path: pPath,
    session_id: sess,
    profile: safeProfile,
    memories: boundedMems
  });
}

function saveProjectContext(projectPath = null, contextSummary = '', techStack = null, sessionId = null) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const sess = sessionId || cd.getActiveSessionId(pPath);
  const pHash = personaMemory.saveOrUpdateProject(pPath, contextSummary, techStack);
  return JSON.stringify({
    status: 'saved',
    project_hash: pHash,
    project_path: pPath,
    session_id: sess
  });
}

// Bookkeeping rows (flow-skill bindings, checkpoints) are written for the
// workflow engine, not for agents; they crowd out real recall within `limit`.
const RECALL_NOISE_TYPES = ['flow_skill', 'checkpoint', 'lg_checkpoint', 'lg_write', 'workflow_progress'];

function queryProjectMemory(query = '', projectPath = null, agentName = null, memoryType = null, ...rest) {
  let [limit = 5, sessionId = null] = rest;
  if (memoryType && typeof memoryType === 'object') {
    const o = memoryType;
    query = o.query ?? query;
    projectPath = o.projectPath || o.project_path || projectPath;
    agentName = o.agentName || o.agent_name || agentName;
    memoryType = o.memoryType || o.memory_type || null;
    limit = o.limit ?? limit;
    sessionId = o.sessionId || o.session_id || sessionId;
  }
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const sess = sessionId || cd.getActiveSessionId(pPath);
  const effLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);
  const mems = personaMemory.queryMemories({
    agentName,
    query,
    memoryType,
    excludeMemoryTypes: memoryType ? null : RECALL_NOISE_TYPES,
    excludeDomains: ['shared_task'],
    projectPath: pPath,
    sessionId: sess,
    limit: effLimit
  });
  const boundedMems = _formatBoundedMemories(mems);
  return JSON.stringify({
    status: 'ok',
    project_path: pPath,
    session_id: sess,
    count: boundedMems.length,
    memories: boundedMems
  });
}

module.exports = {
  assessValidationEvidence,
  reportFromAgent,
  reportFromAgentAsync,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory
};
