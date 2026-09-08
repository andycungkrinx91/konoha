<script>
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { sweetAlert } from "$lib/sweetAlert.svelte.js";

  let memories = $state([]);
  let loading = $state(true);
  let error = $state("");
  let selectedAgent = $state("");
  let searchQuery = $state("");
  let isCreateModalOpen = $state(false);

  let newMemory = $state({
    agentName: "jonin",
    title: "",
    content: "",
    memoryType: "rule",
    tags: "",
    importance: 1
  });

  const agents = [
    { id: "", name: "All Agents" },
    { id: "jonin", name: "@jonin" },
    { id: "anbu", name: "@anbu" },
    { id: "kage", name: "@kage" },
    { id: "chunin", name: "@chunin" },
    { id: "genin", name: "@genin" },
    { id: "sannin", name: "@sannin" },
    { id: "tokubetsu-jonin", name: "@tokubetsu-jonin" },
    { id: "global", name: "@global" }
  ];

  async function loadMemories() {
    loading = true;
    error = "";
    try {
      let url = "/api/v1/persona?";
      if (selectedAgent) url += `agent=${encodeURIComponent(selectedAgent)}&`;
      if (searchQuery.trim()) url += `search=${encodeURIComponent(searchQuery.trim())}&`;
      const res = await api.get(url);
      memories = res.memories || [];
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function createMemory() {
    if (!newMemory.content.trim()) {
      await sweetAlert.fire({
        title: "Validation Error",
        text: "Please provide memory content.",
        icon: "warning"
      });
      return;
    }
    try {
      await api.post("/api/v1/persona", newMemory);
      isCreateModalOpen = false;
      newMemory.title = "";
      newMemory.content = "";
      newMemory.tags = "";
      await sweetAlert.fire({
        title: "Memory Saved",
        text: "Persona memory added successfully!",
        icon: "success"
      });
      await loadMemories();
    } catch (err) {
      await sweetAlert.fire({
        title: "Save Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function deleteMemory(id) {
    const confirmed = await sweetAlert.confirm({
      title: "Delete Memory?",
      text: "Are you sure you want to permanently delete this persona memory item?",
      icon: "warning",
      confirmText: "Delete",
      cancelText: "Keep"
    });
    if (!confirmed) return;

    try {
      await api.delete("/api/v1/persona/" + id);
      await sweetAlert.fire({
        title: "Deleted",
        text: "Memory item removed successfully.",
        icon: "success"
      });
      await loadMemories();
    } catch (err) {
      await sweetAlert.fire({
        title: "Delete Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  onMount(loadMemories);
</script>

<div class="space-y-8 max-w-7xl mx-auto">
  <!-- Hero Section with Light Glass Gradient & High Contrast Typography -->
  <div
    class="relative overflow-hidden rounded-3xl p-8 border shadow-xl transition-all duration-300"
    style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.82) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Episodic Learning & Long-Term Recall
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Persona Memory
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Permanent episodic learnings, behavioral rules, and contextual memory auto-injected into Ninja subagents without token waste.
        </p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={() => { isCreateModalOpen = true; }}
          class="btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md cursor-pointer"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Memory</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Filter & Search Controls -->
  <div class="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
    <!-- Agent Filter Tabs -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
      {#each agents as ag}
        <button
          type="button"
          onclick={() => { selectedAgent = ag.id; loadMemories(); }}
          class="btn-3d px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap border"
          style={selectedAgent === ag.id ? "background-color: var(--color-primary); color: #ffffff; border-color: var(--color-primary);" : "background-color: var(--color-surface); color: var(--color-text-muted); border-color: var(--color-border);"}
        >
          {ag.name}
        </button>
      {/each}
    </div>

    <!-- Search Input -->
    <div class="relative w-full md:w-72">
      <input
        type="text"
        bind:value={searchQuery}
        onkeydown={(e) => { if (e.key === "Enter") loadMemories(); }}
        placeholder="Search memories..."
        class="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold text-slate-900 border transition-all focus:outline-none focus:ring-2"
        style="background-color: var(--color-surface); border-color: var(--color-border); color: #0f172a;"
      />
      <svg class="w-4 h-4 absolute left-3 top-2.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  </div>

  <!-- Error State -->
  {#if error}
    <div class="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold">
      Failed to load memories: {error}
    </div>
  {/if}

  <!-- Loading State -->
  {#if loading}
    <div class="flex items-center justify-center py-16 text-slate-600 text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading persona memories...</span>
      </div>
    </div>
  {:else if memories.length === 0}
    <div class="p-12 text-center rounded-3xl border border-dashed border-slate-300 bg-white/60">
      <p class="text-sm font-bold text-slate-800">No persona memories found.</p>
      <p class="text-xs font-semibold text-slate-600 mt-1">Use the "Add Memory" button to save rules or learnings.</p>
    </div>
  {:else}
    <!-- Grid of Memories with 3D Glass Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      {#each memories as m}
        <div class="glass-card-3d rounded-2xl p-5 border flex flex-col justify-between">
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-md text-[11px] font-bold border bg-purple-50 text-purple-700 border-purple-200">
                  @{m.agent_name}
                </span>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase border bg-slate-100 text-slate-800 border-slate-200">
                  {m.memory_type || "RULE"}
                </span>
              </div>
              <button
                type="button"
                onclick={() => deleteMemory(m.id)}
                class="btn-3d p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer"
                title="Delete memory"
                aria-label="Delete memory"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {#if m.title}
              <h4 class="text-sm font-extrabold text-slate-900 tracking-tight">
                {m.title}
              </h4>
            {/if}

            <p class="text-xs font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
              {m.content}
            </p>
          </div>

          <div class="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] font-semibold text-slate-600">
            <span>ID: {m.id}</span>
            {#if m.tags}
              <span class="text-slate-500 font-mono">Tags: {m.tags}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Add Memory 3D Glass Modal -->
{#if isCreateModalOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
    <div
      class="relative w-full max-w-lg rounded-3xl p-6 sm:p-8 border shadow-2xl space-y-6"
      style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.92) 100%); border-color: rgba(226, 232, 240, 0.95); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.18);"
    >
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-black text-slate-900">Add Persona Memory</h3>
        <button
          type="button"
          onclick={() => { isCreateModalOpen = false; }}
          class="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="agent-select" class="block text-xs font-bold text-slate-800 mb-1">Target Agent</label>
            <select
              id="agent-select"
              bind:value={newMemory.agentName}
              class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
            >
              <option value="jonin">@jonin (UI & Frontend)</option>
              <option value="anbu">@anbu (Backend & DevOps)</option>
              <option value="kage">@kage (Architecture & Audit)</option>
              <option value="chunin">@chunin (Research)</option>
              <option value="genin">@genin (Code Review)</option>
              <option value="sannin">@sannin (Router)</option>
              <option value="tokubetsu-jonin">@tokubetsu-jonin (Docs)</option>
              <option value="global">@global (All Agents)</option>
            </select>
          </div>

          <div>
            <label for="memory-type-select" class="block text-xs font-bold text-slate-800 mb-1">Memory Type</label>
            <select
              id="memory-type-select"
              bind:value={newMemory.memoryType}
              class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
            >
              <option value="rule">Rule (Strict Mandate)</option>
              <option value="episodic">Episodic (Learning / Incident)</option>
              <option value="fact">Fact (System Knowledge)</option>
              <option value="preference">Preference (User Style)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="memory-title-input" class="block text-xs font-bold text-slate-800 mb-1">Title (Optional)</label>
          <input
            id="memory-title-input"
            type="text"
            bind:value={newMemory.title}
            placeholder="e.g. Always enforce Pure Light mode"
            class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div>
          <label for="memory-content-input" class="block text-xs font-bold text-slate-800 mb-1">Memory Content</label>
          <textarea
            id="memory-content-input"
            bind:value={newMemory.content}
            rows="4"
            placeholder="Specific instruction, rule, pattern, or constraint to permanently remember..."
            class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
          ></textarea>
        </div>

        <div>
          <label for="memory-tags-input" class="block text-xs font-bold text-slate-800 mb-1">Tags (Comma-separated)</label>
          <input
            id="memory-tags-input"
            type="text"
            bind:value={newMemory.tags}
            placeholder="ui, theme, accessibility"
            class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
        <button
          type="button"
          onclick={() => { isCreateModalOpen = false; }}
          class="btn-3d px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={createMemory}
          class="btn-3d px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          Save Memory
        </button>
      </div>
    </div>
  </div>
{/if}
