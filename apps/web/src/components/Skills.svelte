<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { confirm } from "#lib/state/dialog.svelte.ts";
  import { uiState } from "#lib/state/uiState.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
  import PageHero from "./PageHero.svelte";
  import SkillRegistryGrid from "./SkillRegistryGrid.svelte";
  import SkillDetailColumn from "./SkillDetailColumn.svelte";
  import CreateSkillModal from "./CreateSkillModal.svelte";
  import SkillRegistryModal from "./SkillRegistryModal.svelte";

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
  let searchMode = $state("hybrid"); // "hybrid" | "registry"
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

  let activeSearchController = null;

  async function loadSkills() {
    if (activeSearchController) {
      activeSearchController.abort();
    }
    const controller = new AbortController();
    activeSearchController = controller;

    loading = true;
    error = "";
    try {
      const q = searchQuery.trim();
      const url = q
        ? "/api/v1/skills?q=" + encodeURIComponent(q)
        : "/api/v1/skills?limit=250";
      const res = await api.get(url);
      if (!controller.signal.aborted) {
        skills = res || [];
        loadVectorStats();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        error = err.message;
        toast.error("Failed to load skills: " + err.message);
      }
    } finally {
      if (!controller.signal.aborted) {
        loading = false;
      }
    }
  }

  async function openSkill(name) {
    skillDetailLoading = true;
    activeTab = "instructions";
    try {
      selectedSkill = await api.get("/api/v1/skills/" + encodeURIComponent(name));
    } catch (err) {
      toast.error("Failed to load skill: " + err.message);
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
      toast.warning("Please provide a skill name (e.g. my-custom-skill).");
      return;
    }
    if (!newSkill.description.trim()) {
      toast.warning("Please provide a short description for the skill.");
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
      toast.success(`Skill "${res.name}" successfully created and indexed into SQLite FTS5${res.embedded_in ? ` (embedded into @${res.embedded_in})` : ''}.`);
      await loadSkills();
      await openSkill(slug);
    } catch (err) {
      toast.error("Creation failed: " + err.message);
    } finally {
      isSubmitting = false;
    }
  }

  async function embedSkillInAgent(skillName, agentName) {
    try {
      await api.post(`/api/v1/skills/${encodeURIComponent(skillName)}/embed`, { agent: agentName });
      toast.success(`Skill "${skillName}" is now active for subagent @${agentName}.`);
    } catch (err) {
      toast.error("Failed to embed skill: " + err.message);
    }
  }

  async function unembedSkillFromAgent(skillName, agentName) {
    try {
      await api.post(`/api/v1/skills/${encodeURIComponent(skillName)}/unembed`, { agent: agentName });
      toast.info(`Skill "${skillName}" removed from @${agentName}.`);
    } catch (err) {
      toast.error("Failed to unembed skill: " + err.message);
    }
  }

  async function deleteSkill(skillName) {
    const confirmed = await confirm({
      title: `Delete Skill "${skillName}"?`,
      message: "This will remove the skill file from your village and delete its SQLite FTS5 and neural vector chunk indexes.",
      confirmText: "Yes, Delete It",
      cancelText: "Cancel",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      await api.delete(`/api/v1/skills/${encodeURIComponent(skillName)}`);
      selectedSkill = null;
      toast.success(`Skill "${skillName}" has been removed.`);
      await loadSkills();
    } catch (err) {
      toast.error("Failed to delete skill: " + err.message);
    }
  }

  async function reindexAllSkills() {
    const progressToast = toast.loading("Re-indexing SQLite FTS5 skills database...");
    try {
      await api.post("/api/v1/skills/reindex", {});
      progressToast.success("SQLite FTS5 database successfully re-indexed all skills.");
      await loadSkills();
    } catch (err) {
      progressToast.error("Reindex failed: " + err.message);
    }
  }

  let isEmbedding = $state(false);

  async function reembedVectorSkills() {
    if (isEmbedding) return;
    isEmbedding = true;
    const progressToast = toast.loading("Generating IBM Granite ONNX neural vector embeddings (384-dim)...");
    try {
      const res = await api.post("/api/v1/skills/reembed?force=1", {});
      progressToast.success(res.message || `Successfully generated vector embeddings for ${res.vectorized_chunks || 0} chunks.`);
      await loadSkills();
      await loadVectorStats();
    } catch (err) {
      progressToast.error("Vector embedding failed: " + err.message);
    } finally {
      isEmbedding = false;
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

  let installedSkillNames = $state(new Set());

  async function loadAllInstalledSkillNames() {
    try {
      const all = await api.get("/api/v1/skills?limit=1000");
      if (Array.isArray(all)) {
        const names = new Set();
        for (const s of all) {
          if (s.name) names.add(s.name.toLowerCase());
          if (s.skill_name) names.add(s.skill_name.toLowerCase());
        }
        installedSkillNames = names;
      }
    } catch (_) { /* best effort */ }
  }

  onMount(() => {
    loadSkills();
    loadAllInstalledSkillNames();
    const handleUpdated = () => {
      loadSkills();
      loadAllInstalledSkillNames();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('konoha:skills-updated', handleUpdated);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('konoha:skills-updated', handleUpdated);
      }
    };
  });

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
    if (!skillName) return false;
    const lower = skillName.toLowerCase();
    if (installedSkillNames && installedSkillNames.has(lower)) return true;
    if (skills && Array.isArray(skills)) {
      return skills.some(s => (s.name && s.name.toLowerCase() === lower) || (s.skill_name && s.skill_name.toLowerCase() === lower));
    }
    return false;
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
    const progressToast = toast.loading(`Installing skill "${skillName}" from skills.sh...`);
    try {
      const result = await api.post("/api/v1/skills/install", {
        repo_url: repoUrl,
        skill_name: skillName
      });
      const verifiedPath = result && result.installed_path ? result.installed_path : null;
      progressToast.success(verifiedPath
        ? `Skill "${skillName}" verified at: ${verifiedPath}`
        : `Skill "${skillName}" installed and verified.`);
      isRegistryModalOpen = false;
      const lower = skillName.toLowerCase();
      installedSkillNames.add(lower);
      installedSkillNames = new Set(installedSkillNames);
      installingSkill = "";
      await loadAllInstalledSkillNames();
      await loadSkills();
      if (searchMode !== "registry") {
        await openSkill(skillName);
      }
    } catch (err) {
      const isBlocked = err.data?.guardian_blocked || (err.message && err.message.includes('BLOCKED by Guardian'));
      if (isBlocked) {
        progressToast.error(err.message, { duration: 8000 });
      } else {
        progressToast.error("Installation failed: " + err.message);
      }
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

<div class="space-y-6 w-full">
  {#snippet heroActions()}
    <button
      type="button"
      onclick={() => isCreateModalOpen = true}
      class="btn-3d btn-3d-primary px-5 py-2.5 rounded-[3px] font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md text-white"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      <span>Create New Skill</span>
    </button>

    <button
      type="button"
      onclick={() => switchToRegistryMode(searchQuery || 'react')}
      class="btn-3d {searchMode === 'registry' ? 'btn-3d-primary text-white' : 'btn-3d-secondary'} px-4 py-2.5 rounded-[3px] border text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-sm"
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
      class="btn-3d btn-3d-secondary px-4 py-2.5 rounded-[3px] border text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-sm"
      title="Run konoha migrate to re-index all skills into SQLite FTS5"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span>Re-index FTS5</span>
    </button>

    <button
      type="button"
      onclick={reembedVectorSkills}
      disabled={isEmbedding}
      class="btn-3d btn-3d-primary px-4 py-2.5 rounded-[3px] border text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
      title="Generate IBM Granite ONNX 384-dim neural vector embeddings for all skills into vector database"
    >
      <svg class="w-4 h-4 {isEmbedding ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span>{isEmbedding ? 'Vectorizing...' : 'Re-embed Vectors'}</span>
    </button>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Ninja Skill Registry"
    badgeText="FTS5 Skill Knowledge Base"
    description="Inspect, create, and embed structured agent SOPs, frameworks, and reference skills into your subagents. 100% synchronized with CLI commands."
    actions={heroActions}
  />

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
        placeholder={searchMode === "registry" ? "Search skills.sh global registry (e.g. react, docker, k8s, nextjs)..." : "Hybrid search by keyword or concept (e.g. helm deployment, cybersecurity audit, tailwind styling)..."}
        class="w-full pl-10 pr-4 py-2.5 rounded-[3px] border text-xs login-field-effect input-theme font-medium"
        style="background: var(--color-surface); color: var(--color-text);"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => { searchQuery = ''; if (searchMode === 'registry') searchRegistrySkills(''); else loadSkills(); }}
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center w-5 h-5"
          style="color: var(--color-text-muted);"
          aria-label="Clear skill search"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>

    <!-- Search Mode Selector & Vector Badge -->
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <div class="flex items-center rounded-xl p-1 border text-xs" style="background: var(--color-surface-hover); border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => { searchMode = "hybrid"; loadSkills(); }}
          class="btn-3d px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 {searchMode === 'hybrid' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>FTS5 & Vector</span>
        </button>
        <button
          type="button"
          onclick={() => switchToRegistryMode(searchQuery || 'react')}
          class="btn-3d px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 {searchMode === 'registry' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
          title="Search open-source community skills on skills.sh (equivalent to: konoha skill search <query>)"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span>skills.sh Registry</span>
        </button>
      </div>

      {#if searchMode === 'registry'}
        <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold badge-3d-subflex items-center gap-1 border">
          <svg class="w-3 h-3 text-status-info" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span>skills.sh Public Registry</span>
        </span>
        <span class="text-xs font-bold" style="color: var(--color-text-muted);">
          {registryResults.length} found
        </span>
      {:else}
        {@const embeddedCount = vectorStats.embedded_chunks || vectorStats.total_chunks || 0}
        <span
          class="px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 {embeddedCount > 0 ? 'text-status-success border-status-success-soft bg-status-success-soft' : 'text-status-warning border-status-warning-soft bg-status-warning-soft'}"
          title="Hybrid RAG Search: SQLite FTS5 BM25 + {vectorStats.model || 'IBM Granite 97M ONNX'}"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{embeddedCount} Vector Chunks ({embeddedCount > 0 ? 'Granite 97M ONNX Active' : 'FTS5 Only'})</span>
        </span>
        <span class="text-xs font-bold" style="color: var(--color-text-muted);">
          {skills.length} skills
        </span>
      {/if}
    </div>
  </div>

  <!-- Zero-Chunk Inactive Vector Hint -->
  {#if searchMode !== 'registry' && (vectorStats.embedded_chunks || vectorStats.total_chunks || 0) === 0}
    <div
      class="p-3.5 rounded-[3px] border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
      style="
        background: color-mix(in srgb, var(--theme-warning, #f59e0b) 12%, transparent);
        border-color: color-mix(in srgb, var(--theme-warning, #f59e0b) 35%, transparent);
        color: var(--theme-warning, #f59e0b);
      "
    >
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>Neural vector search is currently inactive (0 embedded chunks). Keyword FTS5 search is active.</span>
      </div>
      <button
        type="button"
        onclick={reembedVectorSkills}
        disabled={isEmbedding}
        class="px-3 py-1.5 rounded-[3px] text-xs font-bold text-white cursor-pointer shadow-sm disabled:opacity-50 shrink-0"
        style="background: linear-gradient(135deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8));"
      >
        {isEmbedding ? 'Vectorizing...' : 'Re-embed Vectors'}
      </button>
    </div>
  {/if}

  <!-- Main Content Grid -->
  {#if searchMode === "registry"}
    <SkillRegistryGrid
      registryResults={registryResults}
      installingSkill={installingSkill}
      oninstall={installRegistrySkill}
      isinstalled={isSkillInstalled}
      searchQuery={searchQuery}
      registryLoading={registryLoading}
      registryError={registryError}
    />
  {:else if loading}
    <div class="p-12 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="inline-block animate-spin w-8 h-8 rounded-full border-4 border-t-transparent mb-3" style="border-color: var(--color-primary); border-top-color: transparent;"></div>
      <p class="text-xs font-semibold" style="color: var(--color-text-muted);">Loading skills from SQLite FTS5 registry...</p>
    </div>
  {:else if error}
    <div class="p-6 rounded-3xl border-status-danger-soft bg-status-danger-soft text-status-danger text-xs font-bold">
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
                class="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:scale-105 shadow-sm cursor-pointer flex items-center gap-1.5"
                style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span>Search skills.sh for "{searchQuery}"</span>
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
            class="metric-card-3d p-4 rounded-2xl border text-left transition-all duration-150 cursor-pointer shadow-sm hover:scale-[1.01]"
            style="{isSelected
              ? 'border-color: var(--color-primary); background-color: var(--color-primary-glow); box-shadow: 0 0 0 1px var(--color-primary), 0 8px 20px -4px color-mix(in srgb, var(--theme-grad-1) 25%, transparent);'
              : 'border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border));'}"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-black truncate" style="color: var(--color-text);">{s.name}</span>
              <div class="flex items-center gap-1 shrink-0">
                {#if s.engine === 'both'}
                  <span class="text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold border border-status-success-soft bg-status-success-soft text-status-success" title="Matched both FTS5 keyword and semantic vector">
                    FTS5 + Vector ({Math.round((s.score || 1) * 100)}%)
                  </span>
                {:else if s.engine === 'vector'}
                  <span class="text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold border border-status-info-soft bg-status-info-soft text-status-info" title="Matched semantic neural vector (similarity: {s.similarity})">
                    Vector ({Math.round((s.score || 1) * 100)}%)
                  </span>
                {:else if s.engine === 'fts5'}
                  <span class="text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold border border-status-warning-soft bg-status-warning-soft text-status-warning" title="Matched SQLite FTS5 keyword index">
                    FTS5
                  </span>
                {/if}
                <span class="text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold shrink-0 gradient-badge">
                  {s.type || 'skill'}
                </span>
              </div>
            </div>

            {#if s.matched_chunk}
              <div class="mt-2 p-1.5 rounded-[3px] text-[10px] font-mono border text-left truncate opacity-85" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
                <span class="font-bold text-[var(--theme-focus)]">Semantic:</span> {s.matched_chunk}
              </div>
            {/if}

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

    <SkillDetailColumn
      selectedSkill={selectedSkill}
      bind:selectedAgentToEmbed
      bind:activeTab
      isEmbedding={isEmbedding}
      searchQuery={searchQuery}
      agentsList={agentsList}
      onreembed={reembedVectorSkills}
      ondelete={deleteSkill}
      onembed={embedSkillInAgent}
      onunembed={unembedSkillFromAgent}
      onregistry={switchToRegistryMode}
      skillDetailLoading={skillDetailLoading}
      skills={skills}
    />
    </div>
  {/if}
</div>

  <CreateSkillModal
    open={isCreateModalOpen}
    bind:newSkill
    agentsList={agentsList}
    isSubmitting={isSubmitting}
    onclose={() => { isCreateModalOpen = false; }}
    onsubmit={createSkillSubmit}
  />

  <SkillRegistryModal
    open={isRegistryModalOpen}
    bind:registryQuery
    registryError={registryError}
    installingSkill={installingSkill}
    onclose={() => { isRegistryModalOpen = false; }}
    oninput={handleRegistrySearchInput}
    isinstalled={isSkillInstalled}
    oninstall={installRegistrySkill}
    handleRegistrySearchInput={handleRegistrySearchInput}
    registryLoading={registryLoading}
    registryResults={registryResults}
  />
