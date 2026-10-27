'use strict';

const fs = require('fs');
const path = require('path');
const {
  getResolvedTaskDir,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  cleanupTransientScratchFiles
} = require('./workflow_common');
const {
  workflowDispatch,
  workflowDispatchCompleted,
  workflowReviewApproved,
  runAislopGate
} = require('./workflow_dispatch');
const {
  handleWorkflowCompletion,
  handleWorkflowSynthesis
} = require('./workflow_completion');
const { logToolCall } = require('./skills');

function runMcpWorkflow(taskDir = null) {
  const resolvedTaskDir = getResolvedTaskDir(taskDir);
  fs.mkdirSync(resolvedTaskDir, { recursive: true });
  const status = loadWorkflowStatus(resolvedTaskDir);
  status.schema_version = status.schema_version || 2;
  status.created_at = status.created_at || new Date().toISOString();
  status.tasks = status.tasks || [];
  status.completed_dispatches = status.completed_dispatches || [];
  status.dispatch_results = status.dispatch_results || {};
  status.review = status.review || {};
  status.history = status.history || [];
  status.pending_executors = status.pending_executors || [];
  status.completed_executors = status.completed_executors || [];
  status.executed = status.executed || {};
  const cd = require('./client_detection');
  status.session_id = status.session_id || cd.getActiveSessionId();
  status.client = status.client || cd.detectActiveClient() || '';

  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  const { getWorkspaceRoot } = require('./runtime_state');
  const resolvedProjPath = status.project_path || getWorkspaceRoot() || process.cwd();
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const effPrompt = status.prompt || '';

  let phase = status.phase || 'route';
  if (phase === 'done') {
    return JSON.stringify({ status: 'completed', phase: 'done' });
  }

  if (phase === 'plan_approval' || (phase === 'plan' && status.hitl_gate === 'plan_approval' && !status.plan_approved)) {
    const rootTaskId = status.task_id || path.basename(resolvedTaskDir);
    const rootTaskRecord = sdlcManager.getTask(rootTaskId);
    const isApprovedInDb = rootTaskRecord && (rootTaskRecord.status === 'in_progress' || rootTaskRecord.status === 'completed');

    if (isApprovedInDb || sdlcConfig.hitl_mode === 'disabled' || status.execution_track === 'fast_track') {
      status.plan_approved = true;
      status.hitl_gate = null;
      status.phase = 'execute';
      phase = 'execute';
      try {
        sdlcManager.updateTask(rootTaskId, { status: 'in_progress' });
      } catch (_) { /* ignore */ }
      saveWorkflowStatus(resolvedTaskDir, status);
    } else {
      const res = JSON.stringify({
        status: 'pending_plan_approval',
        phase: 'plan_approval',
        hitl_gate: 'Gate 1 (Plan Approval)',
        task_id: rootTaskId,
        message: 'Action plan compiled. Execution paused awaiting human plan approval (Gate 1). Approve via laptop IDE or Telegram bot to proceed.',
        tasks: status.tasks,
        task_dir: resolvedTaskDir
      });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    }
  }

  if (phase === 'delivery_signoff' || (phase === 'review' && status.hitl_gate === 'delivery_signoff' && !status.human_signed_off)) {
    const rootId = process.env.KONOHA_TASK_ID || status.task_id || path.basename(resolvedTaskDir);
    const rootTaskRecord = sdlcManager.getTask(rootId);
    const isSignedOffInDb = rootTaskRecord && rootTaskRecord.status === 'completed';

    if (isSignedOffInDb || sdlcConfig.hitl_mode === 'disabled') {
      status.human_signed_off = true;
      status.hitl_gate = null;
      status.phase = 'done';
      try {
        sdlcManager.updateTask(rootId, { status: 'completed' });
      } catch (_) { /* ignore */ }
      saveWorkflowStatus(resolvedTaskDir, status);
      cleanupTransientScratchFiles(resolvedTaskDir);
      const res = JSON.stringify({ status: 'completed', phase: 'done', task_id: rootId, task_dir: resolvedTaskDir });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    } else {
      const res = JSON.stringify({
        status: 'pending_human_signoff',
        phase: 'delivery_signoff',
        hitl_gate: 'Gate 2 (Delivery Sign-Off)',
        task_id: rootId,
        message: 'Delivery paused awaiting human sign-off (Gate 2). Approve via laptop IDE or Telegram bot to conclude task.',
        task_dir: resolvedTaskDir
      });
      logToolCall('sannin', `task_dir=${resolvedTaskDir}`, res, 'sannin');
      return res;
    }
  }

  if (phase === 'route') {
    const prompt = status.prompt || effPrompt;
    if (!prompt) {
      return JSON.stringify({ status: 'error', message: 'No task prompt found in workflow context.', phase: 'route' });
    }
    status.phase = 'explore';
    status.assigned_agent = 'genin';
    status.history.push({ phase: 'route', agent: 'genin' });
    status.current_dispatch = null;
    saveWorkflowStatus(resolvedTaskDir, status);
    phase = 'explore';
  }

  const completion = workflowDispatchCompleted(resolvedTaskDir, status);
  if (completion && completion.dispatch && completion.dispatch.phase === phase) {
    const outcome = handleWorkflowCompletion(completion, phase, status, resolvedTaskDir, sdlcConfig, sdlcManager);
    if (outcome.response) {
      return outcome.response;
    }
    if (outcome.nextPhase) {
      phase = outcome.nextPhase;
    }
    saveWorkflowStatus(resolvedTaskDir, status);
  }

  const SKILL_RETRIEVAL_DIRECTIVE = 'Retrieve skills via SQLite FTS5/RAG: Call konoha.find_skill("<keywords>") and konoha.use_skills(["<skill>"]) or konoha.get_skill("<name>"). Never read raw markdown files directly.';

  if (phase === 'explore') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'explore', 'genin');
    status.assigned_agent = 'genin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'explore', agent: 'genin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir, task: effPrompt, skill_directive: SKILL_RETRIEVAL_DIRECTIVE });
  }

  if (phase === 'plan') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'plan', 'kage');
    const findingsRaw = readFileSafe(path.join(resolvedTaskDir, 'findings.md')) || 'No findings available.';
    const findingsSummary = findingsRaw.length > 500
      ? findingsRaw.slice(0, 500).trim() + `...\n\n*(Full findings: \`${path.join(resolvedTaskDir, 'findings.md')}\`)*`
      : findingsRaw;
    status.assigned_agent = 'kage';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'plan', agent: 'kage', dispatch_id: dispatch.id, task_dir: resolvedTaskDir, findings: findingsSummary, skill_directive: SKILL_RETRIEVAL_DIRECTIVE });
  }

  if (phase === 'research') {
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'research', 'chunin');
    const planContext = readFileSafe(path.join(resolvedTaskDir, 'plan.md')) || '';
    const qLine = planContext.split(/\r?\n/).find(l => l.startsWith('research_query:'));
    const query = qLine ? qLine.slice('research_query:'.length).trim() : '';
    status.assigned_agent = 'chunin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({ status: 'ready', phase: 'research', agent: 'chunin', dispatch_id: dispatch.id, task_dir: resolvedTaskDir, query: query || 'plan requirements', skill_directive: SKILL_RETRIEVAL_DIRECTIVE });
  }

  if (phase === 'execute') {
    const nextTask = (status.tasks || []).find(t => t.status !== 'completed');
    if (!nextTask) {
      if (status.slop_cycles && status.slop_cycles > 0) {
        status.phase = 'review';
        status.assigned_agent = 'kage';
        status.current_dispatch = null;
        saveWorkflowStatus(resolvedTaskDir, status);
        phase = 'review';
      } else {
        status.phase = 'document';
        status.assigned_agent = 'tokubetsu-jonin';
        status.current_dispatch = null;
        saveWorkflowStatus(resolvedTaskDir, status);
        phase = 'document';
      }
    } else {
      const dispatch = workflowDispatch(resolvedTaskDir, status, 'execute', nextTask.agent, nextTask.id, nextTask.task);
      status.assigned_agent = nextTask.agent;
      saveWorkflowStatus(resolvedTaskDir, status);
      return JSON.stringify({ status: 'ready', phase: 'execute', agent: nextTask.agent, task_id: nextTask.id, task: nextTask.task, dispatch_id: dispatch.id, task_dir: resolvedTaskDir, skill_directive: SKILL_RETRIEVAL_DIRECTIVE });
    }
  }

  if (phase === 'document') {
    const isRegen = status.document_gate && !status.document_gate.passed;
    const attempt = (status.document_attempts || 0) + 1;
    const taskTitle = isRegen
      ? `## TASK: REGENERATE DELIVERABLE (< 3.0% AI DETECTION QUALITY GATE FAILED)\n\nPrevious attempt failed the strict < 3.0% threshold.\n\n${status.document_gate.feedback}\n\n`
      : '## TASK\n\nDocument the completed work and validation evidence in final_docs.md.\n';

    const fontDirectives = (
      '\n### 🖋️ Mandatory Tokubetsu-Jonin Document Engineering Directives:\n' +
      '- Official Native Tools: Use document_create (DOCX/PDF), spreadsheet_create (XLSX), presentation_create (PPTX), diagram_create (SVG), animation_export (WebP) in src/tools/document_engine.js.\n' +
      '- Skill Retrieval via FTS5/RAG: Query konoha.find_skill("<keywords>") and konoha.get_skill("<name>"). Never read raw markdown files directly.\n' +
      '- Cover / Main Titles: Inter Display / Inter Bold (32pt, high impact, -0.02em letter spacing)\n' +
      '- Headings (H1–H3, Table Headers): Inter SemiBold / Bold\n' +
      '- Content / Body: Inter Regular (~10.5–11 pt for A4, line spacing 1.5–1.6)\n' +
      '- Footer / Metadata: Inter Regular / Medium (8–9 pt, neutral slate #64748B)\n' +
      '- Technical / Code Snippets: JetBrains Mono (9–9.5 pt, neutral tint #F8FAFC)\n' +
      '\n### 🎨 Reference Cover Design Directives (assets/cover-reference.jpg):\n' +
      '- Canvas: Pure white / soft pearl (#FFFFFF / #F8FAFC), 0 dark fills\n' +
      '- Chromatic Mesh Gradient: Multi-stop soft transitions (lavender #DBCCD0 -> periwinkle #C2C0D6 -> blue-slate #AAC2D8 -> turquoise #B0D5D8 -> mint #C5D7C2)\n' +
      '- Konoha Brand Accents: Hokage Purple #8A4FD0, Electric Violet #7C5CE0, Orange #F08A24, Red #E8453C\n' +
      '- Zero AI Clichés & High Sentence Burstiness (CV >= 0.85) to guarantee AI detection score < 3.0%.\n'
    );

    const dispatch = workflowDispatch(resolvedTaskDir, status, 'document', 'tokubetsu-jonin');
    status.assigned_agent = 'tokubetsu-jonin';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({
      status: isRegen ? 'regenerate' : 'ready',
      phase: 'document',
      agent: 'tokubetsu-jonin',
      dispatch_id: dispatch.id,
      task_dir: resolvedTaskDir,
      task: taskTitle + fontDirectives,
      attempts: attempt,
      feedback: isRegen ? status.document_gate.feedback : null
    });
  }

  if (phase === 'review' && workflowReviewApproved(resolvedTaskDir, status)) {
    status.phase = 'synthesize';
    status.assigned_agent = 'sannin';
    status.review = status.review || { approved: true };
    saveWorkflowStatus(resolvedTaskDir, status);
    phase = 'synthesize';
  }

  if (phase === 'review') {
    const { getWorkspaceRoot: _gwr } = require('./runtime_state');
    const gateProject = _gwr() || process.cwd();
    const gate = runAislopGate(gateProject, status);
    if (!status.aislop_gate) status.aislop_gate = gate;
    saveWorkflowStatus(resolvedTaskDir, status);
    const gateTarget = gate.enforced
      ? 'The mechanical gate requires a 100/100 aislop scan (zero findings of any severity) before synthesis.'
      : 'Run the two-step review (Step 1 aislop_scan, Step 2 anti-slop rules) and verify 0 findings.';
    const dispatch = workflowDispatch(resolvedTaskDir, status, 'review', 'kage');
    status.assigned_agent = 'kage';
    saveWorkflowStatus(resolvedTaskDir, status);
    return JSON.stringify({
      status: 'ready',
      phase: 'review',
      agent: 'kage',
      dispatch_id: dispatch.id,
      task_dir: resolvedTaskDir,
      task: `Verify every task in status.json is completed, required files exist, validation evidence has no errors or warnings, security/rollback checks are documented. Verify Akatsuki Security Final Gate pass (akatsuki_reviewed: true in kage_review.json or akatsuki_review.json with 0 critical/high findings). Run the TWO-STEP Zero-AI-Slop review: Step 1 aislop_scan (scanner), Step 2 call konoha.anti_slop tool (final verify zero slop across all changes & enforce antislop skill Delivery Gate) — TARGET 100%: zero findings of any severity. ${gateTarget}${gate.enforced ? ` Current mechanical scan: score ${gate.score ?? 'n/a'}, findings ${gate.findings ?? 'n/a'}.` : ''} Write kage_review.json with approved, verified_task_ids, validation, security_reviewed, akatsuki_reviewed, rollback_plan, ai_slop_findings, ai_slop_clean, and findings.`,
      aislop_gate: gate
    });
  }

  if (phase === 'synthesize') {
    return handleWorkflowSynthesis(status, resolvedTaskDir, sdlcConfig, sdlcManager);
  }

  return JSON.stringify({ status: 'error', message: `Unknown or stuck workflow phase: ${phase}`, phase });
}

module.exports = {
  runMcpWorkflow
};
