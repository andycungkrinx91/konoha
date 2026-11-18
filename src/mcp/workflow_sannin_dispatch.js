'use strict';

/**
 * Async Sannin & parallel slice dispatch helpers.
 * Uses `runMcpAgentAsync` and `buildDelegationEnvelopeAsync` so real MCP execution
 * runs async Tree-sitter WASM + Granite/MiniLM semantic retrieval + LSP enrichment.
 */

function _buildSliceArgs(ws, sharedOptions, resolveRoutedSkillsFn) {
  const {
    taskId = 'root',
    flowHash = null,
    sessionId = null,
    projectPath = null,
    taskDir = null,
    client = null
  } = sharedOptions;
  const agent = ws.agent || ws.name;
  const task = ws.task || ws.prompt || ws.instructions || `Execute ${ws.domain || agent} slice.`;
  const context = ws.context || sharedOptions.context || null;
  const constraints = ws.constraints || sharedOptions.constraints || null;
  const skills = Array.isArray(ws.skills) && ws.skills.length > 0
    ? ws.skills
    : (ws.routed_skills || (typeof resolveRoutedSkillsFn === 'function' ? resolveRoutedSkillsFn(task, agent) : []));
  const tasteDials = ws.taste_dials || ws.tasteDials || sharedOptions.tasteDials || null;
  const worktree = ws.worktree || ws.worktree_path || null;
  return {
    agent,
    options: { task, context, constraints, skills, tasteDials, projectPath, taskDir, sessionId, flowHash, taskId, client, worktree }
  };
}

function _parseSliceOutput(agent, resRaw) {
  try {
    return JSON.parse(resRaw);
  } catch (_) {
    return { status: 'ready', agent, output: resRaw };
  }
}

function dispatchParallelSlices(workstreams = [], sharedOptions = {}, resolveRoutedSkillsFn = null) {
  if (!Array.isArray(workstreams) || workstreams.length === 0) return [];
  const { runMcpAgent } = require('./memory_subagent_runner');
  return workstreams.map((ws) => {
    const { agent, options } = _buildSliceArgs(ws, sharedOptions, resolveRoutedSkillsFn);
    return _parseSliceOutput(agent, runMcpAgent(agent, options));
  });
}

async function dispatchParallelSlicesAsync(workstreams = [], sharedOptions = {}, resolveRoutedSkillsFn = null) {
  if (!Array.isArray(workstreams) || workstreams.length === 0) return [];
  const { runMcpAgentAsync } = require('./memory_subagent_async');
  const settled = await Promise.allSettled(
    workstreams.map(async (ws) => {
      const { agent, options } = _buildSliceArgs(ws, sharedOptions, resolveRoutedSkillsFn);
      const raw = await runMcpAgentAsync(agent, options);
      return _parseSliceOutput(agent, raw);
    })
  );
  return settled.map((item, idx) => {
    if (item.status === 'fulfilled') return item.value;
    const fallbackAgent = workstreams[idx]?.agent || workstreams[idx]?.name || 'unknown';
    return { status: 'error', agent: fallbackAgent, error: item.reason?.message || String(item.reason) };
  });
}

async function runSanninAsync(hooks, dispatchArgs = {}) {
  const { prompt = null, taskDir = null, projectPath = null, sessionId = null, options = {} } = dispatchArgs;
  const prep = hooks.prepareAsync
    ? await hooks.prepareAsync(prompt, taskDir, projectPath, sessionId, options)
    : hooks.prepare(prompt, taskDir, projectPath, sessionId, options);
  if (prep.earlyReturn) return prep.earlyReturn;
  const envelope = await hooks.buildEnvelopeAsync({
    agentName: prep.selectedAgent,
    projectPath: prep.resolvedProjPath,
    prompt: prep.effPrompt,
    routedSkills: prep.routedSkills
  });
  return hooks.finalize(prep, envelope);
}

module.exports = {
  dispatchParallelSlices,
  dispatchParallelSlicesAsync,
  runSanninAsync
};
