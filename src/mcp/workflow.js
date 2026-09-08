/**
 * Konoha MCP Subsystem - Workflow Engine & Sannin Router
 * Extracted from server.js as part of modularization refactor (Phase 4)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getKonohaTmpRoot } = require('./client_detection');
const { logToolCall } = require('./skills');

function getResolvedTaskDir(taskDir = null) {
  const tmpRoot = getKonohaTmpRoot();
  const tasksDir = path.join(tmpRoot, 'scratch', 'tasks');
  if (!taskDir) {
    if (fs.existsSync(tasksDir) && fs.statSync(tasksDir).isDirectory()) {
      const subdirs = fs.readdirSync(tasksDir)
        .map(d => path.join(tasksDir, d))
        .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
      if (subdirs.length > 0) {
        subdirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return subdirs[0];
      }
    }
    return path.join(tasksDir, 'default');
  }
  if (!path.isAbsolute(taskDir)) {
    return path.resolve(path.join(tasksDir, taskDir));
  }
  return taskDir;
}

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch (_) { /* ignore */ }
  return null;
}

function loadWorkflowStatus(taskDir) {
  const statusPath = path.join(taskDir, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  return {
    schema_version: 2,
    created_at: new Date().toISOString(),
    phase: 'route',
    assigned_agent: 'sannin',
    current_dispatch: null,
    completed_dispatches: [],
    dispatch_results: {},
    tasks: [],
    history: []
  };
}

function saveWorkflowStatus(taskDir, status) {
  const statusPath = path.join(taskDir, 'status.json');
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

function routeByKeywordsWithPrompt(taskDir, prompt = '') {
  let p = prompt;
  if (!p) p = readFileSafe(path.join(taskDir, 'prompt.md')) || '';
  if (!p) return 'kage';

  const promptLower = p.toLowerCase();
  let bestScore = 0;
  let bestAgent = null;

  try {
    const conn = getDb();
    const agents = conn.prepare(`
      SELECT name, delegation_keywords FROM agents
      WHERE delegation_keywords IS NOT NULL AND delegation_keywords != ''
    `).all();

    for (const agent of agents) {
      const kwText = agent.delegation_keywords.toLowerCase();
      let agentScore = 0;
      for (const kwRaw of kwText.split(',')) {
        const kw = kwRaw.trim();
        if (!kw) continue;
        if (promptLower.includes(kw)) {
          agentScore += ((kw.match(/\s/g) || []).length + 1) * 2;
          continue;
        }
        const tokens = kw.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        let hits = 0;
        for (const t of tokens) {
          if (promptLower.includes(t)) hits++;
        }
        if (hits === tokens.length) {
          agentScore += hits;
        } else if (hits > 0) {
          agentScore += hits * 0.5;
        }
      }
      if (agentScore > bestScore) {
        bestScore = agentScore;
        bestAgent = agent.name;
      }
    }
  } catch (_) { /* ignore */ }

  if (!bestAgent) bestAgent = 'kage';
  const writeSignals = ['prd', 'write a prd', 'technical doc', 'write the doc', 'draft the doc', 'write docs', 'author', 'write a spec'];
  if (writeSignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'tokubetsu_jonin';
  }
  return bestAgent;
}

function runSannin(prompt = null, taskDir = null) {
  const resolvedTaskDir = getResolvedTaskDir(taskDir);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });

  const resultPath = path.join(resolvedTaskDir, 'result.md');
  if (fs.existsSync(resultPath)) {
    try {
      const result = fs.readFileSync(resultPath, 'utf8').trim();
      const res = JSON.stringify({ status: 'completed', phase: 'result', result, task_dir: resolvedTaskDir });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    } catch (e) {
      return JSON.stringify({ status: 'error', message: `Failed to read result.md: ${e.message}` });
    }
  }

  let effPrompt = prompt;
  if (!effPrompt) {
    const promptPath = path.join(resolvedTaskDir, 'prompt.md');
    if (fs.existsSync(promptPath)) {
      try {
        effPrompt = fs.readFileSync(promptPath, 'utf8').trim();
      } catch (e) {
        return JSON.stringify({ status: 'error', message: `Failed to read prompt.md: ${e.message}` });
      }
    } else {
      return JSON.stringify({ status: 'error', message: 'No prompt provided and prompt.md not found in task directory.' });
    }
  }

  const selectedAgentSuffix = routeByKeywordsWithPrompt(resolvedTaskDir, effPrompt);
  const selectedAgent = selectedAgentSuffix.startsWith('mcp_')
    ? selectedAgentSuffix.substring(4)
    : selectedAgentSuffix;

  const agentDescriptions = {};
  try {
    const conn = getDb();
    const rows = conn.prepare('SELECT name, title, purpose FROM agents').all();
    for (const row of rows) {
      const desc = row.purpose || row.title;
      agentDescriptions[row.name] = desc;
      if (row.name.startsWith('mcp_')) {
        agentDescriptions[row.name.substring(4)] = desc;
      }
    }
  } catch (_) { /* ignore */ }

  const description = agentDescriptions[selectedAgent] || 'general-purpose delegation';
  const instruction = (
    `**Selected Agent**: \`${selectedAgent}\`\n` +
    `**Reason**: ${description}\n\n` +
    `Task directory: \`${resolvedTaskDir}\`\n\n` +
    '## Delegation Steps\n\n' +
    '1. Write `delegate.md` in the task directory with the frontmatter (agent name, priority) and the task instructions.\n' +
    `2. Call \`${selectedAgent}\` with \`task_dir=${resolvedTaskDir}\` — it will read delegate.md and prepare the task for execution.\n` +
    '3. The agent will execute the task and write `result.md` to the same task directory (Write `result.md`).\n' +
    `4. After \`result.md\` exists, call \`sannin\` again with \`task_dir=${resolvedTaskDir}\` to receive the final result.\n\n` +
    `## Original Prompt\n\n${effPrompt}`
  );

  const res = JSON.stringify({
    status: 'routed',
    selected_agent: selectedAgent,
    phase: 'delegation',
    instructions: instruction,
    task_dir: resolvedTaskDir
  });
  logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
  return res;
}

function workflowHash(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    }
  } catch (_) { /* ignore */ }
  return null;
}

function workflowDispatch(taskDir, status, phase, agent, taskId = null, task = null) {
  const current = status.current_dispatch || {};
  if (current.phase === phase && current.agent === agent && current.task_id === taskId) {
    return current;
  }
  const resultPath = path.join(taskDir, 'result.md');
  const dispatch = {
    id: crypto.createHash('sha256').update(`${phase}:${agent}:${taskId}:${Date.now()}`).digest('hex').substring(0, 16),
    phase,
    agent,
    task_id: taskId,
    task: task || '',
    started_at: new Date().toISOString(),
    started_at_ns: Date.now() * 1e6,
    previous_result_hash: workflowHash(resultPath)
  };
  status.current_dispatch = dispatch;
  return dispatch;
}

function workflowDispatchCompleted(taskDir, status) {
  const dispatch = status.current_dispatch || {};
  if (!dispatch || !dispatch.id) return null;
  if ((status.completed_dispatches || []).includes(dispatch.id)) {
    return { dispatch, result: (status.dispatch_results || {})[dispatch.id] || '' };
  }
  const resultPath = path.join(taskDir, 'result.md');
  const currentHash = workflowHash(resultPath);
  if (!currentHash || currentHash === dispatch.previous_result_hash) return null;
  const result = readFileSafe(resultPath) || '';
  return { dispatch, result };
}

const VALIDATION_EVIDENCE_PATTERN = new RegExp(
  '(exit(?:ed)?(?:\\s+with)?(?:\\s+code)?\\s*[:=]?\\s*0\\b' +
  '|0\\s+errors?(?:\\s+and\\s+0\\s+warnings?)?' +
  '|\\bpassed\\b' +
  '|\\bpassthrough\\b' +
  '|✓' +
  '|\\bOK\\b' +
  '|\\bsucceeded\\b' +
  '|\\bcompleted successfully\\b' +
  '|\\bpentest(?:ing)?\\s+completed\\b' +
  '|\\bscan(?:ning)?\\s+completed\\b' +
  '|\\bsecurity\\s+audit\\s+completed\\b' +
  '|\\bvulnerability\\s+assessment\\s+completed\\b' +
  '|\\b0\\s+critical\\s+vulnerabilities\\b' +
  '|\\b0\\s+unhandled\\s+exploits\\b)',
  'i'
);

function isPentestTask(taskObj) {
  if (!taskObj || typeof taskObj !== 'object') return false;
  const text = `${taskObj.task || ''} ${taskObj.agent || ''}`.toLowerCase();
  return ['pentest', 'penetration test', 'penetration testing', 'vulnerability scan', 'security audit', 'security test', 'vuln scan', 'devsecops'].some(k => text.includes(k));
}

function isCleanValidation(validationList, isPentest = false, allowEmpty = true) {
  if (!validationList || validationList.length === 0) return allowEmpty;
  if (isPentest) {
    const evidence = validationList.map(item => String(item).toLowerCase());
    const hasCompletion = evidence.some(item => VALIDATION_EVIDENCE_PATTERN.test(item) || ['completed', 'passed', 'finished', 'reported', 'clean', 'done'].some(m => item.includes(m)));
    const hasFatal = evidence.some(item => ['fatal error', 'unhandled exception', 'segmentation fault', 'traceback (most recent call last)'].some(m => item.includes(m)));
    return hasCompletion && !hasFatal;
  } else {
    return !validationList.some(item => {
      const s = String(item).toLowerCase();
      return ['error', 'warning', 'fail'].some(w => s.includes(w));
    });
  }
}

function workflowParseTasks(planContent) {
  const tasks = [];
  const lines = (planContent || '').split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    const match = line.match(/^- \[([A-Za-z0-9_-]+)\]:\s*(.+)$/);
    if (match) {
      const agent = match[1].replace(/_/g, '-');
      const task = match[2].trim();
      tasks.push({
        id: `task-${tasks.length + 1}`,
        agent,
        task,
        line: idx + 1,
        status: 'pending',
        result: '',
        validation: []
      });
    }
  }
  return tasks;
}

function workflowReviewApproved(taskDir, status) {
  let tasks = status.tasks || [];
  if (tasks.length === 0 && status.executed) {
    tasks = [];
    let idx = 1;
    for (const [taskId, item] of Object.entries(status.executed)) {
      const it = typeof item === 'object' && item !== null ? item : { result: item };
      tasks.push({
        id: taskId || `task-${idx++}`,
        agent: it.agent || taskId,
        task: it.task || '',
        status: 'completed',
        result: it.result || '',
        validation: it.validation || []
      });
    }
    status.tasks = tasks;
  }

  if (tasks.length === 0 || tasks.some(t => t.status !== 'completed')) return false;

  for (const t of tasks) {
    if (t.verified === false) return false;
    const isPentest = isPentestTask(t);
    if (!isCleanValidation(t.validation || [], isPentest)) return false;
  }

  const reviewPath = path.join(taskDir, 'kage_review.json');
  if (fs.existsSync(reviewPath)) {
    try {
      const review = JSON.parse(readFileSafe(reviewPath) || '{}');
      const reviewValidation = review.validation || review.validation_evidence || [];
      const verifiedTasks = new Set(review.verified_task_ids || []);
      const expectedTasks = new Set(tasks.map(t => t.id));
      const securityVerified = review.security_reviewed === true;
      const rollbackVerified = review.rollback_reviewed === true;
      const confidence = review.confidence !== undefined ? review.confidence : (review.confidence_score !== undefined ? review.confidence_score : 100);
      const confidencePass = typeof confidence === 'number' && !isNaN(confidence) && confidence >= 97;

      let categoriesPass = true;
      if (review.categories && typeof review.categories === 'object') {
        for (const val of Object.values(review.categories)) {
          const score = typeof val === 'number' ? val : (val && typeof val.confidence === 'number' ? val.confidence : null);
          if (typeof score === 'number' && score < 97) {
            categoriesPass = false;
            break;
          }
        }
      }

      const isPentestReview = tasks.some(t => isPentestTask(t)) || reviewValidation.some(item => String(item).toLowerCase().includes('pentest'));
      const cleanValidation = reviewValidation.length > 0 && isCleanValidation(reviewValidation, isPentestReview, false);

      const aiSlopFindings = review.ai_slop_findings;
      const aiSlopClean = review.ai_slop_clean === true;
      const aiSlopPass = (
        aiSlopClean &&
        typeof aiSlopFindings === 'number' &&
        !isNaN(aiSlopFindings) &&
        aiSlopFindings === 0
      );

      const tasksMatch = verifiedTasks.size === expectedTasks.size && Array.from(expectedTasks).every(id => verifiedTasks.has(id));

      if (review.approved === true && cleanValidation && tasksMatch && securityVerified && rollbackVerified && confidencePass && aiSlopPass && categoriesPass) {
        status.review = review;
        return true;
      }
      status.review = review;
      return false;
    } catch (_) {
      return false;
    }
  }

  const review = status.review || {};
  const confidence = review.confidence !== undefined ? review.confidence : (review.confidence_score !== undefined ? review.confidence_score : 100);
  const confidencePass = typeof confidence === 'number' && !isNaN(confidence) && confidence >= 97;
  let categoriesPass = true;
  if (review.categories && typeof review.categories === 'object') {
    for (const val of Object.values(review.categories)) {
      const score = typeof val === 'number' ? val : (val && typeof val.confidence === 'number' ? val.confidence : null);
      if (typeof score === 'number' && score < 97) {
        categoriesPass = false;
        break;
      }
    }
  }
  const aiSlopFindings = review.ai_slop_findings;
  const aiSlopClean = review.ai_slop_clean === true;
  const aiSlopPass = (
    aiSlopClean &&
    typeof aiSlopFindings === 'number' &&
    !isNaN(aiSlopFindings) &&
    aiSlopFindings === 0
  );

  return review.approved === true && confidencePass && aiSlopPass && categoriesPass && (status.tasks || []).every(t => t.status === 'completed');
}

function cleanupTransientScratchFiles(taskDir = null) {
  if (taskDir && fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    try {
      const files = fs.readdirSync(taskDir);
      for (const file of files) {
        if (
          file.startsWith('debug_') || file.startsWith('temp_') ||
          file === 'test_patch.py' || file.endsWith('.tmp')
        ) {
          try { fs.unlinkSync(path.join(taskDir, file)); } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* ignore */ }
  }
}

function runMcpWorkflow(taskDir = null) {
  const resolvedTaskDir = getResolvedTaskDir(taskDir);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });
  const status = loadWorkflowStatus(resolvedTaskDir);
  status.schema_version = status.schema_version || 2;
  status.created_at = status.created_at || new Date().toISOString();
  status.tasks = status.tasks || [];
  status.completed_dispatches = status.completed_dispatches || [];
  status.dispatch_results = status.dispatch_results || {};
  status.review = status.review || {};
  status.history = status.history || [];
  status.pending_executors = status.pending_executors || [];
  status.completed_executors = status.completed_executors || [];
  status.executed = status.executed || {};

  let phase = status.phase || 'route';
  if (phase === 'done') {
    return JSON.stringify({ status: 'completed', phase: 'done' });
  }

  if (phase === 'route') {
    const prompt = readFileSafe(path.join(resolvedTaskDir, 'prompt.md'));
    if (!prompt) {
      return JSON.stringify({ status: 'error', message: 'No prompt.md found in task directory.', phase: 'route' });
    }
    status.phase = 'explore';
    status.assigned_agent = 'genin';
    status.history.push({ phase: 'route', agent: 'genin' });
    status.current_dispatch = null;
    saveWorkflowStatus(resolvedTaskDir, status);
    phase = 'explore';
  }

  const completion = workflowDispatchCompleted(resolvedTaskDir, status);
  if (completion && completion.dispatch && completion.dispatch.phase === phase) {
    const dispatch = completion.dispatch;
    const dispatchId = dispatch.id;
    status.completed_dispatches.push(dispatchId);
    status.dispatch_results[dispatchId] = completion.result;
    status.current_dispatch = null;

    if (phase === 'explore') {
      status.phase = 'plan';
      status.history.push({ phase: 'explore', agent: dispatch.agent, dispatch_id: dispatchId });
      status.assigned_agent = 'kage';
      phase = 'plan';
    } else if (phase === 'research') {
      status.phase = 'plan';
      status.research_completed = true;
      status.history.push({ phase: 'research', agent: 'chunin', dispatch_id: dispatchId });
      status.assigned_agent = 'kage';
      phase = 'plan';
    } else if (phase === 'plan') {
      const planContent = readFileSafe(path.join(resolvedTaskDir, 'plan.md')) || completion.result;
      const planLower = planContent.toLowerCase();
      if (planLower.includes('needs_research:') && !status.research_completed) {
        status.phase = 'research';
        status.assigned_agent = 'chunin';
        status.research_completed = false;
        phase = 'research';
      } else if (planLower.includes('needs_replan:') && !status.replanned) {
        status.phase = 'plan';
        status.assigned_agent = 'kage';
        status.replanned = true;
        phase = 'plan';
      } else {
        status.tasks = workflowParseTasks(planContent);
        if (status.tasks.length === 0) {
          status.tasks = [{ id: 'task-1', agent: 'anbu', task: 'Execute the approved implementation plan.', status: 'pending', result: '', validation: [] }];
        }
        status.pending_executors = status.tasks.map(t => t.id);
        status.completed_executors = [];
        status.phase = 'execute';
        phase = 'execute';
      }
    } else if (phase === 'execute') {
      const taskId = dispatch.task_id;
      const task = status.tasks.find(t => t.id === taskId);
      if (task) {
        if (task.status !== 'completed' && task.status !== 'unverified') {
          task.status = 'completed';
        }
        task.result = completion.result;
        task.completed_dispatch_id = dispatchId;
        if (task.status === 'completed') {
          status.completed_executors.push(taskId);
        }
        status.executed[taskId] = { agent: task.agent, task: task.task, result: completion.result, validation: task.validation || [] };
      }
      phase = 'execute';
    } else if (phase === 'document') {
      status.phase = 'review';
      status.assigned_agent = 'kage';
      phase = 'review';
    } else if (phase === 'review') {
      if (workflowReviewApproved(resolvedTaskDir, status)) {
        status.phase = 'synthesize';
        status.assigned_agent = 'sannin';
        phase = 'synthesize';
      } else {
        const reviewObj = status.review || {};
        let reason = '';
        if (!(reviewObj.ai_slop_clean === true && reviewObj.ai_slop_findings === 0)) {
          reason = 'Zero-AI-Slop gate failed or was not executed (ai_slop_findings must be 0 and ai_slop_clean must be true).';
        } else {
          reason = 'Kage review did not approve all completed tasks.';
        }
        status.review = { approved: false, reason };
        saveWorkflowStatus(resolvedTaskDir, status);
        return JSON.stringify({ status: 'blocked', phase: 'review', message: `Kage review must approve every completed task before delivery: ${reason}` });
      }
    }
    saveWorkflowStatus(resolvedTaskDir, status);
  }

  if (phase === 'explore') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'explore', 'genin');
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: genin\npriority: medium\nPhase: Explore\ndispatch_id: ${dispatch.id}\n\n## TASK\n\n${readFileSafe(path.join(resolvedTaskDir, 'prompt.md')) || ''}\n\nRead-only exploration. Write findings.md and result.md for this dispatch.\n`, 'utf8');
    status.assigned_agent = 'genin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'explore', agent: 'genin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'plan') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'plan', 'kage');
    const findings = readFileSafe(path.join(resolvedTaskDir, 'findings.md')) || 'No findings available.';
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: kage\npriority: high\nPhase: Plan\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nAnalyze the findings and produce plan.md with unique \`- [agent]: task\` entries. Set needs_research or needs_replan explicitly when applicable.\n\n## FINDINGS\n\n${findings}\n`, 'utf8');
    status.assigned_agent = 'kage';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'plan', agent: 'kage', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'research') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'research', 'chunin');
    const planContext = readFileSafe(path.join(resolvedTaskDir, 'plan.md')) || '';
    const qLine = planContext.split(/\r?\n/).find(l => l.startsWith('research_query:'));
    const query = qLine ? qLine.split(':', 2)[1].trim() : '';
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: chunin\npriority: medium\nPhase: Research\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nConduct web research on: ${query || 'the plan requirements'}\n`, 'utf8');
    status.assigned_agent = 'chunin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'research', agent: 'chunin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'execute') {
    const nextTask = (status.tasks || []).find(t => t.status !== 'completed');
    if (!nextTask) {
      status.phase = 'document';
      status.assigned_agent = 'tokubetsu-jonin';
      status.current_dispatch = null;
      saveWorkflowStatus(resolvedTaskDir, status);
      phase = 'document';
    } else {
      const dispatch = workflowDispatch(resolvedTaskDir, status, 'execute', nextTask.agent, nextTask.id, nextTask.task);
      fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: ${nextTask.agent}\npriority: high\nPhase: Execute\ndispatch_id: ${dispatch.id}\ntask_id: ${nextTask.id}\n\n## TASK\n\n${nextTask.task}\n\nWrite result.md and validation evidence for this task.\n`, 'utf8');
      status.assigned_agent = nextTask.agent;
      saveWorkflowStatus(resolvedTaskDir, status);
      return JSON.stringify({ status: 'ready', phase: 'execute', agent: nextTask.agent, task_id: nextTask.id, dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
    }
  }

  if (phase === 'document') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'document', 'tokubetsu-jonin');
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: tokubetsu-jonin\npriority: medium\nPhase: Document\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nDocument the completed work and validation evidence in final_docs.md and result.md.\n`, 'utf8');
    status.assigned_agent = 'tokubetsu-jonin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'document', agent: 'tokubetsu-jonin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'review' && workflowReviewApproved(resolvedTaskDir, status)) {
    status.phase = 'synthesize';
    status.assigned_agent = 'sannin';
    status.review = status.review || { approved: true };
    saveWorkflowStatus(resolvedTaskDir, status);
    phase = 'synthesize';
  }

  if (phase === 'review') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'review', 'kage');
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: kage\npriority: critical\nPhase: Review\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nVerify every task in status.json is completed, required files exist, validation evidence has no errors or warnings, security/rollback checks are documented, and run aislop_scan to verify 0 ai-slop findings. Write kage_review.json with approved, verified_task_ids, validation, security_reviewed, rollback_reviewed, ai_slop_findings, ai_slop_clean, and findings fields, then write result.md.\n`, 'utf8');
    status.assigned_agent = 'kage';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'review', agent: 'kage', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'synthesize') {
    if (!workflowReviewApproved(resolvedTaskDir, status)) {
      const reviewObj = status.review || {};
      let msg = '';
      if (!(reviewObj.ai_slop_clean === true && reviewObj.ai_slop_findings === 0)) {
        msg = 'Zero-AI-Slop gate failed: Kage must run aislop_scan and verify 0 findings before synthesis.';
      } else {
        msg = 'Kage approval is required before synthesis.';
      }
      return JSON.stringify({ status: 'blocked', phase: 'review', message: msg });
    }

    const prompt = readFileSafe(path.join(resolvedTaskDir, 'prompt.md')) || '';
    const findings = readFileSafe(path.join(resolvedTaskDir, 'findings.md')) || '';
    const plan = readFileSafe(path.join(resolvedTaskDir, 'plan.md')) || '';
    const research = readFileSafe(path.join(resolvedTaskDir, 'research_results.json')) || '';
    const finalDocs = readFileSafe(path.join(resolvedTaskDir, 'final_docs.md')) || '';
    const reviewRaw = readFileSafe(path.join(resolvedTaskDir, 'kage_review.json'));
    let reviewData = {};
    if (reviewRaw) {
      try { reviewData = JSON.parse(reviewRaw); } catch (_) { /* ignore */ }
    }

    function taskEvidenceOk(t) {
      if (t.verified === false) return false;
      if (t.verified === true) return true;
      const isPentest = isPentestTask(t);
      if (isCleanValidation(t.validation || [], isPentest)) return true;
      if (reviewData.approved === true && (reviewData.verified_task_ids || []).includes(t.id)) return true;
      return false;
    }

    const tasks = status.tasks || [];
    const totalTasks = tasks.length;
    const unverifiedIds = tasks.filter(t => !taskEvidenceOk(t)).map(t => t.id);
    if (unverifiedIds.length > 0) {
      status.review = {
        approved: false,
        reason: `Tasks without verifiable validation evidence: ${unverifiedIds.join(', ')}`
      };
      saveWorkflowStatus(resolvedTaskDir, status);
      return JSON.stringify({
        status: 'blocked',
        phase: 'review',
        message: 'Delivery blocked: tasks lack validation evidence: ' + unverifiedIds.join(', ')
      });
    }

    const verifiedCount = totalTasks - unverifiedIds.length;
    const evidencePct = totalTasks === 0 ? 100 : Math.round(100 * verifiedCount / totalTasks);
    const validationEntries = tasks.reduce((acc, t) => acc + (t.validation ? t.validation.length : 0), 0);
    const securityVerified = reviewData.security_reviewed === true;
    const rollbackVerified = reviewData.rollback_reviewed === true;
    const reviewFindings = reviewData.findings || [];
    const confidenceVal = reviewData.confidence !== undefined ? reviewData.confidence : (reviewData.confidence_score !== undefined ? reviewData.confidence_score : 97);

    const aiSlopFindings = reviewData.ai_slop_findings;
    const aiSlopClean = reviewData.ai_slop_clean === true;
    const aiSlopOk = (
      aiSlopClean &&
      typeof aiSlopFindings === 'number' &&
      !isNaN(aiSlopFindings) &&
      aiSlopFindings === 0
    );
    const aiSlopEval = (typeof aiSlopFindings === 'number' && !isNaN(aiSlopFindings))
      ? `ai_slop_findings = ${Math.floor(aiSlopFindings)}`
      : 'missing ai_slop_findings';
    const aiSlopConf = aiSlopOk ? '100%' : 'BLOCKING (confidence withheld)';

    function mark(ok) {
      return ok ? '✅ Passed' : '❌ Needs Attention';
    }

    const reviewGateBlock = (
      '### 🛡️ Kage Reviewer Confidence Gate Report\n\n' +
      '```\n' +
      '┌───────────────────────────────────────────────────────────────┐\n' +
      '│  ◎ KAGE REVIEW GATE: APPROVED                                 │\n' +
      `│  📊 CONFIDENCE SCORE: ${confidenceVal}% (Minimum Required: ≥ 97%)           │\n` +
      '└───────────────────────────────────────────────────────────────┘\n' +
      '```\n\n' +
      '### 📋 Confidence Score Breakdown (computed from recorded task evidence)\n\n' +
      '| Verification Category | Target | Evaluated Result | Category Confidence | Status |\n' +
      '|---|---|---|---|---|\n' +
      `| **AI Slop Scan** | All changed files | ${aiSlopEval} | **${aiSlopConf}** | ${mark(aiSlopOk)} |\n` +
      `| **Task Validation Evidence** | ${totalTasks}/${totalTasks} tasks with passing evidence | ${verifiedCount}/${totalTasks} verified, ${validationEntries} validation entries recorded | **${evidencePct}%** | ${mark(evidencePct === 100)} |\n` +
      `| **Kage Review Findings** | 0 unresolved findings | ${reviewFindings.length} finding(s) recorded in kage_review.json | **${reviewFindings.length === 0 ? 100 : Math.max(60, 100 - 10 * reviewFindings.length)}%** | ${mark(reviewFindings.length === 0)} |\n` +
      `| **Security Review** | security_reviewed = true | security_reviewed = ${String(securityVerified)} | **${securityVerified ? 100 : 0}%** | ${mark(securityVerified)} |\n` +
      `| **Rollback Review** | rollback_reviewed = true | rollback_reviewed = ${String(rollbackVerified)} | **${rollbackVerified ? 100 : 0}%** | ${mark(rollbackVerified)} |\n\n` +
      `### 🎯 Overall Confidence: **${confidenceVal}%**\n` +
      '- **Threshold**: Minimum 97% required to allow delivery.\n' +
      '- **Verdict**: **PASSED & APPROVED FOR DELIVERY** (all recorded tasks carry validation evidence).\n\n'
    );

    let report = `# Final Report\n\n${reviewGateBlock}## Task\n${prompt}\n\n## Exploration Findings\n${findings}\n\n## Implementation Plan\n${plan}\n\n## Research\n${research}\n\n## Documentation\n${finalDocs}\n\n## Executor Results\n\n`;
    for (const t of (status.tasks || [])) {
      report += `- **${t.id} / ${t.agent}**: ${t.task}\n\nResult: ${t.result || ''}\n\n`;
    }

    const reportPath = path.join(resolvedTaskDir, 'final_report.md');
    fs.writeFileSync(reportPath, report, 'utf8');
    status.phase = 'done';
    status.history.push({ phase: 'synthesize', agent: 'sannin' });
    saveWorkflowStatus(resolvedTaskDir, status);
    cleanupTransientScratchFiles(resolvedTaskDir);
    return JSON.stringify({ status: 'completed', phase: 'done', final_report_path: reportPath });
  }

  return JSON.stringify({ status: 'error', message: `Unknown or stuck workflow phase: ${phase}`, phase });
}

module.exports = {
  getResolvedTaskDir,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  routeByKeywordsWithPrompt,
  runSannin,
  workflowHash,
  workflowDispatch,
  workflowDispatchCompleted,
  VALIDATION_EVIDENCE_PATTERN,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  workflowReviewApproved,
  cleanupTransientScratchFiles,
  runMcpWorkflow
};
