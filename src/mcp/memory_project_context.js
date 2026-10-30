'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { logToolCall } = require('./skills');
const {
  loadWorkflowStatus,
  saveWorkflowStatus,
  VALIDATION_EVIDENCE_PATTERN
} = require('./workflow');

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
      agentName: opts.agent || opts.agentName || opts.agent_name,
      summary: opts.summary || opts.task || '',
      status: opts.status || 'completed',
      filesCreated: opts.filesCreated || opts.files_created || opts.deliverables || null,
      filesModified: opts.filesModified || opts.files_modified || null,
      learnings: opts.learnings || null,
      projectPath: opts.projectPath || opts.project_path || null,
      taskDir: opts.taskDir || opts.task_dir || null,
      dispatchId: opts.dispatchId || opts.dispatch_id || null,
      validation: opts.validation || null,
      taskId: opts.taskId || opts.task_id || null
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
  const dispatch = workflowStatus.current_dispatch || {};
  if (dispatchId && dispatch.id !== dispatchId) {
    return { error: 'dispatch_id does not match the active workflow dispatch', workflowStatus };
  }
  if (dispatch?.agent && dispatch.agent !== agentName.replace(/_/g, '-')) {
    return { error: 'agent_name does not match the active workflow dispatch', workflowStatus };
  }

  // Completion arrives ONLY via report_from_agent — never result.md polling.
  // Phase-level dispatches (explore/research/plan/document/review, no task_id)
  // also complete here so the workflow engine can advance without any file IPC.
  if (finalStatus === 'completed' || finalStatus === 'unverified') {
    if (dispatch?.task_id) {
      const task = (workflowStatus.tasks || []).find(t => t.id === dispatch.task_id);
      if (task) {
        task.status = finalStatus;
        task.result = updateData.summary;
        task.validation = updateData.validation || [];
        task.verified = updateData.verified;
        task.files_created = updateData.filesCreated || [];
        task.files_modified = updateData.filesModified || [];
      }
    }
    if (dispatch?.id) {
      workflowStatus.completed_dispatches = workflowStatus.completed_dispatches || [];
      if (!workflowStatus.completed_dispatches.includes(dispatch.id)) {
        workflowStatus.completed_dispatches.push(dispatch.id);
      }
      workflowStatus.dispatch_results = workflowStatus.dispatch_results || {};
      workflowStatus.dispatch_results[dispatch.id] = updateData.summary;
      saveWorkflowStatus(taskDir, workflowStatus);
    }
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
      memoryType: 'episodic', importance: 2, projectPath: pPath, sessionId: sessId, dbPath: db.DB_PATH
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

function reportFromAgent(agentName, summary, status = 'completed', filesCreated = null, ...rest) {
  const opts = _parseReportOptions(agentName, summary, status, filesCreated, rest);
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

  const { error: wfError, workflowStatus } = _updateWorkflowStatus(opts.taskDir, opts.dispatchId, opts.agentName, finalStatus, {
    summary: reportSummary, validation: opts.validation, verified, filesCreated: opts.filesCreated, filesModified: opts.filesModified
  });
  if (wfError) return JSON.stringify({ status: 'error', message: wfError });

  const allLearnings = Array.isArray(opts.learnings) ? [...opts.learnings] : [];
  const savedIds = _saveLearnings(cleanAgent, pPath, verified, allLearnings, {
    summary: reportSummary, validation: opts.validation, filesCreated: opts.filesCreated, filesModified: opts.filesModified
  });

  const effTaskId = opts.taskId || workflowStatus?.current_dispatch?.task_id || (opts.taskDir ? path.basename(opts.taskDir) : null) || 'task_active';
  const result = {
    status: 'recorded', agent: cleanAgent, task_status: finalStatus, summary: reportSummary, verified,
    files_created: opts.filesCreated || [], files_modified: opts.filesModified || [], learnings_saved_count: savedIds.length,
    project_path: pPath, reason: (finalStatus === 'rejected') ? `Score exceeds 3.0% threshold: ${reportSummary}` : null
  };

  let actClient = '';
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const cd = require('./client_detection');
    actClient = cd.getActiveClient() || cd.detectActiveClient() || '';
    const evidenceData = {
      verified, verification_reason: verificationReason, validation: opts.validation || [], agent: cleanAgent,
      status: finalStatus, summary: reportSummary, files_created: opts.filesCreated || [], files_modified: opts.filesModified || [],
      recorded_at: new Date().toISOString(), project_path: pPath, session_id: cd.getActiveSessionId(pPath), client: actClient
    };
    sdlcManager.recordEvidence(effTaskId, evidenceData);
    result.task_id = effTaskId;
    result.evidence = evidenceData;
  } catch (_) { /* non-fatal */ }

  if (!verified) {
    result.verification_reason = verificationReason;
    result.remediation = "Task recorded as UNVERIFIED. Re-run validation commands, then re-report with entries like 'npm run build exited 0'.";
  }

  _notifyKageReview(cleanAgent, finalStatus, verified, { summary: reportSummary, effTaskId, filesModified: opts.filesModified, actClient });
  const res = JSON.stringify(result);
  logToolCall('report_from_agent', `agent=${cleanAgent} status=${finalStatus}`, res, cleanAgent);
  return res;
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
  const mems = personaMemory.listMemories({ projectPath: pPath, sessionId: sess, limit: 5 });
  const boundedMems = (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
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

function queryProjectMemory(query = '', projectPath = null, agentName = null, memoryType = null, ...rest) {
  const [limit = 5, sessionId = null] = rest;
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const sess = sessionId || cd.getActiveSessionId(pPath);
  const effLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);
  const mems = personaMemory.queryMemories({
    agentName,
    query,
    memoryType,
    projectPath: pPath,
    sessionId: sess,
    limit: effLimit
  });
  const boundedMems = (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
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
  getProjectContext,
  saveProjectContext,
  queryProjectMemory
};
