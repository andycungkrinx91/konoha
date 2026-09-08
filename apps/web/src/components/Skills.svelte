<script>
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { sweetAlert } from "$lib/sweetAlert.svelte.js";
  import { uiState } from "$lib/state/uiState.svelte.js";

  let skills = $state([]);
  let searchQuery = $state("");
  let loading = $state(true);
  let error = $state("");
  let selectedSkill = $state(null);
  let skillDetailLoading = $state(false);

  // Modal states
  let isCreateModalOpen = $state(false);
  let isSubmitting = $state(false);
  let selectedAgentToEmbed = $state("anbu");

  const agentsList = [
    { id: "anbu", name: "@anbu (DevOps & Backend)" },
    { id: "jonin", name: "@jonin (Frontend & UI)" },
    { id: "kage", name: "@kage (Architecture & Audit)" },
    { id: "chunin", name: "@chunin (Research & Web)" },
    { id: "genin", name: "@genin (Code Exploration)" },
    { id: "sannin", name: "@sannin (Router & Planner)" },
    { id: "tokubetsu-jonin", name: "@tokubetsu-jonin (Technical Writer)" }
  ];

  let newSkill = $state({
    name: "",
    description: "",
    tags: "",
    embed_agent: "",
    content: "# Standard Operating Procedures\n\n## Overview\nDescribe the purpose of this skill.\n\n## Instructions\n1. Step one\n2. Step two\n"
  });

  async function loadSkills() {
    loading = true;
    error = "";
    try {
      const url = searchQuery.trim()
        ? "/api/v1/skills?q=" + encodeURIComponent(searchQuery.trim())
        : "/api/v1/skills?limit=250";
      skills = await api.get(url);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function openSkill(name) {
    skillDetailLoading = true;
    try {
      selectedSkill = await api.get("/api/v1/skills/" + encodeURIComponent(name));
    } catch (err) {
      await sweetAlert.fire({
        title: "Load Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      skillDetailLoading = false;
    }
  }

  function resetNewSkill() {
    newSkill = {
      name: "",
      description: "",
      tags: "",
      embed_agent: "",
      content: "# Standard Operating Procedures\n\n## Overview\nDescribe the purpose of this skill.\n\n## Instructions\n1. Step one\n2. Step two\n"
    };
  }

  async function createSkillSubmit() {
    const slug = newSkill.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) {
      await sweetAlert.fire({
        title: "Validation Error",
        text: "Please provide a skill name (e.g. helm-chart-scaffolding).",
        icon: "warning"
      });
      return;
    }
    if (!newSkill.description.trim()) {
      await sweetAlert.fire({
        title: "Validation Error",
        text: "Please provide a short description for the skill.",
        icon: "warning"
      });
      return;
    }

    isSubmitting = true;
    try {
      const payload = {
        ...newSkill,
        name: slug
      };
      const res = await api.post("/api/v1/skills", payload);
      isCreateModalOpen = false;
      resetNewSkill();
      await sweetAlert.fire({
        title: "Skill Created!",
        text: `Skill "${res.name}" successfully created and indexed into SQLite FTS5${res.embedded_in ? ` (embedded into @${res.embedded_in})` : ''}.`,
        icon: "success"
      });
      uiState.addNotification(`Created skill "${slug}"`, "success");
      await loadSkills();
      await openSkill(slug);
    } catch (err) {
      await sweetAlert.fire({
        title: "Creation Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      isSubmitting = false;
    }
  }

  async function embedSkillInAgent(skillName, agentName) {
    try {
      await api.post(`/api/v1/skills/${encodeURIComponent(skillName)}/embed`, { agent: agentName });
      uiState.addNotification(`Embedded "${skillName}" into @${agentName}`, "success");
      await sweetAlert.fire({
        title: "Skill Embedded",
        text: `Skill "${skillName}" is now active for subagent @${agentName}.`,
        icon: "success"
      });
    } catch (err) {
      await sweetAlert.fire({
        title: "Embed Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function unembedSkillFromAgent(skillName, agentName) {
    try {
      await api.post(`/api/v1/skills/${encodeURIComponent(skillName)}/unembed`, { agent: agentName });
      uiState.addNotification(`Removed "${skillName}" from @${agentName}`, "info");
      await sweetAlert.fire({
        title: "Skill Removed",
        text: `Skill "${skillName}" removed from @${agentName}.`,
        icon: "info"
      });
    } catch (err) {
      await sweetAlert.fire({
        title: "Unembed Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function deleteSkill(skillName) {
    const confirmed = await sweetAlert.fire({
      title: `Delete Skill "${skillName}"?`,
      text: "This will remove the skill file from your village and delete its SQLite FTS5 chunk index.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Delete It",
      cancelButtonText: "Cancel"
    });
    if (!confirmed.isConfirmed) return;

    try {
      await api.delete(`/api/v1/skills/${encodeURIComponent(skillName)}`);
      selectedSkill = null;
      uiState.addNotification(`Deleted skill "${skillName}"`, "success");
      await sweetAlert.fire({
        title: "Deleted",
        text: `Skill "${skillName}" has been removed.`,
        icon: "success"
      });
      await loadSkills();
    } catch (err) {
      await sweetAlert.fire({
        title: "Delete Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function reindexAllSkills() {
    try {
      uiState.addNotification("Re-indexing skills database...", "info");
      const res = await api.post("/api/v1/skills/reindex", {});
      await sweetAlert.fire({
        title: "Migration Complete",
        text: "SQLite FTS5 database successfully re-indexed all skills.",
        icon: "success"
      });
      await loadSkills();
    } catch (err) {
      await sweetAlert.fire({
        title: "Reindex Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  let debounceTimer;
  function handleSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadSkills();
    }, 200);
  }

  onMount(loadSkills);
</script>

<div class="space-y-6 max-w-7xl mx-auto">
  <!-- Hero Section -->
  <div
    class="relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm transition-all"
    style="background: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
          <span>FTS5 Skill Knowledge Base</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-black tracking-tight" style="color: var(--color-text);">
          Ninja Skill Registry
        </h1>
        <p class="text-xs sm:text-sm max-w-2xl" style="color: var(--color-text-muted);">
          Inspect, create, and embed structured agent SOPs, frameworks, and reference skills into your subagents. 100% synchronized with CLI commands.
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={() => isCreateModalOpen = true}
          class="px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all hover:scale-[1.02] shadow-md cursor-pointer text-white"
          style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span>Create New Skill</span>
        </button>

        <button
          type="button"
          onclick={reindexAllSkills}
          class="px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-sm cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          title="Run konoha migrate to re-index all skills"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Re-index Skills</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Search and Filter Bar -->
  <div class="p-4 rounded-2xl border shadow-sm flex flex-col sm:flex-row items-center gap-4" style="background: var(--color-surface); border-color: var(--color-border);">
    <div class="relative flex-1 w-full">
      <svg class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        bind:value={searchQuery}
        oninput={handleSearchInput}
        placeholder="Search skills by name, tag, or topic (e.g. helm, cybersecurity, sveltekit, test)..."
        class="w-full pl-10 pr-4 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 font-medium"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => { searchQuery = ''; loadSkills(); }}
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100"
          style="color: var(--color-text-muted);"
        >
          ✕
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <span class="text-xs font-bold" style="color: var(--color-text-muted);">
        {skills.length} skills indexed
      </span>
    </div>
  </div>

  <!-- Main Content Grid -->
  {#if loading}
    <div class="p-12 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="inline-block animate-spin w-8 h-8 rounded-full border-4 border-t-transparent mb-3" style="border-color: var(--color-primary); border-top-color: transparent;"></div>
      <p class="text-xs font-semibold" style="color: var(--color-text-muted);">Loading skills from SQLite FTS5 registry...</p>
    </div>
  {:else if error}
    <div class="p-6 rounded-3xl border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200 text-xs font-bold">
      Failed to load skills: {error}
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Skills List Column -->
      <div class="lg:col-span-1 space-y-2 max-h-[75vh] overflow-y-auto pr-1">
        {#each skills as s (s.name)}
          {@const isSelected = selectedSkill && selectedSkill.name === s.name}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            onclick={() => openSkill(s.name)}
            class="p-4 rounded-2xl border text-left transition-all duration-150 cursor-pointer shadow-sm hover:scale-[1.01]"
            style="{isSelected
              ? 'border-color: var(--color-primary); background-color: var(--color-primary-glow); box-shadow: 0 0 0 1px var(--color-primary);'
              : 'border-color: var(--color-border); background-color: var(--color-surface);'}"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-black truncate" style="color: var(--color-text);">{s.name}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold shrink-0 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                {s.type || 'skill'}
              </span>
            </div>

            {#if s.tags}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each String(s.tags).split(',').slice(0, 3) as tag}
                  <span class="text-[10px] px-2 py-0.5 rounded-md border font-medium truncate max-w-[120px]" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
                    {tag.trim()}
                  </span>
                {/each}
              </div>
            {/if}

            <div class="flex items-center justify-between text-[10px] font-mono mt-3 pt-2 border-t" style="border-color: var(--color-border); color: var(--color-text-muted);">
              <span>{Math.round(s.byte_size / 1024)} KB</span>
              <span>{s.line_count || 0} lines</span>
            </div>
          </div>
        {/each}
      </div>

      <!-- Skill Detail Column -->
      <div class="lg:col-span-2">
        {#if skillDetailLoading}
          <div class="p-12 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
            <div class="inline-block animate-spin w-8 h-8 rounded-full border-4 border-t-transparent mb-3" style="border-color: var(--color-primary); border-top-color: transparent;"></div>
            <p class="text-xs font-semibold" style="color: var(--color-text-muted);">Fetching skill content...</p>
          </div>
        {:else if selectedSkill}
          <div class="p-6 rounded-3xl border shadow-sm space-y-6" style="background: var(--color-surface); border-color: var(--color-border);">
            <!-- Detail Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style="border-color: var(--color-border);">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-xl font-bold" style="color: var(--color-text);">{selectedSkill.name}</h2>
                  <span class="text-xs px-2.5 py-0.5 rounded-full border font-bold uppercase" style="background: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
                    {selectedSkill.type || 'skill'}
                  </span>
                </div>
                <p class="text-[11px] font-mono mt-1" style="color: var(--color-text-muted);">
                  Path: {selectedSkill.file_path || 'Embedded in SQLite database'}
                </p>
              </div>

              <!-- Quick Action Buttons -->
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onclick={() => deleteSkill(selectedSkill.name)}
                  class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all text-rose-700 dark:text-rose-300 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Delete Skill</span>
                </button>
              </div>
            </div>

            <!-- Embed Into Agent Controller -->
            <div class="p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4" style="background: var(--color-surface-hover); border-color: var(--color-border);">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span class="text-xs font-bold" style="color: var(--color-text);">Embed / Unembed for Ninja Subagent:</span>
              </div>

              <div class="flex items-center gap-2 w-full sm:w-auto">
                <select
                  bind:value={selectedAgentToEmbed}
                  class="px-3 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none"
                  style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                >
                  {#each agentsList as ag}
                    <option value={ag.id}>{ag.name}</option>
                  {/each}
                </select>

                <button
                  type="button"
                  onclick={() => embedSkillInAgent(selectedSkill.name, selectedAgentToEmbed)}
                  class="px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-105 cursor-pointer text-emerald-800 dark:text-emerald-200 border-emerald-500/30 bg-emerald-500/15"
                >
                  Embed
                </button>

                <button
                  type="button"
                  onclick={() => unembedSkillFromAgent(selectedSkill.name, selectedAgentToEmbed)}
                  class="px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-105 cursor-pointer text-slate-700 dark:text-slate-300 border-slate-500/30 bg-slate-500/10"
                >
                  Unembed
                </button>
              </div>
            </div>

            <!-- Tags -->
            {#if selectedSkill.tags}
              <div>
                <span class="text-[11px] font-bold uppercase tracking-wider block mb-2" style="color: var(--color-text-muted);">Indexed Keywords & Tags:</span>
                <div class="flex flex-wrap gap-1.5">
                  {#each String(selectedSkill.tags).split(',') as tag}
                    <span class="px-2.5 py-1 rounded-lg border text-xs font-medium" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);">
                      {tag.trim()}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Markdown Content Viewer -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Skill Instructions / Manual:</span>
                <span class="text-[11px] font-mono" style="color: var(--color-text-muted);">{selectedSkill.line_count || 0} lines ({selectedSkill.byte_size || 0} bytes)</span>
              </div>
              <pre
                class="p-5 rounded-2xl border text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[50vh] overflow-y-auto leading-relaxed"
                style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);"
              >{selectedSkill.content}</pre>
            </div>
          </div>
        {:else}
          <div class="p-16 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
            <div class="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 class="text-sm font-bold" style="color: var(--color-text);">Select a skill to inspect</h3>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Select any skill from the left list to view SOP instructions or embed it into agents.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Create New Skill Modal (Full Screen Overlay Popup) -->
{#if isCreateModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={() => isCreateModalOpen = false}
  >
    <div
      class="w-full max-w-2xl p-6 rounded-3xl border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
      style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text); box-shadow: var(--shadow-3d);"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Create New Ninja Skill</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Define rules, instructions, and SOPs for subagents</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => isCreateModalOpen = false}
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
        >
          ✕
        </button>
      </div>

      <!-- Form Inputs -->
      <div class="space-y-3.5">
        <div>
          <label for="skill-name" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Skill Name (slug)</label>
          <input
            id="skill-name"
            type="text"
            bind:value={newSkill.name}
            placeholder="e.g. docker-compose-scaffolding, redis-caching-skill"
            class="w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 font-mono"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="skill-desc" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Description (short summary)</label>
          <input
            id="skill-desc"
            type="text"
            bind:value={newSkill.description}
            placeholder="Standard Operating Procedures for scaffolding docker-compose clusters..."
            class="w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 font-medium"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="skill-tags" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Tags (comma-separated)</label>
            <input
              id="skill-tags"
              type="text"
              bind:value={newSkill.tags}
              placeholder="docker, devops, compose, backend"
              class="w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
          </div>

          <div>
            <label for="skill-embed" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Embed in Agent (optional)</label>
            <select
              id="skill-embed"
              bind:value={newSkill.embed_agent}
              class="w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            >
              <option value="">None (Global standalone skill)</option>
              {#each agentsList as ag}
                <option value={ag.id}>{ag.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div>
          <label for="skill-content" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Instruction Manual / SOP Content (Markdown)</label>
          <textarea
            id="skill-content"
            rows="8"
            bind:value={newSkill.content}
            class="w-full p-3.5 rounded-xl border text-xs font-mono focus:outline-none focus:ring-2 leading-relaxed"
            style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-end gap-3 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => isCreateModalOpen = false}
          class="px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={isSubmitting || !newSkill.name.trim()}
          onclick={createSkillSubmit}
          class="px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer text-white shadow-md disabled:opacity-50"
          style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
        >
          {#if isSubmitting}
            <span class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
            <span>Creating...</span>
          {:else}
            <span>Save & Index Skill</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
