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
    return [{
      id: 'todo_1',
      content: String(status.prompt).slice(0, 180),
      status: status.phase === 'done' ? 'completed' : 'in_progress',
      priority: 'high',
      agent: status.assigned_agent || 'anbu'
    }];
  }

  return rawList.map((item, idx) => {
    const rawStatus = String(item.status || 'pending').toLowerCase();
    const mappedStatus = rawStatus === 'completed' || rawStatus === 'done'
      ? 'completed'
      : (rawStatus === 'in_progress' || rawStatus === 'running' ? 'in_progress' : 'pending');
    return {
      id: item.id || `todo_${idx + 1}`,
      content: item.task || item.content || item.description || `Step ${idx + 1}`,
      status: mappedStatus,
      priority: item.priority || (idx === 0 ? 'high' : 'medium'),
      agent: item.agent || status.assigned_agent || 'anbu',
      parallel_group: item.parallel_group || undefined,
      worktree_path: item.worktree_path || undefined
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
    return {
      ...step,
      status: stepStatus
    };
  });
}

function buildClientTodoDirective(client = '', todos = [], walkthroughSteps = []) {
  const key = String(client || '').toLowerCase().trim();
  const spec = CLIENT_TODO_TOOLS[key] || { tool: 'TodoWrite', artifact: null };
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const activeStep = walkthroughSteps.find((s) => s.status === 'in_progress') || walkthroughSteps[0];

  const markdownChecklist = todos.map((t) => {
    const box = t.status === 'completed' ? '[x]' : (t.status === 'in_progress' ? '[/]' : '[ ]');
    return `- ${box} **${t.id}** (@${t.agent}): ${t.content}`;
  }).join('\n');

  return {
    client: key || 'universal',
    native_tool: spec.tool,
    artifact_file: spec.artifact,
    progress_summary: `${completedCount}/${todos.length} tasks completed`,
    active_walkthrough_step: activeStep ? `${activeStep.step}. ${activeStep.title}` : 'Execution',
    instruction: `Sync via \`${spec.tool}\` (${completedCount}/${todos.length} done).`,
    markdown_checklist: markdownChecklist
  };
}

function syncTodoAndWalkthrough(status = {}, options = {}) {
  const client = options.client || status.client || '';
  const taskDir = options.taskDir || '';
  const todos = normalizeTodoItems(options.tasks || status.tasks, status);
  const walkthroughSteps = buildWalkthroughSteps(status);
  const directive = buildClientTodoDirective(client, todos, walkthroughSteps);

  if (taskDir) {
    try {
      fs.mkdirSync(taskDir, { recursive: true });
      const syncPath = path.join(taskDir, 'walkthrough_todos.json');
      fs.writeFileSync(syncPath, JSON.stringify({
        updated_at: new Date().toISOString(),
        walkthrough_steps: walkthroughSteps,
        todos,
        client_todo_directive: directive
      }, null, 2), 'utf8');
    } catch (_) { /* best-effort persistence */ }
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
  syncTodoAndWalkthrough
};
