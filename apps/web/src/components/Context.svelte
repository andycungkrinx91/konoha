<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { confirm } from "#lib/state/dialog.svelte.ts";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
  import PageHero from "./PageHero.svelte";

  let currentProject = $state(null);
  let projectMemories = $state([]);
  let allProjects = $state([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let contextSummary = $state("");
  let selectedWorkspacePath = $state("");

  // Add Learning Modal state
  let isAddLearningOpen = $state(false);
  let newLearning = $state({
    agentName: "jonin",
    content: "",
    memoryType: "rule"
  });

  useScrollLock(() => isAddLearningOpen);

  function handleModalKeydown(e) {
    if (e.key === "Escape" && isAddLearningOpen) {
      isAddLearningOpen = false;
    }
  }

  const agentOptions = [
    { id: "jonin", name: "@jonin (UI & Frontend)" },
    { id: "anbu", name: "@anbu (Backend & DevOps)" },
    { id: "kage", name: "@kage (Architecture & Audit)" },
    { id: "chunin", name: "@chunin (Research & Intel)" },
    { id: "genin", name: "@genin (Code Review & Tracing)" },
    { id: "sannin", name: "@sannin (Workflow Router)" },
    { id: "tokubetsu-jonin", name: "@tokubetsu-jonin (Docs & Scribe)" },
    { id: "akatsuki", name: "@akatsuki (Red-Team, Blue-Team & Gate)" },
    { id: "global", name: "@global (All Agents)" }
  ];

  async function loadContext(targetPath = null) {
    loading = true;
    error = "";
    try {
      const pathParam = targetPath || selectedWorkspacePath;
      const curUrl = pathParam ? `/api/v1/projects/current?path=${encodeURIComponent(pathParam)}` : "/api/v1/projects/current";
      const [curRes, allRes] = await Promise.all([
        api.get(curUrl),
        api.get("/api/v1/projects")
      ]);
      currentProject = curRes.profile || {};
      projectMemories = curRes.memories || [];
      contextSummary = currentProject.context_summary || "";
      allProjects = allRes.projects || [];
      if (currentProject.project_path) {
        selectedWorkspacePath = currentProject.project_path;
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function switchWorkspace(wsPath) {
    if (!wsPath) return;
    selectedWorkspacePath = wsPath;
    await loadContext(wsPath);
  }

  async function saveInvariants() {
    if (!currentProject?.project_path) {
      toast.warning("Cannot save invariants: no active workspace path detected.");
      return;
    }
    saving = true;
    try {
      await api.post("/api/v1/projects", {
        projectPath: currentProject.project_path,
        contextSummary
      });
      toast.success("Project architectural invariants updated and synced to Konoha memory!");
      await loadContext();
    } catch (err) {
      toast.error("Save failed: " + err.message);
    } finally {
      saving = false;
    }
  }

  async function clearInvariants() {
    const confirmed = await confirm({
      title: "Clear Invariants?",
      message: "Are you sure you want to clear the architectural invariants saved for this workspace?",
      confirmText: "Clear Invariants",
      variant: "danger"
    });
    if (!confirmed) return;

    saving = true;
    try {
      const hash = currentProject?.project_hash || "current";
      await api.post(`/api/v1/projects/${hash}/prune`, { clearInvariants: true });
      contextSummary = "";
      toast.success("Architectural invariants have been cleared for this workspace.");
      await loadContext();
    } catch (err) {
      toast.error("Clear failed: " + err.message);
    } finally {
      saving = false;
    }
  }

  async function deleteProjectContext(hash) {
    const confirmed = await confirm({
      title: "Remove Project?",
      message: "Are you sure you want to remove this project workspace profile?",
      confirmText: "Remove",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      await api.delete("/api/v1/projects/" + hash);
      toast.success("Project profile removed successfully.");
      await loadContext();
    } catch (err) {
      toast.error("Remove failed: " + err.message);
    }
  }

  async function deleteProjectMemory(memId) {
    const confirmed = await confirm({
      title: "Delete Learning?",
      message: `Are you sure you want to delete this memory item (ID: ${memId})?`,
      confirmText: "Delete",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      const hash = currentProject?.project_hash || "current";
      await api.delete(`/api/v1/projects/${hash}/memories/${memId}`);
      toast.success("Project memory item removed successfully.");
      await loadContext();
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  }

  async function createProjectLearning() {
    if (!newLearning.content.trim()) {
      toast.warning("Please enter the learning or rule content to record.");
      return;
    }

    try {
      const projPath = currentProject?.project_path || process?.cwd?.() || ".";
      await api.post("/api/v1/persona", {
        agentName: newLearning.agentName || "global",
        content: newLearning.content.trim(),
        title: "Project Learning",
        memoryType: newLearning.memoryType || "rule",
        projectPath: projPath,
        importance: 1
      });
      isAddLearningOpen = false;
      newLearning = { agentName: "jonin", content: "", memoryType: "rule" };
      toast.success("Project-scoped learning recorded successfully.");
      await loadContext();
    } catch (err) {
      toast.error("Failed to add learning: " + err.message);
    }
  }

  async function pruneLearnings() {
    if (!projectMemories || projectMemories.length === 0) {
      toast.info("There are currently 0 episodic learnings recorded for this workspace.");
      return;
    }

    const confirmed = await confirm({
      title: "Prune All Learnings?",
      message: `Remove all ${projectMemories.length} episodic learning(s) recorded for this workspace?`,
      confirmText: "Prune Learnings",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      const hash = currentProject?.project_hash || "current";
      const res = await api.post(`/api/v1/projects/${hash}/prune`, {});
      toast.success(`Successfully pruned ${res.deleted || 0} episodic learning(s).`);
      await loadContext();
    } catch (err) {
      toast.error("Prune failed: " + err.message);
    }
  }

  async function pruneAllWorkspaces() {
    if (!allProjects || allProjects.length === 0) {
      toast.info("There are no registered workspaces to prune.");
      return;
    }

    const count = allProjects.length;
    const confirmed = await confirm({
      title: "Prune All Workspaces?",
      message: `Are you sure you want to prune all ${count} registered workspace profile(s)? This will wipe all workspace records from the registry.`,
      confirmText: "Prune All Workspaces",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      const res = await api.delete("/api/v1/projects", { confirm: true });
      allProjects = [];
      toast.success(`Successfully pruned ${res.deleted || count} registered workspace(s).`);
      await loadContext();
    } catch (err) {
      toast.error("Prune failed: " + err.message);
    }
  }

  async function pruneProjectContext() {
    const wsCount = allProjects ? allProjects.length : 0;
    const countText = wsCount > 0 ? `all ${wsCount} registered workspace(s)` : "all context memory";

    const confirmed = await confirm({
      title: "Prune Context & Workspaces?",
      message: `Are you sure you want to prune ${countText}, clear architectural invariants, and remove episodic learnings?`,
      confirmText: "Prune Context",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      const resProjects = await api.delete("/api/v1/projects", { confirm: true });
      const hash = currentProject?.project_hash || "current";
      await api.post(`/api/v1/projects/${hash}/prune`, { clearInvariants: true });
      contextSummary = "";
      allProjects = [];
      projectMemories = [];
      toast.success(`Successfully pruned ${resProjects.deleted || wsCount} workspace profile(s) and cleared context memory.`);
      await loadContext();
    } catch (err) {
      toast.error("Prune failed: " + err.message);
    }
  }

  onMount(loadContext);
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  {/snippet}

  {#snippet heroActions()}
    <button
      type="button"
      onclick={pruneProjectContext}
      class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] font-bold text-xs badge-status badge-status-danger hover:bg-status-danger-soft transition-all cursor-pointer shadow-sm"
      title="Prune all episodic learnings for this project"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span>Prune Context</span>
    </button>

    <button
      type="button"
      onclick={loadContext}
      class="btn-3d btn-3d-secondary inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] font-bold text-xs transition-all shadow-sm cursor-pointer"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span>Refresh</span>
    </button>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Project Context Memory"
    badgeText="Workspace Architecture & Tech Stack"
    badgeIcon={heroBadgeIcon}
    description="Detected frameworks, styling engines, package managers, and permanent architectural invariants preserved across turns."
    actions={heroActions}
  />

  {#if error}
    <div class="p-4 rounded-2xl border badge-status badge-status-danger text-xs font-semibold">
      Failed to load project context: {error}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16 theme-text-secondary text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-action-primary" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading workspace profile...</span>
      </div>
    </div>
  {:else}
    <!-- Active Workspace Overview Card -->
    <div class="glass-card-3d rounded-3xl p-6 lg:p-8 border space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b theme-border">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-widest badge-status badge-status-info">
            Active Workspace
          </span>
          <h3 class="text-xl font-black theme-text mt-2">
            {currentProject?.project_name || "Current Workspace"}
          </h3>
          <p class="text-xs font-mono theme-text-secondary mt-0.5">
            {currentProject?.project_path || "Path undetected"}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="px-3 py-1.5 rounded-xl border badge-status badge-status-info text-xs font-bold">
            Framework: <span class="capitalize">{currentProject?.framework || "General"}</span>
          </div>
          <div class="px-3 py-1.5 rounded-xl border badge-status badge-status-success text-xs font-bold">
            Styling: <span>{currentProject?.styling || "CSS"}</span>
          </div>
          <div class="px-3 py-1.5 rounded-xl border badge-status badge-status-warning text-xs font-bold">
            PM: <span>{currentProject?.package_manager || "pnpm"}</span>
          </div>
        </div>
      </div>

      <!-- Architectural Invariants & Rules Editor -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h4 class="text-sm font-extrabold theme-text">
              Architectural Invariants & Constraints
            </h4>
            <p class="text-xs font-semibold theme-text-secondary">
              Rules permanently remembered and injected to subagents for this workspace.
            </p>
          </div>

          <div class="flex items-center gap-2">
            {#if contextSummary && contextSummary.trim().length > 0}
              <button
                type="button"
                onclick={clearInvariants}
                disabled={saving}
                class="btn-3d px-3.5 py-2 rounded-xl text-xs font-bold badge-status badge-status-danger hover:bg-status-danger-soft transition-all cursor-pointer shadow-sm disabled:opacity-50"
                title="Clear architectural invariants for this workspace"
              >
                Clear Invariants
              </button>
            {/if}

            <button
              type="button"
              onclick={saveInvariants}
              disabled={saving}
              class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Invariants"}
            </button>
          </div>
        </div>

        <textarea
          bind:value={contextSummary}
          rows="5"
          placeholder="e.g. Always use port 1404; Pure light mode is first-class default; zero dark mode enforcement; use Tailwind v4; no hamburger in header on mobile dock..."
          class="w-full p-4 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect leading-relaxed"
        ></textarea>
      </div>

      <!-- Persistent Learnings for Active Project -->
      <div class="pt-6 border-t theme-border space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 class="text-sm font-extrabold theme-text">
              Project-Scoped Learnings ({projectMemories ? projectMemories.length : 0})
            </h4>
            <p class="text-xs font-semibold theme-text-secondary">
              Episodic memories & rules preserved specifically for this workspace context.
            </p>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onclick={() => { isAddLearningOpen = true; }}
              class="btn-3d btn-3d-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-sm"
              title="Add episodic learning for this project"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
              </svg>
              <span>Add Learning</span>
            </button>

            <button
              type="button"
              onclick={pruneLearnings}
              class="btn-3d inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold badge-status badge-status-danger hover:bg-status-danger-soft transition-all cursor-pointer shadow-sm"
              title="Prune all episodic learnings for this project"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Prune Learnings</span>
            </button>
          </div>
        </div>

        {#if projectMemories && projectMemories.length > 0}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {#each projectMemories as pm}
              <div class="p-3.5 rounded-xl border theme-border theme-bg-surface space-y-2 flex flex-col justify-between">
                <div class="space-y-1">
                  <div class="flex items-center justify-between">
                    <span class="text-[10px] font-extrabold badge-status badge-status-info">
                      @{pm.agent_name}
                    </span>
                    <span class="text-[10px] font-bold theme-text-muted font-mono">
                      ID: {pm.id}
                    </span>
                  </div>
                  <p class="text-xs font-semibold theme-text leading-normal">
                    {pm.content}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-2 border-t theme-border-subtle text-[11px]">
                  <span class="text-[10px] theme-text-muted font-mono uppercase">
                    {pm.memory_type || 'rule'}
                  </span>
                  <button
                    type="button"
                    onclick={() => deleteProjectMemory(pm.id)}
                    class="text-[var(--theme-danger)] hover:text-status-danger font-bold cursor-pointer inline-flex items-center gap-1 transition-colors"
                    title="Delete this memory item"
                  >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="p-4 rounded-xl border border-dashed theme-border-strong-b theme-bg-muted text-center">
            <p class="text-xs font-bold theme-text-muted">No episodic learnings saved for this project yet.</p>
            <p class="text-[11px] theme-text-muted mt-0.5">Verified learnings auto-persist here during subagent delegations and auto-compact across turns.</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- All Registered Projects List -->
    {#if allProjects && allProjects.length > 0}
      <div class="space-y-4 pt-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 class="text-lg font-black theme-text">
              All Registered Workspaces ({allProjects.length})
            </h3>
            <p class="text-xs font-semibold theme-text-secondary">
              Registered workspace profiles and their cached contexts.
            </p>
          </div>

          <button
            type="button"
            onclick={pruneAllWorkspaces}
            class="btn-3d self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold badge-status badge-status-danger hover:bg-status-danger-soft transition-all cursor-pointer shadow-sm"
            title="Prune all registered workspace profiles"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Prune All Workspaces</span>
          </button>
        </div>

        <div class="scene-3d grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each allProjects as proj}
            <div class="glass-card-3d tilt-3d rounded-2xl p-5 border flex flex-col justify-between">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold theme-text truncate">
                    {proj.project_name}
                  </span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded theme-bg-subtle theme-text-secondary border theme-border">
                    {proj.framework || "App"}
                  </span>
                </div>
                <p class="text-[11px] font-mono theme-text-secondary truncate">
                  {proj.project_path}
                </p>
                {#if proj.context_summary}
                  <p class="text-xs font-semibold theme-text-secondary line-clamp-2">
                    {proj.context_summary}
                  </p>
                {/if}
              </div>

              <div class="mt-4 pt-3 border-t theme-border flex items-center justify-between text-[11px]">
                <div class="flex items-center gap-2">
                  {#if (currentProject?.project_hash === proj.project_hash) || (currentProject?.project_path === proj.project_path)}
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold badge-status badge-status-info">
                      Active
                    </span>
                  {:else}
                    <button
                      type="button"
                      onclick={() => switchWorkspace(proj.project_path)}
                      class="text-action-primary hover:text-action-primary font-bold cursor-pointer underline"
                    >
                      Switch
                    </button>
                  {/if}
                  <span class="font-mono theme-text-muted">Hash: {proj.project_hash}</span>
                </div>
                <button
                  type="button"
                  onclick={() => deleteProjectContext(proj.project_hash)}
                  class="text-[var(--theme-danger)] hover:text-status-danger font-bold cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if isAddLearningOpen}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md animate-in fade-in duration-200">
    <div
      class="rise-3d relative w-full max-w-lg overflow-hidden rounded-3xl border theme-border theme-bg-surface p-6 shadow-2xl backdrop-blur-xl"
      style="box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center justify-between pb-4 border-b theme-border">
        <div>
          <h3 class="text-lg font-black theme-text">Add Project-Scoped Learning</h3>
          <p class="text-xs font-semibold theme-text-muted">Record an episodic rule or constraint specifically for this workspace.</p>
        </div>
        <button
          type="button"
          onclick={() => { isAddLearningOpen = false; }}
          aria-label="Close modal"
          title="Close modal"
          class="p-1 rounded-xl theme-text-muted theme-text-secondary hover-bg-subtle transition-all cursor-pointer"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 pt-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="learning-agent-select" class="block text-xs font-bold theme-text mb-1">Target Agent</label>
            <select
              id="learning-agent-select"
              bind:value={newLearning.agentName}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              {#each agentOptions as ag}
                <option value={ag.id}>{ag.name}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="learning-type-select" class="block text-xs font-bold theme-text mb-1">Memory Type</label>
            <select
              id="learning-type-select"
              bind:value={newLearning.memoryType}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              <option value="rule">Rule (Strict Mandate)</option>
              <option value="episodic">Episodic (Learning / Incident)</option>
              <option value="fact">Fact (Knowledge)</option>
              <option value="preference">Preference (Style)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="learning-content-input" class="block text-xs font-bold theme-text mb-1">Learning Content</label>
          <textarea
            id="learning-content-input"
            bind:value={newLearning.content}
            rows="4"
            placeholder="e.g. Always use port 1404; Pure light mode is first-class default; use Tailwind v4 grid tokens..."
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          ></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4 border-t theme-border mt-4">
        <button
          type="button"
          onclick={() => { isAddLearningOpen = false; }}
          class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={createProjectLearning}
          class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md cursor-pointer"
        >
          Save Learning
        </button>
      </div>
    </div>
  </div>
{/if}
