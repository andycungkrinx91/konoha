'use strict';

const fs = require('fs');
const path = require('path');
const { classifyExecutionTrack, computeFlowHash, parseKonohaCommandInvocation } = require('../../workflow_sannin');
const { isPentestTask, loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { superviseLifecycleStage, initAdvisorSessionSupervisor } = require('../../../workflow/kage-reviewer/advisor_monitor');
const { buildAdvisorStartupDirective } = require('../../lazy_subagent');
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
    const advisorSupervisor = initAdvisorSessionSupervisor({
      client: state.client || status.client, status, goal: prompt, todos: status.tasks
    });
    const advisorSpawnDirective = buildAdvisorStartupDirective({
      client: state.client || status.client, projectPath: status.project_path || state.projectPath, prompt, taskDir
    });
    superviseLifecycleStage('classify', { status, taskDir, goal: prompt, todos: status.tasks });
    saveWorkflowStatus(taskDir, status);

    const gate2Waiting = Boolean(
      status.hitl_gate === 'pending_human_signoff' ||
      status.hitl_gate === 'delivery_signoff' ||
      status.hitl_gate === 'Gate 2 (Delivery Sign-Off)' ||
      status.phase === 'delivery_signoff'
    );
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
      ...(gate2Waiting ? {} : { hitlChoice: null, hitlRefinement: null, hitlStage: null }),
      advisor_supervisor: advisorSupervisor,
      advisor_spawn_directive: advisorSpawnDirective,
    };
    return finalizeNodeResult(state, payload, 'node_dispatch');
  }

  const advisorStatus = taskDir ? (loadWorkflowStatus(taskDir) || state.status || {}) : (state.status || {});
  const advisorSupervisor = initAdvisorSessionSupervisor({
    client: state.client || advisorStatus.client, status: advisorStatus, goal: prompt, todos: advisorStatus.tasks || []
  });
  if (taskDir) {
    fs.mkdirSync(taskDir, { recursive: true });
    saveWorkflowStatus(taskDir, advisorStatus);
  }
  const advisorSpawnDirective = buildAdvisorStartupDirective({
    client: state.client || advisorStatus.client, projectPath: state.projectPath || advisorStatus.project_path, prompt, taskDir
  });

  const payload = {
    threadId,
    intent: isFastTrack ? 'fast_track' : (isPentest ? 'pentest' : 'full_sdlc'),
    invocationMode: parsedCmd.invocationMode,
    isFastTrack,
    phase: isFastTrack ? 'fast_track' : 'plan',
    flowHash,
    advisor_supervisor: advisorSupervisor,
    advisor_spawn_directive: advisorSpawnDirective,
  };

  const nextNode = isFastTrack ? 'node_complete' : 'node_plan';
  return finalizeNodeResult(state, payload, nextNode);
}

module.exports = { classifyNode };
