'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflowStatus, saveWorkflowStatus, cleanupTransientScratchFiles } = require('../../workflow_common');
const sdlcManager = require('../../../workflow/kage-reviewer/sdlc_manager');
const { estimateTokens, checkBudget } = require('../token_guard');

async function completeNode(state) {
  const taskDir = state.taskDir || '';
  const status = loadWorkflowStatus(taskDir) || state.status || {};
  const rootId = process.env.KONOHA_TASK_ID || state.threadId || status.task_id || path.basename(taskDir);

  status.phase = 'done';
  if (taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    saveWorkflowStatus(taskDir, status);
    cleanupTransientScratchFiles(taskDir);
  }

  try {
    sdlcManager.updateTask(rootId, { status: 'completed' });
  } catch {
    // optional db update
  }

  const finalOutput = {
    status: 'completed',
    phase: 'done',
    task_id: rootId,
    task_dir: taskDir,
    tokens_used: (state.tokensUsed || 0),
    turn_tokens_used: (state.turnTokensUsed || 0),
    remediation_cycles: state.remediationCount,
    circuit_state: state.circuitState,
    report: status.report || 'Workflow successfully executed and validated.',
  };

  const delta = estimateTokens(finalOutput);
  const turnUsed = state.turnTokensUsed !== undefined ? state.turnTokensUsed : state.tokensUsed;
  const budgetCheck = checkBudget(turnUsed, delta, state.tokenBudget);

  return {
    status,
    phase: 'done',
    result: finalOutput,
    tokensUsed: delta,
    turnTokensUsed: delta,
    budgetExceeded: budgetCheck.budgetExceeded,
  };
}

module.exports = { completeNode };
