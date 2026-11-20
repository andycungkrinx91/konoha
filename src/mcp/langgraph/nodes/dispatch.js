'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { _dispatchExecutePhase, _dispatchDocumentPhase } = require('../../workflow_runner');
const { finalizeNodeResult } = require('../budget');
const { getActiveClient, getWorkspaceRoot } = require('../../runtime_state');
const { detectActiveClient, resolveFirstSpawnClient } = require('../../client_detection');
const { buildSpawnDirective, buildParallelSpawnDirective } = require('../../lazy_subagent');
const { consumeAdvisorSteerContext } = require('../../../workflow/kage-reviewer/advisor_monitor');
const { syncTodoAndWalkthrough } = require('../../todo_walkthrough_sync');

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

  const client = resolveFirstSpawnClient([
    state.client,
    status.client,
    typeof getActiveClient === 'function' ? getActiveClient() : null,
    detectActiveClient()
  ], 'universal');
  const projectPath = status.project_path || (typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null) || process.cwd();

  if (Array.isArray(parsed)) {
    const parallelDispatches = parsed.map((d) => {
      const assignedAgent = d.agent || status.assigned_agent;
      const skills = d.skills || status.routed_skills || status.skills || [];
      const steerCtx = consumeAdvisorSteerContext(taskDir, assignedAgent);
      const taskPrompt = steerCtx.block ? `${d.task || state.prompt || ''}\n\n${steerCtx.block}` : (d.task || state.prompt || '');
      const spawnDirective = buildSpawnDirective({
        client,
        agent: assignedAgent,
        skills,
        projectPath: d.worktree_path || projectPath,
        prompt: taskPrompt,
        worktree: d.worktree_path ? { worktree_path: d.worktree_path, branch: d.branch, base_sha: d.base_sha } : null
      });
      return {
        ...d,
        skills,
        turn_budget: state.tokenBudget || 8192,
        spawn_directive: spawnDirective,
        // The MCP runner prepares a directive; it never starts the child.
        spawn_state: 'directive_only',
        advisor_steers: steerCtx.pending.length > 0 ? steerCtx.pending : undefined,
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
    const todoSync = syncTodoAndWalkthrough(status, { client, taskDir });
    if (taskDir) saveWorkflowStatus(taskDir, status);
    const batchEnvelope = {
      status: 'parallel_ready',
      phase: 'execute',
      parallel_group: status.active_parallel_group || 'parallel_group_1',
      parallel_dispatches: parallelDispatches,
      parallel_spawn_directive: parallelDirective,
      advisor_supervisor: status.advisor_supervisor,
      todos: todoSync.todos,
      walkthrough_steps: todoSync.walkthrough_steps,
      client_todo_directive: todoSync.client_todo_directive,
      turn_budget: state.tokenBudget || 8192,
      task_dir: taskDir
    };
    const payload = {
      status,
      phase: 'execute',
      todos: todoSync.todos,
      walkthrough_steps: todoSync.walkthrough_steps,
      client_todo_directive: todoSync.client_todo_directive,
      result: batchEnvelope,
    };
    return finalizeNodeResult(state, payload, 'node_execute', {
      source: {
        status: batchEnvelope.status,
        phase: batchEnvelope.phase,
        parallel_group: batchEnvelope.parallel_group,
        task_ids: parallelDispatches.map((d) => d.task_id),
        turn_budget: batchEnvelope.turn_budget
      }
    });
  }

  if (parsed && typeof parsed === 'object') {
    const assignedAgent = parsed.agent || status.assigned_agent;
    parsed.skills = status.routed_skills || status.skills || [];
    parsed.turn_budget = state.tokenBudget || 8192;
    const steerCtx = consumeAdvisorSteerContext(taskDir, assignedAgent);
    const taskPrompt = steerCtx.block ? `${parsed.task || state.prompt || ''}\n\n${steerCtx.block}` : (parsed.task || state.prompt || '');
    parsed.spawn_directive = buildSpawnDirective({
      client,
      agent: assignedAgent,
      skills: parsed.skills,
      projectPath: parsed.worktree_path || projectPath,
      prompt: taskPrompt,
      worktree: parsed.worktree_path ? { worktree_path: parsed.worktree_path, branch: parsed.branch, base_sha: parsed.base_sha } : null
    });
    parsed.spawn_state = 'directive_only';
    if (steerCtx.pending.length > 0) parsed.advisor_steers = steerCtx.pending;
    if (status.advisor_supervisor) parsed.advisor_supervisor = status.advisor_supervisor;
    if (parsed.task_id || parsed.task) {
      parsed.todo = {
        id: parsed.task_id,
        task: parsed.task,
        agent: assignedAgent,
      };
    }
  }

  const todoSync = syncTodoAndWalkthrough(status, { client, taskDir });
  if (taskDir) saveWorkflowStatus(taskDir, status);
  const payload = {
    status,
    phase: parsed ? (parsed.phase || targetPhase) : (status.phase || 'review'),
    todos: todoSync.todos,
    walkthrough_steps: todoSync.walkthrough_steps,
    client_todo_directive: todoSync.client_todo_directive,
    result: parsed,
  };
  return finalizeNodeResult(state, payload, 'node_execute', { source: parsed });
}

module.exports = { dispatchNode };
