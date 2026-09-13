<script>
  import { onMount } from 'svelte';
  import { api } from '#lib/api.js';
  import { sweetAlert } from '#lib/sweetAlert.svelte.js';

  let configPath = $state('');
  let dorMode = $state('advisory');
  let reviewMode = $state('self');
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
    draft: 'bg-slate-100 text-slate-700 border-slate-300',
    pending: 'bg-amber-100 text-amber-700 border-amber-300',
    in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
    completed: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    verified: 'bg-purple-100 text-purple-700 border-purple-300',
    blocked: 'bg-rose-100 text-rose-700 border-rose-300'
  };

  function statusClass(status) {
    return statusColors[status] || 'bg-slate-100 text-slate-700 border-slate-300';
  }

  async function loadConfig() {
    configLoading = true;
    try {
      const query = configPath ? `?project=${encodeURIComponent(configPath)}` : '';
      const data = await api.get(`/api/v1/sdlc/config${query}`);
      configPath = data.project_path || configPath;
      dorMode = data.dor_mode || 'advisory';
      reviewMode = data.review_mode || 'self';
    } catch (err) {
      sweetAlert.fire({ icon: 'error', title: 'Failed to load SDLC config', text: err.message });
    } finally {
      configLoading = false;
    }
  }

  async function saveConfig() {
    if (!configPath.trim()) {
      sweetAlert.fire({ icon: 'warning', title: 'Project path is required to set SDLC configuration.' });
      return;
    }
    savingConfig = true;
    try {
      const data = await api.patch('/api/v1/sdlc/config', {
        project_path: configPath.trim(),
        dor_mode: dorMode,
        review_mode: reviewMode
      });
      dorMode = data.dor_mode || dorMode;
      reviewMode = data.review_mode || reviewMode;
      sweetAlert.fire({ icon: 'success', title: 'SDLC configuration saved' });
    } catch (err) {
      sweetAlert.fire({ icon: 'error', title: 'Failed to save SDLC config', text: err.message });
    } finally {
      savingConfig = false;
    }
  }

  async function checkReadiness() {
    if (!dorText.trim()) {
      sweetAlert.fire({ icon: 'warning', title: 'Enter a task description to check readiness.' });
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
      sweetAlert.fire({ icon: 'error', title: 'Readiness check failed', text: err.message });
    } finally {
      dorChecking = false;
    }
  }

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
      sweetAlert.fire({ icon: 'error', title: 'Failed to load tasks', text: err.message });
    } finally {
      tasksLoading = false;
    }
  }

  function toggleExpand(id) {
    expandedId = expandedId === id ? null : id;
  }

  function confidenceClass(confidence) {
    if (confidence === 'high') return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    if (confidence === 'medium') return 'bg-amber-100 text-amber-700 border-amber-300';
    return 'bg-rose-100 text-rose-700 border-rose-300';
  }

  onMount(() => {
    loadConfig();
    loadTasks();
  });
</script>

<div class="space-y-8 max-w-7xl mx-auto">
  <!-- Header -->
  <div class="space-y-3">
    <div
      class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border"
      style="background-color: var(--color-primary-glow, #ede9fe); color: var(--color-primary, #7c3aed); border-color: var(--color-border, #ddd6fe);"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
      SDLC Governance
    </div>
    <h1 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">SDLC Tasks</h1>
    <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
      Definition of Ready checks, cross-provider review enforcement, zero-AI-slop gate results, and per-project SDLC configuration.
    </p>
  </div>

  <!-- Project SDLC Config -->
  <section class="rise-3d bg-white border rounded-2xl p-6 shadow-md" style="border-color: var(--color-border, #e2e8f0);">
    <h2 class="text-lg font-bold text-slate-900 mb-4">Project Configuration</h2>
    <div class="grid md:grid-cols-3 gap-4">
      <label class="block">
        <span class="block text-xs font-bold text-slate-600 mb-1.5">Project Path</span>
        <input
          type="text"
          bind:value={configPath}
          placeholder="/absolute/path/to/project"
          class="w-full px-3 py-2 rounded-xl border text-sm font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2"
          style="border-color: var(--color-border, #e2e8f0);"
        />
      </label>
      <label class="block">
        <span class="block text-xs font-bold text-slate-600 mb-1.5">DoR Mode</span>
        <select
          bind:value={dorMode}
          class="w-full px-3 py-2 rounded-xl border text-sm font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2"
          style="border-color: var(--color-border, #e2e8f0);"
        >
          <option value="advisory">Advisory</option>
          <option value="enforced">Enforced</option>
        </select>
      </label>
      <label class="block">
        <span class="block text-xs font-bold text-slate-600 mb-1.5">Review Mode</span>
        <select
          bind:value={reviewMode}
          class="w-full px-3 py-2 rounded-xl border text-sm font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2"
          style="border-color: var(--color-border, #e2e8f0);"
        >
          <option value="self">Self</option>
          <option value="cross-provider">Cross-Provider</option>
        </select>
      </label>
    </div>
    <div class="mt-4 flex items-center gap-3">
      <button
        class="btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
        style="background-color: var(--color-primary, #7c3aed);"
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
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-slate-700 bg-slate-100 border transition-all cursor-pointer hover:bg-slate-200 disabled:opacity-50"
        style="border-color: var(--color-border, #e2e8f0);"
        onclick={loadConfig}
        disabled={configLoading}
      >
        Reload
      </button>
    </div>
  </section>

  <!-- DoR Checker -->
  <section class="rise-3d bg-white border rounded-2xl p-6 shadow-md" style="border-color: var(--color-border, #e2e8f0);">
    <h2 class="text-lg font-bold text-slate-900 mb-2">Definition of Ready Check</h2>
    <p class="text-xs font-semibold text-slate-500 mb-4">
      Validate a task description before delegation — substance, placeholders, file references, and domain alignment.
    </p>
    <textarea
      bind:value={dorText}
      rows="3"
      placeholder="Describe the task: what to build, which files, and the target domain (UI, Backend, Docs, Security…)"
      class="w-full px-3 py-2 rounded-xl border text-sm font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 resize-y"
      style="border-color: var(--color-border, #e2e8f0);"
    ></textarea>
    <div class="mt-3">
      <button
        class="btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
        style="background-color: var(--color-primary, #7c3aed);"
        onclick={checkReadiness}
        disabled={dorChecking}
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
      <div class="mt-5 rounded-xl border p-4 space-y-3" style="border-color: var(--color-border, #e2e8f0); background-color: var(--color-primary-glow, #faf5ff);">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold border {dorResult.ready ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-rose-100 text-rose-700 border-rose-300'}">
            {dorResult.ready ? '✓ Ready' : '✗ Not Ready'}
          </span>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold border {confidenceClass(dorResult.confidence)}">
            Confidence: {dorResult.confidence || 'n/a'}
          </span>
        </div>
        {#if dorResult.missing && dorResult.missing.length > 0}
          <ul class="list-disc list-inside space-y-1 text-sm font-semibold text-slate-700">
            {#each dorResult.missing as reason (reason)}
              <li>{reason}</li>
            {/each}
          </ul>
        {:else if dorResult.ready}
          <p class="text-sm font-semibold text-emerald-700">Task passes all Definition of Ready criteria.</p>
        {/if}
      </div>
    {/if}
  </section>

  <!-- Tasks List -->
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-bold text-slate-900">Tasks ({tasks.length})</h2>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={projectFilter}
          placeholder="Filter by project path…"
          title="Leave empty to show tasks from every project"
          class="w-48 px-3 py-2 rounded-xl border text-xs font-bold text-slate-700 bg-slate-50 focus:outline-none"
          style="border-color: var(--color-border, #e2e8f0);"
          onkeydown={(e) => { if (e.key === 'Enter') loadTasks(); }}
          onblur={() => loadTasks()}
        />
        <select
          bind:value={statusFilter}
          onchange={loadTasks}
          class="px-3 py-2 rounded-xl border text-xs font-bold text-slate-700 bg-slate-50 focus:outline-none"
          style="border-color: var(--color-border, #e2e8f0);"
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
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs text-slate-700 bg-slate-100 border transition-all cursor-pointer hover:bg-slate-200 disabled:opacity-50"
          style="border-color: var(--color-border, #e2e8f0);"
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
      </div>
    </div>

    {#if tasksLoading && tasks.length === 0}
      <div class="rise-3d bg-white border rounded-2xl p-10 flex items-center justify-center" style="border-color: var(--color-border, #e2e8f0);">
        <svg class="animate-spin w-8 h-8" style="color: var(--color-primary, #7c3aed);" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
      </div>
    {:else if tasks.length === 0}
      <div class="rise-3d bg-white border rounded-2xl p-10 text-center" style="border-color: var(--color-border, #e2e8f0);">
        <p class="text-sm font-bold text-slate-500">No SDLC tasks found. Tasks are created via the <code class="px-1.5 py-0.5 rounded bg-slate-100 text-xs">konoha task create</code> CLI command.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each tasks as task (task.id)}
          <div class="rise-3d bg-white border rounded-2xl shadow-sm overflow-hidden transition-all" style="border-color: var(--color-border, #e2e8f0);">
            <button
              class="w-full text-left p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3 cursor-pointer hover:bg-slate-50 transition-colors"
              onclick={() => toggleExpand(task.id)}
            >
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <code class="text-xs font-bold text-slate-500">{task.id}</code>
                  <span class="px-2 py-0.5 rounded-full text-xs font-bold border {statusClass(task.status)}">{task.status}</span>
                  <span class="px-2 py-0.5 rounded-full text-xs font-bold border bg-slate-100 text-slate-600 border-slate-300">
                    review: {task.review_mode || 'self'}
                  </span>
                  {#if task.dor_result && task.dor_result.ready !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold border {task.dor_result.ready ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-rose-100 text-rose-700 border-rose-300'}">
                      DoR: {task.dor_result.ready ? 'ready' : 'not ready'}
                    </span>
                  {/if}
                  {#if task.slop_result && task.slop_result.pass !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold border {task.slop_result.pass ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-rose-100 text-rose-700 border-rose-300'}">
                      Slop: {task.slop_result.pass ? 'clean' : 'findings'}
                    </span>
                  {/if}
                  {#if task.slop_cycles > 0}
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold border bg-amber-100 text-amber-700 border-amber-300">
                      {task.slop_cycles} cycle{task.slop_cycles === 1 ? '' : 's'}
                    </span>
                  {/if}
                </div>
                <p class="text-sm font-semibold text-slate-800 break-words line-clamp-2">{task.description}</p>
              </div>
              <div class="flex flex-col items-end gap-1 shrink-0">
                <span class="text-xs font-semibold text-slate-400">{task.updated_at || ''}</span>
                <svg class="w-4 h-4 text-slate-400 transition-transform {expandedId === task.id ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {#if expandedId === task.id}
              <div class="border-t px-4 sm:px-5 py-4 space-y-4 bg-slate-50" style="border-color: var(--color-border, #e2e8f0);">
                {#if task.project_path}
                  <p class="text-xs font-bold text-slate-500">Project: <code class="text-slate-600">{task.project_path}</code></p>
                {/if}

                {#if task.dor_result && task.dor_result.missing && task.dor_result.missing.length > 0}
                  <div>
                    <h3 class="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">DoR Missing Criteria</h3>
                    <ul class="list-disc list-inside space-y-0.5 text-sm font-semibold text-slate-600">
                      {#each task.dor_result.missing as reason (reason)}
                        <li>{reason}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                {#if task.slop_result && Object.keys(task.slop_result).length > 0}
                  <div>
                    <h3 class="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Zero-AI-Slop Gate</h3>
                    <pre class="text-xs font-semibold text-slate-600 bg-white border rounded-xl p-3 overflow-x-auto" style="border-color: var(--color-border, #e2e8f0);">{JSON.stringify(task.slop_result, null, 2)}</pre>
                  </div>
                {/if}

                {#if task.evidence && Object.keys(task.evidence).length > 0}
                  <div>
                    <h3 class="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Evidence</h3>
                    <pre class="text-xs font-semibold text-slate-600 bg-white border rounded-xl p-3 overflow-x-auto" style="border-color: var(--color-border, #e2e8f0);">{JSON.stringify(task.evidence, null, 2)}</pre>
                  </div>
                {/if}

                {#if (!task.dor_result || Object.keys(task.dor_result).length === 0) && (!task.slop_result || Object.keys(task.slop_result).length === 0) && (!task.evidence || Object.keys(task.evidence).length === 0)}
                  <p class="text-xs font-semibold text-slate-400">No gate results or evidence recorded for this task yet.</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
