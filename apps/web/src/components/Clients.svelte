<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { uiState } from "#lib/state/uiState.svelte.js";

  let clients = $state([]);
  let loading = $state(true);
  let error = $state("");
  let actionInProgress = $state(null);

  async function loadClients() {
    loading = true;
    error = "";
    try {
      clients = await api.get("/api/v1/clients");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function setupClient(id, name) {
    if (actionInProgress) return;
    actionInProgress = id;
    try {
      await api.post("/api/v1/clients/" + id + "/setup", {});
      const target = clients.find(c => c.id === id);
      if (target) target.configured = true;
      uiState.addNotification(`Connected Konoha MCP tools for ${name}!`, "success");
      await loadClients();
    } catch (err) {
      uiState.addNotification(`Setup failed for ${name}: ${err.message}`, "error");
    } finally {
      actionInProgress = null;
    }
  }

  async function removeClient(id, name) {
    if (actionInProgress) return;
    actionInProgress = id;
    try {
      await api.post("/api/v1/clients/" + id + "/remove", {});
      const target = clients.find(c => c.id === id);
      if (target) target.configured = false;
      uiState.addNotification(`Disconnected Konoha MCP tools from ${name}.`, "info");
      await loadClients();
    } catch (err) {
      uiState.addNotification(`Disconnect failed for ${name}: ${err.message}`, "error");
    } finally {
      actionInProgress = null;
    }
  }

  onMount(loadClients);
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
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Multi-Client Integration
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Coding Clients (7 IDEs & CLIs)
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Auto-inject Konoha MCP tools and RTK output filtering into Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, and Pi (pi.dev).
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Supported Clients</div>
          <div class="text-xl font-black text-indigo-600">7 Platforms</div>
        </div>
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Connected</div>
          <div class="text-xl font-black text-emerald-600">{clients.filter(c => c.configured).length} Active</div>
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
        <span>Checking client configurations...</span>
      </div>
    </div>
  {:else}
    <div class="scene-3d grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each clients as client}
        <div class="glass-card-3d tilt-3d flex flex-col justify-between p-6 rounded-3xl border">
          <div>
            <!-- Client Header -->
            <div class="flex items-center justify-between gap-3 mb-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shadow-sm shrink-0">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 class="text-base font-black text-slate-900 tracking-tight">
                  {client.name}
                </h3>
              </div>

              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border {client.configured ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-slate-100 text-slate-700 border-slate-300'}">
                <span class="w-1.5 h-1.5 rounded-full {client.configured ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
                {client.configured ? 'Active' : 'Unconfigured'}
              </span>
            </div>

            <!-- Configuration Path -->
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 mb-6">
              <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Config Location</div>
              <div class="font-mono text-xs font-semibold text-slate-800 truncate" title={client.configPath}>
                {client.configPath}
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="relative z-30 pt-4 border-t border-slate-200 flex items-center justify-between gap-3 pointer-events-auto">
            <span class="text-[11px] font-semibold text-slate-600">
              {client.configured ? 'MCP tools enabled' : 'Ready to link'}
            </span>

            {#if client.configured}
              <button
                type="button"
                data-testid="disconnect-{client.id}"
                data-client-id="{client.id}"
                disabled={actionInProgress === client.id}
                onclick={(e) => { e.stopPropagation(); removeClient(client.id, client.name); }}
                class="btn-3d relative z-30 pointer-events-auto px-4 py-1.5 rounded-xl text-xs font-bold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none inline-flex items-center gap-1.5"
                style="transform: translateZ(25px);"
                aria-label="Disconnect {client.name}"
              >
                {#if actionInProgress === client.id}
                  <svg class="animate-spin w-3.5 h-3.5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Disconnecting...</span>
                {:else}
                  <span>Disconnect</span>
                {/if}
              </button>
            {:else}
              <button
                type="button"
                data-testid="setup-{client.id}"
                data-client-id="{client.id}"
                disabled={actionInProgress === client.id}
                onclick={(e) => { e.stopPropagation(); setupClient(client.id, client.name); }}
                class="btn-3d relative z-30 pointer-events-auto px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none inline-flex items-center gap-1.5"
                style="background-color: var(--color-primary, #7c3aed); transform: translateZ(25px);"
                aria-label="Setup {client.name}"
              >
                {#if actionInProgress === client.id}
                  <svg class="animate-spin w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Connecting...</span>
                {:else}
                  <span>Setup Integration</span>
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
