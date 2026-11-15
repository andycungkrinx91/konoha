'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_TODO_TOOLS = Object.freeze({
  antigravity: { tool: 'task_boundary', artifact: 'task.md' },
  agy: { tool: 'task_boundary', artifact: 'task.md' },
  claude: { tool: 'TodoWrite', artifact: null },
  claudecode: { tool: 'TodoWrite', artifact: null },
  cursor: { tool: 'TodoWrite', artifact: null },
  opencode: { tool: 'todowrite', artifact: null },
  codex: { tool: 'update_plan', artifact: null },
  omp: { tool: 'todo_write', artifact: null },
  pi: { tool: 'todo_write', artifact: null },
  commandcode: { tool: 'TodoWrite', artifact: null }
});

const PHASE_WALKTHROUGH = Object.freeze([
  { step: 1, id: 'classify_and_plan', title: 'Phase 1: Triage, Exploration & Action Plan', agent: 'kage' },
  { step: 2, id: 'gate1_approval', title: 'Gate 1: Plan Approval & Context Compaction', agent: 'sannin' },
  { step: 3, id: 'parallel_execution', title: 'Phase 2: Specialist Execution (Isolated Worktrees)', agent: 'worker' },
  { step: 4, id: 'documentation_sync', title: 'Phase 3: Technical Documentation & Asset Audit', agent: 'tokubetsu-jonin' },
  { step: 5, id: 'kage_confidence_gate', title: 'Phase 4: Zero-AI-Slop (100/100) & Kage 98% Gate', agent: 'kage' },
  { step: 6, id: 'gate2_signoff', title: 'Gate 2: Final Delivery Sign-Off', agent: 'sannin' }
]);

function normalizeTodoItems(tasks = [], status = {}) {
  const rawList = Array.isArray(tasks) && tasks.length > 0
    ? tasks
    : (Array.isArray(status.tasks) ? status.tasks : []);

  if (rawList.length === 0 && status.prompt) {
    const text = String(status.prompt).slice(0, 180);
    return [{
      id: 'todo_1',
      content: text,
      task: text,
      status: status.phase === 'done' ? 'completed' : 'in_progress',
      priority: 'high',
      agent: status.assigned_agent || 'anbu'
    }];
  }

  return rawList.map((item, idx) => {
    const base = (item && typeof item === 'object') ? item : {};
    const rawStatus = String(base.status || 'pending').toLowerCase();
    let mappedStatus = 'pending';
    if (rawStatus === 'completed' || rawStatus === 'done') mappedStatus = 'completed';
    else if (rawStatus === 'in_progress' || rawStatus === 'running') mappedStatus = 'in_progress';
    else if (['unverified', 'failed', 'rejected', 'blocked'].includes(rawStatus)) mappedStatus = rawStatus;
    const text = base.task || base.content || base.description || `Step ${idx + 1}`;
    return {
      ...base,
      id: base.id || `todo_${idx + 1}`,
      content: text,
      task: base.task || text,
      status: mappedStatus,
      priority: base.priority || (idx === 0 ? 'high' : 'medium'),
      agent: base.agent || status.assigned_agent || 'anbu',
      parallel_group: base.parallel_group || undefined,
      worktree_path: base.worktree_path || undefined
    };
  });
}

function buildWalkthroughSteps(status = {}) {
  const phase = String(status.phase || 'plan').toLowerCase();
  const planApproved = Boolean(status.plan_approved);
  const signedOff = Boolean(status.human_signed_off || phase === 'done');

  return PHASE_WALKTHROUGH.map((step) => {
    let stepStatus = 'pending';
    if (signedOff) {
      stepStatus = 'completed';
    } else if (step.id === 'classify_and_plan') {
      stepStatus = planApproved ? 'completed' : (phase === 'plan' || phase === 'plan_approval' ? 'in_progress' : 'completed');
    } else if (step.id === 'gate1_approval') {
      stepStatus = planApproved ? 'completed' : (phase === 'plan_approval' ? 'in_progress' : 'pending');
    } else if (step.id === 'parallel_execution') {
      if (['document', 'review', 'delivery_signoff', 'done'].includes(phase)) stepStatus = 'completed';
      else if (['brief', 'todo', 'execute'].includes(phase)) stepStatus = 'in_progress';
    } else if (step.id === 'documentation_sync') {
      if (['review', 'delivery_signoff', 'done'].includes(phase)) stepStatus = 'completed';
      else if (phase === 'document') stepStatus = 'in_progress';
    } else if (step.id === 'kage_confidence_gate') {
      if (['delivery_signoff', 'done'].includes(phase)) stepStatus = 'completed';
      else if (phase === 'review') stepStatus = 'in_progress';
    } else if (step.id === 'gate2_signoff') {
      if (phase === 'done') stepStatus = 'completed';
      else if (phase === 'delivery_signoff') stepStatus = 'in_progress';
    }
    return { ...step, status: stepStatus };
  });
}

function _buildNativeTodoPayload({ key, todos, progressSummary, activeStepTitle, markdownChecklist, options = {} }) {
  const toClientStatus = (s) => (s === 'completed' || s === 'in_progress' ? s : 'pending');
  const compactItems = todos.map((t) => ({
    id: t.id,
    content: t.content,
    status: toClientStatus(t.status),
    priority: t.priority || 'medium',
    ...(t.status === 'in_progress' ? { activeForm: `Working on ${t.content}` } : {})
  }));
  if (key === 'antigravity' || key === 'agy') {
    const taskMdPath = options.taskDir ? path.join(options.taskDir, 'task.md') : 'task.md';
    return {
      TaskName: activeStepTitle,
      TaskStatus: progressSummary,
      TaskSummary: markdownChecklist || 'Executing Konoha workflow steps',
      Mode: 'EXECUTION',
      task_md_path: taskMdPath,
      task_md_content: markdownChecklist,
      cli_fallback: `If task_boundary is unavailable, mirror checklist into ${taskMdPath} / TODO.md.`
    };
  }
  if (key === 'codex') {
    return {
      explanation: `${activeStepTitle} (${progressSummary})`,
      plan: todos.map((t) => ({
        step: `[${t.id}] (@${t.agent}) ${t.content}`,
        status: toClientStatus(t.status)
      }))
    };
  }
  if (key === 'omp' || key === 'pi') {
    const items = compactItems.map(({ id, content, status, priority }) => ({ id, content, status, priority }));
    return {
      ops: [{ op: 'replace', items }],
      todos: items
    };
  }
  if (key === 'opencode') {
    return {
      todos: compactItems.map(({ id, content, status, priority }) => ({ id, content, status, priority }))
    };
  }
  return { todos: compactItems };
}

function buildClientTodoDirective(client = '', todos = [], walkthroughSteps = [], options = {}) {
  const key = String(client || '').toLowerCase().trim();
  const spec = CLIENT_TODO_TOOLS[key] || { tool: 'TodoWrite', artifact: null };
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const activeStep = walkthroughSteps.find((s) => s.status === 'in_progress') || walkthroughSteps[0];
  const activeStepTitle = activeStep ? `${activeStep.step}. ${activeStep.title}` : 'Execution';
  const progressSummary = `${completedCount}/${todos.length} tasks completed`;

  const markdownChecklist = todos.map((t) => {
    const box = t.status === 'completed' ? '[x]' : (t.status === 'in_progress' ? '[/]' : '[ ]');
    return `- ${box} **${t.id}** (@${t.agent}): ${t.content}`;
  }).join('\n');

  const nativePayload = _buildNativeTodoPayload({ key, todos, progressSummary, activeStepTitle, markdownChecklist, options });
  return {
    client: key || 'universal',
    native_tool: spec.tool,
    artifact_file: spec.artifact,
    progress_summary: progressSummary,
    active_walkthrough_step: activeStepTitle,
    native_payload: nativePayload,
    instruction: `Sync via \`${spec.tool}\` (${progressSummary}) using \`client_todo_directive.native_payload\`.`,
    markdown_checklist: markdownChecklist
  };
}

function formatTodoSyncBlock(directive = {}, todos = []) {
  const tool = directive.native_tool || 'TodoWrite';
  const progress = directive.progress_summary || `${todos.filter((t) => t.status === 'completed').length}/${todos.length} tasks completed`;
  const step = directive.active_walkthrough_step || 'Execution';
  const active = todos.find((t) => t.status === 'in_progress') || todos.find((t) => t.status !== 'completed') || todos[0];
  const activeSummary = active ? `${active.id}[${active.status}]` : 'none';
  const block = `[TODO SYNC] ${tool} | ${progress} | ${step} | ${activeSummary}`;
  return block.length > 200 ? `${block.slice(0, 197)}...` : block;
}

function markAgentTodoInProgress(status = {}, agentName = '') {
  if (!status || !Array.isArray(status.tasks) || !agentName) return false;
  const clean = String(agentName).replace(/_/g, '-').toLowerCase();
  const match = status.tasks.find((t) => t && t.status === 'pending' && String(t.agent || '').replace(/_/g, '-').toLowerCase() === clean)
    || status.tasks.find((t) => t && t.status === 'pending');
  if (!match) return false;
  match.status = 'in_progress';
  return true;
}

function applyAgentReportToTodos(workflowStatus, cleanAgent, dispatchId, finalStatus, updateData = {}) {
  if (!workflowStatus || !Array.isArray(workflowStatus.tasks)) return false;
  const dispatch = (Array.isArray(workflowStatus.active_dispatches) && dispatchId)
    ? (workflowStatus.active_dispatches.find((d) => d.id === dispatchId) || workflowStatus.current_dispatch)
    : workflowStatus.current_dispatch;
  const targetId = updateData.taskId || (dispatch && dispatch.task_id) || null;
  const task = (targetId ? workflowStatus.tasks.find((t) => t.id === targetId) : null)
    || workflowStatus.tasks.find((t) => String(t.agent || '').replace(/_/g, '-').toLowerCase() === cleanAgent && t.status !== 'completed')
    || workflowStatus.tasks.find((t) => t.status === 'in_progress');
  if (!task) return false;

  if (finalStatus === 'completed' || finalStatus === 'unverified') {
    task.status = finalStatus;
    task.result = updateData.summary || '';
    task.validation = updateData.validation || [];
    task.verified = updateData.verified;
    task.files_created = updateData.filesCreated || [];
    task.files_modified = updateData.filesModified || [];
  } else if (finalStatus === 'in_progress') {
    task.status = 'in_progress';
    if (updateData.summary) task.result = updateData.summary;
  } else if (finalStatus === 'failed' || finalStatus === 'rejected') {
    task.status = 'pending';
    if (updateData.summary) task.result = updateData.summary;
  }
  return true;
}

function _atomicWriteNoFollow(targetPath, content) {
  if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`Refusing to overwrite symlink: ${targetPath}`);
  }
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

function _persistTodoArtifacts(taskDir, todos, walkthroughSteps, directive) {
  if (!taskDir) return;
  try {
    const resolvedDir = path.resolve(taskDir);
    if (fs.existsSync(resolvedDir) && fs.lstatSync(resolvedDir).isSymbolicLink()) return;
    fs.mkdirSync(resolvedDir, { recursive: true });
    _atomicWriteNoFollow(path.join(resolvedDir, 'walkthrough_todos.json'), JSON.stringify({
      updated_at: new Date().toISOString(),
      walkthrough_steps: walkthroughSteps,
      todos,
      client_todo_directive: directive
    }, null, 2));
    const todoMd = [
      `# Task Checklist (${directive.progress_summary})`,
      `Active Step: ${directive.active_walkthrough_step}`,
      '',
      directive.markdown_checklist || '- (no tasks yet)',
      ''
    ].join('\n');
    _atomicWriteNoFollow(path.join(resolvedDir, 'TODO.md'), todoMd);
  } catch (_) { /* best-effort persistence */ }
}

function _syncTodoEvidenceToDb(effTaskId, todos, directive) {
  if (!effTaskId) return;
  try {
    const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
    if (!sdlcManager.getTask(effTaskId)) return;
    sdlcManager.updateTask(effTaskId, {
      evidence: {
        todos,
        walkthrough_progress: directive.progress_summary,
        active_walkthrough_step: directive.active_walkthrough_step
      }
    });
  } catch (_) { /* best-effort DB progress sync */ }
}

function syncTodoAndWalkthrough(status = {}, options = {}) {
  const client = options.client || status.client || '';
  const taskDir = options.taskDir || '';
  const todos = normalizeTodoItems(options.tasks || status.tasks, status);
  if (status && typeof status === 'object') {
    status.tasks = todos;
  }
  const walkthroughSteps = buildWalkthroughSteps(status);
  const directive = buildClientTodoDirective(client, todos, walkthroughSteps, { taskDir });

  _persistTodoArtifacts(taskDir, todos, walkthroughSteps, directive);
  if (options.syncDb !== false) {
    const effTaskId = options.taskId || (status && status.task_id) || '';
    _syncTodoEvidenceToDb(effTaskId, todos, directive);
  }

  return {
    walkthrough_steps: walkthroughSteps,
    todos,
    client_todo_directive: directive
  };
}

module.exports = {
  CLIENT_TODO_TOOLS,
  PHASE_WALKTHROUGH,
  normalizeTodoItems,
  buildWalkthroughSteps,
  buildClientTodoDirective,
  formatTodoSyncBlock,
  markAgentTodoInProgress,
  applyAgentReportToTodos,
  syncTodoAndWalkthrough
};
