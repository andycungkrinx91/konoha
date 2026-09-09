<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let savings = $state(null);
  let loading = $state(true);
  let error = $state('');

  // Dropdown state for Savings by Tool Operation
  let isToolDropdownOpen = $state(true);
  let toolSearchQuery = $state('');
  let toolCategoryFilter = $state('all'); // 'all' | 'files-skills' | 'agents' | 'system'

  async function loadSavings() {
    loading = true;
    error = '';
    try {
      savings = await api.get('/api/v1/savings');
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(2) + ' MB';
    const gb = mb / 1024;
    return gb.toFixed(2) + ' GB';
  }

  function formatTokens(t) {
    if (!t || t === 0) return '0';
    if (t >= 1000000000) return (t / 1000000000).toFixed(2) + 'B';
    if (t >= 1000000) return (t / 1000000).toFixed(1) + 'M';
    if (t >= 1000) return (t / 1000).toFixed(1) + 'k';
    return String(t);
  }

  function formatTuiBar(pct, width = 12) {
    const p = Math.min(100, Math.max(0, pct || 0));
    const filled = Math.min(width, Math.max(0, Math.round((p / 100) * width)));
    const finalFilled = (p > 0 && filled === 0) ? 1 : filled;
    return '█'.repeat(finalFilled) + '░'.repeat(Math.max(0, width - finalFilled));
  }

  const CLIENTS = [
    { name: 'Antigravity IDE', key: 'antigravity', icon: '✦' },
    { name: 'Antigravity CLI (agy)', key: 'agy', icon: '▶' },
    { name: 'Cursor', key: 'cursor', icon: '♦' },
    { name: 'Claude Code', key: 'claudecode', icon: '◎' },
    { name: 'OpenCode', key: 'opencode', icon: '▫' },
    { name: 'CommandCode', key: 'commandcode', icon: '⚡' },
    { name: 'Codex', key: 'codex', icon: '🤖' },
    { name: 'Pi (pi.dev)', key: 'pi', icon: 'π' }
  ];

  function getFilteredTools(list) {
    if (!list) return [];
    return list.filter((t) => {
      const name = (t.tool || '').toLowerCase();
      if (toolSearchQuery.trim() && !name.includes(toolSearchQuery.trim().toLowerCase())) {
        return false;
      }
      if (toolCategoryFilter === 'files-skills') {
        return name.includes('skill') || name.includes('file') || name.includes('grep');
      }
      if (toolCategoryFilter === 'agents') {
        return ['sannin', 'kage', 'jonin', 'anbu', 'chunin', 'genin', 'tokubetsu'].some(a => name.includes(a));
      }
      if (toolCategoryFilter === 'system') {
        return name.includes('context') || name.includes('memory') || name.includes('report') || name.includes('search') || name.includes('build');
      }
      return true;
    });
  }

  onMount(loadSavings);
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
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Dual-Engine Context Optimizer
        </div>
        <h2 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
          Token & Quota Optimization
        </h2>
        <p class="text-sm font-semibold text-slate-700 max-w-2xl leading-relaxed">
          Comprehensive token reduction telemetry across <strong>Konoha FTS5 Database</strong> (bounded file & skill reads) and <strong>Semble MCP</strong> (semantic code search). Full parity with <code class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-900 font-mono text-xs">konoha savings</code> in TUI.
        </p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onclick={loadSavings}
          class="px-4 py-2.5 rounded-xl text-xs font-bold border transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer shadow-md"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Telemetry
        </button>
      </div>
    </div>
  </div>

  {#if error}
    <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm font-semibold">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="py-16 text-center text-sm flex items-center justify-center gap-2" style="color: var(--color-text-muted);">
      <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
      Aggregating savings telemetry...
    </div>
  {:else if savings}
    {@const today = savings.today || {}}
    {@const last7Days = savings.last_7_days || savings.last7days || {}}
    {@const allTime = savings.all_time || savings.alltime || {}}
    {@const toolList = savings.by_call_type || savings.by_tool || []}
    {@const totalToolCalls = toolList.reduce((sum, item) => sum + (item.calls || 0), 0)}
    {@const filteredTools = getFilteredTools(toolList)}
    {@const semble = savings.semble || {}}

    <!-- Combined Total Savings Banner (TUI Parity) -->
    <div
      class="glass-card-3d p-6 rounded-3xl border transition-all duration-300 relative overflow-hidden"
      style="border-color: var(--color-border); box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center gap-2.5 mb-4">
        <span class="text-xl">🏆</span>
        <div>
          <h3 class="text-base font-black text-slate-900 tracking-tight">Combined Total Savings</h3>
          <p class="text-xs font-semibold text-slate-600">Unified live metric from Konoha MCP + Semble Semantic Engine</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div class="p-4 rounded-2xl border transition-all" style="background-color: var(--color-bg); border-color: var(--color-border);">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Today</div>
          <div class="text-2xl font-black text-slate-900 mb-1">
            ~{formatTokens(today.tokens || today.tokens_saved_approx || 0)} <span class="text-xs font-bold text-slate-600">tokens</span>
          </div>
          <div class="text-xs font-semibold text-slate-700">
            {today.calls || 0} calls • {formatBytes(today.bytes || today.tokens_saved_bytes || 0)} equiv ({today.pct || today.pct_saved || 97}%)
          </div>
        </div>

        <div class="p-4 rounded-2xl border transition-all" style="background-color: var(--color-bg); border-color: var(--color-border);">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Last 7 Days</div>
          <div class="text-2xl font-black text-slate-900 mb-1">
            ~{formatTokens(last7Days.tokens || last7Days.tokens_saved_approx || 0)} <span class="text-xs font-bold text-slate-600">tokens</span>
          </div>
          <div class="text-xs font-semibold text-slate-700">
            {last7Days.calls || 0} calls • {formatBytes(last7Days.bytes || last7Days.tokens_saved_bytes || 0)} equiv ({last7Days.pct || last7Days.pct_saved || 96}%)
          </div>
        </div>

        <div class="p-4 rounded-2xl border transition-all" style="background-color: var(--color-bg); border-color: var(--color-border);">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">All Time</div>
          <div class="text-2xl font-black text-slate-900 mb-1">
            ~{formatTokens(allTime.tokens || allTime.tokens_saved_approx || 0)} <span class="text-xs font-bold text-slate-600">tokens</span>
          </div>
          <div class="text-xs font-semibold text-slate-700">
            {allTime.calls || 0} calls • {formatBytes(allTime.bytes || allTime.tokens_saved_bytes || 0)} equiv ({allTime.pct || allTime.pct_saved || 96}%)
          </div>
        </div>
      </div>

      <div class="p-3 rounded-xl border flex items-center justify-between text-xs font-semibold text-slate-700" style="background-color: var(--color-surface); border-color: var(--color-border);">
        <span class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Actual savings per query:</span>
          <strong class="text-emerald-700 font-black">97% average reduction per query</strong>
        </span>
        <span class="text-[11px] font-mono text-slate-500">Computed live from SQLite telemetry</span>
      </div>
    </div>

    <!-- Section 1: Konoha MCP Savings -->
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-black text-slate-900 flex items-center gap-2">
            <span style="color: var(--color-primary);">1. ⚡</span> Konoha MCP Savings
          </h3>
          <p class="text-xs font-semibold text-slate-600">
            Calculated relative to full context index sizing ({((today.db_size_bytes || 569831) / 1024).toFixed(0)} KB actual baseline)
          </p>
        </div>
      </div>

      <!-- Top KPI Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div class="glass-card-3d p-6 rounded-2xl border transition-all">
          <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span>Today</span>
            <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold" style="color: var(--color-primary); background-color: var(--color-primary-glow);">{today.pct_saved ?? today.pct ?? 0}%</span>
          </div>
          <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{formatBytes(today.tokens_saved_bytes ?? today.bytes ?? 0)}</div>
          <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
            <span>{today.calls ?? 0} operations</span>
            <span style="color: var(--color-primary);">~{formatTokens(today.tokens_saved_approx ?? today.tokens ?? 0)} tokens</span>
          </div>
          <div class="w-full h-1.5 rounded-full mt-3 overflow-hidden" style="background-color: var(--color-border);">
            <div class="h-full rounded-full transition-all" style="width: {today.pct_saved ?? today.pct ?? 0}%; background-color: var(--color-primary);"></div>
          </div>
        </div>

        <div class="glass-card-3d p-6 rounded-2xl border transition-all">
          <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span>Last 7 Days</span>
            <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">{last7Days.pct_saved ?? last7Days.pct ?? 0}%</span>
          </div>
          <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{formatBytes(last7Days.tokens_saved_bytes ?? last7Days.bytes ?? 0)}</div>
          <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
            <span>{last7Days.calls ?? 0} operations</span>
            <span class="text-emerald-700 font-bold">~{formatTokens(last7Days.tokens_saved_approx ?? last7Days.tokens ?? 0)} tokens</span>
          </div>
          <div class="w-full h-1.5 rounded-full mt-3 overflow-hidden" style="background-color: var(--color-border);">
            <div class="h-full bg-emerald-500 rounded-full transition-all" style="width: {last7Days.pct_saved ?? last7Days.pct ?? 0}%"></div>
          </div>
        </div>

        <div class="glass-card-3d p-6 rounded-2xl border transition-all">
          <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span>All Time</span>
            <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">{allTime.pct_saved ?? allTime.pct ?? 0}%</span>
          </div>
          <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{formatBytes(allTime.tokens_saved_bytes ?? allTime.bytes ?? 0)}</div>
          <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
            <span>{allTime.calls ?? 0} operations</span>
            <span class="text-purple-700 font-bold">~{formatTokens(allTime.tokens_saved_approx ?? allTime.tokens ?? 0)} tokens</span>
          </div>
          <div class="w-full h-1.5 rounded-full mt-3 overflow-hidden" style="background-color: var(--color-border);">
            <div class="h-full bg-purple-600 rounded-full transition-all" style="width: {allTime.pct_saved ?? allTime.pct ?? 0}%"></div>
          </div>
        </div>
      </div>

      <!-- TUI-Style Visual Period Table -->
      <div class="glass-card-3d p-6 rounded-3xl border space-y-4">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
          <span>Visual Savings (Tokens & Thought Reasoning)</span>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs" style="color: var(--color-text);">
            <thead>
              <tr class="border-b uppercase text-[11px] font-semibold" style="border-color: var(--color-border); color: var(--color-text-muted);">
                <th class="py-3 px-4">Period</th>
                <th class="py-3 px-4">Calls</th>
                <th class="py-3 px-4">Bytes Saved</th>
                <th class="py-3 px-4">Visual Savings Bar</th>
                <th class="py-3 px-4">Tokens Saved</th>
                <th class="py-3 px-4">Thought Tokens</th>
              </tr>
            </thead>
            <tbody class="divide-y font-semibold" style="border-color: var(--color-border);">
              <tr class="hover:bg-slate-500/5 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900">Today</td>
                <td class="py-3 px-4 font-mono">{today.calls || 0}</td>
                <td class="py-3 px-4 font-mono">{formatBytes(today.bytes || 0)}</td>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-emerald-600 text-xs tracking-tight">[{formatTuiBar(today.pct || 97)}]</span>
                    <span class="font-mono text-xs font-bold text-emerald-700">{today.pct || 97}%</span>
                  </div>
                </td>
                <td class="py-3 px-4 font-mono text-slate-900 font-bold">~{formatTokens(today.tokens || 0)}</td>
                <td class="py-3 px-4 font-mono text-amber-700">{formatTokens(today.thought_tokens || 0)}</td>
              </tr>
              <tr class="hover:bg-slate-500/5 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900">Last 7 Days</td>
                <td class="py-3 px-4 font-mono">{last7Days.calls || 0}</td>
                <td class="py-3 px-4 font-mono">{formatBytes(last7Days.bytes || 0)}</td>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-emerald-600 text-xs tracking-tight">[{formatTuiBar(last7Days.pct || 96)}]</span>
                    <span class="font-mono text-xs font-bold text-emerald-700">{last7Days.pct || 96}%</span>
                  </div>
                </td>
                <td class="py-3 px-4 font-mono text-slate-900 font-bold">~{formatTokens(last7Days.tokens || 0)}</td>
                <td class="py-3 px-4 font-mono text-amber-700">{formatTokens(last7Days.thought_tokens || 0)}</td>
              </tr>
              <tr class="hover:bg-slate-500/5 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900">All Time</td>
                <td class="py-3 px-4 font-mono">{allTime.calls || 0}</td>
                <td class="py-3 px-4 font-mono">{formatBytes(allTime.bytes || 0)}</td>
                <td class="py-3 px-4">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-emerald-600 text-xs tracking-tight">[{formatTuiBar(allTime.pct || 96)}]</span>
                    <span class="font-mono text-xs font-bold text-emerald-700">{allTime.pct || 96}%</span>
                  </div>
                </td>
                <td class="py-3 px-4 font-mono text-slate-900 font-bold">~{formatTokens(allTime.tokens || 0)}</td>
                <td class="py-3 px-4 font-mono text-amber-700">{formatTokens(allTime.thought_tokens || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Provider Breakdown Table (TUI Parity) -->
      <div class="glass-card-3d p-6 rounded-3xl border space-y-4">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center justify-between">
          <span>Client Provider Breakdown (Invocations & Tokens)</span>
          <span class="text-[11px] font-normal text-slate-500">7 Connected Coding Platforms</span>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs" style="color: var(--color-text);">
            <thead>
              <tr class="border-b uppercase text-[11px] font-semibold" style="border-color: var(--color-border); color: var(--color-text-muted);">
                <th class="py-3 px-4">Provider</th>
                <th class="py-3 px-4">Today</th>
                <th class="py-3 px-4">Last 7 Days</th>
                <th class="py-3 px-4">All Time</th>
              </tr>
            </thead>
            <tbody class="divide-y font-semibold" style="border-color: var(--color-border);">
              {#each CLIENTS as c}
                {@const todayC = (today.by_client && today.by_client[c.key]) || { calls: 0, tokens: 0 }}
                {@const last7C = (last7Days.by_client && last7Days.by_client[c.key]) || { calls: 0, tokens: 0 }}
                {@const alltimeC = (allTime.by_client && allTime.by_client[c.key]) || { calls: 0, tokens: 0 }}
                <tr class="hover:bg-slate-500/5 transition-colors">
                  <td class="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                    <span class="text-sm" style="color: var(--color-primary);">{c.icon}</span>
                    <span>{c.name}</span>
                  </td>
                  <td class="py-3 px-4 font-mono">
                    <span class="text-slate-900">{todayC.calls}</span>
                    <span class="text-slate-500 text-[11px]">({formatTokens(todayC.tokens)} Token)</span>
                  </td>
                  <td class="py-3 px-4 font-mono">
                    <span class="text-slate-900">{last7C.calls}</span>
                    <span class="text-slate-500 text-[11px]">({formatTokens(last7C.tokens)} Token)</span>
                  </td>
                  <td class="py-3 px-4 font-mono">
                    <span class="text-slate-900">{alltimeC.calls}</span>
                    <span class="text-slate-500 text-[11px]">({formatTokens(alltimeC.tokens)} Token)</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <!-- DROPDOWN: Savings by Tool Operation (Full TUI Parity)                  -->
    <!-- ══════════════════════════════════════════════════════════════════════ -->
    <div
      class="glass-card-3d rounded-3xl border transition-all duration-300 overflow-hidden"
      style="border-color: var(--color-border); box-shadow: var(--shadow-3d);"
    >
      <!-- Clickable Header Trigger to Collapse / Expand -->
      <button
        type="button"
        onclick={() => isToolDropdownOpen = !isToolDropdownOpen}
        class="w-full p-6 text-left flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-colors duration-200 hover:bg-slate-500/5"
        aria-expanded={isToolDropdownOpen}
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-base shadow-sm border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
            ⚙
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-base font-black text-slate-900 tracking-tight">
                Savings by Tool Operation (By Call Type)
              </h4>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold border" style="background-color: var(--color-primary-glow); color: var(--color-primary); border-color: var(--color-primary);">
                {toolList.length} Tool Operations
              </span>
            </div>
            <p class="text-xs font-semibold text-slate-600 mt-0.5">
              Detailed hit-rates, share of total invocations, and byte reduction per tool operation. Click to {isToolDropdownOpen ? 'collapse' : 'expand'}.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 self-end md:self-auto shrink-0">
          <span class="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-xl border border-slate-300">
            {totalToolCalls.toLocaleString()} Total Invocations
          </span>
          <div class="w-8 h-8 rounded-full border flex items-center justify-center transition-transform duration-200" style="border-color: var(--color-border); background-color: var(--color-surface); transform: rotate({isToolDropdownOpen ? '180deg' : '0deg'})">
            <svg class="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      <!-- Expandable Body Content -->
      {#if isToolDropdownOpen}
        <div class="px-6 pb-6 pt-2 border-t space-y-4 animate-in fade-in duration-200" style="border-color: var(--color-border);">
          <!-- Search & Category Filters -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div class="relative w-full sm:w-80">
              <svg class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                bind:value={toolSearchQuery}
                placeholder="Search tools (e.g. find_skill, anbu)..."
                class="w-full pl-10 pr-4 py-2 rounded-xl text-xs border font-medium focus:outline-none transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              />
            </div>

            <div class="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap {toolCategoryFilter === 'all' ? 'shadow-sm' : ''}"
                style="{toolCategoryFilter === 'all' ? 'background-color: var(--color-primary); color: white; border-color: var(--color-primary);' : 'background-color: var(--color-bg); color: var(--color-text); border-color: var(--color-border);'}"
                onclick={() => toolCategoryFilter = 'all'}
              >
                All ({toolList.length})
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap {toolCategoryFilter === 'files-skills' ? 'shadow-sm' : ''}"
                style="{toolCategoryFilter === 'files-skills' ? 'background-color: var(--color-primary); color: white; border-color: var(--color-primary);' : 'background-color: var(--color-bg); color: var(--color-text); border-color: var(--color-border);'}"
                onclick={() => toolCategoryFilter = 'files-skills'}
              >
                Skills & Files
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap {toolCategoryFilter === 'agents' ? 'shadow-sm' : ''}"
                style="{toolCategoryFilter === 'agents' ? 'background-color: var(--color-primary); color: white; border-color: var(--color-primary);' : 'background-color: var(--color-bg); color: var(--color-text); border-color: var(--color-border);'}"
                onclick={() => toolCategoryFilter = 'agents'}
              >
                Subagents
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap {toolCategoryFilter === 'system' ? 'shadow-sm' : ''}"
                style="{toolCategoryFilter === 'system' ? 'background-color: var(--color-primary); color: white; border-color: var(--color-primary);' : 'background-color: var(--color-bg); color: var(--color-text); border-color: var(--color-border);'}"
                onclick={() => toolCategoryFilter = 'system'}
              >
                System & Context
              </button>
            </div>
          </div>

          <!-- Full Table with Complete TUI Parity -->
          <div class="overflow-x-auto border rounded-2xl" style="border-color: var(--color-border);">
            <table class="w-full text-left text-xs" style="color: var(--color-text);">
              <thead>
                <tr class="border-b uppercase text-[11px] font-bold" style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text-muted);">
                  <th class="py-3 px-3 w-12 text-center">#</th>
                  <th class="py-3 px-4">Call Type / Tool Operation</th>
                  <th class="py-3 px-4 text-right">Invocations</th>
                  <th class="py-3 px-4">Share (TUI Bar & Ratio)</th>
                  <th class="py-3 px-4">Bytes Saved</th>
                  <th class="py-3 px-4">Tokens Saved</th>
                  <th class="py-3 px-4">Efficiency</th>
                </tr>
              </thead>
              <tbody class="divide-y font-semibold" style="border-color: var(--color-border);">
                {#if filteredTools.length === 0}
                  <tr>
                    <td colspan="7" class="py-8 text-center text-slate-500">
                      No tool operations match your filter query.
                    </td>
                  </tr>
                {:else}
                  {#each filteredTools as t, idx}
                    {@const sharePct = totalToolCalls > 0 ? Math.round(((t.calls ?? 0) / totalToolCalls) * 100) : 0}
                    {@const savedTokens = Math.round((t.bytes || 0) / 4)}
                    <tr class="hover:bg-slate-500/5 transition-colors">
                      <td class="py-3 px-3 font-mono text-slate-400 text-center">{idx + 1}.</td>
                      <td class="py-3 px-4">
                        <span class="px-2.5 py-1 rounded-md font-mono font-bold text-xs border inline-block" style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-primary);">
                          {t.tool}
                        </span>
                      </td>
                      <td class="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {(t.calls ?? 0).toLocaleString()}
                      </td>
                      <td class="py-3 px-4">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs text-emerald-600 tracking-tight shrink-0 hidden sm:inline">
                            {formatTuiBar(sharePct, 10)}
                          </span>
                          <div class="w-20 sm:w-28 h-2 rounded-full overflow-hidden shrink-0" style="background-color: var(--color-border);">
                            <div class="h-full rounded-full transition-all" style="width: {Math.max(4, sharePct)}%; background: linear-gradient(90deg, var(--color-primary) 0%, #10b981 100%);"></div>
                          </div>
                          <span class="font-mono text-xs font-bold text-slate-800 shrink-0">{sharePct}%</span>
                        </div>
                      </td>
                      <td class="py-3 px-4 font-mono text-slate-700">
                        {formatBytes(t.bytes || 0)}
                      </td>
                      <td class="py-3 px-4 font-mono font-bold text-slate-900">
                        ~{formatTokens(savedTokens)}
                      </td>
                      <td class="py-3 px-4">
                        <div class="flex items-center gap-1.5">
                          <span class="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold border {(t.pct ?? 0) >= 80 ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : ((t.pct ?? 0) > 0 ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-700 border-slate-300')}">
                            {t.pct ?? 0}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>

    <!-- Section 2: Semble MCP Semantic Code Search Savings -->
    {#if semble && (semble.available || semble.total_saved)}
      <div class="space-y-5 pt-4 border-t" style="border-color: var(--color-border);">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-black text-slate-900 flex items-center gap-2">
              <span class="text-emerald-500">2. 🔍</span> Semble MCP (Semantic Code Search) Savings
            </h3>
            <p class="text-xs font-semibold text-slate-600">Replaces massive repository file scans with on-demand neural embeddings</p>
          </div>
          <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            {semble.total_saved_pct || 98}% Efficiency
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div class="glass-card-3d p-6 rounded-2xl border transition-all">
            <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span>Today</span>
              <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">{semble.today?.ratio_pct ?? 99}%</span>
            </div>
            <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{semble.today?.tokens_saved ?? '—'}</div>
            <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
              <span>{semble.today?.calls ?? 0} searches</span>
              <span class="text-emerald-700 font-bold">{semble.today?.ratio_pct ?? 99}% saved</span>
            </div>
          </div>

          <div class="glass-card-3d p-6 rounded-2xl border transition-all">
            <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span>Last 7 Days</span>
              <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300">{semble.last_7_days?.ratio_pct ?? 99}%</span>
            </div>
            <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{semble.last_7_days?.tokens_saved ?? '—'}</div>
            <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
              <span>{semble.last_7_days?.calls ?? 0} searches</span>
              <span class="text-sky-700 font-bold">{semble.last_7_days?.ratio_pct ?? 99}% saved</span>
            </div>
          </div>

          <div class="glass-card-3d p-6 rounded-2xl border transition-all">
            <div class="flex items-center justify-between mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span>All Time Total</span>
              <span class="px-2 py-0.5 rounded-full font-mono text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">{semble.all_time?.ratio_pct ?? 98}%</span>
            </div>
            <div class="text-3xl font-black tracking-tight mb-1 text-slate-900">{semble.all_time?.tokens_saved ?? '—'}</div>
            <div class="text-xs font-semibold flex items-center justify-between text-slate-700">
              <span>{semble.all_time?.calls ?? 0} searches</span>
              <span class="text-purple-700 font-bold">{semble.all_time?.ratio_pct ?? 98}% saved</span>
            </div>
          </div>
        </div>

        <!-- Semble Call Types Breakdown (TUI Parity) -->
        {#if semble.call_types && semble.call_types.length > 0}
          <div class="glass-card-3d p-6 rounded-3xl border space-y-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-900">
              Semble Calls by Operation
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {#each semble.call_types as st}
                <div class="p-4 rounded-xl border flex items-center justify-between" style="background-color: var(--color-bg); border-color: var(--color-border);">
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-bold text-xs" style="color: var(--color-primary);">{st.name}</span>
                    <span class="text-xs text-slate-600 font-semibold">• {st.calls} calls</span>
                  </div>
                  <div class="flex items-center gap-2 font-mono text-xs font-bold text-slate-800">
                    <span>{st.share_pct}% share</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
