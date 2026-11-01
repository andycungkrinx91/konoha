'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { _dispatchExecutePhase, _dispatchDocumentPhase } = require('../../workflow_runner');
const { estimateTokens, checkBudget } = require('../token_guard');
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
    const delta = estimateTokens({ phase: nextPhase });
    const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
    const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);
    return {
      status,
      phase: nextPhase,
      tokensUsed: delta,
      turnTokensUsed: delta,
      budgetExceeded: budgetCheck.budgetExceeded,
    };
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

  const delta = estimateTokens(parsed);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);

  return {
    status,
    phase: parsed.phase || targetPhase,
    result: parsed,
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { dispatchNode };
