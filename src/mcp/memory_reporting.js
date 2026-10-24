/**
 * Konoha MCP Subsystem - Memory, Context, Reporting & Subagent Execution
 * Extracted from server.js as part of modularization refactor (Phase 6)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getDb } = db;
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
const { getSessionKey, getAndIncrementSessionTurn } = require('./client_detection');
const { fuzzyResolveSkill, logToolCall } = require('./skills');
const {
  loadWorkflowStatus,
  saveWorkflowStatus,
  getResolvedTaskDir,
  VALIDATION_EVIDENCE_PATTERN
} = require('./workflow');

function getMainModel() {
  try {
    const conn = getDb();
    const row1 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('sannin');
    if (row1 && row1.model_tier) return row1.model_tier;
    const row2 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('kage');
    if (row2 && row2.model_tier) return row2.model_tier;
  } catch (_) { /* ignore */ }
  return 'Gemini 3.1 Pro (High)';
}

function applyFileEdits(content) {
  const workspace = getWorkspaceRoot() || process.cwd();
  const pattern = /FILE:\s*(.*?)\r?\n<<<<<<<\s*original\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    let filePath = match[1].trim();
    const original = match[2];
    const replacement = match[3];

    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(workspace, filePath);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!original.trim()) {
      fs.writeFileSync(filePath, replacement, 'utf8');
    } else if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (fileContent.includes(original)) {
        // Function replacement: literal insert, immune to $& / $` / $' patterns
        fs.writeFileSync(filePath, fileContent.replace(original, () => replacement), 'utf8');
      } else {
        const origLf = original.replace(/\r\n/g, '\n');
        const fileLf = fileContent.replace(/\r\n/g, '\n');
        if (fileLf.includes(origLf)) {
          fs.writeFileSync(filePath, fileLf.replace(origLf, () => replacement), 'utf8');
        }
      }
    }
  }
}

const AUTOLOAD_SKILL_STOPWORDS = new Set([
  'with', 'from', 'this', 'that', 'have', 'make', 'into', 'then', 'more', 'some',
  'when', 'will', 'also', 'about', 'your', 'using', 'need', 'want', 'only', 'after',
  'before', 'first', 'last', 'each', 'every', 'both', 'between', 'under', 'over',
  'task', 'build', 'create', 'setup', 'update', 'test', 'help', 'work', 'code'
]);

function autoloadSkillsFromPrompt(prompt, conn, maxMatches = 3) {
  if (!prompt || !prompt.trim()) return [];
  const tokens = prompt.toLowerCase().replace(/[^a-z0-9_-]/g, ' ').split(/\s+/).filter(t => t.length > 3 && !AUTOLOAD_SKILL_STOPWORDS.has(t));
  if (tokens.length === 0) return [];

  const rows = conn.prepare("SELECT skill_name, content FROM skills WHERE type = 'skill'").all();
  const scored = [];
  for (const row of rows) {
    if (row.skill_name.startsWith('antislop') || row.skill_name === 'i-have-adhd') continue;
    const nameLower = row.skill_name.toLowerCase();
    const haystack = (nameLower + ' ' + (row.content || '').substring(0, 300)).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (nameLower === t || nameLower.includes(t)) {
        score += 5;
      } else if (haystack.includes(t)) {
        score += 1;
      }
    }
    if (score > 0) scored.push({ score, name: row.skill_name });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxMatches).map(x => x.name);
}

function buildSubagentMcpBlock(client = null, agentName = null) {
  const normAgent = (agentName || '').toLowerCase().replace(/_/g, '-');
  const tools = [
    '- `mcp__konoha__sannin` — Sannin router agent',
    '- `mcp__konoha__kage` — Village Leader & Architect',
    '- `mcp__konoha__jonin` — UI & Frontend Specialist',
    '- `mcp__konoha__anbu` — Backend & DevOps Specialist',
    '- `mcp__konoha__chunin` — Intel Ninja',
    '- `mcp__konoha__tokubetsu_jonin` — Scribe',
    '- `mcp__konoha__genin` — Scout',
    '- `mcp__konoha__find_skill` — Find skills',
    '- `mcp__konoha__use_skills` — Load and activate specific skill(s) by name',
    '- `mcp__konoha__get_skill` — Get skill content',
    '- `mcp__konoha__list_skills` — List all skills',
    '- `mcp__konoha__read_file_head` — Read head of file',
    '- `mcp__konoha__read_file_range` — Read range of lines in file',
    '- `mcp__konoha__file_info` — Get file info',
    '- `mcp__konoha__token_efficient_grep` — Token-efficient grep',
    '- `mcp__konoha__get_file_structure` — Get file tree',
    '- `mcp__konoha__find_files_clean` — Find files cleanly',
    '- `mcp__semble__search` — Search project codebase',
    '- `mcp__semble__find_related` — Find related code symbols'
  ];

  if (['genin', 'kage'].includes(normAgent)) {
    tools.push('- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan');
    tools.push('- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning');
  } else if (['jonin', 'anbu'].includes(normAgent)) {
    tools.push('- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan');
    tools.push('- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning');
    tools.push('- `mcp__aislop__aislop_fix` — Auto-fix AI slop issues');
  }

  if (normAgent === 'anbu') {
    tools.push('- `mcp__konoha__qa_codify` — Deterministically codify flow file to Playwright test');
    tools.push('- `mcp__konoha__qa_e2e_run` — Run Playwright regression test suite with compact summary');
  }

  let boundaries = (
    '### Strict Tool Boundaries\n' +
    'Use konoha MCP for skill lookup and bounded file reads/grep. Use semble MCP for project code search.\n'
  );
  if (['genin', 'kage'].includes(normAgent)) {
    boundaries += (
      'For aislop MCP: You are permitted to use `aislop_scan` and `aislop_why`. ' +
      'You are strictly forbidden from calling `aislop_fix` or `aislop_baseline` (read-only mandate).\n'
    );
  } else if (['jonin', 'anbu'].includes(normAgent)) {
    boundaries += (
      'For aislop MCP: You are permitted to use `aislop_scan`, `aislop_fix`, and `aislop_why` ' +
      'to detect and remediate slop issues before Kage delivery review.\n'
    );
  }
  if (normAgent === 'anbu') {
    boundaries += (
      'For QA automation: Anbu is granted `qa_codify` and `qa_e2e_run`. ' +
      'Other agents (Jonin, Kage, Genin) do not call QA tools.\n'
    );
  }

  return `\n## MCP Tools Available To You\n${tools.join('\n')}\n\n${boundaries}`;
}

function truncateAtBoundary(text, maxChars) {
  const s = text || '';
  if (s.length <= maxChars) return s;
  const head = s.substring(0, maxChars);
  const cutPoints = [head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('\n')];
  let cut = Math.max(...cutPoints);
  if (cut < Math.floor(maxChars / 2)) cut = maxChars;
  else cut += 1;
  return head.substring(0, cut).trimEnd() + ' ...[truncated]';
}

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
  } catch (_) {
    // Non-fatal if sdlc recording fails
  }

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
    } catch (_) { /* intentional best-effort fallback: notification failure must never crash reporting */ }
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

function cleanRedundantPersonaText(text) {
  if (!text) return '';
  return text
    .replace(/Base personality: High Effort \+ Instruct Style —[^.]+\./gi, '')
    .replace(/and adhere strictly to base personality:[^.]+\./gi, '')
    .replace(/Call konoha\.find_skill for skills\.[\s\S]*?(?=Call the semble|\. [A-Z]|$)/gi, '')
    .replace(/Call the semble MCP tools \(search\/find_related\) directly for codebase search\. Do NOT mix them\.?/gi, '')
    .replace(/Do NOT call `?semble`? tools[^.]+\./gi, '')
    .replace(/NEVER use `?semble`? search for skills\.?/gi, '')
    .replace(/NEVER use grep, glob, find[^.]+\./gi, '')
    .replace(/Always use `?konoha`? MCP tools[^.]+\./gi, '')
    .replace(/\s*\.\s*\./g, '.')
    .replace(/^\s*\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function runMcpAgent(agentName, task = null, context = null, constraints = null, skills = null, tasteDials = null, projectPath = null, taskDir = null, sessionId = null, flowHash = null) {
  if (typeof task === 'object' && task !== null) {
    const opts = task;
    context = opts.context || null;
    constraints = opts.constraints || null;
    skills = opts.skills || null;
    tasteDials = opts.tasteDials || opts.taste_dials || null;
    projectPath = opts.projectPath || opts.project_path || projectPath;
    taskDir = opts.taskDir || opts.task_dir || taskDir;
    sessionId = opts.sessionId || opts.session_id || sessionId;
    flowHash = opts.flowHash || opts.flow_hash || flowHash;
    task = opts.task || null;
  }
  const resolvedProjPath = projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const activeClient = getActiveClient() || cd.detectActiveClient() || 'universal';
  const resolvedSessionId = sessionId || cd.getActiveSessionId(resolvedProjPath, activeClient);
  const sessionKey = getSessionKey(resolvedProjPath, resolvedSessionId);
  getAndIncrementSessionTurn(sessionKey);

  const sdlcManager = require('../sdlc_manager');
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  let dorResult = null;
  if (task && typeof task === 'string' && task.trim()) {
    dorResult = sdlcManager.checkReadiness(task, resolvedProjPath);
    if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
      return JSON.stringify({
        status: 'blocked',
        phase: 'dor',
        message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address missing items.',
        missing: dorResult.missing,
        dor_result: dorResult
      });
    }
  }

  let instructions = '';
  if (task && typeof task === 'string' && task.trim()) {
    instructions = task.trim();
    if (dorResult && !dorResult.ready && dorResult.missing.length > 0) {
      instructions += `\n\n### ⚠️ Definition-of-Readiness (DoR) Advisory Hints:\n` +
        dorResult.missing.map(m => `- ${m}`).join('\n');
    }
    if (context && typeof context === 'string' && context.trim()) {
      instructions += `\n\n### Context & Relevant Code Paths:\n${context.trim()}`;
    }
    if (constraints && typeof constraints === 'string' && constraints.trim()) {
      instructions += `\n\n### Execution Constraints:\n${constraints.trim()}`;
    }
  } else {
    const resolvedTaskDir = getResolvedTaskDir(taskDir, resolvedProjPath, resolvedSessionId);
    const delegatePath = path.join(resolvedTaskDir, 'delegate.md');
    if (!fs.existsSync(delegatePath)) {
      return JSON.stringify({ status: 'error', message: `Neither direct task instructions nor delegate.md found in task directory: ${resolvedTaskDir}` });
    }
    try {
      let delegateContent = fs.readFileSync(delegatePath, 'utf8');
      if (delegateContent.startsWith('---')) {
        const parts = delegateContent.split('---', 3);
        if (parts.length >= 3) delegateContent = parts[2].trim();
      }
      instructions = delegateContent;
    } catch (e) {
      return JSON.stringify({ status: 'error', message: `Failed to read delegate.md: ${e.message}` });
    }
  }

  if (!dorResult && instructions && typeof instructions === 'string' && instructions.trim()) {
    dorResult = sdlcManager.checkReadiness(instructions, resolvedProjPath);
    if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
      return JSON.stringify({
        status: 'blocked',
        phase: 'dor',
        message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address missing items.',
        missing: dorResult.missing,
        dor_result: dorResult
      });
    }
  }

  let dbAgentName = agentName;
  if (dbAgentName.startsWith('mcp_')) dbAgentName = dbAgentName.substring(4);
  dbAgentName = dbAgentName.replace(/_/g, '-');

  let title = dbAgentName;
  let purpose = '';
  let agentConstraints = '';
  let personaInstructions = '';
  let skillsList = Array.isArray(skills) ? [...skills] : [];

  let assignedModel = 'inherit';

  try {
    let rowConn = null;
    try {
      rowConn = getDb();
      let row = null;
      try {
        row = rowConn.prepare(`
          SELECT name, title, purpose, skills, constraints_text, instructions, model
          FROM agents WHERE name = ?
        `).get(dbAgentName);
        if (!row) {
          row = rowConn.prepare(`
            SELECT name, title, purpose, skills, constraints_text, instructions, model
            FROM agents WHERE name = ?
          `).get(`mcp_${dbAgentName}`);
        }
      } catch (colErr) {
        if (colErr && colErr.message && colErr.message.includes('no such column: model')) {
          row = rowConn.prepare(`
            SELECT name, title, purpose, skills, constraints_text, instructions
            FROM agents WHERE name = ?
          `).get(dbAgentName);
          if (!row) {
            row = rowConn.prepare(`
              SELECT name, title, purpose, skills, constraints_text, instructions
              FROM agents WHERE name = ?
            `).get(`mcp_${dbAgentName}`);
          }
        } else {
          throw colErr;
        }
      }
      if (row) {
        title = row.title || title;
        purpose = row.purpose || purpose;
        agentConstraints = cleanRedundantPersonaText(row.constraints_text || agentConstraints);
        personaInstructions = cleanRedundantPersonaText(row.instructions || personaInstructions);
        if (row.model) {
          assignedModel = row.model;
        }
        if (row.skills && skillsList.length === 0) {
          try { skillsList = JSON.parse(row.skills); } catch (_) { /* ignore */ }
        }
      }
    } finally {
      if (rowConn) {
        try { rowConn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error reading agent row from DB: ${e.message}\n`);
  }

  if (skillsList.length === 0 && instructions) {
    try {
      const conn = getDb();
      const auto = autoloadSkillsFromPrompt(instructions, conn);
      if (auto.length > 0) {
        skillsList = auto;
        process.stderr.write(`[mcp ${agentName}] auto-loaded skills from prompt: ${auto.join(', ')}\n`);
      }
    } catch (_) { /* ignore */ }
  }

  if (dbAgentName === 'jonin') {
    let targetFw = null;
    const combinedText = `${instructions} ${context || ''}`.toLowerCase();
    if (resolvedProjPath && fs.existsSync(resolvedProjPath)) {
      const pkgPath = path.join(resolvedProjPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkgContent = fs.readFileSync(pkgPath, 'utf8').toLowerCase();
          if (pkgContent.includes('next')) targetFw = 'nextjs';
          else if (pkgContent.includes('svelte')) targetFw = 'svelte';
          else if (pkgContent.includes('nuxt')) targetFw = 'nuxt';
          else if (pkgContent.includes('angular') || pkgContent.includes('@angular')) targetFw = 'angular';
        } catch (_) { /* ignore */ }
      }
    }
    if (!targetFw) {
      if (combinedText.includes('next') || combinedText.includes('react')) targetFw = 'nextjs';
      else if (combinedText.includes('svelte')) targetFw = 'svelte';
      else if (combinedText.includes('nuxt') || combinedText.includes('vue')) targetFw = 'nuxt';
      else if (combinedText.includes('angular') || combinedText.includes('ng')) targetFw = 'angular';
      else targetFw = 'nextjs';
    }
    if (skillsList.length === 0) {
      skillsList = [
        'jonin-skill',
        `jonin-skill/${targetFw}-code-expert`,
        `jonin-skill/${targetFw}-ui-expert`,
        'jonin-skill/design-token-manifest',
        'jonin-skill/taste-skill-frontend-expert'
      ];
    }
  }

  // Soul-bound behavioral shaping (ADHD shaping and anti-slop tenets) from Shinobi Soul
  let soulBehaviorBlock = '';
  try {
    const soulInfo = personaMemory.getSoul({ agentName: dbAgentName, projectPath: resolvedProjPath });
    if (soulInfo && soulInfo.behavior_directive) {
      soulBehaviorBlock = `${soulInfo.behavior_directive}\n`;
    }
  } catch (_) { /* ignore */ }

  let effFlowHash = flowHash;
  if (!effFlowHash && taskDir) {
    try {
      const statusFile = path.join(taskDir, 'status.json');
      if (fs.existsSync(statusFile)) {
        const s = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        if (s && s.flow_hash) effFlowHash = s.flow_hash;
      }
    } catch (_) { /* ignore */ }
  }

  if (effFlowHash) {
    try {
      const flowSkills = personaMemory.getFlowSkills(effFlowHash);
      if (Array.isArray(flowSkills)) {
        for (const fsItem of flowSkills) {
          if (!skillsList.includes(fsItem)) {
            skillsList.push(fsItem);
          }
        }
      }
    } catch (_) { /* ignore */ }
  }

  const skillsContent = [];
  if (skillsList.length > 0) {
    let skillConn = null;
    try {
      skillConn = getDb();
      const primarySkill = skillsList[0];
      const resolved = fuzzyResolveSkill(primarySkill, skillConn) || primarySkill;
      const row = skillConn.prepare('SELECT content, type FROM skills WHERE name = ?').get(resolved);
      if (row && row.content) {
        const preview = row.content.substring(0, 250) + (row.content.length > 250 ? '\n...(Use konoha.get_skill for full reference)' : '');
        const label = row.type === 'skill' ? 'Skill' : 'Reference';
        skillsContent.push(`### ${label}: ${resolved}\n\n${preview}`);
      }
    } catch (e) {
      process.stderr.write(`[mcp ${agentName}] Error loading skill definitions: ${e.message}\n`);
    } finally {
      if (skillConn) {
        try { skillConn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  }

  let projectContextBlock = '';
  try {
    let projProfile = personaMemory.getProjectProfile(resolvedProjPath);
    if (!projProfile) {
      const pHash = personaMemory.saveOrUpdateProject(resolvedProjPath);
      projProfile = personaMemory.getProjectProfile(pHash);
    }
    const projMems = personaMemory.queryMemories({
      agentName: dbAgentName,
      query: instructions,
      projectPath: resolvedProjPath,
      sessionId: resolvedSessionId,
      limit: 2
    });
    projectContextBlock = personaMemory.formatProjectContextForPrompt(
      projProfile,
      projMems,
      1,
      true
    );
  } catch (e) {
    process.stderr.write(`[mcp ${agentName}] Error querying project context: ${e.message}\n`);
  }

  let searchFindings = '';
  if (dbAgentName.includes('chunin')) {
    searchFindings = '### Deep Research Findings (Compact)\n\n';
  }

  let tasteSkillBlock = '';
  if (dbAgentName === 'jonin') {
    const dials = tasteDials || {};
    const varDial = dials.design_variance !== undefined ? dials.design_variance : 8;
    const motDial = dials.motion_intensity !== undefined ? dials.motion_intensity : 7;
    const densDial = dials.visual_density !== undefined ? dials.visual_density : 6;
    tasteSkillBlock = (
      '### 🎨 Taste-Skill Design Engine Directives (tasteskill.dev):\n' +
      `- Active Taste Dials: DESIGN_VARIANCE=${varDial}/10 | MOTION_INTENSITY=${motDial}/10 | VISUAL_DENSITY=${densDial}/10\n` +
      '- Anti-Slop: Zero generic AI-purple gradients, zero 3-card boilerplate stacks. Bespoke editorial UI.\n' +
      '- Typography: Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display. Extreme scale contrast.\n' +
      '- Layout & Spacing: py-24/py-32 section pacing, CSS Grid (grid-cols-12), max-w-[1400px], min-h-[100dvh].\n' +
      '- Theme & Aesthetics: 10 Light-Mode gradient themes (data-theme), 3D perspective tilt (1200px), Zero emojis (Lucide SVG).\n' +
      '- Konoha Invariants: Far-left logo, no mobile header hamburger, fixed mobile dock, floating bottom-left 10-theme switcher, 4-slide hero carousel.\n' +
      '- Quality & Delivery: pnpm exclusively, zero errors/warnings, run `rtk aislop scan --changes` (findings: 0, ai_slop_clean: true).\n'
    );
  }

  let docDesignBlock = '';
  if (dbAgentName.includes('tokubetsu')) {
    docDesignBlock = (
      '### 🖋️ Tokubetsu-Jonin Document Engineering & Design Directives (Compacted):\n' +
      '- Native Tools: Use document_create (DOCX/PDF), spreadsheet_create (XLSX), presentation_create (PPTX), diagram_create (SVG), animation_export (WebP) in src/tools/document_engine.js.\n' +
      '- Skills via FTS5/RAG: Query konoha.find_skill("<keywords>") and konoha.get_skill("<name>"); never read raw markdown files directly.\n' +
      '- Fonts & Themes: Inter (Display/SemiBold/Regular), JetBrains Mono for code. 20 Enterprise 4-Base-Color Themes (T01-T20). Pure light mode (#FFFFFF/#F8FAFC), zero dark fills.\n' +
      '- Quality Gate: Strict AI score < 3.0% (ZeroGPT risk < 3.0%), sentence CV >= 0.85, active voice, zero robotic clichés, metadata scrubbed.\n'
    );
  }

  const staticHeader = (
    '[Konoha Token Preservation: Active - High-Efficiency Context]\n\n' +
    'IMPORTANT: The TASK INSTRUCTIONS at the bottom of this prompt are the complete, ' +
    'authoritative task. Never reinterpret, narrow, or replace them with a newly ' +
    'discovered error. If you find an additional bug while fixing, fix the ORIGINAL ' +
    'task first, then report the new finding — do not abandon or delete prior work.\n\n'
  );
  const MAX_PERSONA_BYTES = 1400;
  const prefix = `${staticHeader}You are @${dbAgentName} (${title}).\nPurpose: ${purpose}\n`;
  const truncatedConstraints = truncateAtBoundary(agentConstraints, 600);
  const constraintsBlock = `Constraints: ${truncatedConstraints}\n\n`;

  const instructionsPrefix = 'Instructions: ';
  const TRUNCATE_SUFFIX_LEN = 16;
  const baseOverhead = prefix.length + constraintsBlock.length + instructionsPrefix.length + 1;
  const remainingBudget = MAX_PERSONA_BYTES - baseOverhead - TRUNCATE_SUFFIX_LEN;

  let instructionsLine = '';
  if (remainingBudget > 0) {
    const truncatedInstructions = truncateAtBoundary(personaInstructions, remainingBudget);
    instructionsLine = `${instructionsPrefix}${truncatedInstructions}\n`;
  }
  let systemPrompt = `${prefix}${instructionsLine}${constraintsBlock}`;
  if (projectContextBlock) systemPrompt += projectContextBlock + '\n';
  if (soulBehaviorBlock) systemPrompt += soulBehaviorBlock + '\n';
  if (tasteSkillBlock) systemPrompt += tasteSkillBlock + '\n';
  if (docDesignBlock) systemPrompt += docDesignBlock + '\n';
  systemPrompt += buildSubagentMcpBlock(getActiveClient(), agentName) + '\n';
  if (searchFindings) systemPrompt += searchFindings + '\n';
  let flowSkillsHeader = '';
  if (effFlowHash && skillsList.length > 0) {
    flowSkillsHeader = `Active Flow Skills (Bound to Flow ${effFlowHash}): ${skillsList.join(', ')}\n\n`;
  }
  if (skillsContent.length > 0) {
    systemPrompt += (flowSkillsHeader || 'Available Skills:\n') + skillsContent.join('\n\n') + '\n\n';
  } else if (skillsList.length > 0) {
    systemPrompt += flowSkillsHeader || `Available Skills:\nOn-Demand Reference Skills: ${skillsList.join(', ')}\n\n`;
  }
  systemPrompt += (
    'Conflict Diff Format:\n' +
    'FILE: path/to/file\n<<<<<<< original\n[orig]\n=======\n[replacement]\n>>>>>>>\n'
  );

  const basePersonalityBlock = (
    '## Base Personality: High Effort + Instruct Style\n\n' +
    '- Strictly NO conversational filler or hesitation markers (STRICTLY FORBIDDEN: "Hmmmm", "Let me check", "Let me see", "Wait, let me", "Wait - but", "I will now proceed to", "Let me examine", "let me", "hmm", "hmmm").\n' +
    '- Lead with direct action and direct evidence. Start immediately with the action taken or the factual result.\n' +
    '- ADHD-friendly structured format: number multi-step procedures, bold headings, bullet points, clean code blocks. No fluff or pleasantries.\n' +
    '- Zero hallucination and strictly NO lies: never pretend a test ran or passed without verified output evidence.\n' +
    '- Minimum 98% confidence gate: mechanically verified against real execution exit codes and 0 slop findings.\n' +
    '- MANDATORY SKILL RETRIEVAL (SQLite FTS5 & Neural RAG): Always discover domain skills via konoha.find_skill("<keywords>") and load full definitions with konoha.use_skills(["<skill>"]) or konoha.get_skill("<name>"). Direct reading of raw markdown files on disk is strictly forbidden (markdown files exist only as mirror fallbacks).\n' +
    '- FIRST ACTION on any new task: call konoha.find_skill with keywords from the user prompt BEFORE any code changes.\n\n'
  );

  const dualBoundaryAnchor = (
    '## 🛡️ Critical Invariants & Non-Negotiables (Dual-Boundary Anchor)\n\n' +
    '- STRICT FACTUAL TRUTH: Never fabricate test results, simulated tool outputs, or audit reports. Every claim must cite verifiable execution output.\n' +
    '- STRICT NO-PUSH / NO-PUBLISH: Never run git push, npm publish, or create remote tags. All changes remain local.\n' +
    '- REQUIRED LOCAL COMMIT IDENTITY: If explicitly committing, use author `andycungkrinx91 <andy.silva270114@gmail.com>`.\n' +
    '- PRESERVE PROXY GATEWAY: Under no circumstances modify, touch, or disable the local OpenAI-compatible proxy gateway (`src/bridge/*`, port 19999).\n' +
    '- BOUNDED FILE ACCESS: Always use konoha MCP bounded file tools (`read_file_range`, `read_file_head`). Never use shell cat/head/grep.\n' +
    '- MANDATORY SKILL ACCESS (SQLite FTS5/RAG): Always retrieve skills via konoha.find_skill, konoha.use_skills, or konoha.get_skill. Never read raw markdown files directly.\n' +
    '- ZERO-AI-SLOP DELIVERY: Before delivery, run `rtk aislop scan --changes` to verify score 100/100 and `ai_slop_clean: true` with 0 findings.\n' +
    '- KAGE 98% CONFIDENCE GATE: Delivery is blocked if confidence < 98%.\n\n'
  );

  const executionProtocol = (
    `You must now act as ${dbAgentName} and execute the task below. Use the available tools to explore the codebase or make file edits.\n\n` +
    '## Execution Protocol\n\n' +
    '1. Execute the task directly as described in TASK INSTRUCTIONS below.\n' +
    '2. Validate your work: execute framework validation checks and verify 0 errors and 0 warnings.\n' +
    '3. Zero-AI-Slop Pre-Gate: Ensure no AI slop patterns exist (run `rtk aislop scan --changes` to verify `ai_slop_clean: true` and `ai_slop_findings: 0`).\n' +
    '4. When complete, report your results, validation evidence, and key learnings via the `report_from_agent` tool or structured response.\n\n'
  );

  const taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;

  const instruction = `${systemPrompt}\n\n${basePersonalityBlock}${dualBoundaryAnchor}${executionProtocol}${taskBlock}`.trim();

  const effTaskDir = taskDir || getResolvedTaskDir(taskDir, resolvedProjPath, resolvedSessionId);
  const res = JSON.stringify({
    status: 'ready',
    phase: 'execution',
    agent: dbAgentName,
    model: assignedModel,
    flow_hash: effFlowHash || undefined,
    project_path: resolvedProjPath,
    session_id: resolvedSessionId,
    task_dir: effTaskDir,
    instructions: instruction
  });
  logToolCall(agentName, `project_path=${resolvedProjPath} session_id=${resolvedSessionId} task_dir=${effTaskDir}`, res, dbAgentName);
  return res;
}

module.exports = {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  buildSubagentMcpBlock,
  truncateAtBoundary,
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  runMcpAgent
};
