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

// ── 100% AI-Slop Gate (mechanical enforcement) ─────────────────────────────
// When the project has a quality-gate config (.aislop/config.yml), the review
// phase MUST end with a perfect 100/100 aislop scan (zero findings of ANY
// severity) before the workflow may synthesize. The gate result is cached in
// the workflow status so every sannin call in the review phase re-checks the
// cached verdict instead of re-scanning. Skipped only in hermetic test runs
// (KONOHA_DB_PATH isolation), where scan targets are throwaway temp dirs.
const AISLOP_GATE_TIMEOUT_MS = 180000;

function runAislopGate(projectPath, status) {
  if (process.env.KONOHA_DB_PATH) return { enforced: false, reason: 'test isolation' };
  if (!fs.existsSync(path.join(projectPath, '.aislop', 'config.yml'))) {
    return { enforced: false, reason: 'no quality-gate config' };
  }
  if (status && status.aislop_gate && status.aislop_gate.ok) return status.aislop_gate;
  let result;
  try {
    const { spawnSync } = require('child_process');
    const isWin = process.platform === 'win32';
    let scanArgs = ['-y', 'aislop', 'scan', '--json'];
    if (status && Array.isArray(status.changed_files) && status.changed_files.length > 0) {
      scanArgs.push(...status.changed_files);
    } else {
      // Scope to changed files to prevent massive multi-megabyte full-repo token burns
      scanArgs.push('--changes');
    }
    const npxCmd = isWin ? 'npx.cmd' : 'npx';
    let res = spawnSync(npxCmd, scanArgs, {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: AISLOP_GATE_TIMEOUT_MS,
      shell: isWin,
    });
    // Fail closed if --changes cannot run (e.g. non-git directory): never fall
    // back to an unscoped full-repo scan — that violates the strict changed-files
    // token-hygiene mandate.
    if (res.status !== 0 && (res.stderr || '').includes('git')) {
      if (status) status.aislop_gate = { enforced: true, ok: false, reason: 'changed-files scope unavailable (git error); refusing unscoped full-repo scan' };
      return status ? status.aislop_gate : { enforced: true, ok: false, reason: 'changed-files scope unavailable (git error); refusing unscoped full-repo scan' };
    }
    const out = (res.stdout || '');
    const jsonStart = out.indexOf('{');
    if (jsonStart === -1) {
      result = { enforced: true, ok: false, reason: 'aislop scanner unavailable' };
    } else {
      const parsed = JSON.parse(out.slice(jsonStart));
      const findings = (parsed.diagnostics || []).length;
      result = {
        enforced: true,
        ok: parsed.score === 100 && findings === 0,
        score: parsed.score,
        findings,
        label: parsed.label || null,
      };
    }
  } catch (e) {
    result = { enforced: true, ok: false, reason: 'gate error: ' + e.message };
  }
  if (status) status.aislop_gate = result;
  return result;
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

  let conn = null;
  try {
    conn = getDb();
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
  } catch (_) { /* ignore */ } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  if (!bestAgent) bestAgent = 'kage';
  const writeSignals = ['prd', 'write a prd', 'technical doc', 'write the doc', 'draft the doc', 'write docs', 'author', 'write a spec'];
  if (writeSignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'tokubetsu_jonin';
  }
  return bestAgent;
}

function detectParallelWorkstreams(prompt = '') {
  if (!prompt || typeof prompt !== 'string') return [];
  const p = prompt.toLowerCase();
  const streams = [];

  const hasBackend = /\b(backend|api|database|postgres|redis|sql|server|endpoint|devops|docker|kubernetes|helm|ci\/cd|pipeline)\b/i.test(p);
  const hasFrontend = /\b(frontend|ui|component|tailwind|layout|page|css|html|react|vue|svelte|nuxt|angular)\b/i.test(p);
  const hasDocs = /\b(documentation|readme|docs|runbook|api spec|postmortem|guide|technical doc)\b/i.test(p);
  const hasResearch = /\b(research|web search|lookup|find evidence|citations|source evaluation)\b/i.test(p);

  if (hasBackend) {
    streams.push({ agent: 'anbu', domain: 'backend', role: 'Backend API, database & infrastructure deployment' });
  }
  if (hasFrontend) {
    streams.push({ agent: 'jonin', domain: 'frontend', role: 'Frontend UI, components & responsive layout' });
  }
  if (hasDocs) {
    streams.push({ agent: 'tokubetsu-jonin', domain: 'documentation', role: 'Technical documentation, README & runbooks' });
  }
  if (hasResearch) {
    streams.push({ agent: 'chunin', domain: 'research', role: 'Intel research, external docs & evidence synthesis' });
  }

  return streams;
}

function runSannin(prompt = null, taskDir = null) {
  const resolvedTaskDir = getResolvedTaskDir(taskDir);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });

  // Stale-state guard: task directories are reused across prompts (the default
  // resolver returns the most-recently-modified dir). If a NEW prompt is supplied
  // and it differs from the stored prompt.md, any existing result.md / status.json
  // / delegate.md artifacts belong to a PREVIOUS task and must never be returned
  // or reused. Without this guard, sannin instantly "completes" every new task
  // with the previous task's result, which makes the workflow appear to never run.
  const promptPath = path.join(resolvedTaskDir, 'prompt.md');
  const storedPrompt = readFileSafe(promptPath);
  const normalizedPrompt = (s) => (s || '').replace(/\r\n/g, '\n').trim();
  const resultPath = path.join(resolvedTaskDir, 'result.md');
  const isNewTaskInReusedDir =
    prompt !== null &&
    (storedPrompt === null || normalizedPrompt(prompt) !== normalizedPrompt(storedPrompt));

  if (isNewTaskInReusedDir) {
    const staleArtifacts = [
      'result.md', 'status.json', 'delegate.md', 'plan.md',
      'findings.md', 'kage_review.json', 'final_docs.md',
    ];
    for (const f of staleArtifacts) {
      try { fs.rmSync(path.join(resolvedTaskDir, f), { force: true }); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  if (fs.existsSync(resultPath)) {
    try {
      const result = fs.readFileSync(resultPath, 'utf8').trim();
      const taskId = path.basename(resolvedTaskDir);
      try {
        const sdlcManager = require('../sdlc_manager');
        sdlcManager.updateTask(taskId, { status: 'completed' });
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      const res = JSON.stringify({ status: 'completed', phase: 'result', result, task_dir: resolvedTaskDir });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    } catch (e) {
      return JSON.stringify({ status: 'error', message: `Failed to read result.md: ${e.message}` });
    }
  }

  let effPrompt = prompt;
  if (!effPrompt) {
    if (fs.existsSync(promptPath)) {
      try {
        effPrompt = fs.readFileSync(promptPath, 'utf8').trim();
      } catch (e) {
        return JSON.stringify({ status: 'error', message: `Failed to read prompt.md: ${e.message}` });
      }
    } else {
      return JSON.stringify({ status: 'error', message: 'No prompt provided and prompt.md not found in task directory.' });
    }
  } else {
    try {
      fs.writeFileSync(path.join(resolvedTaskDir, 'prompt.md'), effPrompt, 'utf8');
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const sdlcManager = require('../sdlc_manager');
  const { getWorkspaceRoot } = require('./runtime_state');
  const projectPath = getWorkspaceRoot() || process.cwd();
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(projectPath);
  const dorResult = sdlcManager.checkReadiness(effPrompt, projectPath);
  const taskId = path.basename(resolvedTaskDir);

  try {
    sdlcManager.createTask({
      id: taskId,
      description: effPrompt,
      status: (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) ? 'blocked' : 'in_progress',
      dor_result: dorResult,
      project_path: projectPath
    });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    const res = JSON.stringify({
      status: 'blocked',
      phase: 'dor',
      message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address the missing items before dispatching.',
      missing: dorResult.missing,
      dor_result: dorResult,
      task_dir: resolvedTaskDir
    });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return res;
  }

  const selectedAgentSuffix = routeByKeywordsWithPrompt(resolvedTaskDir, effPrompt);
  const selectedAgent = selectedAgentSuffix.startsWith('mcp_')
    ? selectedAgentSuffix.substring(4)
    : selectedAgentSuffix;

  const agentDescriptions = {};
  let descConn = null;
  try {
    descConn = getDb();
    const rows = descConn.prepare('SELECT name, title, purpose FROM agents').all();
    for (const row of rows) {
      const desc = row.purpose || row.title;
      agentDescriptions[row.name] = desc;
      if (row.name.startsWith('mcp_')) {
        agentDescriptions[row.name.substring(4)] = desc;
      }
    }
  } catch (_) { /* ignore */ } finally {
    if (descConn) {
      try { descConn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  const description = agentDescriptions[selectedAgent]
    || agentDescriptions[selectedAgent.replace(/_/g, '-')]
    || agentDescriptions[selectedAgent.replace(/-/g, '_')]
    || 'general-purpose delegation';

  let advisoryText = '';
  if (!dorResult.ready && dorResult.missing && dorResult.missing.length > 0) {
    advisoryText = (
      '\n\n### ⚠️ Definition-of-Readiness (DoR) Advisory Hints\n' +
      dorResult.missing.map(m => `- ${m}`).join('\n') +
      '\n*Note: Advisory mode — subagent should clarify or resolve these open questions during execution.*'
    );
  }

  let buildGuidance = '';
  if (selectedAgent === 'jonin' || /\b(website|web\s*app|landing\s*page|frontend|storefront|portfolio|dashboard|scaffold.*ui)\b/i.test(effPrompt)) {
    buildGuidance = (
      '\n\n### ⚡ Website & UI Scaffolding Notice\n' +
      '- For text-based builds, call `konoha.build_from_text(name, description, framework)` FIRST to get framework-native directives and mandatory Konoha design invariants (far-left logo, no mobile hamburger, fixed mobile dock, floating bottom-left 10-theme switcher, hero carousel).\n' +
      '- For mockup builds with images, call `konoha.build_from_source(name, source_dir, framework)` FIRST.\n' +
      '- Pass the returned directives into `delegate.md` under constraints before delegating to `jonin`.\n' +
      '- Jonin implements the complete working website with an inline `README.md` and validates cleanly via framework validation commands. DO NOT delegate to `tokubetsu_jonin` or other subagents unless technical documentation was explicitly requested by the user.'
    );
  }

  const parallelWorkstreams = detectParallelWorkstreams(effPrompt);
  let parallelGuidance = '';
  if (parallelWorkstreams.length > 1) {
    parallelGuidance = (
      '\n\n### ⚡ Parallel Execution Opportunity (Time-Saving)\n' +
      `- Multi-domain workstreams detected: ${parallelWorkstreams.map(w => `\`${w.agent}\` (${w.domain})`).join(', ')}.\n` +
      '- For maximum execution time savings, once architectural interfaces are locked in `plan.md`, the orchestrator can dispatch independent workstreams concurrently before merging at the Kage review gate.'
    );
  }

  const instruction = (
    `**Selected Agent**: \`${selectedAgent}\`\n` +
    `**Reason**: ${description}\n\n` +
    `Task directory: \`${resolvedTaskDir}\`\n\n` +
    '## Delegation Steps\n\n' +
    '1. Write `delegate.md` in the task directory with the frontmatter (agent name, priority) and the task instructions.\n' +
    `2. Call \`${selectedAgent}\` with \`task_dir=${resolvedTaskDir}\` — it will read delegate.md and prepare the task for execution.\n` +
    '3. The agent will execute the task and write `result.md` to the same task directory (Write `result.md`).\n' +
    `4. After \`result.md\` exists, call \`sannin\` again with \`task_dir=${resolvedTaskDir}\` to receive the final result.\n\n` +
    `## Original Prompt\n\n${effPrompt}` +
    advisoryText +
    buildGuidance +
    parallelGuidance
  );

  const res = JSON.stringify({
    status: 'routed',
    selected_agent: selectedAgent,
    parallel_eligible: parallelWorkstreams.length > 1,
    parallel_workstreams: parallelWorkstreams.length > 1 ? parallelWorkstreams : undefined,
    phase: 'delegation',
    instructions: instruction,
    task_dir: resolvedTaskDir,
    dor_result: dorResult
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
      let s = String(item).toLowerCase();
      // Strip explicit zero-count success phrases first — canonical evidence
      // like "0 errors and 0 warnings" or "exit code 0" must count as clean,
      // while "2 errors" or "build failed" must still count as dirty
      s = s
        .replace(/\b0\s+errors?\s*(?:and|&)?\s*(?:0\s+warnings?)?/g, '')
        .replace(/\b0\s+warnings?/g, '')
        .replace(/\b0\s+(?:critical\s+)?vulnerabilities\b/g, '')
        .replace(/\b0\s+unhandled\s+exploits\b/g, '')
        .replace(/exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*[:=]?\s*0\b/g, '');
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

      status.review = review;
      // Native SDLC Governance: Evaluate anti-slop Delivery Gate & Independence
      try {
        const sdlcManager = require('../sdlc_manager');
        const slopGate = sdlcManager.evaluateAntiSlopDeliveryGate(review);
        status.slop_result = slopGate;
        const rootTaskId = path.basename(taskDir || '');
        if (rootTaskId) {
          sdlcManager.recordSlopResult(rootTaskId, slopGate, status.slop_cycles || 0);
        }
        for (const t of tasks) {
          const implAgent = t.agent || 'anbu';
          const independence = sdlcManager.detectReviewIndependence(implAgent, 'kage');
          sdlcManager.updateTask(t.id, { review_mode: independence.reviewMode });
          sdlcManager.recordSlopResult(t.id, slopGate, status.slop_cycles || 0);
        }
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

      for (const t of tasks) {
        if (t.id && t.id.startsWith('slop-fix-') && aiSlopPass) {
          verifiedTasks.add(t.id);
        }
      }

      const tasksMatch = Array.from(expectedTasks).every(id => verifiedTasks.has(id));

      if (review.approved === true && cleanValidation && tasksMatch && securityVerified && rollbackVerified && confidencePass && aiSlopPass && categoriesPass) {
        return true;
      }
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
        try {
          const sdlcManager = require('../sdlc_manager');
          for (const t of status.tasks) {
            sdlcManager.createTask({
              id: t.id,
              description: t.task,
              status: 'in_progress',
              project_path: resolvedTaskDir
            });
          }
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
        const isSlopFail = !(reviewObj.ai_slop_clean === true && reviewObj.ai_slop_findings === 0);
        if (isSlopFail) {
          reason = 'Zero-AI-Slop gate failed or was not executed (ai_slop_findings must be 0 and ai_slop_clean must be true).';
        } else {
          reason = 'Kage review did not approve all completed tasks.';
        }
        status.review = {
          ...reviewObj,
          approved: false,
          reason,
          findings: reviewObj.findings || []
        };

        // SDLC Remediation loop: active by default (remediation_loop === false
        // opts out), bounded by the delegation-depth circuit breaker. Only fires
        // when the Delivery Gate actually reported findings; a review that never
        // ran the gate (missing ai_slop fields) stays blocked for re-review.
        const slopFindingsCount = typeof reviewObj.ai_slop_findings === 'number'
          ? reviewObj.ai_slop_findings
          : (Array.isArray(reviewObj.findings) ? reviewObj.findings.length : 0);
        const hasSlopFindings = slopFindingsCount > 0;
        if (isSlopFail && hasSlopFindings && status.remediation_loop !== false) {
          status.slop_cycles = (status.slop_cycles || 0) + 1;
          if (status.slop_cycles > 7) {
            status.status = 'blocked';
            saveWorkflowStatus(resolvedTaskDir, status);
            return JSON.stringify({
              status: 'blocked',
              phase: 'review',
              message: `Delegation depth circuit breaker tripped (> 7 slop remediation cycles). Slop findings: ${reason}`,
              slop_cycles: status.slop_cycles,
              findings: reviewObj.findings || []
            });
          }

          const sdlcManager = require('../sdlc_manager');
          const fixTaskText = sdlcManager.generateSlopFixTask(status.slop_result || { findings: reviewObj.findings });
          const fixTaskId = `slop-fix-${status.slop_cycles}`;

          // Determine remediation agent (jonin vs anbu) based on findings and tasks
          let remediationAgent = 'anbu';
          const executedAgents = Object.values(status.executed || {}).map(e => e.agent).filter(Boolean);
          const taskAgents = (status.tasks || []).map(t => t.agent).filter(Boolean);
          const findingsText = (reviewObj.findings || []).map(f => typeof f === 'string' ? f : (f.description || f.rule || '')).join(' ').toLowerCase();
          const isUiRelated = /ui|css|frontend|style|tailwind|component|html|layout|vue|svelte|react|next|angular|design/i.test(findingsText);

          if (isUiRelated && (executedAgents.includes('jonin') || taskAgents.includes('jonin'))) {
            remediationAgent = 'jonin';
          } else if (executedAgents.length > 0) {
            const lastExecuted = executedAgents[executedAgents.length - 1];
            remediationAgent = lastExecuted || 'anbu';
          } else if (taskAgents.length > 0) {
            remediationAgent = taskAgents[0];
          }

          const remediationTask = {
            id: fixTaskId,
            agent: remediationAgent,
            task: fixTaskText,
            status: 'pending',
            result: '',
            validation: []
          };
          try {
            sdlcManager.createTask({
              id: fixTaskId,
              description: fixTaskText,
              status: 'in_progress',
              project_path: resolvedTaskDir
            });
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

          status.tasks = status.tasks || [];
          status.tasks.push(remediationTask);
          status.pending_executors = [fixTaskId];
          status.phase = 'execute';
          status.assigned_agent = remediationAgent;
          saveWorkflowStatus(resolvedTaskDir, status);

          const dispatch = workflowDispatch(resolvedTaskDir, status, 'execute', remediationAgent, fixTaskId, fixTaskText);
          const agentUpper = remediationAgent.charAt(0).toUpperCase() + remediationAgent.slice(1);
          fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: ${remediationAgent}\npriority: high\nPhase: Remediation (Anti-Slop Cycle ${status.slop_cycles})\ndispatch_id: ${dispatch.id}\n\n## TASK\n\n${fixTaskText}\n\n## REMEDIATION GATE (TWO-STEP, TARGET 100%)\n\nFix every finding, then re-run the full two-step review: Step 1 \`aislop_scan\` (aislop scanner) → Step 2 \`anti-slop\` rule review. The synthesis gate mechanically requires a perfect 100/100 scan (zero findings of any severity).\n`, 'utf8');

          return JSON.stringify({
            status: 'remediation',
            phase: 'execute',
            agent: remediationAgent,
            dispatch_id: dispatch.id,
            task_dir: resolvedTaskDir,
            slop_cycles: status.slop_cycles,
            message: `Anti-slop Delivery Gate reported findings. Dispatched remediation task to ${agentUpper} (cycle ${status.slop_cycles}).`
          });
        }

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
    const query = qLine ? qLine.slice('research_query:'.length).trim() : '';
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: chunin\npriority: medium\nPhase: Research\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nConduct web research on: ${query || 'the plan requirements'}\n`, 'utf8');
    status.assigned_agent = 'chunin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'research', agent: 'chunin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir });
  }

  if (phase === 'execute') {
    const nextTask = (status.tasks || []).find(t => t.status !== 'completed');
    if (!nextTask) {
      if (status.slop_cycles && status.slop_cycles > 0) {
        status.phase = 'review';
        status.assigned_agent = 'kage';
        status.current_dispatch = null;
        saveWorkflowStatus(resolvedTaskDir, status);
        phase = 'review';
      } else {
        status.phase = 'document';
        status.assigned_agent = 'tokubetsu-jonin';
        status.current_dispatch = null;
        saveWorkflowStatus(resolvedTaskDir, status);
        phase = 'document';
      }
    } else {
      const dispatch = workflowDispatch(resolvedTaskDir, status, 'execute', nextTask.agent, nextTask.id, nextTask.task);
      fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: ${nextTask.agent}\npriority: high\nPhase: Execute\ndispatch_id: ${dispatch.id}\ntask_id: ${nextTask.id}\n\n## TASK\n\n${nextTask.task}\n\n## DELIVERY GATE (TWO-STEP, TARGET 100%)\n\nBefore writing result.md: Step 1 run \`aislop_scan\` (aislop scanner) on all changed files — zero findings required. Step 2 run the \`anti-slop\` rule review (load the \`antislop\` skill via konoha.get_skill) and fix violations. The kage review + workflow synthesis mechanically enforce a perfect 100/100 scan — delivery is blocked below it.\n\nWrite result.md and validation evidence for this task.\n`, 'utf8');
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
    // 100% AI-Slop Gate: mechanically scan the project before kage review completes.
    const { getWorkspaceRoot: _gwr } = require('./runtime_state');
    const gateProject = _gwr() || process.cwd();
    const gate = runAislopGate(gateProject, status);
    if (!status.aislop_gate) status.aislop_gate = gate;
    saveWorkflowStatus(resolvedTaskDir, status);
    const gateTarget = gate.enforced
      ? 'The mechanical gate requires a 100/100 aislop scan (zero findings of any severity) before synthesis.'
      : 'Run the two-step review (Step 1 aislop_scan, Step 2 anti-slop rules) and verify 0 findings.';
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'review', 'kage');
    fs.writeFileSync(path.join(resolvedTaskDir, 'delegate.md'), `agent: kage\npriority: critical\nPhase: Review\ndispatch_id: ${dispatch.id}\n\n## TASK\n\nVerify every task in status.json is completed, required files exist, validation evidence has no errors or warnings, security/rollback checks are documented. Run the TWO-STEP Zero-AI-Slop review: Step 1 aislop_scan (scanner), Step 2 anti-slop rule review (antislop skill Delivery Gate) — TARGET 100%: zero findings of any severity. ${gateTarget}${gate.enforced ? ` Current mechanical scan: score ${gate.score ?? 'n/a'}, findings ${gate.findings ?? 'n/a'}.` : ''} Write kage_review.json with approved, verified_task_ids, validation, security_reviewed, rollback_reviewed, ai_slop_findings, ai_slop_clean, and findings fields, then write result.md.\n`, 'utf8');
    status.assigned_agent = 'kage';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'review', agent: 'kage', dispatch_id: dispatch.id, task_dir: resolvedTaskDir, aislop_gate: gate });
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

    // 100% AI-Slop Gate (mechanical): synthesis is BLOCKED unless the project
    // scan is a perfect 100/100 with zero findings of any severity.
    const { getWorkspaceRoot: _gwrSynth } = require('./runtime_state');
    const gateSynth = runAislopGate(_gwrSynth() || process.cwd(), status);
    if (gateSynth.enforced && !gateSynth.ok) {
      const res = JSON.stringify({
        status: 'blocked',
        phase: 'review',
        message: `100% AI-Slop gate failed: aislop scan score ${gateSynth.score ?? 'n/a'}/${gateSynth.findings ?? 'n/a'} findings (target: 100/100, 0 findings). Re-run the two-step review (Step 1 aislop_scan, Step 2 anti-slop rules), fix all findings via the anbu remediation loop, then re-approve.`,
        aislop_gate: gateSynth,
      });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
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
      if (t.id && t.id.startsWith('slop-fix-') && aiSlopOk) return true;
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
    try {
      const rootId = path.basename(resolvedTaskDir);
      const sdlcManager = require('../sdlc_manager');
      sdlcManager.updateTask(rootId, { status: 'completed' });
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    return JSON.stringify({ status: 'completed', phase: 'done', final_report_path: reportPath });
  }

  return JSON.stringify({ status: 'error', message: `Unknown or stuck workflow phase: ${phase}`, phase });
}

module.exports = {
  getResolvedTaskDir,
  readFileSafe,
  runAislopGate,
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
