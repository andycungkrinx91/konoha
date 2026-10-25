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

module.exports = {
  WORKFLOW_PHASES,
  HITL_GATES,
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
