<script>
  import { onMount } from 'svelte';
  import { apiRequest } from '$lib/api.js';
  import { uiState } from '$lib/state/uiState.svelte.js';

  let query = $state('');
  let searchDepth = $state('standard');
  let numResults = $state(5);
  let isLoading = $state(false);
  let searchResults = $state([]);
  let searchedQuery = $state('');
  let engineStatus = $state(null);
  let searchLogs = $state([]);
  let showDiagnostics = $state(false);
  let searchError = $state(null);

  const quickQueries = [
    'SvelteKit 5 runes',
    'MCP protocol specification',
    'Rust RTK token killer',
    'SearXNG architecture fallback',
    'Kubernetes Helm chart scaffold'
  ];

  async function loadStatus() {
    try {
      engineStatus = await apiRequest('/api/v1/search/status');
    } catch (_) {
      engineStatus = null;
    }
  }

  async function loadLogs() {
    try {
      const res = await apiRequest('/api/v1/search/logs');
      searchLogs = res.logs || [];
    } catch (_) {
      searchLogs = [];
    }
  }

  async function handleSearch(targetQuery = null) {
    const q = (targetQuery !== null ? targetQuery : query).trim();
    if (!q) return;
    if (targetQuery !== null) query = targetQuery;

    isLoading = true;
    searchError = null;

    try {
      const res = await apiRequest('/api/v1/search', {
        method: 'POST',
        body: JSON.stringify({
          query: q,
          num_results: numResults,
          search_depth: searchDepth
        })
      });

      if (res.status === 'success' && Array.isArray(res.results)) {
        searchResults = res.results;
        searchedQuery = q;
      } else {
        searchResults = [];
        searchError = res.message || 'No search results found.';
      }
      loadStatus();
      loadLogs();
    } catch (err) {
      searchError = err.message || 'Search request failed.';
      uiState.addNotification('Web search failed: ' + err.message, 'error');
    } finally {
      isLoading = false;
    }
  }

  async function clearCache() {
    try {
      const confirmed = await uiState.confirm(
        'Clear SearXNG Cache?',
        'This will invalidate the elected instance and re-discover public candidate instances from searx.space on next search.'
      );
      if (!confirmed) return;

      await apiRequest('/api/v1/search/clear-cache', { method: 'POST' });
      uiState.alert('Cache Cleared', 'SearXNG candidate instances will re-resolve on next query.', 'success');
      loadStatus();
    } catch (err) {
      uiState.alert('Error', err.message, 'error');
    }
  }

  async function copyCitation(item) {
    const text = `[#${item.citation_id}] [${item.title}](${item.url}) - ${item.source}`;
    try {
      await navigator.clipboard.writeText(text);
      uiState.addNotification(`Copied citation #${item.citation_id} to clipboard`, 'success');
    } catch (_) {
      uiState.addNotification('Failed to copy to clipboard', 'error');
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      uiState.addNotification('Copied URL to clipboard', 'success');
    } catch (_) {
      uiState.addNotification('Failed to copy to clipboard', 'error');
    }
  }

  onMount(() => {
    loadStatus();
    loadLogs();
  });
</script>

<div class="space-y-6 max-w-6xl mx-auto">
  <!-- Page Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--color-text);">Web Search (SearXNG)</h1>
        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border tracking-wider uppercase" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
          Zero-API-Key Chain
        </span>
      </div>
      <p class="text-xs mt-1" style="color: var(--color-text-muted);">
        Autonomous fallback chain: Dynamic SearXNG ➔ DuckDuckGo HTML ➔ Startpage HTML ➔ Wikipedia OpenSearch.
      </p>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2">
      <button
        onclick={() => { showDiagnostics = !showDiagnostics; if (showDiagnostics) loadLogs(); }}
        class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-sm"
        style="background: var(--glass-card); border-color: var(--color-border); color: var(--color-text);"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{showDiagnostics ? 'Hide Diagnostics' : 'Diagnostics & Logs'}</span>
      </button>

      <button
        onclick={clearCache}
        class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] shadow-sm text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>Reset Instance</span>
      </button>
    </div>
  </div>

  <!-- Active Engine Status Pill Banner -->
  <div class="p-4 rounded-2xl border backdrop-blur-md transition-all shadow-sm flex flex-wrap items-center justify-between gap-4" style="background: var(--glass-card); border-color: var(--color-border);">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
      <div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold" style="color: var(--color-text);">Elected SearXNG Instance:</span>
          <span class="text-xs font-mono font-bold" style="color: var(--color-primary);">
            {engineStatus?.best_instance || engineStatus?.custom_url || 'Dynamic Public Selector'}
          </span>
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
        <div class="text-[11px] mt-0.5" style="color: var(--color-text-muted);">
          Cached Candidates: <span class="font-semibold" style="color: var(--color-text);">{engineStatus?.cached_candidates_count || 0}</span> ·
          Logged Queries: <span class="font-semibold" style="color: var(--color-text);">{searchLogs.length}</span> ·
          Chain: <span class="font-mono text-[10px]">SearXNG ➔ DDG ➔ Startpage ➔ Wikipedia</span>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      {#each (engineStatus?.fallbacks || ['DuckDuckGo', 'Startpage', 'Wikipedia']) as fb}
        <span class="px-2 py-0.5 rounded-lg border text-[10px] font-semibold" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
          {fb}
        </span>
      {/each}
    </div>
  </div>

  <!-- Diagnostics Drawer -->
  {#if showDiagnostics}
    <div class="p-5 rounded-2xl border backdrop-blur-md space-y-4 animate-in fade-in duration-200" style="background: var(--glass-card); border-color: var(--color-border);">
      <div class="flex items-center justify-between border-b pb-3" style="border-color: var(--color-border);">
        <h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--color-text);">Recent Search Telemetry Log (~/.konoha/searxng/search.log)</h3>
        <span class="text-[11px] font-mono" style="color: var(--color-text-muted);">{searchLogs.length} entries</span>
      </div>

      {#if searchLogs.length === 0}
        <p class="text-xs py-4 text-center" style="color: var(--color-text-muted);">No search queries logged yet.</p>
      {:else}
        <div class="max-h-60 overflow-y-auto space-y-1.5 font-mono text-[11px] pr-2">
          {#each searchLogs.slice(0, 30) as logLine}
            <div class="p-2 rounded-lg border flex items-center justify-between gap-2" style="background: var(--color-surface); border-color: var(--color-border);">
              <span class="truncate" style="color: var(--color-text);">{logLine}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Search Input Stage -->
  <div class="p-6 rounded-2xl border backdrop-blur-xl shadow-lg space-y-4" style="background: var(--glass-card); border-color: var(--color-border);">
    <form
      onsubmit={(e) => { e.preventDefault(); handleSearch(); }}
      class="flex flex-col sm:flex-row items-stretch gap-3"
    >
      <div class="relative flex-1">
        <svg class="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          bind:value={query}
          placeholder="Search the web with SearXNG (e.g. SvelteKit 5 runes, RTK benchmarks, MCP spec)..."
          class="w-full pl-12 pr-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all font-medium"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        />
        {#if query}
          <button
            type="button"
            onclick={() => query = ''}
            class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold opacity-50 hover:opacity-100"
            style="color: var(--color-text-muted);"
          >
            ✕
          </button>
        {/if}
      </div>

      <!-- Controls -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Depth Selector -->
        <select
          bind:value={searchDepth}
          class="px-3 py-3 rounded-xl border text-xs font-semibold focus:outline-none"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          <option value="standard">Standard (Fast)</option>
          <option value="deep">Deep (Multi-query)</option>
        </select>

        <!-- Count Selector -->
        <select
          bind:value={numResults}
          class="px-3 py-3 rounded-xl border text-xs font-semibold focus:outline-none"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          <option value={5}>5 results</option>
          <option value={10}>10 results</option>
          <option value={15}>15 results</option>
          <option value={25}>25 results</option>
        </select>

        <!-- Submit Button -->
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          class="px-6 py-3 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-md hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
          style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent)); color: #ffffff;"
        >
          {#if isLoading}
            <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Searching...</span>
          {:else}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Search</span>
          {/if}
        </button>
      </div>
    </form>

    <!-- Quick Queries Chips -->
    <div class="flex flex-wrap items-center gap-2 pt-1">
      <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Quick Search:</span>
      {#each quickQueries as q}
        <button
          type="button"
          onclick={() => handleSearch(q)}
          class="px-2.5 py-1 rounded-lg border text-xs transition-all hover:scale-105 font-medium"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          {q}
        </button>
      {/each}
    </div>
  </div>

  <!-- Error State -->
  {#if searchError}
    <div class="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center gap-3">
      <svg class="w-5 h-5 shrink-0 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{searchError}</span>
    </div>
  {/if}

  <!-- Search Results Stage -->
  {#if searchResults.length > 0}
    <div class="space-y-4">
      <div class="flex items-center justify-between px-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold uppercase tracking-wider" style="color: var(--color-text);">Search Results</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border" style="background: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            {searchResults.length} citations
          </span>
          <span class="text-xs font-medium" style="color: var(--color-text-muted);">
            for "{searchedQuery}"
          </span>
        </div>
      </div>

      <div class="space-y-3">
        {#each searchResults as item (item.citation_id)}
          <div
            class="p-5 rounded-2xl border backdrop-blur-md transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 relative group"
            style="background: var(--glass-card); border-color: var(--color-border);"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="space-y-1.5 flex-1">
                <!-- Badges -->
                <div class="flex flex-wrap items-center gap-2">
                  <span class="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
                    [#{item.citation_id}]
                  </span>
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-bold border tracking-wide uppercase text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                    {item.source || 'Web'}
                  </span>
                  <span class="text-[11px] font-mono truncate max-w-md" style="color: var(--color-text-muted);">
                    {item.url}
                  </span>
                </div>

                <!-- Title Link -->
                <h3 class="text-base font-bold leading-snug">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    class="hover:underline flex items-center gap-1.5 transition-colors"
                    style="color: var(--color-text);"
                  >
                    <span>{item.title}</span>
                    <svg class="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </h3>

                <!-- Snippet -->
                {#if item.snippet}
                  <p class="text-xs leading-relaxed font-normal pt-1" style="color: var(--color-text-muted);">
                    {item.snippet}
                  </p>
                {/if}
              </div>

              <!-- Quick Copy Actions -->
              <div class="flex items-center gap-1.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  title="Copy citation markdown"
                  onclick={() => copyCitation(item)}
                  class="px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1 transition-all hover:scale-105 shadow-sm"
                  style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Citation</span>
                </button>

                <button
                  type="button"
                  title="Copy link"
                  onclick={() => copyUrl(item.url)}
                  class="p-1.5 rounded-xl border text-[11px] font-semibold transition-all hover:scale-105 shadow-sm"
                  style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if !isLoading && !searchError}
    <!-- Empty Initial State Card -->
    <div class="p-12 rounded-2xl border backdrop-blur-md text-center space-y-4" style="background: var(--glass-card); border-color: var(--color-border);">
      <div class="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
        <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <div class="space-y-1 max-w-md mx-auto">
        <h3 class="text-base font-bold" style="color: var(--color-text);">Search the Web Privately</h3>
        <p class="text-xs" style="color: var(--color-text-muted);">
          Konoha dynamically queries high-uptime public SearXNG instances with fallbacks to DuckDuckGo, Startpage, and Wikipedia. No subscription or API keys required.
        </p>
      </div>
    </div>
  {/if}
</div>
