<script>
  import { onMount } from "svelte";
  import { api, apiRequest } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";

  let agents = $state([]);
  let allSkills = $state([]);
  let bridgeModels = $state([]);
  let loading = $state(true);
  let error = $state("");

  const rankIcons = {
    sannin: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
    kage: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    jonin: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01",
    anbu: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    chunin: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
    genin: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
 "tokubetsu-jonin": "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
  };

  const OFFICIAL_AGENTS = new Set([
 'sannin',
 'genin',
 'kage',
 'chunin',
 'jonin',
 'anbu',
 'tokubetsu-jonin'
  ]);

  function isOfficialAgent(name) {
    if (!name) return false;
    const clean = String(name).toLowerCase().replace(/^(mcp_|_mcp_|mcp-)/, '');
    return OFFICIAL_AGENTS.has(clean);
  }

  const OFFICIAL_SKILLS = [
 "sannin-skill",
 "genin-skill",
 "kage-skill",
 "chunin-skill",
 "jonin-skill",
 "anbu-skill",
 "tokubetsu-jonin-skill",
 "konoha",
 "antislop",
 "i-have-adhd"
  ];

  function getSkillsForAgent(agent) {
    const activeList = agent.skills || [];
    const activeSet = new Set(activeList);
    const result = [...activeList];
    OFFICIAL_SKILLS.forEach(s => {
      if (!activeSet.has(s)) {
        result.push(s);
      }
    });
    return result;
  }

  async function loadData() {
    loading = true;
    error = "";
    try {
      agents = await api.get("/api/v1/agents");
      const skills = await api.get("/api/v1/skills?limit=1000");
      const set = new Set(OFFICIAL_SKILLS);
      (skills || []).forEach(s => {
        if (s.name) set.add(s.name);
        if (s.skill_name) set.add(s.skill_name);
      });
      (agents || []).forEach(a => {
        (a.skills || []).forEach(s => set.add(s));
      });
      allSkills = Array.from(set).sort();
      try {
        const modelsRes = await api.get("/api/v1/bridges/models");
        bridgeModels = modelsRes.models || [];
      } catch (_) {
        bridgeModels = [];
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function toggleSkill(agent, skillName, currentChecked) {
    const targetState = !currentChecked;
    try {
      await api.patch(
 "/api/v1/agents/" + encodeURIComponent(agent.name) + "/skills/" + encodeURIComponent(skillName),
        { embedded: targetState }
      );
      if (targetState) {
        if (!agent.skills) agent.skills = [];
        if (!agent.skills.includes(skillName)) agent.skills.push(skillName);
      } else if (agent.skills) {
        agent.skills = agent.skills.filter(s => s !== skillName);
      }
      agents = [...agents];
    } catch (err) {
      await sweetAlert.fire({
        title: "Toggle Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function setAgentModel(agent, modelId) {
    const target = modelId === "" ? null : modelId;
    try {
      await api.patch(
 "/api/v1/agents/" + encodeURIComponent(agent.name) + "/model",
        { model: target }
      );
      if (target) {
        agent.model = target;
      } else {
        delete agent.model;
      }
      agents = [...agents];
    } catch (err) {
      await sweetAlert.fire({
        title: "Model Assignment Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  let customModelInputs = $state({});

  async function applyCustomModel(agent) {
    const val = (customModelInputs[agent.name] || "").trim();
    await setAgentModel(agent, val);
  }

  let showCreateModal = $state(false);
  let createName = $state("");
  let createTitle = $state("");
  let createPurpose = $state("");
  let createDescription = $state("");
  let createInstructions = $state("");
  let createModel = $state("");
  let createSubmitting = $state(false);

  let showEditModal = $state(false);
  let editAgentTarget = $state(null);
  let editTitle = $state("");
  let editPurpose = $state("");
  let editDescription = $state("");
  let editInstructions = $state("");
  let editModel = $state("");
  let editSubmitting = $state(false);

  function openCreateModal() {
    createName = "";
    createTitle = "";
    createPurpose = "";
    createDescription = "";
    createInstructions = "";
    createModel = "";
    showCreateModal = true;
  }

  function openEditModal(agent) {
    if (isOfficialAgent(agent.name)) {
      sweetAlert.fire({
        title: "Protected Official Ninja",
        text: `Subagent "@${agent.name}" is a protected official Konoha ninja agent. Core attributes are immutable. You can toggle models and skills directly on the card.`,
        icon: "info"
      });
      return;
    }
    editAgentTarget = agent;
    editTitle = agent.title || "";
    editPurpose = agent.purpose || "";
    editDescription = agent.description || "";
    editInstructions = agent.instructions || "";
    editModel = agent.model || "";
    showEditModal = true;
  }

  async function handleCreateAgent() {
    if (!createName.trim()) {
      await sweetAlert.fire({ title: "Name Required", text: "Please enter a name for the custom ninja.", icon: "warning" });
      return;
    }
    createSubmitting = true;
    try {
      await api.post("/api/v1/agents", {
        name: createName.trim(),
        title: createTitle.trim() || undefined,
        purpose: createPurpose.trim() || undefined,
        description: createDescription.trim() || undefined,
        instructions: createInstructions.trim() || undefined,
        model: createModel.trim() || null
      });
      await sweetAlert.fire({ title: "Ninja Created", text: `Custom subagent "@${createName.trim()}" has been created.`, icon: "success" });
      showCreateModal = false;
      await loadData();
    } catch (err) {
      await sweetAlert.fire({ title: "Creation Failed", text: err.message, icon: "error" });
    } finally {
      createSubmitting = false;
    }
  }

  async function handleUpdateAgent() {
    if (!editAgentTarget) return;
    editSubmitting = true;
    try {
      await api.put(`/api/v1/agents/${encodeURIComponent(editAgentTarget.name)}`, {
        title: editTitle.trim(),
        purpose: editPurpose.trim(),
        description: editDescription.trim(),
        instructions: editInstructions.trim(),
        model: editModel.trim() || null
      });
      await sweetAlert.fire({ title: "Ninja Updated", text: `Custom subagent "@${editAgentTarget.name}" updated successfully.`, icon: "success" });
      showEditModal = false;
      await loadData();
    } catch (err) {
      await sweetAlert.fire({ title: "Update Failed", text: err.message, icon: "error" });
    } finally {
      editSubmitting = false;
    }
  }

  async function deleteCustomAgent(name) {
    if (isOfficialAgent(name)) {
      await sweetAlert.fire({
        title: "Protected Official Ninja",
        text: `Subagent "@${name}" is a protected official Konoha ninja agent and cannot be deleted.`,
        icon: "warning"
      });
      return;
    }

    const confirmed = await sweetAlert.fire({
      title: "Delete Custom Agent?",
      text: `Are you sure you want to delete custom agent "@${name}"?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel"
    });

    if (!confirmed) return;

    try {
      await api.delete(`/api/v1/agents/${encodeURIComponent(name)}`);
      await sweetAlert.fire({
        title: "Agent Deleted",
        text: `Custom agent "@${name}" has been deleted.`,
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Deletion Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  onMount(loadData);
</script>

<div class="space-y-8 max-w-7xl mx-auto">
  <!-- Hero Section with Light Glass Gradient & High Contrast Typography -->
  <div
    class="glass-card-3d relative overflow-hidden rounded-[5px] p-8 border transition-all duration-300"
    style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.85) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-[5px] text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Official Subagent Roster
        </div>
        <h2 class="text-2xl lg:text-3xl font-black tracking-tight" style="color: var(--color-text);">
          Ninja Subagents (Protected Village Roster)
        </h2>
        <p class="text-sm font-semibold max-w-2xl leading-relaxed" style="color: var(--color-text-muted);">
          Autonomous specialized agents orchestrating tasks, audits, research, and frontend builds. Official ninjas are permanently protected against deletion.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={openCreateModal}
          class="btn-3d btn-3d-primary px-4 py-3 rounded-[5px] text-xs font-bold text-white flex items-center gap-2 cursor-pointer shadow-md"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Add Custom Ninja
        </button>
        <div class="glass-card-3d px-4 py-3 rounded-[5px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="text-xs font-bold" style="color: var(--color-text-muted);">Official Roster</div>
          <div class="text-xl font-black text-[var(--theme-success)]">7 Protected</div>
        </div>
        <div class="glass-card-3d px-4 py-3 rounded-[5px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="text-xs font-bold" style="color: var(--color-text-muted);">Skills Bound</div>
          <div class="text-xl font-black text-action-primary">{allSkills.length} Indexed</div>
        </div>
      </div>
    </div>
  </div>

  {#if error}
    <div class="p-4 rounded-[5px] border badge-status badge-status-danger text-xs font-semibold">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16 theme-text-secondary text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-action-primary" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading Ninja roster...</span>
      </div>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 perspective-container">
      {#each agents as agent}
        <div
          class="metric-card-3d flex flex-col justify-between p-6 rounded-[5px] border"
          style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));"
        >
          <div>
            <!-- Agent Header -->
            <div class="flex items-start justify-between gap-4 mb-4">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-[5px] flex items-center justify-center shadow-md text-white shrink-0" style="background: var(--theme-4gradient); box-shadow: 0 4px 14px color-mix(in srgb, var(--theme-grad-1) 35%, transparent);">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={rankIcons[agent.name] || "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"} />
                  </svg>
                </div>
                <div>
                  <h3 class="text-base font-black tracking-tight" style="color: var(--color-text);">
                    @{agent.name}
                  </h3>
                  <span class="inline-block text-[11px] font-bold uppercase tracking-wider gradient-text">
                    {agent.title || "Ninja Subagent"}
                  </span>
                </div>
              </div>

              <div class="flex flex-col items-end gap-1">
                {#if isOfficialAgent(agent.name)}
                  <span class="px-2 py-0.5 rounded-[5px] text-[10px] font-bold badge-status badge-status-warning flex items-center gap-1" title="Protected Village Ninja - Cannot be deleted">
                    <svg class="w-3 h-3 text-[var(--theme-warning)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>Protected</span>
                  </span>
                {:else}
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      onclick={() => openEditModal(agent)}
                      class="p-1 rounded-[5px] theme-text-muted hover:text-status-info hover:bg-status-info-soft transition-colors cursor-pointer"
                      title="Edit custom ninja"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onclick={() => deleteCustomAgent(agent.name)}
                      class="p-1 rounded-[5px] theme-text-muted hover:text-[var(--theme-danger)] hover:bg-status-danger-soft transition-colors cursor-pointer"
                      title="Delete custom agent"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                {/if}
                <span class="px-2 py-0.5 rounded-[5px] text-[10px] font-mono font-bold badge-3d-subtle">
                  {agent.skills ? agent.skills.length : 0} skills
                </span>
              </div>
            </div>

            <p class="text-xs font-semibold mb-4 leading-relaxed" style="color: var(--color-text-muted);">
              {agent.description}
            </p>

            <!-- Model Assignment Section (bridge-served models) -->
            <div class="space-y-2 mb-6">
              <div class="flex items-center justify-between text-xs font-bold" style="color: var(--color-text);">
                <span>Model Assignment</span>
                {#if agent.model}
                  <span class="px-2 py-0.5 rounded-[5px] text-[10px] font-mono font-bold badge-status badge-status-success">
                    assigned
                  </span>
                {:else}
                  <span class="px-2 py-0.5 rounded-[5px] text-[10px] font-mono font-bold border" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
                    inherit
                  </span>
                {/if}
              </div>

              <div class="space-y-1.5">
                <select
                  value={agent.model || ""}
                  onchange={(e) => {
                    const val = e.currentTarget.value;
                    if (val === "__custom__") {
                      customModelInputs[agent.name] = agent.model || "";
                    } else {
                      setAgentModel(agent, val);
                    }
                  }}
                  class="w-full p-2 rounded-[5px] border text-xs font-mono font-bold cursor-pointer"
                  style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                >
                  <option value="">⤺ Inherit (host client default)</option>
                  {#if agent.model && !bridgeModels.some(m => m.id === agent.model)}
                    <option value={agent.model}>{agent.model} (Custom Assigned)</option>
                  {/if}
                  {#if bridgeModels.length > 0}
                    <optgroup label="Discovered Client / Bridge Models">
                      {#each bridgeModels as m}
                        <option value={m.id}>{m.model_name || m.id} {m.bridge ? `(${m.bridge})` : ''}</option>
                      {/each}
                    </optgroup>
                  {/if}
                  <option value="__custom__">✎ Custom model string...</option>
                </select>

                {#if customModelInputs[agent.name] !== undefined || (agent.model && !bridgeModels.some(m => m.id === agent.model))}
                  <div class="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      bind:value={customModelInputs[agent.name]}
                      placeholder="e.g. claude-3-7-sonnet"
                      class="flex-1 px-2.5 py-1.5 rounded-[5px] border text-xs font-mono"
                      style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                    />
                    <button
                      type="button"
                      onclick={() => applyCustomModel(agent)}
                      class="btn-3d px-2.5 py-1.5 rounded-[5px] text-xs font-bold text-white bg-action-primary hover:brightness-110 cursor-pointer"
                    >
                      Set
                    </button>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Embedded Skills Section -->
            <div class="space-y-3 pt-4 border-t" style="border-color: var(--color-border);">
              <div class="flex items-center justify-between text-xs font-bold" style="color: var(--color-text);">
                <span>Embedded Skill References</span>
                <span class="font-mono text-[11px]" style="color: var(--color-text-muted);">{agent.skills ? agent.skills.length : 0} active</span>
              </div>

              <div class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {#each getSkillsForAgent(agent) as skill}
                  {@const isChecked = agent.skills && agent.skills.includes(skill)}
                  <label class="flex items-center justify-between p-2 rounded-[5px] border cursor-pointer text-xs transition-colors hover:bg-black/5" style="background: var(--color-surface); border-color: var(--color-border);">
                    <div class="flex items-center gap-2 min-w-0 pr-2">
                      <span class="font-mono text-xs font-bold truncate {isChecked ? '' : 'opacity-50'}" style="color: var(--color-text);" title={skill}>
                        {skill}
                      </span>
                      {#if isChecked}
                        <span class="px-1.5 py-0.5 rounded-[5px] text-[9px] font-mono font-bold gradient-badge shrink-0">
                          active
                        </span>
                      {/if}
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onchange={() => toggleSkill(agent, skill, isChecked)}
                      class="rounded-[3px] w-4 h-4 cursor-pointer shrink-0 ml-2"
                      style="accent-color: var(--color-primary);"
                    />
                  </label>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create Custom Ninja Modal -->
{#if showCreateModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
  >
    <div
      class="modal-card modal-3d w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-[5px] border shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[5px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Create Custom Ninja Subagent</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Configure name, role, and custom instructions</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => { showCreateModal = false; }}
          class="w-7 h-7 rounded-[5px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <div>
          <label for="create-ninja-name" class="font-bold block mb-1" style="color: var(--color-text);">
            Subagent Name <span class="text-status-danger">*</span>
          </label>
          <input
            id="create-ninja-name"
            type="text"
            bind:value={createName}
            placeholder="e.g. shinobi, auditor, visualizer"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
          <p class="text-[11px] mt-1" style="color: var(--color-text-muted);">
            Unique identifier. Alphanumeric, underscores, or hyphens.
          </p>
        </div>

        <div>
          <label for="create-ninja-title" class="font-bold block mb-1" style="color: var(--color-text);">Title</label>
          <input
            id="create-ninja-title"
            type="text"
            bind:value={createTitle}
            placeholder="e.g. Visual Ninja Specialist"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="create-ninja-purpose" class="font-bold block mb-1" style="color: var(--color-text);">Purpose</label>
          <input
            id="create-ninja-purpose"
            type="text"
            bind:value={createPurpose}
            placeholder="e.g. Specialized UI component generator"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="create-ninja-desc" class="font-bold block mb-1" style="color: var(--color-text);">Description</label>
          <textarea
            id="create-ninja-desc"
            rows="2"
            bind:value={createDescription}
            placeholder="Brief explanation of when to dispatch this subagent..."
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden resize-y"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>

        <div>
          <label for="create-ninja-inst" class="font-bold block mb-1" style="color: var(--color-text);">System Instructions</label>
          <textarea
            id="create-ninja-inst"
            rows="3"
            bind:value={createInstructions}
            placeholder="Prompt and standard operating procedures for this agent..."
            class="w-full px-3 py-2 text-xs font-mono rounded-[5px] border focus:outline-hidden resize-y"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>

        <div>
          <label for="create-ninja-model" class="font-bold block mb-1" style="color: var(--color-text);">Model Assignment (Optional)</label>
          <div class="space-y-1.5">
            <select
              id="create-ninja-model"
              bind:value={createModel}
              class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            >
              <option value="">⤺ Inherit (host client default)</option>
              {#if bridgeModels.length > 0}
                <optgroup label="Discovered Client / Bridge Models">
                  {#each bridgeModels as m}
                    <option value={m.id}>{m.model_name || m.id} {m.bridge ? `(${m.bridge})` : ''}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
            <input
              type="text"
              bind:value={createModel}
              placeholder="Or custom model string..."
              class="w-full px-3 py-1.5 text-xs font-mono rounded-[5px] border focus:outline-hidden"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2.5 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => { showCreateModal = false; }}
          class="btn-3d btn-3d-secondary px-4 py-2 text-xs font-bold rounded-[5px] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={createSubmitting}
          onclick={handleCreateAgent}
          class="btn-3d btn-3d-primary px-5 py-2 text-xs font-bold rounded-[5px] text-white cursor-pointer shadow-md"
        >
          {createSubmitting ? "Creating..." : "Create Ninja"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit Custom Ninja Modal -->
{#if showEditModal && editAgentTarget}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) showEditModal = false; }}
  >
    <div
      class="modal-card modal-3d w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-[5px] border shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[5px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Edit Custom Ninja @{editAgentTarget.name}</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Update custom title, role, and instructions</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => { showEditModal = false; }}
          class="w-7 h-7 rounded-[5px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close edit modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <div>
          <label for="edit-ninja-title" class="font-bold block mb-1" style="color: var(--color-text);">Title</label>
          <input
            id="edit-ninja-title"
            type="text"
            bind:value={editTitle}
            placeholder="e.g. Visual Ninja Specialist"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="edit-ninja-purpose" class="font-bold block mb-1" style="color: var(--color-text);">Purpose</label>
          <input
            id="edit-ninja-purpose"
            type="text"
            bind:value={editPurpose}
            placeholder="e.g. Specialized UI component generator"
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="edit-ninja-desc" class="font-bold block mb-1" style="color: var(--color-text);">Description</label>
          <textarea
            id="edit-ninja-desc"
            rows="2"
            bind:value={editDescription}
            placeholder="Brief explanation of when to dispatch this subagent..."
            class="w-full px-3 py-2 text-xs rounded-[5px] border focus:outline-hidden resize-y"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>

        <div>
          <label for="edit-ninja-inst" class="font-bold block mb-1" style="color: var(--color-text);">System Instructions</label>
          <textarea
            id="edit-ninja-inst"
            rows="3"
            bind:value={editInstructions}
            placeholder="Prompt and standard operating procedures for this agent..."
            class="w-full px-3 py-2 text-xs font-mono rounded-[5px] border focus:outline-hidden resize-y"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2.5 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={() => { showEditModal = false; }}
          class="btn-3d btn-3d-secondary px-4 py-2 text-xs font-bold rounded-[5px] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={editSubmitting}
          onclick={handleUpdateAgent}
          class="btn-3d btn-3d-primary px-5 py-2 text-xs font-bold rounded-[5px] text-white cursor-pointer shadow-md"
        >
          {editSubmitting ? "Updating..." : "Save Changes"}
        </button>
      </div>
    </div>
  </div>
{/if}
