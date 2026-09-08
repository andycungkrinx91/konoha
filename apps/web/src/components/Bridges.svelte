<script>
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { sweetAlert } from "$lib/sweetAlert.svelte.js";

  let bridges = $state([]);
  let status = $state(null);
  let loading = $state(true);
  let error = $state("");
  let showCreateModal = $state(false);
  let gatewayBusy = $state(false);
  let showModelsModal = $state(false);
  let models = $state([]);
  let loadingModels = $state(false);
  let modelsSearch = $state("");
  let selectedBridgeFilter = $state("all");

  let newBridge = $state({
    name: "",
    port: 9001,
    provider: "openai",
    model: "",
    target_url: ""
  });

  async function loadData() {
    loading = true;
    error = "";
    try {
      bridges = await api.get("/api/v1/bridges");
      status = await api.get("/api/v1/bridges/status");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function startGateway() {
    gatewayBusy = true;
    try {
      await api.post("/api/v1/bridges/gateway/start");
      await sweetAlert.fire({
        title: "Gateway Started",
        text: "Bridge Proxy Gateway is running on port 19999.",
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Start Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      gatewayBusy = false;
    }
  }

  async function stopGateway() {
    const confirmed = await sweetAlert.confirm({
      title: "Stop Gateway?",
      text: "Stopping the Bridge Proxy Gateway will interrupt local model routing on port 19999.",
      icon: "warning",
      confirmText: "Stop Gateway",
      cancelText: "Cancel"
    });
    if (!confirmed) return;

    gatewayBusy = true;
    try {
      await api.post("/api/v1/bridges/gateway/stop");
      await sweetAlert.fire({
        title: "Gateway Stopped",
        text: "Bridge Proxy Gateway daemon has been stopped.",
        icon: "info"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Stop Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      gatewayBusy = false;
    }
  }

  async function restartGateway() {
    gatewayBusy = true;
    try {
      await api.post("/api/v1/bridges/gateway/restart");
      await sweetAlert.fire({
        title: "Gateway Restarted",
        text: "Bridge Proxy Gateway restarted successfully on port 19999.",
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Restart Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      gatewayBusy = false;
    }
  }

  async function openModelsModal() {
    showModelsModal = true;
    loadingModels = true;
    try {
      const res = await api.get("/api/v1/bridges/models");
      models = res.models || [];
    } catch (err) {
      models = [];
      await sweetAlert.fire({
        title: "Failed to Fetch Models",
        text: err.message,
        icon: "error"
      });
    } finally {
      loadingModels = false;
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      await sweetAlert.fire({
        title: "Copied!",
        text: `Model ID copied to clipboard: ${text}`,
        icon: "success",
        timer: 1500
      });
    } catch (_) {}
  }

  let filteredModels = $derived(
    models.filter(m => {
      const matchesSearch = !modelsSearch || 
        m.id.toLowerCase().includes(modelsSearch.toLowerCase()) || 
        m.model_name.toLowerCase().includes(modelsSearch.toLowerCase());
      const matchesBridge = selectedBridgeFilter === 'all' || m.bridge === selectedBridgeFilter;
      return matchesSearch && matchesBridge;
    })
  );

  let uniqueBridges = $derived([
    ...new Set(models.map(m => m.bridge))
  ]);

  async function toggleBridge(bridge) {
    try {
      await api.patch("/api/v1/bridges/" + encodeURIComponent(bridge.name), {
        enabled: !bridge.enabled
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Update Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function deleteBridge(name) {
    const confirmed = await sweetAlert.confirm({
      title: "Delete Bridge?",
      text: `Are you sure you want to permanently delete bridge "${name}"?`,
      icon: "warning",
      confirmText: "Delete",
      cancelText: "Keep"
    });
    if (!confirmed) return;

    try {
      await api.del("/api/v1/bridges/" + encodeURIComponent(name));
      await sweetAlert.fire({
        title: "Deleted",
        text: `Bridge "${name}" was successfully removed.`,
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Delete Failed",
        text: err.message,
        icon: "error"
      });
    }
  }

  async function createBridge(e) {
    e.preventDefault();
    if (!newBridge.name || !newBridge.port) {
      await sweetAlert.fire({
        title: "Validation Error",
        text: "Bridge name and port are required.",
        icon: "warning"
      });
      return;
    }
    try {
      await api.post("/api/v1/bridges", newBridge);
      showCreateModal = false;
      newBridge = {
        name: "",
        port: 9001,
        provider: "openai",
        model: "",
        target_url: ""
      };
      await sweetAlert.fire({
        title: "Bridge Created",
        text: "New LLM proxy bridge configured and registered!",
        icon: "success"
      });
      await loadData();
    } catch (err) {
      await sweetAlert.fire({
        title: "Creation Failed",
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
    class="relative overflow-hidden rounded-3xl p-8 border shadow-xl transition-all duration-300"
    style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.82) 100%), var(--color-primary-glow); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
  >
    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
          Local LLM Proxy Gateway
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Bridge Management
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Dynamic model routing via Bridge Router (port 19999). Expose local models (Ollama, vLLM, LMStudio) and cloud APIs with unified routing.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={openModelsModal}
          class="btn-3d inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-800 border border-slate-300 hover:border-purple-400 transition-all shadow-sm cursor-pointer"
        >
          <svg class="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span>Served Models</span>
        </button>

        <button
          type="button"
          onclick={() => { showCreateModal = true; }}
          class="btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-white transition-all shadow-md cursor-pointer"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          <span>Create Bridge</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Gateway Status Banner with Real Daemon Controls -->
  {#if status}
    <div class="glass-card-3d p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex items-center gap-3.5">
        {#if status.gateway_running}
          <span class="relative flex h-3.5 w-3.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
          </span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-emerald-800 uppercase tracking-wide">Proxy Gateway Online</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                :{status.router_port || 19999}
              </span>
            </div>
            <p class="text-xs font-semibold text-slate-600 mt-0.5">
              Unified router multiplexing all active bridges on 127.0.0.1:{status.router_port || 19999}
            </p>
          </div>
        {:else}
          <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500"></span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-amber-800 uppercase tracking-wide">Proxy Gateway Stopped</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300">
                :{status.router_port || 19999}
              </span>
            </div>
            <p class="text-xs font-semibold text-slate-600 mt-0.5">
              Service daemon is not running. Start gateway to route requests via port {status.router_port || 19999}.
            </p>
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-2 shrink-0">
        {#if status.gateway_running}
          <button
            type="button"
            onclick={restartGateway}
            disabled={gatewayBusy}
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 transition-all cursor-pointer disabled:opacity-50"
            title="Restart the Gateway service"
          >
            Restart
          </button>
          <button
            type="button"
            onclick={stopGateway}
            disabled={gatewayBusy}
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 transition-all cursor-pointer disabled:opacity-50"
            title="Stop the Gateway service"
          >
            Stop
          </button>
        {:else}
          <button
            type="button"
            onclick={startGateway}
            disabled={gatewayBusy}
            class="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Start the Gateway service"
          >
            Start Gateway
          </button>
        {/if}

        <div class="ml-2 px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200">
          {bridges.filter(b => b.enabled).length} / {bridges.length} Enabled
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-between">
      <span>{error}</span>
      <button type="button" onclick={loadData} class="underline hover:text-rose-900 cursor-pointer">Retry</button>
    </div>
  {/if}

  {#if loading}
    <div class="p-12 text-center text-slate-500 font-bold text-xs">
      <div class="animate-spin w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-2"></div>
      Loading configured bridges...
    </div>
  {:else if bridges.length === 0}
    <div class="glass-card-3d p-12 text-center rounded-3xl border">
      <div class="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-200 text-purple-600 flex items-center justify-center mx-auto mb-3">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </div>
      <p class="text-sm font-bold text-slate-800 mb-4">No LLM proxy bridges configured yet.</p>
      <button
        type="button"
        onclick={() => { showCreateModal = true; }}
        class="btn-3d inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 cursor-pointer"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
        </svg>
        <span>Add your first bridge</span>
      </button>
    </div>
  {:else}
    <!-- Bridges Table in 3D Glass Card with High Contrast Typography -->
    <div class="glass-card-3d rounded-3xl border overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
            <tr>
              <th class="py-3.5 px-6">Bridge Name</th>
              <th class="py-3.5 px-6">Port</th>
              <th class="py-3.5 px-6">Provider</th>
              <th class="py-3.5 px-6">Target URL</th>
              <th class="py-3.5 px-6">Runtime Port</th>
              <th class="py-3.5 px-6">Configured</th>
              <th class="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each bridges as b}
              <tr class="hover:bg-purple-50/40 transition-colors">
                <td class="py-4 px-6 font-black text-slate-900 font-mono">
                  {b.name}
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-300">
                    :{b.port}
                  </span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                    {b.provider}
                  </span>
                </td>
                <td class="py-4 px-6 text-slate-700 font-mono text-[11px]">
                  {b.target_url || "—"}
                </td>
                <td class="py-4 px-6">
                  {#if b.running}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                      Listening :{b.port}
                    </span>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                      <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                      Inactive
                    </span>
                  {/if}
                </td>
                <td class="py-4 px-6">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onclick={() => toggleBridge(b)}
                      class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer {b.enabled ? 'bg-emerald-500' : 'bg-slate-300'}"
                      title="Toggle active status"
                    >
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow {b.enabled ? 'translate-x-4.5' : 'translate-x-1'}"></span>
                    </button>
                    <span class="text-[11px] font-bold {b.enabled ? 'text-emerald-700' : 'text-slate-500'}">
                      {b.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </td>
                <td class="py-4 px-6 text-right">
                  <button
                    type="button"
                    onclick={() => deleteBridge(b.name)}
                    class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete bridge"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- Create Bridge 3D Glass Modal -->
  {#if showCreateModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
      <div
        class="relative w-full max-w-lg rounded-3xl p-6 sm:p-8 border shadow-2xl space-y-6"
        style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.92) 100%); border-color: rgba(226, 232, 240, 0.95); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.18);"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-black text-slate-900">Configure New Bridge</h3>
          <button
            type="button"
            onclick={() => { showCreateModal = false; }}
            class="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onsubmit={createBridge} class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="bridge-name" class="block text-xs font-bold text-slate-800 mb-1">Bridge Name</label>
              <input
                id="bridge-name"
                type="text"
                bind:value={newBridge.name}
                placeholder="e.g. ollama-local"
                required
                class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label for="bridge-port" class="block text-xs font-bold text-slate-800 mb-1">Port</label>
              <input
                id="bridge-port"
                type="number"
                bind:value={newBridge.port}
                placeholder="9001"
                required
                class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="bridge-provider" class="block text-xs font-bold text-slate-800 mb-1">Provider Type</label>
              <select
                id="bridge-provider"
                bind:value={newBridge.provider}
                class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
              >
                <option value="openai">OpenAI Compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama</option>
                <option value="vllm">vLLM</option>
              </select>
            </div>
            <div>
              <label for="bridge-model" class="block text-xs font-bold text-slate-800 mb-1">Default Model (Optional)</label>
              <input
                id="bridge-model"
                type="text"
                bind:value={newBridge.model}
                placeholder="e.g. qwen2.5-coder:7b"
                class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          <div>
            <label for="bridge-target" class="block text-xs font-bold text-slate-800 mb-1">Upstream Target URL (Optional)</label>
            <input
              id="bridge-target"
              type="text"
              bind:value={newBridge.target_url}
              placeholder="http://127.0.0.1:11434/v1"
              class="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onclick={() => { showCreateModal = false; }}
              class="btn-3d px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn-3d px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer"
              style="background-color: var(--color-primary, #7c3aed);"
            >
              Create Bridge
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Served Models Modal with 3D Glass & Search -->
  {#if showModelsModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
      <div
        class="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl p-6 border bg-white shadow-2xl overflow-hidden"
        style="border-color: var(--color-border); box-shadow: var(--shadow-3d);"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="p-1.5 rounded-lg bg-purple-50 text-purple-600 border border-purple-200">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </span>
              <h3 class="text-lg font-black text-slate-900">Served Models via Proxy Gateway</h3>
            </div>
            <p class="text-xs font-semibold text-slate-600">
              Aggregated model aliases routed through active bridges. Target with model prefix in requests.
            </p>
          </div>
          <button
            type="button"
            onclick={() => { showModelsModal = false; }}
            class="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Filter & Search Controls -->
        <div class="py-4 flex flex-col sm:flex-row items-center gap-3 shrink-0">
          <div class="relative flex-1 w-full">
            <input
              type="text"
              bind:value={modelsSearch}
              placeholder="Search model by ID, name, or provider..."
              class="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-semibold text-slate-900 border border-slate-300 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all"
            />
            <svg class="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {#if uniqueBridges.length > 1}
            <div class="flex items-center gap-1.5 shrink-0 overflow-x-auto w-full sm:w-auto">
              <button
                type="button"
                onclick={() => { selectedBridgeFilter = 'all'; }}
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer {selectedBridgeFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}"
              >
                All ({models.length})
              </button>
              {#each uniqueBridges as bName}
                <button
                  type="button"
                  onclick={() => { selectedBridgeFilter = bName; }}
                  class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer {selectedBridgeFilter === bName ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}"
                >
                  {bName} ({models.filter(m => m.bridge === bName).length})
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Models List Container -->
        <div class="flex-1 overflow-y-auto border border-slate-200 rounded-2xl">
          {#if loadingModels}
            <div class="p-12 text-center text-slate-500">
              <div class="animate-spin w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-3"></div>
              <p class="text-xs font-bold">Querying models from active bridge endpoints...</p>
            </div>
          {:else if filteredModels.length === 0}
            <div class="p-12 text-center text-slate-500">
              <p class="text-sm font-bold text-slate-700">No models found</p>
              <p class="text-xs mt-1">Make sure target bridges are running and have valid endpoint URLs configured.</p>
            </div>
          {:else}
            <table class="w-full text-left text-xs">
              <thead class="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold text-slate-700 uppercase tracking-wider sticky top-0 bg-slate-50 z-10">
                <tr>
                  <th class="py-3 px-4">Gateway Alias ID</th>
                  <th class="py-3 px-4">Base Model</th>
                  <th class="py-3 px-4">Bridge</th>
                  <th class="py-3 px-4">Provider / Owner</th>
                  <th class="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 font-mono text-[11px]">
                {#each filteredModels as m}
                  <tr class="hover:bg-purple-50/30 transition-colors">
                    <td class="py-2.5 px-4 font-bold text-purple-700">
                      {m.id}
                    </td>
                    <td class="py-2.5 px-4 text-slate-800">
                      {m.model_name}
                    </td>
                    <td class="py-2.5 px-4">
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {m.bridge}
                      </span>
                    </td>
                    <td class="py-2.5 px-4 text-slate-600 font-sans text-xs">
                      {m.owned_by || m.bridge}
                    </td>
                    <td class="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onclick={() => copyToClipboard(m.id)}
                        class="px-2.5 py-1 rounded-md text-[10px] font-bold font-sans bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-700 border border-slate-200 transition-colors cursor-pointer"
                        title="Copy alias ID to clipboard"
                      >
                        Copy ID
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <!-- Modal Footer -->
        <div class="pt-4 mt-2 flex items-center justify-between text-xs font-semibold text-slate-600 shrink-0">
          <span>Showing {filteredModels.length} of {models.length} served model(s)</span>
          <button
            type="button"
            onclick={() => { showModelsModal = false; }}
            class="px-4 py-2 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
