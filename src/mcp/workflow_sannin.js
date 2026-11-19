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
const { syncTodoAndWalkthrough } = require('./todo_walkthrough_sync');
const {
  decideRoute,
  formatRouteLine,
  buildSpawnDirective,
  buildParallelSpawnDirective,
  buildDelegationEnvelope,
  buildDelegationEnvelopeAsync
} = require('./sannin_router');
const { buildAdvisorStartupDirective } = require('./lazy_subagent');
const { initAdvisorSessionSupervisor } = require('../workflow/kage-reviewer/advisor_monitor');

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

/**
 * Run `fn(conn)` against a best-effort database handle and return `fallback`
 * when the database cannot be opened or the query throws. A supplied
 * `existingConn` is borrowed and never closed here.
 */
function _withDbConn(fn, fallback = null, existingConn = null) {
  if (existingConn) {
    try {
      return fn(existingConn);
    } catch (error) {
      console.warn(`[sannin] database query failed: ${error && error.message ? error.message : error}`);
      return fallback;
    }
  }
  let conn = null;
  try {
    conn = getDb();
    return fn(conn);
  } catch (error) {
    console.warn(`[sannin] database unavailable: ${error && error.message ? error.message : error}`);
    return fallback;
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
    }
  }
}

/** Ranked keyword candidates, best first. Empty when the DB has no signal. */
function rankAgentCandidates(promptLower) {
  const ranked = _withDbConn((conn) => {
    const agents = conn.prepare(`
      SELECT name, delegation_keywords FROM agents
      WHERE delegation_keywords IS NOT NULL AND delegation_keywords != ''
    `).all();
    const scored = [];
    for (const agent of agents) {
      const score = calculateAgentKeywordScore(promptLower, agent.delegation_keywords);
      if (score > 0) scored.push({ agent: agent.name, score });
    }
    return scored;
  }, []);
  return ranked.sort((a, b) => b.score - a.score);
}

function _findBestAgentFromDb(promptLower) {
  const ranked = rankAgentCandidates(promptLower);
  return ranked.length > 0 ? ranked[0].agent : null;
}

/**
 * True when the top keyword score cannot be separated from the runner-up, i.e.
 * the heuristic is guessing. Requires at least two scored candidates.
 */
function isRoutingAmbiguous(promptLower, margin = 0.15) {
  const ranked = rankAgentCandidates(promptLower);
  if (ranked.length < 2) return false;
  const top = ranked[0].score;
  if (top <= 0) return false;
  return (top - ranked[1].score) / top < margin;
}

function parseKonohaCommandInvocation(prompt = '') {
  if (!prompt || typeof prompt !== 'string') {
    return { invocationMode: 'konoha_orchestrator', explicitSlash: false, targetAgent: null, cleanPrompt: '' };
  }
  const trimmed = prompt.trim().replace(/^@sannin\b\s*/i, '');
  const slashMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!slashMatch) {
    return { invocationMode: 'konoha_orchestrator', explicitSlash: false, targetAgent: null, cleanPrompt: trimmed };
  }
  const rawCmd = slashMatch[1].toLowerCase().replace(/-/g, '_');
  const rest = (slashMatch[2] || '').trim();
  if (rawCmd === 'konoha' || rawCmd === 'sannin') {
    return { invocationMode: 'konoha_orchestrator', explicitSlash: true, targetAgent: null, cleanPrompt: rest || trimmed.replace(/^\/(konoha|sannin)\b\s*/i, '').trim() };
  }
  const directSubagents = ['genin', 'chunin', 'kage', 'tokubetsu_jonin', 'anbu', 'jonin', 'akatsuki', 'yamanaka'];
  if (directSubagents.includes(rawCmd)) {
    return { invocationMode: 'direct_subagent', explicitSlash: true, targetAgent: rawCmd, cleanPrompt: rest || trimmed };
  }
  return { invocationMode: 'konoha_orchestrator', explicitSlash: false, targetAgent: null, cleanPrompt: trimmed };
}

function routeByKeywordsWithPrompt(taskDir, prompt = '', options = {}) {
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
  const writeSignals = ['prd', 'write a prd', 'technical doc', 'write the doc', 'draft the doc', 'write docs', 'author', 'write a spec'];
  const securitySignals = [
    'security audit', 'penetration test', 'pentest', 'red team', 'blue team',
    'vulnerability scan', 'vuln scan', 'cve audit', 'owasp check', 'security review',
    'exploit verification', 'guardian scan', 'security assessment', 'cve'
  ];
  const spatialSignals = ['text-to-3d', 'image-to-3d', 'blender headless', 'manifold-3d', 'export glb', '3d model'];
  // A signal override is authoritative on its own evidence, whether or not the
  // scorer happened to agree - so track that one fired, not that the answer moved.
  let overridden = false;
  for (const [signals, agent] of [[systemsSignals, 'anbu'], [writeSignals, 'tokubetsu_jonin'], [securitySignals, 'akatsuki'], [spatialSignals, 'yamanaka']]) {
    if (signals.some((sig) => promptLower.includes(sig))) {
      bestAgent = agent;
      overridden = true;
    }
  }
  // A verdict only breaks the tie the heuristics left open; the model sees the
  // same text, so it cannot outrank a signal the scorer was overruled for.
  if (options.precomputedAgent && !overridden) return options.precomputedAgent;
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
  const exploreMatch = /\b(explore|trace|map dependencies|symbol search|codebase survey|scout)\b/i.test(p);
  const researchMatch = /\b(research|benchmark|rfc|upstream docs|literature|compare libraries|citation)\b/i.test(p);
  const archMatch = /\b(architecture review|system design|threat model review|adr|risk assessment|kage review)\b/i.test(p);
  const frontendMatch = /\b(frontend|ui|css|html|tailwind|component|react|vue|svelte|page|screen|client-side)\b/i.test(p);
  const backendMatch = /\b(backend|api|database|db|migration|endpoint|server|controller|service|sql|schema|postgres|redis)\b/i.test(p);
  const docsMatch = /\b(docs|documentation|user guide|api spec|readme|architecture doc|tutorial|manual)\b/i.test(p);
  const securityMatch = /\b(security audit|penetration test|pentest|red team|blue team|vulnerability|cve|owasp|threat model)\b/i.test(p);
  const spatialMatch = /\b(3d model|three\.js|threejs|blender|manifold|glb|gltf|spatial asset)\b/i.test(p);

  if (exploreMatch) workstreams.push({ agent: 'genin', domain: 'exploration', ready_to_dispatch: true });
  if (researchMatch) workstreams.push({ agent: 'chunin', domain: 'research', ready_to_dispatch: true });
  if (archMatch) workstreams.push({ agent: 'kage', domain: 'architecture', ready_to_dispatch: true });
  if (frontendMatch) workstreams.push({ agent: 'jonin', domain: 'frontend', ready_to_dispatch: true });
  if (backendMatch) workstreams.push({ agent: 'anbu', domain: 'backend', ready_to_dispatch: true });
  if (docsMatch) workstreams.push({ agent: 'tokubetsu-jonin', domain: 'documentation', ready_to_dispatch: true });
  if (securityMatch) workstreams.push({ agent: 'akatsuki', domain: 'security', ready_to_dispatch: true });
  if (spatialMatch) workstreams.push({ agent: 'yamanaka', domain: 'spatial_3d', ready_to_dispatch: true });

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
      if (ds && !routedSkills.includes(ds)) {
        routedSkills.push(ds);
      }
    }
  } catch (_) { /* ignore */ }
}

/**
 * Keep only skills the selected agent is authorized to invoke. Red skills are
 * @akatsuki-only; a route targeting any other agent drops them (fail closed).
 * Pass includeBlocked to keep them for denial reporting at the route boundary.
 */
function _filterAuthorizedSkills(routedSkills, agentName, options = {}) {
  if (options.includeBlocked) return routedSkills.slice();
  const { authorizeSkillAccess, lookupSkillTags } = require('../skill_authorization');
  return routedSkills.filter((s) => authorizeSkillAccess({ skillName: s, tags: lookupSkillTags(options.conn, s), agentName }).authorized);
}

function _mergeUnique(target, source) {
  for (const s of source) if (!target.includes(s)) target.push(s);
  return target;
}

function _collectRoutedSkills(effPrompt, selectedAgent, sharedConn = null) {
  const { autoloadSkillsFromPrompt } = require('./memory_reporting');
  const { authorizeSkillAccess, lookupSkillTags } = require('../skill_authorization');
  const routedSkills = [];
  const collect = (conn) => {
    // Prompt autoload matches across the whole skill table, so it can surface a
    // red (akatsuki-only) skill for a prompt like "trace the auth flow". Keep
    // only skills this agent may use; the agent's own bindings are added below
    // and are authorized separately by the route boundary.
    const autoLoaded = autoloadSkillsFromPrompt(effPrompt, conn).filter(
      (skillName) => authorizeSkillAccess({ skillName, tags: lookupSkillTags(conn, skillName), agentName: selectedAgent }).authorized
    );
    _mergeUnique(routedSkills, autoLoaded);
    const agentRow = conn.prepare('SELECT skills FROM agents WHERE name = ? OR name = ?').get(selectedAgent, `mcp_${selectedAgent}`);
    _extractAgentSkills(agentRow, routedSkills);
  };
  _withDbConn(collect, routedSkills, sharedConn);
  return routedSkills;
}

function _resolveRoutedSkills(effPrompt, selectedAgent, options = {}) {
  const collected = _collectRoutedSkills(effPrompt, selectedAgent, options.conn);
  return _filterAuthorizedSkills(collected, selectedAgent, options);
}

function _loadAgentDescriptions() {
  const agentDescriptions = {};
  _withDbConn((conn) => {
    const rows = conn.prepare('SELECT name, title, purpose FROM agents').all();
    for (const row of rows) {
      const desc = row.purpose || row.title;
      agentDescriptions[row.name] = desc;
      if (row.name.startsWith('mcp_')) agentDescriptions[row.name.substring(4)] = desc;
    }
  });
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
      '- Run `konoha.build_from_text` (or `build_from_source`) FIRST, then delegate to `jonin`.'
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
    `1. Call \`${ctx.selectedAgent}\` (\`task_id="${ctx.taskId}"\`, \`flow_hash="${ctx.flowHash}"\`).\n` +
    '2. Report via `konoha.report_from_agent`, then call `sannin(task_dir)`.'
  );

  // The call itself lives in `advisor_spawn_directive.spawn_call`; repeating it
  // here would cost ~300 bytes twice in a response the same client reads whole.
  const advisorLine = ctx.advisorStartup
    ? `\n\n### Idle Supervision\n- Start \`@advisor\` from turn 0: \`advisor_spawn_directive.spawn_call\`; steer drift with \`${(ctx.advisorStartup.steer_protocol || {}).tool || 'the client steer call'}\`.`
    : '';
  const spawnBlock = ctx.parallelSpawnDirective
    ? `\n\n${ctx.parallelSpawnDirective}`
    : (ctx.spawnDirective ? `\n\n${ctx.spawnDirective}` : '');
  return (
    `**Agent**: \`${ctx.selectedAgent}\`\n` +
    routeLine +
    `**Task**: ${ctx.effPrompt}` +
    advisorLine +
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
    st.hitl_mode = (sdlcConfig && sdlcConfig.hitl_mode) || 'enabled';
    st.flow_hash = flowHash;
    st.routed_skills = routedSkills;
    initAdvisorSessionSupervisor({ client: actClient, status: st, goal: effPrompt, todos: st.tasks || [] });
    saveWorkflowStatus(resolvedTaskDir, st);
  } catch (_) { /* intentional best-effort fallback */ }

  const personaMemory = require('../persona_memory');
  for (const sk of routedSkills) {
    try { personaMemory.recordFlowSkill(flowHash, sk, taskId, resolvedSessionId, resolvedProjPath); } catch (_) { /* ignore */ }
  }
}

function _mergeGate1WorkflowOutput(g1Res, status, wfRaw) {
  try {
    const parsedWf = JSON.parse(wfRaw);
    if (parsedWf && typeof parsedWf === 'object') {
      if (g1Res?.compaction || status.compaction) parsedWf.compaction = g1Res?.compaction || status.compaction;
      if (g1Res?.todos) parsedWf.todos = g1Res.todos;
      if (g1Res?.walkthrough_steps) parsedWf.walkthrough_steps = g1Res.walkthrough_steps;
      if (g1Res?.client_todo_directive) parsedWf.client_todo_directive = g1Res.client_todo_directive;
      return JSON.stringify(parsedWf);
    }
  } catch (_) { /* return raw */ }
  return wfRaw;
}

function _handlePendingGateSannin(status, prompt, options, resolvedTaskDir, sdlcManager) {
  const isGate1 = status.phase === 'plan_approval' || ((status.hitl_gate === 'Gate 1 (Plan Approval)' || status.hitl_gate === 'plan_approval' || status.hitl_gate === 'pending_plan_approval') && !status.plan_approved);
  const isGate2 = status.phase === 'delivery_signoff' || ((status.hitl_gate === 'Gate 2 (Delivery Sign-Off)' || status.hitl_gate === 'delivery_signoff' || status.hitl_gate === 'pending_human_signoff') && !status.human_signed_off);
  if (!isGate1 && !isGate2) return null;

  const taskId = path.basename(resolvedTaskDir);
  const inputCandidate = options?.choice ?? options?.gate_action ?? prompt;
  const inputRefinement = options?.refinement ?? options?.feedback;
  const choiceObj = parseGateChoice(inputCandidate, inputRefinement);

  if (choiceObj) {
    const { runMcpWorkflow } = require('./workflow_runner');
    if (isGate1) {
      const g1Res = applyGate1Choice(choiceObj, status, resolvedTaskDir, sdlcManager);
      const wfRaw = runMcpWorkflow(resolvedTaskDir);
      return _mergeGate1WorkflowOutput(g1Res, status, wfRaw);
    }
    const g2Res = applyGate2Choice(choiceObj, status, resolvedTaskDir, sdlcManager);
    if (g2Res.signed_off) {
      // A terminal answer must still carry the evidence the gate judged:
      // without confidence and the Akatsuki verdict the client cannot tell a
      // clean pass from a signed-off remediation.
      const res = JSON.stringify({
        status: 'completed',
        phase: 'done',
        gateVerdict: 'pass',
        task_id: taskId,
        task_dir: resolvedTaskDir,
        confidence: status.confidence,
        ai_slop_findings: status.ai_slop_findings,
        akatsuki_gate: status.akatsuki_gate || status.akatsuki_final_gate,
        report: status.report
      });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    }
    return runMcpWorkflow(resolvedTaskDir);
  }

  const res = isGate1
    ? buildGate1Prompt(status, resolvedTaskDir, taskId, status.plan)
    : buildGate2Prompt(status, resolvedTaskDir, taskId, { confidence: status.confidence || 100, report: status.report });
  const { redactSecrets } = require('../bridge/utils');
  logToolCall('sannin', redactSecrets(`task_dir=${resolvedTaskDir}`), redactSecrets(res), 'sannin');
  return res;
}

function _authorizeSanninRouteSkills(effPrompt, selectedAgent) {
  const candidateSkills = _resolveRoutedSkills(effPrompt, selectedAgent, { includeBlocked: true });
  const { findUnauthorizedSkill } = require('../skill_authorization');
  const authorize = (conn) => ({
    deniedEntry: findUnauthorizedSkill(candidateSkills, selectedAgent, conn),
    routedSkills: _filterAuthorizedSkills(candidateSkills, selectedAgent, { conn })
  });
  return _withDbConn(authorize) || authorize(null);
}

function _prepareSanninDispatch(prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {}) {
  const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
  const cd = require('./client_detection');
  const resolvedProjPath = projectPath || getWorkspaceRoot() || process.cwd();
  const resolvedSessionId = sessionId || cd.getActiveSessionId(resolvedProjPath);
  const actClient = (typeof getActiveClient === 'function' ? getActiveClient() : null) || cd.detectActiveClient() || '';
  const spawnClient = cd.resolveDetectedSpawnClient(actClient, 'universal');
  const resolvedTaskDir = _resolveSanninTaskDir(prompt, taskDir, resolvedProjPath, resolvedSessionId);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });
  const taskId = path.basename(resolvedTaskDir);
  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  const status = _cleanStaleTaskArtifactsIfChanged(prompt, resolvedTaskDir, loadWorkflowStatus(resolvedTaskDir));

  if (status.phase === 'done' || status.status === 'completed') {
    const res = JSON.stringify({ status: 'completed', phase: 'done', task_id: taskId, task_dir: resolvedTaskDir, session_id: resolvedSessionId, client: actClient });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return { earlyReturn: res };
  }
  const gateHandledRes = _handlePendingGateSannin(status, prompt, options, resolvedTaskDir, sdlcManager);
  if (gateHandledRes) return { earlyReturn: gateHandledRes };

  const effPrompt = _resolveEffectivePrompt(prompt, status, taskId, sdlcManager);
  if (!effPrompt) return { earlyReturn: JSON.stringify({ status: 'error', message: 'No prompt provided for task execution.' }) };

  const parsedCmd = parseKonohaCommandInvocation(effPrompt);
  const invocationMode = parsedCmd.invocationMode;
  const directSubagent = parsedCmd.targetAgent;
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const dorResult = sdlcManager.checkReadiness(effPrompt, resolvedProjPath);
  const executionTrack = classifyExecutionTrack(effPrompt);
  const parallelWorkstreams = invocationMode === 'direct_subagent' ? [] : detectParallelWorkstreams(effPrompt);
  const route = decideRoute({ prompt: effPrompt, executionTrack, workstreams: parallelWorkstreams });
  const flowHash = computeFlowHash(resolvedSessionId, taskId, effPrompt);

  const rawAgent = routeByKeywordsWithPrompt(resolvedTaskDir, effPrompt, { precomputedAgent: options.precomputedAgent });
  const selectedAgent = rawAgent.startsWith('mcp_') ? rawAgent.substring(4) : rawAgent;
  const { deniedEntry, routedSkills } = _authorizeSanninRouteSkills(effPrompt, selectedAgent);
  if (deniedEntry) {
    const { authorizationDeniedResult } = require('../skill_authorization');
    const denial = authorizationDeniedResult({ identity: selectedAgent, reason: `Route to @${selectedAgent} requires red skill "${deniedEntry.skill}"; red skills may only be delegated to @akatsuki.` }, deniedEntry.skill);
    const res = JSON.stringify({ status: 'blocked', phase: 'skill_authorization', task_dir: resolvedTaskDir, flow_hash: flowHash, ...denial });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return { earlyReturn: res };
  }

  _recordTaskStatusAndFlow({ sdlcManager, taskId, effPrompt, sdlcConfig, dorResult, executionTrack, flowHash, routedSkills, resolvedProjPath, resolvedSessionId, actClient, resolvedTaskDir, route, invocationMode, directSubagent });
  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    const res = JSON.stringify({ status: 'blocked', phase: 'dor', message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address the missing items before dispatching.', missing: dorResult.missing, dor_result: dorResult, flow_hash: flowHash, task_dir: resolvedTaskDir });
    logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
    return { earlyReturn: res };
  }
  return {
    resolvedProjPath, resolvedSessionId, actClient, spawnClient, resolvedTaskDir, taskId,
    effPrompt, invocationMode, directSubagent, dorResult, executionTrack, parallelWorkstreams,
    route, flowHash, selectedAgent, routedSkills, judgment: options.judgment
  };
}

function _finalizeSanninDispatch(prep, envelope) {
  const {
    resolvedProjPath, resolvedSessionId, actClient, spawnClient, resolvedTaskDir, taskId,
    effPrompt, invocationMode, directSubagent, dorResult, executionTrack, parallelWorkstreams,
    route, flowHash, selectedAgent, routedSkills, judgment
  } = prep;
  const agentDescriptions = _loadAgentDescriptions();
  const description = agentDescriptions[selectedAgent] || agentDescriptions[selectedAgent.replace(/_/g, '-')] || agentDescriptions[selectedAgent.replace(/-/g, '_')] || 'general-purpose delegation';
  const spawnDirective = buildSpawnDirective({ client: spawnClient, agent: selectedAgent, skills: routedSkills, projectPath: resolvedProjPath, prompt: effPrompt });
  const parallelSpawnDirective = parallelWorkstreams.length > 1
    ? buildParallelSpawnDirective({
      client: spawnClient, projectPath: resolvedProjPath,
      dispatches: parallelWorkstreams.map((ws) => ({ agent: ws.agent, task: ws.task || `${effPrompt} (${ws.domain} slice)`, skills: _resolveRoutedSkills(effPrompt, ws.agent) }))
    })
    : '';

  const currentSt = loadWorkflowStatus(resolvedTaskDir);
  // Tasks are owned by the plan (Gate 1) and by the slices that report into them.
  // Re-seeding them from the route on every call reset finished work to pending, so
  // a resumed call re-dispatched a slice whose child had already run.
  const existingTasks = Array.isArray(currentSt.tasks) ? currentSt.tasks : [];
  const syncBundle = syncTodoAndWalkthrough(currentSt, {
    client: actClient, taskDir: resolvedTaskDir, taskId,
    tasks: existingTasks.length > 0
      ? undefined
      : (parallelWorkstreams.length > 1
        ? parallelWorkstreams.map((ws, i) => ({ id: `task_${i + 1}`, task: `${effPrompt} (${ws.domain} slice)`, agent: ws.agent, status: 'pending' }))
        : [{ id: 'task_1', task: effPrompt, agent: selectedAgent, status: 'in_progress' }])
  });
  const advisorSupervisor = initAdvisorSessionSupervisor({ client: spawnClient, status: currentSt, goal: effPrompt, todos: syncBundle.todos });
  saveWorkflowStatus(resolvedTaskDir, currentSt);
  const advisorStartup = buildAdvisorStartupDirective({ client: spawnClient, projectPath: resolvedProjPath, prompt: effPrompt, taskDir: resolvedTaskDir });

  const instruction = _buildInstructionText({
    selectedAgent, executionTrack, flowHash, routedSkills, description,
    resolvedTaskDir, taskId, effPrompt, dorResult, parallelWorkstreams, resolvedProjPath,
    route, envelope, spawnDirective, parallelSpawnDirective, advisorStartup
  });

  const res = JSON.stringify({
    status: 'routed', task_id: taskId, flow_hash: flowHash, selected_agent: selectedAgent,
    invocation_mode: invocationMode, direct_subagent: directSubagent || undefined,
    mandatory_kage_review: invocationMode === 'direct_subagent' ? true : undefined,
    skills: routedSkills, execution_track: executionTrack, parallel_eligible: parallelWorkstreams.length > 1,
    parallel_workstreams: parallelWorkstreams.length > 1 ? parallelWorkstreams : undefined,
    parallel_spawn_directive: parallelSpawnDirective || undefined,
    advisor_supervisor: { state: advisorSupervisor.state, started_from_beginning: advisorSupervisor.started_from_beginning },
    advisor_spawn_directive: {
      agent: 'advisor',
      started_from_beginning: true,
      spawn_call: advisorStartup.spawn_call || advisorStartup.cli_fallback,
      cli_fallback: advisorStartup.cli_fallback,
      steer_tool: (advisorStartup.steer_protocol || {}).tool || null
    },
    todos: (syncBundle.todos || []).map((t) => ({ id: t.id, content: t.content, status: t.status, agent: t.agent })),
    walkthrough_steps: (syncBundle.walkthrough_steps || []).map((w) => ({ id: w.id, status: w.status })),
    client_todo_directive: { native_tool: syncBundle.client_todo_directive.native_tool, progress_summary: syncBundle.client_todo_directive.progress_summary },
    route: judgment ? { ...route, judgment } : route, delegation_envelope: envelope ? { agent: envelope.agent, skills: envelope.skills } : undefined,
    phase: 'delegation', execution_mode: route.mode, instructions: instruction, task_dir: resolvedTaskDir,
    session_id: resolvedSessionId, client: actClient, dor_result: { ready: dorResult.ready, score: dorResult.score }
  });
  const { redactSecrets } = require('../bridge/utils');
  logToolCall('sannin', redactSecrets(`task_dir=${resolvedTaskDir}`), redactSecrets(res), 'sannin');
  return res;
}

function runSannin(prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {}) {
  const prep = _prepareSanninDispatch(prompt, taskDir, projectPath, sessionId, options);
  if (prep.earlyReturn) return prep.earlyReturn;
  const envelope = buildDelegationEnvelope({ agentName: prep.selectedAgent, projectPath: prep.resolvedProjPath, prompt: prep.effPrompt, routedSkills: prep.routedSkills });
  return _finalizeSanninDispatch(prep, envelope);
}

const _parallelMod = require('./workflow_sannin_dispatch');
const dispatchParallelSlices = (ws, opts) => _parallelMod.dispatchParallelSlices(ws, opts, _resolveRoutedSkills);
const dispatchParallelSlicesAsync = (ws, opts) => _parallelMod.dispatchParallelSlicesAsync(ws, opts, _resolveRoutedSkills);

/**
 * Keyword routing is free and usually right. When the top two candidates fall
 * within SJ_AMBIGUITY_MARGIN, ask the host model once; any failure leaves the
 * heuristic verdict standing.
 */
async function _judgeAmbiguousRoute(prompt, projectPath) {
  const empty = { source: 'heuristic', reason: 'not ambiguous' };
  if (!prompt || typeof prompt !== 'string') return empty;
  const parsed = parseKonohaCommandInvocation(prompt);
  if (parsed.invocationMode === 'direct_subagent') return empty;
  const text = parsed.cleanPrompt || prompt;
  const executionTrack = classifyExecutionTrack(text);
  const route = decideRoute({ prompt: text, executionTrack, workstreams: detectParallelWorkstreams(text) });
  if (route.mode !== 'delegate') return empty;
  const { SJ_AMBIGUITY_MARGIN, judgeRoute } = require('./structured_judgment');
  if (!isRoutingAmbiguous(text.toLowerCase(), SJ_AMBIGUITY_MARGIN)) return empty;
  const candidates = rankAgentCandidates(text.toLowerCase()).slice(0, 4).map((c) => c.agent);
  if (candidates.length < 2) return empty;
  return judgeRoute({ prompt: text, candidates, projectPath });
}

async function _prepareSanninDispatchAsync(prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {}) {
  const judgment = options.precomputedAgent ? null : await _judgeAmbiguousRoute(prompt, projectPath);
  const opts = judgment && judgment.source === 'model' ? { ...options, precomputedAgent: judgment.agent } : options;
  return _prepareSanninDispatch(prompt, taskDir, projectPath, sessionId, { ...opts, judgment: judgment || { source: 'heuristic', reason: 'not ambiguous' } });
}

const runSanninAsync = (prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {}) =>
  _parallelMod.runSanninAsync(
    { prepare: _prepareSanninDispatch, prepareAsync: _prepareSanninDispatchAsync, finalize: _finalizeSanninDispatch, buildEnvelopeAsync: buildDelegationEnvelopeAsync },
    { prompt, taskDir, projectPath, sessionId, options }
  );

module.exports = {
  parseKonohaCommandInvocation, routeByKeywordsWithPrompt, classifyExecutionTrack, detectParallelWorkstreams,
  rankAgentCandidates, isRoutingAmbiguous,
  dispatchParallelSlices, dispatchParallelSlicesAsync, computeFlowHash, runSannin, runSanninAsync
};
