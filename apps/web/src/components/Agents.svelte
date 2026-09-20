<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
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

  onMount(loadData);
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
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Official Subagent Roster
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Ninja Subagents (7 Ranks)
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Autonomous specialized agents orchestrating tasks, audits, research, and frontend builds. Each rank embeds specialized SQLite skill references.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Total Ranks</div>
          <div class="text-xl font-black text-emerald-600">7 Active</div>
        </div>
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Skills Bound</div>
          <div class="text-xl font-black text-purple-600">{allSkills.length} Indexed</div>
        </div>
      </div>
    </div>
  </div>

  {#if error}
    <div class="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16 text-slate-600 text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Loading Ninja roster...</span>
      </div>
    </div>
  {:else}
    <div class="scene-3d grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each agents as agent}
        <div class="glass-card-3d tilt-3d flex flex-col justify-between p-6 rounded-3xl border">
          <div>
            <!-- Agent Header -->
            <div class="flex items-start justify-between gap-4 mb-4">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700 shadow-sm shrink-0">
                  <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={rankIcons[agent.name] || "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"} />
                  </svg>
                </div>
                <div>
                  <h3 class="text-base font-black text-slate-900 tracking-tight">
                    @{agent.name}
                  </h3>
                  <span class="inline-block text-[11px] font-bold text-purple-700 uppercase tracking-wider">
                    {agent.title || "Ninja Subagent"}
                  </span>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                {agent.skills ? agent.skills.length : 0} skills
              </span>
            </div>

            <p class="text-xs font-semibold text-slate-700 mb-4 leading-relaxed">
              {agent.description}
            </p>

            <!-- Model Assignment Section (bridge-served models) -->
            <div class="space-y-2 mb-6">
              <div class="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Model Assignment</span>
                {#if agent.model}
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    assigned
                  </span>
                {:else}
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-500 border border-slate-200">
                    inherit
                  </span>
                {/if}
              </div>
              {#if bridgeModels.length > 0}
                <select
                  value={agent.model || ""}
                  onchange={(e) => setAgentModel(agent, e.currentTarget.value)}
                  class="w-full p-2 rounded-xl border border-slate-200 bg-white/70 text-xs font-mono font-bold text-slate-700 cursor-pointer focus:ring-purple-500 focus:border-purple-400"
                >
                  <option value="">⤺ Inherit (host client default)</option>
                  {#each bridgeModels as m}
                    <option value={m.id}>{m.id}</option>
                  {/each}
                </select>
              {:else}
                <p class="p-2 rounded-xl border border-dashed border-slate-200 bg-white/50 text-[11px] font-semibold text-slate-500">
                  {agent.model || "inherit"} — no bridge-served models available. Start a bridge in the Bridges page to pick models.
                </p>
              {/if}
            </div>

            <!-- Embedded Skills Section -->
            <div class="space-y-3 pt-4 border-t border-slate-200">
              <div class="flex items-center justify-between text-xs font-bold text-slate-800">
                <span>Embedded Skill References</span>
                <span class="text-slate-500 font-mono text-[11px]">{agent.skills ? agent.skills.length : 0} active</span>
              </div>

              <div class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {#each getSkillsForAgent(agent) as skill}
                  {@const isChecked = agent.skills && agent.skills.includes(skill)}
                  <label class="flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-white/70 hover:bg-purple-50/50 transition-colors cursor-pointer text-xs">
                    <div class="flex items-center gap-2 min-w-0 pr-2">
                      <span class="font-mono text-xs font-bold {isChecked ? 'text-slate-900' : 'text-slate-400'} truncate" title={skill}>
                        {skill}
                      </span>
                      {#if isChecked}
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
                          active
                        </span>
                      {/if}
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onchange={() => toggleSkill(agent, skill, isChecked)}
                      class="rounded border-slate-300 text-purple-600 focus:ring-purple-500 w-4 h-4 cursor-pointer shrink-0 ml-2"
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
