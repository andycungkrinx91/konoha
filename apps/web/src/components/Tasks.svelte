<script>
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';
import { confirm } from '#lib/state/dialog.svelte.ts';
  import PageHero from './PageHero.svelte';

  let configPath = $state('');
  let dorMode = $state('advisory');
  let reviewMode = $state('self');
  let hitlMode = $state('enabled');
  let configLoading = $state(false);
  let savingConfig = $state(false);

  let dorText = $state('');
  let dorResult = $state(null);
  let dorChecking = $state(false);

  let tasks = $state([]);
  let tasksLoading = $state(false);
  let statusFilter = $state('');
  let projectFilter = $state('');
  let expandedId = $state(null);

  // Canonical SDLC task statuses (matches src/sdlc_manager.js + src/mcp/workflow.js).
  const statusColors = {
    draft: 'theme-bg-subtle theme-text-secondary theme-border',
    pending: 'badge-status badge-status-warning',
    pending_plan_approval: 'badge-status badge-status-warning',
    in_progress: 'badge-status badge-status-info',
    remediating: 'badge-status badge-status-warning',
    pending_human_signoff: 'badge-status badge-status-warning',
    completed: 'badge-status badge-status-success',
    verified: 'badge-status badge-status-info',
    blocked: 'badge-status badge-status-danger'
  };

  function statusClass(status) {
    return statusColors[status] || 'theme-bg-subtle theme-text-secondary theme-border';
  }

  async function loadConfig() {
    configLoading = true;
    try {
      const query = configPath ? `?project=${encodeURIComponent(configPath)}` : '';
      const data = await api.get(`/api/v1/sdlc/config${query}`);
      configPath = data.project_path || configPath;
      dorMode = data.dor_mode || 'advisory';
      reviewMode = data.review_mode || 'self';
      hitlMode = data.hitl_mode || 'enabled';
    } catch (err) {
      toast.error('Failed to load SDLC config: ' + err.message);
    } finally {
      configLoading = false;
    }
  }

  async function saveConfig() {
    if (!configPath.trim()) {
      toast.warning('Project path is required to set SDLC configuration.');
      return;
    }
    savingConfig = true;
    try {
      const data = await api.patch('/api/v1/sdlc/config', {
        project_path: configPath.trim(),
        dor_mode: dorMode,
        review_mode: reviewMode,
        hitl_mode: hitlMode
      });
      dorMode = data.dor_mode || dorMode;
      reviewMode = data.review_mode || reviewMode;
      hitlMode = data.hitl_mode || hitlMode;
      toast.success('SDLC configuration saved');
    } catch (err) {
      toast.error('Failed to save SDLC config: ' + err.message);
    } finally {
      savingConfig = false;
    }
  }

  async function checkReadiness() {
    if (!dorText.trim()) {
      toast.warning('Enter a task description to check readiness.');
      return;
    }
    dorChecking = true;
    dorResult = null;
    try {
      dorResult = await api.post('/api/v1/sdlc/check-readiness', {
        task: dorText.trim(),
        project_path: configPath || undefined
      });
    } catch (err) {
      toast.error('Readiness check failed: ' + err.message);
    } finally {
      dorChecking = false;
    }
  }

  const checkDor = checkReadiness;

  async function loadTasks() {
    tasksLoading = true;
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      // Explicit user-controlled filter only: the task list must show every
      // project's tasks by default so it stays consistent with the Dashboard
      // totals (which count globally). The config card's project path must NOT
      // silently hide tasks from other projects.
      if (projectFilter) params.set('project', projectFilter.trim());
      params.set('limit', '50');
      const data = await api.get(`/api/v1/sdlc/tasks?${params.toString()}`);
      tasks = data.tasks || [];
    } catch (err) {
      toast.error('Failed to load tasks: ' + err.message);
    } finally {
      tasksLoading = false;
    }
  }

  function toggleExpand(id) {
    expandedId = expandedId === id ? null : id;
  }

  function confidenceClass(confidence) {
    if (confidence === 'high') return 'bg-emerald-100 text-status-success border-status-success-soft';
    if (confidence === 'medium') return 'bg-amber-100 text-status-warning border-status-warning-soft';
    return 'bg-rose-100 text-status-danger border-status-danger-soft';
  }

  async function deleteTask(id, e) {
    if (e) e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete SDLC Task?',
      message: `Are you sure you want to delete task "${id}"? This action cannot be undone.`,
      confirmText: 'Delete Task',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/api/v1/sdlc/tasks/${encodeURIComponent(id)}`);
      toast.success('Task deleted successfully');
      await loadTasks();
    } catch (err) {
      toast.error('Failed to delete task: ' + err.message);
    }
  }

  async function clearAllTasks() {
    const hasFilter = Boolean(statusFilter || projectFilter);
    const message = hasFilter
      ? `Are you sure you want to clear all tasks matching the current filter (Status: "${statusFilter || 'All'}", Project: "${projectFilter || 'All'}")?`
      : 'Are you sure you want to clear ALL SDLC tasks across all sessions? This clears obsolete task history.';

    const confirmed = await confirm({
      title: hasFilter ? 'Clear Filtered Tasks?' : 'Clear All SDLC Tasks?',
      message,
      confirmText: 'Clear Tasks',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      const params = new URLSearchParams();
      if (hasFilter) {
        if (statusFilter) params.set('status', statusFilter);
        if (projectFilter) params.set('project', projectFilter.trim());
      } else {
        params.set('all', 'true');
      }
      const data = await api.delete(`/api/v1/sdlc/tasks?${params.toString()}`);
      toast.success(`Cleared ${data.deleted || 0} task(s)`);
      await loadTasks();
    } catch (err) {
      toast.error('Failed to clear tasks: ' + err.message);
    }
  }

  onMount(() => {
    loadConfig();
    loadTasks();
  });
</script>

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="SDLC Tasks"
    badgeText="SDLC Governance"
    badgeIcon={heroBadgeIcon}
    description="Definition of Ready checks, cross-provider review enforcement, zero-AI-slop gate results, and per-project SDLC configuration."
  />

  <!-- Project SDLC Config -->
  <section class="metric-card-3d rounded-[5px] p-6 space-y-4 border" style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));">
    <h2 class="text-lg font-bold theme-text mb-4">Project Configuration</h2>
    <div class="grid md:grid-cols-4 gap-4">
      <label class="block">
        <span class="block text-xs font-bold theme-text-secondary mb-1.5">Project Path</span>
        <input
          type="text"
          bind:value={configPath}
          placeholder="/absolute/path/to/project"
          class="w-full px-3 py-2 rounded-[3px] border text-sm font-semibold theme-text theme-bg-surface login-field-effect input-theme"
        />
      </label>
      <label class="block">
        <span class="block text-xs font-bold theme-text-secondary mb-1.5">DoR Mode</span>
        <select
          bind:value={dorMode}
          class="w-full px-3 py-2 rounded-[3px] border text-sm font-semibold theme-text theme-bg-surface login-field-effect input-theme"
        >
          <option value="advisory">Advisory</option>
          <option value="enforced">Enforced</option>
        </select>
      </label>
      <label class="block">
        <span class="block text-xs font-bold theme-text-secondary mb-1.5">Review Mode</span>
        <select
          bind:value={reviewMode}
          class="w-full px-3 py-2 rounded-[3px] border text-sm font-semibold theme-text theme-bg-surface login-field-effect input-theme"
        >
          <option value="self">Self</option>
          <option value="cross-provider">Cross-Provider</option>
        </select>
      </label>
      <label class="block">
        <span class="block text-xs font-bold theme-text-secondary mb-1.5">HITL Mode</span>
        <select
          bind:value={hitlMode}
          class="w-full px-3 py-2 rounded-[3px] border text-sm font-semibold theme-text theme-bg-surface login-field-effect input-theme"
        >
          <option value="enabled">Enabled (Safe)</option>
          <option value="disabled">Disabled (Autonomous)</option>
        </select>
      </label>
    </div>
    <div class="mt-4 flex items-center gap-3">
      <button
        class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px] font-bold text-xs text-white shadow-md cursor-pointer disabled:opacity-50"
        onclick={saveConfig}
        disabled={savingConfig}
      >
        {#if savingConfig}
          <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
        {/if}
        Save Configuration
      </button>
      <button
        class="btn-3d btn-3d-secondary inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px] font-bold text-xs cursor-pointer disabled:opacity-50"
        onclick={loadConfig}
        disabled={configLoading}
      >
        Reload
      </button>
    </div>
  </section>

  <!-- DoR Checker -->
  <section class="metric-card-3d rounded-[5px] p-6 space-y-4 border" style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));">
    <h2 class="text-lg font-bold theme-text mb-2">Definition of Ready Check</h2>
    <p class="text-xs font-semibold theme-text-muted mb-4">
      Validate a task description before delegation — substance, placeholders, file references, and domain alignment.
    </p>
    <textarea
      bind:value={dorText}
      rows="3"
      placeholder="Describe the task to check against Definition of Ready gates..."
      class="w-full px-3 py-2 rounded-[3px] border text-xs font-bold theme-text-secondary theme-bg-surface login-field-effect focus:outline-none"
    ></textarea>
    <div class="mt-3">
      <button
        class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px] font-bold text-xs text-white shadow-md cursor-pointer disabled:opacity-50"
        onclick={checkReadiness}
        disabled={dorChecking || !dorText.trim()}
      >
        {#if dorChecking}
          <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
        {/if}
        Check Readiness
      </button>
    </div>

    {#if dorResult}
      <div class="mt-5 rounded-[3px] border p-4 space-y-3" style="border-color: var(--color-border, #e2e8f0); background-color: var(--color-primary-glow, #faf5ff);">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2.5 py-1 rounded-[3px] text-xs font-bold border flex items-center gap-1 {dorResult.ready ? 'badge-status badge-status-success' : 'badge-status badge-status-danger'}">
            {#if dorResult.ready}
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Ready</span>
            {:else}
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>Not Ready</span>
            {/if}
          </span>
          <span class="px-2.5 py-1 rounded-[3px] text-xs font-bold border {confidenceClass(dorResult.confidence)}">
            Confidence: {dorResult.confidence || 'n/a'}
          </span>
        </div>
        {#if dorResult.missing && dorResult.missing.length > 0}
          <ul class="list-disc list-inside space-y-1 text-sm font-semibold theme-text-secondary">
            {#each dorResult.missing as reason (reason)}
              <li>{reason}</li>
            {/each}
          </ul>
        {:else if dorResult.ready}
          <p class="text-sm font-semibold text-status-success">Task passes all Definition of Ready criteria.</p>
        {/if}
      </div>
    {/if}
  </section>

  <!-- Tasks List -->
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-bold theme-text">Tasks ({tasks.length})</h2>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={projectFilter}
          placeholder="Filter by project path…"
          title="Leave empty to show tasks from every project"
          class="w-48 px-3 py-2 rounded-[3px] border text-xs font-bold theme-text-secondary theme-bg-surface login-field-effect focus:outline-none"
          onkeydown={(e) => { if (e.key === 'Enter') loadTasks(); }}
          onblur={() => loadTasks()}
        />
        <select
          bind:value={statusFilter}
          onchange={loadTasks}
          class="px-3 py-2 rounded-[3px] border text-xs font-bold theme-text-secondary theme-bg-surface login-field-effect focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="verified">Verified</option>
          <option value="blocked">Blocked</option>
        </select>
        <button
          class="btn-3d btn-3d-secondary inline-flex items-center gap-2 px-4 py-2 rounded-[3px] font-bold text-xs cursor-pointer disabled:opacity-50"
          onclick={loadTasks}
          disabled={tasksLoading}
        >
          {#if tasksLoading}
            <svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
          {/if}
          Refresh
        </button>
        {#if tasks.length > 0}
          <button
            class="btn-3d inline-flex items-center gap-1.5 px-3 py-2 rounded-[3px] font-bold text-xs badge-status badge-status-danger cursor-pointer hover:bg-status-danger-soft disabled:opacity-50"
            onclick={clearAllTasks}
            disabled={tasksLoading}
            title="Clear tasks to prevent stale task hallucination"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear Tasks
          </button>
        {/if}
      </div>
    </div>

    {#if tasksLoading && tasks.length === 0}
      <div class="metric-card-3d rounded-[5px] p-10 border flex items-center justify-center" style="border-color: color-mix(in srgb, var(--theme-grad-1) 20%, var(--color-border));">
        <svg class="animate-spin w-8 h-8" style="color: var(--color-primary, #7c3aed);" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
      </div>
    {:else if tasks.length === 0}
      <div class="metric-card-3d rounded-[5px] p-10 border text-center" style="border-color: color-mix(in srgb, var(--theme-grad-1) 20%, var(--color-border));">
        <p class="text-sm font-bold theme-text-muted">No SDLC tasks found. Tasks are created automatically by agents during SDLC execution.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each tasks as task (task.id)}
          <div class="metric-card-3d rounded-[5px] border overflow-hidden transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-1) 22%, var(--color-border));">
            <div class="w-full p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3 hover-bg-muted transition-colors">
              <button
                type="button"
                class="min-w-0 flex-1 space-y-1.5 text-left cursor-pointer focus:outline-none"
                onclick={() => toggleExpand(task.id)}
              >
                <div class="flex flex-wrap items-center gap-2">
                  <code class="text-xs font-bold theme-text-muted">{task.id}</code>
                  <span class="px-2 py-0.5 rounded-[3px] text-xs font-bold border {statusClass(task.status)}">{task.status}</span>
                  <span class="px-2 py-0.5 rounded-[3px] text-xs font-bold border theme-bg-subtle theme-text-secondary theme-border-strong-b">
                    review: {task.review_mode || 'self'}
                  </span>
                  {#if task.dor_result && task.dor_result.ready !== undefined}
                    <span class="px-2 py-0.5 rounded-[3px] text-xs font-bold border {task.dor_result.ready ? 'badge-status badge-status-success' : 'badge-status badge-status-danger'}">
                      DoR: {task.dor_result.ready ? 'ready' : 'not ready'}
                    </span>
                  {/if}
                  {#if task.slop_result && task.slop_result.pass !== undefined}
                    <span class="px-2 py-0.5 rounded-[3px] text-xs font-bold border {task.slop_result.pass ? 'badge-status badge-status-success' : 'badge-status badge-status-danger'}">
                      Slop: {task.slop_result.pass ? 'clean' : 'findings'}
                    </span>
                  {/if}
                  {#if task.slop_cycles > 0}
                    <span class="px-2 py-0.5 rounded-[3px] text-xs font-bold border badge-status badge-status-warning">
                      {task.slop_cycles} cycle{task.slop_cycles === 1 ? '' : 's'}
                    </span>
                  {/if}
                </div>
                <p class="text-sm font-semibold theme-text break-words line-clamp-2">{task.description}</p>
              </button>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-semibold theme-text-muted">{task.updated_at || ''}</span>
                <button
                  type="button"
                  class="p-1.5 rounded-[3px] theme-text-muted hover:text-[var(--theme-danger)] hover:bg-status-danger-soft transition-colors cursor-pointer"
                  onclick={(e) => deleteTask(task.id, e)}
                  title="Delete this task"
                  aria-label="Delete task"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="p-1.5 rounded-[3px] theme-text-muted hover:theme-text hover-bg-subtle transition-colors cursor-pointer"
                  onclick={() => toggleExpand(task.id)}
                  title={expandedId === task.id ? 'Collapse details' : 'Expand details'}
                  aria-label="Toggle details"
                >
                  <svg class="w-4 h-4 transition-transform {expandedId === task.id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {#if expandedId === task.id}
              <div class="border-t px-4 sm:px-5 py-4 space-y-4 theme-bg-muted" style="border-color: var(--color-border, #e2e8f0);">
                {#if task.project_path}
                  <p class="text-xs font-bold theme-text-muted">Project: <code class="theme-text-secondary">{task.project_path}</code></p>
                {/if}

                {#if task.dor_result && task.dor_result.missing && task.dor_result.missing.length > 0}
                  <div>
                    <h3 class="text-xs font-black theme-text-secondary uppercase tracking-wide mb-1.5">DoR Missing Criteria</h3>
                    <ul class="list-disc list-inside space-y-0.5 text-sm font-semibold theme-text-secondary">
                      {#each task.dor_result.missing as reason (reason)}
                        <li>{reason}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                {#if task.slop_result && Object.keys(task.slop_result).length > 0}
                  <div>
                    <h3 class="text-xs font-black theme-text-secondary uppercase tracking-wide mb-1.5">Zero-AI-Slop Gate</h3>
                    <pre class="text-xs font-semibold theme-text-secondary theme-bg-surface border rounded-[3px] p-3 overflow-x-auto" style="border-color: var(--color-border, #e2e8f0);">{JSON.stringify(task.slop_result, null, 2)}</pre>
                  </div>
                {/if}

                {#if task.evidence && Object.keys(task.evidence).length > 0}
                  <div>
                    <h3 class="text-xs font-black theme-text-secondary uppercase tracking-wide mb-1.5">Evidence</h3>
                    <pre class="text-xs font-semibold theme-text-secondary theme-bg-surface border rounded-[3px] p-3 overflow-x-auto" style="border-color: var(--color-border, #e2e8f0);">{JSON.stringify(task.evidence, null, 2)}</pre>
                  </div>
                {/if}

                {#if (!task.dor_result || Object.keys(task.dor_result).length === 0) && (!task.slop_result || Object.keys(task.slop_result).length === 0) && (!task.evidence || Object.keys(task.evidence).length === 0)}
                  <p class="text-xs font-semibold theme-text-muted">No gate results or evidence recorded for this task yet.</p>
                {/if}

                <div class="flex justify-end pt-2 border-t" style="border-color: var(--color-border, #e2e8f0);">
                  <button
                    type="button"
                    class="btn-3d inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] text-xs font-bold badge-status badge-status-danger hover:bg-status-danger-soft cursor-pointer"
                    onclick={(e) => deleteTask(task.id, e)}
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Task
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
