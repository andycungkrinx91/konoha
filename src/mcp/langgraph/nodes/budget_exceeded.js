'use strict';

const fs = require('fs');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');

async function budgetExceededNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || {};

  const resumeNode = state.resumeNode || 'node_classify';
  const turnIndex = state.turnIndex || 1;
  const turnTokensUsed = state.turnTokensUsed || state.tokensUsed || 0;
  const tokenBudget = state.tokenBudget || 8192;

  status.budget_exceeded = true;
  status.tokens_used = state.tokensUsed || 0;
  status.token_budget = tokenBudget;
  status.resume_node = resumeNode;
  status.turn_index = turnIndex;
  status.turn_tokens_used = turnTokensUsed;

  if (taskDir) {
    saveWorkflowStatus(taskDir, status);
  }

  const payload = {
    status: 'paused_budget_exceeded',
    resume_node: resumeNode,
    turn_index: turnIndex,
    turn_tokens_used: turnTokensUsed,
    token_budget: tokenBudget,
    tokens_used: state.tokensUsed || 0,
    workflow_complete: false,
    phase: state.phase,
    task_dir: taskDir,
    thread_id: state.threadId || null,
    message: `Workflow turn halted: per-turn token budget reached (${turnTokensUsed} >= ${tokenBudget}). State persisted for continuation at ${resumeNode}.`,
    next_action: `Continue with another turn: call sannin again with the same task_dir to resume at ${resumeNode}. Do not resupply token_budget unless you want a different ceiling.`,
  };

  return {
    status,
    budgetExceeded: true,
    resumeNode,
    result: payload,
    error: null,
  };
}

module.exports = { budgetExceededNode };
