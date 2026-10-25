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

function reportFromAgent(agentName, summary, status = 'completed', filesCreated = null, filesModified = null, learnings = null, projectPath = null, taskDir = null, dispatchId = null, validation = null, taskId = null) {
  if (agentName && typeof agentName === 'object') {
    const opts = agentName;
    agentName = opts.agent || opts.agentName || opts.agent_name;
    summary = opts.summary || opts.task || '';
    status = opts.status || 'completed';
    filesCreated = opts.filesCreated || opts.files_created || opts.deliverables || null;
    filesModified = opts.filesModified || opts.files_modified || null;
    learnings = opts.learnings || null;
    projectPath = opts.projectPath || opts.project_path || null;
    taskDir = opts.taskDir || opts.task_dir || null;
    dispatchId = opts.dispatchId || opts.dispatch_id || null;
    validation = opts.validation || null;
    taskId = opts.taskId || opts.task_id || null;
  }
  const rawAgent = (agentName || '').toLowerCase().trim();
  if (rawAgent.startsWith('delegate_to_') || rawAgent.startsWith('delegated_to_')) {
    return JSON.stringify({
      status: 'error',
      error: `Legacy delegate_to_* name rejected: "${agentName}". Direct specialist names (e.g. "kage", "jonin") must be used without delegate_to_ prefix.`,
      message: `Legacy delegate_to_* name rejected: "${agentName}". Direct specialist names (e.g. "kage", "jonin") must be used without delegate_to_ prefix.`
    });
  }

  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  let workflowStatus = null;

  let cleanAgent = (agentName || '').toLowerCase().trim();
  if (cleanAgent.startsWith('mcp_')) cleanAgent = cleanAgent.substring(4);
  cleanAgent = cleanAgent.replace(/_/g, '-');

  const { verified, reason: verificationReason } = assessValidationEvidence(validation);
  let finalStatus = status;
  if (finalStatus === 'completed' && !verified) {
    finalStatus = 'unverified';
  }

  // Strict Document Quality Gate for Tokubetsu-Jonin: verify score < 3.0%
  if (cleanAgent === 'tokubetsu-jonin') {
    const { evaluateDeliverable } = require('./doc_quality_gate');
    const filesToCheck = [...(filesCreated || []), ...(filesModified || [])];
    if (filesToCheck.length > 0) {
      let failedDoc = null;
      for (const f of filesToCheck) {
        const evalRes = evaluateDeliverable(f);
        if (!evalRes.passed && !failedDoc) {
          failedDoc = evalRes;
        }
      }
      if (failedDoc) {
        finalStatus = 'rejected';
        summary = `[QUALITY GATE REJECTED - Score ${failedDoc.score}% >= 3.0%] Deliverable "${failedDoc.target}" failed AI detection: ${failedDoc.verdict}. Remediation: ${failedDoc.remediation_hints.join('; ')}. ${summary}`;
      }
    }
  }

  if (taskDir && fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    workflowStatus = loadWorkflowStatus(taskDir);
    const dispatch = workflowStatus.current_dispatch || {};
    if (dispatchId && dispatch.id !== dispatchId) {
      return JSON.stringify({ status: 'error', message: 'dispatch_id does not match the active workflow dispatch' });
    }
    if (dispatch && dispatch.agent && dispatch.agent !== agentName.replace(/_/g, '-')) {
      return JSON.stringify({ status: 'error', message: 'agent_name does not match the active workflow dispatch' });
    }
    if ((finalStatus === 'completed' || finalStatus === 'unverified') && dispatch && dispatch.task_id) {
      const task = (workflowStatus.tasks || []).find(t => t.id === dispatch.task_id);
      if (task) {
        task.status = finalStatus;
        task.result = summary;
        task.validation = validation || [];
        task.verified = verified;
        task.files_created = filesCreated || [];
        task.files_modified = filesModified || [];
      }
      workflowStatus.completed_dispatches = workflowStatus.completed_dispatches || [];
      if (!workflowStatus.completed_dispatches.includes(dispatch.id)) {
        workflowStatus.completed_dispatches.push(dispatch.id);
      }
      workflowStatus.dispatch_results = workflowStatus.dispatch_results || {};
      workflowStatus.dispatch_results[dispatch.id] = summary;
      saveWorkflowStatus(taskDir, workflowStatus);
    }
  }

  const savedIds = [];
  const allLearnings = Array.isArray(learnings) ? [...learnings] : [];

  if (verified) {
    for (const l of allLearnings) {
      if (l && typeof l === 'string' && l.trim()) {
        const content = l.trim();
        try {
          if (personaMemory.memoryContentExists({ content, agentName: cleanAgent, projectPath: pPath, dbPath: db.DB_PATH })) {
            continue;
          }
          const cd = require('./client_detection');
          const sessId = cd.getActiveSessionId(pPath);
          const mid = personaMemory.saveMemory({
            agentName: cleanAgent,
            content,
            title: `${cleanAgent} decision`,
            memoryType: 'episodic',
            importance: 2,
            projectPath: pPath,
            sessionId: sessId,
            dbPath: db.DB_PATH
          });
          savedIds.push(mid);
        } catch (e) {
          process.stderr.write(`[mcp report_from_agent] Error saving learning: ${e.message}\n`);
        }
      }
    }

    if (cleanAgent === 'chunin') {
      try {
        const chuninKnowledge = require('../chunin_knowledge');
        const cd = require('./client_detection');
        const sessId = cd.getActiveSessionId(pPath);
        const chuninSaved = chuninKnowledge.recordChuninReport({
          summary,
          learnings: allLearnings,
          validation,
          filesCreated,
          filesModified,
          projectPath: pPath,
          sessionId: sessId,
          dbPath: db.DB_PATH
        });
        savedIds.push(...chuninSaved);
      } catch (e) {
        process.stderr.write(`[mcp report_from_agent] Error recording chunin knowledge: ${e.message}\n`);
      }
    }
  }

  const result = {
    status: 'recorded',
    agent: cleanAgent,
    task_status: finalStatus,
    summary,
    verified,
    files_created: filesCreated || [],
    files_modified: filesModified || [],
    learnings_saved_count: savedIds.length,
    project_path: pPath,
    reason: (finalStatus === 'rejected') ? `Score exceeds 3.0% threshold: ${summary}` : null
  };

  const effTaskId = taskId || (workflowStatus && workflowStatus.current_dispatch ? workflowStatus.current_dispatch.task_id : null) || (taskDir ? path.basename(taskDir) : null) || 'task_active';

  let actClient = '';
  try {
    const sdlcManager = require('../sdlc_manager');
    const cd = require('./client_detection');
    actClient = cd.getActiveClient() || cd.detectActiveClient() || '';
    const sessId = cd.getActiveSessionId(pPath);
    const evidenceData = {
      verified,
      verification_reason: verificationReason,
      validation: validation || [],
      agent: cleanAgent,
      status: finalStatus,
      summary,
      files_created: filesCreated || [],
      files_modified: filesModified || [],
      recorded_at: new Date().toISOString(),
      project_path: pPath,
      session_id: sessId,
      client: actClient
    };
    sdlcManager.recordEvidence(effTaskId, evidenceData);
    result.task_id = effTaskId;
    result.evidence = evidenceData;
  } catch (_) { /* Non-fatal if sdlc recording fails */ }

  if (!verified) {
    result.verification_reason = verificationReason;
    result.remediation = (
      'Task recorded as UNVERIFIED. Re-run the actual validation commands ' +
      '(build/test/lint), confirm real output, then re-report with validation ' +
      "entries that include the command and its exit code or pass result (e.g. 'npm run build exited 0'). Do NOT claim completion without it."
    );
  }

  // One-Way Telegram Notification: Dispatch whenever Kage final gate review passes in laptop session
  if (cleanAgent === 'kage' && finalStatus === 'completed' && verified) {
    try {
      const notifier = require('../telegram/notifier');
      const scoreMatch = (summary || '').match(/(?:confidence\s*score|overall\s*confidence)[:\s*]+(\d+)%/i);
      const evaluatedScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 100;
      notifier.notifyKageReviewPassed({
        title: `Kage Gate Review: ${evaluatedScore >= 98 ? 'APPROVED' : 'FAILED'}`,
        taskId: effTaskId,
        summary: summary && summary.length > 800 ? summary.slice(0, 800) + '...' : summary,
        kageScore: evaluatedScore,
        slopFindings: 0,
        filesModified: filesModified || [],
        client: (typeof actClient === 'string' && actClient) ? actClient : 'Laptop Session'
      }).catch(() => {});
    } catch (_) { /* intentional best-effort fallback */ }
  }

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

function queryProjectMemory(query = '', projectPath = null, agentName = null, memoryType = null, limit = 5, sessionId = null) {
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
