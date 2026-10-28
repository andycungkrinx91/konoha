'use strict';

const fs = require('fs');
const path = require('path');
const { saveWorkflowStatus, cleanupTransientScratchFiles } = require('./workflow_common');

const GATE1_CHOICES = [
  '1. Compact and approve',
  '2. Reject and Regenerate PLAN'
];

const GATE1_REFINE_LABEL = 'Input Refine PLAN';

const GATE2_CHOICES = [
  '1. Compact and approve',
  '2. Remediation'
];

function buildGate1Prompt(status, resolvedTaskDir, rootTaskId, planContent) {
  const planText = planContent || status.plan || '';
  const promptPayload = {
    gate: 'gate_1',
    gate_name: 'Gate 1 (Plan Approval)',
    title: 'Gate 1: Action Plan Approval Required',
    question: 'Action plan compiled. Execution paused awaiting human plan approval (Gate 1). How would you like to proceed?',
    choices: [
      '1. Compact and approve',
      '2. Reject and Regenerate PLAN',
      'Input Refine PLAN'
    ],
    refinement_option: GATE1_REFINE_LABEL,
    options: [
      {
        id: '1',
        label: '1. Compact and approve',
        action: 'approve',
        description: 'Approve the action plan and advance directly to Phase 2 (Foundation & Tooling).'
      },
      {
        id: '2',
        label: '2. Reject and Regenerate PLAN',
        action: 'regenerate',
        description: 'Reject the action plan and instruct Kage to regenerate the Phase 1 action plan.'
      },
      {
        id: 'refine',
        label: 'Input Refine PLAN',
        action: 'refine',
        description: 'Provide custom refinement instructions to refine and regenerate the action plan.'
      }
    ]
  };

  const message = 'Action plan compiled. Execution paused awaiting human plan approval (Gate 1).\n\n' +
    'Please select an option to proceed:\n' +
    '1. Compact and approve\n' +
    '2. Reject and Regenerate PLAN\n' +
    '(Or provide feedback: Input Refine PLAN <notes>)';

  return JSON.stringify({
    status: 'pending_plan_approval',
    phase: 'plan_approval',
    hitl_gate: 'Gate 1 (Plan Approval)',
    task_id: rootTaskId,
    message,
    interactive_prompt: promptPayload,
    plan: planText,
    tasks: status.tasks || [],
    task_dir: resolvedTaskDir
  });
}

function buildGate2Prompt(status, resolvedTaskDir, rootId, confidenceVal, reportPath) {
  const finalReport = reportPath || status?.report || '';
  const promptPayload = {
    gate: 'gate_2',
    gate_name: 'Gate 2 (Delivery Sign-Off)',
    title: 'Gate 2: Delivery Sign-Off Required',
    question: `Kage review completed (${confidenceVal}% Confidence). Delivery paused awaiting human sign-off (Gate 2). How would you like to proceed?`,
    choices: [
      '1. Compact and approve',
      '2. Remediation'
    ],
    options: [
      {
        id: '1',
        label: '1. Compact and approve',
        action: 'approve',
        description: 'Sign off on delivery and conclude task execution.'
      },
      {
        id: '2',
        label: '2. Remediation',
        action: 'remediation',
        description: 'Reject delivery and dispatch remediation task to Anbu/Jonin with Kage findings.'
      }
    ]
  };

  const message = `Kage review completed (${confidenceVal}% Confidence). Delivery paused awaiting human sign-off (Gate 2).\n\n` +
    'Please select an option to conclude:\n' +
    '1. Compact and approve\n' +
    '2. Remediation';

  return JSON.stringify({
    status: 'pending_human_signoff',
    phase: 'delivery_signoff',
    hitl_gate: 'Gate 2 (Delivery Sign-Off)',
    task_id: rootId,
    confidence: confidenceVal,
    message,
    interactive_prompt: promptPayload,
    report: finalReport,
    task_dir: resolvedTaskDir
  });
}

function parseGateChoice(rawInput, rawRefinement) {
  if (rawInput === null || rawInput === undefined) return null;

  if (typeof rawInput === 'object') {
    const candidate = rawInput.choice ?? rawInput.action ?? rawInput.gate_action ?? rawInput.gate_choice;
    const ref = rawInput.refinement ?? rawInput.feedback ?? rawInput.notes ?? rawRefinement;
    return parseGateChoice(candidate, ref);
  }

  const str = String(rawInput).trim();
  const lower = str.toLowerCase();

  const isApprove = str === '1' ||
    lower.startsWith('1.') ||
    lower.startsWith('1 ') ||
    lower === 'approve' ||
    lower === 'compact and approve' ||
    lower.includes('compact and approve');

  if (isApprove) {
    return { action: 'approve', choice: 1, raw: str };
  }

  const isRefineExplicit = lower.startsWith('input refine plan') ||
    lower.startsWith('refine plan') ||
    lower.startsWith('refine:') ||
    lower === 'refine';

  if (isRefineExplicit) {
    const inlineNotes = str.replace(/^(?:input\s+refine\s+plan|refine\s+plan|refine:?)\s*/i, '').trim();
    const finalNotes = inlineNotes || (rawRefinement ? String(rawRefinement).trim() : '');
    return { action: 'refine', choice: 2, refinement: finalNotes, raw: str };
  }

  const isGate2Remediation = lower === 'remediation' ||
    lower.startsWith('2. remediation') ||
    lower.startsWith('2 remediation') ||
    lower === 'remediate';

  if (isGate2Remediation) {
    return { action: 'remediation', choice: 2, raw: str };
  }

  const isRejectOrRegen = str === '2' ||
    lower.startsWith('2.') ||
    lower.startsWith('2 ') ||
    lower === 'reject' ||
    lower === 'regenerate' ||
    lower.includes('reject and regenerate plan');

  if (isRejectOrRegen) {
    if (rawRefinement && String(rawRefinement).trim()) {
      return { action: 'refine', choice: 2, refinement: String(rawRefinement).trim(), raw: str };
    }
    return { action: 'regenerate', choice: 2, raw: str };
  }

  return null;
}

function applyGate1Choice(choiceObj, status, resolvedTaskDir, sdlcManager) {
  const rootTaskId = status.task_id || path.basename(resolvedTaskDir);

  if (!choiceObj) {
    return { ok: false, error: 'Invalid or missing choice for Gate 1 Plan Approval.' };
  }

  if (choiceObj.action === 'approve') {
    status.plan_approved = true;
    status.hitl_gate = null;
    status.phase = 'execute';
    status.gate_verdict = {
      gate: 'gate_1',
      action: 'approve',
      choice: '1. Compact and approve',
      decided_at: new Date().toISOString()
    };
    try {
      sdlcManager.updateTask(rootTaskId, {
        status: 'in_progress',
        evidence: {
          gate1_verdict: 'approved',
          approved_at: new Date().toISOString()
        }
      });
    } catch (_) { /* best-effort update */ }
    saveWorkflowStatus(resolvedTaskDir, status);
    return { ok: true, status, nextPhase: 'execute', approved: true };
  }

  if (choiceObj.action === 'regenerate' || choiceObj.action === 'refine') {
    status.plan_approved = false;
    status.hitl_gate = null;
    status.phase = 'plan';
    status.assigned_agent = 'kage';
    status.current_dispatch = null;
    status.plan_rejected_count = (status.plan_rejected_count || 0) + 1;

    const feedbackNotes = choiceObj.refinement || '';
    if (feedbackNotes) {
      status.plan_refinement = feedbackNotes;
      const feedbackPath = path.join(resolvedTaskDir, 'plan_feedback.md');
      try {
        fs.writeFileSync(feedbackPath, `# Plan Refinement Instructions\n\n${feedbackNotes}\n`, 'utf8');
      } catch (_) { /* ignore */ }

      const findingsPath = path.join(resolvedTaskDir, 'findings.md');
      try {
        const existingFindings = fs.existsSync(findingsPath) ? fs.readFileSync(findingsPath, 'utf8') : '';
        const appendText = `\n\n### 🔄 Plan Refinement Feedback (Iteration ${status.plan_rejected_count})\n${feedbackNotes}\n`;
        fs.writeFileSync(findingsPath, existingFindings + appendText, 'utf8');
      } catch (_) { /* ignore */ }
    }

    try {
      sdlcManager.updateTask(rootTaskId, {
        status: 'in_progress',
        evidence: {
          gate1_verdict: 'rejected_for_regeneration',
          feedback: feedbackNotes,
          iteration: status.plan_rejected_count
        }
      });
    } catch (_) { /* best-effort update */ }
    saveWorkflowStatus(resolvedTaskDir, status);
    return { ok: true, status, nextPhase: 'plan', regenerated: true, feedback: feedbackNotes };
  }

  return { ok: false, error: `Unrecognized Gate 1 action: ${choiceObj.action}` };
}

function applyGate2Choice(choiceObj, status, resolvedTaskDir, sdlcManager) {
  const rootId = process.env.KONOHA_TASK_ID || status.task_id || path.basename(resolvedTaskDir);

  if (!choiceObj) {
    return { ok: false, error: 'Invalid or missing choice for Gate 2 Delivery Sign-Off.' };
  }

  if (choiceObj.action === 'approve') {
    status.human_signed_off = true;
    status.hitl_gate = null;
    status.phase = 'done';
    status.gate_verdict = {
      gate: 'gate_2',
      action: 'approve',
      choice: '1. Compact and approve',
      signed_off_at: new Date().toISOString()
    };
    try {
      sdlcManager.updateTask(rootId, {
        status: 'completed',
        evidence: {
          gate2_verdict: 'signed_off',
          completed_at: new Date().toISOString()
        }
      });
    } catch (_) { /* best-effort update */ }
    saveWorkflowStatus(resolvedTaskDir, status);
    cleanupTransientScratchFiles(resolvedTaskDir);
    return { ok: true, status, nextPhase: 'done', signed_off: true };
  }

  if (choiceObj.action === 'remediation') {
    status.human_signed_off = false;
    status.hitl_gate = null;
    status.remediation_cycles = (status.remediation_cycles || 0) + 1;

    const feedbackNotes = choiceObj.refinement || 'Human operator rejected delivery and requested remediation.';
    status.remediation_feedback = feedbackNotes;

    const { handleAdvisorRemediation } = require('./workflow_completion');
    const outcome = handleAdvisorRemediation({
      status,
      resolvedTaskDir,
      sdlcManager,
      reason: feedbackNotes
    });

    try {
      sdlcManager.updateTask(rootId, {
        status: 'remediating',
        evidence: {
          gate2_verdict: 'remediation_requested',
          feedback: feedbackNotes,
          cycle: status.remediation_cycles
        }
      });
    } catch (_) { /* best-effort update */ }
    saveWorkflowStatus(resolvedTaskDir, status);
    return { ok: true, status, nextPhase: 'execute', remediation: true, outcome };
  }

  return { ok: false, error: `Unrecognized Gate 2 action: ${choiceObj.action}` };
}

module.exports = {
  GATE1_CHOICES,
  GATE1_REFINE_LABEL,
  GATE2_CHOICES,
  buildGate1Prompt,
  buildGate2Prompt,
  parseGateChoice,
  applyGate1Choice,
  applyGate2Choice
};
