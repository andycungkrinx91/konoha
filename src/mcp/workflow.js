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
  runMcpWorkflow
};
