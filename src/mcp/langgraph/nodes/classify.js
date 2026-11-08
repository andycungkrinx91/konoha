'use strict';

const fs = require('fs');
const path = require('path');
const { classifyExecutionTrack, computeFlowHash, parseKonohaCommandInvocation } = require('../../workflow_sannin');
const { isPentestTask, loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { superviseLifecycleStage } = require('../../../workflow/kage-reviewer/advisor_monitor');
const { finalizeNodeResult } = require('../budget');

async function classifyNode(state, config) {
  const prompt = state.prompt || '';
  const taskDir = state.taskDir || '';
  const threadId = state.threadId || config?.configurable?.thread_id || '';
  const parsedCmd = parseKonohaCommandInvocation(prompt);
  const isDirectSubagent = parsedCmd.invocationMode === 'direct_subagent' && Boolean(parsedCmd.targetAgent);
  const isExplicitKonoha = Boolean(parsedCmd.explicitSlash && parsedCmd.invocationMode === 'konoha_orchestrator');

  const explicitTrack = isExplicitKonoha ? 'full_sdlc' : (
    state.isFastTrack ? 'fast_track' : (
      (state.intent === 'full_sdlc' || state.intent === 'pentest' || state.intent === 'fast_track') ? state.intent : null
    )
  );
  const isPentest = isPentestTask(prompt) || explicitTrack === 'pentest';
  const track = isPentest ? 'pentest' : (explicitTrack || classifyExecutionTrack(prompt, parsedCmd));
  const isFastTrack = !isDirectSubagent && !isExplicitKonoha && track === 'fast_track';
  const taskId = path.basename(taskDir || 'default');
  const flowHash = state.flowHash || computeFlowHash(state.sessionId || threadId || 'default', taskId, prompt);

  if (isDirectSubagent && taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    const status = loadWorkflowStatus(taskDir) || state.status || {};
    const directAgent = parsedCmd.targetAgent.replace(/_/g, '-');
    status.invocation_mode = 'direct_subagent';
    status.direct_subagent = directAgent;
    status.mandatory_kage_review = true;
    status.plan_approved = true;
    status.phase = 'execute';
    status.assigned_agent = directAgent;
    if (!Array.isArray(status.tasks) || status.tasks.length === 0) {
      status.tasks = [{
        id: 'direct-subagent-1',
        agent: directAgent,
        task: parsedCmd.cleanPrompt || prompt,
        status: 'pending'
      }];
    }
    superviseLifecycleStage('classify', { status, taskDir });
    saveWorkflowStatus(taskDir, status);

    const payload = {
      threadId,
      status,
      intent: 'direct_subagent',
      invocationMode: 'direct_subagent',
      directSubagent: directAgent,
      mandatoryKageReview: true,
      isFastTrack: false,
      phase: 'execute',
      flowHash,
    };
    return finalizeNodeResult(state, payload, 'node_dispatch');
  }

  const payload = {
    threadId,
    intent: isFastTrack ? 'fast_track' : (isPentest ? 'pentest' : 'full_sdlc'),
    invocationMode: parsedCmd.invocationMode,
    isFastTrack,
    phase: isFastTrack ? 'fast_track' : 'plan',
    flowHash,
  };

  const nextNode = isFastTrack ? 'node_complete' : 'node_plan';
  return finalizeNodeResult(state, payload, nextNode);
}

module.exports = { classifyNode };
