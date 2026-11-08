'use strict';

const fs = require('fs');
const path = require('path');
const { loadWorkflowStatus, saveWorkflowStatus } = require('../../workflow_common');
const { applyGate1Choice, buildGate1Prompt, parseGateChoice } = require('../../workflow_gates');
const sdlcManager = require('../../../workflow/kage-reviewer/sdlc_manager');
const { superviseLifecycleStage } = require('../../../workflow/kage-reviewer/advisor_monitor');
const { finalizeNodeResult } = require('../budget');

async function planNode(state) {
  const taskDir = state.taskDir || '';
  if (taskDir) fs.mkdirSync(taskDir, { recursive: true });
  const status = loadWorkflowStatus(taskDir) || state.status || { phase: 'plan' };
  const rootTaskId = state.threadId || status.task_id || path.basename(taskDir);

  if (state.hitlChoice && (state.hitlStage === 'gate1' || !status.plan_approved)) {
    const choiceObj = parseGateChoice(state.hitlChoice, state.hitlRefinement);
    if (choiceObj) {
      const choiceResult = applyGate1Choice(choiceObj, status, taskDir, sdlcManager);
      if (choiceResult && choiceResult.approved) {
        status.plan_approved = true;
        status.hitl_gate = null;
        status.phase = 'brief';
        const compactionAudit = superviseLifecycleStage('compaction', {
          status,
          taskDir,
          compaction: choiceResult.compaction || status.compaction
        });
        saveWorkflowStatus(taskDir, status);

        const payload = {
          status,
          plan: status.plan,
          compaction: choiceResult.compaction || status.compaction,
          advisor_compaction_audit: compactionAudit,
          todos: choiceResult.todos || status.tasks || [],
          walkthrough_steps: choiceResult.walkthrough_steps,
          client_todo_directive: choiceResult.client_todo_directive,
          phase: 'brief',
          hitlPending: false,
          hitlStage: null,
          hitlChoice: null,
          hitlRefinement: null,
        };
        return finalizeNodeResult(state, payload, 'node_brief', { source: choiceObj });
      }

      status.plan_approved = false;
      status.hitl_gate = 'pending_plan_approval';
      saveWorkflowStatus(taskDir, status);

      const prompt = buildGate1Prompt(status, taskDir, rootTaskId, status.plan);
      const payload = {
        status,
        plan: status.plan,
        phase: 'plan',
        hitlPending: true,
        hitlStage: 'gate1',
        hitlChoice: null,
        hitlRefinement: null,
        result: prompt,
      };
      return finalizeNodeResult(state, payload, 'node_brief', {
        selfResume: true,
        selfNode: 'node_plan',
        source: prompt,
      });
    }
  }

  const rootRecord = sdlcManager.getTask(rootTaskId);
  const isApprovedInDb = rootRecord && (rootRecord.status === 'in_progress' || rootRecord.status === 'completed');

  if (status.plan_approved || isApprovedInDb) {
    status.plan_approved = true;
    status.hitl_gate = null;
    status.phase = 'brief';
    saveWorkflowStatus(taskDir, status);

    const planData = status.plan || 'Plan approved.';
    const payload = {
      status,
      plan: planData,
      phase: 'brief',
      hitlPending: false,
      hitlStage: null,
    };
    return finalizeNodeResult(state, payload, 'node_brief', { source: planData });
  }

  status.phase = 'plan';
  status.hitl_gate = 'pending_plan_approval';
  saveWorkflowStatus(taskDir, status);

  const prompt = buildGate1Prompt(status, taskDir, rootTaskId, status.plan);
  const payload = {
    status,
    plan: status.plan,
    phase: 'plan',
    hitlPending: true,
    hitlStage: 'gate1',
    result: prompt,
  };
  return finalizeNodeResult(state, payload, 'node_brief', {
    selfResume: true,
    selfNode: 'node_plan',
    source: prompt,
  });
}

module.exports = { planNode };
