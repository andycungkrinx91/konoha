'use strict';

const { getCanonicalAgentNames, normalizeAgentName } = require('../canonical_agents');

function _wrapDeprecatedWarning(raw, oldName, newName) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify({
        _warning: `${oldName} is deprecated and will be removed in a future release. Please use ${newName} instead.`,
        deprecated: true,
        replaced_by: newName,
        ...parsed,
      });
    }
  } catch (_) {
    /* fallback to raw on parse error */
  }
  return raw;
}

/**
 * Konoha MCP Subsystem - Tool Dispatch Router
 * Extracted from server.js as part of modularization refactor (Phase 7)
 */

const path = require('path');
const { spawnSync } = require('child_process');
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { detectActiveAgent, getActiveSessionId } = require('./client_detection');
const { findSkill, listSkills, getSkill, useSkills, optimizeReport, logToolCall } = require('./skills');
const { runAntiSlopAudit } = require('./anti_slop');
const { buildFromSource, buildFromText } = require('./build_spec');
const { getResolvedTaskDir, runSannin } = require('./workflow');
const { runWebSearch } = require('./web_search');
const { runWebsiteAiDetector, runWebsiteAiDetectorSync } = require('./ai_detector');
const { runDocsAiDetector, runDocsAiDetectorSync } = require('./docs_ai_detector');
const {
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  runMcpAgent,
  reportFromAgent
} = require('./memory_reporting');

const { BOUNDED_FILE_TOOL_NAMES } = require('../file_tools_router');

const FILE_TOOLS = new Set(BOUNDED_FILE_TOOL_NAMES);

/**
 * Tools whose real work is the async LangGraph workflow. They only produce
 * gates, pickers, confidence and the Akatsuki pre-gate on `executeTool`; the
 * sync `executeToolSync` path returns routing metadata alone. Every MCP
 * transport must therefore await `executeTool` for these names.
 */
const WORKFLOW_GRAPH_TOOLS = Object.freeze(['sannin']);

// A single MCP call may have to spend several per-turn budgets before the
// workflow parks on a gate or finishes. Bounded so a pathological loop still
// returns something the caller can act on.
const MAX_GRAPH_TURNS = 6;

function annotateWorkflowFileHint(text) {
  return text;
}

function boundPersonaMemories(mems) {
  return (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
}

function _dispatchFileTool(toolName, args) {
  if (!FILE_TOOLS.has(toolName)) return null;
  const router = require('../file_tools_router');
  const { text } = router.dispatchTool(toolName, args || {});
  try {
    const retBytes = Buffer.byteLength(text || '', 'utf8');
    const logger = require('../tools_savings_logger');
    logger.log(toolName, JSON.stringify(args || {}).slice(0, 500), retBytes);
  } catch (_) {
    // Best-effort savings logging
  }
  return annotateWorkflowFileHint(text);
}

const SKILL_READ_TOOLS = Object.freeze(['get_skill', 'use_skills', 'use_skill']);

function _skillTargetNames(toolName, args) {
  if (toolName === 'get_skill') return [args.name || ''];
  const raw = args.skills || args.name || args.skill || args.names;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function _dispatchSkillsTool(toolName, args, agent) {
  if (toolName === 'find_skill' || toolName === 'find_skills') {
    let keyword = args.keyword || args.keywords || args.query || args.Query || '';
    if (Array.isArray(keyword)) keyword = keyword.join(' ');
    const { authorizeSkillAccess, authorizationDeniedResult } = require('../skill_authorization');
    const keyDenied = authorizeSkillAccess({ skillName: String(keyword), agentName: agent });
    if (!keyDenied.authorized) {
      return JSON.stringify(authorizationDeniedResult(keyDenied, String(keyword)));
    }
    const limit = Math.min(parseInt(args.limit || 3, 10), 5);
    const compact = Boolean(args.compact);
    const taskId = args.task_id || args.taskId || null;
    const flowHash = args.flow_hash || args.flowHash || null;
    const raw = findSkill(keyword, limit, agent, compact, taskId, flowHash);
    return toolName === 'find_skills' ? _wrapDeprecatedWarning(raw, 'find_skills', 'find_skill') : raw;
  }
  if (SKILL_READ_TOOLS.includes(toolName)) {
    const authz = require('../skill_authorization');
    for (const skillName of _skillTargetNames(toolName, args)) {
      const result = authz.authorizeSkillAccess({ skillName, agentName: agent });
      if (!result.authorized) {
        return JSON.stringify(authz.authorizationDeniedResult(result, skillName));
      }
    }
  }
  if (toolName === 'list_skills') {
    return listSkills(agent, args.fields);
  }
  if (toolName === 'get_skill') {
    return getSkill(args.name || '', agent, {
      tokenBudget: args.token_budget || args.tokenBudget || args.budget || 0,
      section: args.section || null,
      taskId: args.task_id || args.taskId || null,
      sessionId: args.session_id || args.sessionId || getActiveSessionId() || null,
      flowHash: args.flow_hash || args.flowHash || null
    });
  }
  if (toolName === 'use_skills' || toolName === 'use_skill') {
    const skillsArg = args.skills || args.name || args.skill || args.names;
    return useSkills(skillsArg, agent, {
      tokenBudget: args.token_budget || args.tokenBudget || args.budget || 0,
      section: args.section || null,
      taskId: args.task_id || args.taskId || null,
      sessionId: args.session_id || args.sessionId || getActiveSessionId() || null,
      flowHash: args.flow_hash || args.flowHash || null
    });
  }
  if (toolName === 'optimize_report') {
    return optimizeReport(args.keyword, agent);
  }
  return null;
}

function _dispatchAkatsukiInit(args) {
  const akatsukiInit = require('../workflow/akatsuki/init');
  const action = args.action || 'init';
  if (action === 'status') {
    const { getLabStatus, detectEngines } = require('../workflow/akatsuki/lab');
    const detected = detectEngines();
    const labName = args.lab_name || 'akatsuki-lab';
    const engineStatuses = detected.available.map(e => ({
      engine: e,
      status: getLabStatus(labName, e)
    }));
    return JSON.stringify({ status: 'ok', detected_engines: detected, labs: engineStatuses }, null, 2);
  }
  if (action === 'list_tools') {
    const tools = akatsukiInit.listKaliTools({ query: args.query, category: args.category });
    return JSON.stringify({ status: 'ok', count: tools.length, tools }, null, 2);
  }
  if (action === 'add_tool') {
    return JSON.stringify(akatsukiInit.addTool(args.tool || args), null, 2);
  }
  if (action === 'remove_tool') {
    return JSON.stringify(akatsukiInit.removeTool(args.tool_id || args.id || (args.tool && args.tool.id)), null, 2);
  }
  return JSON.stringify(akatsukiInit.initLab(args), null, 2);
}

function _resolveFlowHash(args, taskDir) {
  let flowHash = args.flow_hash || args.flowHash || null;
  const taskId = args.task_id || args.taskId || (taskDir ? path.basename(taskDir) : null);
  if (!flowHash && taskId) {
    try {
      const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
      const t = sdlcManager.getTask(taskId);
      if (t?.evidence) {
        const ev = typeof t.evidence === 'string' ? JSON.parse(t.evidence) : t.evidence;
        if (ev?.flow_hash) flowHash = ev.flow_hash;
      }
    } catch (_) { /* ignore */ }
  }
  return flowHash;
}

function _dispatchAgentDelegation(toolName, args, callerIdentity) {
  if (toolName === 'akatsuki') {
    const akatsukiExplicitLab = Boolean(
      args.workflow_type || args.standalone || args.authorized !== undefined || args.execute_workflow || args.run_workflow
    );
    if (akatsukiExplicitLab) {
      const { dispatchAkatsuki } = require('../workflow/akatsuki/workflows');
      // Caller identity comes from the trusted dispatch context, never from the
      // requested target: toolName === 'akatsuki' is what was asked for, not who asked.
      return dispatchAkatsuki({ ...args, agentName: callerIdentity || null });
    }
  }

  const delegatable = getCanonicalAgentNames().filter(n => n !== 'sannin');
  const requested = normalizeAgentName(toolName);
  if (!delegatable.includes(requested)) {
    return null;
  }

  const task = args.task || args.prompt || args.instructions;
  const projectPath = args.project_path || getWorkspaceRoot();
  const taskDir = args.task_dir;
  const sessId = args.session_id || args.sessionId;
  const flowHash = _resolveFlowHash(args, taskDir);
  const worktree = args.worktree || args.worktree_path || null;

  return runMcpAgent(toolName, {
    task,
    context: args.context,
    constraints: args.constraints,
    skills: args.skills,
    tasteDials: args.taste_dials || args.tasteDials,
    projectPath,
    taskDir,
    sessionId: sessId,
    flowHash,
    taskId: args.task_id || args.taskId || null,
    client: args.client || null,
    worktree
  });
}

function _dispatchWorkflowCore(toolName, args, agent) {
  if (toolName === 'build_with_image_design' || toolName === 'build_from_source') {
    const { name, source_dir, framework } = args;
    if (!name || !source_dir || !framework) {
      return JSON.stringify({ error: 'Missing required arguments: name, source_dir, and framework are all required.' });
    }
    const raw = buildFromSource(name, source_dir, framework, agent, args.taste_dials);
    return toolName === 'build_with_image_design' ? _wrapDeprecatedWarning(raw, 'build_with_image_design', 'build_from_source') : raw;
  }
  if (toolName === 'build_from_text') {
    const { name, description, framework } = args;
    if (!name || !description || !framework) {
      return JSON.stringify({ error: 'Missing required arguments: name, description, and framework are all required.' });
    }
    return buildFromText(name, description, framework, agent, args.taste_dials);
  }
  if (toolName === 'get_resolved_task_dir') {
    const projPath = args.project_path || getWorkspaceRoot();
    const sessId = args.session_id || args.sessionId;
    return JSON.stringify({ status: 'ok', task_dir: getResolvedTaskDir(args.task_dir, projPath, sessId) });
  }
  if (toolName === 'sannin') {
    const prompt = args.prompt || args.task || args.instructions;
    const projPath = args.project_path || getWorkspaceRoot();
    const sessId = args.session_id || args.sessionId;
    return runSannin(prompt, args.task_dir, projPath, sessId, args);
  }
  if (toolName === 'check_readiness') {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const taskInput = args.task || args.prompt || args.description || '';
    const projPath = args.project_path || getWorkspaceRoot();
    return JSON.stringify(sdlcManager.checkReadiness(taskInput, projPath));
  }
  return null;
}

/** The graph parks on a gate with the prompt envelope as a JSON string. */
function _parseGateEnvelope(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function _mergeSanninGraphResponse(parsedSannin, graphInitRes, threadId) {
  if (!parsedSannin || typeof graphInitRes !== 'object' || graphInitRes === null) {
    return graphInitRes;
  }
  const checkpoint = {
    thread_id: threadId,
    graph_phase: graphInitRes.phase,
    hitl_stage: graphInitRes.hitlStage || null,
    flow_hash: graphInitRes.flowHash || parsedSannin.flow_hash
  };
  // LangGraph only carries channels declared in KonohaWorkflowState, so the
  // Akatsuki verdict never survives as a top-level node key. It is persisted on
  // the workflow status, which `formatGraphOutput` exposes as `workflow_status`.
  const wfStatus = (graphInitRes.workflow_status && typeof graphInitRes.workflow_status === 'object')
    ? graphInitRes.workflow_status
    : (graphInitRes.status && typeof graphInitRes.status === 'object' ? graphInitRes.status : null);

  // A parked gate IS the answer to this call. Merging the routing envelope over
  // it would leave `instructions: spawn a subagent` on top of a paused workflow,
  // so the agent never raises the picker and the gate is never answered.
  // The envelope itself is the proof: a turn that stopped on the token budget
  // also carries `hitlPending` from the checkpoint, but has no gate to answer.
  const gateEnvelope = _parseGateEnvelope(graphInitRes.result);
  if (gateEnvelope && gateEnvelope.hitl_gate && gateEnvelope.picker) {
    return {
      ...gateEnvelope,
      status: 'awaiting_human',
      phase: graphInitRes.phase,
      task_id: parsedSannin.task_id,
      task_dir: parsedSannin.task_dir,
      flow_hash: parsedSannin.flow_hash,
      session_id: parsedSannin.session_id,
      client: parsedSannin.client,
      selected_agent: parsedSannin.selected_agent,
      confidence: graphInitRes.confidence ?? wfStatus?.confidence,
      akatsukiPassed: wfStatus?.blue_mode_before_kage_verified,
      akatsuki_gate: wfStatus?.akatsuki_gate || wfStatus?.akatsuki_final_gate,
      hitlPending: true,
      hitlStage: graphInitRes.hitlStage || null,
      next_action: 'answer_hitl_gate',
      langgraph_checkpoint: checkpoint
    };
  }

  if (parsedSannin.status === 'routed') {
    return {
      ...graphInitRes,
      ...parsedSannin,
      status: 'routed',
      phase: parsedSannin.phase || 'delegation',
      langgraph_checkpoint: checkpoint,
      workflow_state: typeof graphInitRes.status === 'object' ? graphInitRes.status : undefined,
      selected_agent: parsedSannin.selected_agent || graphInitRes.assigned_agent || (graphInitRes.status && graphInitRes.status.assigned_agent),
    };
  }
  const graphStatusStr = typeof graphInitRes.status === 'string'
    ? graphInitRes.status
    : (graphInitRes.status && typeof graphInitRes.status.status === 'string' ? graphInitRes.status.status : parsedSannin.status);
  return {
    ...parsedSannin,
    ...graphInitRes,
    status: graphStatusStr || parsedSannin.status,
    workflow_state: typeof graphInitRes.status === 'object' ? graphInitRes.status : undefined,
    selected_agent: parsedSannin.selected_agent || graphInitRes.assigned_agent || (graphInitRes.status && graphInitRes.status.assigned_agent),
  };
}

async function _dispatchWorkflowGraphAsync(toolName, args, _agent) {
  if (WORKFLOW_GRAPH_TOOLS.includes(toolName)) {
    const prompt = args.prompt || args.task || args.instructions;
    const projPath = args.project_path || getWorkspaceRoot();
    const sessId = args.session_id || args.sessionId;

    const sanninRes = runSannin(prompt, args.task_dir, projPath, sessId, args);
    let parsedSannin = null;
    try {
      parsedSannin = JSON.parse(sanninRes);
    } catch (_) { /* ignore JSON parse error */ }

    if (parsedSannin && (parsedSannin.status === 'blocked' || parsedSannin.status === 'completed' || parsedSannin.status === 'error')) {
      return sanninRes;
    }

    const resolvedTaskDir = (parsedSannin && parsedSannin.task_dir) || getResolvedTaskDir(args.task_dir, projPath, sessId);
    const threadId = args.thread_id || args.threadId || (parsedSannin && parsedSannin.task_id) || (resolvedTaskDir ? path.basename(resolvedTaskDir) : 'default-thread');
    const tokenBudget = args.token_budget || args.tokenBudget;
    const autoSignoff = Boolean(args.auto_signoff);

    try {
      const { sanninWorkflowInit } = require('./workflow');
      // Gate answers and client identity must reach the graph state: without
      // `client` the picker degrades to the web picker, and without `choice` a
      // resumed gate is re-raised instead of applied.
      const graphOptions = {
        prompt: prompt || (parsedSannin && parsedSannin.prompt),
        tokenBudget,
        threadId,
        autoSignoff,
        choice: args.choice || args.gate_choice || args.gateChoice || args.hitl_choice || args.action,
        refinement: args.refinement || args.feedback || args.notes,
        client: (parsedSannin && parsedSannin.client) || args.client,
        sessionId: (parsedSannin && parsedSannin.session_id) || sessId,
      };
      let graphInitRes = await sanninWorkflowInit(resolvedTaskDir, graphOptions);
      // The per-turn token budget halts the graph mid-flight. A client that made
      // one tool call expects a gate or a result, not a resume instruction, so
      // keep turning until the workflow is parked or done.
      for (let turn = 1; turn < MAX_GRAPH_TURNS && graphInitRes.status === 'paused_budget_exceeded'; turn++) {
        graphInitRes = await sanninWorkflowInit(resolvedTaskDir, { ...graphOptions, choice: null, refinement: null });
      }
      return _mergeSanninGraphResponse(parsedSannin, graphInitRes, threadId);
    } catch (graphErr) {
      if (typeof logToolCall === 'function') {
        logToolCall('sannin', `task_dir=${resolvedTaskDir} fallback=runSannin error=${graphErr.message}`, sanninRes, 'sannin');
      }
      return sanninRes;
    }
  }

  return null;
}

function _dispatchMemory(toolName, args, agent) {
  if (toolName === 'report_from_agent' || (toolName && toolName.startsWith('report_from_'))) {
    let inferredAgent = (toolName && toolName.startsWith('report_from_'))
      ? toolName.replace('report_from_', '')
      : (args.agent_name || agent);
    if (inferredAgent === 'agent' || !inferredAgent) inferredAgent = args.agent_name || agent;
    const projectPath = args.project_path || getWorkspaceRoot();
    return reportFromAgent(
      inferredAgent, args.summary || '', args.status || 'completed',
      args.files_created || [], args.files_modified || [], args.learnings || [],
      projectPath, args.task_dir, args.dispatch_id, args.validation
    );
  }
  if (toolName === 'get_project_context') {
    return getProjectContext(args.project_path || getWorkspaceRoot(), args.session_id);
  }
  if (toolName === 'save_project_context') {
    return saveProjectContext(args.project_path || getWorkspaceRoot(), args.context_summary || '', args.tech_stack, args.session_id);
  }
  if (toolName === 'query_project_memory') {
    return queryProjectMemory(args.query || '', args.project_path || getWorkspaceRoot(), args.agent_name, args.memory_type, parseInt(args.limit || 10, 10), args.session_id);
  }
  if (toolName === 'migrate_skills') {
    const migrateModule = require('../migrate');
    return JSON.stringify(migrateModule.migrate_skills(args));
  }
  return null;
}

function _dispatchPersonaMemory(toolName, args, agent) {
  if (toolName === 'save_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const content = args.content || '';
    if (!targetAgent || !content) return JSON.stringify({ error: 'agent_name and content are required.' });
    try {
      const mid = personaMemory.saveMemory({
        agentName: targetAgent, content, title: args.title || '', memoryType: args.memory_type || 'rule',
        tags: args.tags || '', importance: parseInt(args.importance || 1, 10),
        projectPath: args.project_path || getWorkspaceRoot(), sessionId: args.session_id
      });
      return JSON.stringify({ status: 'saved', id: mid, agent: targetAgent });
    } catch (e) {
      return JSON.stringify({ error: `Failed to save memory: ${e.message}` });
    }
  }
  if (toolName === 'query_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const projectPath = args.project_path || getWorkspaceRoot();
    try {
      const mems = personaMemory.queryMemories({
        agentName: targetAgent, query: args.query || '', memoryType: args.memory_type,
        projectPath, sessionId: args.session_id || getActiveSessionId(projectPath),
        allSessions: Boolean(args.all_sessions || args.allSessions), limit: Math.min(Math.max(parseInt(args.limit || 5, 10), 1), 10)
      });
      const boundedMems = boundPersonaMemories(mems);
      return JSON.stringify({ agent: targetAgent, count: boundedMems.length, memories: boundedMems });
    } catch (e) {
      return JSON.stringify({ error: `Failed to query memories: ${e.message}` });
    }
  }
  if (toolName === 'list_persona_memories') {
    const projectPath = args.project_path || getWorkspaceRoot();
    try {
      const mems = personaMemory.listMemories({
        agentName: args.agent_name, memoryType: args.memory_type, projectPath,
        sessionId: args.session_id || getActiveSessionId(projectPath),
        allSessions: Boolean(args.all_sessions || args.allSessions), limit: Math.min(Math.max(parseInt(args.limit || 10, 10), 1), 20)
      });
      const boundedMems = boundPersonaMemories(mems);
      return JSON.stringify({ count: boundedMems.length, memories: boundedMems });
    } catch (e) {
      return JSON.stringify({ error: `Failed to list memories: ${e.message}` });
    }
  }
  if (toolName === 'delete_persona_memory') {
    if (!args.id) return JSON.stringify({ error: 'Memory id is required.' });
    try {
      const deleted = personaMemory.deleteMemory(args.id);
      return JSON.stringify({ status: deleted ? 'deleted' : 'not_found', id: args.id });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete memory: ${e.message}` });
    }
  }
  if (toolName === 'get_soul') {
    const agentName = args.agent_name || args.agent || null;
    const projectPath = args.project_path || getWorkspaceRoot();
    const raw = Boolean(args.raw);
    try {
      const soul = personaMemory.getSoul({ agentName, projectPath, raw });
      return raw ? (soul.raw_markdown || '') : JSON.stringify(soul);
    } catch (e) {
      return JSON.stringify({ error: `Failed to load soul: ${e.message}` });
    }
  }
  return null;
}

function _dispatchAuditAndDetectors(toolName, args, agent) {
  if (toolName === 'get_task_evidence' || toolName === 'get_slop_findings') {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const taskId = args.task_id || args.id || (args.task_dir ? path.basename(String(args.task_dir)) : null);
    if (!taskId) return JSON.stringify({ error: 'Missing required argument: task_id' });
    const task = sdlcManager.getTask(taskId);
    if (!task) return JSON.stringify({ error: `Task not found: ${taskId}` });
    if (toolName === 'get_task_evidence') {
      const ev = task.evidence || {};
      return JSON.stringify({
        task_id: task.id,
        status: task.status,
        evidence: ev,
        total_reports: Object.keys(ev).length,
        updated_at: task.updated_at
      });
    }
    return JSON.stringify({ task_id: task.id, status: task.status, slop_result: task.slop_result || {}, slop_cycles: task.slop_cycles || 0, updated_at: task.updated_at });
  }
  if (toolName === 'anti_slop') {
    return runAntiSlopAudit(args, agent);
  }
  if (toolName === 'website_ai_detector') {
    const target = args.target || args.path || args.url || args.site;
    if (!target) return JSON.stringify({ error: 'Missing required argument: target (site directory path or http(s) URL)' });
    const syncRes = runWebsiteAiDetectorSync(String(target), agent);
    if (syncRes !== null) return syncRes;
    const serverJsPath = path.resolve(__dirname, '..', 'server.js');
    const res = spawnSync(process.execPath, [serverJsPath, '--tool', 'website_ai_detector', JSON.stringify({ target: String(target) })], {
      encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024
    });
    if (res.error) return JSON.stringify({ error: res.error.message || String(res.error) });
    return (res.stdout || '').trim() || (res.stderr || '').trim() || JSON.stringify({ status: 'error', message: 'No output from website_ai_detector' });
  }
  if (toolName === 'docs_ai_detector') {
    const target = args.file_path || args.target || args.path || args.file;
    if (!target) return JSON.stringify({ error: 'Missing required argument: file_path (document file path)' });
    return runDocsAiDetectorSync(String(target), agent);
  }
  return null;
}

function _executeToolInternal(toolName, args, agent) {
  const fileRes = _dispatchFileTool(toolName, args);
  if (fileRes !== null) return fileRes;

  const skillsRes = _dispatchSkillsTool(toolName, args, agent);
  if (skillsRes !== null) return skillsRes;

  const wfRes = _dispatchWorkflowCore(toolName, args, agent);
  if (wfRes !== null) return wfRes;

  if (toolName === 'akatsuki_init') {
    return _dispatchAkatsukiInit(args);
  }

  const agentRes = _dispatchAgentDelegation(toolName, args, agent);
  if (agentRes !== null) return agentRes;

  const memRes = _dispatchMemory(toolName, args, agent);
  if (memRes !== null) return memRes;

  const personaRes = _dispatchPersonaMemory(toolName, args, agent);
  if (personaRes !== null) return personaRes;

  const auditRes = _dispatchAuditAndDetectors(toolName, args, agent);
  if (auditRes !== null) return auditRes;

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

/**
 * Identity resolution rule: an explicitly supplied agent is authoritative.
 * Detection only applies when no agent was supplied — a caller cannot borrow
 * the detected identity (e.g. @akatsuki) by passing a different agent name.
 */
function _resolveAgentIdentity(args) {
  const explicit = args.agent || args.agent_name;
  if (explicit) return normalizeAgentName(String(explicit));
  const detected = detectActiveAgent();
  return detected ? normalizeAgentName(String(detected)) : '';
}

function executeToolSync(toolName, args = {}) {
  let agent = _resolveAgentIdentity(args);
  const GENIN_BLOCKED_MUTATION_TOOLS = [
    'document_create', 'spreadsheet_create', 'presentation_create',
    'diagram_create', 'animation_export'
  ];
  if (agent === 'genin' && GENIN_BLOCKED_MUTATION_TOOLS.includes(toolName)) {
    return JSON.stringify({
      error: `Permission denied: @genin is in strict read-only mode and cannot call '${toolName}'. Use read-only exploration or delegate to anbu/tokubetsu-jonin.`
    });
  }

  if (['web_search', 'document_create', 'spreadsheet_create', 'presentation_create', 'diagram_create', 'animation_export'].includes(toolName)) {
    const serverJsPath = path.resolve(__dirname, '..', 'server.js');
    const res = spawnSync(process.execPath, [serverJsPath, '--tool', toolName, JSON.stringify(args || {})], {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 15 * 1024 * 1024
    });
    if (res.error) return JSON.stringify({ error: res.error.message || String(res.error) });
    return (res.stdout || '').trim() || (res.stderr || '').trim() || JSON.stringify({ status: 'error', message: `No output from ${toolName}` });
  }

  return _executeToolInternal(toolName, args, agent);
}

async function _executeHeavyToolAsync(toolName, args, agent) {
  if (toolName === 'web_search') {
    const query = args.query;
    const numResults = Math.min(Math.max(parseInt(args.num_results || 5, 10), 1), 50);
    const searchDepth = ['standard', 'deep'].includes(args.search_depth) ? args.search_depth : 'standard';
    return await runWebSearch(query, numResults, searchDepth, agent);
  }
  if (toolName === 'document_create') {
    const { documentCreate } = require('../workflow/tokubetsu-scribe/document_engine');
    return JSON.stringify(await documentCreate(args));
  }
  if (toolName === 'spreadsheet_create') {
    const { spreadsheetCreate } = require('../workflow/tokubetsu-scribe/document_engine');
    return JSON.stringify(await spreadsheetCreate(args));
  }
  if (toolName === 'presentation_create') {
    const { presentationCreate } = require('../workflow/tokubetsu-scribe/document_engine');
    return JSON.stringify(await presentationCreate(args));
  }
  if (toolName === 'diagram_create') {
    const { diagramCreate } = require('../workflow/tokubetsu-scribe/document_engine');
    return JSON.stringify(await diagramCreate(args));
  }
  if (toolName === 'animation_export') {
    const { animationExport } = require('../workflow/tokubetsu-scribe/document_engine');
    return JSON.stringify(await animationExport(args));
  }
  if (toolName === 'website_ai_detector') {
    const target = args.target || args.path || args.url || args.site;
    if (!target) return JSON.stringify({ error: 'Missing required argument: target (site directory path or http(s) URL)' });
    return await runWebsiteAiDetector(String(target), agent);
  }
  if (toolName === 'docs_ai_detector') {
    const target = args.file_path || args.target || args.path || args.file;
    if (!target) return JSON.stringify({ error: 'Missing required argument: file_path (document file path)' });
    return await runDocsAiDetector(String(target), agent);
  }
  return null;
}

async function executeTool(toolName, args = {}) {
  const agent = _resolveAgentIdentity(args);

  const heavyRes = await _executeHeavyToolAsync(toolName, args, agent);
  if (heavyRes !== null) return heavyRes;

  const graphRes = await _dispatchWorkflowGraphAsync(toolName, args, agent);
  if (graphRes !== null) {
    return typeof graphRes === 'object' ? JSON.stringify(graphRes) : graphRes;
  }

  const res = _executeToolInternal(toolName, args, agent);
  if (typeof res === 'object' && res !== null) {
    return JSON.stringify(res);
  }
  return res;
}

function validateManifestArguments(toolName, args) {
  const fileTools = require('../file_tools_router');
  const normalized = fileTools.normalizeToolArguments(toolName, args);
  for (const k of Object.keys(args)) {
    delete args[k];
  }
  Object.assign(args, normalized);
  fileTools.validateToolArguments(toolName, args);
  return args;
}

module.exports = {
  WORKFLOW_GRAPH_TOOLS,
  _executeToolInternal,
  executeToolSync,
  executeTool,
  validateManifestArguments
};
