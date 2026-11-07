'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { _dispatchExecutePhase, _dispatchDocumentPhase } = require('../../workflow_runner');
const { finalizeNodeResult } = require('../budget');
const { getActiveClient, getWorkspaceRoot } = require('../../runtime_state');
const { buildSpawnDirective, buildParallelSpawnDirective } = require('../../lazy_subagent');

async function dispatchNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || { tasks: state.todos || [] };

  let dispatchResult = null;
  const targetPhase = status.phase || 'execute';

  if (targetPhase === 'document') {
    dispatchResult = _dispatchDocumentPhase(status, taskDir);
  } else {
    dispatchResult = _dispatchExecutePhase(status, taskDir);
  }

  if (!dispatchResult) {
    const nextPhase = status.phase || 'review';
    saveWorkflowStatus(taskDir, status);
    const payload = {
      status,
      phase: nextPhase,
    };
    return finalizeNodeResult(state, payload, 'node_execute', { source: { phase: nextPhase } });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(dispatchResult);
  } catch {
    parsed = { raw: dispatchResult };
  }

  const client = state.client || status.client || (typeof getActiveClient === 'function' ? getActiveClient() : null) || 'cli';
  const projectPath = status.project_path || (typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null) || process.cwd();

  if (Array.isArray(parsed)) {
    const parallelDispatches = parsed.map((d) => {
      const assignedAgent = d.agent || status.assigned_agent;
      const skills = d.skills || status.routed_skills || status.skills || [];
      let toolBlock = '';
      try {
        const { buildSubagentMcpBlock } = require('../../memory_subagent_runner');
        toolBlock = buildSubagentMcpBlock(client, assignedAgent);
      } catch (_) { /* ignore */ }
      const spawnDirective = buildSpawnDirective({
        client,
        agent: assignedAgent,
        skills,
        projectPath: d.worktree_path || projectPath,
        prompt: d.task || state.prompt || '',
        worktree: d.worktree_path ? { worktree_path: d.worktree_path, branch: d.branch, base_sha: d.base_sha } : null
      });
      return {
        ...d,
        skills,
        tool_block: toolBlock,
        turn_budget: state.tokenBudget || 8192,
        spawn_directive: spawnDirective,
        todo: {
          id: d.task_id,
          task: d.task,
          agent: assignedAgent,
          worktree_path: d.worktree_path || undefined,
          branch: d.branch || undefined
        }
      };
    });
    const parallelDirective = buildParallelSpawnDirective({
      client,
      projectPath,
      dispatches: parallelDispatches
    });
    const batchEnvelope = {
      status: 'parallel_ready',
      phase: 'execute',
      parallel_group: status.active_parallel_group || 'parallel_group_1',
      parallel_dispatches: parallelDispatches,
      parallel_spawn_directive: parallelDirective,
      turn_budget: state.tokenBudget || 8192,
      task_dir: taskDir
    };
    const payload = {
      status,
      phase: 'execute',
      result: batchEnvelope,
    };
    return finalizeNodeResult(state, payload, 'node_execute', { source: batchEnvelope });
  }

  if (parsed && typeof parsed === 'object') {
    const assignedAgent = parsed.agent || status.assigned_agent;
    parsed.skills = status.routed_skills || status.skills || [];
    try {
      const { buildSubagentMcpBlock } = require('../../memory_subagent_runner');
      parsed.tool_block = buildSubagentMcpBlock(client, assignedAgent);
    } catch (_) {
      // safe fallback
    }
    parsed.turn_budget = state.tokenBudget || 8192;
    parsed.spawn_directive = buildSpawnDirective({
      client,
      agent: assignedAgent,
      skills: parsed.skills,
      projectPath: parsed.worktree_path || projectPath,
      prompt: parsed.task || state.prompt || '',
      worktree: parsed.worktree_path ? { worktree_path: parsed.worktree_path, branch: parsed.branch, base_sha: parsed.base_sha } : null
    });
    if (parsed.task_id || parsed.task) {
      parsed.todo = {
        id: parsed.task_id,
        task: parsed.task,
        agent: assignedAgent,
      };
    }
  }

  const payload = {
    status,
    phase: parsed ? (parsed.phase || targetPhase) : (status.phase || 'review'),
    result: parsed,
  };
  return finalizeNodeResult(state, payload, 'node_execute', { source: parsed });
}

module.exports = { dispatchNode };
