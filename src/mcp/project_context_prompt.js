'use strict';

/**
 * The project-context prefix that every subagent prompt starts with.
 *
 * It must be byte-identical across the turns of one task: that is what makes the
 * client's prefix cache hit, and it is what `test_e2e_install_upgrade_reinstall`
 * pins as "genin prompts must be deterministic across turns". The composed block
 * is not naturally stable — `retrieveUnifiedContextSync` reports `indexed` on its
 * first call and `fresh` afterwards, and that first call also persists a topology
 * memory which changes the base block — so the first answer for a
 * (project, session, agent, instructions) is kept and reused. The sync and async
 * runners share the cache, so whichever composes first fixes the prefix.
 *
 * ponytail: per-process, no TTL. A topology change mid-task will not reach the
 * prefix until the MCP process restarts; that is the trade prefix stability
 * requires. Add a TTL keyed on `code_index_roots.indexed_at` if a stale prefix
 * ever costs more than a cache miss.
 */

const personaMemory = require('../persona_memory');
const { retrieveUnifiedContextSync } = require('../code_intel/genin_retrieval');

const CONTEXT_CACHE = new Map();
const CONTEXT_CACHE_MAX = 64;

function contextCacheKey(dbAgentName, instructions, resolvedProjPath, resolvedSessionId) {
  return `${resolvedProjPath}\u0000${resolvedSessionId}\u0000${dbAgentName}\u0000${instructions}`;
}

function remember(key, context) {
  if (CONTEXT_CACHE.size >= CONTEXT_CACHE_MAX) CONTEXT_CACHE.clear();
  CONTEXT_CACHE.set(key, context);
  return context;
}

function loadBaseProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId) {
  let projProfile = personaMemory.getProjectProfile(resolvedProjPath);
  if (!projProfile) {
    const pHash = personaMemory.saveOrUpdateProject(resolvedProjPath);
    projProfile = personaMemory.getProjectProfile(pHash);
  }
  const projMems = personaMemory.queryMemories({
    agentName: dbAgentName, query: instructions, projectPath: resolvedProjPath, sessionId: resolvedSessionId, limit: 2
  });
  return personaMemory.formatProjectContextForPrompt(projProfile, projMems, 1, true);
}

/** The already-composed prefix, or `undefined` when this task has none yet. */
function readCachedProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId) {
  return CONTEXT_CACHE.get(contextCacheKey(dbAgentName, instructions, resolvedProjPath, resolvedSessionId));
}

function composeProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId, retrievalBlock) {
  const key = contextCacheKey(dbAgentName, instructions, resolvedProjPath, resolvedSessionId);
  const cached = CONTEXT_CACHE.get(key);
  if (cached !== undefined) return cached;
  return remember(key, `${loadBaseProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId)}${retrievalBlock || ''}`);
}

function formatProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId) {
  const cached = readCachedProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId);
  if (cached !== undefined) return cached;
  try {
    let retrievalBlock = '';
    if (dbAgentName === 'genin') {
      const retrieved = retrieveUnifiedContextSync({
        projectPath: resolvedProjPath, query: instructions, agentName: dbAgentName,
        sessionId: resolvedSessionId, maxChars: 1100, maxHits: 4
      });
      if (retrieved && retrieved.available && retrieved.text) retrievalBlock = retrieved.text;
    }
    return composeProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId, retrievalBlock);
  } catch (_) {
    return '';
  }
}

module.exports = {
  formatProjectContext,
  composeProjectContext,
  readCachedProjectContext,
  loadBaseProjectContext
};
