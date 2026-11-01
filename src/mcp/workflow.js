'use strict';

const {
  WORKFLOW_PHASES,
  HITL_GATES,
  VALIDATION_EVIDENCE_PATTERN,
  getResolvedTaskDir,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  workflowHash,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  cleanupTransientScratchFiles
} = require('./workflow_common');

const {
  routeByKeywordsWithPrompt,
  classifyExecutionTrack,
  detectParallelWorkstreams,
  dispatchParallelSlices,
  computeFlowHash,
  runSannin
} = require('./workflow_sannin');

const {
  runAislopGate,
  workflowDispatch,
  workflowDispatchCompleted,
  workflowReviewApproved
} = require('./workflow_dispatch');

const {
  runMcpWorkflow
} = require('./workflow_runner');

const {
  GATE1_CHOICES,
  GATE1_REFINE_LABEL,
  GATE2_CHOICES,
  buildGate1Prompt,
  buildGate2Prompt,
  parseGateChoice,
  applyGate1Choice,
  applyGate2Choice
} = require('./workflow_gates');

const path = require('path');
const {
  buildKonohaGraph,
  getWorkflowGraph,
  runKonohaGraph,
  KonohaWorkflowState,
  KonohaCheckpointSaver,
} = require('./langgraph');

async function sanninWorkflowInit(taskDir, options = {}) {
  const prompt = options.prompt || '';
  const tokenBudget = options.tokenBudget || options.token_budget || 8192;
  const threadId = options.threadId || options.taskId || (taskDir ? path.basename(taskDir) : 'default-thread');
  const autoSignoff = options.autoSignoff !== undefined ? options.autoSignoff : false;
  return runKonohaGraph({
    prompt,
    taskDir,
    tokenBudget,
    threadId,
    autoSignoff,
  }, { threadId, tokenBudget });
}

async function sanninWorkflowNext(taskDir, options = {}) {
  const threadId = options.threadId || options.taskId || (taskDir ? path.basename(taskDir) : 'default-thread');
  const hitlChoice = options.choice || options.gate_choice || options.action;
  const hitlRefinement = options.refinement || options.feedback || options.notes;
  const tokenBudget = options.tokenBudget || options.token_budget || options.budget;
  const input = {
    taskDir,
    threadId,
    hitlChoice,
    hitlRefinement,
    ...(options.autoSignoff !== undefined ? { autoSignoff: options.autoSignoff } : {}),
  };
  if (tokenBudget) {
    input.tokenBudget = tokenBudget;
    input.budgetExceeded = false;
  }
  return runKonohaGraph(input, { threadId, ...(tokenBudget ? { tokenBudget } : {}) });
}

const sanninWorkflowStatus = loadWorkflowStatus;

function sanninWorkflowReset(taskDir) {
  const status = loadWorkflowStatus(taskDir);
  if (status) {
    status.phase = 'route';
    status.plan_approved = false;
    status.human_signed_off = false;
    status.hitl_gate = null;
    status.budget_exceeded = false;
    saveWorkflowStatus(taskDir, status);
  }
  return status;
}

module.exports = {
  WORKFLOW_PHASES,
  HITL_GATES,
  GATE1_CHOICES,
  GATE1_REFINE_LABEL,
  GATE2_CHOICES,
  buildGate1Prompt,
  buildGate2Prompt,
  parseGateChoice,
  applyGate1Choice,
  applyGate2Choice,
  getResolvedTaskDir,
  readFileSafe,
  runAislopGate,
  loadWorkflowStatus,
  saveWorkflowStatus,
  routeByKeywordsWithPrompt,
  dispatchParallelSlices,
  runSannin,
  computeFlowHash,
  compute_flow_hash: computeFlowHash,
  workflowHash,
  workflowDispatch,
  workflowDispatchCompleted,
  VALIDATION_EVIDENCE_PATTERN,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  workflowReviewApproved,
  cleanupTransientScratchFiles,
  classifyExecutionTrack,
  detectParallelWorkstreams,
  runMcpWorkflow,
  buildKonohaGraph,
  getWorkflowGraph,
  runKonohaGraph,
  KonohaWorkflowState,
  KonohaCheckpointSaver,
  sanninWorkflowInit,
  sanninWorkflowNext,
  sanninWorkflowStatus,
  sanninWorkflowReset,
};
