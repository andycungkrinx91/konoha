<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";

  let currentProject = $state(null);
  let projectMemories = $state([]);
  let allProjects = $state([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let contextSummary = $state("");

  async function loadContext() {
    loading = true;
    error = "";
    try {
      const [curRes, allRes] = await Promise.all([
        api.get("/api/v1/projects/current"),
        api.get("/api/v1/projects")
      ]);
      currentProject = curRes.profile || {};
      projectMemories = curRes.memories || [];
      contextSummary = currentProject.context_summary || "";
      allProjects = allRes.projects || [];
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function saveInvariants() {
    if (!currentProject?.project_path) {
      await sweetAlert.fire({
        title: "No Workspace Detected",
        text: "Cannot save invariants: the active workspace path was not detected by the Konoha core.",
        icon: "warning"
      });
      return;
    }
    saving = true;
    try {
      await api.post("/api/v1/projects", {
        projectPath: currentProject.project_path,
        contextSummary
      });
      await sweetAlert.fire({
        title: "Invariants Saved",
        text: "Project architectural invariants updated and synced to Konoha memory!",
        icon: "success"
      });
      await loadContext();
    } catch (err) {
      await sweetAlert.fire({
        title: "Save Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      saving = false;
    }
  }

  async function deleteProjectContext(hash) {
    const confirmed = await sweetAlert.confirm({
      title: "Remove Project?",
      text: "Are you sure you want to remove this project workspace profile?",
      icon: "warning",
      confirmText: "Remove",
      cancelText: "Keep"
    });
    if (!confirmed) return;

    try {
      await api.delete("/api/v1/projects/" + hash);
      await sweetAlert.fire({
        title: "Removed",
        text: "Project profile removed successfully.",
        icon: "success"
      });
      await loadContext();
    } catch (err) {
      await sweetAlert.fire({
        title: "Remove Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  onMount(loadContext);
</script>

<div class="space-y-8 max-w-7xl mx-auto">
  <!-- Hero Section with Light Glass Gradient & High Contrast Typography -->
  <div
    class="rise-3d relative overflow-hidden rounded-3xl p-8 border shadow-xl transition-all duration-300"
    style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.82) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Workspace Architecture & Tech Stack
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Project Context Memory
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Detected frameworks, styling engines, package managers, and permanent architectural invariants preserved across turns.
        </p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={loadContext}
          class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Refresh</span>
        </button>
      </div>
    </div>
  </div>

  {#if error}
    <div class="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold">
      Failed to load project context: {error}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16 text-slate-600 text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading workspace profile...</span>
      </div>
    </div>
  {:else}
    <!-- Active Workspace Overview Card -->
    <div class="glass-card-3d rounded-3xl p-6 lg:p-8 border space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-widest text-purple-700 bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-200">
            Active Workspace
          </span>
          <h3 class="text-xl font-black text-slate-900 mt-2">
            {currentProject?.project_name || "Current Workspace"}
          </h3>
          <p class="text-xs font-mono text-slate-600 mt-0.5">
            {currentProject?.project_path || "Path undetected"}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-bold">
            Framework: <span class="capitalize">{currentProject?.framework || "General"}</span>
          </div>
          <div class="px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold">
            Styling: <span>{currentProject?.styling || "CSS"}</span>
          </div>
          <div class="px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold">
            PM: <span>{currentProject?.package_manager || "pnpm"}</span>
          </div>
        </div>
      </div>

      <!-- Architectural Invariants & Rules Editor -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h4 class="text-sm font-extrabold text-slate-900">
              Architectural Invariants & Constraints
            </h4>
            <p class="text-xs font-semibold text-slate-600">
              Rules permanently remembered and injected to subagents for this workspace.
            </p>
          </div>

          <button
            type="button"
            onclick={saveInvariants}
            disabled={saving}
            class="btn-3d px-5 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
            style="background-color: var(--color-primary, #7c3aed);"
          >
            {saving ? "Saving..." : "Save Invariants"}
          </button>
        </div>

        <textarea
          bind:value={contextSummary}
          rows="5"
          placeholder="e.g. Always use port 1404; Pure light mode is first-class default; zero dark mode enforcement; use Tailwind v4; no hamburger in header on mobile dock..."
          class="w-full p-4 rounded-2xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white/90 focus:ring-2 focus:ring-purple-500 focus:outline-none leading-relaxed"
        ></textarea>
      </div>

      <!-- Persistent Learnings for Active Project -->
      {#if projectMemories && projectMemories.length > 0}
        <div class="pt-6 border-t border-slate-200 space-y-3">
          <h4 class="text-sm font-extrabold text-slate-900">
            Project-Scoped Learnings ({projectMemories.length})
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {#each projectMemories as pm}
              <div class="p-3.5 rounded-xl border border-slate-200 bg-white/80 space-y-1">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-extrabold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                    @{pm.agent_name}
                  </span>
                  <span class="text-[10px] font-bold text-slate-500 font-mono">
                    ID: {pm.id}
                  </span>
                </div>
                <p class="text-xs font-semibold text-slate-800 leading-normal">
                  {pm.content}
                </p>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- All Registered Projects List -->
    {#if allProjects && allProjects.length > 1}
      <div class="space-y-4 pt-4">
        <h3 class="text-lg font-black text-slate-900">
          All Registered Workspaces ({allProjects.length})
        </h3>
        <div class="scene-3d grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each allProjects as proj}
            <div class="glass-card-3d tilt-3d rounded-2xl p-5 border flex flex-col justify-between">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-900 truncate">
                    {proj.project_name}
                  </span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {proj.framework || "App"}
                  </span>
                </div>
                <p class="text-[11px] font-mono text-slate-600 truncate">
                  {proj.project_path}
                </p>
                {#if proj.context_summary}
                  <p class="text-xs font-semibold text-slate-700 line-clamp-2">
                    {proj.context_summary}
                  </p>
                {/if}
              </div>

              <div class="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px]">
                <span class="font-mono text-slate-500">Hash: {proj.project_hash}</span>
                <button
                  type="button"
                  onclick={() => deleteProjectContext(proj.project_hash)}
                  class="text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
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
