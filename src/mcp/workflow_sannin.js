'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getKonohaTmpRoot } = require('./client_detection');
const { logToolCall } = require('./skills');
const { getResolvedTaskDir, loadWorkflowStatus, saveWorkflowStatus } = require('./workflow_common');
const {
  parseGateChoice,
  applyGate1Choice,
  applyGate2Choice,
  buildGate1Prompt,
  buildGate2Prompt
} = require('./workflow_gates');
const {
  decideRoute,
  formatRouteLine,
  buildSpawnDirective,
  buildDelegationEnvelope
} = require('./sannin_router');

function calculateSingleKeywordScore(promptLower, kw) {
  if (promptLower.includes(kw)) {
    return ((kw.match(/\s/g) || []).length + 1) * 2;
  }
  const tokens = kw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (promptLower.includes(t)) hits++;
  }
  if (hits === tokens.length) return hits;
  return hits > 0 ? hits * 0.5 : 0;
}

function calculateAgentKeywordScore(promptLower, delegationKeywords) {
  let score = 0;
  for (const kwRaw of delegationKeywords.toLowerCase().split(',')) {
    const kw = kwRaw.trim();
    if (kw) score += calculateSingleKeywordScore(promptLower, kw);
  }
  return score;
}

function _findBestAgentFromDb(promptLower) {
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
      const score = calculateAgentKeywordScore(promptLower, agent.delegation_keywords);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent.name;
      }
    }
  } catch (_) { /* ignore */ } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  }
  return bestAgent;
}

function parseKonohaCommandInvocation(prompt = '') {
  if (!prompt || typeof prompt !== 'string') {
    return { invocationMode: 'konoha_orchestrator', targetAgent: null, cleanPrompt: '' };
  }
  const trimmed = prompt.trim();
  const slashMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!slashMatch) {
    return { invocationMode: 'konoha_orchestrator', targetAgent: null, cleanPrompt: trimmed };
  }
  const rawCmd = slashMatch[1].toLowerCase().replace(/-/g, '_');
  const rest = (slashMatch[2] || '').trim();
  if (rawCmd === 'konoha' || rawCmd === 'sannin') {
    return { invocationMode: 'konoha_orchestrator', targetAgent: null, cleanPrompt: rest || trimmed };
  }
  const directSubagents = ['genin', 'chunin', 'kage', 'tokubetsu_jonin', 'anbu', 'jonin', 'akatsuki', 'yamanaka'];
  if (directSubagents.includes(rawCmd)) {
    return { invocationMode: 'direct_subagent', targetAgent: rawCmd, cleanPrompt: rest || trimmed };
  }
  return { invocationMode: 'konoha_orchestrator', targetAgent: null, cleanPrompt: trimmed };
}

function routeByKeywordsWithPrompt(taskDir, prompt = '') {
  let p = prompt;
  if (!p) {
    const st = loadWorkflowStatus(taskDir);
    p = st.prompt || '';
  }
  if (!p) return 'kage';

  const parsed = parseKonohaCommandInvocation(p);
  if (parsed.invocationMode === 'direct_subagent' && parsed.targetAgent) {
    return parsed.targetAgent;
  }

  const effectiveText = parsed.cleanPrompt || p;
  const promptLower = effectiveText.toLowerCase();
  let bestAgent = _findBestAgentFromDb(promptLower);

  if (!bestAgent) {
    if (/\b(c|c\+\+|clang|llvm|allocator|buffer overflow|memory leak|backend|devops|api|database|server)\b/i.test(promptLower)) {
      bestAgent = 'anbu';
    } else if (/\b(frontend|ui|css|html|tailwind|component|react|vue|svelte)\b/i.test(promptLower)) {
      bestAgent = 'jonin';
    } else if (/\b(3d|blender|manifold|glb|gltf|three\.js|threejs|mesh|procedural 3d|spatial)\b/i.test(promptLower)) {
      bestAgent = 'yamanaka';
    } else {
      bestAgent = 'kage';
    }
  }
  const systemsSignals = [
    'buffer overflow', 'memory allocator', 'memory leak', 'allocator', 'segfault',
    'core dump', 'valgrind', 'clang', 'c++'
  ];
  if (systemsSignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'anbu';
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
  const spatialSignals = ['text-to-3d', 'image-to-3d', 'blender headless', 'manifold-3d', 'export glb', '3d model'];
  if (spatialSignals.some(sig => promptLower.includes(sig))) {
    bestAgent = 'yamanaka';
  }
  return bestAgent;
}

function classifyExecutionTrack(prompt = '') {
  if (!prompt || typeof prompt !== 'string') return 'full_sdlc';
  const parsed = parseKonohaCommandInvocation(prompt);
  if (parsed.invocationMode === 'direct_subagent') return 'fast_track';
  const p = (parsed.cleanPrompt || prompt).trim();
  if (p.startsWith('fast_track:') || p.startsWith('[fast_track]') || p.startsWith('DIRECT:')) return 'fast_track';
  if (p.startsWith('full_sdlc:') || p.startsWith('[full_sdlc]') || p.startsWith('SDLC:')) return 'full_sdlc';
  if (/^\/[a-zA-Z_-]+(?:\s+|$)/.test(p)) return 'fast_track';

  const isFullSdlcSignal = /\b(build|create|design|refactor|architect|implement|microservice|fullstack|marketplace|subsystem|greenfield|pipeline|system|lifecycle|architecture)\b/i.test(p);
  if (isFullSdlcSignal) {
    return 'full_sdlc';
  }

  const wordCount = p.split(/\s+/).filter(Boolean).length;
  const isDirectDevopsOrSearch = /\b(search for|lookup|find symbol|query|check logs|status of|restart|ping|inspect error|question|explain)\b/i.test(p);
  const isSmallBugFix = /\b(fix typo|fix spelling|rename variable|remove log|comment out|update version|bump version|typo fix|quick fix)\b/i.test(p);

  if (isSmallBugFix) return 'fast_track';

  // Concrete implementation verbs signal real delegated work even in a short
  // prompt. A word-count cutoff must NEVER override these: "add login page and
  // api endpoint" is 6 words but needs Anbu + Jonin subagents.
  const isImplementationWork = /\b(add|implement|create|build|write|fix|migrate|refactor|update|remove|delete|rename|move|extract|convert|replace|integrate|wire|hook|connect|upgrade|downgrade|install|configure|setup|set|make|support|enable|disable|handle|validate|parse|render|display|store|fetch|send|persist|deploy|test|cover|document)\b/i.test(p);

  if (isImplementationWork) return 'full_sdlc';

  if (isDirectDevopsOrSearch) {
    return 'fast_track';
  }
  // Short prompts with no implementation verb are conversational/exploratory.
  if (wordCount <= 12) return 'fast_track';
  return 'full_sdlc';
}

function detectParallelWorkstreams(prompt = '') {
  if (!prompt || typeof prompt !== 'string') return [];
  const p = prompt.toLowerCase();
  const workstreams = [];
  const frontendMatch = /\b(frontend|ui|css|html|tailwind|component|react|vue|svelte|page|screen|client-side)\b/i.test(p);
  const backendMatch = /\b(backend|api|database|db|migration|endpoint|server|controller|service|sql|schema|postgres|redis)\b/i.test(p);
  const docsMatch = /\b(docs|documentation|user guide|api spec|readme|architecture doc|tutorial|manual)\b/i.test(p);
  const securityMatch = /\b(security audit|penetration test|pentest|red team|blue team|vulnerability|cve|owasp|threat model)\b/i.test(p);

  if (frontendMatch) workstreams.push({ agent: 'jonin', domain: 'frontend', ready_to_dispatch: true });
  if (backendMatch) workstreams.push({ agent: 'anbu', domain: 'backend', ready_to_dispatch: true });
  if (docsMatch) workstreams.push({ agent: 'tokubetsu-jonin', domain: 'documentation', ready_to_dispatch: true });
  if (securityMatch) workstreams.push({ agent: 'akatsuki', domain: 'security', ready_to_dispatch: true });

  return workstreams;
}

function computeFlowHash(sessionId, taskId, prompt) {
  const normPrompt = (prompt || '').trim().replace(/\s+/g, ' ').substring(0, 300);
  const raw = `${sessionId || 'default'}:${taskId || 'root'}:${normPrompt}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
}

function _extractAgentSkills(agentRow, routedSkills) {
  if (!agentRow?.skills) return;
  try {
    const dbSkills = JSON.parse(agentRow.skills);
    if (!Array.isArray(dbSkills)) return;
    for (const ds of dbSkills) {
      if (!ds.startsWith('antislop') && ds !== 'i-have-adhd' && !routedSkills.includes(ds)) {
        routedSkills.push(ds);
      }
    }
  } catch (_) { /* ignore */ }
}

function _resolveRoutedSkills(effPrompt, selectedAgent) {
  const { autoloadSkillsFromPrompt } = require('./memory_reporting');
  const routedSkills = [];
  let skillConn = null;
  try {
    skillConn = getDb();
    for (const s of autoloadSkillsFromPrompt(effPrompt, skillConn)) {
      if (!routedSkills.includes(s)) routedSkills.push(s);
    }
    const agentRow = skillConn.prepare('SELECT skills FROM agents WHERE name = ? OR name = ?').get(selectedAgent, `mcp_${selectedAgent}`);
    _extractAgentSkills(agentRow, routedSkills);
  } catch (_) { /* ignore */ } finally {
    if (skillConn) {
      try { skillConn.close(); } catch (_) { /* best effort */ }
    }
  }
  return routedSkills;
}

function _loadAgentDescriptions() {
  const agentDescriptions = {};
  let descConn = null;
  try {
    descConn = getDb();
    const rows = descConn.prepare('SELECT name, title, purpose FROM agents').all();
    for (const row of rows) {
      const desc = row.purpose || row.title;
      agentDescriptions[row.name] = desc;
      if (row.name.startsWith('mcp_')) agentDescriptions[row.name.substring(4)] = desc;
    }
  } catch (_) { /* ignore */ } finally {
    if (descConn) {
      try { descConn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  }
  return agentDescriptions;
}

function _resolveSanninTaskDir(prompt, taskDir, resolvedProjPath, resolvedSessionId) {
  if (!taskDir && prompt && typeof prompt === 'string' && prompt.trim()) {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const freshTaskId = sdlcManager.generateTaskId();
    const tmpRoot = getKonohaTmpRoot(resolvedProjPath, resolvedSessionId);
    return path.join(tmpRoot, 'scratch', 'tasks', freshTaskId);
  }
  return getResolvedTaskDir(taskDir, resolvedProjPath, resolvedSessionId);
}

function _cleanStaleTaskArtifactsIfChanged(prompt, resolvedTaskDir, status) {
  if (parseGateChoice(prompt)) {
    return status;
  }
  const norm = (s) => (s || '').replace(/\r\n/g, '\n').trim();
  if (prompt && status.prompt && norm(prompt) !== norm(status.prompt)) {
    status.plan = null;
    status.findings = null;
    status.exploration_evidence = null;
    status.tasks = [];
    status.current_dispatch = null;
    status.plan_approved = false;
    saveWorkflowStatus(resolvedTaskDir, status);
    return status;
  }
  return status;
}

function _resolveEffectivePrompt(prompt, status, taskId, sdlcManager) {
  if (prompt && typeof prompt === 'string' && prompt.trim()) return prompt;
  if (status?.prompt) return status.prompt;
  const existingTask = sdlcManager.getTask(taskId);
  return existingTask?.description || null;
}

function _buildInstructionText(ctx) {
  let advisoryText = '';
  if (!ctx.dorResult.ready && ctx.dorResult.missing && ctx.dorResult.missing.length > 0) {
    advisoryText = (
      '\n\n### ⚠️ Definition-of-Readiness (DoR) Advisory Hints\n' +
      ctx.dorResult.missing.map(m => `- ${m}`).join('\n')
    );
  }

  let buildGuidance = '';
  if (ctx.selectedAgent === 'jonin' || /\b(website|web\s*app|landing\s*page|frontend|storefront|portfolio|dashboard|scaffold.*ui)\b/i.test(ctx.effPrompt)) {
    buildGuidance = (
      '\n\n### ⚡ Website Scaffolding\n' +
      '- Text build: Call `konoha.build_from_text(name, description, framework)` FIRST.\n' +
      '- Mockup build: Call `konoha.build_from_source(name, source_dir, framework)` FIRST.\n' +
      '- Pass directives to `jonin`. Implement complete site with inline README and clean validation.'
    );
  }

  let parallelGuidance = '';
  if (ctx.parallelWorkstreams.length > 1) {
    parallelGuidance = (
      '\n\n### ⚡ Parallel Opportunity\n' +
      `- Multi-domain workstreams: ${ctx.parallelWorkstreams.map(w => `\`${w.agent}\` (${w.domain})`).join(', ')}.\n` +
      '- Dispatch independent workstreams concurrently once Gate 1 interfaces are locked.'
    );
  }

  const routeLine = formatRouteLine(ctx.route);

  let trackGuidance = '';
  if (ctx.executionTrack === 'fast_track') {
    trackGuidance = '\n\n### ⚡ Fast-Track: Execute directly without 8-phase DAG.';
  }

  const executionBlock = (
    '\n\n## Delegation Steps\n' +
    `1. Call \`${ctx.selectedAgent}\` with (\`task\`, \`context\`, \`task_id="${ctx.taskId}"\`, \`flow_hash="${ctx.flowHash}"\`, \`skills=${JSON.stringify(ctx.routedSkills)}\`).\n` +
    `2. Subagent executes within archetype boundaries and reports via \`konoha.report_from_agent\` (\`task_id="${ctx.taskId}"\`).\n` +
    `3. Call \`sannin(task_dir="${ctx.resolvedTaskDir}")\` to advance.`
  );

  const spawnBlock = ctx.spawnDirective ? `\n\n${ctx.spawnDirective}` : '';
  return (
    `**Selected Agent**: \`${ctx.selectedAgent}\` | **Track**: \`${ctx.executionTrack}\`\n` +
    `**Reason**: ${ctx.description}\n` +
    routeLine +
    `**Flow Hash**: \`${ctx.flowHash}\` | **Task ID**: \`${ctx.taskId}\`\n` +
    `**Task Dir**: \`${ctx.resolvedTaskDir}\`\n` +
    `**Task**: ${ctx.effPrompt}\n` +
    spawnBlock +
    executionBlock +
    buildGuidance + parallelGuidance + trackGuidance + advisoryText
  );
}

function _recordTaskStatusAndFlow(ctx) {
  const { sdlcManager, taskId, effPrompt, sdlcConfig, dorResult, executionTrack, flowHash, routedSkills, resolvedProjPath, resolvedSessionId, actClient, resolvedTaskDir, route, invocationMode, directSubagent } = ctx;
  try {
    sdlcManager.createTask({
      id: taskId,
      description: effPrompt,
      status: (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) ? 'blocked' : 'in_progress',
      dor_result: dorResult,
      evidence: { execution_track: executionTrack, flow_hash: flowHash, routed_skills: routedSkills, active_skills: routedSkills, route_mode: route ? route.mode : undefined, invocation_mode: invocationMode, direct_subagent: directSubagent || undefined },
      project_path: resolvedProjPath, session_id: resolvedSessionId, client: actClient
    });
    const st = loadWorkflowStatus(resolvedTaskDir);
    st.task_id = taskId;
    st.prompt = effPrompt;
    st.execution_track = executionTrack;
    st.invocation_mode = invocationMode || 'konoha_orchestrator';
    if (directSubagent) {
      st.direct_subagent = directSubagent.replace(/_/g, '-');
    }
    st.session_id = resolvedSessionId;
    st.project_path = resolvedProjPath;
    st.client = actClient;
    st.route_mode = route ? route.mode : undefined;
    st.flow_hash = flowHash;
    st.routed_skills = routedSkills;
    saveWorkflowStatus(resolvedTaskDir, st);
  } catch (_) { /* intentional best-effort fallback */ }

  const personaMemory = require('../persona_memory');
  for (const sk of routedSkills) {
    try { personaMemory.recordFlowSkill(flowHash, sk, taskId, resolvedSessionId, resolvedProjPath); } catch (_) { /* ignore */ }
  }
}

function _handlePendingGateSannin(status, prompt, options, resolvedTaskDir, sdlcManager) {
  const isGate1 = status.phase === 'plan_approval' || ((status.hitl_gate === 'Gate 1 (Plan Approval)' || status.hitl_gate === 'plan_approval') && !status.plan_approved);
  const isGate2 = status.phase === 'delivery_signoff' || ((status.hitl_gate === 'Gate 2 (Delivery Sign-Off)' || status.hitl_gate === 'delivery_signoff') && !status.human_signed_off);
  if (!isGate1 && !isGate2) return null;

  const taskId = path.basename(resolvedTaskDir);
  const inputCandidate = options?.choice ?? options?.gate_action ?? prompt;
  const inputRefinement = options?.refinement ?? options?.feedback;
  const choiceObj = parseGateChoice(inputCandidate, inputRefinement);

  if (choiceObj) {
    const { runMcpWorkflow } = require('./workflow_runner');
    if (isGate1) {
      applyGate1Choice(choiceObj, status, resolvedTaskDir, sdlcManager);
      return runMcpWorkflow(resolvedTaskDir);
    }
    const g2Res = applyGate2Choice(choiceObj, status, resolvedTaskDir, sdlcManager);
    if (g2Res.signed_off) {
      const res = JSON.stringify({ status: 'completed', phase: 'done', task_id: taskId, task_dir: resolvedTaskDir });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    }
    return runMcpWorkflow(resolvedTaskDir);
  }

  const res = isGate1
    ? buildGate1Prompt(status, resolvedTaskDir, taskId, status.plan)
    : buildGate2Prompt(status, resolvedTaskDir, taskId, status.confidence || 100, status.report);
  logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
  return res;
}

function runSannin(prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {}) {
  const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
  const cd = require('./client_detection');
  const resolvedProjPath = projectPath || getWorkspaceRoot() || process.cwd();
  const resolvedSessionId = sessionId || cd.getActiveSessionId(resolvedProjPath);
  const actClient = (typeof getActiveClient === 'function' ? getActiveClient() : null) || cd.detectActiveClient() || '';

  const resolvedTaskDir = _resolveSanninTaskDir(prompt, taskDir, resolvedProjPath, resolvedSessionId);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });

  const taskId = path.basename(resolvedTaskDir);
  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  let status = loadWorkflowStatus(resolvedTaskDir);
  status = _cleanStaleTaskArtifactsIfChanged(prompt, resolvedTaskDir, status);

  if (status.phase === 'done' || status.status === 'completed') {
    const res = JSON.stringify({ status: 'completed', phase: 'done', task_id: taskId, task_dir: resolvedTaskDir, session_id: resolvedSessionId, client: actClient });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return res;
  }

  const gateHandledRes = _handlePendingGateSannin(status, prompt, options, resolvedTaskDir, sdlcManager);
  if (gateHandledRes) return gateHandledRes;

  const effPrompt = _resolveEffectivePrompt(prompt, status, taskId, sdlcManager);
  if (!effPrompt) return JSON.stringify({ status: 'error', message: 'No prompt provided for task execution.' });

  const parsedCmd = parseKonohaCommandInvocation(effPrompt);
  const invocationMode = parsedCmd.invocationMode;
  const directSubagent = parsedCmd.targetAgent;
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const dorResult = sdlcManager.checkReadiness(effPrompt, resolvedProjPath);
  const executionTrack = classifyExecutionTrack(effPrompt);
  const parallelWorkstreams = invocationMode === 'direct_subagent' ? [] : detectParallelWorkstreams(effPrompt);
  const route = decideRoute({ prompt: effPrompt, executionTrack, workstreams: parallelWorkstreams });
  const flowHash = computeFlowHash(resolvedSessionId, taskId, effPrompt);

  const rawAgent = routeByKeywordsWithPrompt(resolvedTaskDir, effPrompt);
  const selectedAgent = rawAgent.startsWith('mcp_') ? rawAgent.substring(4) : rawAgent;
  const routedSkills = _resolveRoutedSkills(effPrompt, selectedAgent);

  _recordTaskStatusAndFlow({ sdlcManager, taskId, effPrompt, sdlcConfig, dorResult, executionTrack, flowHash, routedSkills, resolvedProjPath, resolvedSessionId, actClient, resolvedTaskDir, route, invocationMode, directSubagent });

  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    const res = JSON.stringify({ status: 'blocked', phase: 'dor', message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address the missing items before dispatching.', missing: dorResult.missing, dor_result: dorResult, flow_hash: flowHash, task_dir: resolvedTaskDir });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return res;
  }

  const agentDescriptions = _loadAgentDescriptions();
  const description = agentDescriptions[selectedAgent] || agentDescriptions[selectedAgent.replace(/_/g, '-')] || agentDescriptions[selectedAgent.replace(/-/g, '_')] || 'general-purpose delegation';

  const envelope = buildDelegationEnvelope({ agentName: selectedAgent, projectPath: resolvedProjPath, prompt: effPrompt, routedSkills });
  const spawnDirective = buildSpawnDirective({
    client: actClient,
    agent: selectedAgent,
    skills: routedSkills,
    projectPath: resolvedProjPath,
    prompt: effPrompt
  });

  const instruction = _buildInstructionText({
    selectedAgent, executionTrack, flowHash, routedSkills, description,
    resolvedTaskDir, taskId, effPrompt, dorResult, parallelWorkstreams, resolvedProjPath,
    route, envelope, spawnDirective
  });

  const res = JSON.stringify({
    status: 'routed', task_id: taskId, flow_hash: flowHash, selected_agent: selectedAgent,
    invocation_mode: invocationMode, direct_subagent: directSubagent || undefined,
    mandatory_kage_review: invocationMode === 'direct_subagent' ? true : undefined,
    skills: routedSkills, execution_track: executionTrack, parallel_eligible: parallelWorkstreams.length > 1,
    parallel_workstreams: parallelWorkstreams.length > 1 ? parallelWorkstreams : undefined,
    route, delegation_envelope: envelope
      ? { agent: envelope.agent, skills: envelope.skills, dropped_skills: envelope.dropped_skills, recall: envelope.recall }
      : undefined,
    phase: 'delegation', execution_mode: route.mode, instructions: instruction, task_dir: resolvedTaskDir,
    session_id: resolvedSessionId, client: actClient, dor_result: dorResult
  });
  logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
  return res;
}

function dispatchParallelSlices(workstreams = [], sharedOptions = {}) {
  const { runMcpAgent } = require('./memory_subagent_runner');
  const {
    taskId = 'root',
    flowHash = null,
    sessionId = null,
    projectPath = null,
    taskDir = null
  } = sharedOptions;

  if (!Array.isArray(workstreams) || workstreams.length === 0) {
    return [];
  }

  return workstreams.map(ws => {
    const agent = ws.agent || ws.name;
    const task = ws.task || ws.prompt || ws.instructions || `Execute ${ws.domain || agent} slice.`;
    const context = ws.context || sharedOptions.context || null;
    const constraints = ws.constraints || sharedOptions.constraints || null;
    const skills = Array.isArray(ws.skills) ? ws.skills : (ws.routed_skills || []);
    const tasteDials = ws.taste_dials || ws.tasteDials || sharedOptions.tasteDials || null;

    const resRaw = runMcpAgent(
      agent, task, context, constraints, skills, tasteDials,
      projectPath, taskDir, sessionId, flowHash, taskId
    );
    try {
      return JSON.parse(resRaw);
    } catch (_) {
      return { status: 'ready', agent, output: resRaw };
    }
  });
}

module.exports = {
  parseKonohaCommandInvocation,
  routeByKeywordsWithPrompt,
  classifyExecutionTrack,
  detectParallelWorkstreams,
  dispatchParallelSlices,
  computeFlowHash,
  runSannin
};
