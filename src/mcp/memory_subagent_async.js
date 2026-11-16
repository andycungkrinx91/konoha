'use strict';

/**
 * Asynchronous subagent execution helper for Konoha MCP delegation.
 * Uses `retrieveUnifiedContextAsync` (async Tree-sitter WASM + Granite/MiniLM semantic
 * retrieval + LSP enrichment) when compiling @genin context without blocking on sync fallback.
 */

const { retrieveUnifiedContextAsync } = require('../code_intel/genin_retrieval');
const {
  _loadBaseProjectContext,
  _prepareAgentRun,
  _finalizeAgentRun
} = require('./memory_subagent_runner');

async function _fetchGeninRetrievalBlockAsync(dbAgentName, instructions, resolvedProjPath, resolvedSessionId, retrievalOptions) {
  if (dbAgentName !== 'genin') return '';
  const retrieved = await retrieveUnifiedContextAsync({
    projectPath: resolvedProjPath,
    query: instructions,
    agentName: dbAgentName,
    sessionId: resolvedSessionId,
    maxChars: 1100,
    maxHits: 4,
    ...retrievalOptions
  });
  return retrieved && retrieved.available && retrieved.text ? retrieved.text : '';
}

async function formatProjectContextAsync(dbAgentName, instructions, resolvedProjPath, resolvedSessionId, retrievalOptions = {}) {
  try {
    const retrievalBlock = await _fetchGeninRetrievalBlockAsync(
      dbAgentName, instructions, resolvedProjPath, resolvedSessionId, retrievalOptions
    );
    return `${_loadBaseProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId)}${retrievalBlock}`;
  } catch (_) {
    return '';
  }
}

async function runMcpAgentAsync(agentName, task = null, context = null, constraints = null, ...rest) {
  const prep = _prepareAgentRun(agentName, task, context, constraints, rest);
  if (prep.earlyReturn) return prep.earlyReturn;
  const projectContextBlock = await formatProjectContextAsync(
    prep.dbAgentName,
    prep.instructions,
    prep.resolvedProjPath,
    prep.resolvedSessionId,
    prep.opts && prep.opts.retrievalOptions ? prep.opts.retrievalOptions : undefined
  );
  return _finalizeAgentRun(prep, projectContextBlock);
}

module.exports = {
  formatProjectContextAsync,
  runMcpAgentAsync
};
