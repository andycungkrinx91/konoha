<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { confirm } from "#lib/state/dialog.svelte.ts";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
  import PageHero from "./PageHero.svelte";

  let memories = $state([]);
  let loading = $state(true);
  let error = $state("");
  let selectedAgent = $state("");
  let selectedType = $state("");
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

  const fallbackAgents = [
    { id: "", name: "All Agents", title: "" },
    { id: "jonin", name: "@jonin", title: "UI & Frontend" },
    { id: "anbu", name: "@anbu", title: "Backend & DevOps" },
    { id: "kage", name: "@kage", title: "Architecture & Audit" },
    { id: "chunin", name: "@chunin", title: "Research" },
    { id: "genin", name: "@genin", title: "Code Review" },
    { id: "sannin", name: "@sannin", title: "Router" },
    { id: "tokubetsu-jonin", name: "@tokubetsu-jonin", title: "Docs" },
    { id: "akatsuki", name: "@akatsuki", title: "Red-Team, Blue-Team & Gate" },
    { id: "global", name: "@global", title: "All Agents" }
  ];
  let agents = $state(fallbackAgents);

  async function loadAgents() {
    try {
      const rows = await api.get("/api/v1/agents");
      if (Array.isArray(rows) && rows.length) {
        const ids = new Set(rows.map(a => a.name));
        const list = rows.map(a => ({ id: a.name, name: "@" + a.name, title: a.title || "" }));
        if (!ids.has("global")) list.push({ id: "global", name: "@global", title: "All Agents" });
        if (!ids.has(newMemory.agentName)) list.push({ id: newMemory.agentName, name: "@" + newMemory.agentName, title: "" });
        agents = [{ id: "", name: "All Agents", title: "" }, ...list];
      }
    } catch (_) {
      // keep fallback list
    }
  }

  async function loadMemories() {
    loading = true;
    error = "";
    try {
      let url = "/api/v1/persona?";
      if (selectedAgent) url += `agent=${encodeURIComponent(selectedAgent)}&`;
      if (selectedType) url += `type=${encodeURIComponent(selectedType)}&`;
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
      toast.warning("Please provide memory content.");
      return;
    }
    try {
      await api.post("/api/v1/persona", newMemory);
      isCreateModalOpen = false;
      newMemory.title = "";
      newMemory.content = "";
      newMemory.tags = "";
      toast.success("Persona memory added successfully!");
      await loadMemories();
    } catch (err) {
      toast.error("Save failed: " + err.message);
    }
  }

  async function deleteMemory(id) {
    const confirmed = await confirm({
      title: "Delete Memory?",
      message: "Are you sure you want to permanently delete this persona memory item?",
      confirmText: "Delete",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      await api.delete("/api/v1/persona/" + id);
      toast.success("Memory item removed successfully.");
      await loadMemories();
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  }

  async function pruneAllMemories() {
    if (!memories || memories.length === 0) {
      toast.info("There are no persona memories to prune.");
      return;
    }

    const scopeText = selectedAgent ? `for @${selectedAgent}` : "across all agents";
    const confirmed = await confirm({
      title: "Prune Persona Memories?",
      message: `Are you sure you want to prune persona memories ${scopeText}?`,
      confirmText: "Prune",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      const payload = selectedAgent ? { agentName: selectedAgent } : {};
      const res = await api.post("/api/v1/persona/prune", payload);
      toast.success(`Successfully pruned ${res.deleted || 0} memory item(s).`);
      await loadMemories();
    } catch (err) {
      toast.error("Prune failed: " + err.message);
    }
  }

  const DEFAULT_SOUL = {
    title: "The Soul of Konoha: Ninja's Soul",
    will_of_fire: "Where tree leaves dance, one shall find flames. The fire's shadow will illuminate the village, and once again, tree leaves shall bud anew.",
    universal_adhd_standard: 'i-have-adhd (Lead with next action, numbered tasks, end with one concrete step, cap visible lists to 5, matter-of-fact errors, zero filler)',
    tenets: [
      { name: 'Factual Rigor & Absolute Truth', summary: 'Never lie. Claim success only with verified terminal evidence.' },
      { name: 'Silent Depth & Mandatory ADHD Shaping', summary: 'Zero monologue leaks. Enforce i-have-adhd across all turn responses: lead with action, numbered steps, cap lists to 5, zero filler.' },
      { name: 'Sanctity of Existing Architecture', summary: 'Protect working code. Never modify unrequested logic.' },
      { name: 'Anti-Slop as a Moral Duty', summary: 'Reject generic AI boilerplate, robotic pleasantries, and visual clichés.' },
      { name: 'Tactical Token Hygiene', summary: 'Zero wasted movement. Bounded file reading and symbol search.' }
    ],
    archetypes: {
      sannin: {
        name: 'Sannin',
        role: 'The Grand Tactician (Router)',
        voice: 'The battlefield is clear. Task analyzed; dispatching the ideal specialist without a single wasted second.',
        calling: 'Instant task classification, domain triage, subagent dispatch, and token-safe structured arguments.',
        antislop_skills: ['antislop'],
        adhd_shaping: 'Lead with routing verdict, numbered triage steps (max 3), cap delegation to 1 specialist, zero fluff.'
      },
      kage: {
        name: 'Kage',
        role: 'The Sovereign Guardian (Village Leader)',
        voice: 'Zero defects permitted past the village gates. 100/100 anti-slop score and ≥ 98% confidence verified before delivery.',
        calling: 'Architectural oversight, supply chain audit, Zero-AI-Slop gate enforcement, and final delivery approval.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with pass/fail verdict and score, numbered verification categories, matter-of-fact confidence reporting.'
      },
      jonin: {
        name: 'Jonin',
        role: 'The Elite Artisan (Frontend Master)',
        voice: 'Every pixel must breathe. Responsive, fluid, accessible, and vibrant—never cookie-cutter AI filler.',
        calling: 'Next.js, SvelteKit, Nuxt, Angular, Tailwind CSS v4, WebGL/3D, and fluid motion.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human', 'antislop-ui', 'antislop-layoutmobile'],
        adhd_shaping: 'Lead with UI action/file path, numbered component steps, cap visible options to 5, end with build check.'
      },
      anbu: {
        name: 'Anbu',
        role: 'The Covert Specialist (Backend & Black Ops)',
        voice: 'The pipes are silent, the connections pooled, and the boundaries hardened. Systems don\'t break on my watch.',
        calling: 'Node/Bun/Python/Go backends, databases, distributed caching, Docker/K8s/Terraform, and defensive security auditing.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with exact command/patch, numbered backend steps, calm error reporting, make system wins visible.'
      },
      genin: {
        name: 'Genin',
        role: 'The Non-Destructive Scout (Explorer)',
        voice: 'Trail mapped. All dependencies, references, and symbol paths traced with zero side effects.',
        calling: 'Read-only codebase exploration, AST symbol tracing, dependency graphing, and blast-radius analysis.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with exploration entry point, numbered discovery trace, cap symbol lists to 5, zero side effects.'
      },
      chunin: {
        name: 'Chunin',
        role: 'The Empirical Scholar (Intel Ninja)',
        voice: 'Every assertion backed by primary documentation. Citations verified against ground truth.',
        calling: 'Autonomous technical research, library documentation synthesis, and competitive analysis with verifiable citations.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with verified documentation answer, numbered evidence points, cap citations to 5, end with concrete recommendation.'
      },
      'tokubetsu-jonin': {
        name: '⬡ Tokubetsu-Jonin',
        role: 'The Authentic Scribe (Humanist Writer)',
        voice: 'Writing must be human, clear, and compelling. Documents that people actually enjoy reading.',
        calling: 'Production-grade technical documentation, runbooks, and refined human-authentic office documents (Word, Excel, PPT, PDF).',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human', 'antislop-copywriting'],
        adhd_shaping: 'Lead with executive takeaway, numbered sections, zero robotic AI fluff, compact human prose.'
      },
      akatsuki: {
        name: '☁ Akatsuki',
        role: 'The Red Cloud Executioner (Red-Team, Blue-Team & Security Final Gate)',
        voice: 'The perimeter is breached or hardened—there is no middle ground. Offensive exploits isolated in the sandbox, defensive hardening on the host, and zero unmitigated vulnerabilities past the final security gate.',
        calling: 'Full-spectrum security engineering: Authorized red-team penetration testing and sandbox exploit verification (akatsuki-lab on LXC/Docker), direct-host blue-team defensive code audits, secret leakage detection, dependency CVE scans, Skill Guardian perimeter defense, and the mandatory fail-closed Security Final Gate before Kage delivery approval.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with security verdict (PASS/FAIL/BLOCKED), numbered findings categorized by workflow (Red-Team / Blue-Team / Final Gate), CVSS severity, exact remediation patch, and sandbox containment proof.'
      }
    }
  };

  let activeTab = $state("memories");
  let soulData = $state(DEFAULT_SOUL);
  let loadingSoul = $state(false);
  let soulError = $state("");

  async function loadSoul() {
    loadingSoul = true;
    soulError = "";
    try {
      const res = await api.get("/api/v1/soul");
      if (res && res.soul) {
        soulData = res.soul;
      } else if (res && res.title) {
        soulData = res;
      }
    } catch (err) {
      soulError = err.message;
    } finally {
      loadingSoul = false;
    }
  }

  onMount(() => {
    loadAgents();
    loadMemories();
    loadSoul();
  });

  useScrollLock(() => isCreateModalOpen);

  function handleModalKeydown(e) {
    if (e.key === 'Escape' && isCreateModalOpen) isCreateModalOpen = false;
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  {/snippet}

  {#snippet heroActions()}
    <button
      type="button"
      onclick={pruneAllMemories}
      class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-[3px] font-bold text-xs badge-status badge-status-danger hover:bg-status-danger-soft transition-all cursor-pointer shadow-sm"
      title="Prune episodic memories"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span>Prune Memories</span>
    </button>

    <button
      type="button"
      onclick={() => { isCreateModalOpen = true; }}
      class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px] font-bold text-xs text-white shadow-md cursor-pointer"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
      </svg>
      <span>Add Memory</span>
    </button>
  {/snippet}

  {#snippet heroChildren()}
    <!-- View Switcher Tabs -->
    <div class="relative z-10 flex items-center gap-2 mt-4 pt-4 border-t theme-border/60 w-full">
      <button
        type="button"
        onclick={() => { activeTab = "memories"; }}
        class="btn-3d px-4 py-2 rounded-[3px] text-xs font-black transition-all cursor-pointer border flex items-center gap-2 {activeTab === 'memories' ? 'btn-3d-primary' : ''}"
        style={activeTab !== "memories" ? "background-color: var(--color-surface); color: var(--color-text-muted); border-color: var(--color-border);" : ""}
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span>Episodic Memories ({memories.length})</span>
      </button>

      <button
        type="button"
        onclick={() => { activeTab = "soul"; loadSoul(); }}
        class="btn-3d px-4 py-2 rounded-[3px] text-xs font-black transition-all cursor-pointer border flex items-center gap-2 {activeTab === 'soul' ? 'btn-3d-primary' : ''}"
        style={activeTab !== "soul" ? "background-color: var(--color-surface); color: var(--color-text-muted); border-color: var(--color-border);" : ""}
      >
        <svg class="w-3.5 h-3.5 {activeTab === 'soul' ? 'text-[var(--theme-warning)]' : 'text-status-warning'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
        </svg>
        <span>Ninja's Soul</span>
      </button>
    </div>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Persona Memory"
    badgeText="Episodic Learning & Long-Term Recall"
    badgeIcon={heroBadgeIcon}
    description="Permanent episodic learnings, behavioral rules, and contextual memory auto-injected into Ninja subagents without token waste."
    actions={heroActions}
  >
    {@render heroChildren()}
  </PageHero>

  {#if activeTab === "memories"}
  <!-- Filter & Search Controls -->
  <div class="metric-card-3d rounded-[5px] p-5 border space-y-4" style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));">
    <div class="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
      <!-- Agent Filter Tabs -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
        {#each agents as ag}
          <button
            type="button"
            onclick={() => { selectedAgent = ag.id; loadMemories(); }}
            class="btn-3d px-3.5 py-1.5 rounded-[3px] text-xs font-bold transition-all cursor-pointer whitespace-nowrap border {selectedAgent === ag.id ? 'btn-3d-primary' : ''}"
            style={selectedAgent !== ag.id ? "background-color: var(--color-surface); color: var(--color-text-muted); border-color: var(--color-border);" : ""}
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
          class="w-full pl-9 pr-4 py-2 rounded-[3px] text-xs font-semibold theme-text border transition-all login-field-effect input-theme"
          style="background-color: var(--color-surface); color: var(--color-text);"
        />
        <svg class="w-4 h-4 absolute left-3 top-2.5 theme-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
    </div>

    <!-- Memory Type Filter Tabs -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-semibold">
      <span class="theme-text-muted text-[11px] font-bold mr-1 uppercase tracking-wider">Type:</span>
      {#each [
        { id: '', label: 'All Types' },
        { id: 'episodic', label: 'Episodic (Learnings)' },
        { id: 'rule', label: 'Strict Rules' },
        { id: 'fact', label: 'Facts' },
        { id: 'preference', label: 'Preferences' }
      ] as t}
        <button
          type="button"
          onclick={() => { selectedType = t.id; loadMemories(); }}
          class="px-3 py-1 rounded-[3px] text-xs font-bold transition-all cursor-pointer whitespace-nowrap border {selectedType === t.id ? 'bg-action-primary text-white border-action-primary shadow-sm' : 'theme-bg-subtle theme-text-secondary theme-border hover-bg-subtle'}"
        >
          {t.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Error State -->
  {#if error}
    <div class="p-4 rounded-[3px] border badge-status badge-status-danger text-xs font-semibold">
      Failed to load memories: {error}
    </div>
  {/if}

  <!-- Loading State -->
  {#if loading}
    <div class="flex items-center justify-center py-16 theme-text-secondary text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-action-primary" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading persona memories...</span>
      </div>
    </div>
  {:else if memories.length === 0}
    <div class="metric-card-3d p-12 text-center rounded-[3px] border border-dashed theme-border-strong-b" style="border-color: var(--color-border);">
      <p class="text-sm font-bold theme-text">No persona memories found.</p>
      <p class="text-xs font-semibold theme-text-secondary mt-1">Use the "Add Memory" button to save rules or learnings.</p>
    </div>
  {:else}
    <!-- Grid of Memories with 3D Metric Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      {#each memories as m}
        <div
          class="metric-card-3d rounded-[5px] p-5 border flex flex-col justify-between"
          style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-[3px] text-[11px] font-bold border badge-status badge-status-info">
                  @{m.agent_name}
                </span>
                <span class="px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold uppercase border theme-bg-subtle theme-text theme-border">
                  {m.memory_type || "RULE"}
                </span>
              </div>
              <button
                type="button"
                onclick={() => deleteMemory(m.id)}
                class="btn-3d p-1.5 rounded-[3px] theme-text-muted hover:text-[var(--theme-danger)] hover:bg-status-danger-soft border-transparent hover:border-status-danger-soft transition-all cursor-pointer"
                title="Delete memory"
                aria-label="Delete memory"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {#if m.title}
              <h4 class="text-sm font-extrabold theme-text tracking-tight">
                {m.title}
              </h4>
            {/if}

            <p class="text-xs font-semibold theme-text leading-relaxed whitespace-pre-wrap break-words">
              {m.content}
            </p>
          </div>

          <div class="mt-4 pt-3 border-t theme-border flex items-center justify-between text-[10px] font-semibold theme-text-secondary">
            <span>ID: {m.id}</span>
            {#if m.tags}
              <span class="theme-text-muted font-mono">Tags: {m.tags}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if activeTab === "soul"}
  <div class="space-y-8">
    {#if loadingSoul && !soulData}
      <div class="flex items-center justify-center py-16 theme-text-secondary text-sm font-semibold">
        <div class="flex items-center gap-3">
          <svg class="animate-spin w-5 h-5 text-action-primary" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <span>Loading Ninja's Soul doctrine...</span>
        </div>
      </div>
    {:else if soulError && !soulData}
      <div class="p-4 rounded-[3px] border badge-status badge-status-danger text-xs font-semibold">
        Failed to load Ninja's Soul: {soulError}
      </div>
    {:else if soulData}
      {#if soulError}
        <div class="p-3 rounded-[3px] border badge-status badge-status-warning text-xs font-semibold flex items-center justify-between">
          <span>Notice: Displaying offline Ninja's Soul doctrine ({soulError})</span>
          <button type="button" onclick={loadSoul} class="underline text-status-warning cursor-pointer font-bold">Retry</button>
        </div>
      {/if}

      <!-- Ninja's Soul Creed Card (3D Luxury Plaque) -->
      <div
        class="metric-card-3d rounded-[5px] p-6 sm:p-8 border space-y-4"
        style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));"
      >
        <div class="flex items-center gap-2 text-xs font-black tracking-wider uppercase text-status-warning">
          <svg class="w-4 h-4 text-status-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
          </svg>
          <span class="font-black tracking-wide text-status-warning">Konohagakure Core Doctrine — Ninja's Soul</span>
        </div>
        <blockquote class="text-base sm:text-lg italic border-l-4 pl-4 py-1 leading-relaxed theme-text" style="border-color: var(--color-primary, var(--theme-focus));">
          "{soulData.will_of_fire || 'Where tree leaves dance, one shall find flames.'}"
        </blockquote>
        <p class="text-xs font-semibold theme-text-secondary leading-relaxed">
          Ninja's Soul is the unyielding philosophy binding every Ninja agent in Konohagakure.
          It commands absolute factual truth, silent deliberation, architectural respect, anti-slop rigor, and zero wasted tokens.
        </p>
      </div>

      <!-- Universal i-have-adhd Doctrine Banner -->
      <div
        class="metric-card-3d rounded-[5px] p-5 border flex items-start gap-3.5"
        style="border-color: color-mix(in srgb, var(--theme-grad-3) 28%, var(--color-border));"
      >
        <div class="w-9 h-9 rounded-[3px] flex items-center justify-center shrink-0 shadow-xs text-white" style="background: var(--theme-4gradient);">
          <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div class="space-y-1 text-xs flex-1">
          <div class="font-black text-status-warning tracking-wide uppercase flex flex-wrap items-center gap-2">
            <span>Universal i-have-adhd Doctrine Enforced Across All Souls</span>
            <span class="px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold uppercase badge-status badge-status-warning">
              Active in All 7 Spirits
            </span>
          </div>
          <p class="font-semibold theme-text-secondary leading-relaxed">
            Every shinobi subagent response in Konoha is governed by <strong>i-have-adhd</strong> output shaping: leading with the next action first, numbering multi-step tasks, ending with one concrete next step, capping visible lists to 5, and suppressing all conversational fluff.
          </p>
        </div>
      </div>

      <!-- The 5 Universal Tenets -->
      <div class="space-y-3">
        <h3 class="text-base font-black theme-text tracking-tight flex items-center gap-2">
          <svg class="w-4 h-4 text-action-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Five Universal Tenets of the Village</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each (soulData.tenets || []) as tenet, idx}
            <div
              class="metric-card-3d rounded-[5px] p-5 border flex flex-col justify-between space-y-3"
              style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));"
            >
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="w-6 h-6 rounded-[3px] flex items-center justify-center text-xs font-black text-white shrink-0 shadow-xs" style="background: var(--theme-4gradient);">
                    {idx + 1}
                  </span>
                  <h4 class="text-xs font-black theme-text truncate">{tenet.name}</h4>
                  {#if idx === 1}
                    <span class="px-1.5 py-0.5 rounded-[3px] text-[9px] font-black uppercase badge-status badge-status-warning shrink-0">
                      i-have-adhd
                    </span>
                  {/if}
                </div>
                <p class="text-xs font-semibold theme-text-secondary leading-relaxed pl-8">
                  {tenet.summary}
                </p>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- The 8 Ninja Archetypes -->
      <div class="space-y-3">
        <h3 class="text-base font-black theme-text tracking-tight flex items-center gap-2">
          <svg class="w-4 h-4 text-action-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Eight Ninja Archetypes &amp; Spirits</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {#each Object.entries(soulData.archetypes || {}) as [key, arch]}
            <div
              class="metric-card-3d rounded-[5px] p-5 border flex flex-col justify-between space-y-4"
              style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));"
            >
              <div class="space-y-3">
                <div class="flex items-center justify-between gap-2 border-b theme-border-subtle pb-2">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-[3px] flex items-center justify-center shadow-xs text-white shrink-0" style="background: var(--theme-4gradient);">
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <h4 class="text-sm font-black theme-text">
                      {arch.name || key}
                    </h4>
                  </div>
                  <span class="px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold uppercase border badge-status badge-status-info">
                    {key}
                  </span>
                </div>

                <p class="text-xs font-bold theme-text-secondary">
                  {arch.role || ""}
                </p>

                <div class="p-3 rounded-[3px] theme-bg-muted border theme-border/80">
                  <p class="text-[11px] font-medium italic theme-text leading-relaxed">
                    "{arch.voice || ""}"
                  </p>
                </div>

                {#if arch.calling}
                  <div class="space-y-1">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider theme-text-muted">Sacred Calling</span>
                    <p class="text-xs font-semibold theme-text-secondary leading-normal">
                      {arch.calling}
                    </p>
                  </div>
                {/if}

                {#if arch.adhd_shaping}
                  <div class="space-y-1 p-2.5 rounded-[3px] bg-status-warning-soft/60 border badge-statuswarning-soft/80">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-status-warning flex items-center gap-1">
                      <svg class="w-3 h-3 text-[var(--theme-warning)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>ADHD Shaping (i-have-adhd)</span>
                    </span>
                    <p class="text-[11px] font-semibold theme-text-secondary leading-normal">
                      {arch.adhd_shaping}
                    </p>
                  </div>
                {/if}

                {#if arch.antislop_skills && arch.antislop_skills.length > 0}
                  <div class="space-y-1.5 p-2.5 rounded-[3px] bg-status-info-soft/60 border badge-statusinfo-soft/80">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-action-primary flex items-center gap-1">
                      <svg class="w-3 h-3 text-action-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Anti-Slop Skills</span>
                    </span>
                    <div class="flex flex-wrap gap-1.5 pt-0.5">
                      {#each arch.antislop_skills as skill}
                        <span class="px-2 py-0.5 rounded-[3px] text-[10px] font-bold border theme-bg-surface badge-status badge-status-info shadow-xs">
                          {skill}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>

              <div class="pt-3 border-t theme-border-subtle flex items-center justify-between text-[10px] font-semibold theme-text-muted">
                <span>Archetype Spirit</span>
                <span class="text-status-success font-bold flex items-center gap-1">
                  <svg class="w-3 h-3 text-[var(--theme-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Active</span>
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}
</div>

<!-- Add Memory 3D Glass Modal -->
{#if isCreateModalOpen}
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) isCreateModalOpen = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') isCreateModalOpen = false; }}
  >
    <div
      class="modal-card modal-3d relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[3px] p-6 sm:p-8 border shadow-2xl space-y-6 glass-frost-strong animate-in zoom-in-95 duration-150"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[3px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 class="text-base font-bold" style="color: var(--color-text);">Add Persona Memory</h3>
        </div>
        <button
          type="button"
          onclick={() => { isCreateModalOpen = false; }}
          class="w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="agent-select" class="block text-xs font-bold theme-text mb-1">Target Agent</label>
            <select
              id="agent-select"
              bind:value={newMemory.agentName}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              {#each agents.filter(ag => ag.id) as ag}
                <option value={ag.id}>{ag.name}{ag.title ? ` (${ag.title})` : ""}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="memory-type-select" class="block text-xs font-bold theme-text mb-1">Memory Type</label>
            <select
              id="memory-type-select"
              bind:value={newMemory.memoryType}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              <option value="rule">Rule (Strict Mandate)</option>
              <option value="episodic">Episodic (Learning / Incident)</option>
              <option value="fact">Fact (System Knowledge)</option>
              <option value="preference">Preference (User Style)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="memory-title-input" class="block text-xs font-bold theme-text mb-1">Title (Optional)</label>
          <input
            id="memory-title-input"
            type="text"
            bind:value={newMemory.title}
            placeholder="e.g. Always enforce Pure Light mode"
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          />
        </div>

        <div>
          <label for="memory-content-input" class="block text-xs font-bold theme-text mb-1">Memory Content</label>
          <textarea
            id="memory-content-input"
            bind:value={newMemory.content}
            rows="4"
            placeholder="Specific instruction, rule, pattern, or constraint to permanently remember..."
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          ></textarea>
        </div>

        <div>
          <label for="memory-tags-input" class="block text-xs font-bold theme-text mb-1">Tags (Comma-separated)</label>
          <input
            id="memory-tags-input"
            type="text"
            bind:value={newMemory.tags}
            placeholder="ui, theme, accessibility"
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4 border-t theme-border">
        <button
          type="button"
          onclick={() => { isCreateModalOpen = false; }}
          class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={createMemory}
          class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer"
        >
          Save Memory
        </button>
      </div>
    </div>
  </div>
{/if}
