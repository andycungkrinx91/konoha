/**
 * Konoha MCP Subsystem - Tool Dispatch Router
 * Extracted from server.js as part of modularization refactor (Phase 7)
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { detectActiveAgent } = require('./client_detection');
const { findSkill, listSkills, getSkill, optimizeReport } = require('./skills');
const { buildFromSource, buildFromText } = require('./build_spec');
const { getResolvedTaskDir, runSannin } = require('./workflow');
const { runWebSearch } = require('./web_search');
const {
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  runMcpAgent,
  reportFromAgent
} = require('./memory_reporting');

function _executeToolInternal(toolName, args, agent) {
  if (toolName === 'find_skill' || toolName === 'find_skills') {
    const keyword = args.keyword || '';
    const limit = Math.min(parseInt(args.limit || 3, 10), 5);
    const compact = Boolean(args.compact);
    return findSkill(keyword, limit, agent, compact);
  }
  if (toolName === 'list_skills') {
    return listSkills(agent, args.fields);
  }
  if (toolName === 'get_skill') {
    return getSkill(args.name || '', agent);
  }
  if (toolName === 'optimize_report') {
    return optimizeReport(args.keyword, agent);
  }
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
    return JSON.stringify({ status: 'ok', task_dir: getResolvedTaskDir() });
  }
  if (toolName === 'sannin') {
    return runSannin(args.prompt, args.task_dir);
  }
  if (
    [
      'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'genin',
      'delegate_to_kage', 'delegate_to_jonin', 'delegate_to_anbu',
      'delegate_to_chunin', 'delegate_to_tokubetsu_jonin', 'delegate_to_genin', 'delegate_to_sannin',
      'delegated_to_kage', 'delegated_to_jonin', 'delegated_to_anbu',
      'delegated_to_chunin', 'delegated_to_tokubetsu_jonin', 'delegated_to_genin', 'delegated_to_sannin'
    ].includes(toolName)
  ) {
    const task = args.task || args.prompt || args.instructions;
    const context = args.context;
    const constraints = args.constraints;
    const skills = args.skills;
    const tasteDials = args.taste_dials;
    const projectPath = args.project_path || getWorkspaceRoot();
    const taskDir = args.task_dir;

    let cleanSubagent = toolName;
    if (cleanSubagent.startsWith('delegated_to_')) cleanSubagent = cleanSubagent.substring(13);
    else if (cleanSubagent.startsWith('delegate_to_')) cleanSubagent = cleanSubagent.substring(12);

    return runMcpAgent(
      cleanSubagent,
      task,
      context,
      constraints,
      skills,
      tasteDials,
      projectPath,
      taskDir
    );
  }
  if (toolName === 'report_from_agent' || (toolName && toolName.startsWith('report_from_'))) {
    let inferredAgent = (toolName && toolName.startsWith('report_from_'))
      ? toolName.replace('report_from_', '')
      : (args.agent_name || agent);
    if (inferredAgent === 'agent' || !inferredAgent) inferredAgent = args.agent_name || agent;
    const summary = args.summary || '';
    const status = args.status || 'completed';
    const filesCreated = args.files_created || [];
    const filesModified = args.files_modified || [];
    const learnings = args.learnings || [];
    const projectPath = args.project_path || getWorkspaceRoot();
    return reportFromAgent(
      inferredAgent,
      summary,
      status,
      filesCreated,
      filesModified,
      learnings,
      projectPath,
      args.task_dir,
      args.dispatch_id,
      args.validation
    );
  }
  if (toolName === 'get_project_context') {
    return getProjectContext(args.project_path || getWorkspaceRoot());
  }
  if (toolName === 'save_project_context') {
    return saveProjectContext(args.project_path || getWorkspaceRoot(), args.context_summary || '', args.tech_stack);
  }
  if (toolName === 'query_project_memory') {
    return queryProjectMemory(args.query || '', args.project_path || getWorkspaceRoot(), args.agent_name, args.memory_type, parseInt(args.limit || 10, 10));
  }
  if (toolName === 'migrate_skills') {
    const migrateModule = require('../migrate');
    const res = migrateModule.migrate_skills(args);
    return JSON.stringify(res);
  }
  if (toolName === 'save_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const content = args.content || '';
    const title = args.title || '';
    const memoryType = args.memory_type || 'rule';
    const tags = args.tags || '';
    const importance = parseInt(args.importance || 1, 10);
    if (!targetAgent || !content) {
      return JSON.stringify({ error: 'agent_name and content are required.' });
    }
    try {
      const mid = personaMemory.saveMemory({
        agentName: targetAgent,
        content,
        title,
        memoryType,
        tags,
        importance
      });
      return JSON.stringify({ status: 'saved', id: mid, agent: targetAgent });
    } catch (e) {
      return JSON.stringify({ error: `Failed to save memory: ${e.message}` });
    }
  }
  if (toolName === 'query_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const query = args.query || '';
    const memoryType = args.memory_type;
    const limit = parseInt(args.limit || 5, 10);
    try {
      const mems = personaMemory.queryMemories({
        agentName: targetAgent,
        query,
        memoryType,
        limit
      });
      return JSON.stringify({ agent: targetAgent, count: mems.length, memories: mems });
    } catch (e) {
      return JSON.stringify({ error: `Failed to query memories: ${e.message}` });
    }
  }
  if (toolName === 'list_persona_memories') {
    const targetAgent = args.agent_name;
    const memoryType = args.memory_type;
    const limit = parseInt(args.limit || 50, 10);
    try {
      const mems = personaMemory.listMemories({
        agentName: targetAgent,
        memoryType,
        limit
      });
      return JSON.stringify({ count: mems.length, memories: mems });
    } catch (e) {
      return JSON.stringify({ error: `Failed to list memories: ${e.message}` });
    }
  }
  if (toolName === 'delete_persona_memory') {
    const memId = args.id;
    if (!memId) {
      return JSON.stringify({ error: 'Memory id is required.' });
    }
    try {
      const deleted = personaMemory.deleteMemory(memId);
      return JSON.stringify({ status: deleted ? 'deleted' : 'not_found', id: memId });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete memory: ${e.message}` });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

function executeToolSync(toolName, args = {}) {
  let agent = args.agent || args.agent_name;
  if (!agent) agent = detectActiveAgent();

  if (toolName === 'web_search') {
    const serverJsPath = path.resolve(__dirname, '..', 'server.js');
    const res = spawnSync(process.execPath, [serverJsPath, '--tool', 'web_search', JSON.stringify(args || {})], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (res.error) return JSON.stringify({ error: res.error.message || String(res.error) });
    return (res.stdout || '').trim() || (res.stderr || '').trim() || JSON.stringify({ status: 'error', message: 'No output from web_search' });
  }

  return _executeToolInternal(toolName, args, agent);
}

async function executeTool(toolName, args = {}) {
  let agent = args.agent || args.agent_name;
  if (!agent) agent = detectActiveAgent();

  if (toolName === 'web_search') {
    const query = args.query;
    const numResults = Math.min(Math.max(parseInt(args.num_results || 5, 10), 1), 50);
    const searchDepth = ['standard', 'deep'].includes(args.search_depth) ? args.search_depth : 'standard';
    return await runWebSearch(query, numResults, searchDepth, agent);
  }

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
