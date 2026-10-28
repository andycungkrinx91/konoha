/**
 * Konoha MCP Subsystem - Tool Dispatch Router
 * Extracted from server.js as part of modularization refactor (Phase 7)
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { detectActiveAgent, getActiveSessionId } = require('./client_detection');
const { findSkill, listSkills, getSkill, useSkills, optimizeReport } = require('./skills');
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

const WORKFLOW_FILENAMES = new Set([
  'plan.md', 'findings.md', 'final_report.md', 'final_docs.md',
  'kage_review.json', 'status.json'
]);

function annotateWorkflowFileHint(text) {
  try {
    if (typeof text !== 'string' || !text.includes('"error"')) return text;
    const parsed = JSON.parse(text);
    const rawPath = parsed && typeof parsed.error === 'string'
      ? (parsed.error.match(/File not found: (.+?)(?:$|")/) || [])[1]
      : null;
    if (!rawPath) return text;
    const base = path.basename(rawPath).toLowerCase();
    if (!WORKFLOW_FILENAMES.has(base)) return text;
    const taskDir = getResolvedTaskDir(null);
    parsed.hint = `'${base}' is a workflow artifact and lives in the task directory, not the workspace root. ` +
      `Current task dir: ${taskDir}. Use get_resolved_task_dir to resolve it, then read files there.`;
    return JSON.stringify(parsed);
  } catch (_) {
    return text;
  }
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

function _dispatchSkillsTool(toolName, args, agent) {
  if (toolName === 'find_skill' || toolName === 'find_skills') {
    let keyword = args.keyword || args.keywords || args.query || args.Query || '';
    if (Array.isArray(keyword)) keyword = keyword.join(' ');
    const limit = Math.min(parseInt(args.limit || 3, 10), 5);
    const compact = Boolean(args.compact);
    const taskId = args.task_id || args.taskId || null;
    const flowHash = args.flow_hash || args.flowHash || null;
    return findSkill(keyword, limit, agent, compact, taskId, flowHash);
  }
  if (toolName === 'list_skills') {
    return listSkills(agent, args.fields);
  }
  if (toolName === 'get_skill') {
    return getSkill(args.name || '', agent, {
      tokenBudget: args.token_budget || args.tokenBudget || args.budget || 0,
      section: args.section || null,
      taskId: args.task_id || args.taskId || null,
      sessionId: args.session_id || args.sessionId || null,
      flowHash: args.flow_hash || args.flowHash || null
    });
  }
  if (toolName === 'use_skills' || toolName === 'use_skill') {
    const skillsArg = args.skills || args.name || args.skill || args.names;
    return useSkills(skillsArg, agent, {
      tokenBudget: args.token_budget || args.tokenBudget || args.budget || 0,
      section: args.section || null,
      taskId: args.task_id || args.taskId || null,
      sessionId: args.session_id || args.sessionId || null,
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

function _dispatchAgentDelegation(toolName, args) {
  if (toolName === 'akatsuki') {
    const akatsukiRedIntent = /\b(red[- ]team|pentest|penetration test|exploit|adversary|attack simulation|fuzz)\b/i.test([
      args.task || '', args.prompt || '', args.instructions || '', args.context || ''
    ].join(' '));
    if (args.workflow_type || args.standalone || args.authorized !== undefined || args.execute_workflow || args.run_workflow || akatsukiRedIntent) {
      const { dispatchAkatsuki } = require('../workflow/akatsuki/workflows');
      return dispatchAkatsuki(args);
    }
  }

  if (!['kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'genin', 'akatsuki'].includes(toolName)) {
    return null;
  }

  const task = args.task || args.prompt || args.instructions;
  const projectPath = args.project_path || getWorkspaceRoot();
  const taskDir = args.task_dir;
  const sessId = args.session_id || args.sessionId;
  const flowHash = _resolveFlowHash(args, taskDir);

  return runMcpAgent(
    toolName, task, args.context, args.constraints, args.skills,
    args.taste_dials, projectPath, taskDir, sessId, flowHash
  );
}

function _dispatchWorkflowCore(toolName, args, agent) {
  if (toolName === 'build_with_image_design' || toolName === 'build_from_source') {
    const { name, source_dir, framework } = args;
    if (!name || !source_dir || !framework) {
      return JSON.stringify({ error: 'Missing required arguments: name, source_dir, and framework are all required.' });
    }
    return buildFromSource(name, source_dir, framework, agent, args.taste_dials);
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
  if (toolName === 'workflow_gate_choice' || toolName === 'workflow_gate_response') {
    const choice = args.choice ?? args.gate_choice ?? args.action ?? args.gate_action;
    const refinement = args.refinement ?? args.feedback ?? args.notes;
    const taskDir = args.task_dir || args.taskDir;
    const { runMcpWorkflow } = require('./workflow');
    return runMcpWorkflow(taskDir, { choice, refinement });
  }
  if (toolName === 'check_readiness') {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    const taskInput = args.task || args.prompt || args.description || '';
    const projPath = args.project_path || getWorkspaceRoot();
    return JSON.stringify(sdlcManager.checkReadiness(taskInput, projPath));
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
    const taskId = args.task_id || args.id;
    if (!taskId) return JSON.stringify({ error: 'Missing required argument: task_id' });
    const task = sdlcManager.getTask(taskId);
    if (!task) return JSON.stringify({ error: `Task not found: ${taskId}` });
    if (toolName === 'get_task_evidence') {
      return JSON.stringify({ task_id: task.id, status: task.status, evidence: task.evidence || {}, updated_at: task.updated_at });
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

  const agentRes = _dispatchAgentDelegation(toolName, args);
  if (agentRes !== null) return agentRes;

  const memRes = _dispatchMemory(toolName, args, agent);
  if (memRes !== null) return memRes;

  const personaRes = _dispatchPersonaMemory(toolName, args, agent);
  if (personaRes !== null) return personaRes;

  const auditRes = _dispatchAuditAndDetectors(toolName, args, agent);
  if (auditRes !== null) return auditRes;

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

function executeToolSync(toolName, args = {}) {
  let agent = args.agent || args.agent_name;
  if (!agent) agent = detectActiveAgent();

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
  let agent = args.agent || args.agent_name;
  if (!agent) agent = detectActiveAgent();

  const heavyRes = await _executeHeavyToolAsync(toolName, args, agent);
  if (heavyRes !== null) return heavyRes;

  return _executeToolInternal(toolName, args, agent);
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
  _executeToolInternal,
  executeToolSync,
  executeTool,
  validateManifestArguments
};
