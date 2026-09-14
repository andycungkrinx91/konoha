<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";

  let doctor = $state(null);
  let loading = $state(true);
  let repairing = $state(false);
  let error = $state("");

  async function loadDoctor() {
    loading = true;
    error = "";
    try {
      doctor = await api.get("/api/v1/doctor");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function triggerRepair() {
    repairing = true;
    try {
      doctor = await api.post("/api/v1/doctor/repair", { check: "all" });
      await sweetAlert.fire({
        title: "Repair Completed",
        text: `Diagnostic audit completed successfully! ${doctor.repairsDone || 0} automated fixes applied.`,
        icon: "success"
      });
    } catch (err) {
      await sweetAlert.fire({
        title: "Repair Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      repairing = false;
    }
  }

  onMount(loadDoctor);
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
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Runtime Health & Diagnostics
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Environment Doctor
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Automated integrity audit and self-repair for 7 coding IDEs, RTK binaries, SQLite databases, and daemon processes.
        </p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={triggerRepair}
          disabled={repairing}
          class="btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          <svg class="w-4 h-4 {repairing ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {#if repairing}
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            {/if}
          </svg>
          <span>{repairing ? "Repairing..." : "Run Auto-Repair"}</span>
        </button>
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
        <span>Running diagnostics scan...</span>
      </div>
    </div>
  {:else if doctor}
    <!-- Status Summary Card -->
    <div class="glass-card-3d p-6 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 {doctor.healthy ? 'border-emerald-300 bg-emerald-50/60' : 'border-amber-300 bg-amber-50/60'}">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border {doctor.healthy ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-amber-100 text-amber-700 border-amber-300'}">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {#if doctor.healthy}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            {/if}
          </svg>
        </div>
        <div>
          <h4 class="text-base font-black text-slate-900">
            {doctor.healthy ? "All Diagnostics Healthy & Operational" : "Action Recommended"}
          </h4>
          <p class="text-xs font-semibold text-slate-700 mt-0.5">
            {doctor.results ? doctor.results.length : 0} components evaluated • {doctor.repairsDone || 0} automated fixes applied
          </p>
        </div>
      </div>
    </div>

    <!-- Diagnostic Results Grid -->
    <div class="space-y-4">
      <h3 class="text-lg font-black text-slate-900">
        System Verification Checks
      </h3>

      <div class="scene-3d grid grid-cols-1 md:grid-cols-2 gap-4">
        {#each doctor.results || [] as item}
          <div class="glass-card-3d tilt-3d p-5 rounded-2xl border flex items-start justify-between gap-4">
            <div class="space-y-1 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-black text-slate-900">
                  {item.component}
                </span>
              </div>
              <p class="text-xs font-semibold text-slate-700 leading-relaxed">
                {item.details}
              </p>
            </div>

            <span class="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase border {item.status === 'HEALTHY' || item.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : item.status === 'REPAIRED' ? 'bg-teal-100 text-teal-800 border-teal-300' : item.status === 'INFO' ? 'bg-sky-100 text-sky-800 border-sky-300' : item.status === 'WARNING' || item.status === 'INACTIVE' ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-rose-100 text-rose-800 border-rose-300'}">
              {item.status}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
