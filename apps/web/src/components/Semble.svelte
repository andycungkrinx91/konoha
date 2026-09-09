<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";

  let status = $state(null);
  let savings = $state(null);
  let loading = $state(true);
  let error = $state("");

  let searchQuery = $state("");
  let searchLimit = $state(5);
  let isSearching = $state(false);
  let searchResults = $state(null);
  let searchError = $state("");

  async function loadSembleData() {
    loading = true;
    error = "";
    try {
      const [statusRes, savingsRes] = await Promise.all([
        api.get("/api/v1/semble"),
        api.get("/api/v1/semble/savings")
      ]);
      status = statusRes;
      savings = savingsRes;
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function executeSearch(e) {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    isSearching = true;
    searchError = "";
    searchResults = null;
    try {
      const res = await api.post("/api/v1/semble/search", {
        query: searchQuery.trim(),
        limit: searchLimit
      });
      searchResults = res;
    } catch (err) {
      searchError = err.message;
      await sweetAlert.fire({
        title: "Search Failed",
        text: err.message,
        icon: "error"
      });
    } finally {
      isSearching = false;
    }
  }

  onMount(loadSembleData);
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
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Default Codebase Discovery Server
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Semble MCP Engine
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          AI-powered semantic code search powered by MinishLab. Understands code intent, symbols, and architecture while burning ~98% fewer context tokens than legacy grep and file dumps.
        </p>
      </div>

      <div class="flex items-center gap-4 shrink-0">
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Saved All-Time</div>
          <div class="text-xl font-black text-emerald-600">{savings ? savings.total_saved : "—"}</div>
        </div>
        <div class="glass-card-3d px-4 py-3 rounded-2xl border text-center">
          <div class="text-xs font-bold text-slate-600">Engine Type</div>
          <div class="text-xl font-black text-sky-600">Neural + FTS</div>
        </div>
      </div>
    </div>
  </div>

  {#if error}
    <div class="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold">
      {error}
    </div>
  {/if}

  <!-- Metrics Grid with 3D Glass Cards -->
  {#if savings}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold text-slate-700 uppercase tracking-wider">
          <span>Today Savings</span>
          <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono font-bold">99%</span>
        </div>
        <div class="text-3xl font-black text-slate-900 tracking-tight mb-1">{savings.today?.tokens_saved ?? '—'}</div>
        <div class="text-xs font-semibold text-slate-700 flex items-center justify-between">
          <span>{savings.today?.calls ?? 0} search queries</span>
          <span class="text-emerald-700 font-bold">Optimal context</span>
        </div>
        <div class="w-full h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
          <div class="h-full bg-emerald-500 rounded-full" style="width: 99%"></div>
        </div>
      </div>

      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold text-slate-700 uppercase tracking-wider">
          <span>Last 7 Days</span>
          <span class="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300 font-mono font-bold">99%</span>
        </div>
        <div class="text-3xl font-black text-slate-900 tracking-tight mb-1">{savings.last_7_days?.tokens_saved ?? '—'}</div>
        <div class="text-xs font-semibold text-slate-700 flex items-center justify-between">
          <span>{savings.last_7_days?.calls ?? 0} searches</span>
          <span class="text-sky-700 font-bold">Consistently ~99%</span>
        </div>
        <div class="w-full h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
          <div class="h-full bg-sky-500 rounded-full" style="width: 99%"></div>
        </div>
      </div>

      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold text-slate-700 uppercase tracking-wider">
          <span>Total Reduction</span>
          <span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 font-mono font-bold">{savings.total_saved_pct ?? 0}%</span>
        </div>
        <div class="text-3xl font-black text-slate-900 tracking-tight mb-1">{savings.total_saved ?? '—'}</div>
        <div class="text-xs font-semibold text-slate-700 flex items-center justify-between">
          <span>{savings.total_calls ?? 0} total queries</span>
          <span class="text-purple-700 font-bold">Net Saved</span>
        </div>
        <div class="w-full h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
          <div class="h-full bg-purple-600 rounded-full" style="width: {savings.total_saved_pct ?? 0}%"></div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Interactive Search Playground in 3D Glass Card -->
  <div class="glass-card-3d rounded-3xl p-6 lg:p-8 border space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-black text-slate-900">
          Semble Search Playground
        </h3>
        <p class="text-xs font-semibold text-slate-700 mt-0.5">
          Execute real-time semantic neural queries against the active project repository.
        </p>
      </div>
      {#if status}
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border {status.available ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}">
          <span class="w-1.5 h-1.5 rounded-full {status.available ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
          {status.available ? "Engine Online" : "Engine Offline"}
        </span>
      {/if}
    </div>

    <form onsubmit={executeSearch} class="flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Describe symbol, bug, or feature (e.g. CSRF token validation logic)..."
          class="w-full pl-10 pr-4 py-3 rounded-2xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white/95 focus:ring-2 focus:ring-purple-500 focus:outline-none"
        />
        <svg class="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <div class="flex items-center gap-3">
        <select
          bind:value={searchLimit}
          class="px-3 py-3 rounded-2xl text-xs font-semibold text-slate-900 border border-slate-300 bg-white focus:ring-2 focus:ring-purple-500"
        >
          <option value={3}>Top 3</option>
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
        </select>

        <button
          type="submit"
          disabled={isSearching || !searchQuery.trim()}
          class="btn-3d px-6 py-3 rounded-2xl font-bold text-xs text-white transition-all shadow-md cursor-pointer disabled:opacity-50 shrink-0"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          {isSearching ? "Searching..." : "Search"}
        </button>
      </div>
    </form>

    <!-- Search Results Display -->
    {#if searchResults}
      <div class="space-y-4 pt-4 border-t border-slate-200">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-700">
            Found {searchResults.results ? searchResults.results.length : 0} semantic matches for "{searchQuery}"
          </span>
        </div>

        <div class="space-y-3">
          {#each searchResults.results || [] as r}
            <div class="p-4 rounded-2xl border border-slate-200 bg-white/90 space-y-2 hover:border-purple-300 transition-colors">
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs font-bold text-purple-700 break-all">
                  {r.file_path}
                </span>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                  L{r.start_line}-{r.end_line} • Score: {r.score ? r.score.toFixed(3) : "—"}
                </span>
              </div>
              <pre class="text-[11px] font-mono p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 overflow-x-auto whitespace-pre-wrap">{r.content}</pre>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
