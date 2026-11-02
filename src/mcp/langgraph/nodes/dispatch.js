'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { _dispatchExecutePhase, _dispatchDocumentPhase } = require('../../workflow_runner');
const { finalizeNodeResult } = require('../budget');
const { getActiveClient } = require('../../runtime_state');

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

  if (parsed && typeof parsed === 'object') {
    const client = typeof getActiveClient === 'function' ? getActiveClient() : null;
    const assignedAgent = parsed.agent || status.assigned_agent;
    parsed.skills = status.routed_skills || status.skills || [];
    try {
      const { buildSubagentMcpBlock } = require('../../memory_subagent_runner');
      parsed.tool_block = buildSubagentMcpBlock(client, assignedAgent);
    } catch (_) {
      // safe fallback
    }
    parsed.turn_budget = state.tokenBudget || 8192;
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
