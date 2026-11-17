'use strict';

/**
 * src/mcp/persona_memory_dispatch.js — Dispatcher for persona memory and SOUL MCP tools.
 */

const personaMemory = require('../persona_memory');
const { getWorkspaceRoot } = require('./runtime_state');
const { getActiveSessionId } = require('./client_detection');

function _queryOrList(fn, verb, opts, agentHeader, boundFn) {
  try {
    const mems = fn(opts);
    const bounded = boundFn(mems);
    return JSON.stringify({
      ...(agentHeader ? { agent: agentHeader } : {}),
      count: bounded.length,
      memories: bounded
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to ${verb} memories: ${e.message}` });
  }
}

/**
 * Handles persona memory CRUD/correction/withdrawal and SOUL retrieval tools.
 */
function dispatchPersonaMemory(toolName, args, agent, boundPersonaMemories) {
  if (toolName === 'save_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const content = args.content || '';
    const action = args.action || 'create';
    if (action === 'withdraw' && args.target_id) {
      return JSON.stringify(personaMemory.withdrawMemory({
        id: args.target_id, reason: args.reason || content, actor: targetAgent || agent
      }));
    }
    if (action === 'correct' && args.target_id) {
      if (!content) return JSON.stringify({ error: 'content is required to correct a memory.' });
      return JSON.stringify(personaMemory.correctMemory({
        id: args.target_id, newContent: content, title: args.title, reason: args.reason || '',
        actor: targetAgent || agent, evidenceRef: args.source_ref || '', sourceType: args.source_type
      }));
    }
    if (!targetAgent || !content) return JSON.stringify({ error: 'agent_name and content are required.' });
    try {
      const saved = personaMemory.remember({
        agentName: targetAgent, content, title: args.title || '', memoryType: args.memory_type || 'rule',
        tags: args.tags || '', importance: parseInt(args.importance || 1, 10),
        domain: args.domain, sourceType: args.source_type || 'agent', sourceRef: args.source_ref || '',
        creatorAgent: targetAgent, verificationStatus: args.verification_status,
        confidence: args.confidence,
        projectPath: args.project_path || getWorkspaceRoot(), sessionId: args.session_id
      });
      return JSON.stringify({
        status: 'saved', id: saved.id, agent: targetAgent,
        domain: saved.domain, verification_status: saved.verification_status, lifecycle_status: saved.lifecycle_status
      });
    } catch (e) {
      return JSON.stringify({ error: `Failed to save memory: ${e.message}` });
    }
  }
  if (toolName === 'query_persona_memory') {
    const targetAgent = args.agent_name || agent;
    const projectPath = args.project_path || getWorkspaceRoot();
    return _queryOrList(personaMemory.queryMemories, 'query', {
      agentName: targetAgent, query: args.query || '', memoryType: args.memory_type,
      domain: args.domain, confirmedOnly: Boolean(args.confirmed_only), includeInactive: Boolean(args.include_inactive),
      projectPath, sessionId: args.session_id || getActiveSessionId(projectPath),
      allSessions: Boolean(args.all_sessions || args.allSessions), limit: Math.min(Math.max(parseInt(args.limit || 5, 10), 1), 10)
    }, targetAgent, boundPersonaMemories);
  }
  if (toolName === 'list_persona_memories') {
    const projectPath = args.project_path || getWorkspaceRoot();
    return _queryOrList(personaMemory.listMemories, 'list', {
      agentName: args.agent_name, memoryType: args.memory_type,
      domain: args.domain, confirmedOnly: Boolean(args.confirmed_only), includeInactive: Boolean(args.include_inactive),
      projectPath, sessionId: args.session_id || getActiveSessionId(projectPath),
      allSessions: Boolean(args.all_sessions || args.allSessions), limit: Math.min(Math.max(parseInt(args.limit || 10, 10), 1), 20)
    }, null, boundPersonaMemories);
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

module.exports = { dispatchPersonaMemory };
