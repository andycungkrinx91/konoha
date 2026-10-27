'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getKonohaTmpRoot } = require('./client_detection');
const { logToolCall } = require('./skills');
const { getResolvedTaskDir, loadWorkflowStatus, saveWorkflowStatus } = require('./workflow_common');

function routeByKeywordsWithPrompt(taskDir, prompt = '') {
  let p = prompt;
  if (!p) {
    const st = loadWorkflowStatus(taskDir);
    p = st.prompt || '';
  }
  if (!p) return 'kage';

  const trimmed = p.trim();
  const slashMatch = trimmed.match(/^\/([a-zA-Z_-]+)(?:\s+([\s\S]*))?$/);
  if (slashMatch) {
    const rawCmd = slashMatch[1].toLowerCase().replace(/-/g, '_');
    const knownAgents = ['sannin', 'genin', 'chunin', 'kage', 'tokubetsu_jonin', 'anbu', 'jonin', 'akatsuki'];
    if (knownAgents.includes(rawCmd)) {
      return rawCmd;
    }
  }

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

  if (!bestAgent) {
    if (/\b(c|c\+\+|clang|llvm|allocator|buffer overflow|memory leak|backend|devops|api|database|server)\b/i.test(promptLower)) {
      bestAgent = 'anbu';
    } else if (/\b(frontend|ui|css|html|tailwind|component|react|vue|svelte)\b/i.test(promptLower)) {
      bestAgent = 'jonin';
    } else {
      bestAgent = 'kage';
    }
  }
  const writeSignals = ['prd', 'write a prd', 'technical doc', 'write the doc', 'draft the doc', 'write docs', 'author', 'write a spec'];
  if (writeSignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'tokubetsu_jonin';
  }
  const securitySignals = [
    'security audit', 'penetration test', 'pentest', 'red team', 'blue team',
    'vulnerability scan', 'vuln scan', 'cve audit', 'owasp check', 'security review',
    'exploit verification', 'guardian scan', 'security assessment', 'cve'
  ];
  if (securitySignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'akatsuki';
  }
  return bestAgent;
}

function classifyExecutionTrack(prompt = '') {
  if (!prompt || typeof prompt !== 'string') return 'full_sdlc';
  const p = prompt.trim();
  if (/^\/(anbu|jonin|genin|chunin|kage|tokubetsu[-_]jonin|sannin|akatsuki)\b/i.test(p)) {
    return 'fast_track';
  }
  const isFullSdlcSignal = /\b(greenfield|from scratch|0 to 1|fullstack|multi[- ]subsystem|architect(ure)?|refactor|migration|scaffold|end[- ]to[- ]end|build a (web|site|app|platform|service|marketplace|system))\b/i.test(p);
  if (isFullSdlcSignal) {
    return 'full_sdlc';
  }
  const isFastTrackSignal = /\b(single[- ]file|isolated bug|typo fix|quick question|inspection|explain|quick fix|hotfix|syntax fix)\b/i.test(p);
  if (isFastTrackSignal) {
    return 'fast_track';
  }
  return 'full_sdlc';
}

function detectParallelWorkstreams(prompt = '') {
  if (!prompt || typeof prompt !== 'string') return [];
  const p = prompt.toLowerCase();
  const streams = [];

  const hasBackend = /\b(backend|api|database|postgres|redis|sql|server|endpoint|devops|docker|kubernetes|helm|ci\/cd|pipeline)\b/i.test(p);
  const hasFrontend = /\b(frontend|ui|component|tailwind|layout|page|css|html|react|vue|svelte|nuxt|angular)\b/i.test(p);
  const hasDocs = /\b(documentation|readme|docs|runbook|api spec|postmortem|guide|technical doc)\b/i.test(p);
  const hasResearch = /\b(research|web search|lookup|find evidence|citations|source evaluation)\b/i.test(p);
  const hasSecurity = /\b(security|pentest|penetration|cve|vulnerability|red team|blue team|guardian|hardening|exploit|security audit)\b/i.test(p);

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
  if (hasSecurity) {
    streams.push({ agent: 'akatsuki', domain: 'security', role: 'Security assessment, red/blue team auditing & security gate' });
  }

  return streams;
}

function computeFlowHash(sessionId, taskId, promptText) {
  const normSession = (sessionId || 'default-session').trim();
  const normTask = (taskId || 'task-root').trim();
  const normPrompt = (promptText || '').trim().substring(0, 100);
  const raw = `${normSession}:${normTask}:${normPrompt}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
}

function runSannin(prompt = null, taskDir = null, projectPath = null, sessionId = null) {
  const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
  const cd = require('./client_detection');
  const resolvedProjPath = projectPath || getWorkspaceRoot() || process.cwd();
  const resolvedSessionId = sessionId || cd.getActiveSessionId(resolvedProjPath);
  const actClient = (typeof getActiveClient === 'function' ? getActiveClient() : null) || cd.detectActiveClient() || '';

  let resolvedTaskDir;
  if (!taskDir && prompt && typeof prompt === 'string' && prompt.trim()) {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const freshTaskId = sdlcManager.generateTaskId();
    const tmpRoot = getKonohaTmpRoot(resolvedProjPath, resolvedSessionId);
    resolvedTaskDir = path.join(tmpRoot, 'scratch', 'tasks', freshTaskId);
  } else {
    resolvedTaskDir = getResolvedTaskDir(taskDir, resolvedProjPath, resolvedSessionId);
  }
  fs.mkdirSync(resolvedTaskDir, { recursive: true });

  const taskId = path.basename(resolvedTaskDir);
  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  let status = loadWorkflowStatus(resolvedTaskDir);

  const normalizedPrompt = (s) => (s || '').replace(/\r\n/g, '\n').trim();
  const isNewTaskInReusedDir =
    prompt !== null &&
    prompt !== undefined &&
    typeof prompt === 'string' &&
    prompt.trim() !== '' &&
    status.prompt &&
    normalizedPrompt(prompt) !== normalizedPrompt(status.prompt);

  if (isNewTaskInReusedDir) {
    const staleArtifacts = [
      'status.json', 'plan.md', 'findings.md', 'kage_review.json', 'final_docs.md'
    ];
    for (const f of staleArtifacts) {
      try { fs.rmSync(path.join(resolvedTaskDir, f), { force: true }); } catch (_) { /* best-effort cleanup */ }
    }
    status = loadWorkflowStatus(resolvedTaskDir);
  }

  if (status.phase === 'done' || status.status === 'completed') {
    const res = JSON.stringify({
      status: 'completed',
      phase: 'done',
      task_id: taskId,
      task_dir: resolvedTaskDir,
      session_id: resolvedSessionId,
      client: actClient
    });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return res;
  }

  let effPrompt = prompt;
  if (!effPrompt || typeof effPrompt !== 'string' || !effPrompt.trim()) {
    if (status && status.prompt) {
      effPrompt = status.prompt;
    } else {
      const existingTask = sdlcManager.getTask(taskId);
      if (existingTask && existingTask.description) {
        effPrompt = existingTask.description;
      } else {
        return JSON.stringify({ status: 'error', message: 'No prompt provided for task execution.' });
      }
    }
  }

  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const dorResult = sdlcManager.checkReadiness(effPrompt, resolvedProjPath);
  const executionTrack = classifyExecutionTrack(effPrompt);
  const flowHash = computeFlowHash(resolvedSessionId, taskId, effPrompt);

  const selectedAgentSuffix = routeByKeywordsWithPrompt(resolvedTaskDir, effPrompt);
  const selectedAgent = selectedAgentSuffix.startsWith('mcp_')
    ? selectedAgentSuffix.substring(4)
    : selectedAgentSuffix;

  // Domain skill routing: match prompt domain skills & agent domain skills from SQLite
  const { autoloadSkillsFromPrompt } = require('./memory_reporting');
  const personaMemory = require('../persona_memory');
  let routedSkills = [];
  let skillConn = null;
  try {
    skillConn = getDb();
    const auto = autoloadSkillsFromPrompt(effPrompt, skillConn);
    for (const s of auto) {
      if (!routedSkills.includes(s)) routedSkills.push(s);
    }
    const agentRow = skillConn.prepare('SELECT skills FROM agents WHERE name = ? OR name = ?').get(selectedAgent, `mcp_${selectedAgent}`);
    if (agentRow && agentRow.skills) {
      try {
        const dbSkills = JSON.parse(agentRow.skills);
        if (Array.isArray(dbSkills)) {
          for (const ds of dbSkills) {
            if (!ds.startsWith('antislop') && ds !== 'i-have-adhd' && !routedSkills.includes(ds)) {
              routedSkills.push(ds);
            }
          }
        }
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ } finally {
    if (skillConn) {
      try { skillConn.close(); } catch (_) { /* best effort */ }
    }
  }

  try {
    sdlcManager.createTask({
      id: taskId,
      description: effPrompt,
      status: (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) ? 'blocked' : 'in_progress',
      dor_result: dorResult,
      evidence: {
        execution_track: executionTrack,
        flow_hash: flowHash,
        routed_skills: routedSkills,
        active_skills: routedSkills
      },
      project_path: resolvedProjPath,
      session_id: resolvedSessionId,
      client: actClient
    });
    const st = loadWorkflowStatus(resolvedTaskDir);
    st.task_id = taskId;
    st.prompt = effPrompt;
    st.execution_track = executionTrack;
    st.session_id = resolvedSessionId;
    st.project_path = resolvedProjPath;
    st.client = actClient;
    st.flow_hash = flowHash;
    st.routed_skills = routedSkills;
    saveWorkflowStatus(resolvedTaskDir, st);
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  for (const sk of routedSkills) {
    try {
      personaMemory.recordFlowSkill(flowHash, sk, taskId, resolvedSessionId, resolvedProjPath);
    } catch (_) { /* ignore */ }
  }

  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    const res = JSON.stringify({
      status: 'blocked',
      phase: 'dor',
      message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address the missing items before dispatching.',
      missing: dorResult.missing,
      dor_result: dorResult,
      flow_hash: flowHash,
      task_dir: resolvedTaskDir
    });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return res;
  }

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
      '- Pass the returned directives directly as structured tool constraints when calling `jonin`.\n' +
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

  let trackGuidance = '';
  if (executionTrack === 'fast_track') {
    trackGuidance = (
      '\n\n### ⚡ Fast-Track Direct Execution (Zero Pipeline Overhead)\n' +
      '- Direct, immediate execution by target agent without 8-phase DAG or Gate 1 plan pause.\n' +
      '- Subagent executes directly and reports verification via `konoha.report_from_agent`.'
    );
  }

  const instruction = (
    `**Selected Agent**: \`${selectedAgent}\`\n` +
    `**Execution Track**: \`${executionTrack}\`\n` +
    `**Flow Hash**: \`${flowHash}\`\n` +
    `**Routed Skills**: ${routedSkills.length > 0 ? routedSkills.map(s => `\`${s}\``).join(', ') : 'None (soul-bound defaults)'}\n` +
    `**Reason**: ${description}\n\n` +
    `Task directory: \`${resolvedTaskDir}\`\n` +
    `SDLC Task ID: \`${taskId}\`\n\n` +
    '## Delegation Steps\n\n' +
    `1. Call \`${selectedAgent}\` directly with structured tool arguments (\`task\`, \`context\`, \`constraints\`, \`task_id="${taskId}"\`, \`flow_hash="${flowHash}"\`, \`skills=${JSON.stringify(routedSkills)}\`, \`project_path="${resolvedProjPath}"\`).\n` +
    `2. Subagent executes task and reports verification via \`konoha.report_from_agent\` with \`task_id="${taskId}"\`.\n` +
    `3. Call \`sannin\` with \`task_dir=${resolvedTaskDir}\` to advance the workflow.\n\n` +
    `## Original Prompt\n\n${effPrompt}` +
    advisoryText +
    trackGuidance +
    buildGuidance +
    parallelGuidance
  );

  const res = JSON.stringify({
    status: 'routed',
    task_id: taskId,
    flow_hash: flowHash,
    selected_agent: selectedAgent,
    skills: routedSkills,
    execution_track: executionTrack,
    parallel_eligible: parallelWorkstreams.length > 1,
    parallel_workstreams: parallelWorkstreams.length > 1 ? parallelWorkstreams : undefined,
    phase: 'delegation',
    instructions: instruction,
    task_dir: resolvedTaskDir,
    session_id: resolvedSessionId,
    client: actClient,
    dor_result: dorResult
  });
  logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
  return res;
}

module.exports = {
  routeByKeywordsWithPrompt,
  classifyExecutionTrack,
  detectParallelWorkstreams,
  computeFlowHash,
  runSannin
};
