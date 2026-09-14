<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";
  import { uiState } from "#lib/state/uiState.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  let skills = $state([]);
  let searchQuery = $state("");
  let loading = $state(true);
  let error = $state("");
  let selectedSkill = $state(null);
  let skillDetailLoading = $state(false);
  let vectorStats = $state({
    total_chunks: 0,
    embedded_chunks: 0,
    vectorized_skills: 0,
    model: "IBM Granite Multilingual (384-dim)"
  });
  let searchMode = $state("fts"); // "fts" | "vector"
  let activeTab = $state("instructions"); // "instructions" | "vectors"

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

  async function loadVectorStats() {
    try {
      const stats = await api.get("/api/v1/vectors/stats");
      if (stats) vectorStats = stats;
    } catch (_) { /* best effort */ }
  }

  async function loadSkills() {
    loading = true;
    error = "";
    try {
      const modeParam = searchMode === "vector" ? "&semantic=1" : "";
      const url = searchQuery.trim()
        ? "/api/v1/skills?q=" + encodeURIComponent(searchQuery.trim()) + modeParam
        : "/api/v1/skills?limit=250";
      skills = await api.get(url);
      loadVectorStats();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function openSkill(name) {
    skillDetailLoading = true;
    activeTab = "instructions";
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
    const confirmed = await sweetAlert.confirm({
      title: `Delete Skill "${skillName}"?`,
      text: "This will remove the skill file from your village and delete its SQLite FTS5 chunk index.",
      icon: "warning",
      confirmText: "Yes, Delete It",
      cancelText: "Cancel"
    });
    if (!confirmed) return;

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
      await api.post("/api/v1/skills/reindex", {});
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
      if (searchMode === "registry") {
        searchRegistrySkills(searchQuery);
      } else {
        loadSkills();
      }
    }, 250);
  }

  onMount(loadSkills);

  useScrollLock(() => isCreateModalOpen || isRegistryModalOpen);

  // Registry Search & Install State
  let isRegistryModalOpen = $state(false);
  let registryQuery = $state("");
  let registryResults = $state([]);
  let registryLoading = $state(false);
  let registryError = $state("");
  let installingSkill = $state("");
  let registryDebounceTimer;

  function isSkillInstalled(skillName) {
    if (!skills || !skillName) return false;
    return skills.some(s => s.name === skillName || s.skill_name === skillName);
  }

  async function searchRegistrySkills(customQuery) {
    registryLoading = true;
    registryError = "";
    try {
      const q = (customQuery !== undefined ? customQuery : (searchMode === "registry" ? searchQuery : registryQuery)).trim() || "react";
      const res = await api.get("/api/v1/skills/registry?q=" + encodeURIComponent(q));
      registryResults = res && res.results ? res.results : (Array.isArray(res) ? res : []);
    } catch (err) {
      registryError = err.message;
      registryResults = [];
    } finally {
      registryLoading = false;
    }
  }

  function switchToRegistryMode(query) {
    searchMode = "registry";
    if (query !== undefined) {
      searchQuery = query;
    }
    searchRegistrySkills(searchQuery || "react");
  }

  function handleRegistrySearchInput() {
    clearTimeout(registryDebounceTimer);
    registryDebounceTimer = setTimeout(() => {
      searchRegistrySkills();
    }, 300);
  }

  async function installRegistrySkill(item) {
    const skillName = item.skillId || item.name;
    let repoUrl = item.source ? item.source.trim() : "";
    if (repoUrl && !repoUrl.startsWith("http://") && !repoUrl.startsWith("https://") && !repoUrl.startsWith("git@")) {
      repoUrl = `https://github.com/${repoUrl}`;
    }
    if (!skillName) return;

    installingSkill = skillName;
    try {
      uiState.addNotification(`Installing skill "${skillName}" from skills.sh...`, "info");
      await api.post("/api/v1/skills/install", {
        repo_url: repoUrl,
        skill_name: skillName
      });
      await sweetAlert.fire({
        title: "Skill Installed!",
        text: `Skill "${skillName}" installed successfully and indexed into SQLite database.`,
        icon: "success"
      });
      uiState.addNotification(`Installed skill "${skillName}"`, "success");
      isRegistryModalOpen = false;
      await loadSkills();
      if (searchMode !== "registry") {
        await openSkill(skillName);
      }
    } catch (err) {
      await sweetAlert.fire({
        title: "Installation Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      installingSkill = "";
    }
  }

  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      if (isCreateModalOpen) isCreateModalOpen = false;
      if (isRegistryModalOpen) isRegistryModalOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div class="space-y-6 max-w-7xl mx-auto">
  <!-- Hero Section -->
  <div
    class="rise-3d relative overflow-hidden rounded-3xl p-6 sm:p-8 border shadow-sm transition-all"
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
          onclick={() => switchToRegistryMode(searchQuery || 'react')}
          class="px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-sm cursor-pointer {searchMode === 'registry' ? 'ring-2 ring-blue-500 font-bold' : ''}"
          style="background: var(--color-surface); border-color: var(--color-primary); color: var(--color-primary);"
          title="Search skills on skills.sh registry (konoha skill search <query>)"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Search skills.sh</span>
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
  <div class="p-4 rounded-2xl border shadow-sm flex flex-col md:flex-row items-center gap-4" style="background: var(--color-surface); border-color: var(--color-border);">
    <div class="relative flex-1 w-full">
      <svg class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        bind:value={searchQuery}
        oninput={handleSearchInput}
        placeholder={searchMode === "registry" ? "Search skills.sh global registry (e.g. react, docker, k8s, nextjs)..." : (searchMode === "vector" ? "Semantic Vector Search (e.g. cloud deployment, cyber defense, mobile layout)..." : "Search local skills by name, tag, or topic (e.g. helm, cybersecurity, sveltekit)...")}
        class="w-full pl-10 pr-4 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 font-medium"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => { searchQuery = ''; if (searchMode === 'registry') searchRegistrySkills(''); else loadSkills(); }}
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer"
          style="color: var(--color-text-muted);"
        >
          ✕
        </button>
      {/if}
    </div>

    <!-- Search Mode Selector & Vector Badge -->
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <div class="flex items-center rounded-xl p-1 border text-xs" style="background: var(--color-surface-hover); border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => { searchMode = "fts"; loadSkills(); }}
          class="px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer {searchMode === 'fts' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}"
        >
          🔤 Local FTS5
        </button>
        <button
          type="button"
          onclick={() => { searchMode = "vector"; loadSkills(); }}
          class="px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 {searchMode === 'vector' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}"
        >
          <span>⚡ Neural Vector</span>
        </button>
        <button
          type="button"
          onclick={() => switchToRegistryMode(searchQuery || 'react')}
          class="px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 {searchMode === 'registry' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'}"
          title="Search open-source community skills on skills.sh (equivalent to: konoha skill search <query>)"
        >
          <span>🌐 skills.sh Registry</span>
        </button>
      </div>

      {#if searchMode === 'registry'}
        <span class="px-2.5 py-1 rounded-lg border text-[11px] font-bold text-blue-700 dark:text-blue-300 border-blue-500/30 bg-blue-500/10">
          🌐 skills.sh Public Registry
        </span>
        <span class="text-xs font-bold" style="color: var(--color-text-muted);">
          {registryResults.length} found
        </span>
      {:else}
        <span class="px-2.5 py-1 rounded-lg border text-[11px] font-bold text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10" title="Offline Neural RAG: {vectorStats.model || 'IBM Granite Multilingual'} + {vectorStats.reranker || 'MS MARCO MiniLM Reranker'}">
          ⚡ {vectorStats.embedded_chunks || vectorStats.total_chunks || 989} Vector Chunks (Dual Models Active)
        </span>
        <span class="text-xs font-bold" style="color: var(--color-text-muted);">
          {skills.length} skills
        </span>
      {/if}
    </div>
  </div>

  <!-- Main Content Grid -->
  {#if searchMode === "registry"}
    <!-- skills.sh Public Registry Grid View (Exact match for konoha skill search) -->
    <div class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-3 p-4 rounded-2xl border" style="background: var(--color-surface); border-color: var(--color-border);">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center border font-bold" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            🌐
          </div>
          <div>
            <h2 class="text-sm sm:text-base font-bold" style="color: var(--color-text);">
              skills.sh Global Registry Search
            </h2>
            <p class="text-xs" style="color: var(--color-text-muted);">
              Equivalent to <code class="px-1.5 py-0.5 rounded font-mono text-[11px] bg-slate-500/10">konoha skill search {searchQuery || 'react'}</code> · 1-click install
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs font-semibold" style="color: var(--color-text-muted);">
          <span>Found {registryResults.length} open-source skills</span>
        </div>
      </div>

      {#if registryLoading}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each Array(6) as _}
            <div class="p-5 rounded-2xl border animate-pulse space-y-3" style="background: var(--color-surface); border-color: var(--color-border);">
              <div class="w-3/4 h-4 rounded bg-slate-200 dark:bg-slate-700"></div>
              <div class="w-1/2 h-3 rounded bg-slate-200 dark:bg-slate-700"></div>
              <div class="w-full h-8 rounded-xl bg-slate-200 dark:bg-slate-700 pt-2"></div>
            </div>
          {/each}
        </div>
      {:else if registryError}
        <div class="p-6 rounded-2xl border text-xs text-red-500 bg-red-500/10 border-red-500/30">
          Failed to query skills.sh registry: {registryError}
        </div>
      {:else if registryResults.length === 0}
        <div class="p-16 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center border text-xl" style="background-color: var(--color-primary-glow); border-color: var(--color-primary);">
            🔍
          </div>
          <h3 class="text-sm font-bold" style="color: var(--color-text);">No skills found matching "{searchQuery}"</h3>
          <p class="text-xs mt-1" style="color: var(--color-text-muted);">Try searching for "react", "docker", "kubernetes", "tailwind", or "nextjs".</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each registryResults as item, index}
            {@const skillName = item.skillId || item.name}
            {@const installed = isSkillInstalled(skillName)}
            <div
              class="p-5 rounded-2xl border flex flex-col justify-between gap-4 transition-all hover:scale-[1.01] hover:border-[var(--color-primary)] shadow-sm"
              style="background: var(--color-surface); border-color: var(--color-border);"
            >
              <div class="space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono px-2 py-0.5 rounded-md border font-bold" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                      #{index + 1}
                    </span>
                    <span class="text-xs font-black font-mono truncate max-w-[180px]" style="color: var(--color-text);" title={skillName}>
                      {skillName}
                    </span>
                  </div>
                  {#if item.installs !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 bg-indigo-500/10">
                      {item.installs.toLocaleString()} installs
                    </span>
                  {/if}
                </div>

                {#if item.source}
                  <div class="flex items-center gap-1.5 text-xs" style="color: var(--color-text-muted);">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                    <a
                      href="https://github.com/{item.source}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="hover:underline font-mono truncate text-[11px]"
                      style="color: var(--color-primary);"
                    >
                      {item.source}
                    </a>
                  </div>
                {/if}
              </div>

              <div class="pt-2 border-t" style="border-color: var(--color-border);">
                {#if installed}
                  <div class="w-full py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 opacity-80" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                    <svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Already Installed in Village</span>
                  </div>
                {:else}
                  <button
                    type="button"
                    disabled={installingSkill === skillName}
                    onclick={() => installRegistrySkill(item)}
                    class="w-full py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] shadow-md cursor-pointer disabled:opacity-50"
                    style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
                  >
                    {#if installingSkill === skillName}
                      <span class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Installing "{skillName}"...</span>
                    {:else}
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Install Skill</span>
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if loading}
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
        {#if skills.length === 0}
          <div class="p-6 rounded-2xl border text-center space-y-3" style="background: var(--color-surface); border-color: var(--color-border);">
            <p class="text-xs font-bold" style="color: var(--color-text);">No local skills found</p>
            {#if searchQuery}
              <p class="text-[11px]" style="color: var(--color-text-muted);">
                "{searchQuery}" is not installed locally.
              </p>
              <button
                type="button"
                onclick={() => switchToRegistryMode(searchQuery)}
                class="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:scale-105 shadow-sm cursor-pointer"
                style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
              >
                🌐 Search skills.sh for "{searchQuery}"
              </button>
            {/if}
          </div>
        {/if}
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
              <span>{s.byte_size ? Math.round(s.byte_size / 1024) : 0} KB</span>
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

            <!-- Content & Vector Tabs -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 border-b pb-2" style="border-color: var(--color-border);">
                <button
                  type="button"
                  onclick={() => activeTab = 'instructions'}
                  class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer {activeTab === 'instructions' ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-500/10'}"
                  style={activeTab !== 'instructions' ? 'color: var(--color-text-muted);' : ''}
                >
                  📄 Instructions & Manual
                </button>
                <button
                  type="button"
                  onclick={() => activeTab = 'vectors'}
                  class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 {activeTab === 'vectors' ? 'bg-emerald-600 text-white shadow-sm' : 'hover:bg-slate-500/10'}"
                  style={activeTab !== 'vectors' ? 'color: var(--color-text-muted);' : ''}
                >
                  <span>⚡ Vector Chunks & Embeddings</span>
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono {activeTab === 'vectors' ? 'bg-white/20 text-white' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'}">
                    {selectedSkill.chunks_count || selectedSkill.chunks?.length || 0}
                  </span>
                </button>
              </div>

              {#if activeTab === 'instructions'}
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
              {:else if activeTab === 'vectors'}
                <div class="space-y-4">
                  <!-- Model Info Banner -->
                  <div class="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span class="font-bold" style="color: var(--color-text);">Models:</span>
                      <span class="font-mono text-emerald-600 dark:text-emerald-400 font-bold">IBM Granite 97M (ONNX) + MS MARCO MiniLM</span>
                    </div>
                    <div class="flex items-center gap-3 text-[11px] font-mono" style="color: var(--color-text-muted);">
                      <span>Embedding: <b class="text-indigo-600 dark:text-indigo-400">384-dim (Cosine)</b></span>
                      <span>RAG Reranker: <b class="text-indigo-600 dark:text-indigo-400">Cross-Encoder + RRF (k=60)</b></span>
                      <span>Execution: <b class="text-emerald-600 dark:text-emerald-400">100% Offline INT8</b></span>
                    </div>
                  </div>

                  {#if selectedSkill.chunks && selectedSkill.chunks.length > 0}
                    <div class="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                      {#each selectedSkill.chunks as chunk}
                        <div class="p-4 rounded-2xl border space-y-2.5 transition-all hover:border-emerald-500/40" style="background: var(--color-surface); border-color: var(--color-border);">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-xs font-bold px-2 py-0.5 rounded-lg border text-indigo-700 dark:text-indigo-300 border-indigo-500/30 bg-indigo-500/10 font-mono">
                              Chunk #{chunk.chunk_index + 1}
                            </span>
                            <span class="text-[10px] font-mono px-2 py-0.5 rounded-lg border text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                              384-dim Float32 Vector
                            </span>
                          </div>

                          <!-- Vector values snippet -->
                          {#if chunk.vector_sample && chunk.vector_sample.length > 0}
                            <div class="p-2.5 rounded-xl border text-[11px] font-mono overflow-x-auto" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                              <span class="font-bold text-slate-500 mr-2">Vector Sample:</span>
                              <span class="text-emerald-600 dark:text-emerald-400">
                                [{chunk.vector_sample.join(', ')} ... 384 dimensions]
                              </span>
                            </div>
                          {/if}

                          <!-- Chunk Text Snippet -->
                          <div class="text-xs font-mono p-3 rounded-xl border leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);">
                            {chunk.chunk_text}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="p-8 text-center rounded-2xl border" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                      <p class="text-xs font-semibold" style="color: var(--color-text-muted);">No vector chunks generated for this skill yet.</p>
                      <p class="text-[11px] mt-1" style="color: var(--color-text-muted);">Run <code class="px-1.5 py-0.5 rounded bg-slate-500/20 font-mono">konoha migrate</code> in terminal to automatically vectorize all skills.</p>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {:else}
          {#if skills.length === 0 && searchQuery}
            <div class="p-12 text-center rounded-3xl border space-y-4" style="background: var(--color-surface); border-color: var(--color-border);">
              <div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center border text-xl" style="background-color: var(--color-primary-glow); border-color: var(--color-primary);">
                🌐
              </div>
              <div>
                <h3 class="text-base font-bold" style="color: var(--color-text);">No local skills matching "{searchQuery}"</h3>
                <p class="text-xs max-w-md mx-auto mt-1" style="color: var(--color-text-muted);">
                  Search the public registry on <code class="font-mono text-xs">skills.sh</code> (exact CLI equivalent: <code class="font-mono text-xs">konoha skill search {searchQuery}</code>).
                </p>
              </div>
              <button
                type="button"
                onclick={() => switchToRegistryMode(searchQuery)}
                class="px-5 py-2.5 rounded-xl text-xs font-bold text-white inline-flex items-center gap-2 shadow-md cursor-pointer hover:scale-105 transition-all"
                style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>Search skills.sh for "{searchQuery}"</span>
              </button>
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

<!-- Search & Install from skills.sh Registry Modal -->
{#if isRegistryModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={() => isRegistryModalOpen = false}
  >
    <div
      class="w-full max-w-2xl p-6 rounded-3xl border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
      style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text); box-shadow: var(--shadow-3d);"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">skills.sh Public Registry</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Search and install open-source agent skills into your village with 1-click</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => isRegistryModalOpen = false}
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
        >
          ✕
        </button>
      </div>

      <!-- Search Input -->
      <div class="relative w-full">
        <svg class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          bind:value={registryQuery}
          oninput={handleRegistrySearchInput}
          placeholder="Search skills.sh (e.g. docker, kubernetes, security, react)..."
          class="w-full pl-10 pr-10 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 font-medium"
          style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);"
        />
        {#if registryQuery}
          <button
            type="button"
            onclick={() => { registryQuery = ''; searchRegistrySkills(); }}
            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer"
            style="color: var(--color-text-muted);"
          >
            ✕
          </button>
        {/if}
      </div>

      <!-- Results List -->
      <div class="flex-1 overflow-y-auto space-y-2.5 min-h-[260px] max-h-[460px] pr-1">
        {#if registryLoading}
          <div class="space-y-2">
            {#each Array(4) as _}
              <div class="p-4 rounded-2xl border animate-pulse flex items-center justify-between" style="background: var(--color-surface); border-color: var(--color-border);">
                <div class="space-y-2">
                  <div class="w-32 h-4 rounded bg-slate-200 dark:bg-slate-700"></div>
                  <div class="w-48 h-3 rounded bg-slate-200 dark:bg-slate-700"></div>
                </div>
                <div class="w-20 h-8 rounded-xl bg-slate-200 dark:bg-slate-700"></div>
              </div>
            {/each}
          </div>
        {:else if registryError}
          <div class="p-4 rounded-2xl border text-xs text-red-500 bg-red-500/10" style="border-color: rgba(239, 68, 68, 0.3);">
            Failed to fetch from skills.sh registry: {registryError}
          </div>
        {:else if registryResults.length === 0}
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <svg class="w-10 h-10 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-xs font-semibold" style="color: var(--color-text);">No skills found</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Try searching for popular topics like "docker", "k8s", "helm", or "nextjs"</p>
          </div>
        {:else}
          {#each registryResults as item}
            {@const skillName = item.skillId || item.name}
            {@const installed = isSkillInstalled(skillName)}
            <div
              class="p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-all hover:border-[var(--color-primary)]"
              style="background: var(--color-surface); border-color: var(--color-border);"
            >
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold font-mono truncate" style="color: var(--color-text);">
                    {skillName}
                  </span>
                  {#if item.installs !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                      {item.installs.toLocaleString()} installs
                    </span>
                  {/if}
                </div>
                {#if item.source}
                  <div class="flex items-center gap-1 text-[11px]" style="color: var(--color-text-muted);">
                    <span>Source:</span>
                    <a
                      href="https://github.com/{item.source}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="hover:underline font-mono inline-flex items-center gap-1"
                      style="color: var(--color-primary);"
                    >
                      github.com/{item.source}
                      <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                {/if}
              </div>

              <div class="shrink-0">
                {#if installed}
                  <span
                    class="px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 opacity-80"
                    style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);"
                  >
                    <svg class="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Installed</span>
                  </span>
                {:else}
                  <button
                    type="button"
                    disabled={installingSkill === skillName}
                    onclick={() => installRegistrySkill(item)}
                    class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 transition-all hover:scale-105 shadow-sm cursor-pointer disabled:opacity-50"
                    style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
                  >
                    {#if installingSkill === skillName}
                      <span class="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Installing...</span>
                    {:else}
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Install</span>
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between pt-3 border-t text-xs" style="border-color: var(--color-border); color: var(--color-text-muted);">
        <span>Powered by <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" class="hover:underline font-semibold" style="color: var(--color-primary);">skills.sh</a></span>
        <button
          type="button"
          onclick={() => isRegistryModalOpen = false}
          class="px-4 py-2 rounded-xl border font-semibold cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
