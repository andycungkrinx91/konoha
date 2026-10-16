<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  const POLL_MS = 5000;
  const HISTORY_POINTS = 60;

  let metrics = $state(null);
  let loading = $state(true);
  let error = $state('');
  let lastUpdated = $state(null);

  let cpuHistory = $state([]);
  let procCpuHistory = $state([]);
  let memHistory = $state([]);

  function pushSample(history, value) {
    if (typeof value !== 'number' || isNaN(value)) return history;
    const next = [...history, value];
    return next.length > HISTORY_POINTS ? next.slice(next.length - HISTORY_POINTS) : next;
  }

  async function loadMetrics() {
    try {
      const data = await api.get('/api/v1/system/metrics');
      metrics = data;
      error = '';
      lastUpdated = new Date();
      cpuHistory = pushSample(cpuHistory, data.system?.cpu?.system_pct ?? 0);
      procCpuHistory = pushSample(procCpuHistory, data.system?.cpu?.process_pct ?? 0);
      memHistory = pushSample(memHistory, data.system?.memory?.used_pct ?? 0);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, POLL_MS);
    return () => clearInterval(interval);
  });

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatTokens(t) {
    if (!t || t === 0) return '0';
    if (t >= 1e9) return (t / 1e9).toFixed(2) + 'B';
    if (t >= 1e6) return (t / 1e6).toFixed(1) + 'M';
    if (t >= 1e3) return (t / 1e3).toFixed(1) + 'k';
    return String(t);
  }

  // SVG sparkline path over a normalized 100x34 viewport
  function sparklinePath(history) {
    if (!history || history.length < 2) return '';
    const max = Math.max(10, ...history);
    const step = 100 / (HISTORY_POINTS - 1);
    const offset = HISTORY_POINTS - history.length;
    return history.map((v, i) => {
      const x = (offset + i) * step;
      const y = 34 - (Math.min(v, max) / max) * 32;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  function sparklineArea(history) {
    const line = sparklinePath(history);
    if (!line) return '';
    return `${line} L100,34 L0,34 Z`;
  }

  function ringStroke(pct) {
    const p = Math.min(100, Math.max(0, pct || 0));
    return { strokeDashoffset: String(100 - p) };
  }

  function pctTone(pct) {
    const p = pct ?? 0;
    if (p >= 85) return '#dc2626';
    if (p >= 60) return '#d97706';
    return '#059669';
  }

  const sdlcStatusColors = {
    in_progress: '#2563eb',
    completed: '#059669',
    blocked: '#dc2626',
    pending: '#d97706',
    verified: '#7c3aed'
  };

  const rootDisk = $derived(metrics?.system?.disk?.mounts?.[0] ?? null);

  function formatUsd(usd) {
    if (typeof usd !== 'number' || isNaN(usd)) return '$0.00';
    return usd >= 1000 ? '$' + (usd / 1000).toFixed(1) + 'k' : '$' + usd.toFixed(2);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-300">
  <!-- Page Header -->
  <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
    <div>
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl flex items-center justify-center border shadow-lg text-white" style="background: var(--theme-4gradient); border-color: transparent; box-shadow: 0 4px 14px var(--color-primary-glow);">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v7h7M21 21v-7h-7M3 10a9 9 0 0115-5.7L21 8M21 14a9 9 0 01-15 5.7L3 16" />
          </svg>
        </div>
        <div>
          <h2 class="text-2xl lg:text-3xl font-black tracking-tight" style="color: var(--color-text);">Mission Control Dashboard</h2>
          <p class="text-sm font-medium" style="color: var(--color-text-muted);">Real-time system &amp; village telemetry — refreshed every {POLL_MS / 1000}s</p>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-3">
      {#if lastUpdated}
        <span class="text-xs font-mono px-3 py-1.5 rounded-full border" style="color: var(--color-text-muted); border-color: var(--color-border);">
          Updated {lastUpdated.toLocaleTimeString()}
        </span>
      {/if}
      <span class="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border" style="color: #059669; border-color: #059669; background: rgba(5,150,105,0.08);">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        LIVE
      </span>
    </div>
  </div>

  {#if error}
    <div class="glass-card-3d p-5 rounded-2xl border" style="border-color: #fecaca; background: rgba(220,38,38,0.05);">
      <p class="text-sm font-semibold" style="color: #dc2626;">Failed to load metrics: {error}</p>
      <p class="text-xs mt-1" style="color: var(--color-text-muted);">Ensure the Konoha web server is running and reachable.</p>
    </div>
  {/if}

  {#if loading && !metrics}
    <div class="glass-card-3d p-10 rounded-3xl border text-center" style="border-color: var(--color-border);">
      <p class="text-sm font-semibold animate-pulse" style="color: var(--color-text-muted);">Collecting telemetry from the village…</p>
    </div>
  {/if}

  {#if metrics}
    <!-- Reusable 3D Theme Gradient Definitions for Metric Graphics -->
    <svg class="sr-only" aria-hidden="true" width="0" height="0">
      <defs>
        <linearGradient id="dashboard-3d-sparkline-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--theme-grad-1)" stop-opacity="0.38" />
          <stop offset="50%" stop-color="var(--theme-grad-2)" stop-opacity="0.18" />
          <stop offset="100%" stop-color="var(--theme-grad-4)" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient id="dashboard-3d-sparkline-proc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--theme-grad-2)" stop-opacity="0.38" />
          <stop offset="50%" stop-color="var(--theme-grad-3)" stop-opacity="0.18" />
          <stop offset="100%" stop-color="var(--theme-grad-1)" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient id="dashboard-3d-sparkline-mem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--theme-grad-3)" stop-opacity="0.38" />
          <stop offset="50%" stop-color="var(--theme-grad-4)" stop-opacity="0.18" />
          <stop offset="100%" stop-color="var(--theme-grad-2)" stop-opacity="0.02" />
        </linearGradient>
        <linearGradient id="dashboard-3d-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--theme-grad-1)" />
          <stop offset="33%" stop-color="var(--theme-grad-2)" />
          <stop offset="66%" stop-color="var(--theme-grad-3)" />
          <stop offset="100%" stop-color="var(--theme-grad-4)" />
        </linearGradient>
        <linearGradient id="dashboard-3d-gauge-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--theme-grad-1)" />
          <stop offset="40%" stop-color="var(--theme-grad-2)" />
          <stop offset="80%" stop-color="var(--theme-grad-3)" />
          <stop offset="100%" stop-color="var(--theme-grad-4)" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Stat Panel Row (3D Grafana Telemetry Cards) -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 perspective-container">
      <div class="metric-card-3d p-5 rounded-2xl border transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">System CPU</p>
          <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--theme-grad-1);"></span>
        </div>
        <div class="flex items-end gap-1 mt-2">
          <span class="text-4xl font-black tabular-nums font-mono" style="color: pctTone(metrics.system.cpu.system_pct);">{metrics.system.cpu.system_pct ?? '—'}</span>
          <span class="text-lg font-bold mb-0.5" style="color: var(--color-text-muted);">%</span>
        </div>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" class="w-full h-10 mt-2">
          <path d={sparklineArea(cpuHistory)} fill="url(#dashboard-3d-sparkline-area)" />
          <path d={sparklinePath(cpuHistory)} fill="none" stroke="url(#dashboard-3d-stroke)" stroke-width="2" vector-effect="non-scaling-stroke" class="sparkline-3d-stroke" />
        </svg>
      </div>

      <div class="metric-card-3d p-5 rounded-2xl border transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Konoha Process CPU</p>
          <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--theme-grad-2);"></span>
        </div>
        <div class="flex items-end gap-1 mt-2">
          <span class="text-4xl font-black tabular-nums font-mono" style="color: pctTone(metrics.system.cpu.process_pct);">{metrics.system.cpu.process_pct ?? '—'}</span>
          <span class="text-lg font-bold mb-0.5" style="color: var(--color-text-muted);">%</span>
        </div>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" class="w-full h-10 mt-2">
          <path d={sparklineArea(procCpuHistory)} fill="url(#dashboard-3d-sparkline-proc)" />
          <path d={sparklinePath(procCpuHistory)} fill="none" stroke="url(#dashboard-3d-stroke)" stroke-width="2" vector-effect="non-scaling-stroke" class="sparkline-3d-stroke" />
        </svg>
      </div>

      <div class="metric-card-3d p-5 rounded-2xl border transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-3) 28%, var(--color-border));">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">System Memory</p>
          <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--theme-grad-3);"></span>
        </div>
        <div class="flex items-end gap-1 mt-2">
          <span class="text-4xl font-black tabular-nums font-mono" style="color: pctTone(metrics.system.memory.used_pct);">{metrics.system.memory.used_pct}</span>
          <span class="text-lg font-bold mb-0.5" style="color: var(--color-text-muted);">%</span>
        </div>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" class="w-full h-10 mt-2">
          <path d={sparklineArea(memHistory)} fill="url(#dashboard-3d-sparkline-mem)" />
          <path d={sparklinePath(memHistory)} fill="none" stroke="url(#dashboard-3d-stroke)" stroke-width="2" vector-effect="non-scaling-stroke" class="sparkline-3d-stroke" />
        </svg>
        <p class="text-[11px] font-mono mt-1" style="color: var(--color-text-muted);">{formatBytes(metrics.system.memory.used_bytes)} / {formatBytes(metrics.system.memory.total_bytes)}</p>
      </div>

      <div class="metric-card-3d p-5 rounded-2xl border transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-4) 28%, var(--color-border));">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Process Uptime</p>
          <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--theme-grad-4);"></span>
        </div>
        <div class="flex items-end gap-1 mt-2">
          <span class="text-3xl font-black tabular-nums font-mono" style="color: var(--color-text);">{formatUptime(metrics.system.uptime_seconds)}</span>
        </div>
        <p class="text-[11px] font-mono mt-3" style="color: var(--color-text-muted);">Heap {formatBytes(metrics.system.memory.process_heap_used_bytes)} / {formatBytes(metrics.system.memory.process_heap_total_bytes)}</p>
        <p class="text-[11px] font-mono" style="color: var(--color-text-muted);">RSS {formatBytes(metrics.system.memory.process_rss_bytes)}</p>
      </div>

      <div class="metric-card-3d p-5 rounded-2xl border transition-all" style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));">
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Disk (Root)</p>
          <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--theme-grad-1);"></span>
        </div>
        <div class="flex items-end gap-1 mt-2">
          <span class="text-4xl font-black tabular-nums font-mono" style="color: pctTone(rootDisk?.used_pct);">{rootDisk?.used_pct ?? '—'}</span>
          <span class="text-lg font-bold mb-0.5" style="color: var(--color-text-muted);">%</span>
        </div>
        <div class="h-2 rounded-full overflow-hidden progress-track-3d mt-3">
          <div class="h-full rounded-full transition-all duration-500 progress-fill-3d" style="width: {rootDisk?.used_pct ?? 0}%;"></div>
        </div>
        <p class="text-[11px] font-mono mt-1.5" style="color: var(--color-text-muted);">{rootDisk ? formatBytes(rootDisk.used_bytes) + ' / ' + formatBytes(rootDisk.total_bytes) : '—'}</p>
      </div>
    </div>

    <!-- Gauges + Host Info (3D Cylindrical Metric Gauges) -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 perspective-container">
      <div class="metric-card-3d p-6 rounded-3xl border flex flex-col items-center" style="border-color: color-mix(in srgb, var(--theme-grad-1) 30%, var(--color-border));">
        <div class="flex items-center justify-between w-full">
          <p class="text-xs font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">CPU Utilization</p>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono gradient-badge">Gauge</span>
        </div>
        <div class="relative w-40 h-40 my-3">
          <svg viewBox="0 0 42 42" class="w-full h-full -rotate-90">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="color-mix(in srgb, var(--theme-grad-1) 12%, var(--color-border))" stroke-width="4.5" />
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="url(#dashboard-3d-gauge-grad)" stroke-width="4.5"
              stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset={ringStroke(metrics.system.cpu.system_pct).strokeDashoffset}
              class="metric-gauge-3d" />
          </svg>
          <div class="absolute inset-2 flex flex-col items-center justify-center rounded-full gauge-center-3d">
            <span class="text-3xl font-black tabular-nums font-mono" style="color: var(--color-text);">{metrics.system.cpu.system_pct ?? '—'}%</span>
            <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">System</span>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2 w-full text-center">
          <div class="rounded-xl border p-2" style="border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border)); background: color-mix(in srgb, var(--theme-grad-1) 3%, var(--color-surface));">
            <p class="text-[10px] font-bold uppercase" style="color: var(--color-text-muted);">1m</p>
            <p class="text-sm font-black tabular-nums font-mono" style="color: var(--color-text);">{metrics.system.cpu.load_avg_1m ?? '—'}</p>
          </div>
          <div class="rounded-xl border p-2" style="border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border)); background: color-mix(in srgb, var(--theme-grad-2) 3%, var(--color-surface));">
            <p class="text-[10px] font-bold uppercase" style="color: var(--color-text-muted);">5m</p>
            <p class="text-sm font-black tabular-nums font-mono" style="color: var(--color-text);">{metrics.system.cpu.load_avg_5m ?? '—'}</p>
          </div>
          <div class="rounded-xl border p-2" style="border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border)); background: color-mix(in srgb, var(--theme-grad-3) 3%, var(--color-surface));">
            <p class="text-[10px] font-bold uppercase" style="color: var(--color-text-muted);">15m</p>
            <p class="text-sm font-black tabular-nums font-mono" style="color: var(--color-text);">{metrics.system.cpu.load_avg_15m ?? '—'}</p>
          </div>
        </div>
      </div>

      <div class="metric-card-3d p-6 rounded-3xl border flex flex-col items-center" style="border-color: color-mix(in srgb, var(--theme-grad-2) 30%, var(--color-border));">
        <div class="flex items-center justify-between w-full">
          <p class="text-xs font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Memory Utilization</p>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono gradient-badge">RAM</span>
        </div>
        <div class="relative w-40 h-40 my-3">
          <svg viewBox="0 0 42 42" class="w-full h-full -rotate-90">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="color-mix(in srgb, var(--theme-grad-2) 12%, var(--color-border))" stroke-width="4.5" />
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="url(#dashboard-3d-gauge-grad)" stroke-width="4.5"
              stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset={ringStroke(metrics.system.memory.used_pct).strokeDashoffset}
              class="metric-gauge-3d" />
          </svg>
          <div class="absolute inset-2 flex flex-col items-center justify-center rounded-full gauge-center-3d">
            <span class="text-3xl font-black tabular-nums font-mono" style="color: var(--color-text);">{metrics.system.memory.used_pct}%</span>
            <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Used</span>
          </div>
        </div>
        <div class="w-full space-y-1.5 text-center">
          <p class="text-xs font-mono" style="color: var(--color-text-muted);">Free {formatBytes(metrics.system.memory.free_bytes)}</p>
          <div class="h-2.5 rounded-full overflow-hidden progress-track-3d">
            <div class="h-full rounded-full transition-all duration-500 progress-fill-3d" style="width: {metrics.system.memory.used_pct}%;"></div>
          </div>
        </div>
      </div>

      <div class="metric-card-3d p-6 rounded-3xl border flex flex-col items-center" style="border-color: color-mix(in srgb, var(--theme-grad-3) 30%, var(--color-border));">
        <div class="flex items-center justify-between w-full">
          <p class="text-xs font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Disk Utilization</p>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono gradient-badge">Storage</span>
        </div>
        <div class="relative w-40 h-40 my-3">
          <svg viewBox="0 0 42 42" class="w-full h-full -rotate-90">
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="color-mix(in srgb, var(--theme-grad-3) 12%, var(--color-border))" stroke-width="4.5" />
            <circle cx="21" cy="21" r="15.915" fill="none" stroke="url(#dashboard-3d-gauge-grad)" stroke-width="4.5"
              stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset={ringStroke(rootDisk?.used_pct).strokeDashoffset}
              class="metric-gauge-3d" />
          </svg>
          <div class="absolute inset-2 flex flex-col items-center justify-center rounded-full gauge-center-3d">
            <span class="text-3xl font-black tabular-nums font-mono" style="color: var(--color-text);">{rootDisk?.used_pct ?? '—'}%</span>
            <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Root FS</span>
          </div>
        </div>
        <div class="w-full space-y-2">
          {#each metrics.system.disk?.mounts || [] as m}
            <div>
              <div class="flex justify-between text-[10px] font-mono mb-1" style="color: var(--color-text-muted);">
                <span class="truncate">{m.mount}</span>
                <span>{formatBytes(m.used_bytes)} / {formatBytes(m.total_bytes)}</span>
              </div>
              <div class="h-2 rounded-full overflow-hidden progress-track-3d">
                <div class="h-full rounded-full transition-all duration-500 progress-fill-3d" style="width: {m.used_pct ?? 0}%;"></div>
              </div>
            </div>
          {/each}
          {#if metrics.system.disk?.db_size_bytes}
            <p class="text-[10px] font-mono pt-1 text-center" style="color: var(--color-text-muted);">Konoha DB {formatBytes(metrics.system.disk.db_size_bytes)}</p>
          {/if}
        </div>
      </div>

      <div class="metric-card-3d p-6 rounded-3xl border" style="border-color: color-mix(in srgb, var(--theme-grad-4) 30%, var(--color-border));">
        <div class="flex items-center justify-between mb-4">
          <p class="text-xs font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Host Information</p>
          <span class="w-2 h-2 rounded-full" style="background: var(--theme-grad-4);"></span>
        </div>
        <dl class="space-y-2.5 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="font-medium" style="color: var(--color-text-muted);">Hostname</dt>
            <dd class="font-mono font-semibold truncate" style="color: var(--color-text);">{metrics.system.hostname}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="font-medium" style="color: var(--color-text-muted);">Platform</dt>
            <dd class="font-mono font-semibold" style="color: var(--color-text);">{metrics.system.platform} / {metrics.system.arch}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="font-medium" style="color: var(--color-text-muted);">Node.js</dt>
            <dd class="font-mono font-semibold" style="color: var(--color-text);">{metrics.system.node}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="font-medium" style="color: var(--color-text-muted);">CPU Cores</dt>
            <dd class="font-mono font-semibold" style="color: var(--color-text);">{metrics.system.cpu.count}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="font-medium" style="color: var(--color-text-muted);">OS Uptime</dt>
            <dd class="font-mono font-semibold" style="color: var(--color-text);">{formatUptime(metrics.system.os_uptime_seconds)}</dd>
          </div>
        </dl>
        <div class="mt-4 pt-4 border-t" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">CPU Model</p>
          <p class="text-xs font-mono leading-relaxed" style="color: var(--color-text);">{metrics.system.cpu.model || '—'}</p>
        </div>
      </div>
    </div>

    <!-- Konoha Feature Metrics (3D Grid & Telemetry Cubes) -->
    <div class="metric-card-3d p-6 rounded-3xl border" style="border-color: color-mix(in srgb, var(--theme-grad-1) 32%, var(--color-border));">
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center text-white" style="background: var(--theme-4gradient); box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-grad-1) 40%, transparent);">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-black tracking-tight" style="color: var(--color-text);">Konoha Feature Metrics</h3>
            <p class="text-xs font-semibold" style="color: var(--color-text-muted);">Real-time telemetry across MCP skills, agents, and gateways</p>
          </div>
        </div>
        <span class="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full font-mono gradient-badge">Village Telemetry</span>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 perspective-container">
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-1) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Ninja Agents</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-text);">{metrics.features.agents ?? 0}</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-2) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Skills Installed</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-text);">{metrics.features.skills ?? 0}</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{(metrics.features.skills ?? 0) - (metrics.features.vectorized_skills ?? 0)} awaiting embedding</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-3) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Vectorized Skills</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-primary);">{metrics.features.vectorized_skills ?? 0}</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.embedded_chunks ?? 0}/{metrics.features.vectors_total_chunks ?? 0} chunks embedded</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-4) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Bridges Running</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: #059669;">{metrics.features.bridges_running ?? 0}<span class="text-base" style="color: var(--color-text-muted);">/{metrics.features.bridges_total ?? 0}</span></p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.bridges_enabled ?? 0} enabled</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-1) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">SDLC Tasks</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-text);">{metrics.features.sdlc_total ?? 0}</p>
          <div class="flex flex-wrap gap-1 mt-1.5">
            {#each Object.entries(metrics.features.sdlc_by_status || {}) as [status, count]}
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full font-mono" style="color: {sdlcStatusColors[status] || '#475569'}; background: {(sdlcStatusColors[status] || '#475569')}1a;">
                {status} {count}
              </span>
            {/each}
          </div>
          <p class="text-[10px] font-mono mt-1.5" style="color: var(--color-text-muted);">DoR {metrics.features.sdlc_dor_mode ?? 'advisory'} · review {metrics.features.sdlc_review_mode ?? 'self'}</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-2) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Clients Configured</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-text);">{metrics.features.clients_configured ?? 0}<span class="text-base" style="color: var(--color-text-muted);">/{metrics.features.clients_total ?? 7}</span></p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-3) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Tokens Saved Today</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-accent);">{formatTokens(metrics.features.savings_today_tokens)}</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.savings_today_calls ?? 0} calls · {metrics.features.savings_today_pct ?? 0}% cut</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-4) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Tokens Saved All-Time</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-accent);">{formatTokens(metrics.features.savings_alltime_tokens)}</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.savings_alltime_pct ?? 0}% reduction</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-1) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Persona Memories</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-text);">{metrics.features.persona_memories ?? 0}</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.persona_projects ?? 0} projects</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-2) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Web Search Engine</p>
          <p class="text-2xl font-black mt-1" style="color: {metrics.features.search_engine_active ? '#059669' : 'var(--color-text-muted)'};">
            {metrics.features.search_engine_active ? 'ACTIVE' : 'IDLE'}
          </p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">SearXNG chain</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-3) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Gateway (19999)</p>
          <p class="text-2xl font-black mt-1" style="color: {(metrics.features.bridges_total ?? 0) > 0 ? '#059669' : 'var(--color-text-muted)'};">ROUTED</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">Bridge Router</p>
        </div>
        <div class="metric-card-3d rounded-2xl border p-4" style="border-color: color-mix(in srgb, var(--theme-grad-4) 22%, var(--color-border));">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">MCP Servers</p>
          <p class="text-2xl font-black tabular-nums font-mono mt-1" style="color: var(--color-primary);">3</p>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">konoha · semble · aislop</p>
        </div>
      </div>

      <!-- Feature detail panels -->
      <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Agent Roster</p>
          <div class="flex flex-wrap gap-1.5">
            {#each metrics.features.agent_names || [] as name}
              <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono badge-3d-subtle">{name}</span>
            {/each}
            {#if !(metrics.features.agent_names || []).length}
              <p class="text-xs" style="color: var(--color-text-muted);">No agents registered.</p>
            {/if}
          </div>
        </div>

        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Bridge Fleet</p>
          <div class="space-y-1.5">
            {#each metrics.features.bridges_detail || [] as b}
              <div class="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5" style="border-color: var(--color-border);">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-2 h-2 rounded-full shrink-0" style="background: {b.running ? '#059669' : (b.enabled ? '#d97706' : '#94a3b8')};"></span>
                  <span class="text-xs font-bold font-mono truncate" style="color: var(--color-text);">{b.name}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">{b.provider} · :{b.port}</span>
                  <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full font-mono" style={b.enabled ? 'color:#059669;background:rgba(5,150,105,0.1);' : 'color:#94a3b8;background:rgba(148,163,184,0.15);'}>{b.enabled ? 'on' : 'off'}</span>
                </div>
              </div>
            {/each}
            {#if !(metrics.features.bridges_detail || []).length}
              <p class="text-xs" style="color: var(--color-text-muted);">No bridges configured.</p>
            {/if}
          </div>
        </div>

        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Client Coverage</p>
          <div class="flex flex-wrap gap-1.5">
            {#each metrics.features.clients_detail || [] as c}
              <span class="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg font-mono border"
                style={c.configured ? 'color:#059669;border-color:rgba(5,150,105,0.4);background:rgba(5,150,105,0.08);' : 'color:var(--color-text-muted);border-color:var(--color-border);'}>
                {#if c.configured}
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                {:else}
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                {/if}
                {c.name}
              </span>
            {/each}
          </div>
        </div>

        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-3" style="color: var(--color-text-muted);">Token Savings Detail</p>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
              <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">Today</p>
              <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(metrics.features.savings_today_tokens)}</p>
              <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{metrics.features.savings_today_calls ?? 0} calls · {metrics.features.savings_today_pct ?? 0}%</p>
            </div>
            <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
              <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">7 Days</p>
              <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(metrics.features.savings_7d_tokens)}</p>
              <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{metrics.features.savings_7d_calls ?? 0} calls · {metrics.features.savings_7d_pct ?? 0}%</p>
            </div>
            <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
              <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">All-Time</p>
              <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(metrics.features.savings_alltime_tokens)}</p>
              <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{metrics.features.savings_alltime_calls ?? 0} calls · {metrics.features.savings_alltime_pct ?? 0}%</p>
            </div>
          </div>
          <p class="text-[10px] font-mono mt-2.5 pt-2.5 border-t text-center" style="border-color: var(--color-border); color: var(--color-text-muted);">≈ {formatUsd(metrics.features.savings_alltime_usd)} net saved all-time</p>
        </div>

        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Skills &amp; Vector Index</p>
          <div class="flex flex-wrap gap-1.5 mb-3">
            {#each Object.entries(metrics.features.skills_by_type || {}) as [type, count]}
              <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono badge-3d-subtle">{type} {count}</span>
            {/each}
          </div>
          <div class="flex justify-between text-[10px] font-mono mb-1" style="color: var(--color-text-muted);">
            <span>Embedded chunks</span>
            <span>{metrics.features.embedded_chunks ?? 0}/{metrics.features.vectors_total_chunks ?? 0}</span>
          </div>
          <div class="h-2 rounded-full overflow-hidden border" style="border-color: var(--color-border);">
            <div class="h-full rounded-full transition-all duration-500" style="width: {(metrics.features.vectors_total_chunks ?? 0) > 0 ? ((metrics.features.embedded_chunks ?? 0) / metrics.features.vectors_total_chunks) * 100 : 0}%; background: var(--color-primary);"></div>
          </div>
          <p class="text-[10px] font-mono mt-2" style="color: var(--color-text-muted);">IBM Granite 384-dim · MS MARCO MiniLM Cross-Encoder · RRF + Cosine RAG</p>
        </div>

        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">SDLC Governance</p>
          <div class="flex flex-wrap gap-1.5 mb-3">
            <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: {(metrics.features.sdlc_dor_mode ?? 'advisory') === 'enforced' ? '#dc2626' : '#d97706'}; border-color: var(--color-border);">DoR: {metrics.features.sdlc_dor_mode ?? 'advisory'}</span>
            <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: var(--color-text); border-color: var(--color-border);">Review: {metrics.features.sdlc_review_mode ?? 'self'}</span>
            <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: #7c3aed; border-color: var(--color-border);">{metrics.features.sdlc_verified ?? 0} verified</span>
          </div>
          <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{metrics.features.sdlc_total ?? 0} tasks tracked · 7-cycle remediation breaker</p>
        </div>
      </div>
    </div>
  {/if}
</div>
